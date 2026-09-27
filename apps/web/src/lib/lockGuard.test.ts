import { describe, expect, it } from 'vitest'
import { checkIn, checkOut, createSession, lockPartners, nextGroup, startGame } from '@/rotation/engine'
import { fillCourts } from '@/rotation/testing'
import type { SessionState } from '@/rotation/types'
import { locksBrokenBy } from './lockGuard'

function withPlayers(count: number, courts = 1): SessionState {
  let s = createSession('doubles', courts)
  for (let id = 1; id <= count; id++) s = checkIn(s, { id, name: `P${id}`, skill: 3 })
  return s
}

/** Court 1 in play with a locked pair on it (the first two of Blue), the rest waiting. */
function lockedOnCourt(count = 8) {
  const s = startGame(withPlayers(count), 1, { now: 0 })
  const [a, b] = s.courts[0].teams![0]
  return { s: lockPartners(s, a, b), a, b }
}

describe('locksBrokenBy: what would end a lock (asked first)', () => {
  it('row 19/20: taking a locked player off a court, to the queue or on a break', () => {
    const { s, a, b } = lockedOnCourt()
    for (const onBreak of [false, true]) {
      expect(locksBrokenBy(s, { type: 'removeFromCourt', courtId: 1, playerId: a, onBreak, now: 1 })).toEqual([[a, b]])
    }
  })

  it('row 21: swapping a locked player out on a court', () => {
    const { s, a, b } = lockedOnCourt()
    expect(locksBrokenBy(s, { type: 'replacePlayer', courtId: 1, outId: a, inId: s.queue[0], now: 1 })).toEqual([[a, b]])
  })

  it('row 22: swapping a locked waiting player in keeps their lock (their partner then holds for them)', () => {
    let s = startGame(withPlayers(8), 1, { now: 0 })
    const [x, y] = s.queue
    s = lockPartners(s, x, y)
    const out = s.courts[0].teams![0][0]
    expect(locksBrokenBy(s, { type: 'replacePlayer', courtId: 1, outId: out, inId: x, now: 1 })).toEqual([])
  })

  it('row 23: trading places between two courts', () => {
    let s = fillCourts(withPlayers(8, 2))
    const [a, b] = s.courts[0].teams![0]
    s = lockPartners(s, a, b)
    const other = s.courts[1].teams![0][0]
    expect(locksBrokenBy(s, { type: 'replacePlayer', courtId: 1, outId: a, inId: other, now: 1 })).toEqual([[a, b]])
  })

  it('row 24: taking a player out of Next up ends their lock and the stand-in’s', () => {
    let s = withPlayers(8)
    const group = nextGroup(s)!.players
    const standIn = s.queue.find((id) => !group.includes(id))!
    const lonely = s.queue.find((id) => !group.includes(id) && id !== standIn)!
    // Both locks wait (a partner on a break) so nobody moves in the queue.
    s = lockPartners(checkOut(s, 8), group[0], 8)
    s = lockPartners(s, standIn, lonely === 8 ? s.queue.at(-1)! : lonely)
    const broken = locksBrokenBy(s, { type: 'dropFromNextUp', playerId: group[0], onBreak: false })
    expect(broken.map((pair) => pair.slice().sort())).toContainEqual([group[0], 8].sort())
    expect(broken.some((pair) => pair.includes(standIn))).toBe(true)
  })

  it('row 25: swapping someone into Next up', () => {
    let s = withPlayers(6)
    const [first] = nextGroup(s)!.players
    s = lockPartners(checkOut(s, 6), first, 6)
    expect(locksBrokenBy(s, { type: 'replaceNextUp', outId: first, inId: 5 })).toEqual([[first, 6]])
  })

  it('row 26: removing a locked player from the session', () => {
    const { s, a, b } = lockedOnCourt()
    expect(locksBrokenBy(s, { type: 'removePlayer', playerId: a, now: 1 })).toEqual([[a, b]])
  })

  it('rows 15, 27, 29: a game ending, a break, and an explicit unlock ask nothing', () => {
    const { s, a } = lockedOnCourt()
    expect(locksBrokenBy(s, { type: 'recordScore', courtId: 1, scoreA: 11, scoreB: 3, now: 1 })).toEqual([])
    expect(locksBrokenBy(s, { type: 'unlockPartners', playerId: a })).toEqual([])
    const waiting = lockPartners(withPlayers(4), 1, 2)
    expect(locksBrokenBy(waiting, { type: 'checkOut', playerId: 1 })).toEqual([])
  })

  it('a change that no longer applies ends nothing', () => {
    const { s, a } = lockedOnCourt()
    expect(locksBrokenBy(s, { type: 'removeFromCourt', courtId: 2, playerId: a, onBreak: false, now: 1 })).toEqual([])
  })
})
