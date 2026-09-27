import { describe, expect, it } from 'vitest'
import { canonicalLiveBoardPath, viewerUrl } from './url'

describe('viewerUrl', () => {
  it('ends with /live', () => {
    expect(viewerUrl('downtown', undefined, 'https://q2dink.example')).toBe('https://q2dink.example/club/downtown/live')
  })

  it('points at one session’s own board when given one', () => {
    const id = '3f2a9c1e-0b4d-4e8f-9a7b-1c2d3e4f5a6b'
    expect(viewerUrl('downtown', id, 'https://q2dink.example')).toBe(`https://q2dink.example/club/downtown/live/${id}`)
  })
})

describe('canonicalLiveBoardPath', () => {
  it('moves the older address and a trailing slash to /club/<name>/live', () => {
    expect(canonicalLiveBoardPath('/club/downtown')).toBe('/club/downtown/live')
    expect(canonicalLiveBoardPath('/club/downtown/')).toBe('/club/downtown/live')
    expect(canonicalLiveBoardPath('/club/downtown/live/')).toBe('/club/downtown/live')
  })

  it('keeps a session’s own board, only tidying its trailing slash', () => {
    const id = '3f2a9c1e-0b4d-4e8f-9a7b-1c2d3e4f5a6b'
    expect(canonicalLiveBoardPath(`/club/downtown/live/${id}`)).toBeNull()
    expect(canonicalLiveBoardPath(`/club/downtown/live/${id}/`)).toBe(`/club/downtown/live/${id}`)
  })

  it('leaves the canonical address and every other path alone', () => {
    for (const path of ['/club/downtown/live', '/', '/club', '/club/UP', '/club/a/b']) {
      expect(canonicalLiveBoardPath(path), path).toBeNull()
    }
  })
})
