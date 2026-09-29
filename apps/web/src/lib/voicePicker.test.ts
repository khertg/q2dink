import { DEFAULT_VOICE_ID } from '@q2dink/shared'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ENTRY, entryFor, voiceEntries, voiceIdFor } from './voicePicker'

describe('voiceEntries', () => {
  const options = [
    { id: DEFAULT_VOICE_ID, name: 'Rachel', description: 'calm', paidOnly: false },
    { id: 'adam1', name: 'Adam', description: 'deep', paidOnly: false },
    { id: 'lib1', name: 'Zed', paidOnly: true },
  ]

  it('lists the default first, then the account’s voices, marking the paid ones', () => {
    expect(voiceEntries(options, null)).toEqual([
      { value: DEFAULT_ENTRY, label: 'Rachel (default)' },
      { value: 'adam1', label: 'Adam', hint: 'deep' },
      { value: 'lib1', label: 'Zed', hint: 'Needs a paid ElevenLabs plan' },
    ])
  })

  it('keeps a pasted voice the list does not have, once', () => {
    expect(voiceEntries(options, 'pasted9').at(-1)).toEqual({ value: 'pasted9', label: 'Voice pasted9', hint: 'Pasted voice id' })
    expect(voiceEntries(options, 'adam1')).toHaveLength(3)
    expect(voiceEntries([], 'pasted9').map((e) => e.value)).toEqual([DEFAULT_ENTRY, 'pasted9'])
  })

  it('maps the default voice to no voice id and back', () => {
    expect(entryFor(null)).toBe(DEFAULT_ENTRY)
    expect(entryFor(DEFAULT_VOICE_ID)).toBe(DEFAULT_ENTRY)
    expect(entryFor('adam1')).toBe('adam1')
    expect(voiceIdFor(DEFAULT_ENTRY)).toBeNull()
    expect(voiceIdFor('adam1')).toBe('adam1')
  })
})
