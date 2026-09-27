import { isSessionId, type LiveEvent, type LiveSessionsResponse } from '@q2dink/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RouteDeps } from '../app'
import { AppError } from '../errors'
import { getLiveSession, listLiveSessions } from '../services/sessions'
import { publicSlug, slugParams } from './auth'

export function formatEvent(event: LiveEvent): string {
  switch (event.type) {
    case 'update':
      return `event: update\ndata: ${JSON.stringify(event.row)}\n\n`
    case 'revision':
      return `event: revision\ndata: ${JSON.stringify({ revision: event.revision, ...(event.sessionId ? { sessionId: event.sessionId } : {}) })}\n\n`
    case 'ended':
      return `event: ended\ndata: ${JSON.stringify({ sessionId: event.sessionId })}\n\n`
    case 'cleared':
      return `event: cleared\ndata: ${JSON.stringify(event.sessionId ? { sessionId: event.sessionId } : {})}\n\n`
  }
}

/** The hub channel of one session's board. The club's own channel is its slug. */
export const sessionChannel = (slug: string, sessionId: string) => `${slug}/${sessionId}`

const sessionParams = {
  type: 'object',
  required: ['slug', 'sessionId'],
  properties: { slug: { type: 'string', maxLength: 64 }, sessionId: { type: 'string', maxLength: 64 } },
} as const

/** A session id from a public URL: anything that is not one looks exactly like a session that is not live. */
function publicSessionId(raw: string): string {
  if (!isSessionId(raw)) throw new AppError('not_found')
  return raw.toLowerCase()
}

/** The public live boards: read one once, or subscribe to changes. No login needed. */
export function registerLiveRoutes(api: FastifyInstance, { db, config, hub }: RouteDeps): void {
  const readBoard = async (reply: FastifyReply, request: FastifyRequest, slug: string, sessionId?: string) => {
    // An unknown club, a club with no running session and a session not on the live page look exactly the same.
    const row = await getLiveSession(db, slug, config.liveTtlHours, sessionId)
    if (!row) throw new AppError('not_found')

    const etag = `W/"${Date.parse(row.updatedAt)}"`
    reply.header('etag', etag).header('cache-control', 'no-cache')
    if (request.headers['if-none-match'] === etag) return reply.code(304).send()
    return row
  }

  const stream = async (request: FastifyRequest, reply: FastifyReply, slug: string, sessionId?: string) => {
    const raw = reply.raw

    // Events that arrive while the first snapshot is still loading are held, then
    // sent after it, so a viewer never ends up on an older state than the newest one.
    let ready = false
    let closed = false
    const held: LiveEvent[] = []
    const send = (event: LiveEvent) => {
      if (closed) return
      if (ready) raw.write(formatEvent(event))
      else held.push(event)
    }

    const unsubscribe = hub.subscribe(sessionId ? sessionChannel(slug, sessionId) : slug, request.ip, {
      send,
      close: () => raw.end(),
    })
    if (!unsubscribe) throw new AppError('rate_limited', { retryAfterSeconds: 30 })

    const origin = request.headers.origin
    const cors =
      origin && config.allowedOrigins.includes(origin)
        ? { 'access-control-allow-origin': origin, vary: 'Origin' }
        : {}

    const heartbeat = setInterval(() => {
      if (!closed) raw.write(': ping\n\n')
    }, config.sseHeartbeatMs)
    const finish = () => {
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
    }
    request.raw.on('close', finish)

    reply.hijack()
    raw.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // tell reverse proxies not to buffer the stream
      'x-content-type-options': 'nosniff',
    })
    raw.write('retry: 3000\n\n')

    const current = await getLiveSession(db, slug, config.liveTtlHours, sessionId).catch(() => null)
    if (closed) return
    ready = true
    raw.write(formatEvent(current ? { type: 'update', row: current } : { type: 'cleared', ...(sessionId ? { sessionId } : {}) }))
    for (const event of held) raw.write(formatEvent(event))
  }

  // The club's latest live session: what older viewers and the club's own QR code show.
  api.get<{ Params: { slug: string } }>('/clubs/:slug/live', { schema: { params: slugParams } }, async (request, reply) =>
    readBoard(reply, request, publicSlug(request.params.slug)),
  )

  api.get<{ Params: { slug: string } }>('/clubs/:slug/live/stream', { schema: { params: slugParams } }, async (request, reply) =>
    stream(request, reply, publicSlug(request.params.slug)),
  )

  // Every session the club has on its live page, so a viewer can choose when there are several.
  api.get<{ Params: { slug: string } }>(
    '/clubs/:slug/lives',
    { schema: { params: slugParams } },
    async (request, reply): Promise<LiveSessionsResponse> => {
      const sessions = await listLiveSessions(db, publicSlug(request.params.slug), config.liveTtlHours)
      reply.header('cache-control', 'no-cache')
      return { sessions }
    },
  )

  api.get<{ Params: { slug: string; sessionId: string } }>(
    '/clubs/:slug/live/:sessionId',
    { schema: { params: sessionParams } },
    async (request, reply) =>
      readBoard(reply, request, publicSlug(request.params.slug), publicSessionId(request.params.sessionId)),
  )

  api.get<{ Params: { slug: string; sessionId: string } }>(
    '/clubs/:slug/live/:sessionId/stream',
    { schema: { params: sessionParams } },
    async (request, reply) =>
      stream(request, reply, publicSlug(request.params.slug), publicSessionId(request.params.sessionId)),
  )
}
