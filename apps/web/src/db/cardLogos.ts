import { MEDIA_LIMITS, type CardLogo, type CardLogoChoice } from '@q2dink/shared'
import { useLiveQuery } from 'dexie-react-hooks'
import { readChoice } from '@/lib/cardLogos'
import { db, type CardLogoRow } from './db'

/**
 * The club's card logos on this device: its logo in several colours, for the Standings and Stats share images, and
 * which one the cards use. Both are the club's (see syncCardLogos in cloud/sync.ts); `slug` is the signed-in club,
 * undefined in a build with no cloud.
 */

const ofClub = (slug: string | undefined) => (row: CardLogoRow) => row.clubSlug === slug

/** The club's logos, in the order they were added (not the ones removed here and not sent yet). */
export async function listCardLogos(slug: string | undefined): Promise<CardLogoRow[]> {
  const rows = await db.cardLogos.filter(ofClub(slug)).toArray()
  return rows.filter((row) => row.dirty !== 'delete').sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))
}

/** Add a logo (a data URL and how light it is), to be sent to the club. Refused once the club has its fill. */
export async function addCardLogo(slug: string | undefined, data: string, tone: number): Promise<CardLogoRow> {
  return db.transaction('rw', db.cardLogos, async () => {
    const logos = await listCardLogos(slug)
    if (logos.length >= MEDIA_LIMITS.cardLogos) {
      throw new RangeError(`A club can keep ${MEDIA_LIMITS.cardLogos} logos. Remove one first.`)
    }
    // Always after the last one, even when two are added within the same millisecond.
    const addedAt = Math.max(Date.now(), (logos.at(-1)?.addedAt ?? 0) + 1)
    const row: CardLogoRow = {
      id: crypto.randomUUID(),
      ...(slug ? { clubSlug: slug } : {}),
      data,
      tone,
      addedAt,
      dirty: 'put',
    }
    await db.cardLogos.add(row)
    return row
  })
}

/** Remove a logo. One the club has is kept, marked, until the club is told; a picked one goes back to automatic. */
export async function removeCardLogo(slug: string | undefined, id: string): Promise<void> {
  await db.transaction('rw', db.cardLogos, db.settings, async () => {
    const row = await db.cardLogos.get(id)
    if (!row || row.clubSlug !== slug) return
    if (row.v === undefined) await db.cardLogos.delete(id)
    else await db.cardLogos.update(id, { dirty: 'delete' })
    const { choice } = await getCardLogoChoice(slug)
    if (typeof choice === 'object' && choice.id === id) await setCardLogoChoice(slug, 'auto')
  })
}

const choiceKey = (slug: string | undefined) => `cardLogo:${slug ?? ''}`

/** Which logo the cards use (automatic unless changed), and whether the club has not been told yet. */
export async function getCardLogoChoice(slug: string | undefined): Promise<{ choice: CardLogoChoice; dirty: boolean }> {
  const value = (await db.settings.get(choiceKey(slug)))?.value as { choice?: unknown; dirty?: unknown } | undefined
  return { choice: readChoice(value?.choice), dirty: value?.dirty === true }
}

/** Staff chose here: kept, to be sent to the club. */
export async function setCardLogoChoice(slug: string | undefined, choice: CardLogoChoice): Promise<void> {
  await db.settings.put({ key: choiceKey(slug), value: { choice, dirty: true } })
}

/** The club's choice, taken as it is (after a sync), or ours once the club has it. */
export async function storeClubChoice(slug: string, choice: CardLogoChoice): Promise<void> {
  await db.settings.put({ key: choiceKey(slug), value: { choice, dirty: false } })
}

/** Logos with a change here the club has not been told about. */
export async function unsentCardLogos(slug: string | undefined): Promise<CardLogoRow[]> {
  // In the order they were added, so the club lists them in that order too.
  return (await db.cardLogos.filter(ofClub(slug)).toArray())
    .filter((row) => row.dirty !== undefined)
    .sort((a, b) => a.addedAt - b.addedAt)
}

/** The club has this logo (at version `v`), or has removed it. */
export async function markCardLogoSent(row: CardLogoRow, v?: number): Promise<void> {
  if (row.dirty === 'delete') await db.cardLogos.delete(row.id)
  else await db.cardLogos.update(row.id, { dirty: undefined, ...(v !== undefined ? { v } : {}) })
}

/** Keep a logo fetched from the club, in its place in the club's list. */
export async function storeClubLogo(slug: string, logo: CardLogo, addedAt: number): Promise<void> {
  const existing = await db.cardLogos.get(logo.id)
  await db.cardLogos.put({
    id: logo.id,
    clubSlug: slug,
    data: `data:${logo.type};base64,${logo.data}`,
    tone: logo.tone,
    v: logo.v,
    addedAt: existing?.addedAt ?? addedAt,
  })
}

export async function dropCardLogos(ids: string[]): Promise<void> {
  await db.cardLogos.bulkDelete(ids)
}

/** The club's logos, live. Undefined while loading. */
export const useCardLogos = (slug: string | undefined) => useLiveQuery(() => listCardLogos(slug), [slug])

/** The club's choice, live (automatic while loading). */
export function useCardLogoChoice(slug: string | undefined): CardLogoChoice {
  return useLiveQuery(async () => (await getCardLogoChoice(slug)).choice, [slug]) ?? 'auto'
}
