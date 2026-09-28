import { describe, expect, it } from 'vitest'
import { cornerRadius, LOGO_SHAPES, shapeFrame } from './logoShape'

describe('logo shapes', () => {
  it('offers the whole picture first, then the shapes to cut it to', () => {
    expect(LOGO_SHAPES.map((s) => s.label)).toEqual(['Original', 'Circle', 'Square', 'Rounded', 'Wide'])
  })

  it('crops Wide under a 2:1 frame and the others under a square', () => {
    expect(shapeFrame('wide')).toEqual({ width: 288, height: 144 })
    for (const shape of ['circle', 'square', 'rounded'] as const) expect(shapeFrame(shape)).toBe(240)
  })

  it('rounds only the rounded shape, by a fifth of its short side', () => {
    expect(cornerRadius('rounded', 200, 100)).toBe(20)
    expect(cornerRadius('square', 200, 200)).toBe(0)
    expect(cornerRadius('wide', 200, 100)).toBe(0)
  })
})
