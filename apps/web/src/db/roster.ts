import { legacyLevelForRating, ratingForLegacyLevel, type ClubRosterPlayer } from '@q2dink/shared'
import type { PlayerAvatar } from '@/lib/avatar'
import { ratingOf } from '@/lib/skill'
import { cleanPlayerName } from '@/rotation/engine'
import type { RosterPlayer } from '@/rotation/types'
import { db, type Gender } from './db'

/**
 * A saved player keeps a rating (their level on any club's scale comes from it) and, beside it, that rating's level
 * on the default scale, which is what the club's older apps read.
 */
const withRating = (rating: number) => ({ rating, skill: legacyLevelForRating(rating) })

/**
 * Set or remove (null) a saved player's avatar. It is marked as not yet sent to the club, whether
 * it changed or was removed, so the cloud copy follows.
 */
export async function setRosterAvatar(playerId: number, avatar: PlayerAvatar | null): Promise<void> {
  await db.players.update(playerId, { avatar: avatar ?? undefined, avatarDirty: true, avatarVersion: undefined })
}

/**
 * Mark a club's players with a photo as not sent. Photos used to stay on the device unless the club
 * showed them on its live page, so once, after that changed, they are all sent for the club's other devices.
 */
export async function markPhotosDirty(clubSlug: string): Promise<void> {
  await db.players
    .filter((p) => p.clubSlug === clubSlug && p.avatar?.kind === 'photo')
    .modify({ avatarDirty: true })
}

/**
 * Take the club's avatar for a saved player, as another device of the club left it (`version` is the
 * club's). Does nothing if the player's avatar changed here and has not been sent yet: that one goes
 * up next and wins. Null removes an avatar that had come from the club.
 */
export async function setClubAvatar(playerId: number, avatar: PlayerAvatar | null, version?: number): Promise<void> {
  await db.transaction('rw', db.players, async () => {
    const player = await db.players.get(playerId)
    if (!player || player.avatarDirty) return
    await db.players.update(playerId, { avatar: avatar ?? undefined, avatarVersion: avatar ? version : undefined })
  })
}

/** Change a saved player's rating (the level they were given), so they start future sessions at it. */
export async function setRosterRating(playerId: number, rating: number): Promise<void> {
  await db.players.update(playerId, { ...withRating(rating), rosterDirty: true })
}

/**
 * The saved players of one club, or, with no club (a build with no cloud), the ones no club has
 * taken. Every roster lookup goes through this, so one club never sees another's players.
 */
function clubPlayers(clubSlug: string | undefined) {
  return clubSlug === undefined
    ? db.players.filter((p) => p.clubSlug === undefined)
    : db.players.where('clubSlug').equals(clubSlug)
}

/** A club's saved players, alphabetical. */
export async function listRoster(clubSlug: string | undefined): Promise<RosterPlayer[]> {
  const players = (await clubPlayers(clubSlug).toArray()) as RosterPlayer[]
  return players.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

const findByName = (clubSlug: string | undefined, name: string) => {
  const key = name.trim().toLowerCase()
  return clubPlayers(clubSlug)
    .filter((p) => p.name.toLowerCase() === key)
    .first()
}

/**
 * This device's saved player of the club with that name (ignoring case), or undefined. A session's
 * players are matched to saved ones by name: the session's ids are shared by every staff device.
 */
export async function findSavedPlayer(clubSlug: string | undefined, name: string): Promise<RosterPlayer | undefined> {
  return (await findByName(clubSlug, name)) as RosterPlayer | undefined
}

/**
 * The first club to sync on this device takes the players no club has yet, and they are marked to be
 * sent, so a device's existing roster reaches its club once. Returns how many were taken.
 */
export async function claimUnownedPlayers(clubSlug: string): Promise<number> {
  return db.players.filter((p) => p.clubSlug === undefined).modify({ clubSlug, rosterDirty: true })
}

/** A club's players whose changes have not been sent to it yet. */
export async function dirtyRoster(clubSlug: string): Promise<RosterPlayer[]> {
  return (await clubPlayers(clubSlug)
    .filter((p) => p.rosterDirty === true)
    .toArray()) as RosterPlayer[]
}

/**
 * The club now has these players as they were sent: mark them sent, unless one changed again while
 * the upload was on its way (then it stays marked, and goes next time).
 */
export async function markRosterSent(sent: RosterPlayer[]): Promise<void> {
  await db.transaction('rw', db.players, async () => {
    for (const s of sent) {
      const now = await db.players.get(s.id)
      if (now && now.name === s.name && ratingOf(now) === ratingOf(s) && now.gender === s.gender) {
        await db.players.update(s.id, { rosterDirty: false })
      }
    }
  })
}

/**
 * Bring in the club's roster as other devices left it. A player this device has not saved for the club
 * is added; one it has is updated to the club's skill and gender, unless it changed here and has not
 * been sent yet (this device's change goes up next and wins). Avatars and totals are never touched.
 */
export async function mergeClubRoster(clubSlug: string, players: ClubRosterPlayer[]): Promise<void> {
  await db.transaction('rw', db.players, async () => {
    for (const p of players) {
      // An older server sends only the level: it stands for the rating that keeps it on the default scale.
      const rating = p.rating ?? ratingForLegacyLevel(p.skill)
      const local = await findByName(clubSlug, p.name)
      if (!local) {
        await db.players.add({ name: p.name, ...withRating(rating), gender: p.gender, clubSlug, rosterDirty: false })
      } else if (!local.rosterDirty && (ratingOf(local) !== rating || local.gender !== p.gender)) {
        await db.players.update(local.id!, { ...withRating(rating), gender: p.gender })
      }
    }
  })
}

/**
 * Rename a saved player. The new name is trimmed and must not belong to another saved player of the
 * same club (ignoring case); changing only the capitals of their own name is fine. Their totals and
 * avatar stay with them. Returns the old and new names, and throws a RangeError with a readable
 * message when the name is not allowed.
 */
export async function renameRosterPlayer(playerId: number, name: string): Promise<{ from: string; to: string }> {
  const to = cleanPlayerName(name)
  const player = await db.players.get(playerId)
  if (!player) throw new Error('This player is not saved on this device')
  const clash = await findByName(player.clubSlug, to)
  if (clash && clash.id !== playerId) throw new RangeError(`${to} is already saved as a player`)
  if (player.name !== to) await db.players.update(playerId, { name: to, rosterDirty: true })
  return { from: player.name, to }
}

/**
 * Find one of the club's saved players by name (case-insensitive) or create one for that club. An
 * existing player is updated when the rating, or a newly supplied gender, differs.
 */
export async function addOrGetPlayer(
  name: string,
  rating: number,
  gender?: Gender,
  clubSlug?: string,
): Promise<RosterPlayer> {
  const trimmed = name.trim()
  const existing = await findByName(clubSlug, trimmed)
  if (existing?.id !== undefined) {
    const changes: { rating?: number; skill?: number; gender?: Gender } = {}
    if (ratingOf(existing) !== rating) Object.assign(changes, withRating(rating))
    if (gender && existing.gender !== gender) changes.gender = gender
    if (Object.keys(changes).length > 0) await db.players.update(existing.id, { ...changes, rosterDirty: true })
    // Only identity fields go into a session; all-time totals stay on the roster.
    return {
      id: existing.id,
      name: existing.name,
      ...withRating(changes.rating ?? ratingOf(existing)),
      gender: changes.gender ?? existing.gender,
    }
  }
  const id = await db.players.add({
    name: trimmed,
    ...withRating(rating),
    gender,
    rosterDirty: true,
    ...(clubSlug ? { clubSlug } : {}),
  })
  if (id === undefined) throw new Error('Failed to save player')
  return { id, name: trimmed, ...withRating(rating), gender }
}

/**
 * Save a player on the club's roster without checking them in (the Saved players list). `added` is
 * false when the club already had someone of that name; their details are still updated.
 */
export async function savePlayer(
  name: string,
  rating: number,
  gender?: Gender,
  clubSlug?: string,
): Promise<{ player: RosterPlayer; added: boolean }> {
  const known = await findByName(clubSlug, name.trim())
  const player = await addOrGetPlayer(name, rating, gender, clubSlug)
  return { player, added: known === undefined }
}

/** Forget which avatars are waiting to be sent to a club (they were for a different club). */
export async function clearAvatarDirty(): Promise<void> {
  await db.players.filter((p) => p.avatarDirty === true).modify({ avatarDirty: false })
}
