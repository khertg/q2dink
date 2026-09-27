import { MIN_COURTS } from '@/rotation/engine'
import type { Court } from '@/rotation/types'

export interface CourtMenuState {
  /** The first item while the court has players: cancel its game, or clear a line-up being set up. */
  cancelLabel?: 'Cancel game' | 'Clear court'
  canMoveUp: boolean
  canMoveDown: boolean
  /** Why Close court cannot be done (it is then shown disabled with this reason). */
  closeBlocked?: string
  /** Closing cancels a game in progress, so staff are asked first. */
  closeNeedsConfirm: boolean
}

/** What a court card's ⋮ menu offers, for the court at `index` of `count` courts in board order. */
export function courtMenuState(court: Court, index: number, count: number): CourtMenuState {
  const staged = !!court.notStarted
  return {
    ...(court.teams ? { cancelLabel: staged ? ('Clear court' as const) : ('Cancel game' as const) } : {}),
    canMoveUp: index > 0,
    canMoveDown: index < count - 1,
    ...(count <= MIN_COURTS ? { closeBlocked: 'A session needs at least one court' } : {}),
    // Nothing is lost closing a court being set up: its players simply go back to the queue.
    closeNeedsConfirm: !!court.teams && !staged,
  }
}
