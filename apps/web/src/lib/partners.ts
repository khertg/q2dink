import { partnerOf } from '@/matchmaking/grouping'
import { activeIds, lockStatus, type AwayPartner } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'

/** Who this player is locked with, and whether the lock is still waiting for both to finish a game. */
export function lockedPartner(session: SessionState, id: number): { partnerId: number; waiting: boolean } | undefined {
  const inForce = partnerOf(session.partners, id)
  if (inForce !== undefined) return { partnerId: inForce, waiting: false }
  const pending = (session.pendingPartners ?? []).find(({ pair }) => pair.includes(id))
  return pending ? { partnerId: pending.pair[0] === id ? pending.pair[1] : pending.pair[0], waiting: true } : undefined
}

/** Who this player can be locked with: anyone still in the session, not themselves, and not locked already. */
export function lockCandidates(session: SessionState, id: number): number[] {
  if (lockedPartner(session, id)) return []
  return activeIds(session).filter((other) => other !== id && session.players[other] && !lockedPartner(session, other))
}

const nameOf = (session: SessionState, id: number) => session.players[id]?.name ?? 'Someone'

function whereIs(session: SessionState, { id, courtName }: AwayPartner) {
  return courtName ? `${nameOf(session, id)} is playing on ${courtName}` : `${nameOf(session, id)} is on a break`
}

/**
 * Why a lock of a and b would wait (one or both are on a court or a break), in the words staff read before
 * confirming it. Null when it takes effect at once.
 */
export function lockExplanation(session: SessionState, a: number, b: number): string | null {
  const status = lockStatus(session, a, b)
  if (status.inForce) return null
  const stays =
    status.away.length === 1
      ? `${nameOf(session, status.away[0].id === a ? b : a)} keeps their place in line.`
      : 'Each keeps their own place in line.'
  return `${status.away.map((away) => whereIs(session, away)).join(' and ')}. ${stays} The lock starts once both of them have finished a game.`
}

/** The toast after locking a and b (given the session before the lock). */
export function lockedMessage(session: SessionState, a: number, b: number): string {
  const pair = `${nameOf(session, a)} and ${nameOf(session, b)}`
  return lockStatus(session, a, b).inForce
    ? `${pair} are now partners`
    : `${pair} will be partners once both have finished a game`
}
