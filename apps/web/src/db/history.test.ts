import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { checkIn, createSession, recordResult } from '@/rotation/engine'
import { lifetimeTotals } from '@/rotation/lifetime'
import { fillCourts } from '@/rotation/testing'
import type { SessionState } from '@/rotation/types'
import { SESSION_STORE_VERSION } from '@/store/migrate'
import { db } from './db'
import {
  archiveSession,
  deleteHistory,
  followClubDeletion,
  followClubRestore,
  listDeletedHistory,
  markDeletionSent,
  pendingDeletions,
  purgeExpiredHistory,
  purgeHistoryRecord,
  restoreHistoryRecord,
  softDeleteHistory,
  getHistory,
  listHistory,
  markHistorySynced,
  MAX_HISTORY,
  unsyncedHistory,
} from './history'

beforeEach(async () => {
  await db.history.clear()
})

function session(players = 4, games = 1): SessionState {
  let s = createSession('doubles', 1)
  for (let id = 1; id <= players; id++) s = checkIn(s, { id, name: `P${id}`, skill: 3 })
  for (let g = 0; g < games; g++) s = recordResult(fillCourts(s), 1, 0).state
  return s
}

const archive = (id: string, s: SessionState, now = 1_000, counted = {}) =>
  archiveSession({ id, location: 'Club', startedAt: 500, session: s, lifetimeCounted: counted, now })

describe('archiveSession', () => {
  it('keeps the session as it ended, with a summary', async () => {
    const s = session(6, 2)
    const record = await archive('a', s, 2_000, lifetimeTotals(s))
    expect(record).toMatchObject({
      id: 'a',
      location: 'Club',
      startedAt: 500,
      endedAt: 2_000,
      mode: 'doubles',
      players: 6,
      games: 2,
      storeVersion: SESSION_STORE_VERSION,
      synced: false,
    })
    const stored = await getHistory('a')
    expect(stored?.session).toEqual(s)
    expect(stored?.lifetimeCounted).toEqual(lifetimeTotals(s))
  })

  it('counts games, not player-games', async () => {
    expect((await archive('a', session(4, 3)))?.games).toBe(3)
    let singles = createSession('singles', 1)
    for (let id = 1; id <= 2; id++) singles = checkIn(singles, { id, name: `P${id}`, skill: 3 })
    singles = recordResult(fillCourts(singles), 1, 0).state
    expect((await archive('b', singles))?.games).toBe(1)
  })

  it('saves nothing when nobody ever checked in', async () => {
    expect(await archive('a', createSession('doubles', 2))).toBeNull()
    expect(await db.history.count()).toBe(0)
  })

  it('replaces the record when the same session ends again', async () => {
    await archive('a', session(4, 1), 1_000)
    await markHistorySynced('a')
    await archive('a', session(4, 3), 5_000)
    expect(await db.history.count()).toBe(1)
    const stored = await getHistory('a')
    expect(stored).toMatchObject({ games: 3, endedAt: 5_000, synced: false })
  })

  it('keeps only the newest sessions', async () => {
    for (let n = 1; n <= MAX_HISTORY + 5; n++) await archive(`s${n}`, session(4, 0), n)
    expect(await db.history.count()).toBe(MAX_HISTORY)
    expect(await getHistory('s1')).toBeUndefined()
    expect(await getHistory('s5')).toBeUndefined()
    expect(await getHistory('s6')).toBeDefined()
    expect(await getHistory(`s${MAX_HISTORY + 5}`)).toBeDefined()
  })
})

describe('listHistory', () => {
  it('is newest first and leaves out the sessions themselves', async () => {
    await archive('old', session(), 1_000)
    await archive('new', session(), 9_000)
    await archive('mid', session(), 5_000)
    const list = await listHistory()
    expect(list.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
    for (const row of list) {
      expect(row).not.toHaveProperty('session')
      expect(row).not.toHaveProperty('lifetimeCounted')
    }
  })

  it('lists only the signed-in club’s sessions, and older ones no club has claimed, never another club’s', async () => {
    await archiveSession({ id: 'mine', location: 'L', startedAt: 1, session: session(), lifetimeCounted: {}, clubSlug: 'downtown', now: 3_000 })
    await archiveSession({ id: 'theirs', location: 'L', startedAt: 1, session: session(), lifetimeCounted: {}, clubSlug: 'uptown', now: 2_000 })
    await archive('unclaimed', session(), 1_000)
    expect((await listHistory('downtown')).map((r) => r.id)).toEqual(['mine', 'unclaimed'])
    expect((await listHistory('uptown')).map((r) => r.id)).toEqual(['theirs', 'unclaimed'])
    expect((await listHistory()).map((r) => r.id)).toEqual(['mine', 'theirs', 'unclaimed'])

    await softDeleteHistory('theirs')
    expect(await listDeletedHistory('downtown')).toEqual([])
    expect((await listDeletedHistory('uptown')).map((r) => r.id)).toEqual(['theirs'])
  })
})

describe('sync bookkeeping', () => {
  it('lists what the club does not have yet, until it is marked as sent', async () => {
    await archive('a', session(), 1_000)
    await archive('b', session(), 2_000)
    expect((await unsyncedHistory('downtown')).map((r) => r.id).sort()).toEqual(['a', 'b'])
    await markHistorySynced('a')
    expect((await unsyncedHistory('downtown')).map((r) => r.id)).toEqual(['b'])
  })

  it('only offers a club its own sessions, and ones no club has claimed yet', async () => {
    await archiveSession({ id: 'mine', location: 'L', startedAt: 1, session: session(), lifetimeCounted: {}, clubSlug: 'downtown' })
    await archiveSession({ id: 'theirs', location: 'L', startedAt: 1, session: session(), lifetimeCounted: {}, clubSlug: 'uptown' })
    await archive('unclaimed', session(), 3_000)
    expect((await unsyncedHistory('downtown')).map((r) => r.id).sort()).toEqual(['mine', 'unclaimed'])
    expect((await unsyncedHistory('uptown')).map((r) => r.id).sort()).toEqual(['theirs', 'unclaimed'])
    expect((await unsyncedHistory('elsewhere')).map((r) => r.id)).toEqual(['unclaimed'])
  })

  it('remembers the club that ended a session, and marking it sent records the club too', async () => {
    const saved = await archiveSession({ id: 'a', location: 'L', startedAt: 1, session: session(), lifetimeCounted: {}, clubSlug: 'downtown' })
    expect(saved?.clubSlug).toBe('downtown')
    await archive('b', session(), 2_000)
    expect((await getHistory('b'))?.clubSlug).toBeUndefined()
    await markHistorySynced('b', 'downtown')
    expect(await getHistory('b')).toMatchObject({ synced: true, clubSlug: 'downtown' })
  })

  it('deletes a session', async () => {
    await archive('a', session())
    await deleteHistory('a')
    expect(await getHistory('a')).toBeUndefined()
    await deleteHistory('a') // already gone is fine
  })
})

describe('Recently deleted', () => {
  const DAY = 24 * 60 * 60 * 1000

  it('moves a session out of the list and back, remembering to tell the club each time', async () => {
    await archive('a', session())
    await archive('b', session(), 2_000)
    await softDeleteHistory('a', 5_000)
    expect((await listHistory()).map((r) => r.id)).toEqual(['b'])
    expect(await listDeletedHistory()).toMatchObject([{ id: 'a', deletedAt: 5_000, deletionPending: 'delete' }])

    await markDeletionSent('a', 'delete')
    expect((await getHistory('a'))?.deletionPending).toBeUndefined()

    await restoreHistoryRecord('a')
    expect((await listHistory()).map((r) => r.id)).toEqual(['b', 'a'])
    expect((await pendingDeletions()).map((r) => [r.id, r.deletionPending])).toEqual([['a', 'restore']])
  })

  it('removes a session for good at once with no club, or once the club has been told', async () => {
    await archive('a', session())
    await archive('b', session())
    await purgeHistoryRecord('a', false)
    expect(await getHistory('a')).toBeUndefined()

    await purgeHistoryRecord('b', true, 5_000)
    expect(await listHistory()).toEqual([])
    expect((await getHistory('b'))?.deletionPending).toBe('purge')
    await markDeletionSent('b', 'purge')
    expect(await getHistory('b')).toBeUndefined()
  })

  it('does not forget a change made again while the earlier one was being sent', async () => {
    await archive('a', session())
    await softDeleteHistory('a')
    await restoreHistoryRecord('a')
    await markDeletionSent('a', 'delete') // the delete went through, but a restore is now waiting
    expect((await getHistory('a'))?.deletionPending).toBe('restore')
  })

  it('follows another device deleting or restoring, but never over a change made here', async () => {
    await archive('a', session())
    await archive('b', session())
    await restoreHistoryRecord('b')
    await followClubDeletion('a', 7_000)
    await followClubDeletion('b', 7_000)
    expect((await getHistory('a'))?.deletedAt).toBe(7_000)
    expect((await getHistory('b'))?.deletedAt).toBeUndefined()
    await followClubRestore('a')
    expect((await getHistory('a'))?.deletedAt).toBeUndefined()
  })

  it('removes sessions deleted more than 30 days ago, unless the club still has to be told', async () => {
    const now = 100 * DAY
    for (const id of ['old', 'waiting', 'recent']) await archive(id, session())
    await softDeleteHistory('old', now - 31 * DAY)
    await markDeletionSent('old', 'delete')
    await softDeleteHistory('waiting', now - 31 * DAY)
    await softDeleteHistory('recent', now - 29 * DAY)
    await markDeletionSent('recent', 'delete')
    await purgeExpiredHistory(now)
    expect(await getHistory('old')).toBeUndefined()
    expect(await getHistory('waiting')).toBeDefined()
    expect(await getHistory('recent')).toBeDefined()
  })
})
