import { describe, expect, it, vi } from 'vitest'
import { CloudError } from './api'
import { createHttpApi } from './httpApi'

describe('speak', () => {
  it('posts the text with the staff token and returns the audio', async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg' } }))
    const audio = await createHttpApi('/api', { fetch }).speak('tok', 'Next up: Ann')
    expect(audio.size).toBe(3)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/speech')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({ text: 'Next up: Ann' })
  })

  it('turns an error reply into its CloudError, and a failed request into network', async () => {
    const unavailable = vi.fn(
      async () => new Response(JSON.stringify({ error: 'speech_unavailable', message: 'x' }), { status: 503 }),
    )
    await expect(createHttpApi('/api', { fetch: unavailable }).speak('tok', 'Hi')).rejects.toMatchObject({
      code: 'speech_unavailable',
    })
    const offline = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')))
    const error = await createHttpApi('/api', { fetch: offline }).speak('tok', 'Hi').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CloudError)
    expect((error as CloudError).code).toBe('network')
  })
})
