/**
 * The maths behind cropping a picture, with no DOM in it: the picture is dragged and zoomed under a fixed frame
 * (a square for avatars; a square or a wide rectangle for club logos), and the crop is the rectangle of the picture's
 * own pixels that the frame shows.
 */

/** A rectangle of the original picture, in its own pixels. */
export interface Crop {
  sx: number
  sy: number
  sw: number
  sh: number
}

// ---- view: drag and zoom a picture under a fixed frame ----------------------------

/** The frame the picture is dragged under, in screen pixels: a side for a square, or its width and height. */
export type Frame = number | { width: number; height: number }

export const frameSize = (frame: Frame) => (typeof frame === 'number' ? { width: frame, height: frame } : frame)

/** How the picture sits under the frame. `zoom` is 1 when it just covers the frame. */
export interface View {
  zoom: number
  /** Where the picture's centre is, in frame pixels from the frame's centre. */
  ox: number
  oy: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export const initialView = (): View => ({ zoom: MIN_ZOOM, ox: 0, oy: 0 })

/** Pixels on screen per picture pixel when the picture just covers the frame. */
export function coverScale(width: number, height: number, frame: Frame): number {
  const f = frameSize(frame)
  return Math.max(f.width / width, f.height / height)
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The nearest view where the picture still covers the whole frame. */
export function clampView(view: View, width: number, height: number, frame: Frame): View {
  const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM)
  const scale = coverScale(width, height, frame) * zoom
  const f = frameSize(frame)
  // How far the picture can move before the frame would show empty space.
  const slackX = Math.max(0, (width * scale - f.width) / 2)
  const slackY = Math.max(0, (height * scale - f.height) / 2)
  // Adding 0 turns a negative zero into a plain zero.
  return { zoom, ox: clamp(view.ox, -slackX, slackX) + 0, oy: clamp(view.oy, -slackY, slackY) + 0 }
}

/**
 * Change the zoom while a point under the frame (from its centre; the centre by default) stays
 * exactly where it is, as a pinch or a scroll wheel over that point would.
 */
export function zoomView(
  view: View,
  zoom: number,
  width: number,
  height: number,
  frame: Frame,
  anchor: { x: number; y: number } = { x: 0, y: 0 },
): View {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const base = coverScale(width, height, frame)
  const before = base * view.zoom
  const after = base * next
  // The picture point under the anchor, so it can be put back under it after the zoom.
  const px = (anchor.x - view.ox) / before
  const py = (anchor.y - view.oy) / before
  return clampView({ zoom: next, ox: anchor.x - px * after, oy: anchor.y - py * after }, width, height, frame)
}

/** Move the picture by a distance in frame pixels, staying inside the limits. */
export function panView(view: View, dx: number, dy: number, width: number, height: number, frame: Frame): View {
  return clampView({ ...view, ox: view.ox + dx, oy: view.oy + dy }, width, height, frame)
}

/** The part of the original picture that the frame shows (the frame's shape: a square for a square frame). */
export function cropFromView(view: View, width: number, height: number, frame: Frame): Crop {
  const v = clampView(view, width, height, frame)
  const scale = coverScale(width, height, frame) * v.zoom
  const f = frameSize(frame)
  const cx = width / 2 - v.ox / scale
  const cy = height / 2 - v.oy / scale
  // Rounding must never push the rectangle out of the picture, nor change its shape.
  const fit = Math.min(1, (width * scale) / f.width, (height * scale) / f.height)
  let sw = Math.min((f.width / scale) * fit, width)
  let sh = Math.min((f.height / scale) * fit, height)
  // A square frame always gives an exact square.
  if (f.width === f.height) sw = sh = Math.min(sw, sh)
  return {
    sx: clamp(cx - sw / 2, 0, width - sw),
    sy: clamp(cy - sh / 2, 0, height - sh),
    sw,
    sh,
  }
}
