import { MEDIA_LIMITS } from '@q2dink/shared'
import { checkFile, dataUrlBytes, decode, ImageError, toDataUrl } from '@/lib/avatar'
import { logoTone } from '@/lib/cardLogos'
import type { Crop } from '@/lib/crop'
import { cornerRadius, type LogoShape } from '@/lib/logoShape'

/** The largest a card logo is kept: wide logos stay wide, tall ones tall. */
export const LOGO_BOX = { width: 320, height: 160 } as const

/** The size that fits `width` × `height` inside the box, keeping its shape; never larger than it was. */
export function fitWithin(width: number, height: number, box: { width: number; height: number } = LOGO_BOX) {
  const scale = Math.min(1, box.width / width, box.height / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Encode keeping transparency: WebP, or PNG on browsers that cannot write WebP. */
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q))
  const webp = await blob('image/webp', quality)
  if (webp && webp.type === 'image/webp') return webp
  const png = await blob('image/png')
  if (!png) throw new ImageError('That logo could not be shrunk. Try a different file.')
  return png
}

/** Keep only the inside of the shape: a circle (an ellipse for a non-square size) or a rounded rectangle. */
function clipToShape(context: CanvasRenderingContext2D, shape: LogoShape, width: number, height: number) {
  if (shape === 'circle') {
    context.beginPath()
    context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2)
    context.clip()
  } else if (shape === 'rounded') {
    context.beginPath()
    context.roundRect(0, 0, width, height, cornerRadius(shape, width, height))
    context.clip()
  }
}

/** The part of the picture to keep and the shape to cut it to (see LogoCropDialog). */
export interface LogoCut {
  crop: Crop
  shape: LogoShape
}

/**
 * Make a card logo from a picked file: its whole picture, or the part `cut` keeps cut to its shape (transparent
 * outside it), shrunk to fit LOGO_BOX with its transparency, small enough to send to the club, and how light it is
 * (for the automatic choice).
 */
export async function processLogo(file: Blob, cut?: LogoCut): Promise<{ dataUrl: string; tone: number }> {
  checkFile(file)
  const image = await decode(file)
  const part: Crop = cut?.crop ?? { sx: 0, sy: 0, sw: image.width, sh: image.height }
  try {
    for (const factor of [1, 0.75, 0.5, 0.35]) {
      const size = fitWithin(part.sw, part.sh, { width: LOGO_BOX.width * factor, height: LOGO_BOX.height * factor })
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) throw new ImageError('This browser cannot shrink pictures.')
      if (cut) clipToShape(context, cut.shape, size.width, size.height)
      context.drawImage(image.source, part.sx, part.sy, part.sw, part.sh, 0, 0, size.width, size.height)
      const dataUrl = await toDataUrl(await encode(canvas, 0.9))
      if (dataUrlBytes(dataUrl) <= MEDIA_LIMITS.cardLogoBytes) {
        return { dataUrl, tone: logoTone(context.getImageData(0, 0, size.width, size.height).data) }
      }
    }
    throw new ImageError('That logo is still too detailed after shrinking it. Try a simpler file.')
  } finally {
    image.close()
  }
}
