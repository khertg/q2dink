import { HISTORY_TRASH_DAYS } from '@q2dink/shared'
import type { GameMode, MatchmakingMode, SessionState } from '@/rotation/types'
import type { LifetimeCounts } from '@/rotation/lifetime'
import { SESSION_STORE_VERSION } from '@/store/migrate'
import { db } from './db'

/** How many ended sessions are kept on this device. */
export const MAX_HISTORY = 100

/** A session as it stood when it ended, so it can be looked at or resumed. */
export interface HistoryRecord {
  /** The session's id; ending a resumed session updates its record instead of adding one. */
  id: string
  location: string
  startedAt: number
  endedAt: number
  mode: GameMode
  matchmaking: MatchmakingMode
  /** Players who took part. */
  players: number
  /** Games finished. */
  games: number
  session: SessionState
  /** The session shape `session` is in, so a later version of the app can upgrade it on resume. */
  storeVersion: number
  /** What this session had added to the all-time totals when it ended. */
  lifetimeCounted: LifetimeCounts
  /** Whether the club cloud has this version. Stays true on devices that never sign in. */
  synced: boolean
  /**
   * The club that was logged in when it ended, so it only ever goes to that club's cloud, even if
   * another club logs in on this device later. Absent on sessions from before this was recorded:
   * the first club to sync one takes it.
   */
  clubSlug?: string
  /** When it was deleted (ms since the epoch): it is in Recently deleted, and can be restored for a while. */
  deletedAt?: number
  /** A delete, restore or removal for good made here that the club has not been told of yet. */
  deletionPending?: 'delete' | 'restore' | 'purge'
}

export type HistorySummary = Omit<HistoryRecord, 'session' | 'storeVersion' | 'lifetimeCounted'>

export function summarize(session: SessionState) {
  const games = Object.values(session.stats).reduce((sum, s) => sum + s.games, 0)
  // Every player is counted in a game once per side, so a doubles game is four player-games.
  const perGame = session.mode === 'doubles' ? 4 : 2
  return { players: Object.keys(session.players).length, games: Math.round(games / perGame) }
}

/**
 * Save a session that has ended. Returns null, saving nothing, when nobody ever checked in.
 * Saving the same id again replaces the earlier record.
 */
export async function archiveSession(input: {
  id: string
  location: string
  startedAt: number
  session: SessionState
  lifetimeCounted: LifetimeCounts
  /** The club logged in right now, if any. */
  clubSlug?: string
  now?: number
}): Promise<HistoryRecord | null> {
  const { session } = input
  if (Object.keys(session.players).length === 0) return null
  const record: HistoryRecord = {
    id: input.id,
    location: input.location,
    // When staff pressed Start session, for a session set up before it started.
    startedAt: session.startedAt ?? input.startedAt,
    endedAt: input.now ?? Date.now(),
    mode: session.mode,
    matchmaking: session.matchmaking,
    ...summarize(session),
    session,
    storeVersion: SESSION_STORE_VERSION,
    lifetimeCounted: input.lifetimeCounted,
    synced: false,
    ...(input.clubSlug ? { clubSlug: input.clubSlug } : {}),
  }
  await db.transaction('rw', db.history, async () => {
    await db.history.put(record)
    const surplus = (await db.history.count()) - MAX_HISTORY
    if (surplus > 0) {
      const oldest = await db.history.orderBy('endedAt').limit(surplus).primaryKeys()
      await db.history.bulkDelete(oldest)
    }
  })
  return record
}

const summaryOf = ({ session: _s, storeVersion: _v, lifetimeCounted: _c, ...summary }: HistoryRecord): HistorySummary => summary

/**
 * Whether a past session is shown to this club: its own, and older ones no club has claimed yet. Another club's
 * never are. Without a club (a build with no cloud), all of them.
 */
const shownTo = (record: HistoryRecord, clubSlug: string | undefined) =>
  clubSlug === undefined || record.clubSlug === undefined || record.clubSlug === clubSlug

/**
 * Past sessions that are not deleted, newest first, for the club signed in (see shownTo). Without the session
 * itself, so a long list stays light.
 */
export async function listHistory(clubSlug?: string): Promise<HistorySummary[]> {
  const records = await db.history.orderBy('endedAt').reverse().toArray()
  return records.filter((r) => r.deletedAt === undefined && shownTo(r, clubSlug)).map(summaryOf)
}

/** Recently deleted on this device, most recently deleted first, for the club signed in (see shownTo). */
export async function listDeletedHistory(clubSlug?: string): Promise<HistorySummary[]> {
  const records = await db.history.filter((r) => r.deletedAt !== undefined && shownTo(r, clubSlug)).toArray()
  return records.sort((a, b) => b.deletedAt! - a.deletedAt!).map(summaryOf)
}

/** Move a past session to Recently deleted, and remember to tell the club. */
export async function softDeleteHistory(id: string, now = Date.now()): Promise<void> {
  await db.history.update(id, { deletedAt: now, deletionPending: 'delete' })
}

/** Bring a deleted past session back, and remember to tell the club. */
export async function restoreHistoryRecord(id: string): Promise<void> {
  await db.history.update(id, { deletedAt: undefined, deletionPending: 'restore' })
}

/**
 * Remove a past session for good. The club still has to be told, so the record stays (hidden) until it is,
 * or goes at once when there is no club to tell.
 */
export async function purgeHistoryRecord(id: string, tellClub: boolean, now = Date.now()): Promise<void> {
  if (!tellClub) {
    await db.history.delete(id)
    return
  }
  const record = await db.history.get(id)
  if (record) await db.history.update(id, { deletedAt: record.deletedAt ?? now, deletionPending: 'purge' })
}

/** The club has been told of a pending delete, restore or removal. A removed record goes for good. */
export async function markDeletionSent(id: string, sent: HistoryRecord['deletionPending']): Promise<void> {
  const record = await db.history.get(id)
  if (!record || record.deletionPending !== sent) return
  if (sent === 'purge') await db.history.delete(id)
  else await db.history.update(id, { deletionPending: undefined })
}

/** The club deleted a session this device still lists: follow it (unless this device restored it since). */
export async function followClubDeletion(id: string, deletedAt: number): Promise<void> {
  const record = await db.history.get(id)
  if (record && record.deletedAt === undefined && record.deletionPending === undefined) {
    await db.history.update(id, { deletedAt })
  }
}

/** Deletes and restores made here that the club has not been told of yet. */
export const pendingDeletions = () => db.history.filter((r) => r.deletionPending !== undefined).toArray()

/** Sessions deleted over HISTORY_TRASH_DAYS ago are removed for good (once nothing is waiting to be sent). */
export async function purgeExpiredHistory(now = Date.now()): Promise<void> {
  const limit = now - HISTORY_TRASH_DAYS * 24 * 60 * 60 * 1000
  const expired = await db.history
    .filter((r) => r.deletedAt !== undefined && r.deletedAt < limit && r.deletionPending === undefined)
    .primaryKeys()
  await db.history.bulkDelete(expired)
}

export const getHistory = (id: string) => db.history.get(id)

export const deleteHistory = (id: string) => db.history.delete(id)

/** The club has this session. Also records which club, so it is never offered to another one. */
export async function markHistorySynced(id: string, clubSlug?: string): Promise<void> {
  await db.history.update(id, clubSlug ? { synced: true, clubSlug } : { synced: true })
}

/** Sessions waiting to be sent to this club: its own, and older ones that no club has claimed yet. */
export const unsyncedHistory = (clubSlug: string) =>
  db.history.filter((r) => !r.synced && (r.clubSlug === undefined || r.clubSlug === clubSlug)).toArray()

/** Another device restored a session this device had deleted by following the club: follow again. */
export async function followClubRestore(id: string): Promise<void> {
  const record = await db.history.get(id)
  if (record && record.deletedAt !== undefined && record.deletionPending === undefined) {
    await db.history.update(id, { deletedAt: undefined })
  }
}
