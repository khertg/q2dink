import { describe, expect, it } from 'vitest'
import { createSession } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { applyAction, rebase, sessionIdFor, type PendingAction, type SessionAction } from './actions'

const checkIn = (...names: string[]): SessionAction => ({
  type: 'checkIn',
  players: names.map((name) => ({ name, skill: 3 })),
  now: 0,
})
const apply = (session: SessionState, ...actions: SessionAction[]) =>
  actions.reduce((s, action) => applyAction(s, action).session, session)
const names = (s: SessionState) => s.queue.map((id) => s.players[id].name)

describe('session player ids', () => {
  it('are the session’s own: the next number, or the same player’s id for the same name', () => {
    const s = apply(createSession('doubles', 1), checkIn('Ann', 'Bob'))
    expect(Object.keys(s.players)).toEqual(['1', '2'])
    expect(sessionIdFor(s, ' ann ')).toBe(1)
    expect(sessionIdFor(s, 'Cy')).toBe(3)
    expect(sessionIdFor(createSession('doubles', 1), 'Ann')).toBe(1)
  })

  it('bring a player back from a break under the id they had', () => {
    const s = apply(createSession('doubles', 1), checkIn('Ann'), { type: 'checkOut', playerId: 1 }, checkIn('ANN'))
    expect(s.queue).toEqual([1])
    expect(Object.keys(s.players)).toEqual(['1'])
  })

  it('give a removed player who never played no id, so the next check-in can take it', () => {
    const s = apply(createSession('doubles', 1), checkIn('Ann', 'Bob'), { type: 'removePlayer', playerId: 2, now: 0 })
    expect(Object.keys(s.players)).toEqual(['1'])
    expect(sessionIdFor(s, 'Cy')).toBe(2)
  })

  it('bring back a removed player who played under the id they had', () => {
    let s = apply(createSession('doubles', 1), checkIn('Ann', 'Bob', 'Cy', 'Dee'), { type: 'startGame', courtId: 1, now: 0 })
    s = apply(s, { type: 'recordScore', courtId: 1, scoreA: 11, scoreB: 4, now: 1000 }, { type: 'removePlayer', playerId: 1, now: 2000 })
    expect(s.queue).not.toContain(1)
    s = apply(s, checkIn('ann'))
    expect(s.queue).toContain(1)
    expect(s.stats[1].games).toBe(1)
  })
})

describe('rebase', () => {
  const base = apply(createSession('doubles', 1), checkIn('Ann'))

  it('always applies going live or not on the club’s newer copy', () => {
    const club = apply(base, checkIn('Bob'))
    const result = rebase(club, [{ action: { type: 'setLive', live: true } }])
    expect(result.session.live).toBe(true)
    expect(result.dropped).toEqual([])
  })

  it('applies this device’s changes again on the club’s newer copy', () => {
    const club = apply(base, checkIn('Bob'))
    const pending: PendingAction[] = [{ action: checkIn('Cy'), ids: [2] }]
    const result = rebase(club, pending)
    expect(names(result.session)).toEqual(['Ann', 'Bob', 'Cy'])
    expect(result.pending[0].ids).toEqual([3])
    expect(result.dropped).toEqual([])
  })

  it('renumbers later changes that name a player whose id changed on the club’s copy', () => {
    // Here Cy became 2 and was sent on a break; on the club, Bob already took 2.
    const club = apply(base, checkIn('Bob'))
    const pending: PendingAction[] = [
      { action: checkIn('Cy'), ids: [2] },
      { action: { type: 'checkOut', playerId: 2 } },
    ]
    const result = rebase(club, pending)
    expect(names(result.session)).toEqual(['Ann', 'Bob'])
    expect(result.session.onBreak).toEqual([3])
    expect(result.session.players[3].name).toBe('Cy')
  })

  it('renumbers a player taken out of Next up after a check-in got a different id', () => {
    // Here Bob became 2 and was taken out of Next up onto a break; on the club, Zed already took 2.
    const club = apply(base, checkIn('Zed'))
    const pending: PendingAction[] = [
      { action: checkIn('Bob', 'Cy', 'Dee', 'Eve'), ids: [2, 3, 4, 5] },
      { action: { type: 'dropFromNextUp', playerId: 2, onBreak: true } },
    ]
    const result = rebase(club, pending)
    expect(result.dropped).toEqual([])
    expect(result.session.onBreak.map((id) => result.session.players[id].name)).toEqual(['Bob'])
  })

  it('renumbers a player taken off a court after a check-in got a different id', () => {
    // Here Bob became 2 and was taken off the court; on the club, Zed already took 2.
    const club = apply(base, checkIn('Zed'))
    const pending: PendingAction[] = [
      { action: checkIn('Bob', 'Cy', 'Dee'), ids: [2, 3, 4] },
      { action: { type: 'startGame', courtId: 1, now: 0 } },
      { action: { type: 'removeFromCourt', courtId: 1, playerId: 2, onBreak: false, now: 1000 } },
    ]
    const result = rebase(club, pending)
    expect(result.dropped).toEqual([])
    expect(names(result.session)[0]).toBe('Bob')
    expect(result.session.courts[0].pausedAt).toBe(1000)
  })

  it('fills the exact open spot on a court, also when replayed on the club’s copy', () => {
    const playing = apply(base, checkIn('Bob', 'Cy', 'Dee', 'Eve'), { type: 'startGame', courtId: 1, now: 0 })
    const [first, second] = playing.courts[0].teams![0]
    const pending: PendingAction[] = [
      { action: { type: 'removeFromCourt', courtId: 1, playerId: first, onBreak: false, now: 1000 } },
      { action: { type: 'fillCourtSpot', courtId: 1, team: 0, slot: 0, playerId: 5, now: 2000 } },
    ]
    const result = rebase(playing, pending)
    expect(result.dropped).toEqual([])
    expect(result.session.courts[0].teams![0]).toEqual([5, second])
  })

  it('renumbers a removed player after a check-in got a different id, and drops a remove done elsewhere', () => {
    const club = apply(base, checkIn('Zed'))
    const pending: PendingAction[] = [
      { action: checkIn('Bob'), ids: [2] },
      { action: { type: 'removePlayer', playerId: 2, now: 0 } },
    ]
    const result = rebase(club, pending)
    expect(result.dropped).toEqual([])
    expect(names(result.session)).toEqual(['Ann', 'Zed'])
    const removed = apply(base, { type: 'removePlayer', playerId: 1, now: 0 })
    const again = rebase(removed, [{ action: { type: 'removePlayer', playerId: 1, now: 0 } }])
    expect(again.dropped[0].reason).toMatch(/not in the session/)
  })

  it('drops a change that no longer applies, and says why', () => {
    const playing = apply(base, checkIn('Bob', 'Cy', 'Dee'), { type: 'startGame', courtId: 1, now: 0 })
    const club = apply(playing, { type: 'recordScore', courtId: 1, scoreA: 11, scoreB: 2, now: 0 })
    const result = rebase(club, [{ action: { type: 'recordScore', courtId: 1, scoreA: 3, scoreB: 11, now: 0 } }])
    expect(result.session).toBe(club)
    expect(result.pending).toEqual([])
    expect(result.dropped[0].reason).toMatch(/no game in progress/)
  })

  it('drops an undo once the club’s copy changed since, and applies it when it did not', () => {
    const after = apply(base, checkIn('Bob'))
    const undo: SessionAction = { type: 'restore', before: base, after }
    expect(rebase(after, [{ action: undo }]).session).toBe(base)
    const moved = apply(after, checkIn('Cy'))
    const result = rebase(moved, [{ action: undo }])
    expect(result.session).toBe(moved)
    expect(result.dropped).toHaveLength(1)
  })
})

describe('the session clock across devices', () => {
  const MIN = 60_000
  const A = { deviceId: 'a', name: 'Desk' }
  const B = { deviceId: 'b', name: 'Phone' }
  const checkInAt = (now: number, ...names: string[]): SessionAction => ({
    type: 'checkIn',
    players: names.map((name) => ({ name, skill: 3 })),
    now,
  })
  const running = apply(createSession('doubles', 1), checkInAt(0, 'Ann', 'Bob', 'Cy', 'Di'))

  it('records what happens while paused at the moment it paused', () => {
    const s = apply(running, { type: 'pause', now: 10 * MIN, by: A }, checkInAt(30 * MIN, 'Ed'))
    expect(s.queuedAt?.[5]).toBe(10 * MIN)
    const resumed = apply(s, { type: 'resume', now: 40 * MIN })
    expect(resumed.queuedAt?.[5]).toBe(40 * MIN)
  })

  it('keeps the first pause when two devices pause at once, without dropping the second', () => {
    const club = apply(running, { type: 'pause', now: 10 * MIN, by: A })
    const result = rebase(club, [{ action: { type: 'pause', now: 11 * MIN, by: B } }])
    expect(result.dropped).toEqual([])
    expect(result.session.pausedBy).toEqual(A)
    expect(result.session.clockStoppedAt).toBe(10 * MIN)
  })

  it('keeps the first start when two devices start the session at once, without a warning', () => {
    const notStarted = { ...apply(createSession('doubles', 1), checkInAt(0, 'Ann')), notStarted: true as const, clockStoppedAt: 0 }
    const club = apply(notStarted, { type: 'startClock', now: 5 * MIN, by: A })
    const result = rebase(club, [{ action: { type: 'startClock', now: 6 * MIN, by: B } }])
    expect(result.dropped).toEqual([])
    expect(result.session.startedBy).toEqual(A)
  })

  it('drops a game started here once another device paused, and says why', () => {
    const club = apply(running, { type: 'pause', now: 10 * MIN, by: A })
    const result = rebase(club, [{ action: { type: 'startGame', courtId: 1, now: 11 * MIN } }])
    expect(result.dropped[0].reason).toMatch(/paused/)
    expect(result.session.courts[0].teams).toBeNull()
  })

  it('replays changes made offline after another device paused at the club’s pause time', () => {
    const club = apply(running, { type: 'pause', now: 10 * MIN, by: A })
    const result = rebase(club, [{ action: checkInAt(25 * MIN, 'Ed'), ids: [5] }])
    expect(result.session.queuedAt?.[5]).toBe(10 * MIN)
  })
})
