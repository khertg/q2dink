import type {
  AuditEntry,
  AuditPage,
  AuthGrant,
  CardLogo,
  CardLogoChoice,
  CardLogoIndex,
  ClubDevice,
  ClubSessionSummary,
  DeletedHistorySummary,
  AvatarIndex,
  ClubRosterPlayer,
  SkillScale,
  ErrorCode,
  HistorySummary,
  LifetimePlayer,
  LiveRow,
  LiveSessionSummary,
  LoginResponse,
  PublicSnapshot,
  PutAvatarRequest,
  PutHistoryRequest,
  RenameClubResponse,
  ResetPasswordResponse,
  PublishMeta,
  SessionStateRow,
  StaffAvatar,
  StaffAvatarIndex,
  VoiceChoice,
  VoiceOptions,
  VoiceSettings,
} from '@q2dink/shared'

/**
 * What became of a publish: taken at `revision`, or refused because the club's copy moved on (another
 * staff device changed it) or ended (`current` null).
 */
export type PublishOutcome = { revision: number } | { conflict: SessionStateRow | null }
import type { FullBackup } from './snapshot'

export interface SubscribeOptions {
  /** Follow this session's own board instead of the club's (its latest live session). */
  sessionId?: string
  /** Staff devices: one of the club's sessions ended. */
  onEnded?: (sessionId: string) => void
}

export type { AvatarIndex, HistorySummary, LifetimePlayer, LiveRow, PutAvatarRequest, PutHistoryRequest }

/**
 * Everything the app needs from a cloud backend. The web app talks only to
 * this interface; `httpApi.ts` implements it against the Q2Dink API, and a
 * different backend could be dropped in by writing another implementation.
 */
export interface CloudApi {
  createClub(name: string, slug: string, password: string): Promise<AuthGrant>
  login(slug: string, password: string): Promise<LoginResponse>
  resetPassword(slug: string, recoveryCode: string, newPassword: string): Promise<ResetPasswordResponse>
  logout(token: string): Promise<void>
  /** Change the club's display name (its URL stays). Returns the name as saved. */
  renameClub(token: string, name: string): Promise<RenameClubResponse>

  /**
   * Publish the running session: the public board plus a private full backup. With `meta.baseRevision`,
   * the club refuses a change made on an older copy and says what it has now (`conflict`).
   */
  publish(token: string, snapshot: PublicSnapshot, backup: FullBackup, meta?: PublishMeta): Promise<PublishOutcome>
  /** The private backup for resuming on another device (the latest session without an id), or null. */
  fetchFullSession(token: string, sessionId?: string): Promise<unknown | null>
  /**
   * The club's private copy of a session with its revision and id, or null if it is not running. Without an
   * id, the club's latest session.
   */
  fetchSessionState(token: string, sessionId?: string): Promise<SessionStateRow | null>
  /** Every session the club is running, with the staff devices that have each open. */
  listSessions(token: string): Promise<ClubSessionSummary[]>
  /** This device has the session open (say it again every few seconds while it does). */
  putPresence(token: string, sessionId: string, deviceId: string): Promise<void>
  /** This device left the session. */
  dropPresence(token: string, sessionId: string, deviceId: string): Promise<void>
  /** The session ended. With `sessionId`, only that one (the club's others keep running). */
  clear(token: string, sessionId?: string): Promise<void>
  /** Add a session's totals to the club leaderboard. Applied once per batch id. */
  recordLifetime(token: string, batchId: string, players: LifetimePlayer[]): Promise<void>

  /** A player was renamed: their leaderboard row and shared avatar move to the new name. Safe to repeat. */
  renamePlayer(token: string, from: string, to: string): Promise<void>

  /** Add players to the club's saved roster, or update the ones it has under those names (ignoring case). */
  putRoster(token: string, players: ClubRosterPlayer[]): Promise<void>
  /** The club's saved roster, shared by all its staff devices. */
  fetchRoster(token: string): Promise<ClubRosterPlayer[]>
  /** The club's skill levels, or null when it uses the default scale. */
  fetchSkillScale(token: string): Promise<SkillScale | null>
  /** Set the club's skill levels (null: back to the default). Returns what the club kept. */
  putSkillScale(token: string, scale: SkillScale | null): Promise<SkillScale | null>

  /** Keep an ended session in the club's history. Sending the same id again replaces it. */
  putHistory(token: string, id: string, entry: Omit<PutHistoryRequest, 'full'>, backup: FullBackup): Promise<void>
  /** The club's ended sessions, newest first, without their contents. */
  listHistory(token: string): Promise<HistorySummary[]>
  /** One ended session in full (a FullBackup), or null if it is gone. */
  fetchHistory(token: string, id: string): Promise<unknown | null>
  /** Move an ended session to Recently deleted, or with `permanent` remove it for good. */
  deleteHistory(token: string, id: string, options?: { permanent?: boolean }): Promise<void>
  /** Bring a deleted session back. */
  restoreHistory(token: string, id: string): Promise<void>
  /** Recently deleted: the club's deleted sessions that can still be restored. */
  listDeletedHistory(token: string): Promise<DeletedHistorySummary[]>

  /** Set a player's avatar; `key` is the lower-case player name. */
  putAvatar(token: string, key: string, avatar: PutAvatarRequest): Promise<void>
  deleteAvatar(token: string, key: string): Promise<void>
  /** Whether the club's public live page shows player photos. Staff devices get them either way. */
  putPhotoSharing(token: string, on: boolean): Promise<void>
  /** Every avatar as it really is, photos included, and whether the club shares photos (staff only). */
  fetchStaffAvatars(token: string): Promise<StaffAvatarIndex>
  /** One avatar with its photo, or null when the player has none (staff only). */
  fetchStaffAvatar(token: string, key: string): Promise<StaffAvatar | null>

  /** The club's card logos (its logo in several colours for the share images) and which one the cards use. */
  fetchCardLogoIndex(token: string): Promise<CardLogoIndex>
  /** One card logo with its image, or null when the club no longer has it. */
  fetchCardLogo(token: string, id: string): Promise<CardLogo | null>
  /** Add or replace a card logo (base64 image). */
  putCardLogo(token: string, id: string, data: string, tone: number): Promise<void>
  deleteCardLogo(token: string, id: string): Promise<void>
  putCardLogoChoice(token: string, choice: CardLogoChoice): Promise<void>
  /** Every avatar the club has. Public, so the live page can use it. */
  fetchAvatarIndex(slug: string): Promise<AvatarIndex>
  /** Where a player's photo is, at this version. */
  avatarPhotoUrl(slug: string, key: string, version: number): string

  /**
   * The public live board of one of the club's sessions, or of its latest live one without an id; null when
   * there is none.
   */
  fetchLive(slug: string, sessionId?: string): Promise<LiveRow | null>
  /** The club's sessions on the public live page, latest first. */
  listLive(slug: string): Promise<LiveSessionSummary[]>
  fetchClubPlayers(slug: string): Promise<LifetimePlayer[]>
  /**
   * Call `onChange` whenever the board changes (a row) or ends (null). Returns
   * an unsubscribe function. Callers should still poll as a fallback.
   */
  subscribeLive(
    slug: string,
    onChange: (row: LiveRow | null) => void,
    onRevision?: (revision: number, sessionId?: string) => void,
    options?: SubscribeOptions,
  ): () => void

  /** Store entries of the audit log. Sending one again stores it once. */
  postAudit(token: string, entries: AuditEntry[]): Promise<void>
  /** One page of the club's audit log, newest first. */
  listAudit(token: string, query?: AuditQuery): Promise<AuditPage>
  /** Name this device for its club. Fails with `name_taken` when another device has that name. */
  registerDevice(token: string, device: { id: string; name: string; label: string }): Promise<void>
  /** The club's named devices. */
  listDevices(token: string): Promise<ClubDevice[]>

  /**
   * A call-out read out by the server's voice (the club's, or `voiceId` to try one), as MP3 audio. Fails with `speech_unavailable` when the
   * server has no voice service (or it refused), so the device uses its own voice.
   */
  speak(token: string, text: string, signal?: AbortSignal, voiceId?: string): Promise<Blob>
  /** The club's call-out voice, and whether the server has ElevenLabs. */
  fetchVoice(token: string): Promise<VoiceSettings>
  /** Choose the club's call-out voice. Returns the club's settings as saved. */
  putVoice(token: string, choice: VoiceChoice): Promise<VoiceSettings>
  /** The ElevenLabs voices the server's key can use. */
  fetchVoiceOptions(token: string): Promise<VoiceOptions>
}

/** Which part of the audit log to read. */
export interface AuditQuery {
  sessionId?: string
  deviceId?: string
  /** Text anywhere in what happened, the device's name or its details, ignoring case. */
  q?: string
  /** A numbered page, from 0: the answer then says how many match in all. */
  page?: number
  /** Only entries before this time: the `next` of the previous page. */
  before?: string
  limit?: number
}

export type CloudErrorCode = ErrorCode | 'network' | 'unknown'

const MESSAGES: Record<Exclude<CloudErrorCode, 'unknown'>, string> = {
  weak_password: 'Passwords need between 8 and 128 characters.',
  invalid_club: 'That club name does not make a valid URL. Use 3 to 40 letters, numbers or dashes.',
  club_slug_taken: 'That club URL is already taken. Try a slightly different club name.',
  invalid_credentials: 'Wrong club URL or password.',
  invalid_recovery_code: 'That recovery code is not valid.',
  invalid_token: 'Your club login expired. Please log in again.',
  invalid_snapshot: 'This session could not be shared with the live board.',
  invalid_players: 'The leaderboard update was rejected.',
  invalid_request: 'The request was not valid.',
  not_found: 'Not found.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  payload_too_large: 'This session is too large to sync.',
  internal_error: 'Something went wrong on the server. Please try again.',
  conflict: 'The session changed on another staff device.',
  name_taken: 'Another device of this club already has that name. Pick another one.',
  speech_unavailable: 'Voice call-outs are not available on the server right now.',
  speech_failed: 'The voice service did not answer.',
  network: 'Cannot reach the server. Check your connection and try again.',
}

export class CloudError extends Error {
  readonly code: CloudErrorCode
  /** The server's answer, for errors that carry more than a code (a `conflict` holds the club's copy). */
  readonly body: unknown
  constructor(code: CloudErrorCode, detail?: string, body?: unknown) {
    super(code === 'unknown' ? (detail ?? 'Something went wrong.') : MESSAGES[code])
    this.name = 'CloudError'
    this.code = code
    this.body = body
  }
}

/** Normalise anything thrown while talking to the backend into a CloudError. */
export function toCloudError(error: unknown): CloudError {
  if (error instanceof CloudError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new CloudError('unknown', message)
}
