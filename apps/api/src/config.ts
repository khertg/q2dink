export interface Limit {
  max: number
  windowMs: number
}

export interface Config {
  host: string
  port: number
  /** `postgres://...`, or `pglite://memory` / `pglite://<dir>` for the embedded database (dev and tests). */
  databaseUrl: string
  /** Origins allowed to call the API from a browser. Empty means same-origin only. */
  allowedOrigins: string[]
  trustProxy: boolean
  logLevel: string
  tokenTtlDays: number
  /** A live session that has not been republished for this long is treated as ended. */
  liveTtlHours: number
  /** How long the audit log keeps an entry. */
  auditRetentionDays: number
  bodyLimitBytes: number
  sseHeartbeatMs: number
  maxSubscribersPerIp: number
  maxSubscribersTotal: number
  rateLimit: {
    /** Every route, per IP. */
    global: Limit
    /** Create club, login and reset password, per IP. */
    auth: Limit
    /** Publish and clear, per IP. */
    write: Limit
    /** Voice call-outs, per IP: each one not already cached costs ElevenLabs credits. */
    speech: Limit
  }
  /** Voice call-outs (POST /speech) through ElevenLabs. Without a key the app uses the device's own voice. */
  speech: {
    apiKey: string | undefined
    model: string
    timeoutMs: number
  }
  loginLockout: {
    maxFailuresPerClubAndIp: number
    maxFailuresPerClub: number
    windowMs: number
  }
}

const MINUTE = 60_000


function int(env: Record<string, string | undefined>, name: string, fallback: number, min = 0): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer of at least ${min}, got "${raw}"`)
  }
  return value
}

function bool(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`${name} must be true or false, got "${raw}"`)
}

/** Read and validate configuration from environment variables. Fails fast with a clear message. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const production = env.NODE_ENV === 'production'
  const databaseUrl = env.DATABASE_URL || (production ? '' : 'pglite://./.data')

  if (!databaseUrl) throw new Error('DATABASE_URL is required in production')
  if (!/^(postgres(ql)?|pglite):\/\//.test(databaseUrl)) {
    throw new Error('DATABASE_URL must start with postgres:// or pglite://')
  }
  if (production && databaseUrl.startsWith('pglite://')) {
    throw new Error('The embedded pglite database is for development only; use Postgres in production')
  }

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  for (const origin of allowedOrigins) {
    try {
      const parsed = new URL(origin)
      if (parsed.origin !== origin) throw new Error()
    } catch {
      throw new Error(`ALLOWED_ORIGINS has an invalid origin "${origin}" (expected e.g. https://example.com)`)
    }
  }

  return {
    host: env.HOST || '0.0.0.0',
    port: int(env, 'PORT', 8787, 1),
    databaseUrl,
    allowedOrigins,
    trustProxy: bool(env, 'TRUST_PROXY', false),
    logLevel: env.LOG_LEVEL || 'info',
    tokenTtlDays: int(env, 'TOKEN_TTL_DAYS', 30, 1),
    liveTtlHours: int(env, 'LIVE_TTL_HOURS', 24, 1),
    auditRetentionDays: int(env, 'AUDIT_RETENTION_DAYS', 180, 1),
    bodyLimitBytes: 512 * 1024,
    sseHeartbeatMs: int(env, 'SSE_HEARTBEAT_MS', 25_000, 10),
    maxSubscribersPerIp: int(env, 'MAX_SUBSCRIBERS_PER_IP', 20, 1),
    maxSubscribersTotal: int(env, 'MAX_SUBSCRIBERS_TOTAL', 2000, 1),
    rateLimit: {
      global: { max: int(env, 'RATE_LIMIT_MAX', 300, 1), windowMs: MINUTE },
      auth: { max: int(env, 'RATE_LIMIT_AUTH_MAX', 10, 1), windowMs: 15 * MINUTE },
      write: { max: int(env, 'RATE_LIMIT_WRITE_MAX', 240, 1), windowMs: MINUTE },
      speech: { max: int(env, 'RATE_LIMIT_SPEECH_MAX', 30, 1), windowMs: MINUTE },
    },
    speech: {
      apiKey: env.ELEVENLABS_API_KEY || undefined,
      model: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
      timeoutMs: int(env, 'ELEVENLABS_TIMEOUT_MS', 8000, 1),
    },
    loginLockout: {
      maxFailuresPerClubAndIp: int(env, 'LOGIN_MAX_FAILURES_PER_IP', 5, 1),
      maxFailuresPerClub: int(env, 'LOGIN_MAX_FAILURES_PER_CLUB', 25, 1),
      windowMs: 15 * MINUTE,
    },
  }
}
