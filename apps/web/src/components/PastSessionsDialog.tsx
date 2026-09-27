import { HISTORY_TRASH_DAYS } from '@q2dink/shared'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { toCloudError } from '@/cloud/api'
import { recordAudit } from '@/cloud/audit'
import { useClubAuth } from '@/cloud/auth'
import { cloud } from '@/cloud/client'
import { parseFullBackup } from '@/cloud/snapshot'
import { syncHistory } from '@/cloud/sync'
import { ActivityDialog } from '@/components/ActivityDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  archiveSession,
  followClubDeletion,
  followClubRestore,
  getHistory,
  listDeletedHistory,
  listHistory,
  markHistorySynced,
  purgeExpiredHistory,
  purgeHistoryRecord,
  restoreHistoryRecord,
  softDeleteHistory,
} from '@/db/history'
import { matchmakingLabel } from '@/lib/matchmaking'
import { daysLeft, mergeHistory, type DeletedEntry, type PastEntry } from '@/lib/pastSessions'
import type { LifetimeCounts } from '@/rotation/lifetime'
import type { SessionState } from '@/rotation/types'
import { StandingsScreen } from '@/screens/StandingsScreen'
import { migrateSession } from '@/store/migrate'
import { useSessionStore } from '@/store/session'

interface Loaded {
  id: string
  location: string
  startedAt: number
  endedAt: number
  session: SessionState
  lifetimeCounted: LifetimeCounts
  /** Fetched from the club because this device does not have it. */
  fromClub: boolean
  /** It is in Recently deleted: it can be looked at and restored, not resumed. */
  deleted: boolean
}

/** Sessions listed per page, so a long history stays short to scroll on a phone. */
const PAGE_SIZE = 10

const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * This device's history merged with the club's: the past sessions, and Recently deleted. What another staff
 * device deleted or restored is followed here too. Sessions deleted too long ago are removed for good first.
 */
async function loadEntries(): Promise<{ active: PastEntry[]; deleted: DeletedEntry[]; clubError: string | null }> {
  await purgeExpiredHistory()
  const login = useClubAuth.getState().club
  // Another club's past sessions on this device are never listed.
  const [local, localDeleted] = await Promise.all([listHistory(login?.slug), listDeletedHistory(login?.slug)])
  let clubError: string | null = null
  let club: Awaited<ReturnType<NonNullable<typeof cloud>['listHistory']>> = []
  let clubDeleted: Awaited<ReturnType<NonNullable<typeof cloud>['listDeletedHistory']>> = []
  if (cloud && login) {
    try {
      ;[club, clubDeleted] = await Promise.all([cloud.listHistory(login.token), cloud.listDeletedHistory(login.token)])
    } catch (error) {
      clubError = toCloudError(error).message
    }
  }
  const merged = mergeHistory(local, localDeleted, club, clubDeleted)
  await Promise.all([
    ...merged.deletedElsewhere.map(({ id, deletedAt }) => followClubDeletion(id, deletedAt)),
    ...merged.restoredElsewhere.map((id) => followClubRestore(id)),
  ])
  return { active: merged.active, deleted: merged.deleted, clubError }
}

/** One session in full, from this device or, failing that, from the club. */
async function loadOne(entry: PastEntry, deleted: boolean): Promise<Loaded | null> {
  const record = await getHistory(entry.id)
  if (record) {
    const session = migrateSession(record.session, record.storeVersion)
    if (!session) return null
    return {
      id: record.id,
      location: record.location,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      session,
      lifetimeCounted: record.lifetimeCounted,
      fromClub: false,
      deleted,
    }
  }
  const club = useClubAuth.getState().club
  if (!cloud || !club) return null
  const parsed = parseFullBackup(await cloud.fetchHistory(club.token, entry.id))
  if (!parsed) return null
  return {
    id: entry.id,
    location: parsed.location,
    startedAt: entry.endedAt,
    endedAt: entry.endedAt,
    session: parsed.session,
    lifetimeCounted: parsed.lifetimeCounted,
    fromClub: true,
    deleted,
  }
}

/** Past sessions with their rankings, a way to resume one that ended by accident, and Recently deleted. */
export function PastSessionsDialog() {
  const loadSession = useSessionStore((s) => s.loadSession)
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<PastEntry[] | null>(null)
  const [trash, setTrash] = useState<DeletedEntry[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [clubError, setClubError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Loaded | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** The session waiting for "Delete for good" to be confirmed. */
  const [confirmPurge, setConfirmPurge] = useState<DeletedEntry | null>(null)
  /** The session just deleted, offered back at the top of the list (a toast cannot be tapped behind this window). */
  const [justDeleted, setJustDeleted] = useState<{ id: string; location: string; clubOnly: boolean } | null>(null)
  const [page, setPage] = useState(0)

  const reload = useCallback(async () => {
    const result = await loadEntries()
    setEntries(result.active)
    setTrash(result.deleted)
    setClubError(result.clubError)
    // A delete can empty the last page; step back to the one that is now last.
    setPage((p) => Math.min(p, Math.max(0, Math.ceil(result.active.length / PAGE_SIZE) - 1)))
    if (result.deleted.length === 0) setShowTrash(false)
  }, [])

  function handleOpenChange(next: boolean) {
    // Always start from the first page of the list, never from the session that was open last time.
    setViewing(null)
    setConfirmDelete(false)
    setConfirmPurge(null)
    setJustDeleted(null)
    setShowTrash(false)
    setPage(0)
    setOpen(next)
    if (next) void reload()
  }

  async function handleView(entry: PastEntry, deleted = false) {
    setBusy(true)
    try {
      const loaded = await loadOne(entry, deleted)
      if (loaded) setViewing(loaded)
      else toast.error('This session could not be opened.')
    } catch (error) {
      toast.error(toCloudError(error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleResume(loaded: Loaded) {
    setBusy(true)
    try {
      // A session that came from the club is kept on this device too, so it stays here after resuming.
      if (loaded.fromClub) {
        const clubSlug = useClubAuth.getState().club?.slug
        const saved = await archiveSession({
          id: loaded.id,
          location: loaded.location,
          startedAt: loaded.startedAt,
          session: loaded.session,
          lifetimeCounted: loaded.lifetimeCounted,
          clubSlug,
          now: loaded.endedAt,
        })
        if (saved) await markHistorySynced(saved.id, clubSlug)
      }
      loadSession(loaded.location, loaded.session, {
        sessionId: loaded.id,
        startedAt: loaded.startedAt,
        lifetimeCounted: loaded.lifetimeCounted,
        endedAt: loaded.endedAt,
      })
      recordAudit('sessionResumed', `Resumed “${loaded.location}” from Past sessions`, loaded.id)
      toast(`“${loaded.location}” is running again`)
    } catch {
      toast.error('Could not resume the session.')
      setBusy(false)
    }
  }

  /**
   * Change a session's place: a copy on this device is changed here and the club is told by the next sync
   * (offline too); one only the club has is changed on the club, which needs a connection.
   */
  async function change(
    entry: { id: string; clubOnly: boolean },
    onDevice: () => Promise<void>,
    onClub: (token: string) => Promise<void>,
  ): Promise<boolean> {
    try {
      if (!entry.clubOnly) {
        await onDevice()
        void syncHistory()
        return true
      }
      const login = useClubAuth.getState().club
      if (!cloud || !login) return false
      await onClub(login.token)
      return true
    } catch (error) {
      toast.error(toCloudError(error).message)
      return false
    }
  }

  async function restore(entry: { id: string; location: string; clubOnly: boolean }, quiet = false) {
    setBusy(true)
    try {
      const done = await change(entry, () => restoreHistoryRecord(entry.id), (token) => cloud!.restoreHistory(token, entry.id))
      if (!done) return
      recordAudit('historyRestored', `Restored the past session “${entry.location}”`, entry.id)
      setJustDeleted(null)
      if (!quiet) toast(`“${entry.location}” restored`)
      setViewing(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(loaded: Loaded) {
    setBusy(true)
    const entry = { id: loaded.id, location: loaded.location, clubOnly: loaded.fromClub }
    try {
      const done = await change(entry, () => softDeleteHistory(loaded.id), (token) => cloud!.deleteHistory(token, loaded.id))
      if (!done) return
      recordAudit('historyDeleted', `Moved the past session “${loaded.location}” (ended ${when(loaded.endedAt)}) to Recently deleted`, loaded.id)
      toast('Session deleted')
      setJustDeleted(entry)
      setViewing(null)
      setConfirmDelete(false)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function handlePurge(entry: DeletedEntry) {
    setBusy(true)
    try {
      const tellClub = cloud !== null && useClubAuth.getState().club !== null
      const done = await change(
        entry,
        () => purgeHistoryRecord(entry.id, tellClub),
        (token) => cloud!.deleteHistory(token, entry.id, { permanent: true }),
      )
      if (!done) return
      recordAudit('historyPurged', `Deleted the past session “${entry.location}” for good`, entry.id)
      toast(`“${entry.location}” deleted for good`)
      setConfirmPurge(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const summary = (entry: PastEntry) =>
    `${when(entry.endedAt)} · ${entry.mode === 'doubles' ? 'Doubles' : 'Singles'} · ${plural(entry.players, 'player')} · ${plural(entry.games, 'game')}`

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="w-full">
          Past sessions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {viewing ? (
          <>
            <DialogHeader>
              <DialogTitle>{viewing.location}</DialogTitle>
              <DialogDescription>
                {viewing.deleted ? 'Deleted · ' : ''}Ended {when(viewing.endedAt)} ·{' '}
                {viewing.session.mode === 'doubles' ? 'Doubles' : 'Singles'}
                {viewing.session.mode === 'doubles' ? ` · ${matchmakingLabel(viewing.session.matchmaking)}` : ''}
              </DialogDescription>
            </DialogHeader>
            <StandingsScreen session={viewing.session} location={viewing.location} readOnly repeatStats share />
            {viewing.deleted ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  className="h-11 flex-1"
                  disabled={busy}
                  onClick={() => restore({ id: viewing.id, location: viewing.location, clubOnly: viewing.fromClub })}
                >
                  Restore
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setViewing(null)}>
                  Back
                </Button>
              </div>
            ) : confirmDelete ? (
              <div role="group" aria-label="Confirm deleting this session" className="space-y-2 rounded-lg border p-3">
                <p className="text-sm">
                  Move this session to Recently deleted? It can be restored for {HISTORY_TRASH_DAYS} days.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>
                    Keep it
                  </Button>
                  <Button variant="destructive" disabled={busy} onClick={() => handleDelete(viewing)}>
                    Delete session
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button className="h-11 flex-1" disabled={busy} onClick={() => handleResume(viewing)}>
                  Resume this session
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setViewing(null)}>
                  Back
                </Button>
                <ActivityDialog sessionId={viewing.id} variant="outline" />
                <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
            )}
          </>
        ) : showTrash ? (
          <>
            <DialogHeader>
              <DialogTitle>Recently deleted</DialogTitle>
              <DialogDescription>
                Deleted sessions stay here for {HISTORY_TRASH_DAYS} days, then they are removed for good. Restore one
                to put it back in Past sessions.
              </DialogDescription>
            </DialogHeader>
            <ul aria-label="Recently deleted" className="divide-y rounded-lg border">
              {trash.map((entry) => (
                <li key={entry.id} className="space-y-2 px-3 py-2">
                  <button
                    type="button"
                    className="block w-full text-left"
                    disabled={busy}
                    onClick={() => handleView(entry, true)}
                  >
                    <span className="block truncate font-medium">{entry.location}</span>
                    <span className="block text-sm text-muted-foreground">{summary(entry)}</span>
                    <span className="block text-xs text-muted-foreground">
                      Deleted {when(entry.deletedAt)} · removed for good in{' '}
                      {plural(daysLeft(entry.deletedAt, HISTORY_TRASH_DAYS), 'day')}
                    </span>
                  </button>
                  {confirmPurge?.id === entry.id ? (
                    <div role="group" aria-label={`Confirm deleting ${entry.location} for good`} className="flex flex-wrap items-center gap-2">
                      <p className="text-sm">Delete it for good? This cannot be undone.</p>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmPurge(null)}>
                        Keep it
                      </Button>
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => handlePurge(entry)}>
                        Delete for good
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => restore(entry)}>
                        Restore
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmPurge(entry)}>
                        Delete for good
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Button variant="outline" disabled={busy} onClick={() => setShowTrash(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Past sessions</DialogTitle>
              <DialogDescription>
                Every session you end is kept here. Open one to see its ranking, or to resume it.
              </DialogDescription>
            </DialogHeader>
            {justDeleted && (
              <div role="status" className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                <span className="min-w-0">“{justDeleted.location}” moved to Recently deleted.</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => restore(justDeleted, true)}>
                  Undo
                </Button>
              </div>
            )}
            {clubError && (
              <p role="status" className="text-sm text-muted-foreground">
                The club’s history could not be loaded ({clubError}). Showing what is on this device.
              </p>
            )}
            {entries === null ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No past sessions yet. A session appears here when you end it.
              </p>
            ) : (
              <>
                <ul className="divide-y rounded-lg border">
                  {entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                        disabled={busy}
                        onClick={() => handleView(entry)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{entry.location}</span>
                          <span className="block text-sm text-muted-foreground">{summary(entry)}</span>
                        </span>
                        {entry.clubOnly && <Badge variant="secondary">Club</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
                {entries.length > PAGE_SIZE && (
                  <nav aria-label="Past sessions pages" className="flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || page === 0}
                      onClick={() => setPage(page - 1)}
                    >
                      Previous
                    </Button>
                    <p aria-live="polite" className="text-sm text-muted-foreground">
                      Page {page + 1} of {Math.ceil(entries.length / PAGE_SIZE)}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || (page + 1) * PAGE_SIZE >= entries.length}
                      onClick={() => setPage(page + 1)}
                    >
                      Next
                    </Button>
                  </nav>
                )}
              </>
            )}
            {trash.length > 0 && (
              <Button variant="ghost" disabled={busy} onClick={() => setShowTrash(true)}>
                Recently deleted ({trash.length})
              </Button>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
