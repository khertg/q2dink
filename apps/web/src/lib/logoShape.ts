import type { Frame } from '@/lib/crop'

/** The shapes a club logo can be cut to when it is added. `original` keeps the whole picture. */
export type LogoShape = 'original' | 'circle' | 'square' | 'rounded' | 'wide'

export const LOGO_SHAPES: { value: LogoShape; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'circle', label: 'Circle' },
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'wide', label: 'Wide' },
]

/** The frame a shape is cropped under (screen pixels): a square, or a 2:1 banner for Wide. */
export const shapeFrame = (shape: Exclude<LogoShape, 'original'>): Frame =>
  shape === 'wide' ? { width: 288, height: 144 } : 240

/** The corner radius of a shape at this size: a fifth of the short side when rounded, else none. */
export const cornerRadius = (shape: LogoShape, width: number, height: number) =>
  shape === 'rounded' ? Math.min(width, height) / 5 : 0
