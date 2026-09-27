import type { ClubSessionSummary, DeviceSummary } from '@q2dink/shared'
import { sessionStatus } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'

/** What the "paused by another device" dialog says. */
export interface PausedNotice {
  /** The name of the device that paused it. */
  name: string
  /** It was paused because that device left the session. */
  left: boolean
  /** When it was paused (ms since the epoch): also what tells one pause from the next. */
  at: number
}

/**
 * Whether to tell staff here that another staff device paused the session, and what. Null while it runs, when
 * this device paused it, when an older app paused it (no device recorded), or once this pause was dismissed here.
 */
export function pausedNoticeFor(
  session: SessionState,
  myDeviceId: string,
  dismissedAt: number | null,
): PausedNotice | null {
  const by = session.pausedBy
  const at = session.clockStoppedAt
  if (sessionStatus(session) !== 'paused' || !by || at === undefined) return null
  if (by.deviceId === myDeviceId || dismissedAt === at) return null
  return { name: by.name, left: by.reason === 'left', at }
}

/**
 * What to tell staff here when the club's copy brought a start or resume made on another device, or null.
 * (A pause gets the dialog instead, see pausedNoticeFor.)
 */
export function statusChangeMessage(before: SessionState, after: SessionState, myDeviceId: string): string | null {
  const was = sessionStatus(before)
  const now = sessionStatus(after)
  if (was === now || now !== 'running') return null
  const by = was === 'notStarted' ? after.startedBy : after.resumedBy
  if (!by || by.deviceId === myDeviceId) return null
  return was === 'notStarted' ? `Session started by ${by.name}` : `Resumed by ${by.name}`
}

/** The other staff devices that have this session open right now, by the club's last word on it. */
export function otherDevicesOpen(summary: ClubSessionSummary | undefined, myDeviceId: string): DeviceSummary[] {
  return (summary?.openOn ?? []).filter((device) => device.deviceId !== myDeviceId)
}
