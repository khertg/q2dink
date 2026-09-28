import { describe, expect, it } from 'vitest'
import { MAX_ZOOM, MIN_ZOOM, clampView, coverScale, cropFromView, initialView, panView, zoomView } from './crop'

const FRAME = 256

/** A small seeded generator so a failure can be reproduced. */
const random = (seed: number) => () => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296
  return seed / 4_294_967_296
}

describe('coverScale', () => {
  it('makes the shorter side just fill the frame', () => {
    expect(coverScale(400, 200, FRAME)).toBeCloseTo(1.28)
    expect(coverScale(200, 400, FRAME)).toBeCloseTo(1.28)
    expect(coverScale(512, 512, FRAME)).toBeCloseTo(0.5)
    expect(coverScale(64, 64, FRAME)).toBeCloseTo(4)
  })
})

describe('clampView', () => {
  it('keeps the picture covering the frame: no offset when it only just fills it', () => {
    // At minimum zoom a wide picture can only slide along its long side.
    const v = clampView({ zoom: 1, ox: 500, oy: 500 }, 400, 200, FRAME)
    expect(v.oy).toBe(0)
    expect(v.ox).toBeCloseTo((400 * 1.28 - FRAME) / 2)
    expect(clampView({ zoom: 1, ox: -500, oy: 0 }, 400, 200, FRAME).ox).toBeCloseTo(-(400 * 1.28 - FRAME) / 2)
    // A square picture cannot move at all until it is zoomed in.
    expect(clampView({ zoom: 1, ox: 30, oy: -30 }, 300, 300, FRAME)).toEqual({ zoom: 1, ox: 0, oy: 0 })
  })

  it('allows more room the more it is zoomed in, on both axes', () => {
    const v = clampView({ zoom: 2, ox: 1000, oy: -1000 }, 300, 300, FRAME)
    const slack = (300 * coverScale(300, 300, FRAME) * 2 - FRAME) / 2
    expect(v.ox).toBeCloseTo(slack)
    expect(v.oy).toBeCloseTo(-slack)
  })

  it('never lets the zoom leave its range', () => {
    expect(clampView({ zoom: 0.2, ox: 0, oy: 0 }, 300, 300, FRAME).zoom).toBe(MIN_ZOOM)
    expect(clampView({ zoom: 99, ox: 0, oy: 0 }, 300, 300, FRAME).zoom).toBe(MAX_ZOOM)
  })
})

describe('panView', () => {
  it('moves the picture and stops at each edge', () => {
    const start = { zoom: 2, ox: 0, oy: 0 }
    const moved = panView(start, 20, -15, 300, 300, FRAME)
    expect(moved).toEqual({ zoom: 2, ox: 20, oy: -15 })
    const far = panView(start, 9999, 9999, 300, 300, FRAME)
    const slack = (300 * coverScale(300, 300, FRAME) * 2 - FRAME) / 2
    expect(far.ox).toBeCloseTo(slack)
    expect(far.oy).toBeCloseTo(slack)
  })
})

describe('zoomView', () => {
  it('cannot go below the smallest zoom or above the largest', () => {
    expect(zoomView(initialView(), 0.1, 300, 200, FRAME).zoom).toBe(MIN_ZOOM)
    expect(zoomView(initialView(), 40, 300, 200, FRAME).zoom).toBe(MAX_ZOOM)
  })

  it('keeps the point under the anchor still, so a pinch or wheel stays under the fingers', () => {
    const width = 800
    const height = 600
    const view = { zoom: 1.5, ox: 20, oy: -10 }
    const anchor = { x: 60, y: -40 }
    const pictureAt = (v: typeof view, p: { x: number; y: number }) => {
      const scale = coverScale(width, height, FRAME) * v.zoom
      return { x: (p.x - v.ox) / scale, y: (p.y - v.oy) / scale }
    }
    const before = pictureAt(view, anchor)
    const after = pictureAt(zoomView(view, 2.5, width, height, FRAME, anchor), anchor)
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
  })

  it('zooming out again returns to the middle of a square picture', () => {
    const zoomedIn = zoomView(initialView(), 3, 300, 300, FRAME, { x: 70, y: 70 })
    expect(zoomedIn.ox).not.toBe(0)
    expect(zoomView(zoomedIn, 1, 300, 300, FRAME, { x: 70, y: 70 })).toEqual({ zoom: 1, ox: 0, oy: 0 })
  })
})

describe('cropFromView', () => {
  it('is the centred square when untouched, like the automatic crop', () => {
    expect(cropFromView(initialView(), 400, 200, FRAME)).toEqual({ sx: 100, sy: 0, sw: 200, sh: 200 })
    expect(cropFromView(initialView(), 200, 400, FRAME)).toEqual({ sx: 0, sy: 100, sw: 200, sh: 200 })
    expect(cropFromView(initialView(), 300, 300, FRAME)).toEqual({ sx: 0, sy: 0, sw: 300, sh: 300 })
  })

  it('shows the other side of the picture when the picture is dragged the other way', () => {
    const scale = coverScale(400, 200, FRAME)
    const slack = (400 * scale - FRAME) / 2
    // Dragging the picture right shows its left side, and the reverse.
    expect(cropFromView({ zoom: 1, ox: slack, oy: 0 }, 400, 200, FRAME).sx).toBeCloseTo(0)
    expect(cropFromView({ zoom: 1, ox: -slack, oy: 0 }, 400, 200, FRAME).sx).toBeCloseTo(200)
  })

  it('shows half the width at twice the zoom, still centred', () => {
    const c = cropFromView({ zoom: 2, ox: 0, oy: 0 }, 400, 400, FRAME)
    expect(c).toEqual({ sx: 100, sy: 100, sw: 200, sh: 200 })
  })

  it('reaches each corner of the picture when dragged as far as it goes', () => {
    const slack = (400 * coverScale(400, 400, FRAME) * 2 - FRAME) / 2
    const at = (ox: number, oy: number) => cropFromView({ zoom: 2, ox, oy }, 400, 400, FRAME)
    expect(at(slack, slack)).toMatchObject({ sx: 0, sy: 0 })
    expect(at(-slack, -slack)).toMatchObject({ sx: 200, sy: 200 })
    expect(at(slack, -slack)).toMatchObject({ sx: 0, sy: 200 })
    expect(at(-slack, slack)).toMatchObject({ sx: 200, sy: 0 })
  })

  it('is always a square inside the picture, whatever the picture, zoom and offset (random)', () => {
    const next = random(7)
    for (let i = 0; i < 2000; i++) {
      const width = 1 + Math.floor(next() * 4000)
      const height = 1 + Math.floor(next() * 4000)
      const view = { zoom: next() * 6, ox: (next() - 0.5) * 3000, oy: (next() - 0.5) * 3000 }
      const c = cropFromView(view, width, height, FRAME)
      expect(c.sw).toBe(c.sh)
      expect(c.sw).toBeGreaterThan(0)
      expect(c.sx).toBeGreaterThanOrEqual(0)
      expect(c.sy).toBeGreaterThanOrEqual(0)
      expect(c.sx + c.sw).toBeLessThanOrEqual(width + 1e-9)
      expect(c.sy + c.sh).toBeLessThanOrEqual(height + 1e-9)
    }
  })

  it('grows the visible part as the zoom goes down, up to the shorter side', () => {
    let previous = 0
    for (const zoom of [4, 3, 2, 1.5, 1]) {
      const size = cropFromView({ zoom, ox: 0, oy: 0 }, 800, 600, FRAME).sw
      expect(size).toBeGreaterThan(previous)
      previous = size
    }
    expect(previous).toBe(600)
  })
})

describe('a wide frame (2:1, for club logos)', () => {
  const WIDE = { width: 288, height: 144 }

  it('covers the frame and crops a 2:1 rectangle, the whole width of a square picture at first', () => {
    expect(coverScale(1000, 1000, WIDE)).toBeCloseTo(0.288)
    const c = cropFromView(initialView(), 1000, 1000, WIDE)
    expect([c.sx, c.sy, c.sw, c.sh].map((n) => Math.round(n))).toEqual([0, 250, 1000, 500])
  })

  it('moves only where the picture reaches past the frame, and zooms around a point', () => {
    // A square picture fills the frame's width exactly: no sideways slack, some up and down.
    expect(clampView({ zoom: 1, ox: 50, oy: 500 }, 1000, 1000, WIDE)).toEqual({ zoom: 1, ox: 0, oy: 72 })
    const zoomed = zoomView(initialView(), 2, 1000, 1000, WIDE)
    const c = cropFromView(zoomed, 1000, 1000, WIDE)
    expect([c.sx, c.sy, c.sw, c.sh].map((n) => Math.round(n))).toEqual([250, 375, 500, 250])
  })

  it('is always 2:1 inside the picture, whatever the picture, zoom and offset (random)', () => {
    const next = random(11)
    for (let i = 0; i < 2000; i++) {
      const width = 1 + Math.floor(next() * 4000)
      const height = 1 + Math.floor(next() * 4000)
      const view = { zoom: next() * 6, ox: (next() - 0.5) * 3000, oy: (next() - 0.5) * 3000 }
      const c = cropFromView(view, width, height, WIDE)
      expect(c.sw / c.sh).toBeCloseTo(2)
      expect(c.sx).toBeGreaterThanOrEqual(0)
      expect(c.sy).toBeGreaterThanOrEqual(0)
      expect(c.sx + c.sw).toBeLessThanOrEqual(width + 1e-9)
      expect(c.sy + c.sh).toBeLessThanOrEqual(height + 1e-9)
    }
  })
})
