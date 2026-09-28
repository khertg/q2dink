import { MEDIA_LIMITS, avatarKey } from '@q2dink/shared'
import type { Crop } from './crop'

/** How a player appears. Photos are small data URLs; the rest need no image at all. */
export type PlayerAvatar =
  | { kind: 'photo'; data: string }
  | { kind: 'emoji'; value: string; color: string }
  | { kind: 'initials'; color: string }

export { avatarKey }

/** Badge colours: dark enough that white letters and emoji read well on them. */
export const AVATAR_COLORS = [
  '#0f766e',
  '#15803d',
  '#4d7c0f',
  '#a16207',
  '#c2410c',
  '#b91c1c',
  '#be185d',
  '#7e22ce',
  '#4338ca',
  '#1d4ed8',
  '#0369a1',
  '#475569',
] as const

export const AVATAR_EMOJIS = [
  '🎾', '🏓', '🏆', '🥇', '⭐', '🔥', '⚡', '💪',
  '😀', '😎', '🤩', '🥳', '😄', '🙂', '🤓', '🧐',
  '🐶', '🐱', '🦊', '🐼', '🐯', '🦁', '🐸', '🐧',
  '🦄', '🐢', '🦅', '🐬', '🦈', '🐝', '🦋', '🐙',
  '🌵', '🌴', '🍀', '🌻', '🌈', '☀️', '🌙', '❄️',
  '🍕', '🍔', '🍉', '🍩', '☕', '🍺', '⚽', '🏀',
] as const

/** Which colour a name gets when nothing is chosen: the same name always gets the same one. */
export function colorFor(name: string): string {
  let hash = 0
  for (const ch of avatarKey(name)) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

/** Up to two capital letters: the first letters of the first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = [...words[0]][0]
  const last = words.length > 1 ? [...words[words.length - 1]][0] : ''
  return (first + last).toUpperCase()
}

// ---- turning a picked image into a small one ---------------------------------

export const MAX_SOURCE_BYTES = 12 * 1024 * 1024

/** The largest centred square of an image, for an avatar. */
export function squareCrop(width: number, height: number): Crop {
  const size = Math.min(width, height)
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), sw: size, sh: size }
}

/** The decoded size of a data URL's base64 part, in bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
}

/** The base64 text of a data URL, as the API takes it. */
export const dataUrlBase64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1)

export class ImageError extends Error {}

export async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // fall through to an <img>, which decodes a few formats createImageBitmap does not
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new ImageError('That file could not be read as a picture. Try a JPEG, PNG or WebP photo.')
  }
}

export const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new ImageError('That picture could not be read.'))
    reader.readAsDataURL(blob)
  })

/** Encode a canvas as WebP, or as JPEG or PNG on browsers that cannot write WebP. */
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q))
  const webp = await blob('image/webp', quality)
  if (webp && webp.type === 'image/webp') return webp
  const fallback = await blob('image/jpeg', quality)
  if (!fallback) throw new ImageError('That picture could not be shrunk. Try a different one.')
  return fallback
}

/** A picked picture, decoded once so it can be shown and cropped. Call `release` when done with it. */
export interface Picture {
  file: Blob
  /** Where to show it (a temporary blob URL). */
  url: string
  width: number
  height: number
  release: () => void
}

export function checkFile(file: Blob) {
  if (!file.type.startsWith('image/')) throw new ImageError('That file is not a picture.')
  if (file.size > MAX_SOURCE_BYTES) throw new ImageError('That picture is too large. Pick one under 12 MB.')
}

/** Read a picked file far enough to show it and know its size, ready for the crop step. */
export async function loadPicture(file: Blob): Promise<Picture> {
  checkFile(file)
  const image = await decode(file)
  const { width, height } = image
  image.close()
  const url = URL.createObjectURL(file)
  return { file, url, width, height, release: () => URL.revokeObjectURL(url) }
}

/**
 * Make an avatar from a picked photo: a 128px square. `crop` is the part of the picture to use, in its
 * own pixels; without one it takes the centred square. Returns a data URL small enough to keep on the
 * device and send to the club.
 */
export async function processImage(file: Blob, crop?: Crop): Promise<string> {
  checkFile(file)

  const image = await decode(file)
  try {
    const limit = MEDIA_LIMITS.avatarPhotoBytes
    const source: Crop = crop ?? squareCrop(image.width, image.height)
    for (const max of [128, 96, 64]) {
      const out = { width: max, height: max }
      const canvas = document.createElement('canvas')
      canvas.width = out.width
      canvas.height = out.height
      const context = canvas.getContext('2d')
      if (!context) throw new ImageError('This browser cannot shrink pictures.')
      context.drawImage(image.source, source.sx, source.sy, source.sw, source.sh, 0, 0, out.width, out.height)
      const blob = await encode(canvas, 0.82)
      const dataUrl = await toDataUrl(blob)
      if (dataUrlBytes(dataUrl) <= limit) return dataUrl
    }
    throw new ImageError('That picture is still too detailed after shrinking it. Try a simpler one.')
  } finally {
    image.close()
  }
}
