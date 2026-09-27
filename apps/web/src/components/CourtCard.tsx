import { MoreVerticalIcon, Pause, Timer, Trophy } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CancelGameDialog } from '@/components/CancelGameDialog'
import { ReplacePlayerDialog, type Candidate } from '@/components/ReplacePlayerDialog'
import { ScoreDialog } from '@/components/ScoreDialog'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { PlayerMenu } from '@/components/PlayerMenu'
import { EmptyTeams, OpenTile, PlayerTile, TeamBox, Versus } from '@/components/PlayerTile'
import { SkillBadge } from '@/components/SkillBadge'
import type { SkillLevel } from '@/db/db'
import { levelLabel } from '@/lib/skill'
import { TEAM_BUTTON, TEAM_NAMES } from '@/lib/teams'
import { formatDuration, useSessionNow } from '@/lib/time'
import { cn } from '@/lib/utils'
import { courtSlots, playedMs } from '@/rotation/engine'
import type { Court, RosterPlayer } from '@/rotation/types'

interface Props {
  court: Court
  players: Record<number, RosterPlayer>
  /** Locked partner pairs, to mark teams that are locked together. */
  partners: [number, number][]
  /** Read-only cards (the public viewer page) show teams but no controls. */
  readOnly?: boolean
  /** Everyone in the session with where they are, offered as substitutes (anyone can come on). */
  candidates?: Candidate[]
  /** Players per team (2 in doubles, 1 in singles): the spots of an empty court, and the open ones of a short team. */
  slotsPerTeam?: number
  onReplace?: (outId: number, inId: number, options: { sendOnBreak: boolean }) => void
  /** Take a player off the court, leaving their spot open (a game in progress pauses); they go to the front of the queue. */
  onRemove?: (playerId: number) => void
  /** The same, but they go on a break. */
  onTakeBreak?: (playerId: number) => void
  /** Put a waiting or resting player in an open spot on a team: on a game missing a player, or to set up an open court. */
  onFill?: (team: 0 | 1, slot: number, playerId: number) => void
  /** Staff only: change a player's skill level from their badge. */
  onSkillChange?: (playerId: number, skill: SkillLevel) => void
  /**
   * What an open court can do. "ready": a next group exists, so Start game is offered.
   * "override": no group fits the matchmaking mode (mixed doubles), but staff may start
   * with whoever is waiting. "none": not enough players yet.
   */
  startState?: 'ready' | 'override' | 'none'
  /** Why no game can start yet, shown on an open court when startState is "none". */
  waitingMessage?: string
  /** On a court kept for a level range: the group that would start here, as "Ann & Bob vs Cy & Dee". */
  nextHere?: string
  /** Start the next group here, or (on a court set up by hand) exactly the players on it. */
  onStart?: (options?: { ignoreMode?: boolean }) => void
  /** Record the game from its score (Blue, then Orange). Asked for after a Won button is pressed. */
  onScore?: (scoreA: number, scoreB: number) => void
  /** Cancel the game, or clear a court being set up. */
  onCancel?: () => void
  /** While the session is not started or paused: why no game can start, shown instead of Start game. */
  stoppedReason?: string
}

/**
 * The in-play badge: a timer icon and how long the game has been played ("⏱ 7m10s"), refreshed every
 * second by its own timer. Time with an open spot is left out, and while a spot is open the badge
 * says "Paused" with the time stopped. "In play" is kept for screen readers. A game with no start
 * time says "In play"; a court being set up by hand says "Not started".
 */
function PlayingBadge({ court }: { court: Court }) {
  const now = useSessionNow()
  if (court.notStarted) return <Badge variant="outline">Not started</Badge>
  const played = playedMs(court, now)
  if (court.pausedAt !== undefined) {
    return (
      <Badge variant="secondary" className="tabular-nums">
        <Pause aria-hidden="true" />
        Paused
        {played !== undefined && <span className="text-muted-foreground">{formatDuration(played / 1000)}</span>}
      </Badge>
    )
  }
  if (played === undefined) return <Badge>In play</Badge>
  return (
    <Badge className="tabular-nums">
      <span className="sr-only">In play </span>
      <Timer aria-hidden="true" />
      {formatDuration(played / 1000)}
    </Badge>
  )
}

export function CourtCard({
  court,
  players,
  partners,
  readOnly = false,
  candidates = [],
  slotsPerTeam = 2,
  onReplace,
  onRemove,
  onTakeBreak,
  onFill,
  onSkillChange,
  startState = 'none',
  waitingMessage = 'Waiting for players to check in',
  nextHere,
  onStart,
  onScore,
  onCancel,
  stoppedReason,
}: Props) {
  // The team whose win button was pressed; the score pop-up is open while this is set.
  const [pendingWinner, setPendingWinner] = useState<0 | 1 | null>(null)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // The open spot being filled (its team and position); the pop-up to choose who is open while this is set.
  const [filling, setFilling] = useState<{ team: 0 | 1; slot: number } | null>(null)
  // Players and open spots in place, so a removed player's spot stays where it was.
  const slots = courtSlots(court, slotsPerTeam)
  const levels = levelLabel(court.levels)
  const short = !!court.teams && court.teams.some((team) => team.length < slotsPerTeam)
  const staged = !!court.notStarted
  const canFill = !readOnly && !!onFill

  return (
    <Card role="region" aria-label={court.name}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{court.name}</span>
            {/*
              Always shown, so staff and players can see which courts are open to everyone. Drawn from a
              data attribute, like avatar initials, so it adds no text to the court (tests look for
              players by name, and "All levels" contains "Eve").
            */}
            <Badge
              variant="secondary"
              role="img"
              aria-label={`Skill levels: ${levels ?? 'All levels'}`}
              title="Skill levels for this court"
              data-levels={levels ?? 'All levels'}
              className="shrink-0 font-normal before:content-[attr(data-levels)]"
            />
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {court.teams ? <PlayingBadge court={court} /> : <Badge variant="outline">Open</Badge>}
            {court.teams && !readOnly && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Court menu">
                    <MoreVerticalIcon aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-40 p-1">
                  <PopoverClose asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full justify-start"
                      // Nothing is lost clearing a court being set up, so it needs no confirmation.
                      onClick={() => (staged ? onCancel?.() : setConfirmingCancel(true))}
                    >
                      {staged ? 'Clear court' : 'Cancel game'}
                    </Button>
                  </PopoverClose>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {court.teams ? (
          <>
            {court.teams.map((team, i) => (
              <Fragment key={i}>
                {i === 1 && <Versus />}
                <TeamBox
                  team={i as 0 | 1}
                  locked={partners.some(([x, y]) => team.includes(x) && team.includes(y))}
                  footer={
                    !readOnly &&
                    !staged && (
                      <Button
                        variant="outline"
                        className={cn('h-9 w-full', TEAM_BUTTON[i])}
                        disabled={short}
                        onClick={() => setPendingWinner(i as 0 | 1)}
                      >
                        <Trophy aria-hidden="true" />
                        {TEAM_NAMES[i]} won
                      </Button>
                    )
                  }
                >
                  {slots[i].map((id, slot) =>
                    id === null ? (
                      <OpenTile
                        key={`open-${slot}`}
                        onFill={canFill ? () => setFilling({ team: i as 0 | 1, slot }) : undefined}
                        fillLabel={`Fill open spot on ${TEAM_NAMES[i]}`}
                      />
                    ) : (
                      <PlayerTile key={id}>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {players[id] && <PlayerAvatar name={players[id].name} size="sm" editable={!readOnly} viewable />}
                          <span className="min-w-0 truncate">{players[id]?.name}</span>
                        </span>
                        {/* Its own column, so the times line up like the level badges. */}
                        {court.waited && (
                          <span className="w-16 shrink-0 text-right">
                            {court.waited[id] !== undefined && (
                              <span title="Waited before this game" className="text-xs text-muted-foreground">
                                {formatDuration(court.waited[id])}
                              </span>
                            )}
                          </span>
                        )}
                        {players[id] && (
                          <SkillBadge
                            player={players[id]}
                            onChange={!readOnly && onSkillChange ? (skill) => onSkillChange(id, skill) : undefined}
                          />
                        )}
                        {!readOnly && onReplace && players[id] && (
                          <PlayerMenu
                            player={players[id]}
                            candidates={candidates}
                            courtId={court.id}
                            onReplace={(inId, options) => onReplace(id, inId, options)}
                            onRemove={onRemove && (() => onRemove(id))}
                            onTakeBreak={onTakeBreak && (() => onTakeBreak(id))}
                          />
                        )}
                      </PlayerTile>
                    ),
                  )}
                </TeamBox>
              </Fragment>
            ))}
            {!readOnly && staged && (
              <div className="space-y-2 pt-1 text-center">
                {short ? (
                  <p className="text-sm text-muted-foreground">Fill every spot to start the game.</p>
                ) : stoppedReason ? (
                  <p className="text-sm text-muted-foreground">{stoppedReason}</p>
                ) : (
                  <Button className="h-11 w-full" onClick={() => onStart?.()}>
                    Start game
                  </Button>
                )}
              </div>
            )}
            {!readOnly && !staged && (
              <>
                {short && (
                  <p className="text-center text-sm text-muted-foreground">Fill the open spot to finish the game.</p>
                )}
                <ScoreDialog
                  courtName={court.name}
                  teamNames={[
                    court.teams[0].map((id) => players[id]?.name ?? ''),
                    court.teams[1].map((id) => players[id]?.name ?? ''),
                  ]}
                  winner={pendingWinner}
                  onClose={() => setPendingWinner(null)}
                  onSubmit={(a, b) => onScore?.(a, b)}
                />
                <CancelGameDialog
                  courtName={court.name}
                  players={court.teams.flat().length}
                  open={confirmingCancel}
                  onOpenChange={setConfirmingCancel}
                  onConfirm={() => onCancel?.()}
                />
              </>
            )}
          </>
        ) : (
          <div className="space-y-3 text-center">
            <EmptyTeams perTeam={slotsPerTeam} stacked onFill={canFill ? (team, slot) => setFilling({ team, slot }) : undefined} />
            {readOnly ? (
              <p className="text-sm text-muted-foreground">Waiting for the next game</p>
            ) : stoppedReason && startState !== 'none' ? (
              <p className="text-sm text-muted-foreground">{stoppedReason}</p>
            ) : startState === 'ready' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {nextHere ? `Next here: ${nextHere}` : 'Ready for the next game'}
                </p>
                <Button className="h-11 w-full" onClick={() => onStart?.()}>
                  Start game
                </Button>
              </>
            ) : startState === 'override' ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {levels
                    ? `${waitingMessage} You can also start with whoever is waiting.`
                    : 'No group fits this matchmaking mode yet. Check in more players, or start with whoever is waiting.'}
                </p>
                <Button variant="outline" className="h-11 w-full" onClick={() => onStart?.({ ignoreMode: true })}>
                  Start with waiting players
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{waitingMessage}</p>
            )}
          </div>
        )}
        {canFill && (
          <ReplacePlayerDialog
            mode="fill"
            spot={`${court.name}, ${TEAM_NAMES[filling?.team ?? 0]}`}
            candidates={candidates}
            open={filling !== null}
            onOpenChange={(open) => !open && setFilling(null)}
            onReplace={(inId) => filling !== null && onFill?.(filling.team, filling.slot, inId)}
          />
        )}
      </CardContent>
    </Card>
  )
}
