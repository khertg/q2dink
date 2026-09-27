import { MAX_COURT_NAME_LENGTH, MAX_PLAYER_NAME_LENGTH, levelForRating, ratingForLevel, type SkillScale } from '@q2dink/shared'
import { levelCount, ratingOf, sessionScale } from '../lib/skill'
import type { SkillLevel } from '../db/db'
import { TEAM_NAMES } from '../lib/teams'
import { partnerOf, selectGroup, splitGroup } from '../matchmaking/grouping'
import { hasLevelCourts, inLevels, laneQueue, lanesOf, normalizeLevels, sameLevels, type LevelRange } from './levels'
import type {
  Court,
  DeviceRef,
  GameMode,
  MatchmakingMode,
  MatchRecord,
  PausedBy,
  PendingPartners,
  PlayerStats,
  RosterPlayer,
  SessionState,
  Teams,
} from './types'

/**
 * Court rotation engine. Every function is pure: it returns a new state and
 * never mutates its input, so undo is just keeping the previous state.
 */

export const playersPerCourt = (mode: GameMode) => (mode === 'doubles' ? 4 : 2)

export const MIN_COURTS = 1
export const MAX_COURTS = 15
export { MAX_COURT_NAME_LENGTH }

export const DEFAULT_AVG_GAME_MINUTES = 12
export const MIN_AVG_GAME_MINUTES = 5
export const MAX_AVG_GAME_MINUTES = 60

export const isValidGameMinutes = (minutes: number) =>
  Number.isInteger(minutes) && minutes >= MIN_AVG_GAME_MINUTES && minutes <= MAX_AVG_GAME_MINUTES

/** The highest score a team can be given for one game. */
export const MAX_SCORE = 99

/**
 * The longest game whose time is recorded. A game left open overnight would otherwise credit
 * everyone on it with hours they never played.
 */
export const MAX_GAME_SECONDS = 3 * 60 * 60

/** The stats of a player who has not finished a game. */
export const EMPTY_STATS: Readonly<PlayerStats> = {
  games: 0,
  wins: 0,
  losses: 0,
  opponentSkill: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  scoredGames: 0,
  secondsPlayed: 0,
  secondsWaited: 0,
}

export interface SessionOptions {
  avgGameMinutes?: number
  /** Doubles only; singles is always first come, first served. */
  matchmaking?: MatchmakingMode
  /** The club's skill levels; missing means the default scale. */
  skillScale?: SkillScale
}

export function createSession(
  mode: GameMode,
  courtCount: number,
  { avgGameMinutes = DEFAULT_AVG_GAME_MINUTES, matchmaking = 'balanced', skillScale }: SessionOptions = {},
): SessionState {
  if (!Number.isInteger(courtCount) || courtCount < MIN_COURTS || courtCount > MAX_COURTS) {
    throw new RangeError(`courtCount must be an integer from ${MIN_COURTS} to ${MAX_COURTS}`)
  }
  if (!isValidGameMinutes(avgGameMinutes)) {
    throw new RangeError('avgGameMinutes must be an integer from 5 to 60')
  }
  return {
    mode,
    avgGameMinutes,
    matchmaking,
    partners: [],
    lastResult: {},
    stats: {},
    courts: Array.from({ length: courtCount }, (_, i) => ({
      id: i + 1,
      name: `Court ${i + 1}`,
      teams: null,
    })),
    players: {},
    queue: [],
    onBreak: [],
    ...(skillScale ? { skillScale } : {}),
  }
}

// ---- court management ------------------------------------------------------

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The lowest "Court N" not in use, so closing Court 2 and adding a court brings Court 2 back. */
export function defaultCourtName(courts: Court[]): string {
  for (let n = 1; ; n++) {
    const name = `Court ${n}`
    if (!courts.some((court) => sameName(court.name, name))) return name
  }
}

/** A name that is trimmed, 1 to 40 characters, and unique among the other courts. */
function checkCourtName(courts: Court[], name: string, exceptId?: number): string {
  const trimmed = name.trim()
  if (trimmed.length < 1) throw new RangeError('Give the court a name')
  if (trimmed.length > MAX_COURT_NAME_LENGTH) {
    throw new RangeError(`Court names can be at most ${MAX_COURT_NAME_LENGTH} characters`)
  }
  if (courts.some((court) => court.id !== exceptId && sameName(court.name, trimmed))) {
    throw new RangeError('Another court already has that name')
  }
  return trimmed
}

function findCourt(state: SessionState, courtId: number): Court {
  const court = state.courts.find((c) => c.id === courtId)
  if (!court) throw new Error(`Court ${courtId} does not exist`)
  return court
}

/** Open another court, named with the lowest free number unless a name is given. */
export function addCourt(state: SessionState, name?: string): SessionState {
  if (state.courts.length >= MAX_COURTS) {
    throw new RangeError(`A session can have at most ${MAX_COURTS} courts`)
  }
  const id = Math.max(0, ...state.courts.map((c) => c.id)) + 1
  const courtName = name === undefined ? defaultCourtName(state.courts) : checkCourtName(state.courts, name)
  return { ...state, courts: [...state.courts, { id, name: courtName, teams: null }] }
}

/** Rename a court. A game in progress is unaffected. */
export function renameCourt(state: SessionState, courtId: number, name: string): SessionState {
  findCourt(state, courtId)
  const courtName = checkCourtName(state.courts, name, courtId)
  return {
    ...state,
    courts: state.courts.map((c) => (c.id === courtId ? { ...c, name: courtName } : c)),
  }
}

/**
 * Keep a court for a range of skill levels (min, max), or for any level with null. A game in progress
 * is not affected; the court's next game is drawn from players in range. Throws a RangeError for an
 * invalid range.
 */
export function setCourtLevels(state: SessionState, courtId: number, levels: readonly number[] | null): SessionState {
  findCourt(state, courtId)
  const range = normalizeLevels(levels, levelCount(sessionScale(state)))
  return {
    ...state,
    courts: state.courts.map((c) => {
      if (c.id !== courtId) return c
      const { levels: _old, ...rest } = c
      return range ? { ...rest, levels: range } : rest
    }),
  }
}

/** Move a court one place up (-1) or down (1) in the board order. Does nothing at either end. */
export function moveCourt(state: SessionState, courtId: number, offset: -1 | 1): SessionState {
  const index = state.courts.findIndex((c) => c.id === courtId)
  if (index === -1) throw new Error(`Court ${courtId} does not exist`)
  const target = index + offset
  if (target < 0 || target >= state.courts.length) return state
  const courts = [...state.courts]
  ;[courts[index], courts[target]] = [courts[target], courts[index]]
  return { ...state, courts }
}

/**
 * Close a court. A game in progress is cancelled with no result and its players
 * go back to the front of the queue. A session always keeps at least one court.
 */
export function closeCourt(state: SessionState, courtId: number, now?: number): SessionState {
  const court = findCourt(state, courtId)
  if (state.courts.length <= MIN_COURTS) throw new RangeError('A session needs at least one court')
  const base = {
    ...state,
    courts: state.courts.filter((c) => c.id !== courtId),
    // The cancelled game records no time.
    queue: court.teams ? [...court.teams.flat(), ...state.queue] : state.queue,
  }
  return court.teams ? withQueuedAt(base, court.teams.flat(), now) : base
}

/**
 * Change a checked-in player's skill level (queued, playing or on a break). Only what happens
 * from now on follows it: the next group and its team split are worked out from the new level,
 * while a game already on a court keeps its teams and recorded results stay as they were.
 */
export function setPlayerSkill(state: SessionState, playerId: number, skill: SkillLevel): SessionState {
  const player = state.players[playerId]
  if (!player) throw new Error(`Player ${playerId} is not in this session`)
  const scale = sessionScale(state)
  const top = levelCount(scale)
  if (!Number.isInteger(skill) || skill < 1 || skill > top) throw new RangeError(`Skill level must be 1 to ${top}`)
  if (player.skill === skill) return state
  // Their rating becomes where the level starts, so the level holds if the session's scale changes.
  const rating = ratingForLevel(scale, skill)
  return { ...state, players: { ...state.players, [playerId]: { ...player, skill, rating } } }
}

/**
 * Use other skill levels for this session (the club's new ones). Each player's level is worked out again from their
 * rating, and each court kept for a range keeps the ratings it covered: its new range is the new levels those ratings
 * fall in (a range that now covers the whole scale becomes "any level"). Games on a court keep their teams.
 */
export function setSkillScale(state: SessionState, scale: SkillScale): SessionState {
  const old = sessionScale(state)
  const top = levelCount(scale)
  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => {
      const rating = ratingOf(p)
      return [id, { ...p, rating, skill: levelForRating(scale, rating) }]
    }),
  )
  const courts = state.courts.map((court) => {
    if (!court.levels) return court
    // A range an older app set can run past the session's levels (it knows six): read it as ending at the top.
    const oldTop = levelCount(old)
    const min = Math.min(court.levels[0], oldTop)
    const max = Math.min(court.levels[1], oldTop)
    const low = levelForRating(scale, old.levels[min - 1].from)
    const next = old.levels[max]
    // The old range ends just before its next level starts; with none above it, at the top of the new scale.
    const high = next ? Math.max(low, levelForRating(scale, next.from - 0.001)) : top
    const { levels: _old, ...rest } = court
    return low <= 1 && high >= top ? rest : { ...rest, levels: [low, high] as LevelRange }
  })
  return { ...state, players, courts, skillScale: scale }
}

/** A player's name as it will be kept: trimmed, 1 to 80 characters. Throws a RangeError with a readable message. */
export function cleanPlayerName(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length < 1) throw new RangeError('Enter a name')
  if (trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    throw new RangeError(`Names can be at most ${MAX_PLAYER_NAME_LENGTH} characters`)
  }
  return trimmed
}

/**
 * Change a checked-in player's name. Everything shown follows it (queue, courts, standings, the
 * live page) because games and stats refer to players by id. Another player in the session may not
 * have the same name (ignoring case); changing only the capitals of your own name is fine.
 */
export function renamePlayer(state: SessionState, playerId: number, name: string): SessionState {
  const player = state.players[playerId]
  if (!player) throw new Error(`Player ${playerId} is not in this session`)
  const trimmed = cleanPlayerName(name)
  if (Object.values(state.players).some((p) => p.id !== playerId && sameName(p.name, trimmed))) {
    throw new RangeError(`${trimmed} is already in this session`)
  }
  if (player.name === trimmed) return state
  return { ...state, players: { ...state.players, [playerId]: { ...player, name: trimmed } } }
}

/** Show the session on the club's public live page, or keep it off it. Staff devices share it either way. */
export function setLive(state: SessionState, live: boolean): SessionState {
  if (live && state.notStarted) throw new RangeError('Start the session before going live')
  return { ...state, live }
}

/**
 * Whether players see the session on the public live page: missing means live (sessions from before the
 * choice). A session that has not started is never live.
 */
export const isLive = (state: SessionState) => state.live !== false && !state.notStarted

// ---- session clock -----------------------------------------------------------

export type SessionStatus = 'notStarted' | 'paused' | 'running'

export const sessionStatus = (state: SessionState): SessionStatus =>
  state.notStarted ? 'notStarted' : state.clockStoppedAt !== undefined ? 'paused' : 'running'

/** The time an action made at `now` records: the moment the clock stopped, while it is stopped. */
export const sessionNow = (state: SessionState, now: number): number => state.clockStoppedAt ?? now

/** A new session that has not started: its clock stands still from `now` until staff start it. */
export function markNotStarted(state: SessionState, now: number): SessionState {
  const { startedAt: _startedAt, startedBy: _startedBy, pausedBy: _pausedBy, ...rest } = state
  return { ...rest, notStarted: true, clockStoppedAt: now }
}

/** Run the clock again from `now`: every running timer moves on by the time it stood still. */
function runClock(state: SessionState, now: number): SessionState {
  const stoppedAt = state.clockStoppedAt ?? now
  const { clockStoppedAt: _stopped, pausedBy: _pausedBy, notStarted: _notStarted, ...rest } = state
  return shiftSessionClock(rest, now - stoppedAt)
}

/**
 * Start a session that was set up without starting: everyone checked in so far starts waiting now, and
 * games can begin. Starting one that has started changes nothing, so two devices pressing Start at once agree
 * on the first.
 */
export function startSessionClock(state: SessionState, now: number, by?: DeviceRef): SessionState {
  if (!state.notStarted) return state
  return { ...runClock(state, now), startedAt: now, ...(by ? { startedBy: by } : {}) }
}

/**
 * Pause the session: waits and games in progress stop counting until it is resumed. Pausing a session that
 * is already paused (or not started) changes nothing, so two devices pausing at once agree on the first.
 */
export function pauseSession(state: SessionState, now: number, by?: PausedBy): SessionState {
  if (state.clockStoppedAt !== undefined) return state
  const { resumedBy: _resumedBy, ...rest } = state
  // Never before the last thing that happened: a pause sent late (the device was offline) or from a device whose
  // clock is behind would otherwise stop the clock before games that started since, and their time would go negative.
  const at = Math.max(now, lastActivityAt(state) ?? now)
  return { ...rest, clockStoppedAt: at, ...(by ? { pausedBy: by } : {}) }
}

/** Resume a paused session. Resuming one that is running changes nothing; one not started must be started. */
export function resumeSession(state: SessionState, now: number, by?: DeviceRef): SessionState {
  if (state.notStarted) throw new Error('The session has not started yet')
  if (state.clockStoppedAt === undefined) return state
  return { ...runClock(state, now), ...(by ? { resumedBy: by } : {}) }
}

export function setAvgGameMinutes(state: SessionState, minutes: number): SessionState {
  if (!isValidGameMinutes(minutes)) {
    throw new RangeError('avgGameMinutes must be an integer from 5 to 60')
  }
  return { ...state, avgGameMinutes: minutes }
}

export function playingIds(state: SessionState): number[] {
  return state.courts.flatMap((c) => (c.teams ? c.teams.flat() : []))
}

const isPlaying = (state: SessionState, id: number) => playingIds(state).includes(id)

/**
 * Check a player in (or back in from a break). They join the back of the
 * queue, so late arrivals never jump ahead. No-op if already queued or playing.
 */
export function checkIn(state: SessionState, player: RosterPlayer, now?: number): SessionState {
  if (state.queue.includes(player.id) || isPlaying(state, player.id)) return state
  return withQueuedAt(
    {
      ...state,
      players: { ...state.players, [player.id]: player },
      queue: [...state.queue, player.id],
      onBreak: state.onBreak.filter((id) => id !== player.id),
    },
    [player.id],
    now,
  )
}

/** Move a waiting player to a break. Players on a court must be replaced instead. */
export function checkOut(state: SessionState, playerId: number): SessionState {
  if (isPlaying(state, playerId)) {
    throw new Error('Player is on a court; use replacePlayer first')
  }
  if (!state.queue.includes(playerId)) return state
  return withoutQueuedAt(
    {
      ...withoutPickIncluding(state, playerId),
      queue: state.queue.filter((id) => id !== playerId),
      onBreak: [...state.onBreak, playerId],
    },
    [playerId],
  )
}

/** Players still taking part: waiting, on a court or on a break (not those removed from the session). */
export function activeIds(state: SessionState): number[] {
  return [...state.queue, ...playingIds(state), ...state.onBreak]
}

/** Whether a player has finished a game in this session (their results are then kept). */
export function hasPlayed(state: SessionState, playerId: number): boolean {
  return (state.matches ?? []).some((m) => m.teams.flat().includes(playerId)) || (state.stats[playerId]?.games ?? 0) > 0
}

/**
 * Take a player out of the session: off a court (their spot is left open and the game pauses, as with
 * removeFromCourt), out of Next up (a stand-in takes their spot, as with dropFromNextUp), out of the queue
 * or off a break. Their partner locks end. Someone who has played stays in `players` so their results
 * still count, and checking them in again continues them; someone who has not is removed completely.
 */
export function removePlayer(state: SessionState, playerId: number, now?: number): SessionState {
  if (!state.players[playerId] || !activeIds(state).includes(playerId)) {
    throw new Error(`Player ${playerId} is not in the session`)
  }
  const court = courtWithPlayer(state, playerId)
  let off: SessionState
  if (court) off = removeFromCourt(state, court.id, playerId, { onBreak: true, now })
  else if (groupWith(state, playerId) || pinsOf(state).includes(playerId)) off = dropFromNextUp(state, playerId, { onBreak: true })
  else off = checkOut(state, playerId)
  const gone = withoutQueuedAt(
    withoutLocks({ ...off, onBreak: off.onBreak.filter((id) => id !== playerId) }, [playerId]),
    [playerId],
  )
  if (hasPlayed(state, playerId)) return gone
  const players = { ...gone.players }
  delete players[playerId]
  const stats = { ...gone.stats }
  delete stats[playerId]
  return { ...gone, players, stats }
}

/** The group that would play next, already split into teams. */
export interface NextGroup {
  /** Team A first, then Team B. */
  players: number[]
  teams: Teams
}

export interface NextGroupOptions {
  /** Choose as if the mode were auto-balanced (the mixed-doubles "start with who is waiting" override). */
  ignoreMode?: boolean
  /**
   * The group for this court: while courts are kept for skill levels, only players in its range (see
   * nextGroups). Without it, the group for the whole queue, as if no court had a range.
   */
  courtId?: number
}

/** The group waiting for the courts of one level range (undefined: the courts open to any level). */
export interface Lane {
  levels: LevelRange | undefined
  group: NextGroup | null
}

/**
 * Who would play next, or null if no group can be formed yet. Games never start
 * by themselves: staff see this group as "Next up" and start it on a court of
 * their choice. Singles is first come, first served (two players). Doubles
 * groups follow the session's matchmaking mode and locked partners and are
 * split into teams (see src/matchmaking/grouping.ts). The teams shown here are
 * exactly the teams startGame puts on court.
 */
export function nextGroup(state: SessionState, options: NextGroupOptions = {}): NextGroup | null {
  if (options.courtId !== undefined && hasLevelCourts(state)) {
    const court = findCourt(state, options.courtId)
    return nextGroups(state, options).find((lane) => sameLevels(lane.levels, court.levels))?.group ?? null
  }
  return pickedGroup(state) ?? (validPick(state) ? null : groupFrom(state, state.queue, options))
}

/** The group formed from these waiting players (in queue order), ignoring any staff choice. */
function groupFrom(state: SessionState, queue: number[], options: NextGroupOptions): NextGroup | null {
  if (state.mode === 'singles') {
    if (queue.length < 2) return null
    const [a, b] = queue
    return { players: [a, b], teams: [[a], [b]] }
  }
  const group = selectGroup(state, queue, options)
  if (!group) return null
  const teams = splitGroup(state, group)
  return { players: teams.flat(), teams }
}

/**
 * The group waiting for each lane: one lane per level range kept on the courts, in board order, then
 * one for the courts open to any level. Each lane draws, in queue order, from the players in its range
 * that earlier lanes did not take, so nobody is in two groups. A staff-chosen group goes to the first
 * lane whose range takes all of it. With no level courts, one lane with the usual next group.
 */
export function nextGroups(state: SessionState, options: Omit<NextGroupOptions, 'courtId'> = {}): Lane[] {
  if (!hasLevelCourts(state)) return [{ levels: undefined, group: nextGroup(state, options) }]
  const lanes = lanesOf(state.courts)
  const pickLane = pickLaneOf(state, lanes)
  const picked = pickLane === -1 ? null : pickedGroup(state, lanes[pickLane])
  // The staff's choice is served first; while it cannot be completed its pinned players stay reserved.
  const taken = new Set<number>(pickLane === -1 ? [] : (picked?.players ?? pinsOf(state)))
  return lanes.map((levels, index) => {
    if (index === pickLane) return { levels, group: picked }
    const group = groupFrom(state, laneQueue(state, levels, taken), options)
    group?.players.forEach((id) => taken.add(id))
    return { levels, group }
  })
}

/**
 * The staff's choice for the next group, while it still holds: one spot per player (Team A, then
 * Team B), each a pinned player who is still waiting or null for a spot to fill automatically, and
 * at least one pinned. Otherwise undefined.
 */
function validPick(state: SessionState): (number | null)[] | undefined {
  const pick = state.nextUpPick
  if (!pick || pick.length !== playersPerCourt(state.mode)) return undefined
  const pins = pick.filter((id): id is number => id !== null)
  if (pins.length === 0 || new Set(pins).size !== pins.length) return undefined
  return pins.every((id) => state.queue.includes(id)) ? pick : undefined
}

const pinsOf = (state: SessionState) => (validPick(state) ?? []).filter((id): id is number => id !== null)

/**
 * Which lane the staff's choice belongs to (-1 if none): the first whose range takes every pinned
 * player. Staff may also have put someone out of range in; then it stays with the lane that takes
 * most of them (the one it was chosen from), never silently dropped.
 */
function pickLaneOf(state: SessionState, lanes: (LevelRange | undefined)[]): number {
  const pins = pinsOf(state)
  if (pins.length === 0) return -1
  const inRange = (levels: LevelRange | undefined) =>
    pins.filter((id) => inLevels(state.players[id]?.skill ?? 0, levels)).length
  const fullLane = lanes.findIndex((levels) => inRange(levels) === pins.length)
  return fullLane !== -1 ? fullLane : lanes.reduce((best, levels, i) => (inRange(levels) > inRange(lanes[best]) ? i : best), 0)
}

/**
 * The staff-chosen group while all of it is still waiting; otherwise null. It is kept exactly as
 * staff set it (Team A, then Team B), so changing one player never reshuffles the others; its open
 * spots are filled, in order, by the first waiting players in range who are not pinned (null while
 * too few are waiting). Only a lock made since that puts two of them on opposite teams has it split again.
 */
function pickedGroup(state: SessionState, levels?: LevelRange): NextGroup | null {
  const pick = validPick(state)
  if (!pick) return null
  const fill = state.queue.filter((id) => !pick.includes(id) && inLevels(state.players[id]?.skill ?? 0, levels))
  let next = 0
  const full = pick.map((id) => id ?? fill[next++])
  if (full.some((id) => id === undefined)) return null
  const players = full as number[]
  const half = players.length / 2
  const asSet: Teams = [players.slice(0, half), players.slice(half)]
  const splitsLock = state.partners.some(
    ([a, b]) => players.includes(a) && players.includes(b) && asSet[0].includes(a) !== asSet[0].includes(b),
  )
  const teams = splitsLock ? splitGroup(state, players) : asSet
  return { players: teams.flat(), teams }
}

/** Whether the next group is one staff chose (or pinned players into), rather than the automatic pick. */
export const isNextUpPicked = (state: SessionState) => validPick(state) !== undefined

/**
 * What a lane's Next up spots hold while its group cannot be formed yet: the players staff pinned,
 * in their spots, and null for each open one. All null when staff pinned nobody there.
 */
export function nextUpSpots(state: SessionState, laneIndex: number): (number | null)[] {
  const lanes = hasLevelCourts(state) ? lanesOf(state.courts) : [undefined]
  const pick = validPick(state)
  if (pick && pickLaneOf(state, lanes) === laneIndex) return [...pick]
  return Array<number | null>(playersPerCourt(state.mode)).fill(null)
}

/**
 * Pin a player into an open spot of a lane's Next up (its spots are Team A, then Team B). They can be
 * waiting, or on a break (they come back to the end of the queue); not on a court. The group then
 * forms around them as soon as enough players in range are waiting. Pinning into another lane than
 * the current choice's starts a new one there.
 */
export function fillNextUpSpot(
  state: SessionState,
  laneIndex: number,
  slot: number,
  playerId: number,
  now?: number,
): SessionState {
  if (courtWithPlayer(state, playerId)) throw new Error('Choose a player who is waiting or on a break')
  const back = state.onBreak.includes(playerId) ? checkIn(state, state.players[playerId], now) : state
  if (!back.queue.includes(playerId)) throw new Error('Choose a player who is waiting or on a break')
  const spots = nextUpSpots(back, laneIndex).map((id) => (id === playerId ? null : id))
  if (slot < 0 || slot >= spots.length || spots[slot] !== null) throw new Error('That spot is not open')
  spots[slot] = playerId
  return { ...back, nextUpPick: spots }
}

/** The state without a staff-chosen group. Anything that changes who is waiting or playing ends the choice. */
function withoutPick(state: SessionState): SessionState {
  if (state.nextUpPick === undefined) return state
  const { nextUpPick: _pick, ...rest } = state
  return rest
}

/** The state without the staff-chosen group if this player is in it. */
function withoutPickIncluding(state: SessionState, playerId: number): SessionState {
  return state.nextUpPick?.includes(playerId) ? withoutPick(state) : state
}

/** The next group (of any level lane) that has this player, if any. */
function groupWith(state: SessionState, playerId: number): NextGroup | undefined {
  return nextGroups(state).find((lane) => lane.group?.players.includes(playerId))?.group ?? undefined
}

/**
 * Change who is in the next group: `inId` takes the exact spot of `outId` (in it), and the group is
 * then kept as chosen until a game starts or one of them leaves the queue. `inId` can be anyone in
 * the session, whatever their level:
 * - waiting (in another level's group or not): `outId` stays in the queue where they were;
 * - in the same group: the two change places, for example to change teams;
 * - on a break: they come back to the end of the queue;
 * - on a court: the two trade places. `outId` goes onto that court in their spot, and `inId` waits
 *   where `outId` was in the queue.
 * Locked pairs of both players are dissolved, since a pair cannot stay together across the change
 * (two players of one group changing places keep theirs).
 */
export function replaceNextUp(state: SessionState, outId: number, inId: number, now?: number): SessionState {
  if (!groupWith(state, outId) && pinsOf(state).includes(outId)) return replacePin(state, outId, inId, now)
  if (nextGroups(state).every((l) => !l.group)) throw new Error('There is no next group to change')
  const group = groupWith(state, outId)
  if (!group) throw new Error(`Player ${outId} is not in the next group`)
  if (inId === outId || !state.players[inId]) throw new Error('The replacement must be another player of this session')
  const trade = (id: number) => (id === outId ? inId : id === inId ? outId : id)
  const pick = group.players.map(trade)
  if (group.players.includes(inId)) return { ...state, nextUpPick: pick }

  const court = courtWithPlayer(state, inId)
  if (court) {
    const waited = { ...court.waited, ...waitedSeconds(state.queuedAt, [outId], now) }
    delete waited[inId]
    const traded: SessionState = {
      ...withoutLocks(state, [outId, inId]),
      courts: state.courts.map((c) => (c.id === court.id ? withTeams(c, tradeTeams(c.teams!, trade), waited) : c)),
      queue: state.queue.map(trade),
      nextUpPick: pick,
    }
    return withQueuedAt(withoutQueuedAt(traded, [outId]), [inId], now)
  }
  const back = state.onBreak.includes(inId) ? checkIn(state, state.players[inId], now) : state
  if (!back.queue.includes(inId)) throw new Error('The replacement must be another player of this session')
  return { ...withoutLocks(back, [outId, inId]), nextUpPick: pick }
}

/**
 * Swap a player pinned into a group that has not formed yet: `inId` (waiting, on a break, or pinned
 * too, when the two change spots) takes their spot, and `outId` stays in the queue.
 */
function replacePin(state: SessionState, outId: number, inId: number, now?: number): SessionState {
  if (inId === outId || courtWithPlayer(state, inId)) throw new Error('Choose a player who is waiting or on a break')
  const back = state.onBreak.includes(inId) ? checkIn(state, state.players[inId], now) : state
  if (!back.queue.includes(inId)) throw new Error('Choose a player who is waiting or on a break')
  const trade = (id: number | null) => (id === outId ? inId : id === inId ? outId : id)
  return { ...back, nextUpPick: validPick(state)!.map(trade) }
}

/**
 * Who would take this next-up player's spot if they were removed: the first waiting player who is in
 * no next group and fits the level range of theirs. Undefined when nobody can, or they are not next up.
 */
export function nextUpStandIn(state: SessionState, outId: number): number | undefined {
  const lanes = nextGroups(state)
  const lane = lanes.find((l) => l.group?.players.includes(outId))
  if (!lane) return undefined
  const grouped = new Set(lanes.flatMap((l) => l.group?.players ?? []))
  return state.queue.find((id) => !grouped.has(id) && inLevels(state.players[id]?.skill ?? 0, lane.levels))
}

/**
 * Take a player out of their next group: the stand-in (see nextUpStandIn) takes their exact spot and
 * the rest of the group stays as it was. The player keeps their place in the queue, or goes on a
 * break with `onBreak`. With nobody to stand in, only a break is possible (the group is then automatic).
 */
export function dropFromNextUp(state: SessionState, outId: number, { onBreak = false } = {}): SessionState {
  if (!groupWith(state, outId) && pinsOf(state).includes(outId)) {
    // Pinned into a group that has not formed yet: their spot is open again.
    const spots = validPick(state)!.map((id) => (id === outId ? null : id))
    const unpinned = spots.some((id) => id !== null) ? { ...state, nextUpPick: spots } : withoutPick(state)
    return onBreak ? checkOut(unpinned, outId) : unpinned
  }
  if (!groupWith(state, outId)) throw new Error(`Player ${outId} is not in the next group`)
  const standIn = nextUpStandIn(state, outId)
  if (standIn === undefined) {
    if (!onBreak) throw new Error('No one is waiting to take their place')
    return checkOut(state, outId)
  }
  const replaced = replaceNextUp(state, outId, standIn)
  return onBreak ? checkOut(replaced, outId) : replaced
}

/** Go back to the automatic next group. */
export function resetNextUp(state: SessionState): SessionState {
  return withoutPick(state)
}

export interface StartGameOptions extends NextGroupOptions {
  /**
   * When the game starts (ms since the epoch), so its duration can be recorded. The engine never
   * reads the clock itself; the store passes Date.now(). Without it the game records no time.
   */
  now?: number
}

/**
 * Put the next group on an open court. Throws if the court is busy or unknown,
 * or if no group can be formed. The players leave the queue.
 */
export function startGame(state: SessionState, courtId: number, options: StartGameOptions = {}): SessionState {
  if (state.notStarted) throw new RangeError('Start the session before starting a game')
  if (state.clockStoppedAt !== undefined) throw new RangeError('The session is paused: resume it to start a game')
  const court = findCourt(state, courtId)
  if (court.notStarted) return startStaged(state, court, options.now)
  if (court.teams) throw new Error(`${court.name} already has a game in progress`)
  // The override ("start with whoever is waiting") draws from the whole queue, whatever the court's range.
  const group = options.ignoreMode ? nextGroup(state, { ignoreMode: true }) : nextGroup(state, { courtId })
  if (!group) throw new Error('Not enough players are waiting to start a game')
  const waited = waitedSeconds(state.queuedAt, group.players, options.now)
  // A game on another level's court leaves a group staff chose for their own court in place.
  const keepPick = hasLevelCourts(state) && !state.nextUpPick?.some((id) => id !== null && group.players.includes(id))
  return withoutQueuedAt(
    {
      ...(keepPick ? state : withoutPick(state)),
      courts: state.courts.map((c) =>
        c.id === courtId
          ? {
              ...c,
              teams: group.teams,
              ...(options.now === undefined ? {} : { startedAt: options.now }),
              ...(waited ? { waited } : {}),
            }
          : c,
      ),
      queue: state.queue.filter((id) => !group.players.includes(id)),
    },
    group.players,
  )
}

export interface GameResult {
  state: SessionState
  winners: number[]
  losers: number[]
}

export interface ResultOptions {
  /** When the game ended (ms since the epoch). Without it the game records no time. */
  now?: number
}

export const isValidScore = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_SCORE

/** Why a score cannot be recorded, or null if it can. Scores are whole numbers from 0 to MAX_SCORE and never level. */
export function scoreProblem(a: number, b: number): string | null {
  if (!isValidScore(a) || !isValidScore(b)) return `Scores must be whole numbers from 0 to ${MAX_SCORE}`
  if (a === b) return 'The scores are level. A game needs a winner.'
  return null
}

/** The teams by name, as players see them. */
const TEAM_LABELS = TEAM_NAMES

/**
 * Why a score cannot be recorded for a game that this team won, or null if it can: the same checks
 * as scoreProblem, and the winner's score must be the higher one.
 */
export function winnerScoreProblem(winner: 0 | 1, scoreA: number, scoreB: number): string | null {
  const problem = scoreProblem(scoreA, scoreB)
  if (problem) return problem
  const winnerScore = winner === 0 ? scoreA : scoreB
  const otherScore = winner === 0 ? scoreB : scoreA
  return winnerScore > otherScore ? null : `${TEAM_LABELS[winner]} won, so their score must be higher.`
}

/** Players per team: 2 in doubles, 1 in singles. */
export const playersPerTeam = (mode: GameMode) => playersPerCourt(mode) / 2

/** Whether a game on this court is missing a player (someone was removed and the spot is open). */
export const isShort = (court: Court, mode: GameMode) =>
  !!court.teams && court.teams.some((team) => team.length < playersPerTeam(mode))

/**
 * How long the game on this court has actually been played, in ms: since it started, less the time
 * its spot was open (paused before, and paused now). Undefined when it has no start time.
 */
export function playedMs(court: Court, now: number): number | undefined {
  if (court.startedAt === undefined) return undefined
  const pausedNow = court.pausedAt === undefined ? 0 : Math.max(0, now - court.pausedAt)
  return now - court.startedAt - (court.pausedSeconds ?? 0) * 1000 - pausedNow
}

/**
 * Whole seconds the game on this court has been played (time paused left out), from 0 to
 * MAX_GAME_SECONDS. 0 when the game has no start time (it began before times were tracked) or no
 * end time is given.
 */
function gameSeconds(court: Court, now: number | undefined): number {
  const played = now === undefined ? undefined : playedMs(court, now)
  if (played === undefined) return 0
  const seconds = Math.floor(played / 1000)
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), MAX_GAME_SECONDS) : 0
}

/** The court with no game on it. Also drops the start time. */
const openCourt = (court: Court): Court => ({
  id: court.id,
  name: court.name,
  teams: null,
  ...(court.levels ? { levels: court.levels } : {}),
})

/**
 * Record a finished game. `winner` is the index (0 or 1) of the winning side.
 * The court is freed and both sides rejoin the back of the queue, winners
 * first. Nothing starts by itself: staff start the next game with startGame.
 * No score is kept (see recordScore), but the game's time is recorded when `now` is given.
 */
export function recordResult(
  state: SessionState,
  courtId: number,
  winner: 0 | 1,
  { now }: ResultOptions = {},
): GameResult {
  return finishGame(state, courtId, winner, undefined, now)
}

/**
 * Record a finished game from its score. The higher score wins; equal scores, or scores that are
 * not whole numbers from 0 to MAX_SCORE, throw a RangeError. Otherwise exactly like recordResult,
 * and it also adds the points to everyone's totals.
 */
export function recordScore(
  state: SessionState,
  courtId: number,
  scoreA: number,
  scoreB: number,
  { now }: ResultOptions = {},
): GameResult {
  const problem = scoreProblem(scoreA, scoreB)
  if (problem) throw new RangeError(problem)
  return finishGame(state, courtId, scoreA > scoreB ? 0 : 1, [scoreA, scoreB], now)
}

/**
 * Players who have just finished a game count towards their waiting locks. A lock whose two
 * partners have both finished a game since it was made comes into force.
 */
function settlePendingLocks(
  state: SessionState,
  finished: number[],
): Pick<SessionState, 'partners' | 'pendingPartners'> {
  const pending = state.pendingPartners ?? []
  if (pending.length === 0) return { partners: state.partners, pendingPartners: state.pendingPartners }
  const partners = [...state.partners]
  const stillWaiting: PendingPartners[] = []
  for (const { pair, done } of pending) {
    const nowDone = [...new Set([...done, ...pair.filter((id) => finished.includes(id))])]
    if (pair.every((id) => nowDone.includes(id))) partners.push(pair)
    else stillWaiting.push({ pair, done: nowDone })
  }
  return { partners, pendingPartners: stillWaiting.length > 0 ? stillWaiting : undefined }
}

/**
 * Every player's stats, recomputed from scratch by replaying the match list in order. Shared by
 * finishGame (a new match appended) and editMatch (an existing one corrected) so both always agree.
 */
function computeStats(matches: MatchRecord[], players: Record<number, RosterPlayer>): Record<number, PlayerStats> {
  const stats: Record<number, PlayerStats> = {}
  const averageSkill = (ids: number[]) =>
    ids.reduce((sum, id) => sum + (players[id]?.skill ?? 0), 0) / ids.length
  for (const match of matches) {
    const { teams, winner, score, seconds, waited } = match
    const loser = winner === 0 ? 1 : 0
    const tally = (ids: number[], opponents: number[], won: boolean) => {
      const opponentSkill = averageSkill(opponents)
      const pointsFor = score?.[won ? winner : loser] ?? 0
      const pointsAgainst = score?.[won ? loser : winner] ?? 0
      for (const id of ids) {
        const prev = stats[id] ?? EMPTY_STATS
        stats[id] = {
          games: prev.games + 1,
          wins: prev.wins + (won ? 1 : 0),
          losses: prev.losses + (won ? 0 : 1),
          opponentSkill: prev.opponentSkill + opponentSkill,
          pointsFor: prev.pointsFor + pointsFor,
          pointsAgainst: prev.pointsAgainst + pointsAgainst,
          scoredGames: prev.scoredGames + (score ? 1 : 0),
          secondsPlayed: prev.secondsPlayed + seconds,
          secondsWaited: prev.secondsWaited + (waited?.[id] ?? 0),
        }
      }
    }
    tally(teams[winner], teams[loser], true)
    tally(teams[loser], teams[winner], false)
  }
  return stats
}

/**
 * Shared by recordResult and recordScore. The game's time is credited to whoever is on the court
 * when it ends: a substitute made mid-game gets all of it and the player who left gets none.
 */
function finishGame(
  state: SessionState,
  courtId: number,
  winner: 0 | 1,
  score: [number, number] | undefined,
  now: number | undefined,
): GameResult {
  const court = state.courts.find((c) => c.id === courtId)
  if (!court?.teams) throw new Error(`Court ${courtId} has no game in progress`)
  if (court.notStarted) throw new Error(`The game on ${court.name} has not started`)
  if (isShort(court, state.mode)) throw new Error(`Fill the open spot on ${court.name} before finishing the game`)
  const loser = winner === 0 ? 1 : 0
  const winners = court.teams[winner]
  const losers = court.teams[loser]
  const seconds = gameSeconds(court, now)
  const matches = [
    ...(state.matches ?? []),
    {
      courtName: court.name,
      teams: court.teams,
      winner,
      ...(score ? { score } : {}),
      seconds,
      ...(now === undefined ? {} : { endedAt: now }),
      ...(court.waited ? { waited: court.waited } : {}),
    },
  ]
  const locks = settlePendingLocks(state, [...winners, ...losers])
  return {
    winners,
    losers,
    state: withQueuedAt(
      {
        ...state,
        ...locks,
        courts: state.courts.map((c) => (c.id === courtId ? openCourt(c) : c)),
        queue: [...state.queue, ...winners, ...losers],
        lastResult: {
          ...state.lastResult,
          ...Object.fromEntries(winners.map((id) => [id, 'W' as const])),
          ...Object.fromEntries(losers.map((id) => [id, 'L' as const])),
        },
        stats: computeStats(matches, state.players),
        matches,
      },
      [...winners, ...losers],
      now,
    ),
  }
}

export interface MatchEdit {
  teams?: Teams
  score?: [number, number]
}

/**
 * Correct an already-recorded match's score and/or which players were on each team. Recomputes
 * every player's stats from the whole corrected match history, since stats are otherwise only
 * ever added to as games finish.
 */
export function editMatch(state: SessionState, matchIndex: number, edit: MatchEdit): SessionState {
  const matches = state.matches ?? []
  const existing = matches[matchIndex]
  if (!existing) throw new Error(`No match at index ${matchIndex}`)
  if (edit.score) {
    const problem = scoreProblem(edit.score[0], edit.score[1])
    if (problem) throw new RangeError(problem)
  }
  const winner = edit.score ? (edit.score[0] > edit.score[1] ? 0 : 1) : existing.winner
  const updated: MatchRecord = { ...existing, ...edit, winner }
  const newMatches = matches.map((m, i) => (i === matchIndex ? updated : m))
  return { ...state, matches: newMatches, stats: computeStats(newMatches, state.players) }
}

/**
 * Start the line-up staff put on this court by hand (see fillCourtSpot). Every spot must be filled.
 * Each player's wait is recorded up to now; the next group is left as it is.
 */
function startStaged(state: SessionState, court: Court, now: number | undefined): SessionState {
  if (isShort(court, state.mode)) throw new Error(`Fill every spot on ${court.name} to start the game`)
  const players = court.teams!.flat()
  const waited = waitedSeconds(state.queuedAt, players, now)
  const { notStarted: _staged, waited: _none, ...rest } = court
  const started: Court = {
    ...rest,
    ...(now === undefined ? {} : { startedAt: now }),
    ...(waited ? { waited } : {}),
  }
  return withoutQueuedAt({ ...state, courts: state.courts.map((c) => (c.id === court.id ? started : c)) }, players)
}

/**
 * Abandon a game without a result or a time. Its players return to the front of the queue. On a
 * court staff were setting up by hand, the same clears it, and its players keep their wait so far
 * (they never played).
 */
export function cancelMatch(state: SessionState, courtId: number, now?: number): SessionState {
  const court = state.courts.find((c) => c.id === courtId)
  if (!court?.teams) throw new Error(`Court ${courtId} has no game in progress`)
  if (court.notStarted) {
    return {
      ...state,
      courts: state.courts.map((c) => (c.id === courtId ? openCourt(c) : c)),
      queue: [...court.teams.flat(), ...state.queue],
    }
  }
  return withQueuedAt(
    {
      ...state,
      courts: state.courts.map((c) => (c.id === courtId ? openCourt(c) : c)),
      queue: [...court.teams.flat(), ...state.queue],
    },
    court.teams.flat(),
    now,
  )
}

export interface ReplacePlayerOptions {
  /** Send the player who comes off on a break. Otherwise they go to the front of the queue. */
  sendOnBreak?: boolean
  /** When the substitution happened, so the incoming player's pre-game wait can be recorded. */
  now?: number
}

/** The court with these teams and pre-game waits (the waits left out when there are none). */
/** A court's spots, team by team in board order: a player's id, or null for an open spot. */
export type CourtSlots = [(number | null)[], (number | null)[]]

/**
 * Where each player and open spot of a court is (see Court.openSlots): the players keep their order
 * in the positions that are not open. Without (or with unusable) positions, open spots come last.
 */
export function courtSlots(court: Court, perTeam: number): CourtSlots {
  const teams = court.teams ?? [[], []]
  return teams.map((team, i) => {
    const size = Math.max(perTeam, team.length)
    const open = court.openSlots?.[i] ?? []
    const usable = open.length === size - team.length && open.every((s) => Number.isInteger(s) && s >= 0 && s < size)
    const gaps = new Set(usable ? open : Array.from({ length: size - team.length }, (_, k) => team.length + k))
    const players = [...team]
    return Array.from({ length: size }, (_, s) => (gaps.has(s) ? null : (players.shift() ?? null)))
  }) as CourtSlots
}

/** The court with these spots: `teams` holds the players in order, `openSlots` where the gaps are (left out when none). */
function withSlots(court: Court, slots: CourtSlots): Court {
  const { openSlots: _old, ...rest } = court
  const teams = slots.map((team) => team.filter((id): id is number => id !== null)) as Teams
  const open = slots.map((team) => team.flatMap((id, s) => (id === null ? [s] : []))) as [number[], number[]]
  return { ...rest, teams, ...(open.some((gaps) => gaps.length > 0) ? { openSlots: open } : {}) }
}

function withTeams(court: Court, teams: Teams, waited: Record<number, number>): Court {
  const { waited: _old, ...rest } = court
  return { ...rest, teams, ...(Object.keys(waited).length > 0 ? { waited } : {}) }
}

const tradeTeams = (teams: Teams, trade: (id: number) => number): Teams => [teams[0].map(trade), teams[1].map(trade)]

/**
 * Swap a player out of a live game. The substitute defaults to the front of the queue and takes the
 * same spot. It can be anyone in the session:
 * - waiting or on a break: the player who comes off goes to the front of the queue, or on a break
 *   when asked to. If the substitute was in a next group, the one coming off takes their spot in it,
 *   so the rest of that group stays as it was.
 * - on a court (this one or another): the two trade places, each with their pre-game wait, and
 *   nobody leaves the courts.
 */
export function replacePlayer(
  state: SessionState,
  courtId: number,
  outId: number,
  inId: number | undefined = state.queue[0],
  { sendOnBreak = false, now }: ReplacePlayerOptions = {},
): SessionState {
  const court = state.courts.find((c) => c.id === courtId)
  if (!court?.teams?.flat().includes(outId)) {
    throw new Error(`Player ${outId} is not playing on court ${courtId}`)
  }
  const other = inId === undefined || inId === outId ? undefined : courtWithPlayer(state, inId)
  if (other && inId !== undefined) {
    const trade = (id: number) => (id === outId ? inId : id === inId ? outId : id)
    const waitsOf = (c: Court) => {
      if (other.id === courtId) return Object.fromEntries(Object.entries(c.waited ?? {}).map(([id, s]) => [trade(Number(id)), s]))
      const [leaving, coming, from] = c.id === courtId ? [outId, inId, other] : [inId, outId, court]
      const waited = { ...c.waited }
      delete waited[leaving]
      if (from.waited?.[coming] !== undefined) waited[coming] = from.waited[coming]
      return waited
    }
    return {
      // A locked pair cannot stay together once one of them moves.
      ...withoutLocks(state, [outId, inId]),
      courts: state.courts.map((c) =>
        c.id === courtId || c.id === other.id ? withTeams(c, tradeTeams(c.teams!, trade), waitsOf(c)) : c,
      ),
    }
  }
  const back = inId !== undefined && state.onBreak.includes(inId) ? checkIn(state, state.players[inId], now) : state
  if (inId === undefined || !back.queue.includes(inId)) {
    throw new Error('Substitute must be another player of this session')
  }
  const swap = (id: number) => (id === outId ? inId : id)
  const waiting = back.queue.filter((id) => id !== inId)
  const waited = { ...court.waited, ...waitedSeconds(back.queuedAt, [inId], now) }
  delete waited[outId]
  // The substitute's spot in a next group goes to whoever comes off, so the rest of it stays put.
  const group = sendOnBreak ? undefined : groupWith(back, inId)
  const picked = group
    ? { ...back, nextUpPick: group.players.map((id) => (id === inId ? outId : id)) }
    : withoutPickIncluding(back, inId)
  const base = {
    // Whoever comes off is no longer bound to their partner, whether the lock is in force or waiting.
    ...withoutLocks(picked, [outId]),
    courts: back.courts.map((c) => (c.id === courtId ? withTeams(c, tradeTeams(court.teams!, swap), waited) : c)),
    queue: sendOnBreak ? waiting : [outId, ...waiting],
    onBreak: sendOnBreak ? [...back.onBreak, outId] : back.onBreak,
  }
  const withoutIncoming = withoutQueuedAt(base, [inId])
  return sendOnBreak
    ? withoutQueuedAt(withoutIncoming, [outId])
    : withQueuedAt(withoutIncoming, [outId], now)
}

export interface RemoveFromCourtOptions {
  /** Send them on a break. Otherwise they go to the front of the queue. */
  onBreak?: boolean
  /** When it happened: the game is paused from then, and they wait from then. */
  now?: number
}

/**
 * Take a player off a game in progress, leaving their spot open. They go to the front of the queue
 * (or on a break), their partner locks end, and the game is paused until the spot is filled (see
 * fillCourtSpot); it cannot be finished while short. A court with nobody left is simply open again.
 */
export function removeFromCourt(
  state: SessionState,
  courtId: number,
  playerId: number,
  { onBreak = false, now }: RemoveFromCourtOptions = {},
): SessionState {
  const court = state.courts.find((c) => c.id === courtId)
  if (!court?.teams?.flat().includes(playerId)) {
    throw new Error(`Player ${playerId} is not playing on court ${courtId}`)
  }
  // The spot stays open where they were, so the others do not move up.
  const slots = courtSlots(court, playersPerTeam(state.mode))
  const spots = slots.map((team) => team.map((id) => (id === playerId ? null : id))) as CourtSlots
  const waited = { ...court.waited }
  delete waited[playerId]
  const empty = spots.every((team) => team.every((id) => id === null))
  const placed = withSlots(court, spots)
  const left = withTeams(placed, placed.teams!, waited)
  // Only a game that has started is paused; a court being set up has no time to stop.
  if (!court.notStarted && (court.pausedAt ?? now) !== undefined) left.pausedAt = court.pausedAt ?? now
  const off: SessionState = {
    ...withoutLocks(state, [playerId]),
    courts: state.courts.map((c) => (c.id !== courtId ? c : empty ? openCourt(c) : left)),
    queue: onBreak ? state.queue : [playerId, ...state.queue],
    onBreak: onBreak ? [...state.onBreak, playerId] : state.onBreak,
  }
  if (onBreak) return withoutQueuedAt(off, [playerId])
  // Off a court being set up they never played, so they keep waiting from when they joined the queue.
  return court.notStarted ? off : withQueuedAt(off, [playerId], now)
}

/**
 * Put a player in an open spot on a team of a game in progress (see removeFromCourt). They can be
 * waiting or on a break (they come back), not on a court. Once the court is full again its time runs
 * again: the time it was paused is kept aside and left out of the game's recorded length.
 * `slot` is the open spot's position on the team (see courtSlots); without it, the first open one.
 */
export function fillCourtSpot(
  state: SessionState,
  courtId: number,
  team: 0 | 1,
  playerId: number,
  now?: number,
  slot?: number,
): SessionState {
  const found = state.courts.find((c) => c.id === courtId)
  if (!found) throw new Error(`Court ${courtId} does not exist`)
  // An open court is set up by hand, one spot at a time; its game starts when staff press Start game.
  const court: Court = found.teams ? found : { ...openCourt(found), teams: [[], []], notStarted: true }
  const spots = courtSlots(court, playersPerTeam(state.mode))
  // Without a slot (an action from an older app), the first open spot of the team.
  const at = slot ?? spots[team].indexOf(null)
  if (at < 0) throw new Error(`${TEAM_LABELS[team]} has no open spot`)
  if (spots[team][at] !== null) throw new Error('That spot is not open')
  if (courtWithPlayer(state, playerId)) throw new Error('Choose a player who is waiting or on a break')
  const back = state.onBreak.includes(playerId) ? checkIn(state, state.players[playerId], now) : state
  if (!back.queue.includes(playerId)) throw new Error('Choose a player who is waiting or on a break')
  spots[team][at] = playerId
  const placed = withSlots(court, spots)
  const moved = {
    ...withoutPickIncluding(back, playerId),
    queue: back.queue.filter((id) => id !== playerId),
  }
  if (court.notStarted) {
    // Not playing yet: they keep their wait, recorded when the game starts.
    return { ...moved, courts: back.courts.map((c) => (c.id === courtId ? placed : c)) }
  }
  const waited = { ...court.waited, ...waitedSeconds(back.queuedAt, [playerId], now) }
  let filled = withTeams(placed, placed.teams!, waited)
  if (!isShort(filled, state.mode) && filled.pausedAt !== undefined) {
    const { pausedAt, ...running } = filled
    const pausedFor = now === undefined ? 0 : Math.max(0, Math.floor((now - pausedAt) / 1000))
    filled = { ...running, pausedSeconds: (filled.pausedSeconds ?? 0) + pausedFor }
  }
  return withoutQueuedAt({ ...moved, courts: back.courts.map((c) => (c.id === courtId ? filled : c)) }, [playerId])
}

/** Where a partner is, when they are not waiting: on a named court, or on a break. */
export interface AwayPartner {
  id: number
  courtName?: string
}

/** Whether a lock would be in force at once, or wait for both partners to finish a game (and who is away). */
export type LockStatus = { inForce: true } | { inForce: false; away: AwayPartner[] }

function courtWithPlayer(state: SessionState, id: number): Court | undefined {
  return state.courts.find((c) => c.teams?.flat().includes(id))
}

/**
 * A lock is in force at once when both partners are waiting, or both are in the same game.
 * Otherwise (one is on a court or a break) it waits: it would otherwise pull the partner who just
 * finished ahead of everyone who was waiting. `away` says who is not waiting and where.
 */
export function lockStatus(state: SessionState, a: number, b: number): LockStatus {
  const courtA = courtWithPlayer(state, a)
  const courtB = courtWithPlayer(state, b)
  if (state.queue.includes(a) && state.queue.includes(b)) return { inForce: true }
  if (courtA && courtA === courtB) return { inForce: true }
  const away = [a, b]
    .filter((id) => !state.queue.includes(id))
    .map((id): AwayPartner => ({ id, courtName: courtWithPlayer(state, id)?.name }))
  return { inForce: false, away }
}

/** Any lock, in force or waiting, that includes this player. */
const isLocked = (state: SessionState, id: number) =>
  partnerOf(state.partners, id) !== undefined ||
  (state.pendingPartners ?? []).some(({ pair }) => pair.includes(id))

/** The state without the locks (in force or waiting) that include any of these players. */
function withoutLocks(state: SessionState, ids: number[]): SessionState {
  const { pendingPartners, ...rest } = state
  const pending = (pendingPartners ?? []).filter(({ pair }) => !pair.some((id) => ids.includes(id)))
  return {
    ...rest,
    partners: state.partners.filter((pair) => !pair.some((id) => ids.includes(id))),
    ...(pending.length > 0 ? { pendingPartners: pending } : {}),
  }
}

/** The state with these players' queue-wait timestamps removed: they are no longer waiting. */
function withoutQueuedAt(state: SessionState, ids: number[]): SessionState {
  if (!state.queuedAt) return state
  const queuedAt = Object.fromEntries(Object.entries(state.queuedAt).filter(([id]) => !ids.includes(Number(id))))
  return { ...state, queuedAt }
}

/** The state with these players stamped as newly queued, when `now` is known. Clears any stale entry first. */
function withQueuedAt(state: SessionState, ids: number[], now: number | undefined): SessionState {
  const cleared = withoutQueuedAt(state, ids)
  if (now === undefined) return cleared
  return { ...cleared, queuedAt: { ...cleared.queuedAt, ...Object.fromEntries(ids.map((id) => [id, now])) } }
}

/** Whole seconds each of these players had waited, for those with a known queue-join time. Undefined if none. */
function waitedSeconds(
  queuedAt: Record<number, number> | undefined,
  ids: number[],
  now: number | undefined,
): Record<number, number> | undefined {
  if (!queuedAt || now === undefined) return undefined
  const entries = ids
    .filter((id) => queuedAt[id] !== undefined)
    .map((id) => [id, Math.max(0, Math.floor((now - queuedAt[id]) / 1000))] as const)
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/**
 * Lock two checked-in players as partners: they always share a team and wait in the queue
 * together. Doubles only; a player can have one partner.
 *
 * When both are waiting the lock is in force at once and the later partner moves up right behind
 * the earlier one. Otherwise it waits (see lockStatus): nothing changes in the queue or the
 * groups until both have finished a game, so each keeps their own turn.
 */
export function lockPartners(state: SessionState, a: number, b: number): SessionState {
  if (state.mode !== 'doubles') throw new Error('Partners can only be locked in doubles')
  if (a === b) throw new Error('A player cannot partner themselves')
  if (!state.players[a] || !state.players[b]) throw new Error('Both players must be checked in')
  // Someone removed from the session stays in `players` for their results, but takes no part any more.
  const active = activeIds(state)
  if (!active.includes(a) || !active.includes(b)) throw new Error('Both players must be in the session')
  if (isLocked(state, a) || isLocked(state, b)) throw new Error('A player is already locked with a partner')

  if (!lockStatus(state, a, b).inForce) {
    return { ...state, pendingPartners: [...(state.pendingPartners ?? []), { pair: [a, b], done: [] }] }
  }
  const locked = { ...state, partners: [...state.partners, [a, b] as [number, number]] }
  if (!(state.queue.includes(a) && state.queue.includes(b))) return locked
  // Both waiting: the later one moves up to sit right behind the earlier one.
  const [first, second] = state.queue.indexOf(a) < state.queue.indexOf(b) ? [a, b] : [b, a]
  const rest = state.queue.filter((id) => id !== second)
  rest.splice(rest.indexOf(first) + 1, 0, second)
  return { ...locked, queue: rest }
}

/** Dissolve the partner lock, in force or waiting, that includes this player (no-op if none). */
export function unlockPartners(state: SessionState, playerId: number): SessionState {
  return withoutLocks(state, [playerId])
}

/**
 * Rough minutes until a queued player is on court, assuming games last
 * `avgGameMinutes` and courts free up evenly staggered. Returns null if the
 * player is not in the queue.
 */
export function estimateWaitMinutes(
  state: SessionState,
  playerId: number,
  avgGameMinutes: number,
): number | null {
  const position = state.queue.indexOf(playerId)
  if (position === -1) return null
  const freeCourts = state.courts.filter((c) => !c.teams).length
  const matchesAhead = Math.floor(position / playersPerCourt(state.mode))
  const courtsToFree = Math.max(0, matchesAhead - freeCourts + 1)
  return Math.round((courtsToFree * avgGameMinutes) / state.courts.length)
}

/**
 * Shift every wall-clock timestamp that measures something still in effect (a queued player's
 * wait, an in-progress game's elapsed time) forward by `offsetMs`, so resuming a session after a
 * gap continues those timers from where they stood when it ended, instead of counting the gap
 * itself as wait/play time. Finished-match timestamps (MatchRecord.endedAt) and durations already
 * banked (Court.waited, MatchRecord.seconds) are historical facts and are left alone.
 */
export function shiftSessionClock(session: SessionState, offsetMs: number): SessionState {
  if (offsetMs <= 0) return session
  return {
    ...session,
    ...(session.queuedAt
      ? { queuedAt: Object.fromEntries(Object.entries(session.queuedAt).map(([id, t]) => [Number(id), t + offsetMs])) }
      : {}),
    courts: session.courts.map((c) =>
      c.teams && c.startedAt !== undefined
        ? {
            ...c,
            startedAt: c.startedAt + offsetMs,
            ...(c.pausedAt !== undefined ? { pausedAt: c.pausedAt + offsetMs } : {}),
          }
        : c,
    ),
  }
}

/**
 * The latest wall-clock time the session records (a game finished or started, a check-in, a pause):
 * the best guess of when it stopped when nothing better is known. Undefined when it holds no times.
 */
export function lastActivityAt(session: SessionState): number | undefined {
  const times = [
    ...(session.matches ?? []).map((m) => m.endedAt),
    ...Object.values(session.queuedAt ?? {}),
    ...session.courts.flatMap((c) => [c.startedAt, c.pausedAt]),
    session.clockStoppedAt,
  ].filter((t): t is number => t !== undefined)
  return times.length > 0 ? Math.max(...times) : undefined
}

/** Change the assumed game length used for wait estimates. */
