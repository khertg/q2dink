import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { connectDb } from '../src/db'
import { migrate } from '../src/db/migrate'
import { MIGRATIONS, type Migration } from '../src/db/migrations'
import { AppError, statusFor } from '../src/errors'
import { LoginGuard } from '../src/services/loginGuard'
import { dummyHash, hashPassword, verifyPassword } from '../src/services/password'
import { hashRecoveryCode, newRecoveryCode, normalizeRecoveryCode, sameHash } from '../src/services/recovery'
import { hashToken } from '../src/services/tokens'

describe('recovery codes', () => {
  it('look like 5 groups of 4 unambiguous characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(newRecoveryCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){4}$/)
    }
  })

  it('are random: no repeats and every character of the alphabet turns up', () => {
    const codes = Array.from({ length: 500 }, newRecoveryCode)
    expect(new Set(codes).size).toBe(500)
    const seen = new Set(codes.join('').replaceAll('-', ''))
    expect(seen.size).toBe(32)
  })

  it('normalize ignoring case, spaces, dashes and look-alike characters', () => {
    expect(normalizeRecoveryCode('7k2m-9qxa 4t8d')).toBe('7K2M9QXA4T8D'.replace('7K2M9QXA4T8D', '7K2M9QXA4T8D'))
    expect(normalizeRecoveryCode('o0Il')).toBe('0011')
    const code = newRecoveryCode()
    expect(hashRecoveryCode(code.toLowerCase().replaceAll('-', ' '))).toBe(hashRecoveryCode(code))
  })

  it('hash to a fixed-length digest that differs per code', () => {
    const a = hashRecoveryCode('AAAA-AAAA-AAAA-AAAA-AAAA')
    const b = hashRecoveryCode('AAAA-AAAA-AAAA-AAAA-AAAB')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })

  it('compare in constant time and handle different lengths', () => {
    expect(sameHash('abcd', 'abcd')).toBe(true)
    expect(sameHash('abcd', 'abce')).toBe(false)
    expect(sameHash('abcd', 'abc')).toBe(false)
  })
})

describe('passwords', () => {
  it('are hashed with argon2id and verified', async () => {
    const hash = await hashPassword('correct horse')
    expect(hash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword(hash, 'correct horse')).toBe(true)
    expect(await verifyPassword(hash, 'wrong horse')).toBe(false)
  })

  it('get a different hash each time (salted)', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'))
  })

  it('never throw when the stored hash is garbage', async () => {
    expect(await verifyPassword('not a hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('have a stand-in hash for unknown clubs that rejects everything sensible', async () => {
    const stand = await dummyHash()
    expect(stand).toBe(await dummyHash())
    expect(await verifyPassword(stand, 'secret')).toBe(false)
  })
})

describe('tokens', () => {
  it('are hashed with SHA-256 before storage', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('LoginGuard', () => {
  const options = { maxFailuresPerClubAndIp: 2, maxFailuresPerClub: 4, windowMs: 1000 }

  it('allows attempts until the limit, then reports how long to wait', () => {
    let now = 0
    const guard = new LoginGuard(options, () => now)
    guard.check('club', 'ip')
    guard.fail('club', 'ip')
    guard.check('club', 'ip')
    guard.fail('club', 'ip')
    try {
      guard.check('club', 'ip')
      expect.unreachable('should be locked')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('rate_limited')
      expect((error as AppError).status).toBe(429)
      expect((error as AppError).retryAfterSeconds).toBe(1)
    }
    now = 1001
    expect(() => guard.check('club', 'ip')).not.toThrow()
  })

  it('counts a club across all addresses', () => {
    const guard = new LoginGuard(options, () => 0)
    for (let i = 0; i < 4; i++) guard.fail('club', `ip-${i}`)
    expect(() => guard.check('club', 'fresh-ip')).toThrow(AppError)
    expect(() => guard.check('other-club', 'fresh-ip')).not.toThrow()
  })

  it('forgives an address after success but not the club-wide count', () => {
    const guard = new LoginGuard(options, () => 0)
    guard.fail('club', 'ip')
    guard.success('club', 'ip')
    guard.fail('club', 'ip')
    expect(() => guard.check('club', 'ip')).not.toThrow() // this address is back to one failure
    guard.fail('club', 'other')
    guard.fail('club', 'other2')
    expect(() => guard.check('club', 'anyone')).toThrow(AppError) // 4 failures club-wide
  })

  it('does not mix up clubs or addresses whose names look alike', () => {
    const guard = new LoginGuard(options, () => 0)
    guard.fail('a', 'b:c')
    guard.fail('a', 'b:c')
    expect(() => guard.check('a:b', 'c')).not.toThrow()
  })
})

describe('AppError', () => {
  it('maps each code to its HTTP status', () => {
    expect(statusFor('club_slug_taken')).toBe(409)
    expect(statusFor('invalid_token')).toBe(401)
    expect(statusFor('rate_limited')).toBe(429)
    expect(new AppError('not_found').status).toBe(404)
  })
})

describe('configuration', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }

  it('has safe defaults for development', () => {
    const config = loadConfig({})
    expect(config.port).toBe(8787)
    expect(config.databaseUrl).toBe('pglite://./.data')
    expect(config.allowedOrigins).toEqual([])
    expect(config.trustProxy).toBe(false)
    expect(config.tokenTtlDays).toBe(30)
  })

  it('reads settings from the environment', () => {
    const config = loadConfig({
      ...base,
      PORT: '9000',
      TRUST_PROXY: 'true',
      ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com',
      TOKEN_TTL_DAYS: '7',
      RATE_LIMIT_AUTH_MAX: '3',
    })
    expect(config).toMatchObject({ port: 9000, trustProxy: true, tokenTtlDays: 7 })
    expect(config.allowedOrigins).toEqual(['https://a.example.com', 'https://b.example.com'])
    expect(config.rateLimit.auth.max).toBe(3)
  })

  it('refuses to start in production without a real database', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL is required/)
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'pglite://memory' })).toThrow(/development only/)
    expect(loadConfig({ NODE_ENV: 'production', ...base }).databaseUrl).toBe(base.DATABASE_URL)
  })

  it('names the setting when a value is wrong', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL must start with/)
    expect(() => loadConfig({ ...base, PORT: 'abc' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...base, PORT: '0' })).toThrow(/PORT/)
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'maybe' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: 'example.com' })).toThrow(/ALLOWED_ORIGINS/)
    expect(() => loadConfig({ ...base, ALLOWED_ORIGINS: 'https://example.com/path' })).toThrow(/ALLOWED_ORIGINS/)
  })
})

describe('migrations', () => {
  const create: Migration = { id: '001', sql: 'create table widgets (id int primary key)' }
  const add: Migration = { id: '002', sql: 'alter table widgets add column name text' }

  it('apply once, in order, and are skipped on the next start', async () => {
    const db = await connectDb('pglite://memory')
    expect(await migrate(db, [create, add])).toEqual(['001', '002'])
    expect(await migrate(db, [create, add])).toEqual([])
    await db.query('insert into widgets (id, name) values (1, $1)', ['ok'])
    await db.close()
  })

  it('pick up only the new migration when one is added later', async () => {
    const db = await connectDb('pglite://memory')
    await migrate(db, [create])
    expect(await migrate(db, [create, add])).toEqual(['002'])
    await db.close()
  })

  it('leave nothing behind when a migration fails', async () => {
    const db = await connectDb('pglite://memory')
    await migrate(db, [create])
    const broken: Migration = { id: '002', sql: 'alter table widgets add column ok int; select * from missing_table' }
    await expect(migrate(db, [create, broken])).rejects.toThrow()

    // The half-applied change was rolled back and not recorded, so a fixed version can run.
    const columns = await db.query("select column_name from information_schema.columns where table_name = 'widgets'")
    expect(columns.rows.map((r) => (r as { column_name: string }).column_name)).toEqual(['id'])
    expect(await migrate(db, [create, add])).toEqual(['002'])
    await db.close()
  })

  it('create the real schema', async () => {
    const db = await connectDb('pglite://memory')
    await migrate(db)
    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    )
    expect(tables.rows.map((t) => t.table_name)).toEqual([
      'audit_log',
      'club_avatars',
      'club_card_logos',
      'club_devices',
      'club_players',
      'club_roster',
      'club_tokens',
      'clubs',
      'lifetime_batches',
      'live_sessions',
      'schema_migrations',
      'session_backups',
      'session_history',
      'session_presence',
    ])
    await db.close()
  })

  it('keep the session a club was running, and its live board, when clubs start running several', async () => {
    const db = await connectDb('pglite://memory')
    const before = MIGRATIONS.findIndex((m) => m.id === '010_multi_session')
    await migrate(db, MIGRATIONS.slice(0, before))
    await db.query("insert into clubs (slug, name, password_hash, recovery_hash) values ('aaa', 'A', 'x', 'x'), ('bbb', 'B', 'x', 'x')")
    const id = '00000000-0000-4000-8000-00000000000a'
    await db.query(`insert into session_backups (club_slug, state, session_id) values ('aaa', '{}', '${id}'), ('bbb', '{}', null)`)
    await db.query("insert into live_sessions (club_slug, state) values ('aaa', '{}'), ('bbb', '{}')")
    await migrate(db)
    const backups = await db.query<{ club_slug: string; session_id: string }>('select club_slug, session_id from session_backups order by club_slug')
    expect(backups.rows[0].session_id).toBe(id)
    expect(backups.rows[1].session_id).toMatch(/^[0-9a-f-]{36}$/)
    const lives = await db.query<{ club_slug: string; session_id: string }>('select club_slug, session_id from live_sessions order by club_slug')
    expect(lives.rows.map((r) => [r.club_slug, r.session_id])).toEqual([
      ['aaa', id],
      ['bbb', backups.rows[1].session_id],
    ])
    await db.close()
  })

  it('keep a club that already shows player photos showing them after photo sharing became a club setting', async () => {
    const db = await connectDb('pglite://memory')
    const before = MIGRATIONS.findIndex((m) => m.id === '005_photo_sharing')
    await migrate(db, MIGRATIONS.slice(0, before))
    await db.exec(`
      insert into clubs (slug, name, password_hash, recovery_hash) values ('with-photo', 'A', 'x', 'x'), ('no-photo', 'B', 'x', 'x');
      insert into club_avatars (club_slug, name_key, kind, content_type, photo) values ('with-photo', 'ann', 'photo', 'image/png', 'AAAA');
      insert into club_avatars (club_slug, name_key, kind, color) values ('no-photo', 'bob', 'initials', '#123456');
    `)
    await migrate(db)
    const { rows } = await db.query<{ slug: string; share_photos: boolean }>('select slug, share_photos from clubs order by slug')
    expect(rows).toEqual([
      { slug: 'no-photo', share_photos: false },
      { slug: 'with-photo', share_photos: true },
    ])
    await db.close()
  })

  it('give every saved player the rating that keeps their level under the default scale', async () => {
    const db = await connectDb('pglite://memory')
    const before = MIGRATIONS.findIndex((m) => m.id === '011_skill_scales')
    await migrate(db, MIGRATIONS.slice(0, before))
    await db.exec(`
      insert into clubs (slug, name, password_hash, recovery_hash) values ('aaa', 'A', 'x', 'x');
      insert into club_roster (club_slug, name_key, name, skill) values
        ('aaa', 'p1', 'P1', 1), ('aaa', 'p2', 'P2', 2), ('aaa', 'p3', 'P3', 3),
        ('aaa', 'p4', 'P4', 4), ('aaa', 'p5', 'P5', 5), ('aaa', 'p6', 'P6', 6);
    `)
    await migrate(db)
    const { rows } = await db.query<{ skill: number; rating: string }>('select skill, rating from club_roster order by skill')
    expect(rows.map((r) => [r.skill, Number(r.rating)])).toEqual([[1, 1], [2, 2.5], [3, 3], [4, 3.5], [5, 4], [6, 4.5]])
    const clubs = await db.query<{ skill_scale: unknown }>('select skill_scale from clubs')
    expect(clubs.rows).toEqual([{ skill_scale: null }])
    await db.close()
  })

  it('drop every club logo, since clubs no longer have one', async () => {
    const db = await connectDb('pglite://memory')
    const before = MIGRATIONS.findIndex((m) => m.id === '008_drop_club_logos')
    await migrate(db, MIGRATIONS.slice(0, before))
    await db.exec(`
      insert into clubs (slug, name, password_hash, recovery_hash) values ('with-logo', 'A', 'x', 'x');
      insert into club_logos (club_slug, content_type, data) values ('with-logo', 'image/png', 'AAAA');
    `)
    await migrate(db)
    const { rows } = await db.query("select 1 from information_schema.tables where table_name = 'club_logos'")
    expect(rows).toHaveLength(0)
    expect((await db.query("select slug from clubs")).rows).toEqual([{ slug: 'with-logo' }])
    await db.close()
  })

  it('roll back a whole transaction when part of it fails', async () => {
    const db = await connectDb('pglite://memory')
    await db.exec('create table t (id int primary key)')
    await expect(
      db.transaction(async (tx) => {
        await tx.query('insert into t values (1)')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect((await db.query('select 1 from t')).rowCount).toBe(0)
    await db.close()
  })
})
