import { DEFAULT_VOICE_ID, DEFAULT_VOICE_NAME, type VoiceOption } from '@q2dink/shared'

/** The Select's value for "the default voice" (a club with no voice id). */
export const DEFAULT_ENTRY = 'default'

export interface VoiceEntry {
  /** DEFAULT_ENTRY or a voice id. */
  value: string
  label: string
  /** A few words under the name, including "Needs a paid ElevenLabs plan". */
  hint?: string
}

const PAID_HINT = 'Needs a paid ElevenLabs plan'

/**
 * What the club's voice picker lists: the default voice first, then the account's voices (without the default one
 * again), and the club's own voice id when the list does not have it (pasted, or the list could not be loaded).
 */
export function voiceEntries(options: readonly VoiceOption[], voiceId: string | null): VoiceEntry[] {
  const entries: VoiceEntry[] = [{ value: DEFAULT_ENTRY, label: `${DEFAULT_VOICE_NAME} (default)` }]
  for (const option of options) {
    if (option.id === DEFAULT_VOICE_ID) continue
    const hint = [option.description, option.paidOnly ? PAID_HINT : undefined].filter(Boolean).join(' · ')
    entries.push({ value: option.id, label: option.name, hint: hint || undefined })
  }
  if (voiceId && voiceId !== DEFAULT_VOICE_ID && !entries.some((e) => e.value === voiceId)) {
    entries.push({ value: voiceId, label: `Voice ${voiceId}`, hint: 'Pasted voice id' })
  }
  return entries
}

/** The picker's value for the club's voice id. */
export const entryFor = (voiceId: string | null) => (voiceId && voiceId !== DEFAULT_VOICE_ID ? voiceId : DEFAULT_ENTRY)

/** The voice id to save for a picked entry (null: the default). */
export const voiceIdFor = (value: string) => (value === DEFAULT_ENTRY ? null : value)
