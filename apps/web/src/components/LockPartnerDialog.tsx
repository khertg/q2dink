import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { lockCandidates, lockedMessage, lockExplanation } from '@/lib/partners'
import { playerStatuses } from '@/lib/playerStatus'
import { nextGroups } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

interface Props {
  session: SessionState
  /** The player to find a partner for; the dialog is open while this is set. */
  playerId: number | null
  onClose: () => void
}

/**
 * Lock a partner for one player, from their ⋮ menu: choose who, and confirm first when the lock would wait (one of
 * them is on a court or a break), with the same words as the Partners card.
 */
export function LockPartnerDialog({ session, playerId, onClose }: Props) {
  const lockPartners = useSessionStore((s) => s.lockPartners)
  // The partner chosen, while the lock waits to be confirmed.
  const [chosen, setChosen] = useState<number | null>(null)
  const player = playerId === null ? undefined : session.players[playerId]

  function close() {
    setChosen(null)
    onClose()
  }

  function lock(partnerId: number) {
    if (playerId === null) return
    const message = lockedMessage(session, playerId, partnerId)
    try {
      lockPartners(playerId, partnerId)
      toast(message)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not lock them')
    }
    close()
  }

  function choose(partnerId: number) {
    if (playerId !== null && lockExplanation(session, playerId, partnerId)) setChosen(partnerId)
    else lock(partnerId)
  }

  const places = new Map(playerStatuses(session, nextGroups(session)).map((s) => [s.id, s.label]))
  const candidates = player ? lockCandidates(session, player.id) : []
  const explanation = player && chosen !== null ? lockExplanation(session, player.id, chosen) : null

  return (
    <Dialog open={player !== undefined} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {player &&
          (explanation && chosen !== null ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  Lock {player.name} and {session.players[chosen]?.name}?
                </DialogTitle>
                <DialogDescription>{explanation}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setChosen(null)}>
                  Back
                </Button>
                <Button onClick={() => lock(chosen)}>Lock anyway</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Lock a partner for {player.name}</DialogTitle>
                <DialogDescription>Locked partners always share a team and wait in the queue together.</DialogDescription>
              </DialogHeader>
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one else is free to be locked as a partner.</p>
              ) : (
                <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border" aria-label="Possible partners">
                  {candidates.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                        onClick={() => choose(id)}
                      >
                        <PlayerAvatar name={session.players[id].name} size="sm" />
                        <span className="min-w-0 flex-1 truncate">{session.players[id].name}</span>
                        <span className="text-xs text-muted-foreground">{places.get(id)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={close}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          ))}
      </DialogContent>
    </Dialog>
  )
}
