import type { CardLogoChoice, CardLogoIndex } from '@q2dink/shared'
import { luminance, type CardColors } from '@/lib/cardPalette'

/** A logo as the choosing rules need it: which one, and how light it is (0 black to 1 white). */
export interface ToneLogo {
  id: string
  tone: number
}

const linear = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/**
 * How light a logo looks: the relative luminance of its pixels (RGBA, as a canvas gives them), each counted by how
 * opaque it is, so a white logo on a transparent background is 1 and a black one 0. A fully transparent image is 0.5.
 */
export function logoTone(pixels: ArrayLike<number>): number {
  let sum = 0
  let weight = 0
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    if (alpha === 0) continue
    sum += alpha * (0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]))
    weight += alpha
  }
  return weight === 0 ? 0.5 : Math.min(1, Math.max(0, sum / weight))
}

/** How light the card is behind the logo (on the right, about halfway along its diagonal gradient). */
export const backgroundTone = (colors: Pick<CardColors, 'from' | 'to'>) => (luminance(colors.from) + luminance(colors.to)) / 2

/** The WCAG contrast ratio between two luminances, 1 (none) to 21. */
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** The logo that stands out best on the card's colour; the first uploaded wins a tie. Undefined with none. */
export function autoLogo<T extends ToneLogo>(logos: T[], colors: Pick<CardColors, 'from' | 'to'>): T | undefined {
  const bg = backgroundTone(colors)
  let best: T | undefined
  for (const logo of logos) {
    if (!best || contrast(logo.tone, bg) > contrast(best.tone, bg)) best = logo
  }
  return best
}

/** The logo a card shows: the automatic one, the one staff picked (automatic again if it is gone), or none. */
export function logoForCard<T extends ToneLogo>(
  logos: T[],
  choice: CardLogoChoice,
  colors: Pick<CardColors, 'from' | 'to'>,
): T | undefined {
  if (choice === 'none') return undefined
  if (choice !== 'auto') {
    const picked = logos.find((logo) => logo.id === choice.id)
    if (picked) return picked
  }
  return autoLogo(logos, colors)
}

/** A choice read from storage, or automatic when it is not one. */
export function readChoice(value: unknown): CardLogoChoice {
  if (value === 'auto' || value === 'none') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return { id: value.id }
  return 'auto'
}

export const sameChoice = (a: CardLogoChoice, b: CardLogoChoice) =>
  typeof a === 'string' || typeof b === 'string' ? a === b : a.id === b.id

/** A logo kept on this device, as the sync compares it with the club's list. */
export interface LocalLogo {
  id: string
  v?: number
  dirty?: 'put' | 'delete'
}

/**
 * What to do after reading the club's list: fetch the logos the club has that this device lacks or has an older
 * version of, and drop the ones the club no longer has. A change made here and not sent yet always wins.
 */
export function mergeCardLogos(local: LocalLogo[], index: CardLogoIndex): { fetch: string[]; drop: string[] } {
  const mine = new Map(local.map((logo) => [logo.id, logo]))
  const theirs = new Set(index.logos.map((logo) => logo.id))
  const fetch = index.logos
    .filter((logo) => {
      const here = mine.get(logo.id)
      return !here || (!here.dirty && here.v !== logo.v)
    })
    .map((logo) => logo.id)
  const drop = local.filter((logo) => !logo.dirty && !theirs.has(logo.id)).map((logo) => logo.id)
  return { fetch, drop }
}
