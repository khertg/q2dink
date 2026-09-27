import type { ClubSessionSummary, DeviceSummary, SessionStatus } from '@q2dink/shared'
import { isLive, playingIds, sessionStatus } from '@/rotation/engine'
import type { SessionSlice } from '@/store/slices'

/** One session the setup screen offers to open: left on this device, running on the club, or both. */
export interface RunningSession {
  sessionId: string
  location: string
  status: SessionStatus
  live: boolean
  /** Checked in: waiting, playing or on a break. */
  players: number
  /** Other staff devices that have it open right now. */
  openOn: DeviceSummary[]
  /** While paused: the device that paused it, if known. */
  pausedBy?: DeviceSummary
  /** Left on this device (with its unsent changes, if any). */
  onThisDevice: boolean
  /** Changes made here that the club has not taken yet. */
  unsent: number
}

function fromSlice(slice: SessionSlice): RunningSession {
  const { session } = slice
  const status = sessionStatus(session)
  return {
    sessionId: slice.sessionId,
    location: slice.location,
    status,
    live: isLive(session),
    players: session.queue.length + session.onBreak.length + playingIds(session).length,
    openOn: [],
    ...(status === 'paused' && session.pausedBy
      ? { pausedBy: { deviceId: session.pausedBy.deviceId, name: session.pausedBy.name } }
      : {}),
    onThisDevice: true,
    unsent: slice.pending.length + (slice.locationPending ? 1 : 0),
  }
}

/**
 * The sessions to offer on the setup screen: the ones left on this device and the ones the club is running,
 * each once. A session left here with changes not sent yet is shown as it is here; otherwise as the club last
 * had it (other devices may have moved it on). The one open here, and ones that ended here but whose end has not
 * reached the club yet, are left out. The club's order (latest first) comes first, then any only known here.
 */
export function runningSessions(
  parked: Record<string, SessionSlice>,
  club: ClubSessionSummary[],
  { openId, endedIds, myDeviceId }: { openId: string; endedIds: readonly string[]; myDeviceId: string },
): RunningSession[] {
  const skip = new Set([openId, ...endedIds])
  const seen = new Set<string>()
  const list: RunningSession[] = []
  for (const summary of club) {
    if (skip.has(summary.sessionId)) continue
    seen.add(summary.sessionId)
    const local = parked[summary.sessionId]
    const openOn = summary.openOn.filter((d) => d.deviceId !== myDeviceId)
    if (local && (local.pending.length > 0 || local.locationPending)) {
      list.push({ ...fromSlice(local), openOn })
    } else {
      list.push({
        sessionId: summary.sessionId,
        location: summary.location,
        status: summary.status,
        live: summary.live,
        players: summary.players,
        openOn,
        ...(summary.pausedBy ? { pausedBy: summary.pausedBy } : {}),
        onThisDevice: local !== undefined,
        unsent: 0,
      })
    }
  }
  for (const slice of Object.values(parked)) {
    if (!seen.has(slice.sessionId) && !skip.has(slice.sessionId)) list.push(fromSlice(slice))
  }
  return list
}
