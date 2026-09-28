import { describe, expect, it } from 'vitest'
import { fitWithin } from './logoImage'

describe('fitWithin', () => {
  it('shrinks a logo to fit the box, keeping its shape, and never enlarges a small one', () => {
    expect(fitWithin(1000, 500)).toEqual({ width: 320, height: 160 })
    expect(fitWithin(1000, 250)).toEqual({ width: 320, height: 80 })
    expect(fitWithin(300, 900)).toEqual({ width: 53, height: 160 })
    expect(fitWithin(100, 40)).toEqual({ width: 100, height: 40 })
    expect(fitWithin(4000, 1, { width: 10, height: 10 })).toEqual({ width: 10, height: 1 })
  })
})
