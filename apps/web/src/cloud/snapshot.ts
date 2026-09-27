import {
  SNAPSHOT_VERSION,
  parseFullBackupEnvelope,
  parsePublicSnapshot,
  type PublicSnapshot,
} from '@q2dink/shared'
import { nextGroups, sessionStatus } from '@/rotation/engine'
import { hasLevelCourts } from '@/rotation/levels'
import type { LifetimeCounts } from '@/rotation/lifetime'
import type { SessionState } from '@/rotation/types'
import { migrateSession, SESSION_STORE_VERSION } from '@/store/migrate'

/**
 * Two shapes go to the cloud (their wire format is defined in @q2dink/shared):
 *  - PublicSnapshot: what the public viewer page shows. It leaves out genders
 *    and per-player results history.
 *  - FullBackup: the whole session, only retrievable with a staff token, so a
 *    second staff device can resume it.
 */

export { parsePublicSnapshot }
export type { PublicSnapshot }

export interface FullBackup {
  schemaVersion: typeof SNAPSHOT_VERSION
  /** Version of the persisted session shape, so it can be migrated on load. */
  storeVersion: number
  location: string
  session: SessionState
  /** History only: what the session had already added to the all-time totals. */
  lifetimeCounted?: LifetimeCounts
}

export function toPublicSnapshot(location: string, session: SessionState): PublicSnapshot {
  const lanes = nextGroups(session)
  const status = sessionStatus(session)
  return {
    schemaVersion: SNAPSHOT_VERSION,
    location,
    mode: session.mode,
    matchmaking: session.matchmaking,
    avgGameMinutes: session.avgGameMinutes,
    // Only what viewers show; a game's start time stays on the staff device.
    courts: session.courts.map(({ id, name, teams, levels }) => ({ id, name, teams, ...(levels ? { levels } : {}) })),
    queue: session.queue,
    // Computed here, on the staff device, so the live board shows exactly what staff see
    // (including mixed doubles and locked partners, which viewers cannot work out themselves).
    nextUp: lanes[0].group?.players ?? [],
    // One group per level range while courts are kept for levels; older viewers still read `nextUp`.
    ...(hasLevelCourts(session)
      ? { nextUpLanes: lanes.map((lane) => ({ levels: lane.levels ?? null, players: lane.group?.players ?? [] })) }
      : {}),
    // Viewers can say the session is paused (never who paused it: device names are staff only).
    ...(status === 'running' ? {} : { status }),
    onBreak: session.onBreak,
    partners: session.partners,
    stats: session.stats,
    players: Object.fromEntries(
      Object.values(session.players).map((p) => [p.id, { id: p.id, name: p.name, skill: p.skill }]),
    ),
    // The live page names the levels as staff see them (missing: the default scale).
    ...(session.skillScale ? { skillScale: session.skillScale } : {}),
  }
}

export function toFullBackup(location: string, session: SessionState): FullBackup {
  return { schemaVersion: SNAPSHOT_VERSION, storeVersion: SESSION_STORE_VERSION, location, session }
}

/** A read-only SessionState built from a public snapshot, for reusing the display components. */
export function toViewerState(snapshot: PublicSnapshot): SessionState {
  return {
    mode: snapshot.mode,
    avgGameMinutes: snapshot.avgGameMinutes,
    matchmaking: snapshot.matchmaking,
    partners: snapshot.partners,
    lastResult: {},
    stats: snapshot.stats,
    courts: snapshot.courts,
    players: snapshot.players,
    queue: snapshot.queue,
    onBreak: snapshot.onBreak,
    ...(snapshot.skillScale ? { skillScale: snapshot.skillScale } : {}),
  }
}

/** An ended session for the club's history: the session as saved, in the shape it was saved in. */
export function toHistoryBackup(
  location: string,
  session: SessionState,
  storeVersion: number,
  lifetimeCounted: LifetimeCounts,
): FullBackup {
  return { schemaVersion: SNAPSHOT_VERSION, storeVersion, location, session, lifetimeCounted }
}

/** Only well-formed counts are trusted; anything else means "nothing counted yet". */
function parseCounted(raw: unknown): LifetimeCounts {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const counted: LifetimeCounts = {}
  for (const [id, value] of Object.entries(raw)) {
    const v = value as Record<string, unknown> | null
    const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
    if (v && ok(v.games) && ok(v.wins) && ok(v.losses) && Number.isInteger(Number(id))) {
      counted[Number(id)] = { games: v.games as number, wins: v.wins as number, losses: v.losses as number }
    }
  }
  return counted
}

/** Returns the location and a session upgraded to the current shape, or null if unusable. */
export function parseFullBackup(
  raw: unknown,
): { location: string; session: SessionState; lifetimeCounted: LifetimeCounts } | null {
  const envelope = parseFullBackupEnvelope(raw)
  if (!envelope) return null
  try {
    const session = migrateSession(envelope.session as unknown as SessionState, envelope.storeVersion)
    // A session that cannot be published as a valid board is not sound enough to resume.
    if (!session || !parsePublicSnapshot(toPublicSnapshot(envelope.location, session))) return null
    return {
      location: envelope.location,
      session,
      lifetimeCounted: parseCounted((raw as { lifetimeCounted?: unknown }).lifetimeCounted),
    }
  } catch {
    return null
  }
}
