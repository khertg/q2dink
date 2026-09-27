import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { requestRosterSync } from '@/cloud/sync'
import type { SkillLevel } from '@/db/db'
import { findSavedPlayer, setRosterRating } from '@/db/roster'
import { ratingForLevel, sessionScale, skillLabel } from '@/lib/skill'
import { useSessionStore } from '@/store/session'

/**
 * Changes the skill level of a player in the running session, and on their saved roster entry so
 * they start future sessions at it. Used by every staff view that shows a player's level.
 */
export function useSkillEditor() {
  const session = useSessionStore((s) => s.session)
  const setPlayerSkill = useSessionStore((s) => s.setPlayerSkill)

  return function changeSkill(playerId: number, skill: SkillLevel) {
    const name = session?.players[playerId]?.name ?? 'Player'
    const scale = session ? sessionScale(session) : undefined
    setPlayerSkill(playerId, skill)
    // The saved player goes by name: a session's ids are its own, not this device's roster ids. They keep the rating
    // the level starts at, so they are at this level on the session's scale next time too.
    void findSavedPlayer(useClubAuth.getState().club?.slug, name).then(async (saved) => {
      if (saved && scale) await setRosterRating(saved.id, ratingForLevel(scale, skill))
      requestRosterSync()
    })
    toast(`${name} is now ${scale ? skillLabel(scale, skill) : `level ${skill}`}`)
  }
}
