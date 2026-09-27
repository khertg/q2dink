import type { SkillScale } from './skillScale'

/**
 * The HTTP contract between the web app and the API.
 * All routes live under /api and speak JSON. Errors look like
 * { "error": "<ErrorCode>", "message": "..." }.
 */

export const ERROR_CODES = [
  'weak_password',
  'invalid_club',
  'club_slug_taken',
  'invalid_credentials',
  'invalid_recovery_code',
  'invalid_token',
  'invalid_snapshot',
  'invalid_players',
  'invalid_request',
  'not_found',
  'rate_limited',
  'payload_too_large',
  'internal_error',
  'conflict',
  'name_taken',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ErrorBody {
  error: ErrorCode
  message: string
}

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128
export const MAX_CLUB_NAME_LENGTH = 80
export const MAX_PLAYER_NAME_LENGTH = 80
export const MAX_LOCATION_LENGTH = 120
export const MAX_COURT_NAME_LENGTH = 40

// ---- requests and responses -------------------------------------------------

export interface CreateClubRequest {
  name: string
  slug: string
  password: string
}

/** PUT /club/name (staff): the club's display name. The slug, i.e. the live link, never changes. */
export interface RenameClubRequest {
  name: string
}

export interface RenameClubResponse {
  name: string
}

/** Returned when a club is created or its password is reset. The recovery code is shown once. */
export interface AuthGrant {
  token: string
  recoveryCode: string
}

/** Returned after a password reset: a new login, a new recovery code, and the club name to display. */
export interface ResetPasswordResponse extends AuthGrant {
  name: string
}

export interface LoginRequest {
  password: string
}

export interface LoginResponse {
  token: string
  name: string
}

export interface ResetPasswordRequest {
  recoveryCode: string
  newPassword: string
}

export interface LifetimePlayer {
  name: string
  games: number
  wins: number
  losses: number
}

export interface RecordLifetimeRequest {
  /** Makes retries safe: a batch is applied at most once. */
  batchId: string
  players: LifetimePlayer[]
}

/** A player was renamed: the club's leaderboard row and shared avatar move to the new name. */
export interface RenamePlayerRequest {
  from: string
  to: string
}

// ---- club roster ---------------------------------------------------------------

/** How many saved players a club keeps in the cloud. */
export const MAX_ROSTER_PLAYERS = 1000
/** Players sent in one PUT /roster. */
export const MAX_ROSTER_BATCH = 200

/**
 * A saved player, shared by every staff device of a club. Matched by lower-case name (the same key
 * as the leaderboard and avatars), because roster ids only mean something on the device that made them.
 */
export interface ClubRosterPlayer {
  name: string
  /** The level 1 to 6 on the default scale: what older apps, which know only six levels, read and send. */
  skill: number
  /**
   * The player's rating (1.0 to 8.0, DUPR style), which decides their level on any club's scale. Missing from older
   * apps: the server then takes it from `skill`. Always sent back.
   */
  rating?: number
  gender?: 'M' | 'F'
}

/** Adds players to the club's roster, or updates the ones it already has under those names. */
export interface PutRosterRequest {
  players: ClubRosterPlayer[]
}

export interface RosterResponse {
  players: ClubRosterPlayer[]
}

// ---- skill levels ---------------------------------------------------------------

/** `GET /skill-scale` and the body of `PUT /skill-scale`: the club's skill levels, null for the default scale. */
export interface SkillScaleBody {
  scale: SkillScale | null
}

/** A live session as viewers receive it. */
export interface LiveRow {
  state: unknown
  updatedAt: string
  /**
   * The club's copy of the session changed to this revision. Staff devices use it as a signal to fetch
   * the private copy (`GET /session/state`); it tells viewers nothing. Missing from older servers.
   */
  revision?: number
  /** Which of the club's sessions this is. Missing from older servers (one session per club). */
  sessionId?: string
}

/**
 * `PUT /session` extras for several staff devices running one session. All optional, so an older app
 * that sends none of them keeps today's last-write-wins.
 */
export interface PublishMeta {
  /** The revision this device's change was made on. A stale one is refused with `conflict`. */
  baseRevision?: number
  /** The session this is (a UUID made on the device that started it). */
  sessionId?: string
  /** ISO time the session started. */
  startedAt?: string
  /**
   * Whether players see it on the public live page. False keeps it off that page while staff devices still
   * share it. Missing (older apps) means live.
   */
  live?: boolean
}

export interface PublishResponse {
  updatedAt: string
  revision: number
}

/** `GET /session/state` (staff): the club's private copy of the running session and its revision. */
export interface SessionStateRow {
  revision: number
  sessionId: string | null
  startedAt: string | null
  /** A FullBackupEnvelope. */
  full: unknown
}

/**
 * The body of a 409 `conflict` from `PUT /session`: the club's copy moved on since `baseRevision`
 * (another staff device changed it), or it ended (`current` null). The device rebases and tries again.
 */
export interface ConflictBody extends ErrorBody {
  current: SessionStateRow | null
}

/**
 * Server-Sent Events on /clubs/:slug/live/stream (the club: `revision` and `ended` for every session, for staff
 * devices, plus `update`/`cleared` for its latest live session, for older viewers) and on
 * /clubs/:slug/live/:sessionId/stream (one session's board). `revision` carries only the club copy's revision:
 * staff devices follow each other with it even while the session is not live. Viewers ignore it.
 */
export type LiveEvent =
  | { type: 'update'; row: LiveRow }
  | { type: 'cleared'; sessionId?: string }
  | { type: 'revision'; revision: number; sessionId?: string }
  /** One of the club's sessions ended (staff devices only; older apps and viewers ignore the event name). */
  | { type: 'ended'; sessionId: string }

// ---- several sessions per club ------------------------------------------------

/** A running session's state, as lists show it. */
export type SessionStatus = 'notStarted' | 'paused' | 'running'

/** A staff device, by the id it made for itself and the name staff gave it. */
export interface DeviceSummary {
  deviceId: string
  name: string
}

/** `GET /sessions` (staff): one of the sessions the club is running. */
export interface ClubSessionSummary {
  sessionId: string
  location: string
  status: SessionStatus
  /** On the public live page. */
  live: boolean
  revision: number
  /** ISO time the session was created on its device. */
  startedAt: string | null
  updatedAt: string
  /** Checked in: waiting, playing or on a break. */
  players: number
  /** Staff devices that have it open right now (seen within the last minute or so). */
  openOn: DeviceSummary[]
  /** While paused: the device that paused it. */
  pausedBy?: DeviceSummary
}

export interface SessionsResponse {
  sessions: ClubSessionSummary[]
}

/** `GET /clubs/:slug/lives` (public): the club's sessions on the live page. */
export interface LiveSessionSummary {
  sessionId: string
  location: string
  status: SessionStatus
  updatedAt: string
}

export interface LiveSessionsResponse {
  sessions: LiveSessionSummary[]
}

/** `PUT /sessions/:id/presence` (staff): this device has the session open. */
export interface PresenceRequest {
  deviceId: string
}

// ---- session history ---------------------------------------------------------

/** How many ended sessions a club keeps in the cloud. The oldest go first. Deleted ones do not count. */
export const MAX_HISTORY_PER_CLUB = 100

/** How long a deleted past session can still be restored before it is removed for good. */
export const HISTORY_TRASH_DAYS = 30

/** An ended session in the club's history list, without its contents. */
export interface HistorySummary {
  /** The session's id (a UUID made on the device that ran it). */
  id: string
  location: string
  /** ISO time the session ended. */
  endedAt: string
  mode: 'doubles' | 'singles'
  /** Players who took part. */
  players: number
  /** Games finished. */
  games: number
}

/** `GET /history/deleted`: a past session in Recently deleted, and when it was deleted (ISO time). */
export interface DeletedHistorySummary extends HistorySummary {
  deletedAt: string
}

/** Saves an ended session. Sending the same id again replaces the earlier version. */
export interface PutHistoryRequest {
  endedAt: string
  mode: 'doubles' | 'singles'
  players: number
  games: number
  /** The whole session, as a FullBackupEnvelope. */
  full: unknown
}

// ---- player avatars -----------------------------------------------------------

/** Caps on what a club may store, in bytes of the decoded image. */
export const MEDIA_LIMITS = {
  avatarPhotoBytes: 48 * 1024,
  /** Avatars a club can keep on the server. */
  avatars: 500,
  emojiChars: 8,
} as const

export type AvatarKind = 'photo' | 'emoji' | 'initials'

/** A player's avatar as the club's server stores it. The photo itself is fetched from its own URL. */
export interface AvatarInfo {
  kind: AvatarKind
  /** For "emoji": the emoji. */
  emoji?: string
  /** "#rrggbb": the badge colour for "emoji" and "initials". */
  color?: string
  /** Changes whenever the avatar does; used in the photo URL so browsers can cache it. */
  v: number
}

/** `GET /clubs/:slug/avatars`: every avatar the club has, by lower-case player name. */
export interface AvatarIndex {
  avatars: Record<string, AvatarInfo>
  /** Always null: clubs no longer have logos. Kept so older cached apps still read the index. */
  logo: null
  /** The club's display name, or null for an unknown slug (looks the same as any other unset field here). */
  name: string | null
}

/**
 * `GET /avatars` (staff only): every avatar as it really is, photos included whether or not the club
 * shows them on its live page, and whether it does. The public index lists a photo as initials while
 * `sharePhotos` is off.
 */
export interface StaffAvatarIndex extends AvatarIndex {
  sharePhotos: boolean
}

/** `GET /avatars/:key` (staff only): one avatar with its photo, so a staff device can keep a copy. */
export interface StaffAvatar {
  kind: AvatarKind
  emoji?: string
  color?: string
  /** For "photo": the image as base64 text and its type. */
  photo?: { data: string; type: 'image/png' | 'image/jpeg' | 'image/webp' }
  v: number
}

/** `PUT /photo-sharing`: whether the club's live page shows player photos. */
export interface PhotoSharingRequest {
  on: boolean
}

/** An image sent to the server as base64 text. The server decides its type from the bytes. */
export interface ImageUpload {
  data: string
}

/** `PUT /avatars/:key` */
export interface PutAvatarRequest {
  kind: AvatarKind
  emoji?: string
  color?: string
  /** Required for kind "photo". */
  photo?: ImageUpload
}

/** How a player's name is turned into an avatar key: trimmed and lower case, like the club leaderboard. */
export const avatarKey = (name: string) => name.trim().toLowerCase()
