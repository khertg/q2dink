import { levelLabel, sessionScale } from '@/lib/skill'
import type { Lane } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'

/** Where a checked-in player is right now. */
export type PlayerPlace = 'nextUp' | 'waiting' | 'court' | 'break'

export interface PlayerStatus {
  id: number
  place: PlayerPlace
  /** What staff read, such as "Next up", "Next up · 3.5+", "Waiting #6", "On Court 2" or "On a break". */
  label: string
  /** The court they are on (place "court"). */
  courtId?: number
  /** Which next group they are in, by lane index (place "nextUp"). */
  lane?: number
  /** Their place in the whole queue, from 1 (places "nextUp" and "waiting"). */
  queuePlace?: number
}

/**
 * Every player of the session with where they are: the next groups first (lane by lane, Team A then
 * Team B), then the rest of the queue, then the courts in board order, then the breaks. Waiting
 * numbers are places in the whole queue, as on the queue card.
 */
export function playerStatuses(session: SessionState, lanes: Lane[]): PlayerStatus[] {
  const byLevel = lanes.length > 1 || lanes[0]?.levels !== undefined
  const queuePlace = (id: number) => session.queue.indexOf(id) + 1
  const nextUp = lanes.flatMap((lane, index) =>
    (lane.group?.players ?? []).map(
      (id): PlayerStatus => ({
        id,
        place: 'nextUp',
        label: byLevel ? `Next up · ${levelLabel(sessionScale(session), lane.levels) ?? 'Any level'}` : 'Next up',
        lane: index,
        queuePlace: queuePlace(id),
      }),
    ),
  )
  const inNextUp = new Set(nextUp.map((s) => s.id))
  const waiting = session.queue
    .filter((id) => !inNextUp.has(id))
    .map((id): PlayerStatus => ({ id, place: 'waiting', label: `Waiting #${queuePlace(id)}`, queuePlace: queuePlace(id) }))
  const playing = session.courts.flatMap((court) =>
    (court.teams?.flat() ?? []).map(
      (id): PlayerStatus => ({ id, place: 'court', label: `On ${court.name}`, courtId: court.id }),
    ),
  )
  const resting = session.onBreak.map((id): PlayerStatus => ({ id, place: 'break', label: 'On a break' }))
  return [...nextUp, ...waiting, ...playing, ...resting].filter((s) => session.players[s.id])
}
