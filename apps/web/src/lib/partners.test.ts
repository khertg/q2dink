import { describe, expect, it } from 'vitest'
import { checkIn, checkOut, createSession, fillNextUpSpot, lockPartners, removePlayer, startGame } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import {
  brokenLocks,
  heldFor,
  lockCandidates,
  lockChoice,
  lockRule,
  lockedMessage,
  lockedPartner,
  lockMarks,
  pairNames,
  unlockedSentence,
  unlockQuestion,
} from './partners'

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

describe('lockChoice and lockedMessage', () => {
  it('offer no choice and say "now partners" when both are waiting', () => {
    const s = withPlayers(2)
    expect(lockChoice(s, 1, 2)).toBeNull()
    expect(lockedMessage(s, 1, 2)).toBe('P1 and P2 are now partners')
  })

  it('say where the away partner is, and what waiting or locking now means, in their names', () => {
    const s = startGame(withPlayers(5), 1, { now: 0 })
    const [playing] = s.courts[0].teams![0]
    const waiting = s.queue[0]
    expect(lockChoice(s, waiting, playing)).toEqual({
      situation: `P${playing} is playing on Court 1.`,
      wait: `P${waiting} keeps their place in line. The lock starts once both of them have finished a game.`,
      now: `P${waiting} waits for P${playing} and plays no game without them. They queue together after P${playing}’s game.`,
    })
    expect(lockedMessage(s, waiting, playing)).toBe(`P${waiting} and P${playing} will be partners once both have finished a game`)
    expect(lockedMessage(s, waiting, playing, true)).toBe(`P${waiting} and P${playing} are now partners, and wait for each other`)
  })

  it('cover a partner on a break, and both away', () => {
    const one = checkOut(withPlayers(2), 2)
    expect(lockChoice(one, 1, 2)?.now).toBe('P1 waits for P2 and plays no game without them. They queue together after P2 is back from the break.')
    const both = checkOut(checkOut(withPlayers(2), 1), 2)
    expect(lockChoice(both, 1, 2)).toMatchObject({
      situation: 'P1 is on a break and P2 is on a break.',
      wait: 'Each keeps their own place in line. The lock starts once both of them have finished a game.',
    })
  })
})

describe('heldFor', () => {
  it('names the partner a held player waits for, and where they are', () => {
    const s = startGame(withPlayers(8), 1, { now: 0 })
    const [bob] = s.courts[0].teams![0]
    const ann = s.queue[0]
    const locked = lockPartners(s, ann, bob, { now: true })
    expect(heldFor(locked, ann)).toEqual({ partner: `P${bob}`, where: 'on Court 1' })
    expect(heldFor(locked, s.queue[1])).toBeUndefined()
    const onBreak = lockPartners(checkOut(withPlayers(4), 4), 1, 4, { now: true })
    expect(heldFor(onBreak, 1)).toEqual({ partner: 'P4', where: 'on a break' })
  })
})

describe('brokenLocks', () => {
  it('lists the locks that are gone, in force or waiting, but not one that came into force', () => {
    const before = { partners: [[1, 2]] as [number, number][], pendingPartners: [{ pair: [3, 4] as [number, number], done: [] }] }
    expect(brokenLocks(before, { partners: [], pendingPartners: undefined })).toEqual([[1, 2], [3, 4]])
    expect(brokenLocks(before, { partners: [[1, 2], [4, 3]], pendingPartners: undefined })).toEqual([])
    expect(pairNames(withPlayers(4), [[1, 2], [3, 4]])).toBe('P1 & P2, P3 & P4')
  })

  it('ask and tell in plain words, built from the names (whatever they contain)', () => {
    const s = checkIn(withPlayers(2), { id: 3, name: 'Jo & Co', skill: 3 })
    expect(unlockQuestion(s, [[3, 1]])).toBe('Unlock Jo & Co and P1?')
    expect(unlockQuestion(s, [[1, 2], [3, 1]])).toBe('Unlock these partners?')
    expect(unlockedSentence(s, [[1, 2]])).toBe('P1 and P2 are no longer locked partners.')
    expect(unlockedSentence(s, [[1, 2], [3, 1]])).toBe('P1 & P2, Jo & Co & P1 are no longer locked partners.')
    expect(unlockedSentence(s, [])).toBe('')
  })
})

describe('lockMarks', () => {
  it('marks both players of a pair with the same colour, and each pair with its own', () => {
    let s = lockPartners(withPlayers(6), 1, 2)
    s = lockPartners(s, 3, 4)
    const marks = lockMarks(s)
    expect(marks.get(1)).toEqual({ partner: 'P2', waiting: false, colour: 1 })
    expect(marks.get(2)).toEqual({ partner: 'P1', waiting: false, colour: 1 })
    expect(marks.get(3)).toEqual({ partner: 'P4', waiting: false, colour: 2 })
    expect(marks.has(5)).toBe(false)
  })

  it('says a lock still waits, after the ones in force', () => {
    let s = lockPartners(withPlayers(4), 1, 2)
    s = lockPartners(checkOut(s, 3), 3, 4)
    expect(lockMarks(s).get(4)).toEqual({ partner: 'P3', waiting: true, colour: 2 })
  })

  it('repeats the colours after six pairs', () => {
    let s = withPlayers(14)
    for (let id = 1; id <= 13; id += 2) s = lockPartners(s, id, id + 1)
    const marks = lockMarks(s)
    expect(marks.get(11)?.colour).toBe(6)
    expect(marks.get(13)?.colour).toBe(1)
  })
})

describe('lockRule: what staff read before a lock that takes effect at once', () => {
  it('says the earlier player moves back to the later one’s spot, so nobody is passed', () => {
    expect(lockRule(withPlayers(8), 2, 7)).toBe(
      'P2 (#2) moves back to stand with P7 (#7), so nobody who is waiting is passed. Locked partners always share a team and wait in the queue together.',
    )
    expect(lockRule(withPlayers(8), 7, 2)).toMatch(/^P2 \(#2\) moves back to stand with P7 \(#7\)/)
    expect(lockRule(withPlayers(8), 3, 4)).toMatch(/^P3 and P4 are already next to each other in the queue \(#3 and #4\)\./)
  })

  it('says a lock between two players in the same game starts now, and they queue together after it', () => {
    const s = startGame(withPlayers(4), 1, { now: 0 })
    const [x, y] = s.courts[0].teams![0]
    expect(lockRule(s, x, y)).toMatch(/^Both are playing on Court 1\. The lock starts now: after this game they queue together\./)
  })

  it('says a hand-picked Next up goes back to automatic when only one of them is in it', () => {
    const s = fillNextUpSpot(withPlayers(8), 0, 0, 2)
    expect(lockRule(s, 2, 7)).toMatch(/passed\. Next up goes back to automatic\. Locked partners/)
    expect(lockRule(withPlayers(8), 2, 7)).not.toMatch(/automatic/)
  })

  it('is null when staff have to choose (one of them away)', () => {
    expect(lockRule(checkOut(withPlayers(4), 2), 1, 2)).toBeNull()
  })
})
