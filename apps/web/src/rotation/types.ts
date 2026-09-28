import type { SkillScale } from '@q2dink/shared'
import type { Player, SkillLevel } from '../db/db'

/** A player who has been saved to the roster and therefore has an id. */
export type RosterPlayer = Player & { id: number }

export type GameMode = 'doubles' | 'singles'

/** How doubles groups are picked from the queue. Singles is always first come, first served. */
export type MatchmakingMode = 'balanced' | 'skill' | 'winners' | 'mixed'

export type LastResult = 'W' | 'L'

export interface PlayerStats {
  games: number
  wins: number
  losses: number
  /** Sum over this player's games of the opposing team's average skill level. */
  opponentSkill: number
  /** Points this player's team scored, over the games that had a score entered. */
  pointsFor: number
  /** Points the opposing teams scored against this player, over the same games. */
  pointsAgainst: number
  /** Games that had a score entered. Winner-only results count as a game but not here. */
  scoredGames: number
  /** Total time on court, in whole seconds. */
  secondsPlayed: number
  /** Total time waiting in the queue before the games played, in whole seconds (0 where not known). */
  secondsWaited: number
}

/** Two sides of player ids. Doubles: 2 per side. Singles: 1 per side. */
export type Teams = [number[], number[]]

export interface Court {
  /** Never changes and is never reused while the court exists; results and undo refer to it. */
  id: number
  /** What people call the court. Editable, and unique within the session. */
  name: string
  /** null while the court is empty. */
  teams: Teams | null
  /**
   * While a team has an open spot: which positions (0-based, per team) are open, so a removed player's
   * spot stays where it was and staff fill the exact one they tap (see courtSlots in the engine).
   * `teams` keeps only the players, in order. Missing means any open spots come after the players.
   */
  openSlots?: [number[], number[]]
  /**
   * The skill levels this court is kept for (min, max, both 1 to 6). Its games are drawn only from
   * waiting players in range (see rotation/levels.ts). Missing means any level.
   */
  levels?: [SkillLevel, SkillLevel]
  /**
   * When the game in progress started (ms since the epoch), so its duration can be recorded.
   * Missing for a game started before this was tracked; such a game records no time.
   */
  startedAt?: number
  /**
   * While a player has been removed and their spot is open (a team is short): when that started (ms
   * since the epoch). The game's time is paused, and it cannot be finished until the spot is filled.
   * Missing means the game is running.
   */
  pausedAt?: number
  /**
   * Staff paused this game (Pause game), so `pausedAt` is set and filling an open spot does not resume it:
   * only Resume game does. Missing means it is paused only while a spot is open, if at all.
   */
  pausedByStaff?: true
  /**
   * The players in `teams` were put on the court by staff, one spot at a time, and the game has not
   * started: no time runs and it cannot be finished. Start game starts it once every spot is filled.
   * Missing means a game in progress (or an open court).
   */
  notStarted?: true
  /** Whole seconds this game has been paused so far, left out of its recorded time. Missing means none. */
  pausedSeconds?: number
  /**
   * Whole seconds each player on this court had waited before this game started. Missing per
   * player when their queue-join time was not known.
   */
  waited?: Record<number, number>
}

/** A finished game, kept in the order it ended. Cancelled games are not recorded. */
export interface MatchRecord {
  /** The court's name when the game ended; courts can be renamed or closed afterwards. */
  courtName: string
  teams: Teams
  /** Index of the winning side. */
  winner: 0 | 1
  /** Team A, then Team B. Missing when only the winner was recorded. */
  score?: [number, number]
  /** Whole seconds on court; 0 when the game's start time was not known. */
  seconds: number
  /** When the game ended (ms since the epoch), if known. */
  endedAt?: number
  /**
   * Whole seconds each player had waited before this match started, carried over from the
   * court's `waited` when the game finished. Missing per player when not known.
   */
  waited?: Record<number, number>
}

/** A partner lock that is not in force yet: it starts once both have finished a game after locking. */
export interface PendingPartners {
  pair: [number, number]
  /** Which of the two have finished a game since the lock. */
  done: number[]
}

/** A staff device, as the club knows it (its id from lib/device.ts and the name staff gave it). */
export interface DeviceRef {
  deviceId: string
  name: string
}

/** Who paused the session, and whether it was paused because they left it. */
export interface PausedBy extends DeviceRef {
  reason?: 'left'
}

export interface SessionState {
  /**
   * Created but not started: players can be checked in, but no clock runs, no game starts and it cannot
   * go live until staff press Start session. Missing means started (every session from before this).
   */
  notStarted?: true
  /**
   * When the session clock stopped (ms since the epoch): when it was created while not started, when it was
   * paused while paused. Every timestamp an action records while it is set is this time (see sessionNow in
   * the engine), and starting or resuming shifts the running timers by the stop, so it never counts as
   * waiting or playing. Missing means the clock is running.
   */
  clockStoppedAt?: number
  /** Which device paused it, while paused. Missing when running, not started, or paused by an older app. */
  pausedBy?: PausedBy
  /** When staff pressed Start session (ms since the epoch). Missing for sessions from before this, or not started. */
  startedAt?: number
  /** Which device started it. */
  startedBy?: DeviceRef
  /** Which device resumed it last, until it is paused again. */
  resumedBy?: DeviceRef
  mode: GameMode
  /** Assumed length of one game, used for wait estimates. */
  avgGameMinutes: number
  matchmaking: MatchmakingMode
  /** Locked doubles partners: always on the same team and queued together. */
  partners: [number, number][]
  /** Outcome of each player's most recent game (used by Winners vs. Losers). */
  lastResult: Record<number, LastResult>
  /** This session's results per player (only players who have finished a game). */
  stats: Record<number, PlayerStats>
  courts: Court[]
  players: Record<number, RosterPlayer>
  /** Waiting players, first in line at index 0. */
  queue: number[]
  /** Checked-out players (on a break); not in the queue. */
  onBreak: number[]
  /**
   * Locks made while a partner was on a court or on a break. They change nothing until both have
   * finished a game, so a lock never moves anyone ahead of people who were waiting. Missing means none.
   */
  pendingPartners?: PendingPartners[]
  /**
   * The next group as staff chose it (see replaceNextUp), overriding the automatic pick while every
   * one of them is still waiting. Missing means automatic.
   */
  nextUpPick?: (number | null)[]
  /**
   * Whether players see the session on the club's public live page. A new session starts not live, so staff
   * can set it up first. Missing (a session from before this was chosen) means live.
   */
  live?: boolean
  /**
   * The skill levels this session uses (the club's when it was created, or changed since with setSkillScale). Players'
   * `skill` is their level on it. Missing: the default scale (sessions from before scales existed).
   */
  skillScale?: SkillScale
  /** Every game finished this session, oldest first. Missing in sessions saved before this was kept. */
  matches?: MatchRecord[]
  /**
   * ms since the epoch each currently-queued player most recently joined the queue. Missing per
   * player (or entirely) when their wait was never tracked.
   */
  queuedAt?: Record<number, number>
}
