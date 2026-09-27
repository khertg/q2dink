import { PauseIcon, PlayIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDevice } from '@/lib/device'
import { pausedNoticeFor } from '@/lib/pause'
import { sessionStatus } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

/** A time of day, as the device shows it: "10:42". */
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Where the session's clock stands, for the header: "Not started" or "Paused". Nothing while it runs. */
export function SessionStatusBadge({ session }: { session: SessionState }) {
  const status = sessionStatus(session)
  if (status === 'running') return null
  return (
    <Badge variant="outline" className="border-primary/60">
      {status === 'notStarted' ? 'Not started' : 'Paused'}
    </Badge>
  )
}

/**
 * Run the session: Start session while not started, Resume while paused, Pause while running. No toast: the button
 * and the banner under the header change at once.
 */
export function SessionClockButton({ session }: { session: SessionState }) {
  const status = sessionStatus(session)
  const startClock = useSessionStore((s) => s.startClock)
  const pauseSession = useSessionStore((s) => s.pauseSession)
  const resumeSession = useSessionStore((s) => s.resumeSession)
  if (status === 'notStarted') {
    return (
      <Button
        type="button"
        onClick={startClock}
      >
        <PlayIcon aria-hidden="true" /> Start session
      </Button>
    )
  }
  if (status === 'paused') {
    return (
      <Button
        type="button"
        onClick={resumeSession}
      >
        <PlayIcon aria-hidden="true" /> Resume
      </Button>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      onClick={pauseSession}
    >
      <PauseIcon aria-hidden="true" /> Pause
    </Button>
  )
}

/**
 * Under the header while the clock stands still, on every staff device: what that means, and who paused it
 * and when, so it stays obvious after any dialog is closed.
 */
export function SessionClockBanner({ session }: { session: SessionState }) {
  const status = sessionStatus(session)
  const myId = useDevice((s) => s.id)
  if (status === 'running') return null
  if (status === 'notStarted') {
    return (
      <div role="status" className="rounded-lg border border-primary/40 bg-accent p-3 text-sm text-accent-foreground">
        Not started yet. Check players in and set up courts; waiting times start, and games can begin, once you
        press <span className="font-medium">Start session</span>.
      </div>
    )
  }
  const by = session.pausedBy
  const who = by ? (by.deviceId === myId ? 'this device' : by.name) : null
  const when = session.clockStoppedAt === undefined ? '' : ` at ${clockTime(session.clockStoppedAt)}`
  return (
    <div role="status" className="rounded-lg border border-primary/40 bg-accent p-3 text-sm text-accent-foreground">
      {who
        ? by?.reason === 'left'
          ? `Paused${when}: ${who} left the session. `
          : `Paused by ${who}${when}. `
        : `Paused${when}. `}
      Waiting and game times stand still and no game starts until it is resumed.
    </div>
  )
}

/**
 * When another staff device pauses the session (or left it and it was paused), say so here straight away, with
 * Resume. Closing it keeps the session paused; the banner stays.
 */
export function PausedByDialog({ session }: { session: SessionState }) {
  const myId = useDevice((s) => s.id)
  const resumeSession = useSessionStore((s) => s.resumeSession)
  // The pause this device already dismissed (a pause is known by when it began).
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const notice = pausedNoticeFor(session, myId, dismissedAt)
  const close = () => setDismissedAt(notice?.at ?? null)

  return (
    <Dialog open={notice !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {notice && (
          <>
            <DialogHeader>
              <DialogTitle>Session paused by {notice.name}</DialogTitle>
              <DialogDescription>
                {notice.left
                  ? `${notice.name} left the session at ${clockTime(notice.at)} and nobody else had it open, so it was paused.`
                  : `${notice.name} paused the session at ${clockTime(notice.at)}.`}{' '}
                Waiting and game times stand still, and no game starts, until someone resumes it.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Keep paused
              </Button>
              <Button
                autoFocus
                onClick={() => {
                  close()
                  resumeSession()
                }}
              >
                <PlayIcon aria-hidden="true" /> Resume
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
