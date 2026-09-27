import { describe, expect, it } from 'vitest'
import type { Court } from '@/rotation/types'
import { courtMenuState } from './courtMenu'

const open: Court = { id: 1, name: 'Court 1', teams: null }
const playing: Court = { ...open, teams: [[1, 2], [3, 4]] }
const staged: Court = { ...playing, notStarted: true }

describe('courtMenuState', () => {
  it('offers Cancel game on a game in progress, Clear court on a line-up being set up, nothing on an open court', () => {
    expect(courtMenuState(playing, 0, 2).cancelLabel).toBe('Cancel game')
    expect(courtMenuState(staged, 0, 2).cancelLabel).toBe('Clear court')
    expect(courtMenuState(open, 0, 2).cancelLabel).toBeUndefined()
  })

  it('moves up except the first court, and down except the last', () => {
    expect(courtMenuState(open, 0, 3)).toMatchObject({ canMoveUp: false, canMoveDown: true })
    expect(courtMenuState(open, 1, 3)).toMatchObject({ canMoveUp: true, canMoveDown: true })
    expect(courtMenuState(open, 2, 3)).toMatchObject({ canMoveUp: true, canMoveDown: false })
  })

  it('asks before closing only a game in progress, and never closes the only court', () => {
    expect(courtMenuState(playing, 0, 2).closeNeedsConfirm).toBe(true)
    expect(courtMenuState(staged, 0, 2).closeNeedsConfirm).toBe(false)
    expect(courtMenuState(open, 0, 2).closeNeedsConfirm).toBe(false)
    expect(courtMenuState(open, 0, 2).closeBlocked).toBeUndefined()
    expect(courtMenuState(open, 0, 1)).toMatchObject({
      canMoveUp: false,
      canMoveDown: false,
      closeBlocked: 'A session needs at least one court',
    })
  })
})
