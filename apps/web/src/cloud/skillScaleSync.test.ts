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

import { USA_PICKLEBALL_SCALE, type SkillScale } from '@q2dink/shared'
import { DEFAULT_SCALE } from '@/lib/skill'
import { clubScaleFor, useClubScale } from '@/lib/skillScaleStore'
import { useSessionStore } from '@/store/session'
import type { CloudApi } from './api'
import { useClubAuth } from './auth'
import { saveClubSkillScale, syncSkillScale } from './sync'

const downtown = { slug: 'downtown', name: 'Downtown', token: 'tok-1' }
const uptown = { slug: 'uptown', name: 'Uptown', token: 'tok-2' }
const FOUR: SkillScale = {
  levels: [
    { label: 'Social', from: 1 },
    { label: 'Club', from: 3 },
    { label: 'Strong', from: 4 },
    { label: 'Pro', from: 5 },
  ],
}

/** A server keeping one skill scale per club, by token. */
function fakeApi(initial: Record<string, SkillScale | null> = {}) {
  const clubs = new Map(Object.entries(initial))
  const api = {
    fetchSkillScale: vi.fn(async (token: string) => clubs.get(token) ?? null),
    putSkillScale: vi.fn(async (token: string, scale: SkillScale | null) => {
      clubs.set(token, scale)
      return scale
    }),
  }
  return { api, cloudApi: api as unknown as CloudApi, clubs }
}

beforeEach(() => {
  useClubScale.setState({ scale: null, clubSlug: undefined, pending: false })
  useClubAuth.setState({ club: downtown, pendingLifetime: [] })
  useSessionStore.setState({ session: null, parked: {}, clubSlug: undefined })
})

describe('the club’s skill levels on this device', () => {
  it('are the default until the club chooses others, and never another club’s', async () => {
    expect(clubScaleFor('downtown')).toBe(DEFAULT_SCALE)
    const { cloudApi } = fakeApi({ 'tok-1': FOUR })
    expect(await syncSkillScale(cloudApi)).toBe(true)
    expect(clubScaleFor('downtown')).toEqual(FOUR)
    expect(clubScaleFor('uptown')).toBe(DEFAULT_SCALE)
  })

  it('send a change made here, keep it while offline, and do not let the club’s copy undo it', async () => {
    const { api, cloudApi, clubs } = fakeApi({ 'tok-1': USA_PICKLEBALL_SCALE })
    api.putSkillScale.mockRejectedValueOnce(new Error('offline'))
    saveClubSkillScale(FOUR, cloudApi)
    await vi.waitFor(() => expect(api.putSkillScale).toHaveBeenCalledTimes(1))
    expect(useClubScale.getState()).toMatchObject({ scale: FOUR, pending: true })
    expect(clubScaleFor('downtown')).toEqual(FOUR)

    await syncSkillScale(cloudApi)
    expect(clubs.get('tok-1')).toEqual(FOUR)
    expect(useClubScale.getState().pending).toBe(false)
    expect(api.fetchSkillScale).not.toHaveBeenCalled()
  })

  it('go back to the default when the club does', async () => {
    useClubScale.setState({ scale: FOUR, clubSlug: 'downtown', pending: false })
    await syncSkillScale(fakeApi({ 'tok-1': null }).cloudApi)
    expect(clubScaleFor('downtown')).toBe(DEFAULT_SCALE)
  })

  it('drop a change made for another club when a different club logs in', async () => {
    const { api, cloudApi } = fakeApi({ 'tok-2': USA_PICKLEBALL_SCALE })
    useClubScale.setState({ scale: FOUR, clubSlug: 'downtown', pending: true })
    useClubAuth.setState({ club: uptown })
    await syncSkillScale(cloudApi)
    expect(api.putSkillScale).not.toHaveBeenCalled()
    expect(useClubScale.getState()).toMatchObject({ scale: USA_PICKLEBALL_SCALE, clubSlug: 'uptown', pending: false })
  })

  it('are not copied into a session while the club uses the default, so the session follows the default', () => {
    useSessionStore.getState().startSession('Night', 'doubles', 1)
    expect(useSessionStore.getState().session).not.toHaveProperty('skillScale')
    // Choosing the default by hand counts as the default too.
    useClubScale.setState({ scale: DEFAULT_SCALE, clubSlug: 'downtown', pending: false })
    useSessionStore.getState().startSession('Night 2', 'doubles', 1)
    expect(useSessionStore.getState().session).not.toHaveProperty('skillScale')
  })

  it('are copied into a session created now; a later change leaves it alone', async () => {
    useClubScale.setState({ scale: FOUR, clubSlug: 'downtown', pending: false })
    useSessionStore.getState().startSession('Night', 'doubles', 1)
    expect(useSessionStore.getState().session?.skillScale).toEqual(FOUR)
    useClubScale.setState({ scale: USA_PICKLEBALL_SCALE })
    expect(useSessionStore.getState().session?.skillScale).toEqual(FOUR)
  })
})
