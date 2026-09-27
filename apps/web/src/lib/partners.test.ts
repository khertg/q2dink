import { describe, expect, it } from 'vitest'
import { checkIn, checkOut, createSession, lockPartners, removePlayer, startGame } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { lockCandidates, lockedMessage, lockedPartner, lockExplanation } from './partners'

function withPlayers(count: number): SessionState {
  let s = createSession('doubles', 1)
  for (let id = 1; id <= count; id++) s = checkIn(s, { id, name: `P${id}`, skill: 3 })
  return s
}

describe('lockedPartner', () => {
  it('names the partner of a lock in force or still waiting, and nothing for someone unlocked', () => {
    let s = lockPartners(withPlayers(4), 1, 2)
    s = lockPartners(checkOut(s, 3), 3, 4)
    expect(lockedPartner(s, 2)).toEqual({ partnerId: 1, waiting: false })
    expect(lockedPartner(s, 4)).toEqual({ partnerId: 3, waiting: true })
    expect(lockedPartner(withPlayers(2), 1)).toBeUndefined()
  })
})

describe('lockCandidates', () => {
  it('is everyone still in the session who is not locked, never the player themselves', () => {
    let s = lockPartners(withPlayers(6), 1, 2)
    s = removePlayer(s, 6)
    expect(lockCandidates(s, 3)).toEqual([4, 5])
    expect(lockCandidates(s, 1)).toEqual([]) // already locked
  })

  it('includes players on a court and on a break', () => {
    let s = startGame(withPlayers(6), 1, { now: 0 })
    s = checkOut(s, s.queue[0])
    const waiting = s.queue[0]
    expect(lockCandidates(s, waiting).sort()).toEqual([1, 2, 3, 4, 5, 6].filter((id) => id !== waiting))
  })
})

describe('lockExplanation and lockedMessage', () => {
  it('say nothing to confirm and "now partners" when both are waiting', () => {
    const s = withPlayers(2)
    expect(lockExplanation(s, 1, 2)).toBeNull()
    expect(lockedMessage(s, 1, 2)).toBe('P1 and P2 are now partners')
  })

  it('say where the away partner is, who keeps their place, and when the lock starts', () => {
    const s = startGame(withPlayers(5), 1, { now: 0 })
    const [playing] = s.courts[0].teams![0]
    const waiting = s.queue[0]
    expect(lockExplanation(s, waiting, playing)).toBe(
      `P${playing} is playing on Court 1. P${waiting} keeps their place in line. The lock starts once both of them have finished a game.`,
    )
    expect(lockedMessage(s, waiting, playing)).toBe(`P${waiting} and P${playing} will be partners once both have finished a game`)
  })

  it('say each keeps their own place when both are away', () => {
    const s = checkOut(checkOut(withPlayers(2), 1), 2)
    expect(lockExplanation(s, 1, 2)).toBe(
      'P1 is on a break and P2 is on a break. Each keeps their own place in line. The lock starts once both of them have finished a game.',
    )
  })
})
