import { DEFAULT_CALLOUT_VOICE, type CalloutTexts, type CalloutVoice } from '@q2dink/shared'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useClubAuth } from '@/cloud/auth'

/** The club's call-out settings: which voice, its ElevenLabs voice (null: the default) and its own wording. */
export interface ClubVoice {
  voice: CalloutVoice
  voiceId: string | null
  texts: CalloutTexts
}

const DEFAULTS: ClubVoice = { voice: DEFAULT_CALLOUT_VOICE, voiceId: null, texts: {} }

const same = (a: ClubVoice, b: ClubVoice) =>
  a.voice === b.voice && a.voiceId === b.voiceId && JSON.stringify(a.texts) === JSON.stringify(b.texts)

/**
 * The club's call-out settings on this device: the club's, or a change made here not yet sent (`pending`). Kept in
 * localStorage so it works offline, for the club it belongs to only (as the skill levels in skillScaleStore.ts).
 */
interface ClubVoiceStore extends ClubVoice {
  /** The club this is for. Missing until a club's choice is known or made here. */
  clubSlug?: string
  /** The club's server has an ElevenLabs key (missing: not known yet). */
  elevenLabs?: boolean
  /** Changed here and not yet sent to the club. */
  pending: boolean
  /** Staff chose here; sent to the club with the next sync. */
  setLocal: (settings: ClubVoice, clubSlug: string | undefined) => void
  /** The club's settings as another device left them (unless a change made here for this club is still waiting). */
  takeClub: (settings: ClubVoice, elevenLabs: boolean, clubSlug: string) => void
  /** The club has these settings now. */
  markSent: (settings: ClubVoice, elevenLabs: boolean) => void
}

const pick = ({ voice, voiceId, texts }: ClubVoice): ClubVoice => ({ voice, voiceId, texts: texts ?? {} })

export const useClubVoiceStore = create<ClubVoiceStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      pending: false,
      setLocal: (settings, clubSlug) =>
        set((s) => ({ ...pick(settings), clubSlug, pending: true, elevenLabs: s.clubSlug === clubSlug ? s.elevenLabs : undefined })),
      takeClub: (settings, elevenLabs, clubSlug) =>
        set((s) => (s.pending && s.clubSlug === clubSlug ? { elevenLabs } : { ...pick(settings), elevenLabs, clubSlug, pending: false })),
      markSent: (settings, elevenLabs) =>
        set((s) => (same(pick(s), pick(settings)) ? { pending: false, elevenLabs } : { elevenLabs })),
    }),
    { name: 'q2dink-voice', storage: createJSONStorage(() => localStorage) },
  ),
)

/** This club's call-out settings. Another club's kept on the device never count. */
export function clubVoiceFor(clubSlug: string | undefined): ClubVoice {
  const state = useClubVoiceStore.getState()
  return state.clubSlug !== undefined && state.clubSlug === clubSlug ? pick(state) : DEFAULTS
}

/** The signed-in club's call-out settings, and whether its server has ElevenLabs (undefined: not known yet). */
export function useClubVoice(): ClubVoice & { elevenLabs: boolean | undefined } {
  const slug = useClubAuth((s) => s.club?.slug)
  const voice = useClubVoiceStore((s) => s.voice)
  const voiceId = useClubVoiceStore((s) => s.voiceId)
  const texts = useClubVoiceStore((s) => s.texts)
  const owner = useClubVoiceStore((s) => s.clubSlug)
  const elevenLabs = useClubVoiceStore((s) => s.elevenLabs)
  const ours = owner !== undefined && owner === slug
  return ours ? { voice, voiceId, texts: texts ?? {}, elevenLabs } : { ...DEFAULTS, elevenLabs: undefined }
}
