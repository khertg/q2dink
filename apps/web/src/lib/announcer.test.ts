import { describe, expect, it, vi } from 'vitest'
import { CloudError, type CloudApi } from '@/cloud/api'
import {
  chooseEngine,
  createAnnouncer,
  pickVoice,
  UNAVAILABLE_COOLDOWN_MS,
  type AnnouncerDeps,
  type AudioOut,
  type SynthOut,
} from './announcer'

describe('chooseEngine', () => {
  const base = { wanted: 'elevenlabs' as const, cloud: true, online: true, unavailableUntil: 0, now: 1000 }
  it('uses the server voice when signed in, online and not told it is unavailable', () => {
    expect(chooseEngine(base)).toBe('cloud')
    expect(chooseEngine({ ...base, cloud: false })).toBe('device')
    expect(chooseEngine({ ...base, online: false })).toBe('device')
    expect(chooseEngine({ ...base, unavailableUntil: 2000 })).toBe('device')
    expect(chooseEngine({ ...base, unavailableUntil: 1000 })).toBe('cloud')
    expect(chooseEngine({ ...base, wanted: 'device' })).toBe('device')
  })
})

describe('pickVoice', () => {
  const voice = (lang: string, isDefault = false) => ({ lang, name: lang, default: isDefault })
  it("prefers the device's English, then US English, then any English, then the default", () => {
    const voices = [voice('fr-FR', true), voice('en-GB'), voice('en-US'), voice('en-AU')]
    expect(pickVoice(voices, 'en-AU')?.lang).toBe('en-AU')
    expect(pickVoice(voices, 'fil-PH')?.lang).toBe('en-US')
    expect(pickVoice([voice('fr-FR', true), voice('en_GB')], 'fil-PH')?.lang).toBe('en_GB')
    expect(pickVoice([voice('fr-FR', true)], 'en-US')?.lang).toBe('fr-FR')
    expect(pickVoice([], 'en-US')).toBeUndefined()
  })
})

/** Fakes for everything the announcer plays through; each play settles when `finish` is called. */
function setup(over: Partial<AnnouncerDeps> = {}, speak?: CloudApi['speak']) {
  const played: Blob[] = []
  const said: string[] = []
  const audio: AudioOut = {
    unlock: vi.fn(),
    play: vi.fn(async (blob: Blob) => {
      played.push(blob)
    }),
    stop: vi.fn(),
  }
  const synth: SynthOut = {
    speak: vi.fn(async (text: string) => {
      said.push(text)
    }),
    cancel: vi.fn(),
  }
  const api = { speak: vi.fn(speak ?? (async (_t: string, text: string) => new Blob([text]))) }
  let now = 0
  const announcer = createAnnouncer({
    api: api as unknown as CloudApi,
    token: () => 'tok',
    online: () => true,
    now: () => now,
    audio,
    synth,
    ...over,
  })
  return { announcer, api, audio, synth, played, said, advance: (ms: number) => (now += ms) }
}

describe('createAnnouncer', () => {
  it('plays the server voice, and a repeat from memory', async () => {
    const { announcer, api, audio, played, said } = setup()
    expect(await announcer.announce('Next up: Ann')).toBe('cloud')
    expect(audio.unlock).toHaveBeenCalled()
    expect(await announcer.announce('Next up: Ann')).toBe('cloud')
    expect(api.speak).toHaveBeenCalledTimes(1)
    expect(played).toHaveLength(2)
    expect(said).toEqual([])
  })

  it('uses the device voice with no cloud, no login or no connection', async () => {
    for (const over of [{ api: null }, { token: () => undefined }, { online: () => false }, { audio: null }]) {
      const { announcer, api, said } = setup(over)
      expect(await announcer.announce('Hi')).toBe('device')
      expect(said).toEqual(['Hi'])
      expect(api.speak).not.toHaveBeenCalled()
    }
  })

  it('falls back to the device voice when the server fails, and skips it for a while when it has no voice', async () => {
    const failing = setup({}, async () => Promise.reject(new CloudError('network')))
    expect(await failing.announcer.announce('Hi')).toBe('device')
    expect(await failing.announcer.announce('Hi')).toBe('device')
    expect(failing.api.speak).toHaveBeenCalledTimes(2)

    const none = setup({}, async () => Promise.reject(new CloudError('speech_unavailable')))
    expect(await none.announcer.announce('Hi')).toBe('device')
    expect(await none.announcer.announce('Hi')).toBe('device')
    expect(none.api.speak).toHaveBeenCalledTimes(1)
    none.advance(UNAVAILABLE_COOLDOWN_MS)
    await none.announcer.announce('Hi')
    expect(none.api.speak).toHaveBeenCalledTimes(2)
  })

  it('falls back when the audio cannot play', async () => {
    const { announcer, audio, said } = setup()
    vi.mocked(audio.play).mockRejectedValueOnce(new Error('NotAllowedError'))
    expect(await announcer.announce('Hi')).toBe('device')
    expect(said).toEqual(['Hi'])
  })

  it('gives up on a slow server and speaks on the device', async () => {
    vi.useFakeTimers()
    try {
      const { announcer, said } = setup({ timeoutMs: 100 }, (_t, _text, signal) =>
        new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new CloudError('network')))),
      )
      const result = announcer.announce('Hi')
      await vi.advanceTimersByTimeAsync(100)
      expect(await result).toBe('device')
      expect(said).toEqual(['Hi'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops what is playing when a new call-out starts, and never speaks the old one', async () => {
    let release: (blob: Blob) => void = () => {}
    const { announcer, audio, synth, played, said } = setup({}, (_t, text) =>
      text === 'first' ? new Promise((resolve) => (release = resolve)) : Promise.resolve(new Blob([text])),
    )
    const first = announcer.announce('first')
    expect(await announcer.announce('second')).toBe('cloud')
    expect(audio.stop).toHaveBeenCalled()
    expect(synth.cancel).toHaveBeenCalled()
    release(new Blob(['first']))
    expect(await first).toBe('superseded')
    expect(played).toHaveLength(1)
    expect(said).toEqual([])
  })

  it('never asks the server when the club chose the device voice', async () => {
    let voice: 'elevenlabs' | 'device' = 'device'
    const { announcer, api, said } = setup({ voice: () => voice })
    expect(await announcer.announce('Hi')).toBe('device')
    expect(api.speak).not.toHaveBeenCalled()
    expect(said).toEqual(['Hi'])
    voice = 'elevenlabs'
    expect(await announcer.announce('Hi')).toBe('cloud')
  })

  it('asks the server again at once after the club switches back to ElevenLabs', async () => {
    let voice: 'elevenlabs' | 'device' = 'elevenlabs'
    const { announcer, api } = setup({ voice: () => voice }, async () => Promise.reject(new CloudError('speech_unavailable')))
    await announcer.announce('Hi')
    voice = 'device'
    await announcer.announce('Hi')
    voice = 'elevenlabs'
    await announcer.announce('Hi')
    expect(api.speak).toHaveBeenCalledTimes(2)
  })

  it('never replays audio of a voice the club no longer uses', async () => {
    let voiceId: string | null = null
    const { announcer, api } = setup({ voiceId: () => voiceId })
    await announcer.announce('Next up')
    await announcer.announce('Next up')
    expect(api.speak).toHaveBeenCalledTimes(1)
    voiceId = 'newVoice'
    await announcer.announce('Next up')
    expect(api.speak).toHaveBeenCalledTimes(2)
    // The server reads with the club's voice by itself: it is not named on the request.
    expect(api.speak.mock.calls[1][3]).toBeUndefined()
  })

  it('tries a voice by name, even during a pause the server asked for, without starting one', async () => {
    const { announcer, api, said } = setup({}, async (_t, _text, _signal, voiceId) =>
      voiceId === 'paidVoice' ? Promise.reject(new CloudError('speech_unavailable')) : new Blob(['ok']),
    )
    expect(await announcer.announce('Test', { voiceId: 'paidVoice' })).toBe('device')
    expect(said).toEqual(['Test'])
    expect(await announcer.announce('Hi')).toBe('cloud')
    expect(await announcer.announce('Test', { voiceId: 'goodVoice' })).toBe('cloud')
    expect(api.speak.mock.calls.map((c) => c[3])).toEqual(['paidVoice', undefined, 'goodVoice'])
  })

  it('says nobody spoke when the device has no voice either', async () => {
    const { announcer } = setup({ api: null, synth: null })
    expect(await announcer.announce('Hi')).toBe('none')
  })
})
