/**
 * A club's skill levels. Players are stored with a rating on a DUPR-style number line (1.0 to 8.0); the scale
 * turns a rating into a level: the last level whose `from` is at or below it. So a club can rename its levels,
 * have more or fewer of them, or move their bounds, and no stored player needs converting.
 */

export const MIN_SCALE_LEVELS = 2
export const MAX_SCALE_LEVELS = 10
export const MIN_RATING = 1
export const MAX_RATING = 8
export const MAX_LEVEL_LABEL_LENGTH = 30
export const MAX_LEVEL_RANGE_LENGTH = 20
export const MAX_LEVEL_DESCRIPTION_LENGTH = 160

export interface SkillScaleLevel {
  /** What staff and players read, e.g. "Intermediate". */
  label: string
  /** The rating range as players know it, e.g. "3.50–3.99". Optional. */
  range?: string
  /** One line saying who belongs here. Optional. */
  description?: string
  /** The lowest rating in this level (the first level takes everything below the second). */
  from: number
}

export interface SkillScale {
  /** Lowest first; `from` strictly increasing. */
  levels: SkillScaleLevel[]
}

/** The default: the suggested DUPR ranges. */
export const DUPR_SCALE: SkillScale = {
  levels: [
    { label: 'Beginner', range: 'NR / < 2.50', from: 1, description: 'New to pickleball; learning basic strokes, serving, scoring, and positioning' },
    { label: 'Novice', range: '2.50–2.99', from: 2.5, description: 'Can play complete games and sustain basic rallies' },
    { label: 'Low Intermediate', range: '3.00–3.49', from: 3, description: 'Developing consistency, placement, and basic strategy' },
    { label: 'Intermediate', range: '3.50–3.99', from: 3.5, description: 'Comfortable with rallies, positioning, and common pickleball tactics' },
    { label: 'Advanced', range: '4.00–4.49', from: 4, description: 'Strong consistency, shot selection, strategy, and competitive experience' },
    { label: 'Elite / Pro', range: '4.50+', from: 4.5, description: 'High-level competitive players' },
  ],
}

/** The USA Pickleball skill ratings (the levels the app used before scales were configurable). */
export const USA_PICKLEBALL_SCALE: SkillScale = {
  levels: [
    { label: 'Beginner', range: '1.0', from: 1 },
    { label: 'Novice', range: '2.0-2.5', from: 2 },
    { label: 'Intermediate', range: '3.0', from: 3 },
    { label: 'Upper Intermediate', range: '3.5', from: 3.5 },
    { label: 'Advanced', range: '4.0-4.5', from: 4 },
    { label: 'Expert', range: '5.0+', from: 5 },
  ],
}

export const SCALE_PRESETS = [
  { id: 'dupr', name: 'Suggested DUPR', scale: DUPR_SCALE },
  { id: 'usap', name: 'USA Pickleball', scale: USA_PICKLEBALL_SCALE },
] as const

/**
 * The rating a player saved before scales existed gets, from their level 1 to 6: under the default DUPR scale they
 * keep the same level.
 */
export const LEGACY_LEVEL_RATINGS = [1, 2.5, 3, 3.5, 4, 4.5] as const

/** A level 1 to 6 from before scales existed, as a rating. */
export function ratingForLegacyLevel(level: number): number {
  const index = Math.min(Math.max(Math.round(level), 1), LEGACY_LEVEL_RATINGS.length) - 1
  return LEGACY_LEVEL_RATINGS[index]
}

/** A rating as the default DUPR scale's level 1 to 6: what older apps, which only know six levels, are sent. */
export const legacyLevelForRating = (rating: number) => levelForRating(DUPR_SCALE, rating)

/** The level (1-based) of this rating on the scale: the last level whose `from` is at or below it; 1 for none. */
export function levelForRating(scale: SkillScale, rating: number | null | undefined): number {
  if (rating === null || rating === undefined || !Number.isFinite(rating)) return 1
  let level = 1
  scale.levels.forEach((l, index) => {
    if (rating >= l.from) level = index + 1
  })
  return level
}

/** The rating a player gets when staff choose this level (1-based) for them: where the level starts. */
export function ratingForLevel(scale: SkillScale, level: number): number {
  const index = Math.min(Math.max(Math.round(level), 1), scale.levels.length) - 1
  return scale.levels[index].from
}

export const isRating = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_RATING && v <= MAX_RATING

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optionalText = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max)
const cleanText = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined)

/**
 * A clean copy of a scale if it is well formed (2 to 10 levels, each named, `from` a rating and strictly
 * increasing), otherwise null. Only the known fields are kept.
 */
export function parseSkillScale(raw: unknown): SkillScale | null {
  if (!isObject(raw) || !Array.isArray(raw.levels)) return null
  const levels = raw.levels
  if (levels.length < MIN_SCALE_LEVELS || levels.length > MAX_SCALE_LEVELS) return null
  const copy: SkillScaleLevel[] = []
  for (const level of levels) {
    if (!isObject(level)) return null
    const label = cleanText(level.label)
    if (!label || label.length > MAX_LEVEL_LABEL_LENGTH) return null
    if (!optionalText(level.range, MAX_LEVEL_RANGE_LENGTH) || !optionalText(level.description, MAX_LEVEL_DESCRIPTION_LENGTH)) {
      return null
    }
    if (!isRating(level.from)) return null
    // Two decimals at most: players are stored with three (the server rounds), so one placed exactly where a level
    // starts must still be at that level when their rating comes back.
    const from = Math.round(level.from * 100) / 100
    if (copy.length > 0 && from <= copy[copy.length - 1].from) return null
    const range = cleanText(level.range)
    const description = cleanText(level.description)
    copy.push({ label, ...(range ? { range } : {}), ...(description ? { description } : {}), from })
  }
  return { levels: copy }
}

/** Whether two scales are the same (the same levels, in the same order, with the same words and bounds). */
export function sameScale(a: SkillScale, b: SkillScale): boolean {
  const key = (s: SkillScale) => JSON.stringify(s.levels.map((l) => [l.label, l.range ?? '', l.description ?? '', l.from]))
  return key(a) === key(b)
}
