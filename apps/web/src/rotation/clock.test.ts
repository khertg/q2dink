import { describe, expect, it } from 'vitest'
import {
  checkIn,
  cancelMatch,
  createSession,
  fillCourtSpot,
  isLive,
  lastActivityAt,
  markNotStarted,
  pauseGame,
  pauseSession,
  playedMs,
  recordScore,
  removeFromCourt,
  resumeGame,
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

describe('pausing one court’s game (Pause game)', () => {
  /** Two courts, eight players, both games started at minute 0; P9 waits. */
  function twoGames(): SessionState {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 9; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 0 })
    return startGame(s, 2, { now: 0 })
  }

  it('stands its time still until resumed, while the other court keeps running', () => {
    let s = pauseGame(twoGames(), 1, 4 * MIN)
    expect(s.courts[0]).toMatchObject({ pausedAt: 4 * MIN, pausedByStaff: true })
    expect(playedMs(s.courts[0], 9 * MIN)).toBe(4 * MIN)
    expect(playedMs(s.courts[1], 9 * MIN)).toBe(9 * MIN)
    s = resumeGame(s, 1, 10 * MIN)
    expect(s.courts[0].pausedAt).toBeUndefined()
    expect(s.courts[0].pausedByStaff).toBeUndefined()
    expect(s.courts[0].pausedSeconds).toBe(6 * 60)
    const done = recordScore(s, 1, 11, 4, { now: 12 * MIN }).state
    expect(done.matches?.[0].seconds).toBe(6 * 60)
  })

  it('pausing twice keeps the first pause; resuming a running game changes nothing', () => {
    const once = pauseGame(twoGames(), 1, 4 * MIN)
    expect(pauseGame(once, 1, 6 * MIN)).toBe(once)
    const s = twoGames()
    expect(resumeGame(s, 1, MIN)).toBe(s)
  })

  it('needs a game in progress', () => {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    expect(() => pauseGame(s, 1, MIN)).toThrow(/no game in progress/)
    const staged = fillCourtSpot(s, 1, 0, 1, MIN, 0)
    expect(() => pauseGame(staged, 1, MIN)).toThrow(/has not started/)
  })

  it('filling an open spot does not resume it; resuming a short game waits for the spot', () => {
    let s = pauseGame(twoGames(), 1, 2 * MIN)
    const out = s.courts[0].teams![0][0]
    s = removeFromCourt(s, 1, out, { now: 3 * MIN })
    expect(s.courts[0].pausedAt).toBe(2 * MIN)
    s = fillCourtSpot(s, 1, 0, 9, 4 * MIN, 0)
    expect(s.courts[0]).toMatchObject({ pausedAt: 2 * MIN, pausedByStaff: true })
    // Short again, then resumed: still paused until the spot is filled.
    s = removeFromCourt(s, 1, 9, { now: 5 * MIN })
    s = resumeGame(s, 1, 6 * MIN)
    expect(s.courts[0].pausedByStaff).toBeUndefined()
    expect(s.courts[0].pausedAt).toBe(2 * MIN)
    s = fillCourtSpot(s, 1, 0, 9, 7 * MIN, 0)
    expect(s.courts[0].pausedAt).toBeUndefined()
    expect(s.courts[0].pausedSeconds).toBe(5 * 60)
  })

  it('works while the session is paused: the session stop is never counted twice', () => {
    let s = pauseSession(twoGames(), 5 * MIN)
    s = pauseGame(s, 1, sessionNow(s, 8 * MIN)) // at the session's frozen time, minute 5
    s = resumeSession(s, 20 * MIN) // 15 minutes stopped: every timer moves on by 15
    expect(s.courts[0].pausedAt).toBe(20 * MIN)
    s = resumeGame(s, 1, 22 * MIN)
    expect(playedMs(s.courts[0], 25 * MIN)).toBe(8 * MIN)
    expect(playedMs(s.courts[1], 25 * MIN)).toBe(10 * MIN)
  })

  it('a paused game can be finished or cancelled, with its time up to the pause, and the next game runs', () => {
    const s = pauseGame(twoGames(), 1, 4 * MIN)
    const done = recordScore(s, 1, 11, 7, { now: 9 * MIN }).state
    expect(done.matches?.[0].seconds).toBe(4 * 60)
    expect(done.courts[0]).toEqual({ id: 1, name: 'Court 1', teams: null })
    expect(cancelMatch(s, 1, 9 * MIN).courts[0].pausedByStaff).toBeUndefined()
  })
})
