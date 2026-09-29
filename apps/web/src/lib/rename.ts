import { recordAudit } from '@/cloud/audit'
import { useClubAuth } from '@/cloud/auth'
import { queueClubRename } from '@/cloud/sync'
import { findSavedPlayer, renameRosterPlayer } from '@/db/roster'
import { cleanPlayerName, renamePlayer as renameInSession } from '@/rotation/engine'
import { useSessionStore } from '@/store/session'

/** The running session's player with that name (ignoring case), if any. */
function sessionPlayerId(name: string): number | undefined {
  const key = name.trim().toLowerCase()
  const players = useSessionStore.getState().session?.players ?? {}
  return Object.values(players).find((p) => p.name.trim().toLowerCase() === key)?.id
}

/**
 * Rename a player everywhere it matters on this device, and remember to move the club's copy:
 * the saved player (so future check-ins use the new name), the running session (queue, courts,
 * standings and the live page follow), and, when a club is connected, the leaderboard row, roster
 * row and shared avatar. Sessions that already ended keep the name as it was that day. The player
 * is found by their current name, the same way on every staff device.
 *
 * Nothing changes if the name is refused. Throws a RangeError with a readable message in that case.
 */
export async function renamePlayer(current: string, name: string): Promise<{ from: string; to: string }> {
  const to = cleanPlayerName(name)
  const { session, renamePlayer: renameNow } = useSessionStore.getState()
  const inSession = sessionPlayerId(current)
  // Check the running session first, so a refusal leaves the saved player alone too.
  if (session && inSession !== undefined) renameInSession(session, inSession, to)

  const saved = await findSavedPlayer(useClubAuth.getState().club?.slug, current)
  if (!saved && inSession === undefined) throw new Error('This player is not saved on this device')
  const renamed = saved ? await renameRosterPlayer(saved.id, to) : { from: current.trim(), to }
  const stillThere = sessionPlayerId(current)
  if (stillThere !== undefined) renameNow(stillThere, renamed.to)
  if (renamed.from !== renamed.to) await queueClubRename(renamed.from, renamed.to)
  // A rename in the running session is logged with the session's changes; this one only touched the roster.
  if (renamed.from !== renamed.to && inSession === undefined) {
    recordAudit('rosterRename', `Renamed saved player ${renamed.from} to ${renamed.to}`)
  }
  return renamed
}
