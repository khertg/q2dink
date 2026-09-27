import type {
  ClubSessionSummary,
  DeviceSummary,
  FullBackupEnvelope,
  LiveRow,
  LiveSessionSummary,
  PublicSnapshot,
  PublishMeta,
  SessionStateRow,
  SessionStatus,
} from '@q2dink/shared'
import { randomUUID } from 'node:crypto'
import type { Db, Queryable } from '../db'

const toIso = (value: unknown) => new Date(value as string | number | Date).toISOString()

/** A staff device counts as having a session open while it said so within this long. */
export const PRESENCE_SECONDS = 45

type StoredRow = { revision: string | number; session_id: string; started_at: unknown; state: unknown }

const toStateRow = (row: StoredRow): SessionStateRow => ({
  revision: Number(row.revision),
  sessionId: row.session_id,
  startedAt: row.started_at ? toIso(row.started_at) : null,
  full: row.state,
})

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** What a session's private copy says about it, for lists: its name, whether it runs, who is in it. */
export function describeBackup(state: unknown): {
  location: string
  status: SessionStatus
  players: number
  pausedBy?: DeviceSummary
} {
  const envelope = isObject(state) ? state : {}
  const session = isObject(envelope.session) ? envelope.session : {}
  const status: SessionStatus =
    session.notStarted === true ? 'notStarted' : typeof session.clockStoppedAt === 'number' ? 'paused' : 'running'
  const ids = new Set<number>()
  const add = (list: unknown) => {
    if (Array.isArray(list)) for (const id of list) if (typeof id === 'number') ids.add(id)
  }
  add(session.queue)
  add(session.onBreak)
  if (Array.isArray(session.courts)) {
    for (const court of session.courts) {
      if (isObject(court) && Array.isArray(court.teams)) for (const team of court.teams) add(team)
    }
  }
  const by = session.pausedBy
  const pausedBy =
    status === 'paused' && isObject(by) && typeof by.deviceId === 'string' && typeof by.name === 'string'
      ? { deviceId: by.deviceId.slice(0, 64), name: by.name.slice(0, 80) }
      : undefined
  return {
    location: typeof envelope.location === 'string' ? envelope.location : '',
    status,
    players: ids.size,
    ...(pausedBy ? { pausedBy } : {}),
  }
}

/** The session a request with no session id means (an older app, one session per club): the latest one. */
async function latestSessionId(db: Queryable, slug: string): Promise<string | null> {
  const { rows } = await db.query<{ session_id: string }>(
    'select session_id from session_backups where club_slug = $1 order by updated_at desc limit 1',
    [slug],
  )
  return rows[0]?.session_id ?? null
}

/**
 * A publish that went through: the session it was for, its public row while live (null while not), whether a
 * public row was there before (so viewers can be told it is gone), the new revision and when it was stored.
 */
export type PublishResult =
  | { sessionId: string; row: LiveRow | null; wasLive: boolean; revision: number; updatedAt: string }
  | { conflict: SessionStateRow | null }

/**
 * Store one session's public snapshot and private backup together, moving its revision on. A club runs
 * several sessions side by side, each keyed by its id. With `meta.baseRevision` (several staff devices
 * running one session) the write is refused, returning the club's copy, when that copy has moved on since
 * or has ended; without it (an older app) the write simply replaces whatever is there. With no session id
 * (a much older app) it goes to the club's latest session.
 */
export async function publishSession(
  db: Db,
  slug: string,
  snapshot: PublicSnapshot,
  backup: FullBackupEnvelope,
  meta: PublishMeta = {},
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const sessionId = meta.sessionId ?? (await latestSessionId(tx, slug)) ?? randomUUID()
    const { rows } = await tx.query<StoredRow>(
      `select revision, session_id, started_at, state from session_backups
       where club_slug = $1 and session_id = $2 for update`,
      [slug, sessionId],
    )
    const stored = rows[0]
    if (meta.baseRevision !== undefined) {
      // A new session may start, but a change to one that has since ended may not.
      if (!stored && meta.baseRevision > 0) return { conflict: null }
      if (stored && Number(stored.revision) !== meta.baseRevision) return { conflict: toStateRow(stored) }
    }
    const revision = (stored ? Number(stored.revision) : 0) + 1

    // Not live: staff devices still share it (the backup below), but the public page does not show it.
    let row: LiveRow | null = null
    let wasLive = true
    if (meta.live === false) {
      const removed = await tx.query('delete from live_sessions where club_slug = $1 and session_id = $2', [slug, sessionId])
      wasLive = (removed.rowCount ?? 0) > 0
    } else {
      const live = await tx.query<{ updated_at: string }>(
        `insert into live_sessions (club_slug, session_id, state, updated_at)
         values ($1, $2, $3::jsonb, now())
         on conflict (club_slug, session_id) do update set state = excluded.state, updated_at = excluded.updated_at
         returning updated_at`,
        [slug, sessionId, JSON.stringify(snapshot)],
      )
      row = { state: snapshot, updatedAt: toIso(live.rows[0].updated_at), revision, sessionId }
    }
    const backedUp = await tx.query<{ updated_at: unknown }>(
      `insert into session_backups (club_slug, session_id, state, updated_at, revision, started_at)
       values ($1, $2, $3::jsonb, now(), $4, $5)
       on conflict (club_slug, session_id) do update set
         state = excluded.state, updated_at = excluded.updated_at, revision = excluded.revision,
         started_at = coalesce(excluded.started_at, session_backups.started_at)
       returning updated_at`,
      [slug, sessionId, JSON.stringify(backup), revision, meta.startedAt ?? null],
    )
    return { sessionId, row, wasLive, revision, updatedAt: row?.updatedAt ?? toIso(backedUp.rows[0].updated_at) }
  })
}

/**
 * A public live session, unless it is not on the live page or has not been updated within `ttlHours`. With no
 * session id: the club's most recently updated live session (older viewers and the club's own QR code).
 */
export async function getLiveSession(
  db: Queryable,
  slug: string,
  ttlHours: number,
  sessionId?: string,
): Promise<LiveRow | null> {
  const { rows } = await db.query<{ state: unknown; updated_at: string; revision: string | number | null; session_id: string }>(
    `select l.state, l.updated_at, l.session_id, b.revision from live_sessions l
     left join session_backups b on b.club_slug = l.club_slug and b.session_id = l.session_id
     where l.club_slug = $1 and l.updated_at > now() - ($2 * interval '1 hour')
       and ($3::uuid is null or l.session_id = $3::uuid)
     order by l.updated_at desc limit 1`,
    [slug, ttlHours, sessionId ?? null],
  )
  const row = rows[0]
  if (!row) return null
  return {
    state: row.state,
    updatedAt: toIso(row.updated_at),
    sessionId: row.session_id,
    ...(row.revision !== null ? { revision: Number(row.revision) } : {}),
  }
}

/** The club's sessions on the public live page, most recently updated first. */
export async function listLiveSessions(db: Queryable, slug: string, ttlHours: number): Promise<LiveSessionSummary[]> {
  const { rows } = await db.query<{ session_id: string; updated_at: unknown; state: unknown; backup: unknown }>(
    `select l.session_id, l.updated_at, l.state, b.state as backup from live_sessions l
     left join session_backups b on b.club_slug = l.club_slug and b.session_id = l.session_id
     where l.club_slug = $1 and l.updated_at > now() - ($2 * interval '1 hour')
     order by l.updated_at desc`,
    [slug, ttlHours],
  )
  return rows.map((row) => {
    const snapshot = isObject(row.state) ? row.state : {}
    return {
      sessionId: row.session_id,
      location: typeof snapshot.location === 'string' ? snapshot.location : '',
      status: describeBackup(row.backup).status,
      updatedAt: toIso(row.updated_at),
    }
  })
}

/** The private full backup, for resuming on another device. With no session id: the latest. */
export async function getFullSession(db: Queryable, slug: string, sessionId?: string): Promise<unknown | null> {
  return (await getSessionState(db, slug, sessionId))?.full ?? null
}

/** The private copy with its revision and session, for staff devices running the session together. */
export async function getSessionState(db: Queryable, slug: string, sessionId?: string): Promise<SessionStateRow | null> {
  const { rows } = await db.query<StoredRow>(
    `select revision, session_id, started_at, state from session_backups
     where club_slug = $1 and ($2::uuid is null or session_id = $2::uuid)
     order by updated_at desc limit 1`,
    [slug, sessionId ?? null],
  )
  return rows[0] ? toStateRow(rows[0]) : null
}

/** Every session the club is running, most recently updated first, with the staff devices that have each open. */
export async function listSessions(db: Queryable, slug: string): Promise<ClubSessionSummary[]> {
  const { rows } = await db.query<StoredRow & { updated_at: unknown; live: boolean }>(
    `select b.revision, b.session_id, b.started_at, b.state, b.updated_at,
       exists (select 1 from live_sessions l where l.club_slug = b.club_slug and l.session_id = b.session_id) as live
     from session_backups b where b.club_slug = $1 order by b.updated_at desc`,
    [slug],
  )
  const present = await db.query<{ session_id: string; device_id: string; name: string | null; label: string | null }>(
    `select p.session_id, p.device_id, d.name, d.label from session_presence p
     left join club_devices d on d.club_slug = p.club_slug and d.device_id = p.device_id
     where p.club_slug = $1 and p.seen_at > now() - ($2 * interval '1 second')
     order by p.seen_at desc`,
    [slug, PRESENCE_SECONDS],
  )
  return rows.map((row) => {
    const described = describeBackup(row.state)
    return {
      sessionId: row.session_id,
      location: described.location,
      status: described.status,
      live: row.live && described.status !== 'notStarted',
      revision: Number(row.revision),
      startedAt: row.started_at ? toIso(row.started_at) : null,
      updatedAt: toIso(row.updated_at),
      players: described.players,
      openOn: present.rows
        .filter((p) => p.session_id === row.session_id)
        .map((p) => ({ deviceId: p.device_id, name: p.name ?? p.label ?? 'Another device' })),
      ...(described.pausedBy ? { pausedBy: described.pausedBy } : {}),
    }
  })
}

/** This staff device has the session open (said again every few seconds while it does). */
export async function touchPresence(db: Queryable, slug: string, sessionId: string, deviceId: string): Promise<void> {
  await db.query(
    `insert into session_presence (club_slug, session_id, device_id, seen_at) values ($1, $2, $3, now())
     on conflict (club_slug, session_id, device_id) do update set seen_at = now()`,
    [slug, sessionId, deviceId],
  )
  // Old rows only answer "who was here long ago": nobody asks.
  await db.query(`delete from session_presence where club_slug = $1 and seen_at < now() - interval '1 day'`, [slug])
}

/** This staff device left the session (or closed it). */
export async function dropPresence(db: Queryable, slug: string, sessionId: string, deviceId: string): Promise<void> {
  await db.query('delete from session_presence where club_slug = $1 and session_id = $2 and device_id = $3', [
    slug,
    sessionId,
    deviceId,
  ])
}

/**
 * End one session. With no session id (an older app, one session per club), the latest. Other sessions the
 * club is running are never touched. Returns the session it ended, or null when there was nothing to end.
 */
export async function clearSession(db: Db, slug: string, sessionId?: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const target = sessionId ?? (await latestSessionId(tx, slug))
    if (!target) return null
    const live = await tx.query('delete from live_sessions where club_slug = $1 and session_id = $2', [slug, target])
    const backup = await tx.query('delete from session_backups where club_slug = $1 and session_id = $2', [slug, target])
    await tx.query('delete from session_presence where club_slug = $1 and session_id = $2', [slug, target])
    return (live.rowCount ?? 0) + (backup.rowCount ?? 0) > 0 ? target : null
  })
}
