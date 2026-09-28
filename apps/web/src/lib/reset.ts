/**
 * "Reset this device": remove everything the app keeps on this device, as if it were just installed, and
 * log out. What the club keeps on its server is untouched and comes back after logging in again.
 *
 * Kept on purpose: the device's own id and name (`q2dink-device`), because it is still the same device and
 * its name stays registered with the club; and display preferences (theme, card colours, the install tip).
 */

/** The app's data in localStorage: the running session and the club login. */
export const LOCAL_STORAGE_KEYS_TO_CLEAR = ['q2dink-session', 'q2dink-club', 'q2dink-skill-scale'] as const

/** What this device has that the club has not been sent yet, and would be lost by a reset. */
export interface UnsentCounts {
  sessionChanges: number
  sessionEnd: boolean
  activity: number
  pastSessions: number
  savedPlayers: number
  renames: number
  leaderboard: number
  avatars: number
  photoSharing: boolean
  /** The club's skill levels were changed here and not sent yet. */
  skillLevels: boolean
  /** Card logos added or removed here, plus one when the logo choice changed here. */
  cardLogos: number
}

export const NOTHING_UNSENT: UnsentCounts = {
  sessionChanges: 0,
  sessionEnd: false,
  activity: 0,
  pastSessions: 0,
  savedPlayers: 0,
  renames: 0,
  leaderboard: 0,
  avatars: 0,
  photoSharing: false,
  skillLevels: false,
  cardLogos: 0,
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** What would be lost, one line each, in plain words. Empty when the club has everything. */
export function unsentChanges(c: UnsentCounts): string[] {
  return [
    c.sessionChanges > 0 && count(c.sessionChanges, 'change to the running session', 'changes to the running session'),
    c.sessionEnd && 'The end of a session (the club still shows it as running)',
    c.pastSessions > 0 && count(c.pastSessions, 'ended session', 'ended sessions'),
    c.savedPlayers > 0 && count(c.savedPlayers, 'saved player', 'saved players'),
    c.renames > 0 && count(c.renames, 'player rename', 'player renames'),
    c.leaderboard > 0 && count(c.leaderboard, 'result for the leaderboard', 'results for the leaderboard'),
    c.avatars > 0 && count(c.avatars, 'avatar', 'avatars'),
    c.photoSharing && 'The player photos switch',
    c.skillLevels && 'The club’s skill levels',
    c.cardLogos > 0 && count(c.cardLogos, 'change to the card logos', 'changes to the card logos'),
    c.activity > 0 && count(c.activity, 'activity log entry', 'activity log entries'),
  ].filter((line): line is string => typeof line === 'string')
}

export interface ResetDeps {
  storage: Pick<Storage, 'removeItem'>
  /** Delete the app's IndexedDB database. */
  deleteDatabase: () => Promise<void>
  /** End the club login on the server, when there is one. Best effort. */
  logout?: () => Promise<void>
}

/**
 * Remove this device's data. The login is ended on the server first (a failure there, or no connection,
 * does not stop the reset). The caller reloads the page afterwards, so every part of the app starts empty.
 */
export async function resetDevice({ storage, deleteDatabase, logout }: ResetDeps): Promise<void> {
  try {
    await logout?.()
  } catch {
    // The login also expires by itself; the device is reset either way.
  }
  await deleteDatabase()
  for (const key of LOCAL_STORAGE_KEYS_TO_CLEAR) {
    try {
      storage.removeItem(key)
    } catch {
      // Storage that cannot be written has nothing of ours in it either.
    }
  }
}
