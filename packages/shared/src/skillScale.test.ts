import { describe, expect, it } from 'vitest'
import {
  DUPR_SCALE,
  legacyLevelForRating,
  levelForRating,
  parseSkillScale,
  ratingForLegacyLevel,
  ratingForLevel,
  sameScale,
  USA_PICKLEBALL_SCALE,
} from './skillScale'

describe('levelForRating', () => {
  it('puts a rating in the last level that starts at or below it, on the DUPR scale', () => {
    expect(levelForRating(DUPR_SCALE, 2.499)).toBe(1)
    expect(levelForRating(DUPR_SCALE, 2.5)).toBe(2)
    expect(levelForRating(DUPR_SCALE, 2.999)).toBe(2)
    expect(levelForRating(DUPR_SCALE, 3)).toBe(3)
    expect(levelForRating(DUPR_SCALE, 3.495)).toBe(3)
    expect(levelForRating(DUPR_SCALE, 3.5)).toBe(4)
    expect(levelForRating(DUPR_SCALE, 4)).toBe(5)
    expect(levelForRating(DUPR_SCALE, 4.5)).toBe(6)
    expect(levelForRating(DUPR_SCALE, 7.9)).toBe(6)
  })

  it('reads no rating, or one below the first level, as the first level', () => {
    expect(levelForRating(DUPR_SCALE, null)).toBe(1)
    expect(levelForRating(DUPR_SCALE, undefined)).toBe(1)
    expect(levelForRating({ levels: [{ label: 'A', from: 2 }, { label: 'B', from: 3 }] }, 1.5)).toBe(1)
  })

  it('works for any number of levels', () => {
    const four = { levels: [{ label: 'A', from: 1 }, { label: 'B', from: 3 }, { label: 'C', from: 4 }, { label: 'D', from: 5 }] }
    expect([2.9, 3, 4.2, 6].map((r) => levelForRating(four, r))).toEqual([1, 2, 3, 4])
  })
})

describe('ratings for levels', () => {
  it('gives a chosen level the rating it starts from, which lands back in that level', () => {
    for (const scale of [DUPR_SCALE, USA_PICKLEBALL_SCALE]) {
      scale.levels.forEach((_, index) => expect(levelForRating(scale, ratingForLevel(scale, index + 1))).toBe(index + 1))
    }
  })

  it('keeps every player saved before scales existed at the same level under the DUPR scale', () => {
    for (let level = 1; level <= 6; level++) {
      expect(levelForRating(DUPR_SCALE, ratingForLegacyLevel(level))).toBe(level)
      expect(legacyLevelForRating(ratingForLegacyLevel(level))).toBe(level)
    }
  })
})

describe('parseSkillScale', () => {
  it('accepts the presets and keeps only the known fields, trimmed', () => {
    expect(parseSkillScale(DUPR_SCALE)).toEqual(DUPR_SCALE)
    const parsed = parseSkillScale({ levels: [{ label: ' A ', from: 1, extra: 1 }, { label: 'B', range: ' ', from: 2 }], x: 1 })
    expect(parsed).toEqual({ levels: [{ label: 'A', from: 1 }, { label: 'B', from: 2 }] })
  })

  it('refuses too few or too many levels, missing names, and bounds that do not go up', () => {
    const level = (from: number) => ({ label: `L${from}`, from })
    expect(parseSkillScale({ levels: [level(1)] })).toBeNull()
    expect(parseSkillScale({ levels: Array.from({ length: 11 }, (_, i) => level(1 + i * 0.5)) })).toBeNull()
    expect(parseSkillScale({ levels: [level(1), { label: ' ', from: 2 }] })).toBeNull()
    expect(parseSkillScale({ levels: [level(2), level(2)] })).toBeNull()
    expect(parseSkillScale({ levels: [level(3), level(2)] })).toBeNull()
    expect(parseSkillScale({ levels: [level(1), level(9)] })).toBeNull()
    expect(parseSkillScale({ levels: [level(1), { label: 'x'.repeat(31), from: 2 }] })).toBeNull()
    expect(parseSkillScale(null)).toBeNull()
  })
})

describe('level bounds', () => {
  it('are kept to two decimals, so a player placed at a level stays there after the server rounds their rating', () => {
    const parsed = parseSkillScale({ levels: [{ label: 'A', from: 1 }, { label: 'B', from: 3.3333 }] })!
    expect(parsed.levels[1].from).toBe(3.33)
    const stored = Math.round(ratingForLevel(parsed, 2) * 1000) / 1000 // numeric(4,3) on the server
    expect(levelForRating(parsed, stored)).toBe(2)
  })

  it('refuse bounds that only differ past two decimals', () => {
    expect(parseSkillScale({ levels: [{ label: 'A', from: 3.001 }, { label: 'B', from: 3.004 }] })).toBeNull()
  })
})

describe('sameScale', () => {
  it('compares the levels, whatever order their fields were written in', () => {
    expect(sameScale(DUPR_SCALE, parseSkillScale(DUPR_SCALE)!)).toBe(true)
    expect(sameScale(DUPR_SCALE, USA_PICKLEBALL_SCALE)).toBe(false)
  })
})
