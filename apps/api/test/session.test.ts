import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db'
import {
  bearer,
  clearData,
  createClub,
  publish,
  sampleBackup,
  sampleSnapshot,
  startTestApp,
  startTestDb,
} from './helpers'

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

const live = (slug: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/api/clubs/${slug}/live`, headers })
const put = (token: string | null, payload: unknown) =>
  app.inject({
    method: 'PUT',
    url: '/api/session',
    headers: token ? bearer(token) : {},
    payload: payload as object,
  })

describe('publishing a session', () => {
  it('needs a valid staff token', async () => {
    const body = { public: sampleSnapshot(), full: sampleBackup() }
    expect((await put(null, body)).statusCode).toBe(401)
    expect((await put('0'.repeat(64), body)).statusCode).toBe(401)
    expect((await put('not-a-token', body)).statusCode).toBe(401)
  })

  it('stores the session and shows it to anyone, no login needed', async () => {
    const { token, slug } = await createClub(app)
    const published = await publish(app, token)
    expect(published.statusCode).toBe(200)
    expect(Number.isNaN(Date.parse(published.json().updatedAt))).toBe(false)

    const response = await live(slug)
    expect(response.statusCode).toBe(200)
    expect(response.json().state).toEqual(sampleSnapshot())
    expect(response.json().updatedAt).toBe(published.json().updatedAt)
  })

  it('never exposes private data on any public endpoint', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token)
    const everything = [
      (await live(slug)).body,
      (await app.inject({ method: 'GET', url: `/api/clubs/${slug}/players` })).body,
    ].join('\n')
    expect(everything).not.toMatch(/gender|lastResult|private/i)
    expect(everything).toContain('Sunset Courts')
  })

  it('drops unknown fields, so a client bug cannot publish genders or extra data', async () => {
    const { token, slug } = await createClub(app)
    const snapshot = sampleSnapshot()
    const dirty = {
      ...snapshot,
      email: 'owner@example.com',
      players: Object.fromEntries(
        Object.entries(snapshot.players).map(([id, p]) => [id, { ...p, gender: 'F', phone: '555' }]),
      ),
    }
    expect((await put(token, { public: dirty, full: sampleBackup() })).statusCode).toBe(200)
    const body = (await live(slug)).body
    expect(body).not.toMatch(/gender|email|phone|owner@/)
  })

  it('rejects snapshots that are malformed or too big', async () => {
    const { token } = await createClub(app)
    const bad = [
      { ...sampleSnapshot(), mode: 'triples' },
      { ...sampleSnapshot(), courts: 'none' },
      { ...sampleSnapshot(), players: { 1: { id: 1, name: 'A', skill: 99 } } },
      { ...sampleSnapshot(), schemaVersion: 2 },
      { ...sampleSnapshot(), location: 'x'.repeat(200) },
    ]
    for (const snapshot of bad) {
      const response = await put(token, { public: snapshot, full: sampleBackup() })
      expect(response.statusCode, JSON.stringify(snapshot).slice(0, 60)).toBe(400)
      expect(response.json().error).toBe('invalid_snapshot')
    }
    const badBackup = await put(token, { public: sampleSnapshot(), full: { hello: 'world' } })
    expect(badBackup.json().error).toBe('invalid_snapshot')

    const huge = { ...sampleBackup(), session: { blob: 'x'.repeat(300 * 1024) } }
    const tooBig = await put(token, { public: sampleSnapshot(), full: huge })
    expect(tooBig.statusCode).toBe(413)
    expect(tooBig.json().error).toBe('payload_too_large')
  })

  it('rejects requests that are missing parts', async () => {
    const { token } = await createClub(app)
    for (const body of [{}, { public: sampleSnapshot() }, { full: sampleBackup() }, { public: 'x', full: 'y' }]) {
      const response = await put(token, body)
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('invalid_request')
    }
  })

  it('keeps the names staff gave their courts, in board order', async () => {
    const { token, slug } = await createClub(app)
    const snapshot = {
      ...sampleSnapshot(),
      courts: [
        { id: 3, name: 'Center Court', teams: null },
        { id: 1, name: 'Court 1', teams: null },
      ],
    }
    expect((await put(token, { public: snapshot, full: sampleBackup() })).statusCode).toBe(200)
    const courts = (await live(slug)).json().state.courts
    expect(courts.map((c: { id: number; name: string }) => [c.id, c.name])).toEqual([
      [3, 'Center Court'],
      [1, 'Court 1'],
    ])
  })

  it('accepts a session from an older app whose courts have no names, and names them', async () => {
    const { token, slug } = await createClub(app)
    const legacy = { ...sampleSnapshot(), courts: [{ id: 1, teams: null }, { id: 2, teams: null }] }
    expect((await put(token, { public: legacy, full: sampleBackup() })).statusCode).toBe(200)
    const names = (await live(slug)).json().state.courts.map((c: { name: string }) => c.name)
    expect(names).toEqual(['Court 1', 'Court 2'])
  })

  it('publishes scores and time played to the live board', async () => {
    const { token, slug } = await createClub(app)
    expect((await put(token, { public: sampleSnapshot(), full: sampleBackup() })).statusCode).toBe(200)
    expect((await live(slug)).json().state.stats[1]).toEqual({
      games: 2,
      wins: 2,
      losses: 0,
      opponentSkill: 6,
      pointsFor: 22,
      pointsAgainst: 9,
      scoredGames: 2,
      secondsPlayed: 1260,
      secondsWaited: 0,
    })
  })

  it('accepts a session from an older app whose stats have no scores, and reads them as 0', async () => {
    const { token, slug } = await createClub(app)
    const legacy = { ...sampleSnapshot(), stats: { 1: { games: 2, wins: 2, losses: 0, opponentSkill: 6 } } }
    expect((await put(token, { public: legacy, full: sampleBackup() })).statusCode).toBe(200)
    expect((await live(slug)).json().state.stats[1]).toEqual({
      games: 2,
      wins: 2,
      losses: 0,
      opponentSkill: 6,
      pointsFor: 0,
      pointsAgainst: 0,
      scoredGames: 0,
      secondsPlayed: 0,
      secondsWaited: 0,
    })
  })

  it('rejects scores and times that are negative or not numbers', async () => {
    const { token } = await createClub(app)
    const stats = sampleSnapshot().stats[1]
    for (const bad of [{ pointsFor: -1 }, { pointsAgainst: 'x' }, { scoredGames: null }, { secondsPlayed: 1e9 }, { secondsWaited: -5 }]) {
      const response = await put(token, {
        public: { ...sampleSnapshot(), stats: { 1: { ...stats, ...bad } } },
        full: sampleBackup(),
      })
      expect(response.statusCode, JSON.stringify(bad)).toBe(400)
      expect(response.json().error).toBe('invalid_snapshot')
    }
  })

  it('publishes the next group to the live board', async () => {
    const { token, slug } = await createClub(app)
    const snapshot = { ...sampleSnapshot(), nextUp: [5, 6, 7, 8] }
    expect((await put(token, { public: snapshot, full: sampleBackup() })).statusCode).toBe(200)
    expect((await live(slug)).json().state.nextUp).toEqual([5, 6, 7, 8])
  })

  it('accepts a session from an older app that has no next group, and shows none', async () => {
    const { token, slug } = await createClub(app)
    const { nextUp: _omitted, ...legacy } = sampleSnapshot()
    expect((await put(token, { public: legacy, full: sampleBackup() })).statusCode).toBe(200)
    expect((await live(slug)).json().state.nextUp).toEqual([])
  })

  it('rejects a next group that is not a short list of ids', async () => {
    const { token } = await createClub(app)
    for (const nextUp of ['5', [1, 2, 3, 4, 5], [1.5, 2], [-1, 2], null]) {
      const response = await put(token, { public: { ...sampleSnapshot(), nextUp }, full: sampleBackup() })
      expect(response.statusCode, JSON.stringify(nextUp)).toBe(400)
      expect(response.json().error).toBe('invalid_snapshot')
    }
  })

  it('rejects court names that are not text or are too long', async () => {
    const { token } = await createClub(app)
    for (const name of [42, null, 'n'.repeat(41)]) {
      const snapshot = { ...sampleSnapshot(), courts: [{ id: 1, name, teams: null }] }
      const response = await put(token, { public: snapshot, full: sampleBackup() })
      expect(response.statusCode, JSON.stringify(name)).toBe(400)
      expect(response.json().error).toBe('invalid_snapshot')
    }
  })

  it('replaces the previous session instead of adding another', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token, 'First')
    await publish(app, token, 'Second')
    expect((await live(slug)).json().state.location).toBe('Second')
    expect((await db.query('select 1 from live_sessions')).rowCount).toBe(1)
    expect((await db.query('select 1 from session_backups')).rowCount).toBe(1)
  })

  it('keeps clubs completely separate', async () => {
    const a = await createClub(app, { slug: 'club-a' })
    const b = await createClub(app, { slug: 'club-b' })
    await publish(app, a.token, 'Alpha')
    await publish(app, b.token, 'Beta')
    expect((await live('club-a')).json().state.location).toBe('Alpha')
    expect((await live('club-b')).json().state.location).toBe('Beta')

    await app.inject({ method: 'DELETE', url: '/api/session', headers: bearer(a.token) })
    expect((await live('club-a')).statusCode).toBe(404)
    expect((await live('club-b')).statusCode).toBe(200)
  })
})

describe('reading the live session', () => {
  it('supports conditional requests, so polling viewers cost almost nothing', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token)
    const first = await live(slug)
    const etag = first.headers.etag as string
    expect(etag).toMatch(/^W\/"\d+"$/)
    expect(first.headers['cache-control']).toBe('no-cache')

    const again = await live(slug, { 'if-none-match': etag })
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')

    await new Promise((resolve) => setTimeout(resolve, 5))
    await publish(app, token, 'Changed')
    const changed = await live(slug, { 'if-none-match': etag })
    expect(changed.statusCode).toBe(200)
    expect(changed.headers.etag).not.toBe(etag)
  })

  it('answers unknown clubs, invalid URLs and idle clubs with exactly the same 404', async () => {
    await createClub(app, { slug: 'idle-club' })
    const responses = await Promise.all(
      ['idle-club', 'no-such-club', 'NOT%20VALID', 'x'].map((slug) => live(slug)),
    )
    for (const response of responses) {
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found', message: 'Not found.' })
    }
  })

  it('accepts the club URL in any case', async () => {
    const { token } = await createClub(app, { slug: 'sunset-club' })
    await publish(app, token)
    expect((await live('Sunset-Club')).statusCode).toBe(200)
  })

  it('treats a session nobody has updated for the configured time as ended', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token)
    await db.query("update live_sessions set updated_at = now() - interval '25 hours'")
    expect((await live(slug)).statusCode).toBe(404)
    // Any staff activity brings it back.
    await publish(app, token)
    expect((await live(slug)).statusCode).toBe(200)
  })
})

describe('resuming on another device', () => {
  it('returns the private backup to the club that published it', async () => {
    const { token } = await createClub(app)
    await publish(app, token)
    const response = await app.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(sampleBackup())
    expect(response.body).toContain('gender') // the backup keeps everything
  })

  it('is 404 when nothing is running, and needs a token', async () => {
    const { token } = await createClub(app)
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/session' })).statusCode).toBe(401)
  })

  it('never hands one club another club’s backup', async () => {
    const a = await createClub(app, { slug: 'club-a' })
    const b = await createClub(app, { slug: 'club-b' })
    await publish(app, a.token, 'Alpha only')
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: bearer(b.token) })).statusCode).toBe(404)
  })
})

describe('clearing a session', () => {
  it('ends the live board and removes the backup', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token)
    const cleared = await app.inject({ method: 'DELETE', url: '/api/session', headers: bearer(token) })
    expect(cleared.statusCode).toBe(204)
    expect((await live(slug)).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: bearer(token) })).statusCode).toBe(404)
  })

  it('is safe to repeat and needs a token', async () => {
    const { token } = await createClub(app)
    expect((await app.inject({ method: 'DELETE', url: '/api/session', headers: bearer(token) })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: '/api/session', headers: bearer(token) })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: '/api/session' })).statusCode).toBe(401)
  })
})

describe('several staff devices running one session', () => {
  const A = '00000000-0000-4000-8000-00000000000a'
  const B = '00000000-0000-4000-8000-00000000000b'
  const write = (token: string, meta: object, location = 'Sunset Courts') =>
    put(token, { public: sampleSnapshot(location), full: sampleBackup(location), ...meta })
  const state = (token: string | null) =>
    app.inject({ method: 'GET', url: '/api/session/state', headers: token ? bearer(token) : {} })

  it('moves the revision on with each write and keeps the session it belongs to', async () => {
    const { token } = await createClub(app)
    const first = await write(token, { baseRevision: 0, sessionId: A, startedAt: '2026-09-24T10:00:00.000Z' })
    expect(first.statusCode).toBe(200)
    expect(first.json().revision).toBe(1)
    const second = await write(token, { baseRevision: 1, sessionId: A })
    expect(second.json().revision).toBe(2)
    expect((await state(token)).json()).toMatchObject({
      revision: 2,
      sessionId: A,
      startedAt: '2026-09-24T10:00:00.000Z',
      full: { location: 'Sunset Courts' },
    })
  })

  it('refuses a change made on an older revision, and answers with the club’s copy', async () => {
    const { token } = await createClub(app)
    await write(token, { baseRevision: 0, sessionId: A })
    await write(token, { baseRevision: 1, sessionId: A }, 'Moved On')
    const stale = await write(token, { baseRevision: 1, sessionId: A }, 'Stale')
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ error: 'conflict', current: { revision: 2, sessionId: A, full: { location: 'Moved On' } } })
    expect((await state(token)).json().full.location).toBe('Moved On')
  })

  it('runs another session beside a running one, but never brings back one that ended', async () => {
    const { token } = await createClub(app)
    await write(token, { baseRevision: 0, sessionId: A })
    const other = await write(token, { baseRevision: 0, sessionId: B }, 'Evening')
    expect(other.statusCode).toBe(200)
    expect(other.json().revision).toBe(1)
    expect((await app.inject({ method: 'GET', url: `/api/session/state?sessionId=${A}`, headers: bearer(token) })).json())
      .toMatchObject({ sessionId: A, revision: 1, full: { location: 'Sunset Courts' } })

    await app.inject({ method: 'DELETE', url: `/api/session?sessionId=${A}`, headers: bearer(token) })
    const revived = await write(token, { baseRevision: 3, sessionId: A })
    expect(revived.statusCode).toBe(409)
    expect(revived.json().current).toBeNull()
  })

  it('still takes a write from an older app that sends no revision', async () => {
    const { token } = await createClub(app)
    await write(token, { baseRevision: 0, sessionId: A })
    const old = await publish(app, token, 'Older App')
    expect(old.statusCode).toBe(200)
    expect((await state(token)).json()).toMatchObject({ revision: 2, sessionId: A, full: { location: 'Older App' } })
  })

  it('ends only the session named, so a late end cannot take down a newer one', async () => {
    const { token, slug } = await createClub(app)
    await write(token, { baseRevision: 0, sessionId: B })
    const late = await app.inject({ method: 'DELETE', url: `/api/session?sessionId=${A}`, headers: bearer(token) })
    expect(late.statusCode).toBe(204)
    expect((await live(slug)).statusCode).toBe(200)
    await app.inject({ method: 'DELETE', url: `/api/session?sessionId=${B}`, headers: bearer(token) })
    expect((await live(slug)).statusCode).toBe(404)
    const bad = await app.inject({ method: 'DELETE', url: '/api/session?sessionId=nope', headers: bearer(token) })
    expect(bad.statusCode).toBe(400)
  })

  it('tells viewers the revision, and keeps the private copy for staff', async () => {
    const { token, slug } = await createClub(app)
    await write(token, { baseRevision: 0, sessionId: A })
    expect((await live(slug)).json().revision).toBe(1)
    expect((await state(null)).statusCode).toBe(401)
    const other = await createClub(app)
    expect((await state(other.token)).statusCode).toBe(404)
  })

  it('refuses a malformed session id or start time', async () => {
    const { token } = await createClub(app)
    expect((await write(token, { baseRevision: 0, sessionId: 'nope' })).statusCode).toBe(400)
    expect((await write(token, { baseRevision: 0, startedAt: 'someday' })).statusCode).toBe(400)
    expect((await write(token, { baseRevision: -1 })).statusCode).toBe(400)
  })
})


describe('several sessions at once', () => {
  const A = '00000000-0000-4000-8000-00000000000a'
  const B = '00000000-0000-4000-8000-00000000000b'
  const backupWith = (location: string, session: object) => ({ ...sampleBackup(location), session: { ...sampleBackup(location).session, ...session } })
  const write = (token: string, sessionId: string, location: string, extra: object = {}, session: object = {}) =>
    put(token, { public: sampleSnapshot(location), full: backupWith(location, session), sessionId, ...extra })
  const sessions = async (token: string) =>
    (await app.inject({ method: 'GET', url: '/api/sessions', headers: bearer(token) })).json().sessions
  const presence = (token: string, id: string, deviceId: string, method: 'PUT' | 'DELETE' = 'PUT') =>
    app.inject(
      method === 'PUT'
        ? { method, url: `/api/sessions/${id}/presence`, headers: bearer(token), payload: { deviceId } }
        : { method, url: `/api/sessions/${id}/presence?deviceId=${deviceId}`, headers: bearer(token) },
    )

  it('keeps each session’s revision and conflicts apart', async () => {
    const { token } = await createClub(app)
    await write(token, A, 'Morning', { baseRevision: 0 })
    await write(token, B, 'Evening', { baseRevision: 0 })
    expect((await write(token, A, 'Morning 2', { baseRevision: 1 })).json().revision).toBe(2)
    const stale = await write(token, B, 'Stale', { baseRevision: 2 })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().current).toMatchObject({ sessionId: B, revision: 1 })
  })

  it('lists them for staff with their state, players and who paused one', async () => {
    const { token } = await createClub(app)
    await write(token, A, 'Morning', { live: false }, { notStarted: true, clockStoppedAt: 1 })
    await write(token, B, 'Evening', {}, { clockStoppedAt: 5, pausedBy: { deviceId: 'd1', name: 'Desk' }, queue: [1, 2], onBreak: [3] })
    const list = await sessions(token)
    expect(list.map((s: { location: string }) => s.location)).toEqual(['Evening', 'Morning'])
    expect(list[0]).toMatchObject({ sessionId: B, status: 'paused', live: true, pausedBy: { deviceId: 'd1', name: 'Desk' }, openOn: [] })
    expect(list[1]).toMatchObject({ sessionId: A, status: 'notStarted', live: false })
    expect(list[0].players).toBe(3)
    expect((await app.inject({ method: 'GET', url: '/api/sessions' })).statusCode).toBe(401)
  })

  it('says which staff devices have a session open, by the name the club gave them', async () => {
    const { token } = await createClub(app)
    await write(token, A, 'Morning')
    await app.inject({ method: 'PUT', url: '/api/devices/me', headers: bearer(token), payload: { id: 'd1', name: 'Desk', label: 'Pixel' } })
    expect((await presence(token, A, 'd1')).statusCode).toBe(204)
    await presence(token, A, 'd2')
    const [open] = await sessions(token)
    expect(open.openOn).toEqual(expect.arrayContaining([{ deviceId: 'd1', name: 'Desk' }, { deviceId: 'd2', name: 'Another device' }]))
    expect(open.openOn).toHaveLength(2)
    await presence(token, A, 'd2', 'DELETE')
    expect((await sessions(token))[0].openOn.map((d: { deviceId: string }) => d.deviceId)).toEqual(['d1'])
    expect((await presence(token, 'nope', 'd1')).statusCode).toBe(400)
  })

  it('shows each live session on its own board, and the latest on the club’s', async () => {
    const { token, slug } = await createClub(app)
    await write(token, A, 'Morning')
    await write(token, B, 'Evening')
    const one = await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live/${A}` })
    expect(one.json()).toMatchObject({ sessionId: A, state: { location: 'Morning' } })
    expect((await live(slug)).json().state.location).toBe('Evening')
    const lives = (await app.inject({ method: 'GET', url: `/api/clubs/${slug}/lives` })).json().sessions
    expect(lives.map((s: { sessionId: string }) => s.sessionId)).toEqual([B, A])
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live/not-a-session` })).statusCode).toBe(404)
  })

  it('ends one session and leaves the others running', async () => {
    const { token, slug } = await createClub(app)
    await write(token, A, 'Morning')
    await write(token, B, 'Evening')
    await app.inject({ method: 'DELETE', url: `/api/session?sessionId=${B}`, headers: bearer(token) })
    expect((await sessions(token)).map((s: { sessionId: string }) => s.sessionId)).toEqual([A])
    expect((await live(slug)).json().state.location).toBe('Morning')
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live/${B}` })).statusCode).toBe(404)
  })
})
