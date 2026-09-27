import { LayoutGridIcon, TrophyIcon, UserPlusIcon } from 'lucide-react'
import { PausedByDialog, SessionClockBanner, SessionClockButton, SessionStatusBadge } from '@/components/SessionClock'
import { SessionMenu } from '@/components/SessionMenu'
import { SkillCountPills } from '@/components/SkillCountPills'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useClubName } from '@/lib/avatars'
import { matchmakingLabel } from '@/lib/matchmaking'
import { SessionClockContext } from '@/lib/time'
import { cn } from '@/lib/utils'
import { playingIds } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'
import { BoardScreen } from './BoardScreen'
import { CheckInScreen } from './CheckInScreen'
import { StandingsScreen } from './StandingsScreen'

export function SessionScreen({ session }: { session: SessionState }) {
  const location = useSessionStore((s) => s.location)
  const clubName = useClubName()
  const totalPlayers = session.queue.length + playingIds(session).length + session.onBreak.length

  return (
    // Bottom padding clears the fixed bottom tab bar (its height plus the home-indicator safe area).
    <div className="space-y-4 pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <header>
        {/* Only the name shares its row with the buttons: the badges below keep the full width, so the header is
            no taller on a phone than before the buttons were there. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {clubName && <p className="break-words text-2xl font-bold">{clubName}</p>}
            <h1 className={cn('break-words', clubName ? 'text-sm text-muted-foreground' : 'text-2xl font-bold')}>
              {location}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SessionClockButton session={session} />
            <SessionMenu session={session} />
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <SessionStatusBadge session={session} />
          <Badge variant="secondary">{session.mode === 'doubles' ? 'Doubles' : 'Singles'}</Badge>
          {session.mode === 'doubles' && (
            <Badge variant="secondary">{matchmakingLabel(session.matchmaking)}</Badge>
          )}
          <Badge variant="secondary">
            {session.courts.length} {session.courts.length === 1 ? 'court' : 'courts'}
          </Badge>
          {/* Everyone in the session right now: waiting, playing or on a break. */}
          <Badge variant="secondary">
            {totalPlayers} {totalPlayers === 1 ? 'player' : 'players'}
          </Badge>
        </div>
        {/* Everyone checked in (waiting or playing; not those on a break). */}
        <div className="mt-2">
          <SkillCountPills
            ids={[...session.queue, ...playingIds(session)]}
            players={session.players}
            label="Checked in per level"
          />
        </div>
      </header>

      <SessionClockBanner session={session} />
      <PausedByDialog session={session} />

      {/* While the session stands still, every timer below shows the moment it stopped. */}
      <SessionClockContext.Provider value={session.clockStoppedAt}>
      <Tabs defaultValue="board">
        <TabsList variant="bottom-bar">
          <TabsTrigger value="board">
            <LayoutGridIcon aria-hidden="true" />
            Board
          </TabsTrigger>
          <TabsTrigger value="checkin">
            <UserPlusIcon aria-hidden="true" />
            Check-in
          </TabsTrigger>
          <TabsTrigger value="standings">
            <TrophyIcon aria-hidden="true" />
            Standings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="board">
          <BoardScreen session={session} />
        </TabsContent>
        <TabsContent value="checkin">
          <CheckInScreen session={session} />
        </TabsContent>
        <TabsContent value="standings">
          <StandingsScreen session={session} location={location} repeatStats share />
        </TabsContent>
      </Tabs>
      </SessionClockContext.Provider>
    </div>
  )
}
