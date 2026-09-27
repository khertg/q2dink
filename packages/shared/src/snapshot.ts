import { MAX_COURT_NAME_LENGTH, MAX_LOCATION_LENGTH, MAX_PLAYER_NAME_LENGTH } from './protocol'
import { MAX_SCALE_LEVELS, parseSkillScale, type SkillScale } from './skillScale'

/**
 * Two shapes travel to the API:
 *  - PublicSnapshot: what the public viewer page shows. It leaves out genders
 *    and per-player results history.
 *  - FullBackupEnvelope: the whole session, only retrievable with a staff
 *    token, so a second staff device can resume it. The API stores it as an
 *    opaque object; only the web app understands `session`.
 */

export const SNAPSHOT_VERSION = 1

/** Generous caps that no real session reaches; they keep bad data out of storage and off viewers' screens. */
export const SNAPSHOT_LIMITS = {
  courts: 15,
  players: 500,
  queue: 500,
  /** Serialized size in bytes. */
  publicBytes: 128 * 1024,
  fullBytes: 256 * 1024,
} as const

export type WireGameMode = 'doubles' | 'singles'
export type WireMatchmaking = 'balanced' | 'skill' | 'winners' | 'mixed'
/** A level on the session's skill scale, 1 (lowest) to the number of levels it has (at most 10; 6 before scales). */
export type WireSkill = number

export interface WireCourt {
  id: number
  /** What people call the court, e.g. "Court 2" or "Center Court". */
  name: string
  teams: [number[], number[]] | null
  /** The skill levels the court is kept for (min, max). Missing means any level. */
  levels?: [WireSkill, WireSkill]
}

/** The group waiting for the courts of one level range; `levels` null for the courts open to any level. */
export interface WireNextUpLane {
  levels: [WireSkill, WireSkill] | null
  /** Team A first, then Team B; empty when no group can be formed yet. */
  players: number[]
}

export interface WireStats {
  games: number
  wins: number
  losses: number
  opponentSkill: number
  /** Points for and against, over the games that had a score entered. */
  pointsFor: number
  pointsAgainst: number
  /** Games that had a score entered. */
  scoredGames: number
  /** Total time on court, in whole seconds. */
  secondsPlayed: number
  /** Total time waiting in the queue before the games played, in whole seconds. */
  secondsWaited: number
}

export interface WirePlayer {
  id: number
  name: string
  skill: WireSkill
}

/** A session that is not simply running. */
export type WireSessionStatus = 'notStarted' | 'paused'
const STATUSES: readonly string[] = ['notStarted', 'paused']

export interface PublicSnapshot {
  schemaVersion: typeof SNAPSHOT_VERSION
  location: string
  mode: WireGameMode
  matchmaking: WireMatchmaking
  avgGameMinutes: number
  courts: WireCourt[]
  queue: number[]
  /**
   * The group staff would start next, as player ids: Team A first, then Team B (doubles has
   * two on each side, singles one). Empty when no group can be formed yet.
   */
  nextUp: number[]
  /**
   * While courts are kept for skill levels: the next group for each level range (see WireCourt.levels),
   * in board order. `nextUp` is then the first of these. Missing when no court has a range.
   */
  nextUpLanes?: WireNextUpLane[]
  /**
   * Set up but not started, or paused (no clock runs). Missing means running, and is what older staff apps
   * send. An unknown value is dropped.
   */
  status?: WireSessionStatus
  onBreak: number[]
  partners: [number, number][]
  stats: Record<number, WireStats>
  players: Record<number, WirePlayer>
  /**
   * The session's skill levels, so the live page names them as staff do. Missing (older staff apps, or an invalid
   * one, which is dropped) means the default scale.
   */
  skillScale?: SkillScale
}

export interface FullBackupEnvelope {
  schemaVersion: typeof SNAPSHOT_VERSION
  /** Version of the persisted session shape, so the web app can migrate it on load. */
  storeVersion: number
  location: string
  session: Record<string, unknown>
}

const MODES: readonly string[] = ['doubles', 'singles']
const MATCHMAKING: readonly string[] = ['balanced', 'skill', 'winners', 'mixed']

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const isIdList = (v: unknown, max: number): v is number[] =>
  Array.isArray(v) && v.length <= max && v.every(isId)
const isCount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const isLevel = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_SCALE_LEVELS
const isLevels = (v: unknown): v is [WireSkill, WireSkill] =>
  Array.isArray(v) && v.length === 2 && isLevel(v[0]) && isLevel(v[1]) && v[0] <= v[1]

function validLanes(v: unknown): v is WireNextUpLane[] {
  return (
    Array.isArray(v) &&
    v.length <= SNAPSHOT_LIMITS.courts + 1 &&
    v.every((lane) => isObject(lane) && (lane.levels === null || isLevels(lane.levels)) && isIdList(lane.players, 4))
  )
}

/**
 * Courts from before names existed have none, and are accepted: they are given the
 * name "Court <id>" when the snapshot is copied. A name that is present must be short text.
 */
function validCourts(v: unknown): v is WireCourt[] {
  return (
    Array.isArray(v) &&
    v.length <= SNAPSHOT_LIMITS.courts &&
    v.every(
      (c) =>
        isObject(c) &&
        isId(c.id) &&
        (c.name === undefined || isText(c.name, MAX_COURT_NAME_LENGTH)) &&
        (c.levels === undefined || isLevels(c.levels)) &&
        (c.teams === null ||
          (Array.isArray(c.teams) && c.teams.length === 2 && c.teams.every((t) => isIdList(t, 2)))),
    )
  )
}

function validPlayers(v: unknown): v is Record<number, WirePlayer> {
  if (!isObject(v)) return false
  const entries = Object.entries(v)
  return (
    entries.length <= SNAPSHOT_LIMITS.players &&
    entries.every(
      ([key, p]) =>
        isObject(p) &&
        isId(p.id) &&
        String(p.id) === key &&
        isText(p.name, MAX_PLAYER_NAME_LENGTH) &&
        isLevel(p.skill),
    )
  )
}

/** The stats added after the first release: optional on input, and 0 in the copy when missing. */
const OPTIONAL_STAT_FIELDS = ['pointsFor', 'pointsAgainst', 'scoredGames', 'secondsPlayed', 'secondsWaited'] as const

function validStats(v: unknown): v is Record<number, WireStats> {
  if (!isObject(v)) return false
  const entries = Object.entries(v)
  return (
    entries.length <= SNAPSHOT_LIMITS.players &&
    entries.every(
      ([key, s]) =>
        /^\d+$/.test(key) &&
        isObject(s) &&
        isCount(s.games) &&
        isCount(s.wins) &&
        isCount(s.losses) &&
        isCount(s.opponentSkill) &&
        // Boards published before scores and time played existed have none of these; that is accepted.
        OPTIONAL_STAT_FIELDS.every((field) => s[field] === undefined || isCount(s[field])),
    )
  )
}

/**
 * Returns a clean copy of the snapshot if it is well formed and of a known
 * version, otherwise null. The copy holds only the known public fields, so
 * anything extra in the input (a gender, say) is dropped and can never be stored or shown.
 */
export function parsePublicSnapshot(raw: unknown): PublicSnapshot | null {
  if (!isObject(raw) || raw.schemaVersion !== SNAPSHOT_VERSION) return null
  const ok =
    isText(raw.location, MAX_LOCATION_LENGTH) &&
    typeof raw.mode === 'string' &&
    MODES.includes(raw.mode) &&
    typeof raw.matchmaking === 'string' &&
    MATCHMAKING.includes(raw.matchmaking) &&
    typeof raw.avgGameMinutes === 'number' &&
    Number.isFinite(raw.avgGameMinutes) &&
    validCourts(raw.courts) &&
    isIdList(raw.queue, SNAPSHOT_LIMITS.queue) &&
    // Boards published before "next up" existed have none; that is accepted and read as empty.
    (raw.nextUp === undefined || isIdList(raw.nextUp, 4)) &&
    (raw.nextUpLanes === undefined || validLanes(raw.nextUpLanes)) &&
    isIdList(raw.onBreak, SNAPSHOT_LIMITS.queue) &&
    Array.isArray(raw.partners) &&
    raw.partners.length <= SNAPSHOT_LIMITS.players &&
    raw.partners.every((pair) => isIdList(pair, 2) && (pair as number[]).length === 2) &&
    validStats(raw.stats) &&
    validPlayers(raw.players)
  return ok ? copyPublicSnapshot(raw as unknown as PublicSnapshot) : null
}

function copyPublicSnapshot(s: PublicSnapshot): PublicSnapshot {
  const scale = s.skillScale === undefined ? null : parseSkillScale(s.skillScale)
  const pick = <T extends object, K extends keyof T>(source: T, keys: K[]) =>
    Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>
  return {
    schemaVersion: SNAPSHOT_VERSION,
    location: s.location,
    mode: s.mode,
    matchmaking: s.matchmaking,
    avgGameMinutes: s.avgGameMinutes,
    courts: s.courts.map((c) => ({
      id: c.id,
      name: typeof c.name === 'string' && c.name.trim() !== '' ? c.name : `Court ${c.id}`,
      teams: c.teams ? [[...c.teams[0]], [...c.teams[1]]] : null,
      ...(c.levels ? { levels: [c.levels[0], c.levels[1]] as [WireSkill, WireSkill] } : {}),
    })),
    queue: [...s.queue],
    nextUp: Array.isArray(s.nextUp) ? [...s.nextUp] : [],
    ...(s.nextUpLanes
      ? {
          nextUpLanes: s.nextUpLanes.map((lane) => ({
            levels: lane.levels ? ([lane.levels[0], lane.levels[1]] as [WireSkill, WireSkill]) : null,
            players: [...lane.players],
          })),
        }
      : {}),
    ...(typeof s.status === 'string' && STATUSES.includes(s.status) ? { status: s.status } : {}),
    onBreak: [...s.onBreak],
    partners: s.partners.map(([a, b]) => [a, b] as [number, number]),
    stats: Object.fromEntries(
      Object.entries(s.stats).map(([id, st]) => [
        id,
        {
          ...pick(st, ['games', 'wins', 'losses', 'opponentSkill']),
          pointsFor: st.pointsFor ?? 0,
          pointsAgainst: st.pointsAgainst ?? 0,
          scoredGames: st.scoredGames ?? 0,
          secondsPlayed: st.secondsPlayed ?? 0,
          secondsWaited: st.secondsWaited ?? 0,
        },
      ]),
    ),
    players: Object.fromEntries(
      Object.entries(s.players).map(([id, p]) => [id, pick(p, ['id', 'name', 'skill'])]),
    ),
    ...(scale ? { skillScale: scale } : {}),
  }
}

/** Returns the envelope if its outer shape is right. The inner session is left for the web app to check. */
export function parseFullBackupEnvelope(raw: unknown): FullBackupEnvelope | null {
  if (!isObject(raw) || raw.schemaVersion !== SNAPSHOT_VERSION) return null
  if (!isText(raw.location, MAX_LOCATION_LENGTH)) return null
  if (!Number.isInteger(raw.storeVersion) || (raw.storeVersion as number) < 1) return null
  if (!isObject(raw.session)) return null
  return raw as unknown as FullBackupEnvelope
}

/** Size of a value once serialized, in bytes. */
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
