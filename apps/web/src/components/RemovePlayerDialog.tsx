import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { removalNotice } from '@/lib/removal'
import type { SessionState } from '@/rotation/types'

interface Props {
  session: SessionState
  /** The player to remove; the dialog is open while this is set. */
  playerId: number | null
  onClose: () => void
  onConfirm: (playerId: number) => void
}

/** Asks before taking a player out of the session, saying what happens to their results and spot. */
export function RemovePlayerDialog({ session, playerId, onClose, onConfirm }: Props) {
  const player = playerId === null ? undefined : session.players[playerId]
  return (
    <Dialog open={player !== undefined} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {player && (
          <>
            <DialogHeader>
              <DialogTitle>Remove {player.name} from the session?</DialogTitle>
              <DialogDescription>{removalNotice(session, player.id)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onConfirm(player.id)
                  onClose()
                }}
              >
                Remove
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
