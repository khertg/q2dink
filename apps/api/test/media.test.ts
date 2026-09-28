import { MEDIA_LIMITS } from '@q2dink/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db'
import { bearer, clearData, createClub, startTestApp, startTestDb } from './helpers'

let db: Db
let app: FastifyInstance

beforeAll(async () => {
  db = await startTestDb()
  app = await startTestApp(db)
})
afterAll(async () => {
  await app.close()
  await db.close()
})
beforeEach(() => clearData(db))

/** Real image bytes: only the headers matter, the server looks at the first bytes. */
const png = (extra = 32) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 1)])
const jpeg = (extra = 32) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 2)])
const webp = (extra = 32) =>
  Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4, 0), Buffer.from('WEBP', 'latin1'), Buffer.alloc(extra, 3)])
const b64 = (bytes: Buffer) => bytes.toString('base64')

const putLogo = (token: string | null, payload: unknown) =>
  app.inject({ method: 'PUT', url: '/api/logo', headers: token ? bearer(token) : {}, payload: payload as object })
const putAvatar = (token: string | null, key: string, payload: unknown) =>
  app.inject({
    method: 'PUT',
    url: `/api/avatars/${encodeURIComponent(key)}`,
    headers: token ? bearer(token) : {},
    payload: payload as object,
  })
const photo = (bytes: Buffer) => ({ kind: 'photo', photo: { data: b64(bytes) } })
const sharePhotos = (token: string | null, on: unknown) =>
  app.inject({ method: 'PUT', url: '/api/photo-sharing', headers: token ? bearer(token) : {}, payload: { on } as object })

describe('club logo (gone)', () => {
  it('accepts an older app’s logo upload or removal, still only from staff, and keeps nothing', async () => {
    const { token, slug } = await createClub(app)
    for (const bad of [null, 'nope']) {
      expect((await putLogo(bad, { logo: { data: b64(png()) } })).statusCode).toBe(401)
      expect((await app.inject({ method: 'DELETE', url: '/api/logo', headers: bad ? bearer(bad) : {} })).statusCode).toBe(401)
    }
    expect((await putLogo(token, { logo: { data: b64(png()) } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: '/api/logo', headers: bearer(token) })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/logo` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })).json().logo).toBeNull()
  })
})

describe('player avatars', () => {
  it('needs a login to change', async () => {
    for (const token of [null, 'nope']) {
      expect((await putAvatar(token, 'ann', { kind: 'initials', color: '#336699' })).statusCode).toBe(401)
      const del = await app.inject({ method: 'DELETE', url: '/api/avatars/ann', headers: token ? bearer(token) : {} })
      expect(del.statusCode).toBe(401)
    }
  })

  it('keeps emoji, initials and photo avatars, listed by lower-case name', async () => {
    const { token, slug } = await createClub(app)
    expect((await putAvatar(token, 'ann', { kind: 'emoji', emoji: '🎾', color: '#336699' })).statusCode).toBe(204)
    expect((await putAvatar(token, 'bob', { kind: 'initials', color: '#aa5500' })).statusCode).toBe(204)
    expect((await putAvatar(token, 'cy lee', photo(webp()))).statusCode).toBe(204)
    expect((await sharePhotos(token, true)).statusCode).toBe(204)

    const response = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })
    expect(response.statusCode).toBe(200)
    const { avatars } = response.json()
    expect(Object.keys(avatars).sort()).toEqual(['ann', 'bob', 'cy lee'])
    expect(avatars.ann).toMatchObject({ kind: 'emoji', emoji: '🎾', color: '#336699' })
    expect(avatars.bob).toMatchObject({ kind: 'initials', color: '#aa5500' })
    expect(avatars['cy lee']).toMatchObject({ kind: 'photo' })
    // The photo itself is not in the list.
    expect(JSON.stringify(response.json())).not.toContain(b64(webp()))
    for (const a of Object.values(avatars) as { v: number }[]) expect(Number.isFinite(a.v)).toBe(true)
  })

  it('serves a photo by name, and answers 404 for anything else', async () => {
    const { token, slug } = await createClub(app)
    await putAvatar(token, 'cy lee', photo(jpeg()))
    await putAvatar(token, 'ann', { kind: 'emoji', emoji: '🎾' })
    await sharePhotos(token, true)
    const ok = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars/${encodeURIComponent('cy lee')}/photo` })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('image/jpeg')
    expect(Buffer.from(ok.rawPayload).equals(jpeg())).toBe(true)
    for (const key of ['ann', 'nobody', 'Cy%20Lee', '']) {
      const r = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars/${key}/photo` })
      expect(r.statusCode, key).toBe(404)
    }
  })

  it('replaces a player’s avatar, and changes the list validator when anything changes', async () => {
    const { token, slug } = await createClub(app)
    await putAvatar(token, 'ann', { kind: 'emoji', emoji: '🎾' })
    const first = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })
    const same = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars`, headers: { 'if-none-match': String(first.headers.etag) } })
    expect(same.statusCode).toBe(304)

    await putAvatar(token, 'ann', { kind: 'emoji', emoji: '🏓' })
    const changed = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars`, headers: { 'if-none-match': String(first.headers.etag) } })
    expect(changed.statusCode).toBe(200)
    expect(changed.json().avatars.ann.emoji).toBe('🏓')
    expect(Object.keys(changed.json().avatars)).toHaveLength(1)

    // Photo to emoji drops the photo.
    await putAvatar(token, 'ann', photo(png()))
    await putAvatar(token, 'ann', { kind: 'initials', color: '#123456' })
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars/ann/photo` })).statusCode).toBe(404)
  })

  it('deletes one avatar', async () => {
    const { token, slug } = await createClub(app)
    await putAvatar(token, 'ann', photo(png()))
    await putAvatar(token, 'cy', { kind: 'emoji', emoji: '🎾' })
    const index = async () => Object.keys((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })).json().avatars).sort()

    expect((await app.inject({ method: 'DELETE', url: '/api/avatars/ann', headers: bearer(token) })).statusCode).toBe(204)
    expect(await index()).toEqual(['cy'])
    expect((await app.inject({ method: 'DELETE', url: '/api/avatars/ann', headers: bearer(token) })).statusCode).toBe(204) // already gone
  })
})

describe('player photos on the live page', () => {
  const publicIndex = async (slug: string) => (await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })).json()
  const publicPhoto = (slug: string, key: string) =>
    app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars/${encodeURIComponent(key)}/photo` })
  const staffIndex = (token: string | null) =>
    app.inject({ method: 'GET', url: '/api/avatars', headers: token ? bearer(token) : {} })
  const staffAvatar = (token: string | null, key: string) =>
    app.inject({ method: 'GET', url: `/api/avatars/${encodeURIComponent(key)}`, headers: token ? bearer(token) : {} })

  it('are hidden from the public until the club shares them, and staff always get them', async () => {
    const { token, slug } = await createClub(app)
    await putAvatar(token, 'ann', photo(jpeg()))
    await putAvatar(token, 'bob', { kind: 'emoji', emoji: '🎾', color: '#336699' })

    // Off by default: the live page sees initials and no photo.
    expect((await publicIndex(slug)).avatars.ann.kind).toBe('initials')
    expect((await publicPhoto(slug, 'ann')).statusCode).toBe(404)
    const staff = (await staffIndex(token)).json()
    expect(staff.sharePhotos).toBe(false)
    expect(staff.avatars.ann.kind).toBe('photo')
    expect(staff.avatars.bob).toMatchObject({ kind: 'emoji', emoji: '🎾' })

    const one = (await staffAvatar(token, 'ann')).json()
    expect(one).toMatchObject({ kind: 'photo', photo: { data: b64(jpeg()), type: 'image/jpeg' } })
    expect(one.v).toBe(staff.avatars.ann.v)
    expect((await staffAvatar(token, 'bob')).json()).toMatchObject({ kind: 'emoji', emoji: '🎾', color: '#336699' })
    expect((await staffAvatar(token, 'nobody')).statusCode).toBe(404)

    // On: the live page shows the photo, and its validator changed.
    const before = String((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })).headers.etag)
    expect((await sharePhotos(token, true)).statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars`, headers: { 'if-none-match': before } })
    expect(after.statusCode).toBe(200)
    expect(after.json().avatars.ann.kind).toBe('photo')
    expect((await publicPhoto(slug, 'ann')).statusCode).toBe(200)
    expect((await staffIndex(token)).json().sharePhotos).toBe(true)
  })

  it('stop showing, without being deleted, when an older app turns sharing off', async () => {
    const { token, slug } = await createClub(app)
    await putAvatar(token, 'ann', photo(png()))
    await sharePhotos(token, true)
    expect((await app.inject({ method: 'DELETE', url: '/api/avatars', headers: bearer(token) })).statusCode).toBe(204)
    expect((await publicPhoto(slug, 'ann')).statusCode).toBe(404)
    expect((await staffAvatar(token, 'ann')).json().photo.data).toBe(b64(png()))
  })

  it('need a staff login to list, fetch or switch', async () => {
    for (const token of [null, 'nope', '0'.repeat(64)]) {
      expect((await staffIndex(token)).statusCode).toBe(401)
      expect((await staffAvatar(token, 'ann')).statusCode).toBe(401)
      expect((await sharePhotos(token, true)).statusCode).toBe(401)
    }
    const { token } = await createClub(app)
    expect((await sharePhotos(token, 'yes')).statusCode).toBe(400)
  })

  it('never show one club another club’s players', async () => {
    const a = await createClub(app)
    const b = await createClub(app)
    await putAvatar(a.token, 'ann', photo(png()))
    expect((await staffIndex(b.token)).json().avatars).toEqual({})
    expect((await staffAvatar(b.token, 'ann')).statusCode).toBe(404)
  })

  it('refuses bad emoji, colours and shapes', async () => {
    const { token } = await createClub(app)
    const bad: unknown[] = [
      { kind: 'emoji' },
      { kind: 'emoji', emoji: 'A' },
      { kind: 'emoji', emoji: '<b>' },
      { kind: 'emoji', emoji: '🎾🎾🎾🎾🎾🎾🎾🎾🎾' },
      { kind: 'emoji', emoji: '🎾', color: 'red' },
      { kind: 'emoji', emoji: '🎾', color: '#GGGGGG' },
      { kind: 'emoji', emoji: '🎾', photo: { data: b64(png()) } },
      { kind: 'initials' },
      { kind: 'initials', color: '#12345' },
      { kind: 'initials', color: '#123456', emoji: '🎾' },
      { kind: 'photo' },
      { kind: 'photo', photo: { data: b64(png()) }, color: '#123456' },
      { kind: 'sticker' },
      { kind: 'initials', color: '#123456', extra: true },
    ]
    for (const body of bad) {
      const response = await putAvatar(token, 'ann', body)
      expect(response.statusCode, JSON.stringify(body).slice(0, 60)).toBe(400)
    }
    // Real emoji, with modifiers and joiners, are fine.
    for (const emoji of ['🎾', '👍🏽', '👩‍👩‍👧', '🇵🇭', '❤️']) {
      expect((await putAvatar(token, 'ann', { kind: 'emoji', emoji })).statusCode, emoji).toBe(204)
    }
  })

  it('refuses names that are not the normalised form', async () => {
    const { token } = await createClub(app)
    for (const key of ['Ann', ' ann', 'ann ', 'x'.repeat(81)]) {
      const response = await putAvatar(token, key, { kind: 'initials', color: '#123456' })
      expect(response.statusCode, key).toBe(400)
    }
    expect((await putAvatar(token, 'x'.repeat(80), { kind: 'initials', color: '#123456' })).statusCode).toBe(204)
  })

  it('refuses a photo that is not an image, or is too large', async () => {
    const { token } = await createClub(app)
    expect((await putAvatar(token, 'ann', photo(Buffer.from('<svg onload=alert(1)>')))).statusCode).toBe(400)
    const tooBig = await putAvatar(token, 'ann', photo(png(MEDIA_LIMITS.avatarPhotoBytes + 10)))
    expect(tooBig.statusCode).toBe(413)
    expect((await putAvatar(token, 'ann', photo(png(MEDIA_LIMITS.avatarPhotoBytes - 16)))).statusCode).toBe(204)
  })

  it('keeps at most 500 per club, but still lets an existing player’s avatar change', async () => {
    const { token } = await createClub(app)
    const club = (await db.query<{ slug: string }>('select slug from clubs')).rows[0].slug
    await db.query(
      `insert into club_avatars (club_slug, name_key, kind, color)
       select $1, 'p' || n, 'initials', '#123456' from generate_series(1, $2::int) as n`,
      [club, MEDIA_LIMITS.avatars],
    )
    const full = await putAvatar(token, 'one-more', { kind: 'initials', color: '#123456' })
    expect(full.statusCode).toBe(413)
    expect((await putAvatar(token, 'p7', { kind: 'emoji', emoji: '🎾' })).statusCode).toBe(204)
  })

  it('never shows one club another club’s avatars, and goes when the club goes', async () => {
    const a = await createClub(app)
    const b = await createClub(app)
    await putAvatar(a.token, 'ann', { kind: 'emoji', emoji: '🎾' })
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${b.slug}/avatars` })).json().avatars).toEqual({})
    // Another club deleting the same name does nothing here.
    await app.inject({ method: 'DELETE', url: '/api/avatars/ann', headers: bearer(b.token) })
    expect(Object.keys((await app.inject({ method: 'GET', url: `/api/clubs/${a.slug}/avatars` })).json().avatars)).toEqual(['ann'])
    await putAvatar(b.token, 'ann', { kind: 'initials', color: '#123456' }) // the same name can exist in both
    await db.query('delete from clubs where slug = $1', [a.slug])
    const { rows } = await db.query('select club_slug from club_avatars')
    expect(rows).toEqual([{ club_slug: b.slug }])
  })

  it('shows an unknown club as having no avatars, without revealing anything', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/clubs/no-such-club/avatars' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ avatars: {}, logo: null, name: null })
    expect((await app.inject({ method: 'GET', url: '/api/clubs/NOT%20VALID/avatars' })).statusCode).toBe(404)
  })

  it('includes the club’s own name, for anyone', async () => {
    const { slug } = await createClub(app, { name: 'Riverside Pickleball' })
    const response = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/avatars` })
    expect(response.json().name).toBe('Riverside Pickleball')
  })
})

describe('card logos', () => {
  const ID = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']
  const putCardLogo = (token: string | null, id: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: `/api/card-logos/${id}`, headers: token ? bearer(token) : {}, payload: payload as object })
  const choose = (token: string, choice: unknown) =>
    app.inject({ method: 'PUT', url: '/api/card-logo', headers: bearer(token), payload: { choice } as object })
  const index = async (token: string) => (await app.inject({ method: 'GET', url: '/api/card-logos', headers: bearer(token) })).json()

  it('keeps the club’s logos with their tone, starts automatic, and serves each image to staff only', async () => {
    const { token } = await createClub(app)
    expect(await index(token)).toEqual({ logos: [], choice: 'auto' })
    expect((await putCardLogo(null, ID[0], { data: b64(png()), tone: 1 })).statusCode).toBe(401)
    expect((await putCardLogo(token, ID[0], { data: b64(png()), tone: 1 })).statusCode).toBe(204)
    expect((await putCardLogo(token, ID[1], { data: b64(webp()), tone: 0.05 })).statusCode).toBe(204)
    const listed = await index(token)
    expect(listed.choice).toBe('auto')
    expect(listed.logos.map((l: { id: string; tone: number }) => [l.id, l.tone])).toEqual([
      [ID[0], 1],
      [ID[1], expect.closeTo(0.05, 5)],
    ])
    const one = await app.inject({ method: 'GET', url: `/api/card-logos/${ID[1]}`, headers: bearer(token) })
    expect(one.json()).toMatchObject({ id: ID[1], type: 'image/webp', data: b64(webp()) })
    expect((await app.inject({ method: 'GET', url: `/api/card-logos/${ID[1]}` })).statusCode).toBe(401)
    // Sending it again replaces it.
    expect((await putCardLogo(token, ID[0], { data: b64(jpeg()), tone: 0.5 })).statusCode).toBe(204)
    expect((await index(token)).logos).toHaveLength(2)
  })

  it('lets staff pick one or none, and goes back to automatic when the picked one is removed', async () => {
    const { token } = await createClub(app)
    await putCardLogo(token, ID[0], { data: b64(png()), tone: 1 })
    expect((await choose(token, { id: ID[0] })).statusCode).toBe(204)
    expect((await index(token)).choice).toEqual({ id: ID[0] })
    expect((await choose(token, 'none')).statusCode).toBe(204)
    expect((await index(token)).choice).toBe('none')
    expect((await choose(token, { id: ID[1] })).statusCode).toBe(400)
    expect((await choose(token, 'sometimes')).statusCode).toBe(400)
    await choose(token, { id: ID[0] })
    expect((await app.inject({ method: 'DELETE', url: `/api/card-logos/${ID[0]}`, headers: bearer(token) })).statusCode).toBe(204)
    expect(await index(token)).toEqual({ logos: [], choice: 'auto' })
  })

  it('refuses what is not an image, a bad tone or id, and more than the limit', async () => {
    const { token } = await createClub(app)
    expect((await putCardLogo(token, ID[0], { data: b64(Buffer.from('<svg></svg>')), tone: 1 })).statusCode).toBe(400)
    expect((await putCardLogo(token, ID[0], { data: b64(png()), tone: 2 })).statusCode).toBe(400)
    expect((await putCardLogo(token, 'not-a-uuid', { data: b64(png()), tone: 1 })).statusCode).toBe(400)
    expect((await putCardLogo(token, ID[0], { data: b64(png(MEDIA_LIMITS.cardLogoBytes)), tone: 1 })).statusCode).toBe(413)
    for (let i = 0; i < MEDIA_LIMITS.cardLogos; i++) {
      const id = `00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`
      expect((await putCardLogo(token, id, { data: b64(png()), tone: 1 })).statusCode).toBe(204)
    }
    expect((await putCardLogo(token, ID[0], { data: b64(png()), tone: 1 })).statusCode).toBe(413)
  })

  it('keeps each club’s logos to itself', async () => {
    const a = await createClub(app)
    const b = await createClub(app, { name: 'Other Club' })
    await putCardLogo(a.token, ID[0], { data: b64(png()), tone: 1 })
    expect((await index(b.token)).logos).toEqual([])
    expect((await app.inject({ method: 'GET', url: `/api/card-logos/${ID[0]}`, headers: bearer(b.token) })).statusCode).toBe(404)
    expect((await choose(b.token, { id: ID[0] })).statusCode).toBe(400)
  })
})
