import { MAX_ROSTER_BATCH, MAX_ROSTER_PLAYERS } from '@q2dink/shared'
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

const put = (token: string | null, players: unknown) =>
  app.inject({ method: 'PUT', url: '/api/roster', headers: token ? bearer(token) : {}, payload: { players } as object })
const get = (token: string | null) =>
  app.inject({ method: 'GET', url: '/api/roster', headers: token ? bearer(token) : {} })
const roster = async (token: string) => (await get(token)).json().players as unknown[]
const rename = (token: string, from: string, to: string) =>
  app.inject({ method: 'POST', url: '/api/players/rename', headers: bearer(token), payload: { from, to } })

describe('the club roster', () => {
  it('needs a staff login to read or change', async () => {
    for (const token of [null, 'nope', '0'.repeat(64)]) {
      expect((await put(token, [{ name: 'Ann', skill: 3 }])).statusCode).toBe(401)
      expect((await get(token)).statusCode).toBe(401)
    }
  })

  it('keeps the players a device sends, by name', async () => {
    const { token } = await createClub(app)
    expect(await roster(token)).toEqual([])
    const response = await put(token, [
      { name: 'Bob', skill: 2 },
      { name: ' Ann ', skill: 4, gender: 'F' },
    ])
    expect(response.statusCode).toBe(204)
    // An older app sends only a level: it is kept as the rating that level starts at on the default scale.
    expect(await roster(token)).toEqual([
      { name: 'Ann', skill: 4, rating: 3.5, gender: 'F' },
      { name: 'Bob', skill: 2, rating: 2.5 },
    ])
  })

  it('updates a player already saved under that name, ignoring case', async () => {
    const { token } = await createClub(app)
    await put(token, [{ name: 'Ann', skill: 3, gender: 'F' }])
    await put(token, [{ name: 'ANN', skill: 5 }])
    expect(await roster(token)).toEqual([{ name: 'ANN', skill: 5, rating: 4 }])
  })

  it('refuses players it cannot store', async () => {
    const { token } = await createClub(app)
    for (const players of [
      [{ name: 'Ann', skill: 0 }],
      [{ name: 'Ann', skill: 7 }],
      [{ name: 'Ann', skill: 2.5 }],
      [{ name: 'Ann', skill: 3, gender: 'X' }],
      [{ name: 'Ann', skill: 3, rating: 0.5 }],
      [{ name: 'Ann', skill: 3, rating: 8.5 }],
      [{ name: 'Ann', skill: 3, extra: true }],
      [{ name: '   ', skill: 3 }],
      [{ name: 'x'.repeat(81), skill: 3 }],
      Array.from({ length: MAX_ROSTER_BATCH + 1 }, (_, i) => ({ name: `P${i}`, skill: 3 })),
    ]) {
      expect((await put(token, players)).statusCode).toBe(400)
    }
    expect(await roster(token)).toEqual([])
  })

  it('keeps at most MAX_ROSTER_PLAYERS, but still lets saved ones change', async () => {
    const { token } = await createClub(app)
    for (let start = 0; start < MAX_ROSTER_PLAYERS; start += MAX_ROSTER_BATCH) {
      const batch = Array.from({ length: MAX_ROSTER_BATCH }, (_, i) => ({ name: `P${start + i}`, skill: 3 }))
      expect((await put(token, batch)).statusCode).toBe(204)
    }
    expect((await put(token, [{ name: 'One too many', skill: 3 }])).statusCode).toBe(413)
    expect((await put(token, [{ name: 'P0', skill: 6 }])).statusCode).toBe(204)
    expect(await roster(token)).toHaveLength(MAX_ROSTER_PLAYERS)
  })

  it('never shows one club the players of another', async () => {
    const a = await createClub(app)
    const b = await createClub(app)
    await put(a.token, [{ name: 'Ann', skill: 3 }])
    expect(await roster(b.token)).toEqual([])
  })

  it('follows a rename, keeping the new name’s player if it already has one', async () => {
    const { token } = await createClub(app)
    await put(token, [
      { name: 'Ann', skill: 3 },
      { name: 'Bob', skill: 2 },
      { name: 'Cy', skill: 5 },
    ])
    expect((await rename(token, 'Ann', 'Anne')).statusCode).toBe(204)
    expect((await rename(token, 'Bob', 'Cy')).statusCode).toBe(204)
    expect((await rename(token, 'cy', 'CY')).statusCode).toBe(204)
    expect(await roster(token)).toEqual([
      { name: 'Anne', skill: 3, rating: 3 },
      { name: 'CY', skill: 5, rating: 4 },
    ])
  })
})

describe('ratings on the club roster', () => {
  it('keeps the rating a newer app sends, with its level on the default scale for older apps', async () => {
    const { token } = await createClub(app)
    await put(token, [{ name: 'Ann', skill: 1, rating: 3.742 }])
    expect(await roster(token)).toEqual([{ name: 'Ann', skill: 4, rating: 3.742 }])
  })

  it('keeps a rating to three decimals', async () => {
    const { token } = await createClub(app)
    await put(token, [{ name: 'Ann', skill: 3, rating: 3.3333 }])
    expect(await roster(token)).toEqual([{ name: 'Ann', skill: 3, rating: 3.333 }])
  })

  it('keeps the rating when an older app sends the same level again, and replaces it when the level changes', async () => {
    const { token } = await createClub(app)
    await put(token, [{ name: 'Ann', skill: 4, rating: 3.742 }])
    await put(token, [{ name: 'Ann', skill: 4 }])
    expect(await roster(token)).toEqual([{ name: 'Ann', skill: 4, rating: 3.742 }])
    await put(token, [{ name: 'Ann', skill: 2 }])
    expect(await roster(token)).toEqual([{ name: 'Ann', skill: 2, rating: 2.5 }])
  })
})

describe('the club’s skill levels', () => {
  const scale = { levels: [{ label: 'Social', from: 1 }, { label: 'Club', from: 3, range: '3.0+' }, { label: 'Pro', from: 4.5 }] }
  const getScale = (token: string | null) =>
    app.inject({ method: 'GET', url: '/api/skill-scale', headers: token ? bearer(token) : {} })
  const putScale = (token: string | null, body: unknown) =>
    app.inject({ method: 'PUT', url: '/api/skill-scale', headers: token ? bearer(token) : {}, payload: body as object })

  it('needs a staff login', async () => {
    expect((await getScale(null)).statusCode).toBe(401)
    expect((await putScale(null, { scale })).statusCode).toBe(401)
  })

  it('is the default (null) until set, then what was set, and can go back to the default', async () => {
    const { token } = await createClub(app)
    expect((await getScale(token)).json()).toEqual({ scale: null })
    const saved = await putScale(token, { scale: { ...scale, extra: true } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toEqual({ scale })
    expect((await getScale(token)).json()).toEqual({ scale })
    await putScale(token, { scale: null })
    expect((await getScale(token)).json()).toEqual({ scale: null })
  })

  it('refuses a scale that is not valid, and never shows one club another’s', async () => {
    const a = await createClub(app)
    const b = await createClub(app)
    expect((await putScale(a.token, { scale: { levels: [{ label: 'One', from: 1 }] } })).statusCode).toBe(400)
    expect((await putScale(a.token, { scale: { levels: [{ label: 'A', from: 3 }, { label: 'B', from: 2 }] } })).statusCode).toBe(400)
    expect((await putScale(a.token, {})).statusCode).toBe(400)
    await putScale(a.token, { scale })
    expect((await getScale(b.token)).json()).toEqual({ scale: null })
  })
})
