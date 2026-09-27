import { useState } from 'react'
import { toast } from 'sonner'
import { MedalBadge } from '@/components/MedalBadge'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { recordAudit } from '@/cloud/audit'
import { useClubAuth } from '@/cloud/auth'
import { cloud } from '@/cloud/client'
import { newBatchId } from '@/cloud/id'
import { toLifetimePlayers } from '@/cloud/lifetime'
import { flushPendingLifetime, syncHistory } from '@/cloud/sync'
import { archiveSession } from '@/db/history'
import { saveLifetimeStats } from '@/db/lifetime'
import { lifetimeTotals } from '@/rotation/lifetime'
import { rankPlayers } from '@/rotation/standings'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

interface EndSessionDialogProps {
  session: SessionState
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EndSessionDialog({ session, open, onOpenChange }: EndSessionDialogProps) {
  const endSession = useSessionStore((s) => s.endSession)
  const [saving, setSaving] = useState(false)
  const podium = rankPlayers(session).filter((row) => row.medal)

  /**
   * End the session. The session is always kept under Past sessions; `saveResults` also adds its
   * games to the all-time totals. A resumed session only adds what it has played since.
   */
  async function finish(saveResults: boolean) {
    setSaving(true)
    const store = useSessionStore.getState()
    const { sessionId, startedAt, location } = store
    let clubUpdated = true

    if (saveResults) {
      try {
        await saveLifetimeStats(session, store.lifetimeCounted, useClubAuth.getState().club?.slug)

        // Also add to the club leaderboard when signed in. It is queued first, so a
        // dropped connection never loses it; it is sent again when back online.
        const club = useClubAuth.getState().club
        const players = toLifetimePlayers(session, store.lifetimeCounted)
        if (cloud && club && players.length > 0) {
          useClubAuth.getState().enqueueLifetime({ batchId: newBatchId(), slug: club.slug, players })
          clubUpdated = await flushPendingLifetime()
        }
        // Remember it now, so trying again after a later failure can never count these games twice.
        store.markLifetimeCounted(lifetimeTotals(session))
      } catch {
        toast.error('Could not save the results. The session is still open.')
        setSaving(false)
        return
      }
    }

    const lifetimeCounted = useSessionStore.getState().lifetimeCounted
    let record
    try {
      record = await archiveSession({
        id: sessionId,
        location,
        startedAt,
        session,
        lifetimeCounted,
        // The club it belongs to (the one signed in, since another club's session is never open).
        clubSlug: useSessionStore.getState().clubSlug ?? useClubAuth.getState().club?.slug,
      })
    } catch {
      toast.error('Could not keep a copy of the session, so it is still open. Try again.')
      setSaving(false)
      return
    }

    recordAudit(
      'sessionEnded',
      saveResults ? `Ended “${location}” and saved the results to the all-time totals` : `Ended “${location}”`,
      sessionId,
    )
    endSession()
    void syncHistory()
    const message = !saveResults
      ? 'Session ended'
      : clubUpdated
        ? 'Session saved to the all-time leaderboard'
        : 'Saved on this device. The club leaderboard will update when you are back online.'
    toast(message, {
      duration: 30_000,
      action: {
        label: 'Resume',
        onClick: () => {
          useSessionStore
            .getState()
            .loadSession(location, session, { sessionId, startedAt, lifetimeCounted, endedAt: record?.endedAt })
          recordAudit('sessionResumed', `Resumed “${location}”`, sessionId)
        },
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>End this session?</DialogTitle>
          <DialogDescription>
            {podium.length > 0
              ? 'Final top players. Ending saves the results to everyone’s all-time totals, and you can still resume this session later from Past sessions.'
              : 'Nothing is lost: you can look at it or resume it later from Past sessions. Your saved player list is kept.'}
          </DialogDescription>
        </DialogHeader>

        {podium.length > 0 && (
          <ol className="divide-y rounded-lg border">
            {podium.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-6 text-sm text-muted-foreground">{row.rank}</span>
                <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
                  <PlayerAvatar name={row.name} size="sm" />
                  <span className="min-w-0 truncate">{row.name}</span>
                  <MedalBadge medal={row.medal} />
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {row.wins}W {row.losses}L
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* Stacked on every screen size: long buttons do not fit side by side. */}
        <DialogFooter className="sm:flex-col-reverse">
          <DialogClose asChild>
            <Button variant="outline" className="w-full">
              Keep playing
            </Button>
          </DialogClose>
          {podium.length > 0 ? (
            <Button className="w-full" onClick={() => finish(true)} disabled={saving}>
              {saving ? 'Saving…' : 'Save and end session'}
            </Button>
          ) : (
            <Button variant="destructive" className="w-full" onClick={() => finish(false)} disabled={saving}>
              End session
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
