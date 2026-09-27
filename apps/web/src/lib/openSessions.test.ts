import type { ClubSessionSummary } from '@q2dink/shared'
import { describe, expect, it } from 'vitest'
import { checkIn, createSession, markNotStarted, pauseSession, startSessionClock } from '@/rotation/engine'
import type { SessionSlice } from '@/store/slices'
import { runningSessions } from './openSessions'

const slice = (sessionId: string, extra: Partial<SessionSlice> = {}): SessionSlice => ({
  location: `Local ${sessionId}`,
  session: checkIn(markNotStarted(createSession('doubles', 1), 0), { id: 1, name: 'Ann', skill: 3 }, 0),
  sessionId,
  startedAt: 0,
  lifetimeCounted: {},
  base: null,
  pending: [],
  locationPending: false,
  ...extra,
})

const summary = (sessionId: string, extra: Partial<ClubSessionSummary> = {}): ClubSessionSummary => ({
  sessionId,
  location: `Club ${sessionId}`,
  status: 'running',
  live: true,
  revision: 3,
  startedAt: null,
  updatedAt: '',
  players: 8,
  openOn: [],
  ...extra,
})

const options = { openId: '', endedIds: [], myDeviceId: 'me' }

describe('runningSessions', () => {
  it('lists the club’s sessions first, then ones only on this device, each once', () => {
    const list = runningSessions({ b: slice('b'), c: slice('c') }, [summary('a'), summary('b')], options)
    expect(list.map((s) => [s.sessionId, s.location, s.onThisDevice])).toEqual([
      ['a', 'Club a', false],
      ['b', 'Club b', true],
      ['c', 'Local c', true],
    ])
    expect(list[2]).toMatchObject({ status: 'notStarted', live: false, players: 1, unsent: 0 })
  })

  it('shows one with changes not sent yet as it is here', () => {
    const pending = [{ action: { type: 'resetNextUp' as const } }]
    const [b] = runningSessions({ b: slice('b', { pending }) }, [summary('b')], options)
    expect(b).toMatchObject({ location: 'Local b', unsent: 1, onThisDevice: true })
  })

  it('leaves out the open one and ones ended here, and this device among those that have one open', () => {
    const club = [summary('a', { openOn: [{ deviceId: 'me', name: 'Me' }, { deviceId: 'x', name: 'Desk' }] }), summary('b'), summary('c')]
    const list = runningSessions({}, club, { openId: 'b', endedIds: ['c'], myDeviceId: 'me' })
    expect(list.map((s) => s.sessionId)).toEqual(['a'])
    expect(list[0].openOn).toEqual([{ deviceId: 'x', name: 'Desk' }])
  })

  it('says who paused one left on this device', () => {
    const session = pauseSession(startSessionClock(slice('p').session, 1), 5, { deviceId: 'x', name: 'Desk' })
    const [p] = runningSessions({ p: slice('p', { session }) }, [], options)
    expect(p).toMatchObject({ status: 'paused', pausedBy: { deviceId: 'x', name: 'Desk' } })
  })
})
