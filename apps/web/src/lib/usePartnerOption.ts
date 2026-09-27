import { toast } from 'sonner'
import type { PartnerOption } from '@/components/partnerItem'
import { lockedPartner } from '@/lib/partners'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

/**
 * The Lock partner… / Unlock option for each player's ⋮ menu, or undefined in singles (no locks there).
 * `openLock` opens the dialog to choose a partner for that player.
 */
export function usePartnerOption(
  session: SessionState,
  openLock: (playerId: number) => void,
): ((playerId: number) => PartnerOption) | undefined {
  const unlockPartners = useSessionStore((s) => s.unlockPartners)
  if (session.mode !== 'doubles') return undefined
  return (playerId) => {
    const locked = lockedPartner(session, playerId)
    const lockedWith = locked ? (session.players[locked.partnerId]?.name ?? 'their partner') : undefined
    return {
      lockedWith,
      onLock: () => openLock(playerId),
      onUnlock: () => {
        unlockPartners(playerId)
        toast(`${session.players[playerId]?.name} and ${lockedWith} are no longer partners`)
      },
    }
  }
}
