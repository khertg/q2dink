import { describe, expect, it } from 'vitest'
import {
  checkIn,
  createSession,
  isLive,
  lastActivityAt,
  markNotStarted,
  pauseSession,
  playedMs,
  recordScore,
  resumeSession,
  sessionNow,
  sessionStatus,
  setLive,
  startGame,
  startSessionClock,
} from './engine'
import type { RosterPlayer, SessionState } from './types'

const MIN = 60_000
const player = (id: number): RosterPlayer => ({ id, name: `P${id}`, skill: 3 })
const A = { deviceId: 'dev-a', name: 'Desk' }

/** A doubles session on one court, set up at minute 0 and not started, with four checked in. */
function setUp(): SessionState {
  let s = markNotStarted(createSession('doubles', 1), 0)
  for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), sessionNow(s, id * MIN))
  return s
}

describe('a session that has not started', () => {
  it('stands still: no game, never live, and check-ins record the moment it was set up', () => {
    const s = setUp()
    expect(sessionStatus(s)).toBe('notStarted')
    expect(s.queuedAt).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 })
    expect(() => startGame(s, 1, { now: 5 * MIN })).toThrow(/Start the session/)
    expect(isLive(s)).toBe(false)
    expect(isLive(setLive(s, false))).toBe(false)
    expect(() => setLive(s, true)).toThrow(RangeError)
  })

  it('starts everyone waiting from zero when staff start it, and records who and when', () => {
    const s = startSessionClock(setUp(), 30 * MIN, A)
    expect(sessionStatus(s)).toBe('running')
    expect(s.queuedAt).toEqual({ 1: 30 * MIN, 2: 30 * MIN, 3: 30 * MIN, 4: 30 * MIN })
    expect(s.startedAt).toBe(30 * MIN)
    expect(s.startedBy).toEqual(A)
    expect(s.clockStoppedAt).toBeUndefined()
    expect(isLive(s)).toBe(true)
    const game = startGame(s, 1, { now: 32 * MIN })
    expect(game.courts[0].waited).toEqual({ 1: 120, 2: 120, 3: 120, 4: 120 })
  })

  it('starting it again changes nothing, so two devices pressing Start agree on the first', () => {
    const s = startSessionClock(setUp(), MIN, A)
    expect(startSessionClock(s, 2 * MIN, { deviceId: 'dev-b', name: 'Phone' })).toBe(s)
  })
})

describe('pausing and resuming', () => {
  /** Started at minute 0; a game started at minute 10. */
  const running = () => startGame(startSessionClock(setUp(), 0), 1, { now: 10 * MIN })

  it('freezes a game in progress and leaves the pause out of its time', () => {
    const paused = pauseSession(running(), 20 * MIN, A)
    expect(sessionStatus(paused)).toBe('paused')
    expect(paused.pausedBy).toEqual(A)
    // On screen the clock shows the moment it paused.
    expect(playedMs(paused.courts[0], sessionNow(paused, 50 * MIN))).toBe(10 * MIN)
    const resumed = resumeSession(paused, 50 * MIN)
    expect(resumed.clockStoppedAt).toBeUndefined()
    expect(resumed.pausedBy).toBeUndefined()
    expect(playedMs(resumed.courts[0], 55 * MIN)).toBe(15 * MIN)
    const done = recordScore(resumed, 1, 11, 5, { now: 55 * MIN }).state
    expect(done.matches?.[0].seconds).toBe(15 * 60)
  })

  it('keeps waits frozen, including for players checked in while paused', () => {
    let s = startSessionClock(markNotStarted(createSession('doubles', 1), 0), 0)
    s = checkIn(s, player(1), 5 * MIN)
    s = pauseSession(s, 10 * MIN)
    s = checkIn(s, player(2), sessionNow(s, 20 * MIN))
    s = resumeSession(s, 40 * MIN)
    // P1 had waited 5 min at the pause; P2 joined during it and has waited nothing.
    expect(s.queuedAt).toEqual({ 1: 35 * MIN, 2: 40 * MIN })
  })

  it('refuses to start a game while paused, but a game can still be finished at the paused time', () => {
    const paused = pauseSession(running(), 20 * MIN)
    expect(() => startGame(paused, 1, { now: 21 * MIN })).toThrow(/paused/)
    const done = recordScore(paused, 1, 11, 9, { now: sessionNow(paused, 45 * MIN) }).state
    expect(done.matches?.[0].seconds).toBe(10 * 60)
  })

  it('pausing twice keeps the first pause and who made it', () => {
    const once = pauseSession(running(), 20 * MIN, A)
    expect(pauseSession(once, 25 * MIN, { deviceId: 'dev-b', name: 'Phone' })).toBe(once)
  })

  it('resuming a running session changes nothing; one not started must be started', () => {
    const s = running()
    expect(resumeSession(s, 30 * MIN)).toBe(s)
    expect(() => resumeSession(setUp(), 30 * MIN)).toThrow(/not started/)
  })

  it('counts the pause as the last activity', () => {
    expect(lastActivityAt(pauseSession(running(), 99 * MIN))).toBe(99 * MIN)
  })
})

describe('a pause that arrives late', () => {
  it('never stops the clock before a game that started since, so no time goes negative', () => {
    // Another device started a game at minute 20; a pause made offline at minute 12 arrives afterwards.
    const s = startGame(startSessionClock(setUp(), 0), 1, { now: 20 * MIN })
    const paused = pauseSession(s, 12 * MIN, A)
    expect(paused.clockStoppedAt).toBe(20 * MIN)
    expect(playedMs(paused.courts[0], sessionNow(paused, 99 * MIN))).toBe(0)
    const resumed = resumeSession(paused, 30 * MIN)
    expect(playedMs(resumed.courts[0], 31 * MIN)).toBe(MIN)
  })
})
