import { toast } from 'sonner'
import { create } from 'zustand'
import { db } from '@/db/db'
import { archiveSession, markDeletionSent, markHistorySynced, pendingDeletions, unsyncedHistory } from '@/db/history'
import {
  claimUnownedPlayers,
  clearAvatarDirty,
  dirtyRoster,
  listRoster,
  markPhotosDirty,
  markRosterSent,
  mergeClubRoster,
  setClubAvatar,
} from '@/db/roster'
import {
  MAX_ROSTER_BATCH,
  legacyLevelForRating,
  type ClubSessionSummary,
  type DeviceSummary,
  type SessionStateRow,
  type SkillScale,
  type StaffAvatar,
} from '@q2dink/shared'
import { ratingOf } from '@/lib/skill'
import { useClubScale } from '@/lib/skillScaleStore'
import {
  addPendingRename,
  clearPendingRenames,
  getPendingRenames,
  getPhotoSharingPending,
  getSharePhotos,
  getSyncClub,
  markPhotosSentFor,
  photosSentFor,
  removePendingRename,
  setPhotoSharingPending,
  setSharePhotos,
  setSyncClub,
} from '@/db/settings'
import { avatarKey, colorFor, dataUrlBase64, type PlayerAvatar } from '@/lib/avatar'
import { NOTHING_UNSENT, type UnsentCounts } from '@/lib/reset'
import { useDevice } from '@/lib/device'
import { otherDevicesOpen, statusChangeMessage } from '@/lib/pause'
import { isLive, lastActivityAt, sessionStatus } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { openBelongsTo, useSessionStore } from '@/store/session'
import { belongsTo, confirmSlice, notAppliedAudits, parkedFor, parkedUnsent, rebaseSlice, sliceOf, type SessionSlice } from '@/store/slices'
import { CloudError, type CloudApi, type PutAvatarRequest } from './api'
import { dropAuditOfOtherClubs, onAuditQueued, queueAudit, recordAudit, removeSentAudit, unsentAudit } from './audit'
import { useClubAuth } from './auth'
import { cloud } from './client'
import { createPublisher, type SyncStatus } from './publisher'
import { newBatchId } from './id'
import { parseFullBackup, toFullBackup, toHistoryBackup, toPublicSnapshot } from './snapshot'

interface SyncStore {
  status: SyncStatus
  setStatus: (status: SyncStatus) => void
  /**
   * The sessions the club is running (from any staff device), latest first, with who has each open: what the
   * setup screen offers to open, and what leaving a session goes by. Empty while signed out or not known yet.
   */
  clubSessions: ClubSessionSummary[]
}

export const useSyncStore = create<SyncStore>()((set) => ({
  status: 'off',
  setStatus: (status) => set({ status }),
  clubSessions: [],
}))

const isExpiredLogin = (error: unknown) => error instanceof CloudError && error.code === 'invalid_token'

/** Errors that retrying cannot fix: the login is gone, or the server refuses this session's data. */
const isPermanent = (error: unknown) =>
  error instanceof CloudError &&
  (error.code === 'invalid_token' || error.code === 'invalid_snapshot' || error.code === 'payload_too_large')

/** An expired staff token means signing out; anything else is left for a retry. */
function handleAuthError(error: unknown) {
  if (isExpiredLogin(error)) {
    useClubAuth.getState().signOut()
    toast.error('Your club login expired. Please log in again.')
  }
}

/**
 * Ask the server whether the saved login still works, so an expired one puts the device on the
 * login screen at launch instead of failing quietly later. Being offline, or a server error, leaves
 * the device logged in: the app is meant to keep working with no signal.
 */
export async function checkLogin(api: CloudApi | null = cloud): Promise<void> {
  const club = useClubAuth.getState().club
  if (!api || !club) return
  try {
    await api.fetchFullSession(club.token)
  } catch (error) {
    // Ignore an answer about a login that has been replaced while this was in flight.
    if (useClubAuth.getState().club?.token === club.token) handleAuthError(error)
  }
}

/**
 * Send finished-session totals that are waiting for the club leaderboard.
 * Safe to call repeatedly: the server applies each batch only once.
 * Returns true when nothing is left waiting for the signed-in club.
 */
export async function flushPendingLifetime(api: CloudApi | null = cloud): Promise<boolean> {
  const { club, pendingLifetime, dequeueLifetime } = useClubAuth.getState()
  if (!api || !club) return false
  for (const item of pendingLifetime.filter((p) => p.slug === club.slug)) {
    try {
      await api.recordLifetime(club.token, item.batchId, item.players)
      dequeueLifetime(item.batchId)
    } catch (error) {
      handleAuthError(error)
      return false
    }
  }
  return true
}

/**
 * Send ended sessions that are not in the club's history yet. Safe to call repeatedly: a session
 * is stored by its id, so sending it twice changes nothing. Returns true when nothing is left waiting.
 */
export async function syncHistory(api: CloudApi | null = cloud): Promise<boolean> {
  const club = useClubAuth.getState().club
  if (!api || !club) return false
  try {
    for (const record of await unsyncedHistory(club.slug)) {
      // Removed for good before the club ever had it: nothing to send.
      if (record.deletionPending === 'purge') {
        await markHistorySynced(record.id, club.slug)
        continue
      }
      try {
        await api.putHistory(
          club.token,
          record.id,
          {
            endedAt: new Date(record.endedAt).toISOString(),
            mode: record.mode,
            players: record.players,
            games: record.games,
          },
          toHistoryBackup(record.location, record.session, record.storeVersion, record.lifetimeCounted),
        )
      } catch (error) {
        // A session the server will never accept stays on this device only; retrying cannot help.
        if (!isPermanent(error) || isExpiredLogin(error)) throw error
      }
      await markHistorySynced(record.id, club.slug)
    }
    // Then deletes, restores and removals made here, now that the club has every session they are about.
    for (const record of await pendingDeletions()) {
      if (record.clubSlug !== undefined && record.clubSlug !== club.slug) continue
      const sent = record.deletionPending
      if (sent === 'restore') await api.restoreHistory(club.token, record.id)
      else await api.deleteHistory(club.token, record.id, { permanent: sent === 'purge' })
      await markDeletionSent(record.id, sent)
    }
    return true
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

/**
 * Make sure the avatar changes waiting on this device are for the club that is logged in.
 * The first club to log in takes them. If a different club logs in later, the earlier club's unsent
 * avatar changes are dropped (never sent to the new club), and photo sharing goes back to off,
 * which is the private default for a club that has not chosen it. Sessions are tagged with their club
 * and the leaderboard totals with their slug, so those already stay with the right club.
 * Safe to call repeatedly.
 */
export async function adoptClub(slug: string): Promise<void> {
  // Saved players no club has taken yet (from before rosters were shared) belong to the first club to sync.
  await claimUnownedPlayers(slug)
  const previous = await getSyncClub()
  if (previous === slug) return
  if (previous !== undefined) {
    await clearAvatarDirty()
    await clearPendingRenames()
    // The photo switch belongs to the earlier club; this club's own setting arrives with the next sync.
    await setPhotoSharingPending(false)
    await setSharePhotos(false)
  }
  await setSyncClub(slug)
}

/** A rename the club will never accept (a name it refuses) is dropped: retrying cannot help. */
const isRenameRefused = (error: unknown) =>
  isPermanent(error) || (error instanceof CloudError && error.code === 'invalid_request')

/**
 * Tell the club about players renamed on this device, in the order they were renamed, so their
 * leaderboard row and shared avatar move to the new name. Safe to call repeatedly (the club treats
 * a repeat as nothing to do). Returns true when nothing is left waiting.
 */
export async function flushRenames(api: CloudApi | null = cloud): Promise<boolean> {
  const club = useClubAuth.getState().club
  if (!api || !club) return false
  try {
    await adoptClub(club.slug)
    for (const rename of await getPendingRenames()) {
      try {
        await api.renamePlayer(club.token, rename.from, rename.to)
      } catch (error) {
        if (!isRenameRefused(error) || isExpiredLogin(error)) throw error
      }
      await removePendingRename(rename)
    }
    return true
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

/**
 * A player was renamed on this device: remember to move the club's copy of them, and make sure
 * totals still waiting to upload use the new name. Does nothing when there is no cloud.
 */
export async function queueClubRename(from: string, to: string, api: CloudApi | null = cloud): Promise<void> {
  if (!api || from === to) return
  useClubAuth.getState().renamePendingLifetime(from, to)
  await addPendingRename({ from, to })
  void runSync(api)
}

/**
 * One pass over everything waiting to reach the club. Renames go first, so a name that changed is
 * never uploaded under its old spelling by the passes that follow.
 */
async function runSync(api: CloudApi): Promise<void> {
  const renamed = await flushRenames(api)
  await Promise.all([
    flushAudit(api),
    flushPendingLifetime(api),
    syncHistory(api),
    syncMedia(api),
    syncSkillScale(api),
    renamed ? exchangeRoster(api) : Promise.resolve(false),
  ])
}

/**
 * The club's skill levels: a change made here for this club goes up; otherwise the club's are taken (another staff
 * device may have changed them). A change made here for another club is dropped by taking this club's. Returns
 * false when the club could not be reached.
 */
export async function syncSkillScale(api: CloudApi | null = cloud): Promise<boolean> {
  const club = useClubAuth.getState().club
  if (!api || !club) return false
  try {
    const local = useClubScale.getState()
    if (local.pending && local.clubSlug === club.slug) {
      const kept = await api.putSkillScale(club.token, local.scale)
      if (useClubAuth.getState().club?.slug === club.slug) useClubScale.getState().markSent(kept)
    } else {
      const scale = await api.fetchSkillScale(club.token)
      if (useClubAuth.getState().club?.slug === club.slug) useClubScale.getState().takeClub(scale, club.slug)
    }
    return true
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

/**
 * Staff chose other skill levels for the club (null: back to the default). Kept here at once, sent to the club (and
 * so its other devices) now or with the next sync. Sessions already running keep theirs until staff apply the new ones.
 */
export function saveClubSkillScale(scale: SkillScale | null, api: CloudApi | null = cloud): void {
  const slug = useClubAuth.getState().club?.slug
  useClubScale.getState().setLocal(scale, slug)
  recordAudit(
    'skillScale',
    scale ? `Changed the club’s skill levels to ${scale.levels.map((l) => l.label).join(', ')}` : 'Went back to the default skill levels',
  )
  void syncSkillScale(api)
}

/**
 * What this device has not sent the club yet, for the signed-in club: what a reset of this device would
 * lose. Nothing without a club (a build with no cloud keeps everything on the device only).
 */
export async function countUnsent(): Promise<UnsentCounts> {
  const club = useClubAuth.getState().club
  if (!club) return NOTHING_UNSENT
  const slug = club.slug
  const { pending, endedSessionIds, parked } = useSessionStore.getState()
  const [activity, history, roster, renames, avatars, photoSharing] = await Promise.all([
    db.auditQueue.where('clubSlug').equals(slug).count(),
    unsyncedHistory(slug),
    dirtyRoster(slug),
    getPendingRenames(),
    db.players.filter((p) => p.avatarDirty === true && p.clubSlug === slug).count(),
    getPhotoSharingPending(),
  ])
  return {
    sessionChanges: pending.length + parkedUnsent(parked),
    sessionEnd: endedSessionIds.length > 0,
    activity,
    pastSessions: history.length,
    savedPlayers: roster.length,
    renames: renames.length,
    leaderboard: useClubAuth.getState().pendingLifetime.filter((p) => p.slug === slug).length,
    avatars,
    photoSharing,
    skillLevels: useClubScale.getState().pending && useClubScale.getState().clubSlug === slug,
  }
}

/** Send everything waiting on this device now (the running session follows by itself when online). */
export async function sendEverythingNow(api: CloudApi | null = cloud): Promise<void> {
  if (!api || !useClubAuth.getState().club) return
  await runSync(api)
  await syncRoster(api)
}

/** Entries per POST /audit. */
const AUDIT_BATCH = 100

let auditFlush: Promise<boolean> | null = null

/**
 * Send the audit log entries made here to the club, oldest first, and forget each batch once the club has
 * it. Entries queued for another club are dropped. One flush at a time; a failed batch waits for the next.
 * Returns true when nothing is left to send.
 */
export function flushAudit(api: CloudApi | null = cloud): Promise<boolean> {
  auditFlush ??= sendAudit(api).finally(() => {
    auditFlush = null
  })
  return auditFlush
}

async function sendAudit(api: CloudApi | null): Promise<boolean> {
  const club = useClubAuth.getState().club
  if (!api || !club) return false
  try {
    await dropAuditOfOtherClubs(club.slug)
    const entries = await unsentAudit(club.slug)
    for (let i = 0; i < entries.length; i += AUDIT_BATCH) {
      const batch = entries.slice(i, i + AUDIT_BATCH)
      await api.postAudit(club.token, batch)
      await removeSentAudit(batch.map((e) => e.id))
    }
    return true
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

/**
 * Share the club's saved players between its staff devices: send the ones added or changed here, then
 * bring in the ones other devices added or changed. Renames go first, so a renamed player is never
 * brought back under the old name. Safe to call repeatedly. Returns true when everything went through.
 */
export async function syncRoster(api: CloudApi | null = cloud): Promise<boolean> {
  if (!api || !(await flushRenames(api))) return false
  return exchangeRoster(api)
}

/** The roster part of syncRoster, once renames are through. */
async function exchangeRoster(api: CloudApi): Promise<boolean> {
  const club = useClubAuth.getState().club
  if (!club) return false
  try {
    const dirty = await dirtyRoster(club.slug)
    for (let i = 0; i < dirty.length; i += MAX_ROSTER_BATCH) {
      const batch = dirty.slice(i, i + MAX_ROSTER_BATCH)
      await api.putRoster(
        club.token,
        // The rating decides the level on the club's scale; `skill` is its level on the default scale, for older apps.
        batch.map((p) => {
          const rating = ratingOf(p)
          return { name: p.name, skill: legacyLevelForRating(rating), rating, ...(p.gender ? { gender: p.gender } : {}) }
        }),
      )
      await markRosterSent(batch)
    }
    // The club may have changed while this ran (another club logged in): never file its players under this one.
    const players = await api.fetchRoster(club.token)
    if (useClubAuth.getState().club?.slug !== club.slug) return false
    await mergeClubRoster(club.slug, players)
    await pullAvatars(api, club)
    return true
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

const ROSTER_SYNC_DELAY_MS = 1000
const ROSTER_POLL_MS = 30_000
/** How often a staff device checks the club's copy of the session, in case the live stream dropped. */
const SESSION_POLL_MS = 15_000
/** The club's list of sessions is read at most this often. */
const LIST_MIN_GAP_MS = 5_000
let rosterSyncTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Sync the roster soon: after a player was added or changed here (a burst of check-ins goes up as one
 * request), or when check-in opens. Does nothing with no cloud or no club.
 */
export function requestRosterSync(api: CloudApi | null = cloud): void {
  if (!api || !useClubAuth.getState().club) return
  clearTimeout(rosterSyncTimer)
  rosterSyncTimer = setTimeout(() => void syncRoster(api), ROSTER_SYNC_DELAY_MS)
}

/** A club avatar as this device keeps it on a saved player. */
function toPlayerAvatar(avatar: StaffAvatar, name: string): PlayerAvatar | null {
  if (avatar.kind === 'photo') return avatar.photo ? { kind: 'photo', data: `data:${avatar.photo.type};base64,${avatar.photo.data}` } : null
  if (avatar.kind === 'emoji') return avatar.emoji ? { kind: 'emoji', value: avatar.emoji, color: avatar.color ?? colorFor(name) } : null
  return { kind: 'initials', color: avatar.color ?? colorFor(name) }
}

/**
 * Bring in the avatars the club's other staff devices set, photos included, so every device of the
 * club shows the same faces. Each saved player whose avatar did not change here takes the club's when
 * the club's version differs from the one it has, and loses one that had come from the club when the
 * club no longer has it. Also takes the club's photo switch, unless it was just changed here.
 */
async function pullAvatars(api: CloudApi, club: { slug: string; token: string }): Promise<void> {
  const index = await api.fetchStaffAvatars(club.token)
  if (!(await getPhotoSharingPending())) await setSharePhotos(index.sharePhotos)
  for (const player of await listRoster(club.slug)) {
    if (player.avatarDirty) continue
    const shared = index.avatars[avatarKey(player.name)]
    if (!shared) {
      if (player.avatarVersion !== undefined) await setClubAvatar(player.id, null)
      continue
    }
    if (player.avatarVersion === shared.v) continue
    const avatar = await api.fetchStaffAvatar(club.token, avatarKey(player.name))
    if (useClubAuth.getState().club?.slug !== club.slug) return
    const local = avatar && toPlayerAvatar(avatar, player.name)
    if (local) await setClubAvatar(player.id, local, avatar.v)
  }
}

/** What the club is sent for an avatar. */
function avatarRequest(avatar: PlayerAvatar): PutAvatarRequest {
  if (avatar.kind === 'photo') return { kind: 'photo', photo: { data: dataUrlBase64(avatar.data) } }
  if (avatar.kind === 'emoji') return { kind: 'emoji', emoji: avatar.value, color: avatar.color }
  return { kind: 'initials', color: avatar.color }
}

/**
 * Send player avatars (photos too: the club's other staff devices use them) and the
 * photo switch that changed on this device. Whether the public live page shows the photos is the
 * club's switch, not a reason to keep them here. Safe to call repeatedly. Returns true when nothing is
 * left waiting.
 */
export async function syncMedia(api: CloudApi | null = cloud): Promise<boolean> {
  const club = useClubAuth.getState().club
  if (!api || !club) return false
  // A request the server will never accept is dropped: retrying cannot help.
  const attempt = async (send: () => Promise<void>) => {
    try {
      await send()
    } catch (error) {
      if (!isPermanent(error) || isExpiredLogin(error)) throw error
    }
  }
  try {
    // Inside the try: if the device's storage cannot be read this is a failed sync, never a rejection
    // that nobody handles (callers do `void syncMedia()`).
    await adoptClub(club.slug)
    if (await getPhotoSharingPending()) {
      await api.putPhotoSharing(club.token, await getSharePhotos())
      await setPhotoSharingPending(false)
    }
    // Photos set while they only went to the club with sharing on are sent once now.
    if (!(await photosSentFor(club.slug))) {
      await markPhotosDirty(club.slug)
      await markPhotosSentFor(club.slug)
    }

    for (const player of await db.players
      .filter((p) => p.avatarDirty === true && p.clubSlug === club.slug)
      .toArray()) {
      const key = avatarKey(player.name)
      const sent = player.avatar
      await attempt(() => (sent ? api.putAvatar(club.token, key, avatarRequest(sent)) : api.deleteAvatar(club.token, key)))
      // Only forget the change if it was not changed again while it was being sent.
      const now = await db.players.get(player.id!)
      if (JSON.stringify(now?.avatar) === JSON.stringify(sent)) await db.players.update(player.id!, { avatarDirty: false })
    }
    return true
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

/**
 * Turn showing player photos on the club's public live page on or off, for the whole club (now, or as
 * soon as it is reachable). The photos stay with the club's staff devices either way.
 */
export async function setPhotoSharing(on: boolean, api: CloudApi | null = cloud): Promise<void> {
  recordAudit('photoSharing', on ? 'Turned on player photos on the live page' : 'Turned off player photos on the live page')
  await setSharePhotos(on)
  await setPhotoSharingPending(true)
  await syncMedia(api)
}

/** Say which of this device's changes another staff device's got there first for. */
function reportDropped(dropped: { reason: string }[]) {
  for (const { reason } of dropped) toast.warning(`Not applied, changed on another device: ${reason}`)
}

/** The session with this id, open or parked here, or null. */
function findSlice(sessionId: string): SessionSlice | null {
  const store = useSessionStore.getState()
  if (store.session && store.sessionId === sessionId) return sliceOf(store)
  return store.parked[sessionId] ?? null
}

/**
 * The club's copy of the open session, as another staff device left it (or null when it ended). Take it and
 * apply this device's unsent changes on top; follow it when it ended elsewhere. A copy of another session (an
 * older server answers with its latest one) is not this one's business.
 */
export async function adoptClubCopy(clubRow: SessionStateRow | null, api: CloudApi | null = cloud): Promise<void> {
  const store = useSessionStore.getState()
  // Not open, or not shared yet (just started, or never sent): the first send decides.
  if (!store.session || !store.base) return
  if (!clubRow) {
    // It ended on another device, after this one had it: follow, keeping a copy here.
    if (store.base.revision > 0) await endedElsewhere(api, sliceOf(store)!)
    return
  }
  if (clubRow.sessionId !== null && clubRow.sessionId !== store.sessionId) return
  if (clubRow.revision <= store.base.revision) return
  const parsed = parseFullBackup(clubRow.full)
  if (!parsed) return
  const before = store.session
  reportDropped(useSessionStore.getState().rebaseOnto(clubRow.revision, parsed.session, parsed.location))
  // A pause shows its own dialog; a start or resume from another device is worth a word.
  const after = useSessionStore.getState().session
  const message = after && statusChangeMessage(before, after, useDevice.getState().id)
  if (message) toast(message)
}

/** The club's copy of a parked session: its unsent changes go on top of it, or it ended elsewhere. */
async function adoptParkedCopy(sessionId: string, clubRow: SessionStateRow | null, api: CloudApi | null): Promise<void> {
  const slice = useSessionStore.getState().parked[sessionId]
  if (!slice?.base) return
  if (!clubRow) {
    if (slice.base.revision > 0) await endedElsewhere(api, slice)
    return
  }
  if (clubRow.revision <= slice.base.revision) return
  const parsed = parseFullBackup(clubRow.full)
  if (!parsed) return
  const rebased = rebaseSlice(slice, clubRow.revision, parsed.session, parsed.location)
  useSessionStore.getState().updateParked(sessionId, () => rebased.slice)
  const notApplied = notAppliedAudits(rebased.dropped)
  if (notApplied.length > 0) void queueAudit(notApplied)
  reportDropped(rebased.dropped)
}

/**
 * When a session that ended on another device really ended: the time that device kept it under, else
 * the last thing that happened in it. This device may only find out hours later (it was asleep), and
 * resuming takes the time since the end off every timer, so "now" would add those hours to them.
 */
async function endedAtFor(api: CloudApi | null, token: string | undefined, sessionId: string, session: SessionState) {
  const now = Date.now()
  let endedAt: number | undefined
  if (api && token && navigator.onLine) {
    try {
      const entry = (await api.listHistory(token)).find((s) => s.id === sessionId)
      if (entry) endedAt = Date.parse(entry.endedAt)
    } catch {
      // Not there or not reachable: fall back to the session's own times.
    }
  }
  if (endedAt === undefined || Number.isNaN(endedAt)) endedAt = lastActivityAt(session)
  return endedAt === undefined ? now : Math.min(endedAt, now)
}

/** Another staff device ended a session this one has (open or parked): keep it in Past sessions here, and leave it. */
async function endedElsewhere(api: CloudApi | null, slice: SessionSlice): Promise<void> {
  const club = useClubAuth.getState().club
  const unsent = slice.pending.length
  try {
    const saved = await archiveSession({
      id: slice.sessionId,
      location: slice.location,
      startedAt: slice.startedAt,
      session: slice.session,
      lifetimeCounted: slice.lifetimeCounted,
      clubSlug: slice.clubSlug ?? club?.slug,
      now: await endedAtFor(api, club?.token, slice.sessionId, slice.session),
    })
    // The device that ended it sends the club its copy; this one only keeps its own.
    if (saved) await markHistorySynced(saved.id, club?.slug)
  } catch {
    // Keeping a local copy is a courtesy; leaving the session is what matters.
  }
  const store = useSessionStore.getState()
  if (store.session && store.sessionId === slice.sessionId) store.endSession()
  else store.dropParked(slice.sessionId)
  toast(
    `“${slice.location}” was ended on another device` +
      (unsent > 0 ? `. ${unsent === 1 ? '1 change' : `${unsent} changes`} made here had not been sent.` : ''),
  )
}

/** Join a session the club has running, alongside the devices already running it. */
export function joinClubSession(row: SessionStateRow): boolean {
  const parsed = parseFullBackup(row.full)
  if (!parsed) return false
  useSessionStore.getState().joinShared(
    parsed.location,
    parsed.session,
    {
      sessionId: row.sessionId ?? newBatchId(),
      startedAt: row.startedAt ? Date.parse(row.startedAt) : Date.now(),
      lifetimeCounted: parsed.lifetimeCounted,
    },
    row.revision,
  )
  recordAudit('sessionJoined', `Joined “${parsed.location}”, running on another device`, row.sessionId ?? undefined)
  return true
}

/**
 * Open one of the sessions running: one left on this device (with its unsent changes), else the club's copy.
 * Returns false when it could not be opened (not reachable, or it has ended since).
 */
export async function openRunningSession(sessionId: string, api: CloudApi | null = cloud): Promise<boolean> {
  const store = useSessionStore.getState()
  if (store.session && store.sessionId === sessionId) return true
  if (store.parked[sessionId]) {
    store.openSession(sessionId)
    return true
  }
  const club = useClubAuth.getState().club
  if (!api || !club) return false
  try {
    const row = await api.fetchSessionState(club.token, sessionId)
    return row !== null && row.sessionId === sessionId && joinClubSession(row)
  } catch (error) {
    handleAuthError(error)
    return false
  }
}

/** How long leaving waits for the club to say who else has the session open, before going by what it knew. */
const LEAVE_CHECK_MS = 3000

/** What leaving did: whether it paused the session, and the staff devices that still have it open. */
export interface LeaveOutcome {
  paused: boolean
  stillOpenOn: DeviceSummary[]
}

/**
 * Leave the open session without ending it. It keeps running while another staff device has it open;
 * otherwise it is paused (recorded as paused because this device left), so no waiting time runs while
 * nobody looks after it. Without a cloud, or not knowing, it is paused: resuming is one tap.
 */
export async function leaveOpenSession(api: CloudApi | null = cloud): Promise<LeaveOutcome> {
  const { session, sessionId } = useSessionStore.getState()
  if (!session) return { paused: false, stillOpenOn: [] }
  const myId = useDevice.getState().id
  const club = useClubAuth.getState().club
  let summary = useSyncStore.getState().clubSessions.find((s) => s.sessionId === sessionId)
  if (api && club && navigator.onLine) {
    try {
      const list = await Promise.race([
        api.listSessions(club.token),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), LEAVE_CHECK_MS)),
      ])
      useSyncStore.setState({ clubSessions: list })
      summary = list.find((s) => s.sessionId === sessionId)
    } catch (error) {
      handleAuthError(error)
    }
  }
  const stillOpenOn = otherDevicesOpen(summary, myId)
  const current = useSessionStore.getState()
  // Something else was opened meanwhile: that is not the one to leave.
  if (current.sessionId !== sessionId || !current.session) return { paused: false, stillOpenOn }
  const paused = stillOpenOn.length === 0 && sessionStatus(current.session) === 'running'
  current.leaveSession({ pause: stillOpenOn.length === 0 })
  if (api && club) void api.dropPresence(club.token, sessionId, myId).catch(() => undefined)
  return { paused, stillOpenOn }
}

export function startCloudSync(api: CloudApi | null = cloud): () => void {
  if (!api) return () => {}

  const signedIn = () => useClubAuth.getState().club
  const setStatus = (status: SyncStatus) => useSyncStore.getState().setStatus(status)
  setStatus(signedIn() ? 'idle' : 'off')

  // Sends and fetches of the shared sessions never overlap, so a fetched copy is never mixed up with a
  // send still on its way.
  let queue: Promise<unknown> = Promise.resolve()
  const serially = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
  /**
   * Tell the club the sessions that ended here have ended, if it has not been told yet (only those, so the
   * club's other sessions are never ended).
   */
  const sendEnd = async (club: { token: string; slug: string }) => {
    for (const ended of [...useSessionStore.getState().endedSessionIds]) {
      // Another club's session: its end waits for that club to log in again.
      if (!belongsTo(useSessionStore.getState().endedClubs?.[ended], club.slug)) continue
      await api.clear(club.token, ended)
      useSessionStore.setState((s) => {
        const { [ended]: _sent, ...endedClubs } = s.endedClubs ?? {}
        return { endedSessionIds: s.endedSessionIds.filter((id) => id !== ended), endedClubs }
      })
    }
  }

  /**
   * Send one session's unsent changes (open or parked), on the revision this device last had. Refused as out of
   * date: take the club's copy and apply them again on top; the caller sends again.
   */
  const sendSession = async (club: { token: string }, sessionId: string): Promise<'sent' | 'nothing' | 'rebased'> => {
    const store = useSessionStore.getState()
    // Not shared yet: from now on its changes are kept until the club has them, and this first send decides.
    if (store.session && store.sessionId === sessionId) store.shareSession()
    else if (store.parked[sessionId] && !store.parked[sessionId].base) {
      store.updateParked(sessionId, (s) => ({ ...s, base: { revision: 0, session: s.session }, pending: [] }))
    }
    const slice = findSlice(sessionId)
    if (!slice?.base) return 'nothing'
    const { base, pending, session, location, locationPending, startedAt } = slice
    // Nothing new here (the change came from another device): nothing to send. A rename alone is new.
    if (pending.length === 0 && !locationPending && base.revision > 0) return 'nothing'
    const outcome = await api.publish(club.token, toPublicSnapshot(location, session), toFullBackup(location, session), {
      baseRevision: base.revision,
      sessionId,
      startedAt: new Date(startedAt).toISOString(),
      live: isLive(session),
    })
    const now = useSessionStore.getState()
    if ('revision' in outcome) {
      if (now.session && now.sessionId === sessionId) {
        now.confirmPublished(pending.length, session, outcome.revision, location)
      } else if (now.parked[sessionId]) {
        const { slice: sent, confirmed } = confirmSlice(now.parked[sessionId], pending.length, session, outcome.revision, location)
        now.updateParked(sessionId, () => sent)
        if (confirmed.length > 0) void queueAudit(confirmed)
      }
      return 'sent'
    }
    // Moved on elsewhere: take the club's copy and apply this device's changes on top.
    if (now.session && now.sessionId === sessionId) await adoptClubCopy(outcome.conflict, api)
    else await adoptParkedCopy(sessionId, outcome.conflict, api)
    return 'rebased'
  }

  /** Send what the sessions left on this device (parked) have not sent yet. */
  const sendParked = async (club: { token: string; slug: string }) => {
    for (const [sessionId, slice] of Object.entries(useSessionStore.getState().parked)) {
      // One left while another club was signed in is that club's: never sent here.
      if (!parkedFor(slice, club.slug)) continue
      // A refusal means a rebase; a few rounds settle it even with another device busy on it.
      for (let round = 0; round < 3; round++) {
        if ((await sendSession(club, sessionId)) !== 'rebased') break
      }
    }
  }

  const publisher = createPublisher({
    publish: () =>
      serially(async () => {
        const club = signedIn()
        if (!club) return
        const { session, sessionId } = useSessionStore.getState()
        try {
          // Sessions that ended here: end them on the club first (only those).
          await sendEnd(club)
          // Only ever this club's own session (another club's is parked when this one logs in).
          if (session && openBelongsTo(club.slug)) await sendSession(club, sessionId)
          await sendParked(club)
        } catch (error) {
          handleAuthError(error)
          throw error
        }
      }),
    clear: async () => {
      const club = signedIn()
      if (!club) return
      try {
        await serially(async () => {
          await sendEnd(club)
          await sendParked(club)
        })
      } catch (error) {
        handleAuthError(error)
        throw error
      }
    },
    isOnline: () => navigator.onLine,
    setStatus: (status) => {
      if (signedIn()) setStatus(status)
    },
    isFatal: isPermanent,
  })

  // Only publish a session that exists. Sending "no session" on start-up would
  // wipe a session another staff device is running.
  const pushIfRunning = () => {
    const { location, session, endedSessionIds, parked } = useSessionStore.getState()
    if (session) publisher.push(location, session)
    // A session ended or left here, and the app closed before the club was told: tell it now.
    else if (endedSessionIds.length > 0 || parkedUnsent(parked) > 0) publisher.push(location, null)
  }

  // A change logged here goes to the club shortly after (a burst of changes goes up together).
  let auditTimer: ReturnType<typeof setTimeout> | undefined
  const stopAuditHook = onAuditQueued(() => {
    clearTimeout(auditTimer)
    auditTimer = setTimeout(() => {
      if (signedIn() && navigator.onLine) void flushAudit(api)
    }, 1000)
  })

  /** Which session the club was last told this device has open, so leaving it can be said too. */
  let presentIn = ''
  const tellPresence = async () => {
    const club = signedIn()
    const { session, sessionId } = useSessionStore.getState()
    const open = session && openBelongsTo(club?.slug) ? sessionId : ''
    const myId = useDevice.getState().id
    if (presentIn && presentIn !== open) {
      const left = presentIn
      presentIn = ''
      if (club && navigator.onLine) void api.dropPresence(club.token, left, myId).catch(() => undefined)
    }
    if (!open || !club || !navigator.onLine) return
    try {
      await api.putPresence(club.token, open, myId)
      presentIn = open
    } catch (error) {
      handleAuthError(error)
    }
  }

  /**
   * The club's running sessions, for the setup screen and for leaving. A busy club changes something every few
   * seconds, and all its devices (and players' phones) often share one Wi-Fi address and so one request budget:
   * a burst of changes reads the list once, a few seconds later.
   */
  let listTimer: ReturnType<typeof setTimeout> | undefined
  let lastListAt = 0
  const refreshList = () => {
    if (listTimer) return
    listTimer = setTimeout(() => {
      listTimer = undefined
      lastListAt = Date.now()
      void readList()
    }, Math.max(0, lastListAt + LIST_MIN_GAP_MS - Date.now()))
  }
  const readList = () =>
    serially(async () => {
      const club = signedIn()
      if (!club || !navigator.onLine) return
      try {
        const list = await api.listSessions(club.token)
        if (signedIn()?.slug !== club.slug) return
        useSyncStore.setState({ clubSessions: list })
        // A parked session the club no longer runs, with nothing waiting to be sent: it ended elsewhere.
        for (const slice of Object.values(useSessionStore.getState().parked)) {
          const sentBefore = slice.base !== null && slice.base.revision > 0
          // Only this club can say one of its sessions ended; another club's list never has them.
          const ours = slice.clubSlug === club.slug
          if (ours && sentBefore && slice.pending.length === 0 && !list.some((s) => s.sessionId === slice.sessionId)) {
            await adoptParkedCopy(slice.sessionId, null, api)
          }
        }
      } catch (error) {
        handleAuthError(error)
      }
    })

  const unsubscribeSession = useSessionStore.subscribe((state, prev) => {
    if (!signedIn()) return
    if (state.session !== prev.session || state.location !== prev.location || state.parked !== prev.parked) {
      publisher.push(state.location, state.session)
    }
    // Another session opened here: say so to the club, and catch up with what other devices did in it.
    if (state.sessionId !== prev.sessionId) {
      void tellPresence()
      void refresh()
    }
  })

  // Follow the club's copy of the open session: the club's stream says when it changed; the private copy is
  // then fetched with the staff login. A poll covers a stream that dropped.
  const refresh = () =>
    serially(async () => {
      const club = signedIn()
      if (!club || !navigator.onLine) return
      const { session, sessionId, base } = useSessionStore.getState()
      // Another club's session is not this club's to follow: it would look ended here.
      if (!session || !base || !openBelongsTo(club.slug)) return
      try {
        const row = await api.fetchSessionState(club.token, sessionId)
        const now = useSessionStore.getState()
        if (signedIn()?.slug === club.slug && now.sessionId === sessionId) await adoptClubCopy(row, api)
      } catch (error) {
        handleAuthError(error)
      }
    })
  let unsubscribeLive: () => void = () => {}
  const follow = () => {
    unsubscribeLive()
    unsubscribeLive = () => {}
    const club = signedIn()
    if (!club) return
    unsubscribeLive = api.subscribeLive(
      club.slug,
      // The club's latest public board: nothing staff devices need (changes come as revisions).
      () => undefined,
      // Every change to one of the club's sessions, live on the public page or not.
      (revision, sessionId) => {
        const { base, sessionId: open } = useSessionStore.getState()
        if (sessionId === undefined || sessionId === open) {
          if (!base || revision > base.revision) void refresh()
        }
        void refreshList()
      },
      {
        // One of the club's sessions ended: follow it if it is one this device has.
        onEnded: (sessionId) => {
          const store = useSessionStore.getState()
          if (store.session && store.sessionId === sessionId) void refresh()
          void refreshList()
        },
      },
    )
    void refresh()
    void refreshList()
  }

  const unsubscribeAuth = useClubAuth.subscribe((state, prev) => {
    if (state.club && !prev.club) {
      recordAudit('signedIn', 'Logged in on this device')
      setStatus('idle')
      pushIfRunning()
      follow()
      void tellPresence()
      void runSync(api)
    } else if (!state.club && prev.club) {
      setStatus('off')
      unsubscribeLive()
      unsubscribeLive = () => {}
      presentIn = ''
      useSyncStore.setState({ clubSessions: [] })
    }
  })

  const handleOnline = () => {
    void checkLogin(api)
    publisher.onOnline()
    void refresh()
    void refreshList()
    void tellPresence()
    void runSync(api)
  }
  const handleOffline = () => {
    if (signedIn()) setStatus('offline')
  }
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  // Players added on the club's other devices show up here within about this long.
  const rosterPoll = setInterval(() => {
    if (signedIn() && navigator.onLine) void syncRoster(api)
  }, ROSTER_POLL_MS)
  const sessionPoll = setInterval(() => {
    void refresh()
    void refreshList()
    void tellPresence()
  }, SESSION_POLL_MS)

  if (signedIn()) {
    void checkLogin(api)
    pushIfRunning()
    follow()
    void tellPresence()
    void runSync(api)
  }

  return () => {
    clearTimeout(listTimer)
    publisher.dispose()
    stopAuditHook()
    clearTimeout(auditTimer)
    unsubscribeSession()
    unsubscribeAuth()
    unsubscribeLive()
    clearInterval(sessionPoll)
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    clearInterval(rosterPoll)
  }
}
