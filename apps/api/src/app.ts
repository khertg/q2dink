import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type { Config } from './config'
import type { Db } from './db'
import { AppError, defaultMessage } from './errors'
import { LiveHub } from './realtime'
import { registerAuditRoutes } from './routes/audit'
import { registerClubRoutes } from './routes/clubs'
import { registerLiveRoutes } from './routes/live'
import { registerMediaRoutes } from './routes/media'
import { registerSessionRoutes } from './routes/session'
import { registerSpeechRoutes } from './routes/speech'
import { LoginGuard } from './services/loginGuard'
import { SpeechService } from './services/speech'
import { apiCommit, apiVersion } from './version'

export interface AppDeps {
  db: Db
  config: Config
  /** Overridable so tests can watch connections and control time. */
  hub?: LiveHub
  guard?: LoginGuard
  logger?: FastifyServerOptions['logger']
  /** Where log lines go (tests capture them); defaults to stdout. */
  logStream?: NodeJS.WritableStream
  /** How the voice service is called; tests pass a fake so they never reach ElevenLabs. */
  speechFetch?: typeof fetch
}

/** What the route modules share. */
export interface RouteDeps {
  db: Db
  config: Config
  hub: LiveHub
  guard: LoginGuard
  speech: SpeechService
}

const REDACT = ['req.headers.authorization', 'req.headers.cookie']

/** Build the HTTP app. Nothing is listening yet; call `app.listen` (or `app.inject` in tests). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, config } = deps
  const hub = deps.hub ?? new LiveHub({ perIp: config.maxSubscribersPerIp, total: config.maxSubscribersTotal })
  const guard = deps.guard ?? new LoginGuard(config.loginLockout)

  const app = Fastify({
    logger: deps.logger ?? {
      level: config.logLevel,
      redact: REDACT,
      ...(deps.logStream ? { stream: deps.logStream } : {}),
    },
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimitBytes,
    // Be strict: a number where text is expected is an error, not something to quietly convert.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  })

  await app.register(helmet, {
    // The API returns JSON and event streams, so a page-oriented CSP adds nothing.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })

  if (config.allowedOrigins.length > 0) {
    await app.register(cors, {
      origin: config.allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['authorization', 'content-type', 'if-none-match'],
      exposedHeaders: ['retry-after', 'etag'],
      maxAge: 600,
    })
  }

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.global.max,
    timeWindow: config.rateLimit.global.windowMs,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: 'rate_limited',
      message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.retryAfterSeconds) reply.header('retry-after', String(error.retryAfterSeconds))
      return reply.code(error.status).send({ error: error.code, message: error.message })
    }

    const status = (error as { statusCode?: number }).statusCode
    const code = (error as { code?: string }).code
    if (status === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: (error as Error).message })
    }
    if (status === 413 || code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ error: 'payload_too_large', message: defaultMessage('payload_too_large') })
    }
    if ((error as { validation?: unknown }).validation || (status !== undefined && status >= 400 && status < 500)) {
      return reply.code(400).send({ error: 'invalid_request', message: defaultMessage('invalid_request') })
    }

    request.log.error({ err: error }, 'unhandled error')
    return reply.code(500).send({ error: 'internal_error', message: defaultMessage('internal_error') })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not_found', message: defaultMessage('not_found') }),
  )

  const speech = new SpeechService(config.speech, deps.speechFetch)
  const routeDeps: RouteDeps = { db, config, hub, guard, speech }
  await app.register(
    async (api) => {
      api.get('/health', { config: { rateLimit: false } }, async () => {
        await db.query('select 1')
        return { ok: true, version: apiVersion, commit: apiCommit }
      })
      registerClubRoutes(api, routeDeps)
      registerSessionRoutes(api, routeDeps)
      registerLiveRoutes(api, routeDeps)
      registerMediaRoutes(api, routeDeps)
      registerAuditRoutes(api, routeDeps)
      registerSpeechRoutes(api, routeDeps)
    },
    { prefix: '/api' },
  )

  // Event streams never finish on their own, so end them before the server starts waiting for
  // in-flight requests. (`onClose` would run too late and shutdown would hang.)
  app.addHook('preClose', async () => hub.closeAll())

  return app
}
