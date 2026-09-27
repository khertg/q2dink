import {
  DUPR_SCALE,
  levelForRating,
  ratingForLegacyLevel,
  ratingForLevel,
  type SkillScale,
} from '@q2dink/shared'
import type { SkillLevel } from '@/db/db'
import type { SessionState } from '@/rotation/types'

/**
 * Skill levels come from a scale (see packages/shared/src/skillScale.ts): the club's, or the one a session was
 * created with. Level 1 is the scale's first (lowest) level. The default is the suggested DUPR ranges.
 */
export const DEFAULT_SCALE = DUPR_SCALE

/** One level of a scale, as the pickers and badges show it. */
export interface SkillLevelInfo {
  value: SkillLevel
  label: string
  /** The rating range as players know it (the scale's text, or "from N+"). */
  rating: string
  description?: string
}

const formatRating = (rating: number) => rating.toFixed(2)

/** The levels of a scale, lowest first. */
export function levelsOf(scale: SkillScale): SkillLevelInfo[] {
  return scale.levels.map((level, index) => ({
    value: index + 1,
    label: level.label,
    rating: level.range ?? `${formatRating(level.from)}+`,
    ...(level.description ? { description: level.description } : {}),
  }))
}

/** How many levels the scale has: the highest level. */
export const levelCount = (scale: SkillScale) => scale.levels.length

/** The scale a session uses: its own, or the default for a session from before scales existed. */
export const sessionScale = (session: Pick<SessionState, 'skillScale'>): SkillScale => session.skillScale ?? DEFAULT_SCALE

/** The level a new player starts at: the middle of the scale (Low Intermediate on the default one). */
export const defaultLevel = (scale: SkillScale): SkillLevel => Math.ceil(levelCount(scale) / 2)

export const skillLabel = (scale: SkillScale, skill: SkillLevel) => scale.levels[skill - 1]?.label ?? 'Unknown'

/** The level as a picker shows it, for example "3 · Low Intermediate (3.00–3.49)". */
export const skillOptionLabel = (level: SkillLevelInfo) => `${level.value} · ${level.label} (${level.rating})`

/**
 * A player's rating: the one saved, or, for a player saved before ratings existed, the one their level 1 to 6
 * stands for (it keeps them at that level on the default scale).
 */
export const ratingOf = (player: { rating?: number; skill: SkillLevel }) => player.rating ?? ratingForLegacyLevel(player.skill)

/** A saved player's level on this scale. */
export const levelOnScale = (scale: SkillScale, player: { rating?: number; skill: SkillLevel }) =>
  levelForRating(scale, ratingOf(player))

export { levelForRating, ratingForLevel }

/**
 * A court's level range in ratings, from where its lowest level starts to where its highest one ends:
 * "3.50+" (up to the top level), "Up to 3.49" (from the first level), "2.50–3.99". Null for any level
 * (no range, or the whole scale).
 */
export function levelLabel(scale: SkillScale, levels: readonly [SkillLevel, SkillLevel] | undefined): string | null {
  if (!levels) return null
  const [min, max] = levels
  const top = levelCount(scale)
  if (min <= 1 && max >= top) return null
  const next = scale.levels[max]
  const upper = next ? formatRating(next.from - 0.01) : null
  if (min <= 1) return `Up to ${upper}`
  const low = formatRating(scale.levels[min - 1]?.from ?? 0)
  return upper === null ? `${low}+` : `${low}–${upper}`
}

/** How many of these players are at each level, lowest level first, leaving out levels with nobody. */
export function countBySkill(
  scale: SkillScale,
  ids: readonly number[],
  players: Readonly<Record<number, { skill: SkillLevel } | undefined>>,
): { level: SkillLevel; count: number }[] {
  const counts = new Map<SkillLevel, number>()
  for (const id of ids) {
    const skill = players[id]?.skill
    if (skill !== undefined) counts.set(skill, (counts.get(skill) ?? 0) + 1)
  }
  return levelsOf(scale).flatMap(({ value }) => (counts.get(value) ? [{ level: value, count: counts.get(value)! }] : []))
}
