import { describe, expect, it } from 'vitest'
import { DEFAULT_MATCHMAKING, MATCHMAKING_MODES } from './matchmaking'

describe('DEFAULT_MATCHMAKING', () => {
  it('starts a new doubles session on Winners vs. Losers, one of the offered modes', () => {
    expect(DEFAULT_MATCHMAKING).toBe('winners')
    expect(MATCHMAKING_MODES.map((m) => m.value)).toContain(DEFAULT_MATCHMAKING)
  })
})
