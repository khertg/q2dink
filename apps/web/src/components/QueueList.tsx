import { Lock } from 'lucide-react'
import { partnerOf } from '@/matchmaking/grouping'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SkillBadge } from '@/components/SkillBadge'
import { SkillCountPills } from '@/components/SkillCountPills'
import { WaitingPlayerMenu } from '@/components/WaitingPlayerMenu'
import { WaitingTime } from '@/components/WaitingTime'
import type { SkillLevel } from '@/db/db'
import { useSessionNow } from '@/lib/time'
import type { SessionState } from '@/rotation/types'

interface Props {
  session: SessionState
  /** Ids of the group that will play next; they get a "Next up" badge instead of a wait estimate. */
  nextUp?: number[]
  /** Staff only: change a player's skill level from their badge. */
  onSkillChange?: (playerId: number, skill: SkillLevel) => void
  /** Staff only: send a waiting player on a break, from the row's "⋮" menu. */
  onTakeBreak?: (playerId: number) => void
  /** Staff only: take a player out of the session, from the same menu (the caller confirms first). */
  onRemoveFromSession?: (playerId: number) => void
  /** Staff only: tap a player's avatar to change it. */
  editable?: boolean
}

export function QueueList({
  session,
  nextUp = [],
  onSkillChange,
  onTakeBreak,
  onRemoveFromSession,
  editable = false,
}: Props) {
  const now = useSessionNow()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Queue ({session.queue.length})</CardTitle>
        <SkillCountPills ids={session.queue} players={session.players} label="Waiting per level" />
      </CardHeader>
      <CardContent>
        {session.queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one waiting</p>
        ) : (
          <ol className="divide-y">
            {session.queue.map((id, index) => {
              const player = session.players[id]
              const partner = partnerOf(session.partners, id)
              const queuedAt = session.queuedAt?.[id]
              return (
                <li key={id} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-sm text-muted-foreground">{index + 1}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <PlayerAvatar name={player.name} size="sm" editable={editable} viewable />
                    <span className="min-w-0 truncate">{player.name}</span>
                    {partner !== undefined && (
                      <Lock
                        className="size-3 text-muted-foreground"
                        aria-label={`Locked with ${session.players[partner]?.name}`}
                      />
                    )}
                  </span>
                  <SkillBadge
                    player={player}
                    onChange={onSkillChange ? (skill) => onSkillChange(id, skill) : undefined}
                  />
                  <span className="w-20 text-right text-sm text-muted-foreground">
                    {nextUp.includes(id) ? (
                      <Badge>Next up</Badge>
                    ) : queuedAt !== undefined ? (
                      <WaitingTime seconds={(now - queuedAt) / 1000} />
                    ) : (
                      'Waiting'
                    )}
                  </span>
                  <WaitingPlayerMenu
                    name={player.name}
                    onTakeBreak={onTakeBreak && (() => onTakeBreak(id))}
                    onRemoveFromSession={onRemoveFromSession && (() => onRemoveFromSession(id))}
                  />
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
