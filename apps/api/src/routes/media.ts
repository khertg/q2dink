import type {
  CardLogo,
  CardLogoIndex,
  ChooseCardLogoRequest,
  PhotoSharingRequest,
  PutCardLogoRequest,
  PutAvatarRequest,
  StaffAvatar,
  StaffAvatarIndex,
} from '@q2dink/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { RouteDeps } from '../app'
import { AppError } from '../errors'
import {
  checkKey,
  deleteAvatar,
  getAvatarIndex,
  getAvatarPhoto,
  getStaffAvatar,
  putAvatar,
  setPhotoSharing,
  type StoredImage,
} from '../services/media'
import { chooseCardLogo, deleteCardLogo, getCardLogo, getCardLogoIndex, putCardLogo } from '../services/cardLogos'
import { authenticate, publicSlug, slugParams } from './auth'

const avatarBody = {
  type: 'object',
  required: ['kind'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['photo', 'emoji', 'initials'] },
    emoji: { type: 'string', maxLength: 32 },
    color: { type: 'string', maxLength: 7 },
    photo: {
      type: 'object',
      required: ['data'],
      additionalProperties: false,
      properties: { data: { type: 'string', maxLength: 80 * 1024 } },
    },
  },
} as const

const photoSharingBody = {
  type: 'object',
  required: ['on'],
  additionalProperties: false,
  properties: { on: { type: 'boolean' } },
} as const

const cardLogoBody = {
  type: 'object',
  required: ['data', 'tone'],
  additionalProperties: false,
  properties: {
    // 64 KB of image as base64, with room to spare.
    data: { type: 'string', maxLength: 90 * 1024 },
    tone: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const

const cardLogoChoiceBody = {
  type: 'object',
  required: ['choice'],
  additionalProperties: false,
  properties: {
    choice: {
      oneOf: [
        { type: 'string', enum: ['auto', 'none'] },
        {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string', maxLength: 64 } },
        },
      ],
    },
  },
} as const

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', maxLength: 64 } },
} as const

const keyParams = {
  type: 'object',
  required: ['key'],
  properties: { key: { type: 'string', maxLength: 200 } },
} as const

const publicKeyParams = {
  type: 'object',
  required: ['slug', 'key'],
  properties: { slug: { type: 'string', maxLength: 64 }, key: { type: 'string', maxLength: 200 } },
} as const

/** Send a stored image: its own validated type, cached hard when the URL carries its version. */
function sendImage(request: FastifyRequest, reply: FastifyReply, image: StoredImage) {
  const etag = `W/"${image.version}"`
  const versioned = typeof (request.query as { v?: string }).v === 'string'
  reply
    .header('etag', etag)
    .header('content-type', image.type)
    .header('x-content-type-options', 'nosniff')
    .header('cache-control', versioned ? 'public, max-age=31536000, immutable' : 'no-cache')
  if (request.headers['if-none-match'] === etag) return reply.code(304).send()
  return reply.send(image.bytes)
}

/** Player avatars. Staff change them; anyone with the live link can look. */
export function registerMediaRoutes(api: FastifyInstance, { db, config }: RouteDeps): void {
  const write = {
    rateLimit: { max: config.rateLimit.write.max, timeWindow: config.rateLimit.write.windowMs },
  }

  // Clubs no longer have logos. An older cached app may still send one it kept: accept it and keep
  // nothing, so it stops retrying.
  api.put('/logo', { config: write }, async (request, reply) => {
    await authenticate(db, request)
    return reply.code(204).send()
  })

  api.delete('/logo', { config: write }, async (request, reply) => {
    await authenticate(db, request)
    return reply.code(204).send()
  })

  // The club's logo in several colours, for its Standings and Stats share images (staff only).
  api.get('/card-logos', async (request): Promise<CardLogoIndex> => {
    const { slug } = await authenticate(db, request)
    return getCardLogoIndex(db, slug)
  })

  api.get<{ Params: { id: string } }>('/card-logos/:id', { schema: { params: idParams } }, async (request): Promise<CardLogo> => {
    const { slug } = await authenticate(db, request)
    const logo = await getCardLogo(db, slug, request.params.id)
    if (!logo) throw new AppError('not_found')
    return logo
  })

  api.put<{ Params: { id: string }; Body: PutCardLogoRequest }>(
    '/card-logos/:id',
    { config: write, schema: { params: idParams, body: cardLogoBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await putCardLogo(db, slug, request.params.id, request.body)
      return reply.code(204).send()
    },
  )

  api.delete<{ Params: { id: string } }>(
    '/card-logos/:id',
    { config: write, schema: { params: idParams } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await deleteCardLogo(db, slug, request.params.id)
      return reply.code(204).send()
    },
  )

  api.put<{ Body: ChooseCardLogoRequest }>(
    '/card-logo',
    { config: write, schema: { body: cardLogoChoiceBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await chooseCardLogo(db, slug, request.body.choice)
      return reply.code(204).send()
    },
  )

  api.put<{ Params: { key: string }; Body: PutAvatarRequest }>(
    '/avatars/:key',
    { config: write, schema: { params: keyParams, body: avatarBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await putAvatar(db, slug, request.params.key, request.body)
      return reply.code(204).send()
    },
  )

  api.delete<{ Params: { key: string } }>(
    '/avatars/:key',
    { config: write, schema: { params: keyParams } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await deleteAvatar(db, slug, request.params.key)
      return reply.code(204).send()
    },
  )

  // Whether the public live page shows player photos. Staff devices get them either way.
  api.put<{ Body: PhotoSharingRequest }>(
    '/photo-sharing',
    { config: write, schema: { body: photoSharingBody } },
    async (request, reply) => {
      const { slug } = await authenticate(db, request)
      await setPhotoSharing(db, slug, request.body.on)
      return reply.code(204).send()
    },
  )

  // What older app versions send when their photo switch is turned off. Photos now also serve the
  // club's staff devices, so this only stops showing them on the live page; nothing is deleted.
  api.delete('/avatars', { config: write }, async (request, reply) => {
    const { slug } = await authenticate(db, request)
    await setPhotoSharing(db, slug, false)
    return reply.code(204).send()
  })

  // Staff devices: every avatar as it is, photos included, so each device can keep its own copy.
  api.get('/avatars', async (request): Promise<StaffAvatarIndex> => {
    const { slug } = await authenticate(db, request)
    const { avatars, logo, name, sharePhotos } = await getAvatarIndex(db, slug, { staff: true })
    return { avatars, logo, name, sharePhotos }
  })

  api.get<{ Params: { key: string } }>(
    '/avatars/:key',
    { schema: { params: keyParams } },
    async (request): Promise<StaffAvatar> => {
      const { slug } = await authenticate(db, request)
      const avatar = await getStaffAvatar(db, slug, request.params.key)
      if (!avatar) throw new AppError('not_found')
      return avatar
    },
  )

  api.get<{ Params: { slug: string } }>(
    '/clubs/:slug/avatars',
    { schema: { params: slugParams } },
    async (request, reply) => {
      const { avatars, logo, name, etag } = await getAvatarIndex(db, publicSlug(request.params.slug))
      reply.header('etag', etag).header('cache-control', 'no-cache')
      if (request.headers['if-none-match'] === etag) return reply.code(304).send()
      return { avatars, logo, name }
    },
  )

  api.get<{ Params: { slug: string; key: string } }>(
    '/clubs/:slug/avatars/:key/photo',
    { schema: { params: publicKeyParams } },
    async (request, reply) => {
      const slug = publicSlug(request.params.slug)
      let key: string
      try {
        key = checkKey(request.params.key)
      } catch {
        throw new AppError('not_found')
      }
      const photo = await getAvatarPhoto(db, slug, key)
      if (!photo) throw new AppError('not_found')
      return sendImage(request, reply, photo)
    },
  )
}
