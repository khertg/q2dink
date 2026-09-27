import type { SkillLevel } from '@/db/db'
import { partnerOf } from '@/matchmaking/grouping'
import type { Court, SessionState } from './types'

/**
 * Skill levels per court. A court can be kept for a range of levels (min, max), for example 4 to 6.
 * Courts with the same range share one "lane": one group waiting for them, drawn only from the players
 * in range. Courts with no range share the "any level" lane, which comes last so that the level courts
 * get first pick of their own players and everyone else still plays.
 */

export type LevelRange = [SkillLevel, SkillLevel]

const MIN_LEVEL = 1

/**
 * A valid range on a scale of `maxLevel` levels, or undefined for "any level" (which is also what the whole scale
 * means).
 */
export function normalizeLevels(levels: readonly number[] | null | undefined, maxLevel: number): LevelRange | undefined {
  if (!levels) return undefined
  const [min, max] = levels
  const valid = (n: number) => Number.isInteger(n) && n >= MIN_LEVEL && n <= maxLevel
  if (levels.length !== 2 || !valid(min) || !valid(max) || min > max) {
    throw new RangeError(`Choose a level range from 1 to ${maxLevel}, lowest first.`)
  }
  if (min === MIN_LEVEL && max === maxLevel) return undefined
  return [min as SkillLevel, max as SkillLevel]
}

export const levelsKey = (levels: LevelRange | undefined) => (levels ? `${levels[0]}-${levels[1]}` : 'any')

export const sameLevels = (a: LevelRange | undefined, b: LevelRange | undefined) => levelsKey(a) === levelsKey(b)

export const inLevels = (skill: number, levels: LevelRange | undefined) =>
  !levels || (skill >= levels[0] && skill <= levels[1])

/** Whether any court is kept for a range of levels. Without one, everything works as a single queue. */
export const hasLevelCourts = (state: Pick<SessionState, 'courts'>) => state.courts.some((c) => c.levels)

/** Each distinct range, in board order of its first court; "any level" last, if any court has none. */
export function lanesOf(courts: Court[]): (LevelRange | undefined)[] {
  const lanes: LevelRange[] = []
  for (const court of courts) {
    if (court.levels && !lanes.some((l) => sameLevels(l, court.levels))) lanes.push(court.levels)
  }
  return courts.some((c) => !c.levels) ? [...lanes, undefined] : lanes
}

/**
 * The queue as one lane sees it: players in range, in queue order, leaving out anyone already taken by
 * an earlier lane. A locked pair plays together or not at all, so a player whose waiting partner is
 * left out (out of range or taken) is left out too.
 */
export function laneQueue(state: SessionState, levels: LevelRange | undefined, taken: ReadonlySet<number>): number[] {
  const fits = (id: number) => !taken.has(id) && inLevels(state.players[id]?.skill ?? 0, levels)
  return state.queue.filter((id) => {
    if (!fits(id)) return false
    const partner = partnerOf(state.partners, id)
    return partner === undefined || !state.queue.includes(partner) || fits(partner)
  })
}
