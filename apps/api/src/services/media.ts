import { MEDIA_LIMITS, avatarKey, type AvatarInfo, type PutAvatarRequest, type StaffAvatar } from '@q2dink/shared'
import { createHash } from 'node:crypto'
import type { Db, Queryable } from '../db'
import { AppError } from '../errors'

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp'

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const COLOR = /^#[0-9a-f]{6}$/

/**
 * The image type by looking at the bytes, never at what the client says. Anything that is not a
 * PNG, JPEG or WebP (an SVG, HTML, a renamed file) is refused, so nothing scriptable is ever served.
 */
export function sniffImage(bytes: Buffer): ImageType | null {
  if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

/** Check base64 image text: well formed, within `maxBytes` once decoded, and really an image. */
export function checkImage(data: unknown, maxBytes: number): { type: ImageType; data: string } {
  if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0 || !BASE64.test(data)) {
    throw new AppError('invalid_request')
  }
  // The decoded size is known from the text length before anything is decoded.
  const size = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)
  if (size > maxBytes) throw new AppError('payload_too_large')
  const type = sniffImage(Buffer.from(data, 'base64'))
  if (!type) throw new AppError('invalid_request')
  return { type, data }
}

/** A key from a URL: already trimmed and lower case, and short. Anything else is not a player. */
export function checkKey(key: string): string {
  if (key.length < 1 || key.length > 80 || key !== avatarKey(key)) throw new AppError('invalid_request')
  return key
}

const toEpoch = (value: unknown) => new Date(value as string | number | Date).getTime()

export interface StoredImage {
  type: ImageType
  bytes: Buffer
  /** Milliseconds since the epoch; changes with the image. */
  version: number
}


/** Only pictographs (with their modifiers and joiners): no letters, digits or markup. */
function isEmoji(text: string): boolean {
  const chars = [...text]
  if (chars.length < 1 || chars.length > MEDIA_LIMITS.emojiChars) return false
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f)+$/u.test(text)
}

/** Save an avatar, replacing the player's earlier one. A club keeps at most MEDIA_LIMITS.avatars. */
export async function putAvatar(db: Db, slug: string, key: string, body: PutAvatarRequest): Promise<void> {
  checkKey(key)
  let emoji: string | null = null
  let color: string | null = null
  let photo: { type: ImageType; data: string } | null = null

  if (body.kind === 'photo') {
    if (!body.photo || body.emoji !== undefined || body.color !== undefined) throw new AppError('invalid_request')
    photo = checkImage(body.photo.data, MEDIA_LIMITS.avatarPhotoBytes)
  } else if (body.kind === 'emoji') {
    if (typeof body.emoji !== 'string' || !isEmoji(body.emoji) || body.photo) throw new AppError('invalid_request')
    emoji = body.emoji
  } else if (body.kind === 'initials') {
    if (body.photo || body.emoji !== undefined) throw new AppError('invalid_request')
  } else {
    throw new AppError('invalid_request')
  }
  if (body.color !== undefined) {
    if (typeof body.color !== 'string' || !COLOR.test(body.color)) throw new AppError('invalid_request')
    color = body.color
  }
  if (body.kind === 'initials' && !color) throw new AppError('invalid_request')

  await db.transaction(async (tx) => {
    const existing = await tx.query('select 1 from club_avatars where club_slug = $1 and name_key = $2', [slug, key])
    if (existing.rowCount === 0) {
      const { rows } = await tx.query<{ n: string | number }>(
        'select count(*) as n from club_avatars where club_slug = $1',
        [slug],
      )
      if (Number(rows[0].n) >= MEDIA_LIMITS.avatars) throw new AppError('payload_too_large')
    }
    await tx.query(
      `insert into club_avatars (club_slug, name_key, kind, emoji, color, content_type, photo, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (club_slug, name_key) do update set
         kind = excluded.kind, emoji = excluded.emoji, color = excluded.color,
         content_type = excluded.content_type, photo = excluded.photo, updated_at = excluded.updated_at`,
      [slug, key, body.kind, emoji, color, photo?.type ?? null, photo?.data ?? null],
    )
  })
}

export async function deleteAvatar(db: Queryable, slug: string, key: string): Promise<void> {
  await db.query('delete from club_avatars where club_slug = $1 and name_key = $2', [slug, checkKey(key)])
}

/** Whether the club's public live page shows player photos. Staff devices always get them. */
export async function setPhotoSharing(db: Queryable, slug: string, on: boolean): Promise<void> {
  await db.query('update clubs set share_photos = $2 where slug = $1', [slug, on])
}

const photosShared = async (db: Queryable, slug: string) =>
  (await db.query<{ share_photos: boolean }>('select share_photos from clubs where slug = $1', [slug])).rows[0]
    ?.share_photos === true

/**
 * Every avatar, without the photos themselves, and a validator that changes when any of them do.
 * The public index (the live page) lists a photo as initials while the club does not share photos;
 * the staff index lists them as they are, and says whether they are shared.
 */
export async function getAvatarIndex(
  db: Queryable,
  slug: string,
  { staff = false }: { staff?: boolean } = {},
): Promise<{
  avatars: Record<string, AvatarInfo>
  /** Always null: clubs no longer have logos. Kept for older cached apps that read it. */
  logo: null
  name: string | null
  sharePhotos: boolean
  etag: string
}> {
  const sharePhotos = await photosShared(db, slug)
  const hidePhotos = !staff && !sharePhotos
  const { rows } = await db.query<{
    name_key: string
    kind: AvatarInfo['kind']
    emoji: string | null
    color: string | null
    updated_at: unknown
  }>(
    'select name_key, kind, emoji, color, updated_at from club_avatars where club_slug = $1 order by name_key',
    [slug],
  )
  const avatars: Record<string, AvatarInfo> = {}
  for (const r of rows) {
    avatars[r.name_key] = {
      kind: hidePhotos && r.kind === 'photo' ? 'initials' : r.kind,
      ...(r.emoji ? { emoji: r.emoji } : {}),
      ...(r.color ? { color: r.color } : {}),
      v: toEpoch(r.updated_at),
    }
  }
  const logo = null
  const clubRow = await db.query<{ name: string }>('select name from clubs where slug = $1', [slug])
  const name = clubRow.rows[0]?.name ?? null
  const etag = `W/"${createHash('sha1')
    .update(JSON.stringify({ avatars, logo, name, sharePhotos, staff }))
    .digest('hex')
    .slice(0, 20)}"`
  return { avatars, logo, name, sharePhotos, etag }
}

/** A player's photo, for the live page only while the club shares photos; staff always get it. */
export async function getAvatarPhoto(
  db: Queryable,
  slug: string,
  key: string,
  { staff = false }: { staff?: boolean } = {},
): Promise<StoredImage | null> {
  if (!staff && !(await photosShared(db, slug))) return null
  const { rows } = await db.query<{ content_type: ImageType; photo: string; updated_at: unknown }>(
    "select content_type, photo, updated_at from club_avatars where club_slug = $1 and name_key = $2 and kind = 'photo'",
    [slug, key],
  )
  const row = rows[0]
  return row ? { type: row.content_type, bytes: Buffer.from(row.photo, 'base64'), version: toEpoch(row.updated_at) } : null
}

/** One avatar as it really is, photo included (staff only), or null when the player has none. */
export async function getStaffAvatar(db: Queryable, slug: string, key: string): Promise<StaffAvatar | null> {
  const { rows } = await db.query<{
    kind: AvatarInfo['kind']
    emoji: string | null
    color: string | null
    content_type: ImageType | null
    photo: string | null
    updated_at: unknown
  }>(
    'select kind, emoji, color, content_type, photo, updated_at from club_avatars where club_slug = $1 and name_key = $2',
    [slug, checkKey(key)],
  )
  const r = rows[0]
  if (!r) return null
  return {
    kind: r.kind,
    ...(r.emoji ? { emoji: r.emoji } : {}),
    ...(r.color ? { color: r.color } : {}),
    ...(r.kind === 'photo' && r.photo && r.content_type ? { photo: { data: r.photo, type: r.content_type } } : {}),
    v: toEpoch(r.updated_at),
  }
}
