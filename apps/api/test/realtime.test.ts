import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db'
import { LiveHub } from '../src/realtime'
import { bearer, clearData, createClub, publish, startTestApp, startTestDb } from './helpers'

interface SseEvent {
  event: string
  data: { state?: { location?: string }; updatedAt?: string; revision?: number }
}

/** What viewers act on: the board and its end. Revision signals (for staff devices) are left out. */
const board = (events: SseEvent[]) => events.filter((e) => e.event !== 'revision')

/** A minimal Server-Sent Events client that records every event and comment it sees. */
async function openStream(baseUrl: string, slug: string, headers: Record<string, string> = {}) {
  const controller = new AbortController()
  const response = await fetch(`${baseUrl}/api/clubs/${slug}/live/stream`, {
    headers,
    signal: controller.signal,
  })
  const events: SseEvent[] = []
  let raw = ''
  let ended = false

  if (response.ok && response.body) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          raw += text
          buffer += text
          for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
            const block = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const event = /^event: (.+)$/m.exec(block)?.[1]
            const data = /^data: (.+)$/m.exec(block)?.[1]
            if (event && data) events.push({ event, data: JSON.parse(data) })
          }
        }
      } catch {
        // Aborted by the test.
      } finally {
        ended = true
      }
    })()
  }

  const waitFor = async (predicate: () => boolean, what: string, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}. Saw: ${JSON.stringify(events)}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  return {
    response,
    events,
    raw: () => raw,
    ended: () => ended,
    close: () => controller.abort(),
    waitForEvents: (count: number) => waitFor(() => events.length >= count, `${count} events`),
    waitForBoard: (count: number) => waitFor(() => board(events).length >= count, `${count} board events`),
    waitForRaw: (text: string) => waitFor(() => raw.includes(text), `"${text}"`),
    waitUntilEnded: () => waitFor(() => ended, 'the stream to end'),
  }
}

let db: Db
let app: FastifyInstance
let hub: LiveHub
let baseUrl: string
const open: { close: () => void }[] = []

const watch = async (slug: string, headers?: Record<string, string>) => {
  const stream = await openStream(baseUrl, slug, headers)
  open.push(stream)
  return stream
}

async function startApp(overrides: Parameters<typeof startTestApp>[1] = {}) {
  hub = new LiveHub({ perIp: 3, total: 100 })
  app = await startTestApp(db, { sseHeartbeatMs: 25, ...overrides }, { hub })
  await app.listen({ host: '127.0.0.1', port: 0 })
  baseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
}

beforeAll(async () => {
  db = await startTestDb()
})
afterAll(() => db.close())
beforeEach(async () => {
  await clearData(db)
  await startApp()
})
afterEach(async () => {
  open.splice(0).forEach((stream) => stream.close())
  await app.close()
})

describe('the live stream', () => {
  it('opens as an event stream that proxies will not buffer', async () => {
    const stream = await watch('some-club')
    expect(stream.response.status).toBe(200)
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream')
    expect(stream.response.headers.get('cache-control')).toContain('no-cache')
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no')
  })

  it('starts with "cleared" when the club has no session', async () => {
    const stream = await watch('some-club')
    await stream.waitForEvents(1)
    expect(stream.events[0].event).toBe('cleared')
  })

  it('starts with the current session when one is running', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token, 'Already running')
    const stream = await watch(slug)
    await stream.waitForEvents(1)
    expect(stream.events[0].event).toBe('update')
    expect(stream.events[0].data.state?.location).toBe('Already running')
  })

  it('pushes each publish to every viewer of that club, and to nobody else', async () => {
    const a = await createClub(app, { slug: 'club-a' })
    await createClub(app, { slug: 'club-b' })
    const first = await watch('club-a')
    const second = await watch('club-a')
    const other = await watch('club-b')
    await Promise.all([first, second, other].map((s) => s.waitForEvents(1)))

    await publish(app, a.token, 'Round one')
    await first.waitForBoard(2)
    await second.waitForBoard(2)
    expect(board(first.events)[1]).toMatchObject({ event: 'update', data: { state: { location: 'Round one' } } })
    expect(board(second.events)[1].data.state?.location).toBe('Round one')

    await publish(app, a.token, 'Round two')
    await first.waitForBoard(3)
    expect(board(first.events)[2].data.state?.location).toBe('Round two')
    expect(other.events).toHaveLength(1) // only its own initial "cleared"
  })

  it('keeps a session that is not live off the public page, while still telling staff devices it changed', async () => {
    const { token, slug } = await createClub(app)
    const stream = await watch(slug)
    await stream.waitForEvents(1)

    expect((await publish(app, token, 'Setting up', undefined, { live: false })).statusCode).toBe(200)
    await stream.waitForEvents(2)
    expect(stream.events[1]).toMatchObject({ event: 'revision', data: { revision: 1 } })
    expect(stream.events[1].data).toHaveProperty('sessionId')
    expect(board(stream.events)).toHaveLength(1) // still only the initial "cleared"
    expect(stream.raw()).not.toContain('Setting up')
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live` })).statusCode).toBe(404)
    // Staff devices still get the club's copy.
    const state = await app.inject({ method: 'GET', url: '/api/session/state', headers: bearer(token) })
    expect(state.json()).toMatchObject({ revision: 1, full: { location: 'Setting up' } })

    // Going live shows it to viewers; going back to not live takes it away again.
    await publish(app, token, 'Now live', undefined, { live: true })
    await stream.waitForBoard(2)
    expect(board(stream.events)[1]).toMatchObject({ event: 'update', data: { state: { location: 'Now live' } } })
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live` })).statusCode).toBe(200)
    await publish(app, token, 'Paused', undefined, { live: false })
    await stream.waitForBoard(3)
    expect(board(stream.events)[2].event).toBe('cleared')
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live` })).statusCode).toBe(404)
    expect(stream.raw()).not.toContain('Paused')
  })

  it('treats a publish without the live flag (an older app) as live', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token, 'Older app')
    expect((await app.inject({ method: 'GET', url: `/api/clubs/${slug}/live` })).statusCode).toBe(200)
  })

  it('announces the end of a session', async () => {
    const { token, slug } = await createClub(app)
    await publish(app, token)
    const stream = await watch(slug)
    await stream.waitForEvents(1)

    await app.inject({ method: 'DELETE', url: '/api/session', headers: bearer(token) })
    await stream.waitForEvents(3)
    // Staff devices learn which session ended; older viewers see the board cleared.
    expect(stream.events[1]).toMatchObject({ event: 'ended', data: { sessionId: expect.any(String) } })
    expect(stream.events[2].event).toBe('cleared')
  })

  it('never streams private data', async () => {
    const { token, slug } = await createClub(app)
    const stream = await watch(slug)
    await stream.waitForEvents(1)
    await publish(app, token)
    await stream.waitForEvents(2)
    expect(stream.raw()).not.toMatch(/gender|lastResult/i)
  })

  it('sends heartbeats so idle connections stay open through proxies', async () => {
    const stream = await watch('some-club')
    await stream.waitForRaw(': ping')
  })

  it('stops tracking a viewer as soon as they disconnect', async () => {
    const stream = await watch('some-club')
    await stream.waitForEvents(1)
    expect(hub.count()).toBe(1)
    stream.close()
    const deadline = Date.now() + 2000
    while (hub.count() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    expect(hub.count()).toBe(0)
  })

  it('caps how many streams one address can hold open', async () => {
    const streams = await Promise.all([1, 2, 3].map(() => watch('some-club')))
    await Promise.all(streams.map((s) => s.waitForEvents(1)))
    const fourth = await watch('some-club')
    expect(fourth.response.status).toBe(429)
    expect(((await fourth.response.json()) as { error: string }).error).toBe('rate_limited')
    expect(fourth.response.headers.get('retry-after')).toBe('30')

    // Closing one frees a place.
    streams[0].close()
    const deadline = Date.now() + 2000
    while (hub.count() >= 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10))
    const retry = await watch('some-club')
    expect(retry.response.status).toBe(200)
  })

  it('answers an invalid club URL with a plain 404 before opening a stream', async () => {
    const response = await fetch(`${baseUrl}/api/clubs/NOT%20VALID/live/stream`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  it('ends open streams when the server shuts down, instead of hanging', async () => {
    const stream = await watch('some-club')
    await stream.waitForEvents(1)
    const started = Date.now()
    await app.close()
    expect(Date.now() - started).toBeLessThan(2000)
    await stream.waitUntilEnded()
    await startApp() // so afterEach has an app to close
  })
})

describe('the live stream from another origin', () => {
  it('allows only listed origins', async () => {
    await app.close()
    await startApp({ allowedOrigins: ['https://app.example.com'] })

    const allowed = await watch('some-club', { origin: 'https://app.example.com' })
    expect(allowed.response.headers.get('access-control-allow-origin')).toBe('https://app.example.com')

    const stranger = await watch('some-club', { origin: 'https://evil.example' })
    expect(stranger.response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
