import { DUPR_SCALE, MAX_SCALE_LEVELS } from '@q2dink/shared'
import { describe, expect, it } from 'vitest'
import { addLevel, fromDraft, placements, removeLevel, toDraft } from './skillScaleDraft'

describe('editing a skill scale', () => {
  it('turns a scale into a draft and back', () => {
    expect(fromDraft(toDraft(DUPR_SCALE))).toEqual({ scale: DUPR_SCALE })
  })

  it('adds a level half a rating above the last, up to ten, and keeps at least two', () => {
    const two = toDraft({ levels: [{ label: 'A', from: 1 }, { label: 'B', from: 3 }] })
    expect(addLevel(two)[2]).toEqual({ label: '', from: '3.5', range: '', description: '' })
    let many = two
    for (let i = 0; i < 20; i++) many = addLevel(many)
    expect(many).toHaveLength(MAX_SCALE_LEVELS)
    expect(removeLevel(two, 0)).toBe(two)
    expect(removeLevel(addLevel(two), 1).map((l) => l.label)).toEqual(['A', ''])
  })

  it('says what to fix: a missing name, a rating out of range, or one that does not go up', () => {
    const draft = toDraft({ levels: [{ label: 'A', from: 1 }, { label: 'B', from: 3 }] })
    expect(fromDraft([draft[0], { ...draft[1], label: ' ' }])).toEqual({ error: 'Give level 2 a name.' })
    expect(fromDraft([draft[0], { ...draft[1], from: '9' }])).toEqual({ error: 'Level 2 must start at a rating from 1 to 8.' })
    expect(fromDraft([draft[0], { ...draft[1], from: 'x' }])).toEqual({ error: 'Level 2 must start at a rating from 1 to 8.' })
    expect(fromDraft([draft[0], { ...draft[1], from: '1' }])).toEqual({ error: 'Level 2 must start at a higher rating than level 1.' })
    expect(fromDraft([draft[0], { ...draft[1], label: 'x'.repeat(40) }])).toEqual({ error: 'Names, ranges or descriptions are too long.' })
    expect(fromDraft([draft[0]])).toEqual({ error: 'Use 2 to 10 levels.' })
  })

  it('counts where saved players would land', () => {
    expect(placements(DUPR_SCALE, [2, 3.742, 3.5, 5])).toEqual([1, 0, 0, 2, 0, 1])
  })
})
