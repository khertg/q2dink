import type { CalloutVoice } from '@q2dink/shared'
import { CloudError, type CloudApi } from '@/cloud/api'

/**
 * Plays call-outs (texts from callout.ts). Unless the club chose each device's own voice, the club's server voice (ElevenLabs, through POST /speech)
 * comes first; the device's own voice (Web Speech API) is the fallback when there is no cloud, no
 * login, no connection, the request fails or is slow, or the server has no voice service. A new
 * call-out always stops the one playing.
 */

/** How long the server voice may take before the device voice speaks instead. */
export const CLOUD_TIMEOUT_MS = 4000
/** After the server says it has no voice service, the device voice is used for this long without asking. */
export const UNAVAILABLE_COOLDOWN_MS = 10 * 60_000
/** Server audio kept on the device, by text, so a repeated call-out is neither fetched nor paid for again. */
const CACHE_ENTRIES = 20

export type Engine = 'cloud' | 'device'

/** Which voice to try first. */
export function chooseEngine(input: {
  /** The club's choice: 'device' never uses the server voice. */
  wanted: CalloutVoice
  cloud: boolean
  online: boolean
  unavailableUntil: number
  now: number
}): Engine {
  return input.wanted === 'elevenlabs' && input.cloud && input.online && input.now >= input.unavailableUntil ? 'cloud' : 'device'
}

export interface VoiceLike {
  lang: string
  name: string
  default: boolean
}

/**
 * The device voice to use: one in the device's own language if that is English, else US English, else
 * any English, else the device's default. Undefined leaves the choice to the browser.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], language = 'en-US'): V | undefined {
  const lang = (voice: V) => voice.lang.replace('_', '-').toLowerCase()
  const wanted = language.toLowerCase().startsWith('en') ? language.toLowerCase() : 'en-us'
  return (
    voices.find((v) => lang(v) === wanted) ??
    voices.find((v) => lang(v) === 'en-us') ??
    voices.find((v) => lang(v).startsWith('en')) ??
    voices.find((v) => v.default)
  )
}

/** Plays server audio. `play` settles when it ends or is stopped. */
export interface AudioOut {
  /** Called inside the tap, before anything is awaited: phones only let audio play that started from a tap. */
  unlock(): void
  play(audio: Blob): Promise<void>
  stop(): void
}

/** The device's own voice. `speak` settles when it ends or is cancelled. */
export interface SynthOut {
  speak(text: string): Promise<void>
  cancel(): void
}

export interface AnnouncerDeps {
  api: CloudApi | null
  token: () => string | undefined
  /** The club's choice of voice, read at each call-out. Missing: the server voice first. */
  voice?: () => CalloutVoice
  /** The club's ElevenLabs voice (null: the default), read at each call-out so a new one is never answered from memory. */
  voiceId?: () => string | null
  online: () => boolean
  now: () => number
  audio: AudioOut | null
  synth: SynthOut | null
  timeoutMs?: number
}

/** Who spoke: the server voice, the device voice, nobody (no voice at all), or a newer call-out took over. */
export type Spoken = Engine | 'none' | 'superseded'

/** `voiceId`: try this ElevenLabs voice instead of the club's (Test voice, before choosing it). */
export interface AnnounceOptions {
  voiceId?: string
}

export interface Announcer {
  announce(text: string, options?: AnnounceOptions): Promise<Spoken>
  stop(): void
}

export function createAnnouncer(deps: AnnouncerDeps): Announcer {
  const cache = new Map<string, Blob>()
  let unavailableUntil = 0
  let lastWanted: string | undefined
  let current = 0
  let inFlight: AbortController | null = null

  function stop() {
    current++
    inFlight?.abort()
    inFlight = null
    deps.audio?.stop()
    deps.synth?.cancel()
  }

  async function fetchAudio(token: string, text: string, voiceId: string | null, preview: boolean): Promise<Blob> {
    const key = `${voiceId ?? ''}|${text}`
    const cached = cache.get(key)
    if (cached) {
      cache.delete(key)
      cache.set(key, cached)
      return cached
    }
    const controller = new AbortController()
    inFlight = controller
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? CLOUD_TIMEOUT_MS)
    try {
      // The server reads with the club's voice by itself; only a voice being tried is named.
      const audio = await deps.api!.speak(token, text, controller.signal, preview && voiceId ? voiceId : undefined)
      cache.set(key, audio)
      if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
      return audio
    } finally {
      clearTimeout(timer)
      if (inFlight === controller) inFlight = null
    }
  }

  async function announce(text: string, options: AnnounceOptions = {}): Promise<Spoken> {
    stop()
    const id = current
    const token = deps.token()
    const wanted = deps.voice?.() ?? 'elevenlabs'
    const preview = options.voiceId !== undefined
    const voiceId = options.voiceId ?? deps.voiceId?.() ?? null
    // The club switched voices: a pause the server asked for under the other choice no longer holds.
    const choice = `${wanted}|${deps.voiceId?.() ?? ''}`
    if (lastWanted !== undefined && choice !== lastWanted) unavailableUntil = 0
    lastWanted = choice
    const engine = chooseEngine({
      wanted,
      cloud: !!deps.api && !!token && !!deps.audio,
      online: deps.online(),
      // Trying a voice always asks the server, so staff hear whether it works.
      unavailableUntil: preview ? 0 : unavailableUntil,
      now: deps.now(),
    })
    if (engine === 'cloud') {
      deps.audio!.unlock()
      try {
        const audio = await fetchAudio(token!, text, voiceId, preview)
        if (id !== current) return 'superseded'
        await deps.audio!.play(audio)
        return id === current ? 'cloud' : 'superseded'
      } catch (error) {
        if (!preview && error instanceof CloudError && error.code === 'speech_unavailable') {
          unavailableUntil = deps.now() + UNAVAILABLE_COOLDOWN_MS
        }
        if (id !== current) return 'superseded'
      }
    }
    if (!deps.synth) return 'none'
    await deps.synth.speak(text)
    return id === current ? 'device' : 'superseded'
  }

  return { announce, stop }
}

/** A tiny silent WAV, played inside the first tap so later server audio is allowed to play on phones. */
function silence(): Blob {
  const samples = 800 // 0.1 s at 8 kHz, 8-bit mono
  const view = new DataView(new ArrayBuffer(44 + samples))
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128)
  return new Blob([view.buffer], { type: 'audio/wav' })
}

/** Server audio through one reused <audio> element (null where there is none). */
export function browserAudio(): AudioOut | null {
  if (typeof Audio === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  let element: HTMLAudioElement | null = null
  let unlocked = false
  let url: string | null = null
  let settle: (() => void) | null = null

  function release() {
    settle?.()
    settle = null
    if (url) URL.revokeObjectURL(url)
    url = null
  }

  return {
    unlock() {
      element ??= new Audio()
      if (unlocked) return
      unlocked = true
      url = URL.createObjectURL(silence())
      element.src = url
      element.play().catch(() => {})
    },
    play(audio) {
      element ??= new Audio()
      const el = element
      el.pause()
      release()
      return new Promise<void>((resolve, reject) => {
        settle = resolve
        url = URL.createObjectURL(audio)
        el.onended = () => release()
        el.onerror = () => {
          settle = null
          reject(new Error('The audio could not be played'))
        }
        el.src = url
        el.play().catch((error: unknown) => {
          settle = null
          reject(error)
        })
      })
    },
    stop() {
      element?.pause()
      release()
    },
  }
}

/** The device's own voice (null where the browser has none). */
export function browserSynth(): SynthOut | null {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return null
  return {
    speak(text) {
      return new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text)
        const voice = pickVoice(speechSynthesis.getVoices(), navigator.language)
        if (voice) utterance.voice = voice
        utterance.lang = voice?.lang ?? 'en-US'
        utterance.rate = 0.95
        utterance.onend = () => resolve()
        utterance.onerror = () => resolve()
        speechSynthesis.speak(utterance)
      })
    },
    cancel() {
      speechSynthesis.cancel()
    },
  }
}
