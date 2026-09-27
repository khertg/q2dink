import { hasPlayed, nextUpStandIn } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'

/** What removing this player from the session will do, for the confirm dialog. */
export function removalNotice(session: SessionState, playerId: number): string {
  const court = session.courts.find((c) => c.teams?.flat().includes(playerId))
  const standIn = nextUpStandIn(session, playerId)
  const spot = court
    ? court.notStarted
      ? `Their spot on ${court.name} is left open.`
      : `Their spot on ${court.name} is left open and the game is paused until someone fills it.`
    : standIn !== undefined
      ? `${session.players[standIn].name} takes their place in Next up.`
      : ''
  const results = hasPlayed(session, playerId)
    ? 'Their results stay in Standings, and they can be checked in again later.'
    : 'They can be checked in again later.'
  return [spot, results].filter(Boolean).join(' ')
}

/** The toast after removing a player: `before` is the session just before the change. */
export function removedMessage(before: SessionState, playerId: number): string {
  const name = before.players[playerId]?.name ?? 'The player'
  const court = before.courts.find((c) => c.teams?.flat().includes(playerId))
  const standIn = nextUpStandIn(before, playerId)
  if (court) {
    return court.notStarted
      ? `${name} left the session. Their spot on ${court.name} is open.`
      : `${name} left the session. The game on ${court.name} is paused until the spot is filled.`
  }
  if (standIn !== undefined) return `${name} left the session. ${before.players[standIn].name} is next up instead.`
  return `${name} left the session.`
}
