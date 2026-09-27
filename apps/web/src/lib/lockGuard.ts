import type { SessionState } from '@/rotation/types'
import { applyAction, type SessionAction } from '@/store/actions'
import { brokenLocks } from '@/lib/partners'

/**
 * The locks this change would end, worked out on a copy before it is made, so staff can be asked first. An explicit
 * unlock is what staff chose, and a change that no longer applies ends nothing: both give none.
 */
export function locksBrokenBy(session: SessionState, action: SessionAction): [number, number][] {
  if (action.type === 'unlockPartners' || action.type === 'restore') return []
  try {
    return brokenLocks(session, applyAction(session, action).session)
  } catch {
    return []
  }
}
