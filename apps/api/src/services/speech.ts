import { isVoiceId, type VoiceOption, type VoiceOptions } from '@q2dink/shared'
import type { Config } from '../config'
import { AppError } from '../errors'

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech'
const VOICES_URL = 'https://api.elevenlabs.io/v1/voices'
const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription'
/** How long the list of the account's voices is kept before asking ElevenLabs again. */
const VOICES_TTL_MS = 10 * 60_000

type Log = { warn: (obj: object, msg: string) => void }

/** One voice as ElevenLabs lists it (only what is used here). */
interface ElevenLabsVoice {
  voice_id?: unknown
  name?: unknown
  category?: unknown
  description?: unknown
  labels?: Record<string, unknown> | null
}

/**
 * The account's own voices (its "My voices": cloned, designed, or added from the Voice Library), by name, as the club's
 * choice lists them. ElevenLabs' built-in default voices ("premade") are left out; the picker offers only its default,
 * Rachel, above them. Voice Library voices are marked `paidOnly` unless the account is known to be on a paid plan.
 */
export function toVoiceOptions(raw: unknown, paidPlan = false): VoiceOption[] {
  const voices = (raw as { voices?: unknown } | null)?.voices
  if (!Array.isArray(voices)) return []
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
  const options = (voices as ElevenLabsVoice[]).flatMap((v): VoiceOption[] => {
    const id = text(v.voice_id)
    const name = text(v.name)
    if (!id || !name || !isVoiceId(id) || v.category === 'premade') return []
    const labels = v.labels ?? {}
    const description =
      text(labels.description) ?? ([labels.accent, labels.age, labels.gender].map(text).filter(Boolean).join(', ') || undefined)
    // Voice Library voices ("professional") need a paid plan through the API; the account's own ones do not.
    return [{ id, name, description, paidOnly: !paidPlan && v.category === 'professional' }]
  })
  return options.sort((a, b) => a.name.localeCompare(b.name))
}

/** How many call-outs are kept, and how many bytes at most (a call-out is a few tens of KB of MP3). */
const CACHE_ENTRIES = 200
const CACHE_BYTES = 20 * 1024 * 1024

/**
 * Reads call-outs out loud through ElevenLabs. The same sentence (same voice and model) is answered from
 * memory, so a call-out repeated from any staff device costs no credits. The cache is per process and
 * starts empty after a restart.
 */
export class SpeechService {
  private readonly cache = new Map<string, Buffer>()
  private cachedBytes = 0
  private readonly config: Config['speech']
  private readonly fetchImpl: typeof fetch
  private voices: { at: number; options: VoiceOptions } | null = null

  constructor(config: Config['speech'], fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.config = config
    this.fetchImpl = fetchImpl
  }

  /** MP3 audio of `text`. Fails with `speech_unavailable` (no key, or ElevenLabs refused the key or quota) or `speech_failed`. */
  async synthesize(text: string, voiceId: string, log?: Log): Promise<Buffer> {
    const { apiKey, model, timeoutMs } = this.config
    if (!apiKey) throw new AppError('speech_unavailable')
    const key = `${voiceId}|${model}|${text}`
    const cached = this.cache.get(key)
    if (cached) {
      // Most recently used last, so the oldest is dropped first.
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      log?.warn({ err: error }, 'ElevenLabs did not answer')
      throw new AppError('speech_failed')
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      log?.warn({ status: response.status, detail: detail.slice(0, 300) }, 'ElevenLabs refused a call-out')
      // A wrong key, no credits left or a quota: the devices use their own voice for a while instead.
      throw new AppError([401, 402, 429].includes(response.status) ? 'speech_unavailable' : 'speech_failed')
    }
    const audio = Buffer.from(await response.arrayBuffer())
    this.remember(key, audio)
    return audio
  }

  /**
   * The voices this key can use, for the club's choice (kept for 10 minutes). `listable` is false when the key may not
   * list voices (it lacks the Voices permission); staff then paste a voice id. Fails with `speech_unavailable` (no key)
   * or `speech_failed`.
   */
  async listVoices(log?: Log, now = Date.now()): Promise<VoiceOptions> {
    const { apiKey, timeoutMs } = this.config
    if (!apiKey) throw new AppError('speech_unavailable')
    if (this.voices && now - this.voices.at < VOICES_TTL_MS) return this.voices.options
    let response: Response
    try {
      response = await this.fetchImpl(VOICES_URL, {
        headers: { 'xi-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      log?.warn({ err: error }, 'ElevenLabs did not answer')
      throw new AppError('speech_failed')
    }
    if (response.status === 401 || response.status === 403) {
      log?.warn({ status: response.status }, 'The ElevenLabs key may not list voices')
      return { voices: [], listable: false }
    }
    if (!response.ok) {
      log?.warn({ status: response.status }, 'ElevenLabs did not list its voices')
      throw new AppError('speech_failed')
    }
    const [list, paidPlan] = await Promise.all([response.json().catch(() => null), this.onPaidPlan(apiKey, timeoutMs)])
    const options: VoiceOptions = { voices: toVoiceOptions(list, paidPlan), listable: true }
    this.voices = { at: now, options }
    return options
  }

  /**
   * Whether the account is on a paid ElevenLabs plan (any tier but "free"), which may use Voice Library voices. False
   * when it cannot be told (the key lacks the User permission, or no answer), so those voices stay marked.
   */
  private async onPaidPlan(apiKey: string, timeoutMs: number): Promise<boolean> {
    try {
      const response = await this.fetchImpl(SUBSCRIPTION_URL, {
        headers: { 'xi-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) return false
      const tier = ((await response.json().catch(() => null)) as { tier?: unknown } | null)?.tier
      return typeof tier === 'string' && tier !== '' && tier !== 'free'
    } catch {
      return false
    }
  }

  private remember(key: string, audio: Buffer) {
    if (audio.length > CACHE_BYTES) return
    this.cache.set(key, audio)
    this.cachedBytes += audio.length
    for (const [oldKey, old] of this.cache) {
      if (this.cache.size <= CACHE_ENTRIES && this.cachedBytes <= CACHE_BYTES) break
      this.cache.delete(oldKey)
      this.cachedBytes -= old.length
    }
  }
}
