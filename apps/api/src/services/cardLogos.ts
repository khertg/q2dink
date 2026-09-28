import { MEDIA_LIMITS, isSessionId, type CardLogo, type CardLogoChoice, type CardLogoIndex } from '@q2dink/shared'
import type { Db, Queryable } from '../db'
import { AppError } from '../errors'
import { checkImage, type ImageType } from './media'

const toEpoch = (value: unknown) => new Date(value as string | number | Date).getTime()

/** A logo id from a URL or a choice: a UUID made on the device, in lower case. */
function checkId(id: unknown): string {
  if (typeof id !== 'string' || !isSessionId(id)) throw new AppError('invalid_request')
  return id.toLowerCase()
}

function checkTone(tone: unknown): number {
  if (typeof tone !== 'number' || !Number.isFinite(tone) || tone < 0 || tone > 1) throw new AppError('invalid_request')
  return tone
}

/**
 * Save one of the club's card logos (the club logo in one of its colours). The id comes from the device, so sending
 * the same logo again replaces it. A club keeps at most MEDIA_LIMITS.cardLogos.
 */
export async function putCardLogo(db: Db, slug: string, id: string, body: { data: unknown; tone: unknown }): Promise<void> {
  const logoId = checkId(id)
  const tone = checkTone(body.tone)
  const image = checkImage(body.data, MEDIA_LIMITS.cardLogoBytes)
  await db.transaction(async (tx) => {
    const existing = await tx.query('select 1 from club_card_logos where club_slug = $1 and id = $2', [slug, logoId])
    if (existing.rowCount === 0) {
      const { rows } = await tx.query<{ n: string | number }>('select count(*) as n from club_card_logos where club_slug = $1', [slug])
      if (Number(rows[0].n) >= MEDIA_LIMITS.cardLogos) throw new AppError('payload_too_large')
    }
    await tx.query(
      `insert into club_card_logos (club_slug, id, content_type, data, tone, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (club_slug, id) do update set
         content_type = excluded.content_type, data = excluded.data, tone = excluded.tone, updated_at = excluded.updated_at`,
      [slug, logoId, image.type, image.data, tone],
    )
  })
}

/** Remove a logo. When it was the one the cards use, they go back to choosing automatically. */
export async function deleteCardLogo(db: Db, slug: string, id: string): Promise<void> {
  const logoId = checkId(id)
  await db.transaction(async (tx) => {
    await tx.query('delete from club_card_logos where club_slug = $1 and id = $2', [slug, logoId])
    await tx.query('update clubs set card_logo = null where slug = $1 and card_logo = $2', [slug, logoId])
  })
}

/** Which logo the cards use. A picked logo must be one of the club's. */
export async function chooseCardLogo(db: Queryable, slug: string, choice: unknown): Promise<void> {
  let stored: string | null
  if (choice === 'auto') stored = null
  else if (choice === 'none') stored = 'none'
  else if (choice && typeof choice === 'object' && 'id' in choice) {
    stored = checkId(choice.id)
    const { rowCount } = await db.query('select 1 from club_card_logos where club_slug = $1 and id = $2', [slug, stored])
    if (rowCount === 0) throw new AppError('invalid_request')
  } else {
    throw new AppError('invalid_request')
  }
  await db.query('update clubs set card_logo = $2 where slug = $1', [slug, stored])
}

const choiceOf = (stored: string | null | undefined): CardLogoChoice =>
  stored === 'none' ? 'none' : stored ? { id: stored } : 'auto'

/** The club's logos, oldest first, without the images, and which one the cards use. */
export async function getCardLogoIndex(db: Queryable, slug: string): Promise<CardLogoIndex> {
  const { rows } = await db.query<{ id: string; tone: number; updated_at: unknown }>(
    'select id, tone, updated_at from club_card_logos where club_slug = $1 order by updated_at, id',
    [slug],
  )
  const club = await db.query<{ card_logo: string | null }>('select card_logo from clubs where slug = $1', [slug])
  return {
    logos: rows.map((r) => ({ id: r.id, v: toEpoch(r.updated_at), tone: Number(r.tone) })),
    choice: choiceOf(club.rows[0]?.card_logo),
  }
}

/** One logo with its image, or null when the club has no such logo. */
export async function getCardLogo(db: Queryable, slug: string, id: string): Promise<CardLogo | null> {
  const { rows } = await db.query<{ id: string; tone: number; content_type: ImageType; data: string; updated_at: unknown }>(
    'select id, tone, content_type, data, updated_at from club_card_logos where club_slug = $1 and id = $2',
    [slug, checkId(id)],
  )
  const r = rows[0]
  return r ? { id: r.id, v: toEpoch(r.updated_at), tone: Number(r.tone), type: r.content_type, data: r.data } : null
}
