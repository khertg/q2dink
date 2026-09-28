import { describe, expect, it } from 'vitest'
import { cardColors } from '@/lib/cardPalette'
import { autoLogo, backgroundTone, logoForCard, logoTone, mergeCardLogos, readChoice, sameChoice } from './cardLogos'

const px = (...rgba: number[][]) => rgba.flat()
const white = { id: 'white', tone: 1 }
const black = { id: 'black', tone: 0 }
const green = { id: 'green', tone: 0.3 }

describe('logoTone', () => {
  it('is how light the visible pixels are, ignoring transparent ones', () => {
    expect(logoTone(px([255, 255, 255, 255], [0, 0, 0, 0]))).toBe(1)
    expect(logoTone(px([0, 0, 0, 255], [255, 255, 255, 0]))).toBe(0)
    // Half white and half black by opacity-weighted area.
    expect(logoTone(px([255, 255, 255, 255], [0, 0, 0, 255]))).toBeCloseTo(0.5)
    expect(logoTone(px([255, 255, 255, 0]))).toBe(0.5)
  })
})

describe('the automatic logo', () => {
  it('is the white one on the dark preset cards and the dark one on a light custom colour', () => {
    const dark = cardColors({ preset: 'court' })
    expect(backgroundTone(dark)).toBeLessThan(0.3)
    expect(autoLogo([black, white, green], dark)).toBe(white)
    const light = cardColors({ custom: '#fde68a' })
    expect(autoLogo([white, black, green], light)).toBe(black)
    expect(autoLogo([], dark)).toBeUndefined()
  })

  it('goes to the first uploaded on a tie', () => {
    expect(autoLogo([{ id: 'a', tone: 1 }, { id: 'b', tone: 1 }], cardColors({ preset: 'court' }))?.id).toBe('a')
  })
})

describe('logoForCard', () => {
  const colors = cardColors({ preset: 'court' })
  it('uses the picked one on every colour, the automatic one when it is gone, and nothing for none', () => {
    expect(logoForCard([white, black], 'auto', colors)).toBe(white)
    expect(logoForCard([white, black], { id: 'black' }, colors)).toBe(black)
    expect(logoForCard([white, black], { id: 'gone' }, colors)).toBe(white)
    expect(logoForCard([white, black], 'none', colors)).toBeUndefined()
  })
})

describe('choices', () => {
  it('reads what storage holds, automatic otherwise', () => {
    expect(readChoice('none')).toBe('none')
    expect(readChoice({ id: 'x' })).toEqual({ id: 'x' })
    expect(readChoice(undefined)).toBe('auto')
    expect(readChoice({ id: 3 })).toBe('auto')
    expect(sameChoice({ id: 'x' }, { id: 'x' })).toBe(true)
    expect(sameChoice('auto', { id: 'x' })).toBe(false)
  })
})

describe('mergeCardLogos', () => {
  it('fetches new and changed logos, drops ones the club removed, and never touches unsent changes here', () => {
    const local = [
      { id: 'same', v: 1 },
      { id: 'old', v: 1 },
      { id: 'gone', v: 1 },
      { id: 'new-here', dirty: 'put' as const },
      { id: 'removed-here', v: 1, dirty: 'delete' as const },
      { id: 'changed-here', v: 1, dirty: 'put' as const },
    ]
    const index = {
      logos: [
        { id: 'same', v: 1, tone: 1 },
        { id: 'old', v: 2, tone: 1 },
        { id: 'theirs', v: 5, tone: 0 },
        { id: 'removed-here', v: 1, tone: 1 },
        { id: 'changed-here', v: 3, tone: 1 },
      ],
      choice: 'auto' as const,
    }
    expect(mergeCardLogos(local, index)).toEqual({ fetch: ['old', 'theirs'], drop: ['gone'] })
  })
})
