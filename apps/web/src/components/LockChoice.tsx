import { ClockIcon, LockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { lockChoice, lockRule } from '@/lib/partners'
import type { SessionState } from '@/rotation/types'

interface Props {
  session: SessionState
  a: number
  b: number
  /** Wait for 1 game: the lock starts once both have finished a game. */
  onWait: () => void
  /** Lock now: in force at once; the one waiting holds for the other. Also the only button when the lock is at once. */
  onNow: () => void
  onCancel: () => void
  cancelLabel?: string
}

/**
 * What staff read before locking two players (inside a dialog). While one or both are on a court or a break: the
 * choice between waiting for a game and locking now, each saying what it does in the players' names. Otherwise the
 * rule that applies (where they will stand in the queue) and one Lock partners button.
 */
export function LockChoice({ session, a, b, onWait, onNow, onCancel, cancelLabel = 'Cancel' }: Props) {
  const choice = lockChoice(session, a, b)
  const name = (id: number) => session.players[id]?.name ?? 'Player'
  if (!choice) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>
            Lock {name(a)} and {name(b)}?
          </DialogTitle>
          <DialogDescription>{lockRule(session, a, b)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button onClick={onNow}>
            <LockIcon aria-hidden="true" /> Lock partners
          </Button>
        </DialogFooter>
      </>
    )
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Lock {name(a)} and {name(b)}?
        </DialogTitle>
        <DialogDescription>{choice.situation}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1 rounded-lg border p-3">
          <Button variant="outline" className="w-full justify-start" onClick={onWait}>
            <ClockIcon aria-hidden="true" /> Wait for 1 game
          </Button>
          <p className="text-sm text-muted-foreground">{choice.wait}</p>
        </div>
        <div className="space-y-1 rounded-lg border p-3">
          <Button className="w-full justify-start" onClick={onNow}>
            <LockIcon aria-hidden="true" /> Lock now
          </Button>
          <p className="text-sm text-muted-foreground">{choice.now}</p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </DialogFooter>
    </>
  )
}
