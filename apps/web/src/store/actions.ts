import { levelForRating, type AuditEntry, type SkillScale } from '@q2dink/shared'
import { sessionScale } from '@/lib/skill'
import type { SkillLevel } from '@/db/db'
import {
  addCourt,
  cancelMatch,
  checkIn,
  checkOut,
  closeCourt,
  dropFromNextUp,
  editMatch,
  fillCourtSpot,
  fillNextUpSpot,
  lockPartners,
  moveCourt,
  pauseSession,
  recordResult,
  recordScore,
  renameCourt,
  setCourtLevels,
  removeFromCourt,
  removePlayer,
  renamePlayer,
  replaceNextUp,
  replacePlayer,
  resetNextUp,
  resumeSession,
  sessionNow,
  setAvgGameMinutes,
  setLive,
  setPlayerSkill,
  setSkillScale,
  startGame,
  startSessionClock,
  unlockPartners,
  type MatchEdit,
  type NextGroupOptions,
  type ReplacePlayerOptions,
} from '@/rotation/engine'
import type { DeviceRef, PausedBy, RosterPlayer, SessionState } from '@/rotation/types'

/**
 * Who to check in: a saved player's details. Their id in the session is chosen when it is applied, and so is their
 * level: the one their rating falls in on the session's scale (older apps send only a level, which is kept).
 */
export type CheckInPlayer = Pick<RosterPlayer, 'name' | 'skill' | 'gender' | 'rating'>

/**
 * One change to a running session, as data, so it can be sent after the fact and applied again on the
 * club's copy when another staff device changed it in the meantime. `now` is when it was made here.
 */
export type SessionAction =
  | { type: 'setAvgGameMinutes'; minutes: number }
  | { type: 'setLive'; live: boolean }
  | { type: 'setPlayerSkill'; playerId: number; skill: SkillLevel }
  /** Use other skill levels for the session (the club's new ones); levels follow the players' ratings. */
  | { type: 'setSkillScale'; scale: SkillScale }
  | { type: 'renamePlayer'; playerId: number; name: string }
  | { type: 'checkIn'; players: CheckInPlayer[]; now: number }
  | { type: 'checkOut'; playerId: number }
  /** Take a player out of the session, from wherever they are (see removePlayer). */
  | { type: 'removePlayer'; playerId: number; now: number }
  | { type: 'recordResult'; courtId: number; winner: 0 | 1; now: number }
  | { type: 'recordScore'; courtId: number; scoreA: number; scoreB: number; now: number }
  | { type: 'editMatch'; matchIndex: number; edit: MatchEdit }
  | { type: 'cancelMatch'; courtId: number; now: number }
  | { type: 'startGame'; courtId: number; options?: NextGroupOptions; now: number }
  | { type: 'addCourt'; name?: string }
  | { type: 'renameCourt'; courtId: number; name: string }
  | { type: 'setCourtLevels'; courtId: number; levels: [number, number] | null }
  | { type: 'moveCourt'; courtId: number; offset: -1 | 1 }
  | { type: 'closeCourt'; courtId: number; now: number }
  | { type: 'replacePlayer'; courtId: number; outId: number; inId?: number; options?: ReplacePlayerOptions; now: number }
  | { type: 'replaceNextUp'; outId: number; inId: number; now?: number }
  | { type: 'dropFromNextUp'; playerId: number; onBreak: boolean }
  | { type: 'removeFromCourt'; courtId: number; playerId: number; onBreak: boolean; now: number }
  | { type: 'fillCourtSpot'; courtId: number; team: 0 | 1; slot?: number; playerId: number; now: number }
  | { type: 'fillNextUpSpot'; lane: number; slot: number; playerId: number; now: number }
  | { type: 'resetNextUp' }
  | { type: 'lockPartners'; a: number; b: number }
  | { type: 'unlockPartners'; playerId: number }
  /** Start a session that was set up without starting: its clock runs from `now`. */
  | { type: 'startClock'; now: number; by?: DeviceRef }
  /** Stop the session clock (a no-op when it is already stopped). */
  | { type: 'pause'; now: number; by?: PausedBy }
  | { type: 'resume'; now: number; by?: DeviceRef }
  /** Undo: back to `before`, but only from exactly `after`; after anyone else's change it no longer applies. */
  | { type: 'restore'; before: SessionState; after: SessionState }

/** What applying an action did: the new session, and the session ids a check-in used, in order. */
export interface Applied {
  session: SessionState
  ids?: number[]
}

/**
 * A player's id in this session. Someone already in it under the same name (ignoring case) keeps their
 * id; anyone new gets the next free number. Ids are the session's own, the same on every staff device,
 * never a device's saved-player id.
 */
export function sessionIdFor(session: SessionState, name: string): number {
  const key = name.trim().toLowerCase()
  const known = Object.values(session.players).find((p) => p.name.trim().toLowerCase() === key)
  if (known) return known.id
  const ids = Object.keys(session.players).map(Number)
  return ids.length === 0 ? 1 : Math.max(...ids) + 1
}

const same = (a: SessionState, b: SessionState) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Apply one action with the same engine rules as ever. Throws, like the engine, when it no longer
 * makes sense (a court already finished, a player no longer waiting).
 */
export function applyAction(session: SessionState, action: SessionAction): Applied {
  switch (action.type) {
    case 'startClock':
      return { session: startSessionClock(session, action.now, action.by) }
    case 'pause':
      return { session: pauseSession(session, action.now, action.by) }
    case 'resume':
      return { session: resumeSession(session, action.now, action.by) }
    default:
      // While the clock stands still, whatever happens is recorded at the moment it stopped.
      return applyChange(session, 'now' in action && action.now !== undefined ? { ...action, now: sessionNow(session, action.now) } : action)
  }
}

function applyChange(session: SessionState, action: SessionAction): Applied {
  switch (action.type) {
    case 'startClock':
    case 'pause':
    case 'resume':
      return applyAction(session, action)
    case 'setAvgGameMinutes':
      return { session: setAvgGameMinutes(session, action.minutes) }
    case 'setLive':
      return { session: setLive(session, action.live) }
    case 'setPlayerSkill':
      return { session: setPlayerSkill(session, action.playerId, action.skill) }
    case 'setSkillScale':
      return { session: setSkillScale(session, action.scale) }
    case 'renamePlayer':
      return { session: renamePlayer(session, action.playerId, action.name) }
    case 'checkIn': {
      let next = session
      const ids: number[] = []
      for (const player of action.players) {
        const id = sessionIdFor(next, player.name)
        ids.push(id)
        const skill = player.rating === undefined ? player.skill : levelForRating(sessionScale(next), player.rating)
        const rating = player.rating === undefined ? {} : { rating: player.rating }
        next = checkIn(next, { id, name: player.name.trim(), skill, ...rating, gender: player.gender }, action.now)
      }
      return { session: next, ids }
    }
    case 'checkOut':
      return { session: checkOut(session, action.playerId) }
    case 'removePlayer':
      return { session: removePlayer(session, action.playerId, action.now) }
    case 'recordResult':
      return { session: recordResult(session, action.courtId, action.winner, { now: action.now }).state }
    case 'recordScore':
      return { session: recordScore(session, action.courtId, action.scoreA, action.scoreB, { now: action.now }).state }
    case 'editMatch':
      return { session: editMatch(session, action.matchIndex, action.edit) }
    case 'cancelMatch':
      return { session: cancelMatch(session, action.courtId, action.now) }
    case 'startGame':
      return { session: startGame(session, action.courtId, { ...action.options, now: action.now }) }
    case 'addCourt':
      return { session: addCourt(session, action.name) }
    case 'renameCourt':
      return { session: renameCourt(session, action.courtId, action.name) }
    case 'setCourtLevels':
      return { session: setCourtLevels(session, action.courtId, action.levels) }
    case 'moveCourt':
      return { session: moveCourt(session, action.courtId, action.offset) }
    case 'closeCourt':
      return { session: closeCourt(session, action.courtId, action.now) }
    case 'replacePlayer':
      return {
        session: replacePlayer(session, action.courtId, action.outId, action.inId, { ...action.options, now: action.now }),
      }
    case 'replaceNextUp':
      return { session: replaceNextUp(session, action.outId, action.inId, action.now) }
    case 'dropFromNextUp':
      return { session: dropFromNextUp(session, action.playerId, { onBreak: action.onBreak }) }
    case 'removeFromCourt':
      return {
        session: removeFromCourt(session, action.courtId, action.playerId, { onBreak: action.onBreak, now: action.now }),
      }
    case 'fillCourtSpot':
      return { session: fillCourtSpot(session, action.courtId, action.team, action.playerId, action.now, action.slot) }
    case 'fillNextUpSpot':
      return { session: fillNextUpSpot(session, action.lane, action.slot, action.playerId, action.now) }
    case 'resetNextUp':
      return { session: resetNextUp(session) }
    case 'lockPartners':
      return { session: lockPartners(session, action.a, action.b) }
    case 'unlockPartners':
      return { session: unlockPartners(session, action.playerId) }
    case 'restore':
      if (!same(session, action.after)) throw new Error('The session changed on another device since then')
      return { session: action.before }
  }
}

/** An action this device made that the club has not taken yet, with the ids its check-in used here. */
export interface PendingAction {
  action: SessionAction
  ids?: number[]
  /** Its audit log entry, sent once the club has taken the change (never for one it did not take). */
  audit?: AuditEntry
}

const mapId = (map: Map<number, number>, id: number) => map.get(id) ?? id

/** The same action with its player ids renumbered (a check-in replayed on the club's copy got new ones). */
export function remapAction(action: SessionAction, map: Map<number, number>): SessionAction {
  if (map.size === 0) return action
  switch (action.type) {
    case 'setPlayerSkill':
    case 'renamePlayer':
    case 'checkOut':
    case 'removePlayer':
    case 'unlockPartners':
    case 'dropFromNextUp':
    case 'removeFromCourt':
    case 'fillCourtSpot':
    case 'fillNextUpSpot':
      return { ...action, playerId: mapId(map, action.playerId) }
    case 'replacePlayer':
      return {
        ...action,
        outId: mapId(map, action.outId),
        ...(action.inId !== undefined ? { inId: mapId(map, action.inId) } : {}),
      }
    case 'replaceNextUp':
      return { ...action, outId: mapId(map, action.outId), inId: mapId(map, action.inId) }
    case 'lockPartners':
      return { ...action, a: mapId(map, action.a), b: mapId(map, action.b) }
    case 'editMatch':
      return action.edit.teams
        ? {
            ...action,
            edit: {
              ...action.edit,
              teams: [action.edit.teams[0].map((id) => mapId(map, id)), action.edit.teams[1].map((id) => mapId(map, id))],
            },
          }
        : action
    default:
      return action
  }
}

/** What happened to this device's own changes when they were applied again on the club's copy. */
export interface Rebased {
  session: SessionState
  pending: PendingAction[]
  /** The changes that no longer applied (another device got there first), and why. */
  dropped: { action: SessionAction; reason: string; audit?: AuditEntry }[]
}

/**
 * Apply this device's unsent changes again on top of the club's newer copy. Changes that no longer
 * make sense are dropped and reported; a check-in that gets different ids here renumbers the changes
 * after it that name those players.
 */
export function rebase(base: SessionState, pending: PendingAction[]): Rebased {
  let session = base
  const kept: PendingAction[] = []
  const dropped: Rebased['dropped'] = []
  const map = new Map<number, number>()
  for (const entry of pending) {
    const action = remapAction(entry.action, map)
    try {
      const applied = applyAction(session, action)
      if (entry.ids && applied.ids) {
        entry.ids.forEach((old, i) => {
          const now = applied.ids![i]
          if (now !== undefined && now !== old) map.set(old, now)
        })
      }
      session = applied.session
      kept.push({ action, ...(applied.ids ? { ids: applied.ids } : {}), ...(entry.audit ? { audit: entry.audit } : {}) })
    } catch (error) {
      dropped.push({
        action,
        reason: error instanceof Error ? error.message : String(error),
        ...(entry.audit ? { audit: entry.audit } : {}),
      })
    }
  }
  return { session, pending: kept, dropped }
}
