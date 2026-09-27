import { LayoutGridIcon, TrophyIcon } from 'lucide-react'
import { liveBoardPath, type LiveSessionSummary } from '@q2dink/shared'
import { useEffect, useState } from 'react'
import { toCloudError, type LiveRow } from '@/cloud/api'
import { cloud } from '@/cloud/client'
import { parsePublicSnapshot, toViewerState, type PublicSnapshot } from '@/cloud/snapshot'
import { CourtCard } from '@/components/CourtCard'
import { CourtGrid } from '@/components/CourtGrid'
import { NextUpCard } from '@/components/NextUpCard'
import { QueueList } from '@/components/QueueList'
import { SkillCountPills } from '@/components/SkillCountPills'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useClubName } from '@/lib/avatars'
import { levelLabel, sessionScale } from '@/lib/skill'
import { lockMarks } from '@/lib/partners'
import { SkillScaleContext } from '@/lib/skillScaleContext'
import { playingIds } from '@/rotation/engine'
import { matchmakingLabel } from '@/lib/matchmaking'
import { cn } from '@/lib/utils'
import { StandingsScreen } from './StandingsScreen'

/** Fallback for networks that block the live stream. */
const POLL_MS = 15_000
/** How often (in polls) the club's own link reads which sessions are live, when nothing else says it changed. */
const LIVES_EVERY_POLLS = 4

type ViewState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'live'; snapshot: PublicSnapshot; updatedAt: string }
  | { kind: 'error'; message: string }

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-6 text-center">
        <p className="text-lg font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  )
}

/**
 * When a club runs several sessions on its live page at once, its own link offers each one (its latest is shown
 * below until players choose).
 */
function SessionChooser({ slug, sessions }: { slug: string; sessions: LiveSessionSummary[] }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-4">
        <p className="text-sm font-medium">This club is running {sessions.length} sessions. Choose yours:</p>
        <ul className="flex flex-wrap gap-2">
          {sessions.map((s) => (
            <li key={s.sessionId}>
              <a
                href={liveBoardPath(slug, s.sessionId)}
                className="inline-flex h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
              >
                {s.location || 'Session'}
                {s.status === 'paused' && <span className="ml-1 text-muted-foreground">(paused)</span>}
              </a>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * Read-only live board for players, opened from the club's QR code or link: the club's latest live session
 * (with a choice when it runs several), or with `sessionId` one session's own board.
 */
export function ViewerScreen({ slug, sessionId }: { slug: string; sessionId?: string }) {
  const [view, setView] = useState<ViewState>({ kind: 'loading' })
  const [offline, setOffline] = useState(false)
  const [lives, setLives] = useState<LiveSessionSummary[]>([])
  const clubName = useClubName()

  useEffect(() => {
    if (!cloud) return
    const api = cloud
    let cancelled = false

    // The board can arrive by push (realtime) or by poll. Ignore a reply that is older than
    // what is already on screen, so a slow poll can never overwrite a newer pushed update.
    let latest = ''
    // The session on screen. On the club's own link it is the latest live one when the page opened: it stays
    // on screen while it is live, even as the club's other sessions change.
    let shown = sessionId
    // The club's sessions on its live page, as last listed: a board from one not listed means the list is old.
    let listed = new Set<string>()
    const refreshLives = () =>
      api
        .listLive(slug)
        .then((list) => {
          if (cancelled) return
          listed = new Set(list.map((s) => s.sessionId))
          setLives(list)
        })
        .catch(() => undefined)

    function show(row: LiveRow | null) {
      if (cancelled) return
      setOffline(false)
      if (!sessionId && row?.sessionId && !listed.has(row.sessionId)) void refreshLives()
      if (!row) {
        latest = ''
        setView({ kind: 'none' })
        return
      }
      if (!sessionId && shown && row.sessionId && row.sessionId !== shown) return
      if (row.updatedAt < latest) return
      latest = row.updatedAt
      shown = row.sessionId ?? shown
      const snapshot = parsePublicSnapshot(row.state)
      setView(
        snapshot
          ? { kind: 'live', snapshot, updatedAt: row.updatedAt }
          : { kind: 'error', message: 'This board needs a newer version of Q2Dink. Refresh the page.' },
      )
    }

    // Every player's phone on the club's Wi-Fi shares one request budget: the list is read when the page
    // opens, when the stream shows a session not on it, and otherwise only every few polls.
    let polls = 0
    async function load() {
      // On the club's own link, whether players have several sessions to choose from.
      if (!sessionId && polls++ % LIVES_EVERY_POLLS === 0) void refreshLives()
      try {
        let row = await api.fetchLive(slug, shown)
        // The club's session on screen left the live page: show the club's latest instead.
        if (!row && !sessionId && shown) {
          shown = undefined
          latest = ''
          row = await api.fetchLive(slug)
        }
        show(row)
      } catch (error) {
        if (cancelled) return
        // Keep showing the last good board when the connection drops.
        setOffline(true)
        setView((prev) =>
          prev.kind === 'live' ? prev : { kind: 'error', message: toCloudError(error).message },
        )
      }
    }

    void load()
    // On the club's own link "cleared" only means its latest board changed: look again rather than go blank.
    const unsubscribe = api.subscribeLive(slug, (row) => (row || sessionId ? show(row) : void load()), undefined, { sessionId })
    const timer = setInterval(() => void load(), POLL_MS)
    const handleOnline = () => void load()
    window.addEventListener('online', handleOnline)

    return () => {
      cancelled = true
      unsubscribe()
      clearInterval(timer)
      window.removeEventListener('online', handleOnline)
    }
  }, [slug, sessionId])

  if (!cloud) {
    return (
      <Message title="Live view is not available">
        Cloud sync isn&apos;t configured on this deployment.
      </Message>
    )
  }
  if (view.kind === 'loading') {
    return <p className="py-10 text-center text-muted-foreground">Loading the live board…</p>
  }
  if (view.kind === 'error') {
    return <Message title="Can't load the live board">{view.message}</Message>
  }
  if (view.kind === 'none') {
    return (
      <Message title="No game in progress">
        {sessionId
          ? 'This session isn’t on the live page right now (it may have ended). This page updates by itself.'
          : 'This club isn’t running a session right now. This page updates by itself when they start.'}
      </Message>
    )
  }

  const { snapshot, updatedAt } = view
  const session = toViewerState(snapshot)
  const marks = lockMarks(session)
  const updated = new Date(updatedAt).toLocaleTimeString()

  return (
    // The session's own level names, as staff see them.
    <SkillScaleContext.Provider value={sessionScale(session)}>
    {/* Bottom padding clears the fixed bottom tab bar (its height plus the home-indicator safe area). */}
    <div className="space-y-4 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {lives.length > 1 && <SessionChooser slug={slug} sessions={lives} />}
      <header className="min-w-0">
        {clubName && <p className="break-words text-2xl font-bold">{clubName}</p>}
        <h1 className={cn('break-words', clubName ? 'text-sm text-muted-foreground' : 'text-2xl font-bold')}>
          {snapshot.location}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge>Live</Badge>
          {snapshot.status === 'paused' && <Badge variant="outline">Paused</Badge>}
          <Badge variant="secondary">{snapshot.mode === 'doubles' ? 'Doubles' : 'Singles'}</Badge>
          {snapshot.mode === 'doubles' && (
            <Badge variant="secondary">{matchmakingLabel(snapshot.matchmaking)}</Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {offline ? `Offline. Showing the update from ${updated}` : `Updated ${updated}`}
          </span>
        </div>
        <div className="mt-2">
          <SkillCountPills
            ids={[...session.queue, ...playingIds(session)]}
            players={session.players}
            label="Checked in per level"
          />
        </div>
        {snapshot.status === 'paused' && (
          <p className="mt-2 text-sm text-muted-foreground">
            The session is paused for now. Games start again when staff resume it.
          </p>
        )}
      </header>

      <Tabs defaultValue="board">
        <TabsList variant="bottom-bar">
          <TabsTrigger value="board">
            <LayoutGridIcon aria-hidden="true" />
            Live board
          </TabsTrigger>
          <TabsTrigger value="standings">
            <TrophyIcon aria-hidden="true" />
            Standings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board" className="space-y-4">
          <CourtGrid>
            {session.courts.map((court) => (
              <CourtCard
                key={court.id}
                court={court}
                lockMarks={marks}
                players={session.players}
                partners={session.partners}
                slotsPerTeam={snapshot.mode === 'doubles' ? 2 : 1}
                readOnly
              />
            ))}
          </CourtGrid>
          <NextUpCard
            lockMarks={marks}
            nextUp={snapshot.nextUp}
            players={session.players}
            emptyMessage="No group is ready yet. Waiting for more players."
            slotsPerTeam={snapshot.mode === 'doubles' ? 2 : 1}
            lanes={snapshot.nextUpLanes?.map((lane) => ({
              label: levelLabel(sessionScale(session), lane.levels ?? undefined) ?? 'Any level',
              nextUp: lane.players,
              emptyMessage: 'No group is ready yet.',
            }))}
          />
          <QueueList
            session={session}
            nextUp={snapshot.nextUpLanes ? snapshot.nextUpLanes.flatMap((lane) => lane.players) : snapshot.nextUp}
          />
        </TabsContent>
        <TabsContent value="standings">
          <StandingsScreen session={session} location={snapshot.location} readOnly />
        </TabsContent>
      </Tabs>
    </div>
    </SkillScaleContext.Provider>
  )
}
