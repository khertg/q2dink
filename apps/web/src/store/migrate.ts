import { DEFAULT_AVG_GAME_MINUTES, EMPTY_STATS } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'

/**
 * Bump whenever the persisted session shape changes, and extend migrateSession. Version 6 added the
 * session's identity (id, start time, all-time totals already counted) beside the session; that lives
 * in the store's own migrate, not in SessionState. Version 7 added scores and time played to each
 * player's stats. Version 8 added time spent waiting in the queue to each player's stats.
 * Version 9 added parked sessions and several unsent ends beside the open session (the store's own
 * migrate); the session clock fields it added to SessionState are optional (missing = running).
 */
export const SESSION_STORE_VERSION = 9

/** Upgrade a session saved by an older build to the current shape. */
export function migrateSession(
  session: SessionState | null,
  fromVersion: number,
): SessionState | null {
  if (!session) return null
  let next = session
  if (fromVersion < 2) next = { ...next, avgGameMinutes: DEFAULT_AVG_GAME_MINUTES }
  if (fromVersion < 3) next = { ...next, matchmaking: 'balanced', partners: [], lastResult: {} }
  if (fromVersion < 4) next = { ...next, stats: {} }
  // Courts gained editable names; existing ones keep the "Court N" they were always shown as.
  if (fromVersion < 5) {
    next = {
      ...next,
      courts: next.courts.map((court) => ({ ...court, name: court.name ?? `Court ${court.id}` })),
    }
  }
  // Stats gained points and time played. Games already played had neither: zeros, and no scored games.
  if (fromVersion < 7) {
    next = {
      ...next,
      stats: Object.fromEntries(
        Object.entries(next.stats).map(([id, stats]) => [id, { ...EMPTY_STATS, ...stats }]),
      ),
    }
  }
  // Stats gained time waited, which the finished games already recorded (0 where they did not).
  if (fromVersion < 8) {
    const waited: Record<number, number> = {}
    for (const match of next.matches ?? []) {
      for (const [id, seconds] of Object.entries(match.waited ?? {})) {
        waited[Number(id)] = (waited[Number(id)] ?? 0) + seconds
      }
    }
    next = {
      ...next,
      stats: Object.fromEntries(
        Object.entries(next.stats).map(([id, stats]) => [id, { ...stats, secondsWaited: waited[Number(id)] ?? 0 }]),
      ),
    }
  }
  return next
}
