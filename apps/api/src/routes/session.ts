import {
  MAX_ROSTER_BATCH,
  SNAPSHOT_LIMITS,
  jsonBytes,
  parseFullBackupEnvelope,
  parsePublicSnapshot,
  type ConflictBody,
  type PublishMeta,
  type PublishResponse,
  type PutHistoryRequest,
  type PutRosterRequest,
  type RecordLifetimeRequest,
  type RenamePlayerRequest,
  type PresenceRequest,
  type RosterResponse,
  type SessionStateRow,
  type SessionsResponse,
} from '@q2dink/shared'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../app'
import { AppError, defaultMessage } from '../errors'
import {
  deleteHistory,
  getHistory,
  isHistoryId,
  listDeletedHistory,
  listHistory,
  purgeHistory,
  putHistory,
  restoreHistory,
} from '../services/history'
import { recordLifetime, MAX_PLAYERS_PER_BATCH } from '../services/lifetime'
import { renamePlayer } from '../services/players'
import { getRoster, putRoster } from '../services/roster'
import {
  clearSession,
  dropPresence,
  getFullSession,
  getLiveSession,
  getSessionState,
  listSessions,
  publishSession,
  touchPresence,
} from '../services/sessions'
import { authenticate } from './auth'
import { sessionChannel } from './live'

const publishBody = {
  type: 'object',
  required: ['public', 'full'],
  additionalProperties: false,
  properties: {
    public: { type: 'object' },
    full: { type: 'object' },
    baseRevision: { type: 'integer', minimum: 0 },
    sessionId: { type: 'string', maxLength: 64 },
    startedAt: { type: 'string', maxLength: 40 },
    live: { type: 'boolean' },
  },
} as const

const presenceBody = {
  type: 'object',
  required: ['deviceId'],
  additionalProperties: false,
  properties: { deviceId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const

/** A session id from a query string: missing is allowed (older apps mean the latest), malformed is not. */
function optionalSessionId(raw: string | undefined): string | undefined {
  if (raw !== undefined && !isHistoryId(raw)) throw new AppError('invalid_request')
  return raw
}

const historyBody = {
  type: 'object',
  required: ['endedAt', 'mode', 'players', 'games', 'full'],
  additionalProperties: false,
  properties: {
    endedAt: { type: 'string', maxLength: 40 },
    mode: { type: 'string', enum: ['doubles', 'singles'] },
    players: { type: 'integer', minimum: 0, maximum: SNAPSHOT_LIMITS.players },
    games: { type: 'integer', minimum: 0, maximum: 1_000_000 },
    full: { type: 'object' },
  },
} as const

const renameBody = {
  type: 'object',
  required: ['from', 'to'],
  additionalProperties: false,
  properties: {
    from: { type: 'string', maxLength: 200 },
    to: { type: 'string', maxLength: 200 },
  },
} as const

const rosterBody = {
  type: 'object',
  required: ['players'],
  additionalProperties: false,
  properties: {
    players: {
      type: 'array',
      maxItems: MAX_ROSTER_BATCH,
      items: {
        type: 'object',
        required: ['name', 'skill'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 200 },
          skill: { type: 'integer', minimum: 1, maximum: 6 },
          gender: { type: 'string', enum: ['M', 'F'] },
        },
      },
    },
  },
} as const

const lifetimeBody = {
  type: 'object',
  required: ['batchId', 'players'],
  additionalProperties: false,
  properties: {
    batchId: { type: 'string', maxLength: 64 },
    players: {
      type: 'array',
      maxItems: MAX_PLAYERS_PER_BATCH,
      items: {
        type: 'object',
        required: ['name', 'games', 'wins', 'losses'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 200 },
          games: { type: 'integer' },
          wins: { type: 'integer' },
          losses: { type: 'integer' },
        },
      },
    },
  },
} as const

/** Everything a signed-in club does: publish, resume and clear its session, keep its history, upload leaderboard totals. */
export function registerSessionRoutes(api: FastifyInstance, { db, config, hub }: RouteDeps): void {
  const write = {
    rateLimit: { max: config.rateLimit.write.max, timeWindow: config.rateLimit.write.windowMs },
  }

  /**
   * Older viewers follow the club's channel, which shows the club's latest live session: after a session left
   * the live page, the next latest one (or none).
   */
  const tellClubViewers = async (slug: string) => {
    const latest = await getLiveSession(db, slug, config.liveTtlHours).catch(() => null)
    hub.publish(slug, latest ? { type: 'update', row: latest } : { type: 'cleared' })
  }

  api.put<{ Body: { public: unknown; full: unknown } & PublishMeta }>(
    '/session',
    { config: write, schema: { body: publishBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)

      // parsePublicSnapshot returns a fresh copy with only the known public fields,
      // so anything extra a client sends (such as genders) can never reach viewers.
      const snapshot = parsePublicSnapshot(request.body.public)
      const backup = parseFullBackupEnvelope(request.body.full)
      if (!snapshot || !backup) throw new AppError('invalid_snapshot')
      if (jsonBytes(snapshot) > SNAPSHOT_LIMITS.publicBytes || jsonBytes(backup) > SNAPSHOT_LIMITS.fullBytes) {
        throw new AppError('payload_too_large')
      }

      const { baseRevision, sessionId, startedAt, live } = request.body
      if (sessionId !== undefined && !isHistoryId(sessionId)) throw new AppError('invalid_request')
      if (startedAt !== undefined && Number.isNaN(Date.parse(startedAt))) throw new AppError('invalid_request')
      const result = await publishSession(db, slug, snapshot, backup, { baseRevision, sessionId, startedAt, live })
      if ('conflict' in result) {
        // Another staff device changed or ended the session: this one rebases on the club's copy.
        const body: ConflictBody = { error: 'conflict', message: defaultMessage('conflict'), current: result.conflict }
        return reply.code(409).send(body)
      }
      // Viewers see the board only while it is live; staff devices follow every change by its revision.
      const channel = sessionChannel(slug, result.sessionId)
      if (result.row) {
        hub.publish(channel, { type: 'update', row: result.row })
        hub.publish(slug, { type: 'update', row: result.row })
      } else if (result.wasLive) {
        hub.publish(channel, { type: 'cleared', sessionId: result.sessionId })
        await tellClubViewers(slug)
      }
      hub.publish(slug, { type: 'revision', revision: result.revision, sessionId: result.sessionId })
      const response: PublishResponse = { updatedAt: result.updatedAt, revision: result.revision }
      return response
    },
  )

  // The private backup, so another staff device can pick the session up. With no ?sessionId: the latest.
  api.get<{ Querystring: { sessionId?: string } }>('/session', async (request) => {
    const { slug } = await authenticate(db, request)
    const backup = await getFullSession(db, slug, optionalSessionId(request.query.sessionId))
    if (backup === null) throw new AppError('not_found')
    return backup
  })

  // The private copy with its revision, for staff devices running the session together.
  api.get<{ Querystring: { sessionId?: string } }>('/session/state', async (request): Promise<SessionStateRow> => {
    const { slug } = await authenticate(db, request)
    const state = await getSessionState(db, slug, optionalSessionId(request.query.sessionId))
    if (!state) throw new AppError('not_found')
    return state
  })

  // Every session the club is running, and which staff devices have each open.
  api.get('/sessions', async (request): Promise<SessionsResponse> => {
    const { slug } = await authenticate(db, request)
    return { sessions: await listSessions(db, slug) }
  })

  // This device has the session open (sent every few seconds while it does), or left it.
  api.put<{ Params: { id: string }; Body: PresenceRequest }>(
    '/sessions/:id/presence',
    { schema: { body: presenceBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      if (!isHistoryId(request.params.id)) throw new AppError('invalid_request')
      await touchPresence(db, slug, request.params.id.toLowerCase(), request.body.deviceId)
      return reply.code(204).send()
    },
  )

  api.delete<{ Params: { id: string }; Querystring: { deviceId?: string } }>(
    '/sessions/:id/presence',
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      const { deviceId } = request.query
      if (!isHistoryId(request.params.id) || !deviceId || deviceId.length > 64) throw new AppError('invalid_request')
      await dropPresence(db, slug, request.params.id.toLowerCase(), deviceId)
      return reply.code(204).send()
    },
  )

  // With ?sessionId, only that session ends: the club's other sessions keep running. Without it (an older
  // app), the latest one.
  api.delete<{ Querystring: { sessionId?: string } }>('/session', { config: write }, async (request, reply) => {
    const { slug } = await authenticate(db, request)
    const ended = await clearSession(db, slug, optionalSessionId(request.query.sessionId))
    if (ended) {
      hub.publish(sessionChannel(slug, ended), { type: 'cleared', sessionId: ended })
      hub.publish(slug, { type: 'ended', sessionId: ended })
      await tellClubViewers(slug)
    }
    return reply.code(204).send()
  })

  api.post<{ Body: RecordLifetimeRequest }>(
    '/lifetime',
    { config: write, schema: { body: lifetimeBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await recordLifetime(db, slug, request.body.batchId, request.body.players)
      return reply.code(204).send()
    },
  )

  // A player was renamed on a staff device: their leaderboard row and shared avatar follow the new name.
  api.post<{ Body: RenamePlayerRequest }>(
    '/players/rename',
    { config: write, schema: { body: renameBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await renamePlayer(db, slug, request.body.from, request.body.to)
      return reply.code(204).send()
    },
  )

  // The club's saved players, shared by all its staff devices. Private: it includes gender.
  api.put<{ Body: PutRosterRequest }>(
    '/roster',
    { config: write, schema: { body: rosterBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await putRoster(db, slug, request.body.players)
      return reply.code(204).send()
    },
  )

  api.get('/roster', async (request): Promise<RosterResponse> => {
    const { slug } = await authenticate(db, request)
    return { players: await getRoster(db, slug) }
  })

  // Ended sessions, kept so the club can look back at them and resume one from any staff device.
  api.put<{ Params: { id: string }; Body: PutHistoryRequest }>(
    '/history/:id',
    { config: write, schema: { body: historyBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      const { id } = request.params
      const { full, ...rest } = request.body
      const backup = parseFullBackupEnvelope(full)
      const endedAt = new Date(rest.endedAt)
      if (!isHistoryId(id) || !backup || Number.isNaN(endedAt.getTime())) throw new AppError('invalid_request')
      if (jsonBytes(backup) > SNAPSHOT_LIMITS.fullBytes) throw new AppError('payload_too_large')
      await putHistory(db, slug, id, { ...rest, endedAt: endedAt.toISOString() }, backup)
      return reply.code(204).send()
    },
  )

  api.get('/history', async (request) => {
    const { slug } = await authenticate(db, request)
    return { sessions: await listHistory(db, slug) }
  })

  // Recently deleted: past sessions that can still be restored. (A fixed path, so never taken for an id.)
  api.get('/history/deleted', async (request) => {
    const { slug } = await authenticate(db, request)
    return { sessions: await listDeletedHistory(db, slug) }
  })

  api.get<{ Params: { id: string } }>('/history/:id', async (request) => {
    const { slug } = await authenticate(db, request)
    if (!isHistoryId(request.params.id)) throw new AppError('not_found')
    const state = await getHistory(db, slug, request.params.id)
    if (state === null) throw new AppError('not_found')
    return state
  })

  // Moves it to Recently deleted; with ?permanent=1 it is removed for good. An older app's delete is restorable.
  api.delete<{ Params: { id: string }; Querystring: { permanent?: string } }>(
    '/history/:id',
    { config: write },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      if (isHistoryId(request.params.id)) {
        if (request.query.permanent === '1') await purgeHistory(db, slug, request.params.id)
        else await deleteHistory(db, slug, request.params.id)
      }
      return reply.code(204).send()
    },
  )

  api.post<{ Params: { id: string } }>('/history/:id/restore', { config: write }, async (request, reply) => {
    const { slug } = await authenticate(db, request)
    if (isHistoryId(request.params.id)) await restoreHistory(db, slug, request.params.id)
    return reply.code(204).send()
  })
}
