import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stores persist to localStorage; give the node test environment a tiny in-memory one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  })
})

import type { CalloutTexts, CalloutVoice, VoiceChoice } from '@q2dink/shared'
import { clubVoiceFor, useClubVoiceStore } from '@/lib/voiceStore'
import { useSessionStore } from '@/store/session'
import type { CloudApi } from './api'
import { useClubAuth } from './auth'
import { saveClubVoice, syncVoice } from './sync'

const downtown = { slug: 'downtown', name: 'Downtown', token: 'tok-1' }
const uptown = { slug: 'uptown', name: 'Uptown', token: 'tok-2' }

/** A server keeping one voice (and ElevenLabs voice id) per club, by token, with or without an ElevenLabs key. */
function fakeApi(initial: Record<string, { voice: CalloutVoice; voiceId?: string | null; texts?: CalloutTexts }> = {}, elevenLabs = true) {
  const clubs = new Map(Object.entries(initial))
  const settings = (token: string) => {
    const club = clubs.get(token)
    return { voice: club?.voice ?? ('elevenlabs' as CalloutVoice), voiceId: club?.voiceId ?? null, texts: club?.texts ?? {}, elevenLabs }
  }
  const api = {
    fetchVoice: vi.fn(async (token: string) => settings(token)),
    putVoice: vi.fn(async (token: string, choice: VoiceChoice) => {
      const was = clubs.get(token)
      clubs.set(token, {
        voice: choice.voice,
        voiceId: choice.voiceId === undefined ? (was?.voiceId ?? null) : choice.voiceId,
        texts: choice.texts ?? was?.texts ?? {},
      })
      return settings(token)
    }),
  }
  return { api, cloudApi: api as unknown as CloudApi, clubs }
}

beforeEach(() => {
  useClubVoiceStore.setState({ voice: 'elevenlabs', voiceId: null, texts: {}, clubSlug: undefined, pending: false, elevenLabs: undefined })
  useClubAuth.setState({ club: downtown, pendingLifetime: [] })
  useSessionStore.setState({ session: null, parked: {}, clubSlug: undefined, pending: [], endedSessionIds: [] })
})

describe('the club’s call-out voice on this device', () => {
  it('is ElevenLabs with the default voice until the club chooses otherwise, and never another club’s choice', async () => {
    expect(clubVoiceFor('downtown')).toEqual({ voice: 'elevenlabs', voiceId: null, texts: {} })
    expect(await syncVoice(fakeApi({ 'tok-1': { voice: 'device', voiceId: 'abc123' } }, false).cloudApi)).toBe(true)
    expect(clubVoiceFor('downtown')).toEqual({ voice: 'device', voiceId: 'abc123', texts: {} })
    expect(useClubVoiceStore.getState().elevenLabs).toBe(false)
    expect(clubVoiceFor('uptown')).toEqual({ voice: 'elevenlabs', voiceId: null, texts: {} })
  })

  it('sends a change made here, keeps it while offline, and does not let the club’s copy undo it', async () => {
    const { api, cloudApi, clubs } = fakeApi({ 'tok-1': { voice: 'elevenlabs' } })
    api.putVoice.mockRejectedValueOnce(new Error('offline'))
    saveClubVoice({ voice: 'elevenlabs', voiceId: 'pickedVoice', voiceName: 'Adam' }, cloudApi)
    await vi.waitFor(() => expect(api.putVoice).toHaveBeenCalledTimes(1))
    expect(useClubVoiceStore.getState()).toMatchObject({ voiceId: 'pickedVoice', pending: true })

    await syncVoice(cloudApi)
    expect(clubs.get('tok-1')).toEqual({ voice: 'elevenlabs', voiceId: 'pickedVoice', texts: {} })
    expect(useClubVoiceStore.getState()).toMatchObject({ pending: false, elevenLabs: true })
    expect(api.fetchVoice).not.toHaveBeenCalled()
  })

  it('keeps the chosen voice when switching to the device voice and back', async () => {
    const { cloudApi, clubs } = fakeApi({ 'tok-1': { voice: 'elevenlabs', voiceId: 'pickedVoice' } })
    await syncVoice(cloudApi)
    saveClubVoice({ voice: 'device' }, cloudApi)
    await vi.waitFor(() => expect(clubs.get('tok-1')?.voice).toBe('device'))
    expect(clubVoiceFor('downtown')).toEqual({ voice: 'device', voiceId: 'pickedVoice', texts: {} })
    expect(clubs.get('tok-1')?.voiceId).toBe('pickedVoice')
  })

  it('sends the club’s wording with its voice, and keeps both when only one changes', async () => {
    const { cloudApi, clubs } = fakeApi({ 'tok-1': { voice: 'elevenlabs', voiceId: 'pickedVoice' } })
    await syncVoice(cloudApi)
    saveClubVoice({ texts: { nextUp: 'Coming up: {players}' } }, cloudApi)
    await vi.waitFor(() => expect(clubs.get('tok-1')?.texts).toEqual({ nextUp: 'Coming up: {players}' }))
    expect(clubs.get('tok-1')).toMatchObject({ voice: 'elevenlabs', voiceId: 'pickedVoice' })
    saveClubVoice({ voice: 'device' }, cloudApi)
    await vi.waitFor(() => expect(clubs.get('tok-1')?.voice).toBe('device'))
    expect(clubVoiceFor('downtown').texts).toEqual({ nextUp: 'Coming up: {players}' })
    expect(useClubVoiceStore.getState().pending).toBe(false)
  })

  it('follows a change made on another device', async () => {
    useClubVoiceStore.setState({ voice: 'device', voiceId: null, texts: {}, clubSlug: 'downtown', pending: false })
    await syncVoice(fakeApi({ 'tok-1': { voice: 'elevenlabs', voiceId: 'otherVoice' } }).cloudApi)
    expect(clubVoiceFor('downtown')).toEqual({ voice: 'elevenlabs', voiceId: 'otherVoice', texts: {} })
  })

  it('drops a change made for another club once this club’s choice is taken', async () => {
    useClubVoiceStore.setState({ voice: 'device', voiceId: 'x1', clubSlug: 'uptown', pending: true })
    const { api, cloudApi } = fakeApi({ 'tok-1': { voice: 'elevenlabs' } })
    await syncVoice(cloudApi)
    expect(api.putVoice).not.toHaveBeenCalled()
    expect(useClubVoiceStore.getState()).toMatchObject({ clubSlug: 'downtown', voice: 'elevenlabs', voiceId: null, pending: false })
    useClubAuth.setState({ club: uptown })
    expect(clubVoiceFor('uptown')).toEqual({ voice: 'elevenlabs', voiceId: null, texts: {} })
  })
})
