import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { locksBrokenBy } from '@/lib/lockGuard'
import { pairNames, unlockQuestion } from '@/lib/partners'
import type { SessionState } from '@/rotation/types'
import type { SessionAction } from '@/store/actions'

type Pairs = [number, number][]

/**
 * Ask before a change that would end partner locks. `guard(action, what, run)` previews the action: when it ends no
 * lock, `run` goes ahead at once; otherwise staff are asked ("Unlock Ann and Bob?") and `run` only goes ahead on
 * Continue. `run` gets the locks it ends, for its own message. Render `dialog` once in the screen.
 */
export function useLockGuard(session: SessionState) {
  const [asking, setAsking] = useState<{ pairs: Pairs; what: string; run: (pairs: Pairs) => void } | null>(null)

  function guard(action: SessionAction, what: string, run: (pairs: Pairs) => void) {
    const pairs = locksBrokenBy(session, action)
    if (pairs.length === 0) return run([])
    setAsking({ pairs, what, run })
  }

  const names = asking ? pairNames(session, asking.pairs) : ''
  const title = asking ? unlockQuestion(session, asking.pairs) : ''

  const dialog = (
    <Dialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
      <DialogContent>
        {asking && (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {asking.what} ends the partner lock{asking.pairs.length > 1 ? 's' : ''} of {names}. They will no longer
                share a team or wait together.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAsking(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const { run, pairs } = asking
                  setAsking(null)
                  run(pairs)
                }}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )

  return { guard, dialog }
}
