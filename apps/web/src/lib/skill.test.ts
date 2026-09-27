import { USA_PICKLEBALL_SCALE, type SkillScale } from '@q2dink/shared'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCALE,
  countBySkill,
  defaultLevel,
  levelLabel,
  levelOnScale,
  levelsOf,
  ratingOf,
  sessionScale,
  skillLabel,
  skillOptionLabel,
} from './skill'

const FOUR: SkillScale = {
  levels: [
    { label: 'Social', from: 1 },
    { label: 'Club', from: 3 },
    { label: 'Strong', from: 4 },
    { label: 'Pro', from: 5, range: '5.0+' },
  ],
}

describe('skill levels from a scale', () => {
  it('are the suggested DUPR ranges by default, from Beginner up to Elite / Pro', () => {
    expect(levelsOf(DEFAULT_SCALE).map((s) => [s.value, s.label, s.rating])).toEqual([
      [1, 'Beginner', 'NR / < 2.50'],
      [2, 'Novice', '2.50–2.99'],
      [3, 'Low Intermediate', '3.00–3.49'],
      [4, 'Intermediate', '3.50–3.99'],
      [5, 'Advanced', '4.00–4.49'],
      [6, 'Elite / Pro', '4.50+'],
    ])
    expect(levelsOf(DEFAULT_SCALE)[0].description).toMatch(/^New to pickleball/)
  })

  it('name any scale’s levels, with "from N+" when a level has no range text', () => {
    expect(levelsOf(FOUR).map((s) => s.rating)).toEqual(['1.00+', '3.00+', '4.00+', '5.0+'])
    expect(skillLabel(FOUR, 2)).toBe('Club')
    expect(skillLabel(USA_PICKLEBALL_SCALE, 6)).toBe('Expert')
    expect(skillLabel(FOUR, 5)).toBe('Unknown')
  })

  it('show the range in the picker', () => {
    expect(skillOptionLabel(levelsOf(DEFAULT_SCALE)[2])).toBe('3 · Low Intermediate (3.00–3.49)')
  })

  it('start new players in the middle of the scale', () => {
    expect(defaultLevel(DEFAULT_SCALE)).toBe(3)
    expect(defaultLevel(FOUR)).toBe(2)
  })

  it('are the default ones for a session from before scales existed', () => {
    expect(sessionScale({})).toBe(DEFAULT_SCALE)
    expect(sessionScale({ skillScale: FOUR })).toBe(FOUR)
  })
})

describe('a saved player’s level', () => {
  it('comes from their rating, or from their level 1 to 6 when they have none yet', () => {
    expect(ratingOf({ skill: 4 })).toBe(3.5)
    expect(ratingOf({ skill: 4, rating: 3.742 })).toBe(3.742)
    expect(levelOnScale(DEFAULT_SCALE, { skill: 4 })).toBe(4)
    expect(levelOnScale(FOUR, { skill: 4 })).toBe(2) // 3.5 is "Club" on the four-level scale
    expect(levelOnScale(FOUR, { skill: 1, rating: 5.2 })).toBe(4)
  })
})

describe('levelLabel', () => {
  it('names a court’s range in ratings, from where its lowest level starts to where its highest ends', () => {
    expect(levelLabel(DEFAULT_SCALE, [4, 6])).toBe('3.50+')
    expect(levelLabel(DEFAULT_SCALE, [1, 3])).toBe('Up to 3.49')
    expect(levelLabel(DEFAULT_SCALE, [2, 4])).toBe('2.50–3.99')
    expect(levelLabel(DEFAULT_SCALE, [3, 3])).toBe('3.00–3.49')
    expect(levelLabel(FOUR, [2, 3])).toBe('3.00–4.99')
  })

  it('is null for any level: no range, or the whole scale', () => {
    expect(levelLabel(DEFAULT_SCALE, undefined)).toBeNull()
    expect(levelLabel(DEFAULT_SCALE, [1, 6])).toBeNull()
    expect(levelLabel(FOUR, [1, 4])).toBeNull()
  })
})

describe('countBySkill', () => {
  const players = { 1: { skill: 3 }, 2: { skill: 5 }, 3: { skill: 3 }, 4: { skill: 1 } }

  it('counts players per level, lowest level first, leaving out levels with nobody', () => {
    expect(countBySkill(DEFAULT_SCALE, [2, 1, 3, 4], players)).toEqual([
      { level: 1, count: 1 },
      { level: 3, count: 2 },
      { level: 5, count: 1 },
    ])
  })

  it('is empty for nobody, and skips unknown players and levels the scale does not have', () => {
    expect(countBySkill(DEFAULT_SCALE, [], players)).toEqual([])
    expect(countBySkill(DEFAULT_SCALE, [99, 2], players)).toEqual([{ level: 5, count: 1 }])
    expect(countBySkill(FOUR, [2, 1], players)).toEqual([{ level: 3, count: 1 }])
  })
})
