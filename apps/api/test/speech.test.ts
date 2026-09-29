import { DEFAULT_VOICE_ID, type VoiceOptions } from '@q2dink/shared'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../src/db'
import { bearer, clearData, createClub, startTestApp, startTestDb } from './helpers'

let db: Db
beforeAll(async () => {
  db = await startTestDb()
})
afterAll(async () => {
  await db.close()
})
beforeEach(() => clearData(db))

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])
const SPEECH = { apiKey: 'xi-test-key', model: 'eleven_flash_v2_5', timeoutMs: 1000 }

/** An app whose voice service is `fake`, with or without a key. */
async function appWith(fake: typeof fetch, apiKey: string | null = SPEECH.apiKey): Promise<FastifyInstance> {
  return startTestApp(db, { speech: { ...SPEECH, apiKey: apiKey ?? undefined } }, { speechFetch: fake })
}

const say = (app: FastifyInstance, token: string | null, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/speech', headers: token ? bearer(token) : {}, payload: payload as object })

const audioReply = () => vi.fn(async () => new Response(MP3, { status: 200, headers: { 'content-type': 'audio/mpeg' } }))

describe('POST /speech', () => {
  it('needs a staff token and a valid text', async () => {
    const fake = audioReply()
    const app = await appWith(fake)
    const { token } = await createClub(app)
    expect((await say(app, null, { text: 'Hi' })).statusCode).toBe(401)
    expect((await say(app, token, { text: '  ' })).statusCode).toBe(400)
    expect((await say(app, token, { text: 'a'.repeat(401) })).statusCode).toBe(400)
    expect(fake).not.toHaveBeenCalled()
    await app.close()
  })

  it('answers speech_unavailable when the server has no ElevenLabs key', async () => {
    const fake = audioReply()
    const app = await appWith(fake, null)
    const { token } = await createClub(app)
    const response = await say(app, token, { text: 'Next up: Ann' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: 'speech_unavailable' })
    expect(fake).not.toHaveBeenCalled()
    await app.close()
  })

  it('reads the text through ElevenLabs and serves a repeat from memory', async () => {
    const fake = audioReply()
    const app = await appWith(fake)
    const { token } = await createClub(app)
    const response = await say(app, token, { text: ' Court 1: Ann and Bob ' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('audio/mpeg')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(new Uint8Array(response.rawPayload)).toEqual(MP3)

    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}?output_format=mp3_44100_64`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi-test-key')
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Court 1: Ann and Bob', model_id: 'eleven_flash_v2_5' })

    expect((await say(app, token, { text: 'Court 1: Ann and Bob' })).statusCode).toBe(200)
    expect(fake).toHaveBeenCalledTimes(1)
    expect((await say(app, token, { text: 'Court 2: Cal' })).statusCode).toBe(200)
    expect(fake).toHaveBeenCalledTimes(2)
    await app.close()
  })

  it('answers speech_unavailable when ElevenLabs refuses the key or the quota', async () => {
    for (const status of [401, 402, 429]) {
      const app = await appWith(vi.fn(async () => new Response('{"detail":"quota"}', { status })))
      const { token } = await createClub(app)
      const response = await say(app, token, { text: 'Hi' })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ error: 'speech_unavailable' })
      await app.close()
    }
  })

  it('answers speech_failed on other errors, and caches nothing', async () => {
    const failing = vi.fn(async () => new Response('oops', { status: 500 }))
    let app = await appWith(failing)
    let { token } = await createClub(app)
    expect((await say(app, token, { text: 'Hi' })).json()).toMatchObject({ error: 'speech_failed' })
    expect((await say(app, token, { text: 'Hi' })).statusCode).toBe(502)
    expect(failing).toHaveBeenCalledTimes(2)
    await app.close()

    app = await appWith(vi.fn(async () => Promise.reject(new Error('timeout'))))
    ;({ token } = await createClub(app))
    expect((await say(app, token, { text: 'Hi' })).statusCode).toBe(502)
    await app.close()
  })
})

describe('the club voice (GET/PUT /voice)', () => {
  const getVoice = (app: FastifyInstance, token: string | null) =>
    app.inject({ method: 'GET', url: '/api/voice', headers: token ? bearer(token) : {} })
  const putVoice = (app: FastifyInstance, token: string | null, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/voice', headers: token ? bearer(token) : {}, payload: payload as object })

  it('starts on ElevenLabs and says whether the server has a key', async () => {
    let app = await appWith(audioReply())
    let { token } = await createClub(app)
    expect((await getVoice(app, token)).json()).toEqual({ voice: 'elevenlabs', voiceId: null, texts: {}, elevenLabs: true })
    await app.close()

    app = await appWith(audioReply(), null)
    ;({ token } = await createClub(app))
    expect((await getVoice(app, token)).json()).toEqual({ voice: 'elevenlabs', voiceId: null, texts: {}, elevenLabs: false })
    await app.close()
  })

  it('keeps the choice per club, and refuses a bad one or no token', async () => {
    const app = await appWith(audioReply())
    const a = await createClub(app)
    const b = await createClub(app)
    const put = await putVoice(app, a.token, { voice: 'device' })
    expect(put.statusCode).toBe(200)
    expect(put.json()).toEqual({ voice: 'device', voiceId: null, texts: {}, elevenLabs: true })
    expect((await getVoice(app, a.token)).json()).toMatchObject({ voice: 'device' })
    expect((await getVoice(app, b.token)).json()).toMatchObject({ voice: 'elevenlabs' })
    expect((await putVoice(app, a.token, { voice: 'robot' })).statusCode).toBe(400)
    expect((await putVoice(app, null, { voice: 'device' })).statusCode).toBe(401)
    expect((await getVoice(app, null)).statusCode).toBe(401)
    await app.close()
  })

  it('never calls ElevenLabs while the club uses the device voice', async () => {
    const fake = audioReply()
    const app = await appWith(fake)
    const { token } = await createClub(app)
    await putVoice(app, token, { voice: 'device' })
    const response = await say(app, token, { text: 'Next up: Ann' })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: 'speech_unavailable' })
    expect(fake).not.toHaveBeenCalled()

    await putVoice(app, token, { voice: 'elevenlabs' })
    expect((await say(app, token, { text: 'Next up: Ann' })).statusCode).toBe(200)
    expect(fake).toHaveBeenCalledTimes(1)
    await app.close()
  })
})

describe('the club’s ElevenLabs voice', () => {
  const putVoice = (app: FastifyInstance, token: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/voice', headers: bearer(token), payload: payload as object })
  const calledUrl = (fake: ReturnType<typeof audioReply>, call: number) => (fake.mock.calls[call] as unknown as [string])[0]

  it('reads with the voice the club chose, or one being tried, and keeps it until changed', async () => {
    const fake = audioReply()
    const app = await appWith(fake)
    const { token } = await createClub(app)
    expect((await putVoice(app, token, { voice: 'elevenlabs', voiceId: 'clubVoice1' })).json()).toMatchObject({
      voiceId: 'clubVoice1',
    })
    await say(app, token, { text: 'Next up' })
    expect(calledUrl(fake, 0)).toContain('/text-to-speech/clubVoice1?')
    await say(app, token, { text: 'Next up', voiceId: 'tryMe2' })
    expect(calledUrl(fake, 1)).toContain('/text-to-speech/tryMe2?')

    // Switching to the device voice and back keeps the chosen voice; null goes back to the default.
    await putVoice(app, token, { voice: 'device' })
    expect((await putVoice(app, token, { voice: 'elevenlabs' })).json()).toMatchObject({ voiceId: 'clubVoice1' })
    expect((await putVoice(app, token, { voice: 'elevenlabs', voiceId: null })).json()).toMatchObject({ voiceId: null })
    expect((await putVoice(app, token, { voice: 'elevenlabs', voiceId: 'no spaces!' })).statusCode).toBe(400)
    await app.close()
  })

  it('lists only the account’s own voices, by name, leaving out ElevenLabs’ defaults and marking library voices', async () => {
    const list = {
      voices: [
        { voice_id: 'lib1', name: 'Zed', category: 'professional', labels: { accent: 'british', gender: 'male' } },
        { voice_id: 'own1', name: 'Anna', category: 'cloned', labels: {} },
        { voice_id: 'pre1', name: 'Rachel', category: 'premade', labels: { description: 'calm' } },
        { voice_id: 'bad id', name: 'Broken', category: 'premade' },
      ],
    }
    const fake = vi.fn(async () => new Response(JSON.stringify(list), { headers: { 'content-type': 'application/json' } }))
    const app = await appWith(fake)
    const { token } = await createClub(app)
    const options = async () =>
      (await app.inject({ method: 'GET', url: '/api/voice/options', headers: bearer(token) })).json<VoiceOptions>()
    expect(await options()).toEqual({
      listable: true,
      voices: [
        { id: 'own1', name: 'Anna', paidOnly: false },
        { id: 'lib1', name: 'Zed', description: 'british, male', paidOnly: true },
      ],
    })
    // The voices and the account's plan, once; the second list comes from memory.
    await options()
    expect(fake).toHaveBeenCalledTimes(2)
    expect((fake.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'xi-api-key': 'xi-test-key' })
    expect((await app.inject({ method: 'GET', url: '/api/voice/options' })).statusCode).toBe(401)
    await app.close()
  })

  it('says voices cannot be listed when the key lacks the permission, and needs a key', async () => {
    let app = await appWith(vi.fn(async () => new Response('{}', { status: 401 })))
    let { token } = await createClub(app)
    const options = (a: FastifyInstance, t: string) => a.inject({ method: 'GET', url: '/api/voice/options', headers: bearer(t) })
    expect((await options(app, token)).json()).toEqual({ voices: [], listable: false })
    await app.close()

    app = await appWith(audioReply(), null)
    ;({ token } = await createClub(app))
    expect((await options(app, token)).statusCode).toBe(503)
    await app.close()
  })
})

describe('the voice list on a paid ElevenLabs plan', () => {
  const list = { voices: [{ voice_id: 'lib1', name: 'Zed', category: 'professional' }] }
  /** ElevenLabs answering the voice list, and the account's plan (or refusing to say, with a status). */
  const elevenLabs = (plan: string | number) =>
    vi.fn(async (url: string) =>
      url.endsWith('/v1/user/subscription')
        ? typeof plan === 'number'
          ? new Response('{}', { status: plan })
          : new Response(JSON.stringify({ tier: plan }))
        : new Response(JSON.stringify(list)),
    )
  const paidOnly = async (plan: string | number) => {
    const fake = elevenLabs(plan)
    const app = await appWith(fake as unknown as typeof fetch)
    const { token } = await createClub(app)
    const options = (await app.inject({ method: 'GET', url: '/api/voice/options', headers: bearer(token) })).json<VoiceOptions>()
    await app.close()
    return options.voices[0].paidOnly
  }

  it('marks library voices only when the plan is free or cannot be told', async () => {
    expect(await paidOnly('starter')).toBe(false)
    expect(await paidOnly('creator')).toBe(false)
    expect(await paidOnly('free')).toBe(true)
    // The key lacks the User permission: the label stays, to be safe.
    expect(await paidOnly(401)).toBe(true)
  })
})

describe('the club’s call-out wording', () => {
  const putVoice = (app: FastifyInstance, token: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/voice', headers: bearer(token), payload: payload as object })
  const texts = async (app: FastifyInstance, token: string) =>
    (await app.inject({ method: 'GET', url: '/api/voice', headers: bearer(token) })).json().texts

  it('is kept per club, only for known call-outs, until replaced', async () => {
    const app = await appWith(audioReply())
    const a = await createClub(app)
    const b = await createClub(app)
    expect(await texts(app, a.token)).toEqual({})

    const put = await putVoice(app, a.token, { voice: 'elevenlabs', texts: { nextUp: ' Coming up: {players}! ', madeUp: 'x' } })
    expect(put.statusCode).toBe(200)
    expect(put.json().texts).toEqual({ nextUp: 'Coming up: {players}!' })
    expect(await texts(app, b.token)).toEqual({})

    // Changing only the voice keeps the wording; an empty object goes back to every default.
    await putVoice(app, a.token, { voice: 'device' })
    expect(await texts(app, a.token)).toEqual({ nextUp: 'Coming up: {players}!' })
    await putVoice(app, a.token, { voice: 'elevenlabs', texts: {} })
    expect(await texts(app, a.token)).toEqual({})

    expect((await putVoice(app, a.token, { voice: 'elevenlabs', texts: { nextUp: 'a'.repeat(201) } })).statusCode).toBe(400)
    await app.close()
  })
})

describe('the club’s wording, in its own table', () => {
  const putVoice = (app: FastifyInstance, token: string, payload: unknown) =>
    app.inject({ method: 'PUT', url: '/api/voice', headers: bearer(token), payload: payload as object })

  it('keeps one row per text of that club, replaced as a whole, and ignores an older app’s court and player wording', async () => {
    const app = await appWith(audioReply())
    const a = await createClub(app)
    const b = await createClub(app)
    const texts = {
      testVoice: 'Hello from {court}',
      courtCall: '{bluePlayer1} and {bluePlayer2}, to {court}!',
      courts: { 'Center Court': { courtCall: 'x' } },
      players: { Ann: { playerWaiting: 'y' } },
    }
    const put = await putVoice(app, a.token, { voice: 'elevenlabs', texts })
    expect(put.statusCode).toBe(200)
    expect(put.json().texts).toEqual({ testVoice: 'Hello from {court}', courtCall: '{bluePlayer1} and {bluePlayer2}, to {court}!' })
    const rows = await db.query<{ club_slug: string; scope: string; target: string; key: string }>(
      'select club_slug, scope, target, key from club_callout_texts order by key',
    )
    expect(rows.rows).toEqual([
      { club_slug: a.slug, scope: 'club', target: '', key: 'courtCall' },
      { club_slug: a.slug, scope: 'club', target: '', key: 'testVoice' },
    ])
    expect((await app.inject({ method: 'GET', url: '/api/voice', headers: bearer(b.token) })).json().texts).toEqual({})

    await putVoice(app, a.token, { voice: 'elevenlabs', texts: { nextUp: 'Up: {players}' } })
    expect((await db.query('select key from club_callout_texts')).rows).toEqual([{ key: 'nextUp' }])
    await app.close()
  })
})
