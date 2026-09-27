import type { SkillLevel } from '@/db/db'
import { brokenLocks, pairNames } from '@/lib/partners'
import { levelLabel, sessionScale, skillLabel } from '@/lib/skill'
import { TEAM_NAMES } from '@/lib/teams'
import type { SessionState } from '@/rotation/types'
import type { SessionAction } from './actions'

export interface AuditText {
  /** The action's type, or a club event's name: what the log can be sorted and searched by. */
  kind: string
  /** What happened, as staff read it. */
  summary: string
}

/**
 * What one session action did, in words, for the audit log. Names come from the session before the change
 * (or after it, for someone the change brought in), so a player removed since is still named.
 */
export function describeAction(before: SessionState, action: SessionAction, after: SessionState): AuditText {
  const name = (id: number) => before.players[id]?.name ?? after.players[id]?.name ?? `Player ${id}`
  const names = (ids: readonly number[]) => ids.map(name).join(' & ')
  const court = (id: number) =>
    before.courts.find((c) => c.id === id)?.name ?? after.courts.find((c) => c.id === id)?.name ?? `Court ${id}`
  const lineUp = (teams: readonly (readonly number[])[]) => `${names(teams[0])} vs ${names(teams[1])}`
  const courtTeams = (id: number, state: SessionState) => state.courts.find((c) => c.id === id)?.teams ?? null
  // Any lock the change ended is named at the end of its line (an explicit unlock says so itself).
  const unlocked = action.type === 'unlockPartners' || action.type === 'restore' ? [] : brokenLocks(before, after)
  const say = (summary: string): AuditText => ({
    kind: action.type,
    summary: unlocked.length > 0 ? `${summary}. Unlocked ${pairNames(before, unlocked)}` : summary,
  })

  switch (action.type) {
    case 'setAvgGameMinutes':
      return say(`Set the game length to ${action.minutes} min`)
    case 'setLive':
      return say(action.live ? 'Went live: players can see the board' : 'Stopped live: the public page shows no game')
    case 'setPlayerSkill':
      return say(`Changed ${name(action.playerId)}'s level to ${skillLabel(sessionScale(before), action.skill)}`)
    case 'setSkillScale': {
      const labels = action.scale.levels.map((l) => l.label)
      return say(`Changed the skill levels to ${labels.length}: ${labels.join(', ')}`)
    }
    case 'renamePlayer':
      return say(`Renamed ${name(action.playerId)} to ${action.name.trim()}`)
    case 'checkIn': {
      const onBreak = new Set(before.onBreak.map((id) => before.players[id]?.name.toLowerCase()))
      const back = action.players.filter((p) => onBreak.has(p.name.trim().toLowerCase())).map((p) => p.name.trim())
      const fresh = action.players.filter((p) => !onBreak.has(p.name.trim().toLowerCase())).map((p) => p.name.trim())
      const parts = [
        ...(fresh.length > 0 ? [`Checked in ${fresh.join(', ')}`] : []),
        ...(back.length > 0 ? [`Back from a break: ${back.join(', ')}`] : []),
      ]
      return say(parts.join('. ') || 'Checked in nobody new')
    }
    case 'checkOut':
      return say(`${name(action.playerId)} took a break`)
    case 'removePlayer': {
      const was = before.courts.find((c) => c.teams?.flat().includes(action.playerId))
      return say(`Removed ${name(action.playerId)} from the session${was ? ` (off ${was.name}, spot left open)` : ''}`)
    }
    case 'recordResult':
    case 'recordScore': {
      const teams = courtTeams(action.courtId, before)
      const winner = action.type === 'recordResult' ? action.winner : action.scoreA > action.scoreB ? 0 : 1
      const score = action.type === 'recordScore' ? ` ${Math.max(action.scoreA, action.scoreB)}–${Math.min(action.scoreA, action.scoreB)}` : ''
      return say(`${court(action.courtId)}: ${TEAM_NAMES[winner]} won${score}${teams ? ` (${lineUp(teams)})` : ''}`)
    }
    case 'editMatch': {
      const match = before.matches?.[action.matchIndex]
      const where = match ? `${match.courtName}, game ${action.matchIndex + 1}` : `Game ${action.matchIndex + 1}`
      const changes = [
        ...(action.edit.score ? [`score ${action.edit.score[0]}–${action.edit.score[1]}`] : []),
        ...(action.edit.teams ? [`players ${lineUp(action.edit.teams)}`] : []),
      ]
      return say(`Corrected ${where}: ${changes.join(', ') || 'no change'}`)
    }
    case 'cancelMatch': {
      const was = before.courts.find((c) => c.id === action.courtId)
      if (was?.notStarted) return say(`${court(action.courtId)}: cleared the line-up`)
      return say(`${court(action.courtId)}: game cancelled${was?.teams ? ` (${lineUp(was.teams)})` : ''}`)
    }
    case 'startGame': {
      const teams = courtTeams(action.courtId, after)
      return say(`${court(action.courtId)}: started ${teams ? lineUp(teams) : 'a game'}`)
    }
    case 'addCourt':
      return say(`Added ${after.courts[after.courts.length - 1]?.name ?? 'a court'}`)
    case 'renameCourt':
      return say(`Renamed ${court(action.courtId)} to ${action.name.trim()}`)
    case 'setCourtLevels':
      return say(
        action.levels
          ? `${court(action.courtId)}: kept for ${levelLabel(sessionScale(before), action.levels as [SkillLevel, SkillLevel]) ?? 'some levels'}`
          : `${court(action.courtId)}: open to any level`,
      )
    case 'moveCourt':
      return say(`Moved ${court(action.courtId)} ${action.offset < 0 ? 'up' : 'down'}`)
    case 'closeCourt':
      return say(`Closed ${court(action.courtId)}`)
    case 'replacePlayer': {
      const inId = action.inId ?? cameIn(before, after, action.courtId)
      return say(`${court(action.courtId)}: ${inId === undefined ? 'someone' : name(inId)} in for ${name(action.outId)}`)
    }
    case 'replaceNextUp':
      return say(`Next up: ${name(action.inId)} in for ${name(action.outId)}`)
    case 'dropFromNextUp':
      return say(`Next up: took out ${name(action.playerId)}${action.onBreak ? ' (on a break)' : ''}`)
    case 'removeFromCourt':
      return say(
        `${court(action.courtId)}: took ${name(action.playerId)} off${action.onBreak ? ' (on a break)' : ''}, spot left open`,
      )
    case 'fillCourtSpot':
      return say(`${court(action.courtId)}: ${name(action.playerId)} into the open ${TEAM_NAMES[action.team]} spot`)
    case 'fillNextUpSpot':
      return say(`Next up: ${name(action.playerId)} into an open spot`)
    case 'resetNextUp':
      return say('Next up: back to automatic')
    case 'lockPartners': {
      const pair = `${name(action.a)} & ${name(action.b)}`
      const waiting = (after.pendingPartners ?? []).some(({ pair: p }) => p.includes(action.a) && p.includes(action.b))
      if (waiting) return say(`Locked ${pair} as partners, starting once both have played`)
      const held = !before.queue.includes(action.a) || !before.queue.includes(action.b)
      const sameGame = before.courts.some((c) => c.teams?.flat().includes(action.a) && c.teams.flat().includes(action.b))
      return say(action.lockNow && held && !sameGame ? `Locked ${pair} as partners now: they wait for each other` : `Locked ${pair} as partners`)
    }
    case 'unlockPartners': {
      const pair = [...before.partners, ...(before.pendingPartners ?? []).map((p) => p.pair)].find((p) =>
        p.includes(action.playerId),
      )
      return say(`Unlocked ${pair ? names(pair) : name(action.playerId)}`)
    }
    case 'restore':
      return say('Undid the last change')
    case 'startClock':
      if (!before.notStarted) return say('Started the session (it had already started)')
      return say('Started the session: waiting times run from now')
    case 'pause':
      if (before.clockStoppedAt !== undefined) return say('Paused the session (it was already paused)')
      return say(action.by?.reason === 'left' ? 'Paused the session on leaving it' : 'Paused the session')
    case 'resume':
      return say('Resumed the session')
  }
}

/** The player a swap put on the court when staff let the queue choose. */
function cameIn(before: SessionState, after: SessionState, courtId: number): number | undefined {
  const was = new Set(before.courts.find((c) => c.id === courtId)?.teams?.flat() ?? [])
  return after.courts.find((c) => c.id === courtId)?.teams?.flat().find((id) => !was.has(id))
}
