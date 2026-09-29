import { DEFAULT_VOICE_ID, parseSpeechRequest, parseVoiceChoice, type VoiceOptions, type VoiceSettings } from '@q2dink/shared'
import type { FastifyInstance } from 'fastify'
import type { RouteDeps } from '../app'
import { AppError } from '../errors'
import { getVoiceSettings, setVoice } from '../services/voice'
import { authenticate } from './auth'

/** Voice call-outs (staff only): the text read out as MP3 audio, and the club's choice of voice. */
export function registerSpeechRoutes(api: FastifyInstance, { db, config, speech }: RouteDeps): void {
  const limit = {
    rateLimit: { max: config.rateLimit.speech.max, timeWindow: config.rateLimit.speech.windowMs },
  }
  const write = {
    rateLimit: { max: config.rateLimit.write.max, timeWindow: config.rateLimit.write.windowMs },
  }
  const settings = async (slug: string): Promise<VoiceSettings> => ({
    ...(await getVoiceSettings(db, slug)),
    elevenLabs: !!config.speech.apiKey,
  })

  api.post('/speech', { config: limit }, async (request, reply) => {
    const { slug } = await authenticate(db, request)
    const body = parseSpeechRequest(request.body)
    if (!body) throw new AppError('invalid_request')
    const club = await getVoiceSettings(db, slug)
    // The club chose each device's own voice: never spend its credits, even for a device that has not heard yet.
    if (club.voice === 'device') throw new AppError('speech_unavailable')
    // A voice being tried before it is chosen, else the club's, else the default.
    const voiceId = body.voiceId ?? club.voiceId ?? DEFAULT_VOICE_ID
    const audio = await speech.synthesize(body.text, voiceId, request.log)
    return reply.header('content-type', 'audio/mpeg').header('cache-control', 'no-store').send(audio)
  })

  api.get('/voice', async (request): Promise<VoiceSettings> => {
    const { slug } = await authenticate(db, request)
    return settings(slug)
  })

  api.put('/voice', { config: write }, async (request): Promise<VoiceSettings> => {
    const { slug } = await authenticate(db, request)
    const body = parseVoiceChoice(request.body)
    if (!body) throw new AppError('invalid_request')
    await setVoice(db, slug, body)
    return settings(slug)
  })

  // The ElevenLabs voices the server's key can use, for the club's choice.
  api.get('/voice/options', async (request): Promise<VoiceOptions> => {
    await authenticate(db, request)
    return speech.listVoices(request.log)
  })
}
