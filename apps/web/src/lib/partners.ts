import { isHeld, partnerOf } from '@/matchmaking/grouping'
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

const nameOf = (session: Pick<SessionState, 'players'>, id: number) => session.players[id]?.name ?? 'Someone'

function whereIs(session: SessionState, { id, courtName }: AwayPartner) {
  return courtName ? `${nameOf(session, id)} is playing on ${courtName}` : `${nameOf(session, id)} is on a break`
}

/**
 * What staff choose between when locking two players while one or both are on a court or a break: the situation,
 * and what each choice does. Null when the lock simply takes effect at once (both waiting, or in the same game).
 */
export function lockChoice(
  session: SessionState,
  a: number,
  b: number,
): { situation: string; wait: string; now: string } | null {
  const status = lockStatus(session, a, b)
  if (status.inForce) return null
  const situation = `${status.away.map((away) => whereIs(session, away)).join(' and ')}.`
  if (status.away.length === 2) {
    return {
      situation,
      wait: 'Each keeps their own place in line. The lock starts once both of them have finished a game.',
      now: 'Whoever is back in the queue first waits for the other and plays no game without them. Then they queue together.',
    }
  }
  const away = status.away[0].id
  const here = away === a ? b : a
  const after = status.away[0].courtName ? `${nameOf(session, away)}’s game` : `${nameOf(session, away)} is back from the break`
  return {
    situation,
    wait: `${nameOf(session, here)} keeps their place in line. The lock starts once both of them have finished a game.`,
    now: `${nameOf(session, here)} waits for ${nameOf(session, away)} and plays no game without them. They queue together after ${after}.`,
  }
}

/**
 * The rule for a lock that takes effect at once (both waiting, or both in the same game), for staff to read before
 * locking. Null when they have to choose instead (see lockChoice).
 */
export function lockRule(session: SessionState, a: number, b: number): string | null {
  if (!lockStatus(session, a, b).inForce) return null
  const shared = 'Locked partners always share a team and wait in the queue together.'
  const ia = session.queue.indexOf(a)
  const ib = session.queue.indexOf(b)
  if (ia === -1 || ib === -1) {
    const court = session.courts.find((c) => c.teams?.flat().includes(a))
    return `Both are playing on ${court?.name ?? 'the same court'}. The lock starts now: after this game they queue together. ${shared}`
  }
  const [first, second] = ia < ib ? [a, b] : [b, a]
  const [early, late] = ia < ib ? [ia, ib] : [ib, ia]
  // Row 3: a staff-chosen Next up with only one of them in it cannot stand.
  const picked = [a, b].filter((id) => session.nextUpPick?.includes(id)).length === 1 ? ' Next up goes back to automatic.' : ''
  const moves =
    late === early + 1
      ? `${nameOf(session, first)} and ${nameOf(session, second)} are already next to each other in the queue (#${early + 1} and #${late + 1}).`
      : `${nameOf(session, first)} (#${early + 1}) moves back to stand with ${nameOf(session, second)} (#${late + 1}), so nobody who is waiting is passed.`
  return `${moves}${picked} ${shared}`
}

/** The toast after locking a and b (given the session before the lock), "now" or waiting for a game. */
export function lockedMessage(session: SessionState, a: number, b: number, now = false): string {
  const pair = `${nameOf(session, a)} and ${nameOf(session, b)}`
  if (lockStatus(session, a, b).inForce) return `${pair} are now partners`
  return now ? `${pair} are now partners, and wait for each other` : `${pair} will be partners once both have finished a game`
}

/**
 * Who a held player (see isHeld) is waiting for, and where that partner is: "on Court 2", "on a break". Undefined
 * for anyone not holding.
 */
export function heldFor(session: SessionState, id: number): { partner: string; where: string } | undefined {
  if (!isHeld(session, id)) return undefined
  const partner = partnerOf(session.partners, id)!
  const court = session.courts.find((c) => c.teams?.flat().includes(partner))
  return { partner: nameOf(session, partner), where: court ? `on ${court.name}` : 'on a break' }
}

/** Every lock, in force or waiting, as a pair. */
const allLocks = (s: Pick<SessionState, 'partners' | 'pendingPartners'>) => [
  ...s.partners,
  ...(s.pendingPartners ?? []).map(({ pair }) => pair),
]
const pairKey = ([a, b]: readonly [number, number]) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/**
 * The locks a change ended: in `before` (in force or waiting) and in neither list of `after`. A waiting lock that came
 * into force was not ended.
 */
export function brokenLocks(
  before: Pick<SessionState, 'partners' | 'pendingPartners'>,
  after: Pick<SessionState, 'partners' | 'pendingPartners'>,
): [number, number][] {
  const still = new Set(allLocks(after).map(pairKey))
  return allLocks(before).filter((pair) => !still.has(pairKey(pair)))
}

/** The question before a change that ends these locks: "Unlock Ann and Bob?", or for several "Unlock these partners?". */
export const unlockQuestion = (session: Pick<SessionState, 'players'>, pairs: [number, number][]) =>
  pairs.length === 1 ? `Unlock ${nameOf(session, pairs[0][0])} and ${nameOf(session, pairs[0][1])}?` : 'Unlock these partners?'

/** After a change ended these locks: "Ann and Bob are no longer locked partners." ('' for none). */
export function unlockedSentence(session: Pick<SessionState, 'players'>, pairs: [number, number][]): string {
  if (pairs.length === 0) return ''
  const who = pairs.length === 1 ? `${nameOf(session, pairs[0][0])} and ${nameOf(session, pairs[0][1])}` : pairNames(session, pairs)
  return `${who} are no longer locked partners.`
}

/** Pairs as staff read them: "Ann & Bob, Eve & Fay". */
export const pairNames = (session: Pick<SessionState, 'players'>, pairs: [number, number][]) =>
  pairs.map(([a, b]) => `${nameOf(session, a)} & ${nameOf(session, b)}`).join(', ')

/** How many ring colours locked pairs cycle through (`--pair-1` … in index.css). */
export const PAIR_COLOURS = 6

/** How a locked player's avatar is marked: who with, whether the lock still waits, and the pair's ring colour. */
export interface LockMark {
  partner: string
  /** Made while one of them was on a court or a break: starts once both have finished a game. */
  waiting: boolean
  /** 1 to PAIR_COLOURS: the same for both players of a pair. */
  colour: number
}

/**
 * The mark for every locked player: pairs in force first (in the order they were locked), then waiting ones, each
 * pair with its own colour, repeating after PAIR_COLOURS pairs.
 */
export function lockMarks(session: Pick<SessionState, 'partners' | 'pendingPartners' | 'players'>): Map<number, LockMark> {
  const marks = new Map<number, LockMark>()
  const pairs = [
    ...session.partners.map((pair) => ({ pair, waiting: false })),
    ...(session.pendingPartners ?? []).map(({ pair }) => ({ pair, waiting: true })),
  ]
  pairs.forEach(({ pair: [a, b], waiting }, index) => {
    const colour = (index % PAIR_COLOURS) + 1
    marks.set(a, { partner: nameOf(session, b), waiting, colour })
    marks.set(b, { partner: nameOf(session, a), waiting, colour })
  })
  return marks
}
