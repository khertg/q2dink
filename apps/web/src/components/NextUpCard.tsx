import { Fragment, useState } from 'react'
import { AnnounceButton } from '@/components/AnnounceButton'
import type { WordingScope } from '@/components/CalloutTextsDialog'
import { ReplacePlayerDialog, type Candidate } from '@/components/ReplacePlayerDialog'
import { PlayerMenu } from '@/components/PlayerMenu'
import type { PartnerOption } from '@/components/partnerItem'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import type { LockMark } from '@/lib/partners'
import { OpenTile, PlayerTile, TeamBox, Versus } from '@/components/PlayerTile'
import { SkillBadge } from '@/components/SkillBadge'
import { WaitingTime } from '@/components/WaitingTime'
import type { SkillLevel } from '@/db/db'
import { TEAM_NAMES } from '@/lib/teams'
import { useSessionNow } from '@/lib/time'
import type { RosterPlayer } from '@/rotation/types'

interface Props {
  /** Player ids, Blue first and then Orange. Empty when no group can be formed. */
  nextUp: number[]
  /**
   * While no group can be formed: the spots staff pinned players into (Blue, then Orange), null for
   * each open one. Missing means all open.
   */
  spots?: (number | null)[]
  players: Record<number, RosterPlayer>
  /** Locked partners' marks, by player (see lockMarks), for their avatars. */
  lockMarks?: Map<number, LockMark>
  /** Shown when nobody can be listed, so people know what is being waited for. */
  emptyMessage: string
  /**
   * Staff only: everyone in the session with where they are; any of them can take a place in the
   * group. Without `onReplace` the card is read-only, as on the players' live page.
   */
  candidates?: Candidate[]
  /** Players per team (2 in doubles, 1 in singles), for the open spots while no group can be formed. */
  slotsPerTeam?: number
  onReplace?: (outId: number, inId: number) => void
  /** Take a player out of the group (a stand-in takes their spot); they keep their queue place, or go on a break. */
  onRemove?: (playerId: number) => void
  onTakeBreak?: (playerId: number) => void
  /** Take a player out of the session altogether (a stand-in takes their spot, as with onRemove). */
  onRemoveFromSession?: (playerId: number) => void
  /** Staff, in doubles: lock or unlock a player's partner from their menu. */
  partnerFor?: (playerId: number) => PartnerOption | undefined
  /** Why this player cannot be removed right now (nobody to stand in), or undefined when they can. */
  removeBlocked?: (playerId: number) => string | undefined
  /** Staff only: pin a player into an open spot of a lane's group (spots count Blue, then Orange). */
  onFillSpot?: (lane: number, slot: number, playerId: number) => void
  /** The group was chosen (or players pinned) by staff, so it can be reset to the automatic one. */
  picked?: boolean
  onReset?: () => void
  /** Staff only: change a player's skill level from their badge. */
  onSkillChange?: (playerId: number, skill: SkillLevel) => void
  /** Staff only: tap a player's avatar to change it. */
  editable?: boolean
  /** Staff only: ms since the epoch each player joined the queue, for a live "waited so far" line. */
  queuedAt?: Record<number, number>
  /**
   * While courts are kept for skill levels: one group per level, shown in place of `nextUp` (and its
   * `emptyMessage` and `spots`), each under its label such as "3.5+" or "Any level".
   */
  lanes?: NextUpLane[]
  /**
   * Staff only: what the speaker button reads out (see lib/callout.ts), null while nobody can be called.
   * Without it there is no button, as on the live page.
   */
  announceText?: string | null
  /** Staff only: what Call out in a player's menu reads out (see lib/callout.ts). */
  calloutFor?: (playerId: number) => string | null
  /** Signed in to a club: change what a speaker or a player's Call out says (the wording editor, in that scope). */
  onEditWording?: (scope: WordingScope) => void
}

export interface NextUpLane {
  label: string
  nextUp: number[]
  emptyMessage: string
  spots?: (number | null)[]
}

type TeamsProps = Pick<
  Props,
  | 'players'
  | 'lockMarks'
  | 'candidates'
  | 'onReplace'
  | 'onRemove'
  | 'onTakeBreak'
  | 'onRemoveFromSession'
  | 'partnerFor'
  | 'removeBlocked'
  | 'onSkillChange'
  | 'editable'
  | 'queuedAt'
  | 'calloutFor'
  | 'onEditWording'
> & {
  /** One per spot, Blue then Orange: a player, or null for an open spot. */
  spots: (number | null)[]
  /** Which lane's group this is, so its own players read "In this group" when swapping. */
  lane: number
  /** Staff only: tap an open spot to choose who takes it. */
  onOpenSpot?: (slot: number) => void
}

/**
 * The group that will play next, already split into teams. Staff read it to call
 * people up before starting a game; the live board shows the same card to players.
 * While no group can be formed its spots are open, and staff can tap one to pin a player into it.
 */
export function NextUpCard({
  nextUp,
  spots,
  emptyMessage,
  picked = false,
  onReset,
  lanes,
  slotsPerTeam = 2,
  onFillSpot,
  announceText,
  ...shared
}: Props) {
  // The open spot being filled; the pop-up to choose who is open while this is set.
  const [filling, setFilling] = useState<{ lane: number; slot: number } | null>(null)
  const openSpots = (pinned?: (number | null)[]) => pinned ?? Array<number | null>(slotsPerTeam * 2).fill(null)
  const staff = !!shared.onReplace && !!onFillSpot
  const group = (lane: number, ids: number[], pinned: (number | null)[] | undefined, message: string) =>
    ids.length > 0 ? (
      <GroupTeams {...shared} spots={ids} lane={lane} />
    ) : (
      <div className="space-y-2">
        <GroupTeams
          {...shared}
          spots={openSpots(pinned)}
          lane={lane}
          onOpenSpot={staff ? (slot) => setFilling({ lane, slot }) : undefined}
        />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    )

  return (
    <Card role="group" aria-label="Next up">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            Next up
            {announceText !== undefined && (
              <AnnounceButton
                text={announceText}
                label="Next up"
                onEdit={shared.onEditWording && (() => shared.onEditWording?.({ kind: 'club', keys: ['nextUp', 'levelPrefix'] }))}
              />
            )}
          </span>
          {picked && onReset && (
            <span className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
              Chosen by staff
              <Button variant="outline" size="sm" onClick={onReset}>
                Reset
              </Button>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lanes ? (
          <div className="space-y-4">
            {lanes.map((lane, index) => (
              <section key={lane.label} aria-label={lane.label} className="space-y-2">
                <p className="text-sm font-semibold">{lane.label}</p>
                {group(index, lane.nextUp, lane.spots, lane.emptyMessage)}
              </section>
            ))}
          </div>
        ) : (
          group(0, nextUp, spots, emptyMessage)
        )}
        {staff && (
          <ReplacePlayerDialog
            mode="fill"
            spot={`Next up, ${TEAM_NAMES[filling && filling.slot >= slotsPerTeam ? 1 : 0]}`}
            candidates={shared.candidates ?? []}
            open={filling !== null}
            onOpenChange={(open) => !open && setFilling(null)}
            onReplace={(inId) => filling && onFillSpot?.(filling.lane, filling.slot, inId)}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** One group, split into its two teams (Blue, then Orange), with any open spots as dashed tiles. */
function GroupTeams({
  spots,
  players,
  lockMarks,
  candidates = [],
  lane,
  onOpenSpot,
  onReplace,
  onRemove,
  onTakeBreak,
  onRemoveFromSession,
  partnerFor,
  removeBlocked,
  onSkillChange,
  editable = false,
  queuedAt,
  calloutFor,
  onEditWording,
}: TeamsProps) {
  const now = useSessionNow()
  const half = spots.length / 2
  const teams = [spots.slice(0, half), spots.slice(half)]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-3">
      {teams.map((team, i) => (
        <Fragment key={i}>
          {i === 1 && <Versus />}
          <TeamBox team={i as 0 | 1}>
            {team.map((id, k) =>
              id === null ? (
                <OpenTile
                  key={`open-${k}`}
                  onFill={onOpenSpot && (() => onOpenSpot(i * half + k))}
                  fillLabel={`Fill open spot on ${TEAM_NAMES[i]}`}
                />
              ) : (
                <PlayerTile key={id}>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <PlayerAvatar
                      name={players[id]?.name ?? 'Player'}
                      size="sm"
                      editable={editable}
                      viewable
                      lock={lockMarks?.get(id)}
                    />
                    <span className="min-w-0 truncate">{players[id]?.name ?? 'Player'}</span>
                  </span>
                  {/* Its own column, so the times line up like the level badges. */}
                  {queuedAt && (
                    <span className="w-16 shrink-0 text-right">
                      {queuedAt[id] !== undefined && (
                        <WaitingTime seconds={(now - queuedAt[id]) / 1000} className="justify-end text-xs" />
                      )}
                    </span>
                  )}
                  {players[id] && (
                    <SkillBadge
                      player={players[id]}
                      onChange={onSkillChange ? (skill) => onSkillChange(id, skill) : undefined}
                    />
                  )}
                  {onReplace && players[id] && (
                    <PlayerMenu
                      mode="nextUp"
                      player={players[id]}
                      candidates={candidates}
                      lane={lane}
                      onReplace={(inId) => onReplace(id, inId)}
                      onRemove={onRemove && (() => onRemove(id))}
                      onTakeBreak={onTakeBreak && (() => onTakeBreak(id))}
                      onRemoveFromSession={onRemoveFromSession && (() => onRemoveFromSession(id))}
                      partner={partnerFor?.(id)}
                      removeBlocked={removeBlocked?.(id)}
                      callout={calloutFor?.(id)}
                      onEditCallout={onEditWording && players[id] && (() => onEditWording({ kind: 'player', name: players[id].name }))}
                    />
                  )}
                </PlayerTile>
              ),
            )}
          </TeamBox>
        </Fragment>
      ))}
    </div>
  )
}
