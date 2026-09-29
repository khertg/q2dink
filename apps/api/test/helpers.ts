import type { FullBackupEnvelope, PublicSnapshot } from '@q2dink/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppDeps } from '../src/app'
import { loadConfig, type Config } from '../src/config'
import { connectDb, type Db } from '../src/db'
import { migrate } from '../src/db/migrate'

/** Set to run the whole suite against a real Postgres instead of the embedded one. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

export type ConfigOverrides = Partial<Omit<Config, 'rateLimit' | 'loginLockout'>> & {
  rateLimit?: Partial<Config['rateLimit']>
  loginLockout?: Partial<Config['loginLockout']>
}

/** A config whose limits are high enough to stay out of the way unless a test lowers them. */
export function testConfig(overrides: ConfigOverrides = {}): Config {
  const base = loadConfig({ DATABASE_URL: 'pglite://memory', LOG_LEVEL: 'silent' })
  const { rateLimit, loginLockout, ...rest } = overrides
  return {
    ...base,
    rateLimit: {
      global: { max: 100_000, windowMs: 60_000 },
      auth: { max: 100_000, windowMs: 60_000 },
      write: { max: 100_000, windowMs: 60_000 },
      speech: { max: 100_000, windowMs: 60_000 },
      ...rateLimit,
    },
    loginLockout: { ...base.loginLockout, maxFailuresPerClubAndIp: 100_000, maxFailuresPerClub: 100_000, ...loginLockout },
    ...rest,
  }
}

/** A migrated database, empty of data. */
export async function startTestDb(): Promise<Db> {
  const db = await connectDb(TEST_DATABASE_URL ?? 'pglite://memory')
  if (TEST_DATABASE_URL) await db.exec('drop schema public cascade; create schema public')
  await migrate(db)
  return db
}

export const clearData = (db: Db) => db.exec('truncate clubs cascade')

export async function startTestApp(
  db: Db,
  overrides: ConfigOverrides = {},
  extra: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  const app = await buildApp({ db, config: testConfig(overrides), ...extra })
  await app.ready()
  return app
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

export interface Grant {
  token: string
  recoveryCode: string
}

/** Create a club through the API and return its credentials. */
export async function createClub(
  app: FastifyInstance,
  input: { name?: string; slug?: string; password?: string; ip?: string } = {},
): Promise<Grant & { slug: string; password: string }> {
  const slug = input.slug ?? `club-${Math.random().toString(36).slice(2, 10)}`
  const password = input.password ?? 'secret-pass'
  const response = await app.inject({
    method: 'POST',
    url: '/api/clubs',
    payload: { name: input.name ?? 'Test Club', slug, password },
    remoteAddress: input.ip,
  })
  if (response.statusCode !== 201) {
    throw new Error(`createClub failed: ${response.statusCode} ${response.body}`)
  }
  return { ...(response.json() as Grant), slug, password }
}

export function sampleSnapshot(location = 'Sunset Courts'): PublicSnapshot {
  return {
    schemaVersion: 1,
    location,
    mode: 'doubles',
    matchmaking: 'skill',
    avgGameMinutes: 12,
    courts: [
      { id: 1, name: 'Court 1', teams: [[1, 2], [3, 4]] },
      { id: 2, name: 'Center Court', teams: null },
    ],
    queue: [5, 6],
    nextUp: [],
    onBreak: [],
    partners: [[5, 6]],
    stats: {
      1: { games: 2, wins: 2, losses: 0, opponentSkill: 6, pointsFor: 22, pointsAgainst: 9, scoredGames: 2, secondsPlayed: 1260, secondsWaited: 0 },
    },
    players: {
      1: { id: 1, name: 'Ann', skill: 3 },
      2: { id: 2, name: 'Bob', skill: 3 },
      3: { id: 3, name: 'Cy', skill: 4 },
      4: { id: 4, name: 'Dee', skill: 4 },
      5: { id: 5, name: 'Eve', skill: 2 },
      6: { id: 6, name: 'Fay', skill: 2 },
    },
  }
}

/** A private backup that holds data the public snapshot must never expose. */
export function sampleBackup(location = 'Sunset Courts'): FullBackupEnvelope {
  return {
    schemaVersion: 1,
    storeVersion: 4,
    location,
    session: { players: { 1: { name: 'Ann', gender: 'F' } }, lastResult: { 1: 'W' } },
  }
}

export async function publish(
  app: FastifyInstance,
  token: string,
  location = 'Sunset Courts',
  ip?: string,
  meta: { live?: boolean } = {},
) {
  return app.inject({
    method: 'PUT',
    url: '/api/session',
    headers: bearer(token),
    payload: { public: sampleSnapshot(location), full: sampleBackup(location), ...meta },
    remoteAddress: ip,
  })
}
