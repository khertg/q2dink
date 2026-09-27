import {
  MAX_RATING,
  MAX_SCALE_LEVELS,
  MIN_RATING,
  MIN_SCALE_LEVELS,
  levelForRating,
  parseSkillScale,
  type SkillScale,
} from '@q2dink/shared'

/** A level as the editor holds it: text as typed, checked only when saved. */
export interface DraftLevel {
  label: string
  from: string
  range: string
  description: string
}

export const toDraft = (scale: SkillScale): DraftLevel[] =>
  scale.levels.map((l) => ({ label: l.label, from: String(l.from), range: l.range ?? '', description: l.description ?? '' }))

/** One more level at the top, starting half a rating above the last one (up to the top of the scale). */
export function addLevel(draft: DraftLevel[]): DraftLevel[] {
  if (draft.length >= MAX_SCALE_LEVELS) return draft
  const last = Number(draft[draft.length - 1]?.from)
  const from = Number.isFinite(last) ? Math.min(MAX_RATING, last + 0.5) : MIN_RATING
  return [...draft, { label: '', from: String(from), range: '', description: '' }]
}

export function removeLevel(draft: DraftLevel[], index: number): DraftLevel[] {
  return draft.length <= MIN_SCALE_LEVELS ? draft : draft.filter((_, i) => i !== index)
}

/**
 * The scale the draft describes, or why it cannot be saved, in words staff can act on. The first level's rating is
 * where the scale starts; each next one must start higher.
 */
export function fromDraft(draft: DraftLevel[]): { scale: SkillScale } | { error: string } {
  if (draft.length < MIN_SCALE_LEVELS || draft.length > MAX_SCALE_LEVELS) {
    return { error: `Use ${MIN_SCALE_LEVELS} to ${MAX_SCALE_LEVELS} levels.` }
  }
  for (const [index, level] of draft.entries()) {
    const n = index + 1
    if (level.label.trim() === '') return { error: `Give level ${n} a name.` }
    const from = Number(level.from)
    if (level.from.trim() === '' || !Number.isFinite(from) || from < MIN_RATING || from > MAX_RATING) {
      return { error: `Level ${n} must start at a rating from ${MIN_RATING} to ${MAX_RATING}.` }
    }
    if (index > 0 && from <= Number(draft[index - 1].from)) {
      return { error: `Level ${n} must start at a higher rating than level ${index}.` }
    }
  }
  const scale = parseSkillScale({
    levels: draft.map((l) => ({ label: l.label, from: Number(l.from), range: l.range, description: l.description })),
  })
  return scale ? { scale } : { error: 'Names, ranges or descriptions are too long.' }
}

/** How many of these saved players would be at each level of the scale (lowest first). */
export function placements(scale: SkillScale, ratings: readonly number[]): number[] {
  const counts = scale.levels.map(() => 0)
  for (const rating of ratings) counts[levelForRating(scale, rating) - 1]++
  return counts
}
