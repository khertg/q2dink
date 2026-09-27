import { describe, expect, it } from 'vitest'
import { clubSlugFromPath, isSessionId, isValidSlug, liveBoardPath, liveSessionIdFromPath, slugify } from './slug'

describe('slugify', () => {
  it('makes a lowercase dashed URL name', () => {
    expect(slugify('Downtown Pickle Club!')).toBe('downtown-pickle-club')
    expect(slugify('  Sunset   Courts  ')).toBe('sunset-courts')
  })

  it('strips accents', () => {
    expect(slugify('Café Été')).toBe('cafe-ete')
  })

  it('pads names that are too short and handles empty results', () => {
    expect(slugify('Ab')).toBe('ab-club')
    expect(slugify('!!!')).toBe('club')
  })

  it('truncates long names without leaving a trailing dash', () => {
    const slug = slugify('a'.repeat(38) + ' bcd efg')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
    expect(isValidSlug(slug)).toBe(true)
  })

  it('always produces a valid slug', () => {
    for (const name of ['Club 42', 'A', '日本', 'x-y', '--a--b--', 'ÀÉÎÕÜ']) {
      expect(isValidSlug(slugify(name)), name).toBe(true)
    }
  })
})

describe('isValidSlug', () => {
  it('rejects bad shapes', () => {
    for (const bad of ['ab', 'Has-Caps', 'has space', '-lead', 'trail-', 'dou--ble', 'a'.repeat(41), '']) {
      expect(isValidSlug(bad), bad).toBe(false)
    }
    expect(isValidSlug('good-name-1')).toBe(true)
  })
})

describe('clubSlugFromPath', () => {
  it('reads the club from a live-board path', () => {
    expect(clubSlugFromPath('/club/downtown/live')).toBe('downtown')
    expect(clubSlugFromPath('/club/downtown/live/')).toBe('downtown')
    expect(clubSlugFromPath(liveBoardPath('downtown'))).toBe('downtown')
  })

  it('still reads the older path without /live, which printed QR codes point at', () => {
    expect(clubSlugFromPath('/club/downtown')).toBe('downtown')
    expect(clubSlugFromPath('/club/downtown/')).toBe('downtown')
  })

  it('ignores every other path and unsafe values', () => {
    for (const path of ['/', '/club', '/club/', '/clubs/downtown', '/club/a/b', '/club/UP', '/club/x', '/club/a b', '/club/a/live', '/club/UP/live', '/club/downtown/live/extra', '/club/downtown/lives']) {
      expect(clubSlugFromPath(path), path).toBeNull()
    }
  })
})

describe('a session’s own live board', () => {
  const id = '3f2a9c1e-0b4d-4e8f-9a7b-1c2d3e4f5a6b'

  it('has a path under the club’s live board', () => {
    expect(liveBoardPath('downtown', id)).toBe(`/club/downtown/live/${id}`)
    expect(liveBoardPath('downtown')).toBe('/club/downtown/live')
  })

  it('is read back with its club, and anything else is not a session', () => {
    expect(clubSlugFromPath(`/club/downtown/live/${id}`)).toBe('downtown')
    expect(liveSessionIdFromPath(`/club/downtown/live/${id}`)).toBe(id)
    expect(liveSessionIdFromPath(`/club/downtown/live/${id.toUpperCase()}/`)).toBe(id)
    expect(liveSessionIdFromPath('/club/downtown/live')).toBeNull()
    expect(liveSessionIdFromPath('/club/downtown/live/not-an-id')).toBeNull()
    expect(isSessionId(id)).toBe(true)
    expect(isSessionId('abc')).toBe(false)
  })
})
