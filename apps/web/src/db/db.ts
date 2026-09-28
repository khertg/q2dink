import Dexie, { type EntityTable } from 'dexie'
import type { AuditEntry } from '@q2dink/shared'
import type { PlayerAvatar } from '@/lib/avatar'
import type { HistoryRecord } from './history'
import { migrateLegacyDatabase } from './legacyMigration'

/**
 * A level on a skill scale, 1 (the lowest) up to the number of levels the scale has (at most 10). Saved players
 * keep a rating (see Player.rating); their level is worked out from it on whichever scale is in use.
 */
export type SkillLevel = number

export type Gender = 'M' | 'F'

export interface Player {
  id?: number
  name: string
  /**
   * On the roster: the rating's level on the default scale (what the club's older apps read). In a session: the level
   * on the session's scale, which matchmaking and court ranges use.
   */
  skill: SkillLevel
  /**
   * The player's rating (1.0 to 8.0, DUPR style), which decides their level on any scale. Missing for a player saved
   * before ratings existed: `skill` (1 to 6) then stands for it (see ratingOf in lib/skill.ts).
   */
  rating?: number
  gender?: Gender
  /**
   * How this player appears. Kept on the roster only, never in a session, so photos stay out of
   * saved sessions and the live board. Missing means automatic initials.
   */
  avatar?: PlayerAvatar
  /** The club's cloud copy is out of date (changed or removed here, not yet sent). */
  avatarDirty?: boolean
  /**
   * The club's version of `avatar` when it was taken from the club (set on another staff device), so an
   * unchanged one is not fetched again. Missing when the avatar was set here.
   */
  avatarVersion?: number
  /**
   * The club this player belongs to. Only that club's players are listed while it is logged in.
   * Missing on players saved before a club took them (or in a build with no cloud): the first club
   * to sync on this device takes them.
   */
  clubSlug?: string
  /** Name, skill or gender changed here and the club's roster has not been sent it yet. */
  rosterDirty?: boolean
  /** All-time totals across saved sessions. */
  games?: number
  wins?: number
  losses?: number
}

export interface Session {
  id?: number
  location: string
  courts: number
  mode: 'doubles' | 'singles'
  createdAt: number
}

/** Small device settings: the club logo and whether player photos are shared on the live page. */
export interface Setting {
  key: string
  value: unknown
}

/**
 * One of the club's card logos (its logo in one colour), for the Standings and Stats share images. `clubSlug` is
 * missing in a build with no cloud. `dirty` says what the club has not been told yet: a new or changed logo, or one
 * removed here (kept until the club has it, so the removal can be sent).
 */
export interface CardLogoRow {
  id: string
  clubSlug?: string
  /** The image as a data URL. */
  data: string
  /** How light it is, 0 to 1 (see lib/cardLogos.ts). */
  tone: number
  /** The club's version of it, once the club has it. */
  v?: number
  /** When it was added here, for its place in the list. */
  addedAt: number
  dirty?: 'put' | 'delete'
}

/** An audit log entry made here and not sent to the club yet, for the club that was signed in. */
export interface QueuedAudit extends AuditEntry {
  clubSlug: string
}

export const db = new Dexie('q2dink') as Dexie & {
  players: EntityTable<Player, 'id'>
  sessions: EntityTable<Session, 'id'>
  /** Ended sessions, kept so they can be viewed and resumed. */
  history: EntityTable<HistoryRecord, 'id'>
  settings: EntityTable<Setting, 'key'>
  /** Audit log entries waiting to be sent to the club (see cloud/audit.ts). */
  auditQueue: EntityTable<QueuedAudit, 'id'>
  /** The club's card logos (see db/cardLogos.ts). */
  cardLogos: EntityTable<CardLogoRow, 'id'>
}

db.version(1).stores({
  players: '++id, name',
  sessions: '++id, createdAt',
})

// Version 2 adds the history of ended sessions. The old sessions table is unused and left as it was.
db.version(2).stores({
  players: '++id, name',
  sessions: '++id, createdAt',
  history: 'id, endedAt',
})

// Version 3 adds device settings (the club logo, photo sharing). Player avatars are plain extra fields.
db.version(3).stores({
  players: '++id, name',
  sessions: '++id, createdAt',
  history: 'id, endedAt',
  settings: 'key',
})

// Version 4 indexes each player's club, so a club only lists its own players. Nothing to upgrade: a player
// without one is unclaimed until a club syncs.
db.version(4).stores({
  players: '++id, name, clubSlug',
  sessions: '++id, createdAt',
  history: 'id, endedAt',
  settings: 'key',
})

// Version 5 adds the queue of audit log entries not sent to the club yet.
db.version(5).stores({
  players: '++id, name, clubSlug',
  sessions: '++id, createdAt',
  history: 'id, endedAt',
  settings: 'key',
  auditQueue: 'id, at, clubSlug',
})

// Version 6: clubs no longer have logos. A logo this device kept (and might still send) is dropped.
db.version(6)
  .stores({
    players: '++id, name, clubSlug',
    sessions: '++id, createdAt',
    history: 'id, endedAt',
    settings: 'key',
    auditQueue: 'id, at, clubSlug',
  })
  .upgrade((tx) => tx.table('settings').delete('logo'))

// Version 7 adds the club's card logos (its logo in several colours, for the share images).
db.version(7).stores({
  players: '++id, name, clubSlug',
  sessions: '++id, createdAt',
  history: 'id, endedAt',
  settings: 'key',
  auditQueue: 'id, at, clubSlug',
  cardLogos: 'id, clubSlug',
})

// A device that used the app under its old name brings its data across (see legacyMigration.ts) before the
// first query runs.
db.on('ready', () => migrateLegacyDatabase(db))
