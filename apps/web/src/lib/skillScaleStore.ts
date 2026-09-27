import type { SkillScale } from '@q2dink/shared'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { useClubAuth } from '@/cloud/auth'
import { DEFAULT_SCALE } from '@/lib/skill'

/**
 * The club's skill levels on this device: the club's copy, or a change made here not yet sent (`pending`). Kept in
 * localStorage (read at once when a session is created), for the club it belongs to only.
 */
interface ClubScaleStore {
  /** The club these are for. Missing: a build with no cloud, or none signed in when changed. */
  clubSlug?: string
  /** Null: the default scale. */
  scale: SkillScale | null
  /** Changed here and not yet sent to the club. */
  pending: boolean
  /** Staff chose other levels here (null: back to the default); sent to the club with the next sync. */
  setLocal: (scale: SkillScale | null, clubSlug: string | undefined) => void
  /** The club's levels as another device left them (unless a change made here for this club is still waiting). */
  takeClub: (scale: SkillScale | null, clubSlug: string) => void
  /** The club has these levels now. */
  markSent: (scale: SkillScale | null) => void
}

const same = (a: SkillScale | null, b: SkillScale | null) => JSON.stringify(a) === JSON.stringify(b)

export const useClubScale = create<ClubScaleStore>()(
  persist(
    (set) => ({
      scale: null,
      pending: false,
      setLocal: (scale, clubSlug) => set({ scale, clubSlug, pending: true }),
      takeClub: (scale, clubSlug) =>
        set((s) => (s.pending && s.clubSlug === clubSlug ? {} : { scale, clubSlug, pending: false })),
      markSent: (scale) => set((s) => (same(s.scale, scale) ? { pending: false } : {})),
    }),
    { name: 'q2dink-skill-scale', storage: createJSONStorage(() => localStorage) },
  ),
)

/**
 * The skill levels of this club (or, with no club, of this device): what it chose, or the default. Another club's
 * levels kept on the device never count.
 */
export function clubScaleFor(clubSlug: string | undefined): SkillScale {
  const { scale, clubSlug: owner } = useClubScale.getState()
  return scale && owner === clubSlug ? scale : DEFAULT_SCALE
}

/** The signed-in club's skill levels, following changes. */
export function useClubSkillScale(): SkillScale {
  const slug = useClubAuth((s) => s.club?.slug)
  const scale = useClubScale((s) => s.scale)
  const owner = useClubScale((s) => s.clubSlug)
  return scale && owner === slug ? scale : DEFAULT_SCALE
}
