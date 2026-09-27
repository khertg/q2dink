import { describe, expect, it } from 'vitest'
import type { SkillLevel } from '@/db/db'
import {
  checkIn,
  createSession,
  dropFromNextUp,
  lockPartners,
  nextGroup,
  nextGroups,
  nextUpStandIn,
  replaceNextUp,
  setCourtLevels,
  startGame,
} from './engine'
import { lanesOf, normalizeLevels } from './levels'
import type { SessionState } from './types'

/** Check players in, in this order, with these skill levels; ids count from 1. */
function withSkills(state: SessionState, skills: SkillLevel[]): SessionState {
  return skills.reduce((s, skill, i) => checkIn(s, { id: i + 1, name: `P${i + 1}`, skill }), state)
}

const ids = (group: { players: number[] } | null | undefined) => [...(group?.players ?? [])].sort((a, b) => a - b)

/** Two courts: Court 1 kept for 4 to 6, Court 2 for 1 to 3. */
function split(skills: SkillLevel[], mode: 'doubles' | 'singles' = 'doubles'): SessionState {
  let s = createSession(mode, 2)
  s = setCourtLevels(s, 1, [4, 6])
  s = setCourtLevels(s, 2, [1, 3])
  return withSkills(s, skills)
}

describe('setCourtLevels', () => {
  it('keeps a court for a range, and treats the full 1 to 6 as any level', () => {
    let s = setCourtLevels(createSession('doubles', 2), 1, [4, 6])
    expect(s.courts[0].levels).toEqual([4, 6])
    s = setCourtLevels(s, 1, [1, 6])
    expect(s.courts[0]).not.toHaveProperty('levels')
    s = setCourtLevels(setCourtLevels(s, 1, [2, 2]), 1, null)
    expect(s.courts[0]).not.toHaveProperty('levels')
  })

  it('refuses a range the wrong way round or outside 1 to 6', () => {
    const s = createSession('doubles', 1)
    expect(() => setCourtLevels(s, 1, [5, 3])).toThrow(RangeError)
    expect(() => setCourtLevels(s, 1, [0, 3])).toThrow(RangeError)
    expect(() => setCourtLevels(s, 1, [3, 7])).toThrow(RangeError)
    expect(() => normalizeLevels([2.5, 3], 6)).toThrow(RangeError)
  })

  it('keeps the range after a game on the court', () => {
    let s = split([5, 5, 5, 5])
    s = startGame(s, 1)
    expect(s.courts[0].levels).toEqual([4, 6])
  })
})

describe('lanes', () => {
  it('orders the ranges as the courts are, with any level last', () => {
    let s = createSession('doubles', 3)
    s = setCourtLevels(s, 2, [1, 3])
    s = setCourtLevels(s, 3, [4, 6])
    expect(lanesOf(s.courts)).toEqual([[1, 3], [4, 6], undefined])
  })

  it('without level courts, is the usual next group', () => {
    const s = withSkills(createSession('doubles', 2), [1, 6, 3, 4, 2])
    expect(nextGroups(s)).toEqual([{ levels: undefined, group: nextGroup(s) }])
  })

  it('draws each court’s group only from players in its range, nobody twice', () => {
    // P1..P8: levels 5, 2, 6, 1, 4, 3, 5, 2
    const s = split([5, 2, 6, 1, 4, 3, 5, 2])
    const [high, low] = nextGroups(s)
    expect(ids(high.group)).toEqual([1, 3, 5, 7])
    expect(ids(low.group)).toEqual([2, 4, 6, 8])
    expect(ids(nextGroup(s, { courtId: 1 }))).toEqual([1, 3, 5, 7])
    expect(ids(nextGroup(s, { courtId: 2 }))).toEqual([2, 4, 6, 8])
  })

  it('gives the courts open to any level whoever the level courts did not take', () => {
    let s = createSession('doubles', 2)
    s = setCourtLevels(s, 1, [4, 6])
    s = withSkills(s, [5, 2, 6, 1, 4, 3, 5, 2])
    const [high, any] = nextGroups(s)
    expect(ids(high.group)).toEqual([1, 3, 5, 7])
    expect(ids(any.group)).toEqual([2, 4, 6, 8])
  })

  it('waits, rather than taking players out of range, and the override takes anyone', () => {
    let s = split([5, 2, 6, 1, 4, 3])
    expect(nextGroup(s, { courtId: 1 })).toBeNull()
    expect(() => startGame(s, 1)).toThrow('Not enough players')
    s = startGame(s, 1, { ignoreMode: true })
    expect(s.courts[0].teams!.flat().sort()).toEqual([1, 2, 3, 4])
  })

  it('starts the court’s own group and leaves the other level’s players waiting', () => {
    const s = startGame(split([5, 2, 6, 1, 4, 3, 5, 2]), 2)
    expect(s.courts[1].teams!.flat().sort()).toEqual([2, 4, 6, 8])
    expect(s.queue).toEqual([1, 3, 5, 7])
  })

  it('never splits a locked pair across a range', () => {
    // P1 (5) is locked with P2 (2): neither court's range takes both.
    let s = split([5, 2, 6, 4, 5, 1, 3, 2])
    s = lockPartners(s, 1, 2)
    const [high, low] = nextGroups(s)
    expect(high.group?.players ?? []).not.toContain(1)
    expect(low.group?.players ?? []).not.toContain(2)
  })

  it('works for singles: the first two in range', () => {
    const s = split([5, 2, 1, 6], 'singles')
    const [high, low] = nextGroups(s)
    expect(ids(high.group)).toEqual([1, 4])
    expect(ids(low.group)).toEqual([2, 3])
  })

  it('keeps a hand-picked group in a lane whose range takes it', () => {
    let s = split([5, 2, 6, 1, 4, 3, 5, 2, 6])
    // Swap P9 (6) into the high group in place of P7 (5).
    s = replaceNextUp(s, 7, 9)
    const [high, low] = nextGroups(s)
    expect(ids(high.group)).toEqual([1, 3, 5, 9])
    expect(ids(low.group)).toEqual([2, 4, 6, 8])
    // Starting the other level's court leaves the choice in place.
    s = startGame(s, 2)
    expect(ids(nextGroup(s, { courtId: 1 }))).toEqual([1, 3, 5, 9])
  })

  it('takes a stand-in from the same level range, never from another group', () => {
    // High: 1, 3, 5, 7 next up; 9 waits. Low: 2, 4, 6, 8 next up; 10 waits.
    const s = split([5, 2, 6, 1, 4, 3, 5, 2, 6, 1])
    expect(nextUpStandIn(s, 1)).toBe(9)
    expect(nextUpStandIn(s, 2)).toBe(10)
    const t = dropFromNextUp(s, 2)
    const [high, low] = nextGroups(t)
    expect(ids(low.group)).toEqual([4, 6, 8, 10])
    expect(ids(high.group)).toEqual([1, 3, 5, 7])
  })

  it('keeps a group with someone out of range, as staff chose it, in the lane it came from', () => {
    const s = split([5, 2, 6, 1, 4, 3, 5, 2])
    const [high] = nextGroups(s)
    const picked = replaceNextUp(s, 1, 2)
    const [pickedHigh, pickedLow] = nextGroups(picked)
    expect(pickedHigh.group!.players).toEqual(high.group!.players.map((id) => (id === 1 ? 2 : id)))
    expect(pickedLow.group?.players ?? []).not.toContain(2)
  })
})
