import { describe, expect, it } from 'vitest'
import { checkIn, createSession, lockPartners, recordScore, startGame } from '@/rotation/engine'
import { fillCourts } from '@/rotation/testing'
import type { MatchmakingMode, RosterPlayer, SessionState, Teams } from '@/rotation/types'
import { LOOKAHEAD_UNITS, RECENT_MATCHES, pairHistory, repeatPenalty, selectGroup, splitGroup } from './grouping'

type Spec = [skill: RosterPlayer['skill'], gender?: 'M' | 'F']

/** Session with players 1..n checked in (queued, no court assigned), in order. */
function queued(matchmaking: MatchmakingMode, specs: Spec[]): SessionState {
  let s = createSession('doubles', 1, { matchmaking })
  specs.forEach(([skill, gender], i) => {
    s = checkIn(s, { id: i + 1, name: `P${i + 1}`, skill, gender })
  })
  return s
}

const group = (s: SessionState) => selectGroup(s, s.queue)
const sorted = (ids: number[] | null) => ids?.slice().sort((a, b) => a - b)
const side = (ids: number[]) => ids.slice().sort((a, b) => a - b).join(',')
const teamKeys = (teams: number[][]) => teams.map(side).sort()

describe('splitGroup', () => {
  it('balances teams by total skill', () => {
    const s = queued('balanced', [[6], [5], [2], [1]])
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,4', '2,3'])
  })

  it('keeps a locked pair together even when that is unbalanced', () => {
    const s = lockPartners(queued('balanced', [[6], [5], [2], [1]]), 1, 2)
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,2', '3,4'])
  })

  it('puts two locked pairs against each other', () => {
    let s = queued('balanced', [[6], [5], [2], [1]])
    s = lockPartners(lockPartners(s, 1, 4), 2, 3)
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,4', '2,3'])
  })

  it('gives each team one man and one woman in mixed doubles, then balances skill', () => {
    // Men 1 (Lv6) and 2 (Lv5); women 3 (Lv2) and 4 (Lv1).
    const s = queued('mixed', [[6, 'M'], [5, 'M'], [2, 'F'], [1, 'F']])
    // 1+4 vs 2+3 (7 vs 7) beats 1+3 vs 2+4 (8 vs 6).
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,4', '2,3'])
  })
})

describe('selectGroup: auto-balanced', () => {
  it('takes the first four in the queue', () => {
    const s = queued('balanced', [[3], [3], [3], [3], [3], [3]])
    expect(group(s)).toEqual([1, 2, 3, 4])
  })

  it('returns null until four players can be seated', () => {
    expect(group(queued('balanced', [[3], [3], [3]]))).toBeNull()
  })

  it('pulls a locked partner forward to sit with their partner', () => {
    // 3 and 5 are locked: they enter together, leaving 4 waiting.
    const s = lockPartners(queued('balanced', [[3], [3], [3], [3], [3]]), 3, 5)
    expect(sorted(group(s))).toEqual([1, 2, 3, 5])
  })

  it('keeps a locked pair as the anchor when they are first in line', () => {
    const s = lockPartners(queued('balanced', [[3], [3], [3], [3], [3]]), 1, 2)
    expect(sorted(group(s))).toEqual([1, 2, 3, 4])
  })

  it('skips an anchor that cannot be completed without splitting a pair', () => {
    // Queue: solo 1, pair (2,3), pair (4,5). Player 1 needs three more, which the pairs cannot supply.
    let s = queued('balanced', [[3], [3], [3], [3], [3]])
    s = lockPartners(lockPartners(s, 2, 3), 4, 5)
    expect(sorted(group(s))).toEqual([2, 3, 4, 5])
  })

  it('never picks a player whose partner is not waiting: they hold for them', () => {
    let s = queued('balanced', [[3], [3], [3], [3], [3], [3]])
    s = lockPartners(s, 1, 6)
    // Partner 6 is on a break, so player 1 waits for them rather than playing alone.
    s = { ...s, queue: [1, 2, 3, 4, 5], onBreak: [6] }
    expect(group(s)).toEqual([2, 3, 4, 5])
    s = { ...s, queue: [1, 2, 3, 4], onBreak: [5, 6] }
    expect(group(s)).toBeNull()
  })
})

describe('selectGroup: skill-separated', () => {
  it('groups the anchor with the closest skill levels behind them', () => {
    const s = queued('skill', [[1], [6], [1], [6], [1], [6], [1]])
    expect(sorted(group(s))).toEqual([1, 3, 5, 7])
  })

  it('only looks a limited distance behind the anchor', () => {
    // Every player in the window is Lv6 except the anchor; the other Lv1 is far beyond the look-ahead.
    const specs: Spec[] = [[1], ...Array.from({ length: LOOKAHEAD_UNITS + 2 }, () => [6] as Spec), [1]]
    const s = queued('skill', specs)
    expect(group(s)).toEqual([1, 2, 3, 4])
  })
})

describe('selectGroup: winners vs. losers', () => {
  it('seats winners with winners and losers with losers', () => {
    const s = {
      ...queued('winners', Array.from({ length: 8 }, () => [3] as Spec)),
      lastResult: { 1: 'W', 2: 'W', 3: 'L', 4: 'L', 5: 'W', 6: 'W', 7: 'L', 8: 'L' },
    } as SessionState
    expect(sorted(group(s))).toEqual([1, 2, 5, 6])
  })

  it('treats players with no result yet as neutral', () => {
    const s = {
      ...queued('winners', Array.from({ length: 5 }, () => [3] as Spec)),
      lastResult: { 1: 'W', 2: 'L', 3: 'W' },
    } as SessionState
    // Anchor 1 (W): {1,3,4,5} has no W/L mix, {1,2,...} would.
    expect(sorted(group(s))).toEqual([1, 3, 4, 5])
  })
})

describe('selectGroup: mixed doubles', () => {
  it('finds two men and two women, skipping an extra man', () => {
    const s = queued('mixed', [[3, 'M'], [3, 'M'], [3, 'M'], [3, 'F'], [3, 'F']])
    expect(sorted(group(s))).toEqual([1, 2, 4, 5])
  })

  it('never stages a non-mixed group on its own', () => {
    const s = queued('mixed', [[3, 'M'], [3, 'M'], [3, 'M'], [3, 'M']])
    expect(group(s)).toBeNull()
  })

  it('can still be started by hand, ignoring the mode', () => {
    const s = queued('mixed', [[3, 'M'], [3, 'M'], [3, 'M'], [3, 'M']])
    expect(selectGroup(s, s.queue, { ignoreMode: true })).toEqual([1, 2, 3, 4])
  })

  it('rejects a same-gender locked pair as a mixed group', () => {
    let s = queued('mixed', [[3, 'M'], [3, 'M'], [3, 'F'], [3, 'F']])
    s = lockPartners(s, 1, 2)
    expect(group(s)).toBeNull()
    // Started by hand, the pair still shares a team.
    const chosen = selectGroup(s, s.queue, { ignoreMode: true })!
    expect(teamKeys(splitGroup(s, chosen))).toEqual(['1,2', '3,4'])
  })

  it('searches beyond the usual look-ahead for a valid mixed group', () => {
    // Eight men wait ahead of the only two women, but a mixed game is still possible.
    const specs: Spec[] = [...Array.from({ length: 8 }, () => [3, 'M'] as Spec), [3, 'F'], [3, 'F']]
    const s = queued('mixed', specs)
    expect(sorted(group(s))).toEqual([1, 2, 9, 10])
  })

  it('accepts a locked mixed couple', () => {
    let s = queued('mixed', [[3, 'M'], [3, 'F'], [3, 'M'], [3, 'F']])
    s = lockPartners(s, 1, 2)
    const teams = splitGroup(s, group(s)!)
    expect(teamKeys(teams)).toEqual(['1,2', '3,4'])
  })
})

describe('starting games with modes', () => {
  it('fills two courts with different groups in one pass', () => {
    let s = createSession('doubles', 2, { matchmaking: 'skill' })
    ;([[1], [1], [6], [6], [1], [1], [6], [6]] as Spec[]).forEach(([skill], i) => {
      s = checkIn(s, { id: i + 1, name: `P${i + 1}`, skill })
    })
    s = fillCourts(s)
    const courts = s.courts.map((c) => side(c.teams!.flat()))
    expect(courts).toEqual(['1,2,5,6', '3,4,7,8'])
    expect(s.queue).toEqual([])
  })

  it('leaves a court empty rather than splitting a locked pair', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 3; id++) s = checkIn(s, { id, name: `P${id}`, skill: 3 })
    s = lockPartners(s, 1, 2)
    s = fillCourts(s)
    // Only three players wait, so nothing can be staged yet.
    expect(s.courts[0].teams).toBeNull()
  })
})

/** The same session, after a finished game between these teams (most recent last). */
const played = (state: SessionState, teams: Teams): SessionState => ({
  ...state,
  matches: [...(state.matches ?? []), { courtName: 'Court 1', teams, winner: 0, seconds: 0 }],
})

describe('pair history', () => {
  it('counts who was partners and who was opponents in the recent games', () => {
    const s = played(played(queued('balanced', [[3], [3], [3], [3]]), [[1, 2], [3, 4]]), [[1, 3], [2, 4]])
    const history = pairHistory(s)
    expect(history.partners.get('1,2')).toBe(1)
    expect(history.partners.get('1,3')).toBe(1)
    expect(history.opponents.get('1,3')).toBe(1) // opponents in the first game, partners in the second
    expect(history.opponents.get('1,2')).toBe(1)
    expect(history.partners.get('1,4')).toBeUndefined()
  })

  it('rates a partnership as more stale than an opposition, and a fresh group as free', () => {
    const s = played(queued('balanced', [[3], [3], [3], [3], [3]]), [[1, 2], [3, 4]])
    const history = pairHistory(s)
    expect(repeatPenalty(history, [1, 2])).toBeGreaterThan(repeatPenalty(history, [1, 3]))
    expect(repeatPenalty(history, [1, 5])).toBe(0)
    expect(repeatPenalty(pairHistory(queued('balanced', [[3], [3]])), [1, 2])).toBe(0)
  })

  it('only remembers the most recent games', () => {
    let s = played(queued('balanced', [[3], [3], [3], [3]]), [[1, 2], [3, 4]])
    for (let i = 0; i < RECENT_MATCHES; i++) s = played(s, [[1, 3], [2, 4]])
    expect(pairHistory(s).partners.get('1,2')).toBeUndefined()
    expect(pairHistory(s).partners.get('1,3')).toBe(RECENT_MATCHES)
  })
})

describe('splitGroup: rotating partners', () => {
  const equal = () => queued('balanced', [[3], [3], [3], [3]])

  it('does not pair last game\'s partners again when nothing else separates the splits', () => {
    const s = played(equal(), [[1, 2], [3, 4]])
    const keys = teamKeys(splitGroup(s, [1, 2, 3, 4]))
    expect(keys).not.toContain('1,2')
    expect(keys).not.toContain('3,4')
  })

  it('pairs everyone with everyone once over three games with four players', () => {
    let s = equal()
    const seen: string[] = []
    for (let game = 0; game < 3; game++) {
      s = startGame(s, 1)
      const teams = s.courts[0].teams!
      seen.push(...teams.map(side))
      s = recordScore(s, 1, 11, 5).state
    }
    expect(new Set(seen).size).toBe(6)
  })

  it('goes on to rotate opponents when the partners are equally fresh', () => {
    // 1 and 3 have only met as opponents, so putting them on opposite sides again is the stale choice.
    const s = played(equal(), [[1], [3]])
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,3', '2,4'])
  })

  it('is exactly the most balanced split when there is no history', () => {
    const s = queued('balanced', [[6], [5], [2], [1]])
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,4', '2,3'])
  })

  it('takes a fresh split that is only slightly less balanced', () => {
    // 1+4 vs 2+3 is 7 against 7; 1+3 vs 2+4 is 8 against 6, which is close enough to be worth the change.
    const s = played(queued('balanced', [[6], [5], [2], [1]]), [[1, 4], [2, 3]])
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,3', '2,4'])
  })

  it('never takes a clearly lopsided split just because it is fresh', () => {
    // Levels 6, 6, 1, 1: both balanced splits have partnered before; 1+2 vs 3+4 would be 12 against 2.
    let s = queued('balanced', [[6], [6], [1], [1]])
    s = played(played(s, [[1, 3], [2, 4]]), [[1, 4], [2, 3]])
    const keys = teamKeys(splitGroup(s, [1, 2, 3, 4]))
    expect(keys).not.toContain('1,2')
  })

  it('keeps a locked pair together whatever the history says', () => {
    let s = lockPartners(equal(), 1, 2)
    for (let i = 0; i < 3; i++) s = played(s, [[1, 2], [3, 4]])
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,2', '3,4'])
  })

  it('alternates between the two mixed splits in mixed doubles', () => {
    const s = played(queued('mixed', [[3, 'M'], [3, 'M'], [3, 'F'], [3, 'F']]), [[1, 3], [2, 4]])
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,4', '2,3'])
  })

  it('forgets games older than the recent ones', () => {
    let s = played(equal(), [[1, 2], [3, 4]])
    for (let i = 0; i < RECENT_MATCHES; i++) s = played(s, [[1, 3], [2, 4]])
    // 1+2 vs 3+4 is fresh again; 1+3 vs 2+4 is not.
    expect(teamKeys(splitGroup(s, [1, 2, 3, 4]))).toEqual(['1,2', '3,4'])
  })
})

describe('selectGroup: a group that just played together counts as further back in the queue', () => {
  // 1 to 4 played each other (1+2 beat 3+4) and 5 arrived afterwards, so the queue is 1, 2, 3, 4, 5.
  const afterGame = (mode: MatchmakingMode, queueOrder = [1, 2, 3, 4, 5]) => {
    const base = queued(mode, [[3, 'M'], [3, 'F'], [3, 'M'], [3, 'F'], [3, 'F']])
    const s = played(base, [[1, 2], [3, 4]])
    return {
      ...s,
      queue: queueOrder,
      lastResult: { 1: 'W', 2: 'W', 3: 'L', 4: 'L' },
    } as SessionState
  }

  for (const mode of ['balanced', 'skill', 'winners', 'mixed'] as const) {
    it(`${mode}: brings in the person waiting instead of staging the same four again`, () => {
      const s = afterGame(mode)
      expect(sorted(selectGroup(s, s.queue))).toEqual([1, 2, 3, 5])
    })

    it(`${mode}: still stages the same four when nobody else is waiting`, () => {
      const s = afterGame(mode, [1, 2, 3, 4])
      expect(sorted(selectGroup(s, s.queue))).toEqual([1, 2, 3, 4])
    })
  }

  it('changes nothing for a session with no finished games', () => {
    const s = queued('balanced', [[3], [3], [3], [3], [3]])
    expect(sorted(group(s))).toEqual([1, 2, 3, 4])
  })

  it('never pulls in someone far down the line to avoid a repeat', () => {
    const base = queued('balanced', Array.from({ length: 14 }, () => [3] as Spec))
    const s = played(base, [[1, 2], [3, 4]])
    const chosen = selectGroup(s, s.queue)!
    expect(chosen).toContain(1)
    // Nobody beyond the sixth place gets in ahead of people who have waited longer.
    expect(Math.max(...chosen)).toBeLessThanOrEqual(6)
  })

  it('winners vs. losers still seats winners with winners, and only then prefers fresh faces', () => {
    const base = queued('winners', Array.from({ length: 9 }, () => [3] as Spec))
    const s = {
      ...played(base, [[1, 2], [3, 4]]),
      lastResult: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, 'W'])),
    } as SessionState
    const chosen = selectGroup(s, s.queue)!
    expect(chosen).toContain(1)
    expect(sorted(chosen)).not.toEqual([1, 2, 3, 4])
  })
})

describe('sessions played through: the same four do not keep the same partners', () => {
  const players = (mode: MatchmakingMode, count: number, courts: number) => {
    let s = createSession('doubles', courts, { matchmaking: mode })
    for (let id = 1; id <= count; id++) s = checkIn(s, { id, name: `P${id}`, skill: 3, gender: id % 2 ? 'M' : 'F' })
    return s
  }

  for (const mode of ['balanced', 'skill', 'winners', 'mixed'] as const) {
    for (const [count, courts] of [[4, 1], [5, 1], [6, 1], [8, 2], [9, 2], [10, 2]] as const) {
      it(`${mode}, ${count} players on ${courts} court${courts > 1 ? 's' : ''}: the same four never meet again with the same teams straight after`, () => {
        let s = players(mode, count, courts)
        const games: { four: string; teams: string[] }[] = []
        let clock = 0
        for (let round = 0; round < 10; round++) {
          for (const court of s.courts) {
            if (court.teams) continue
            try {
              s = startGame(s, court.id)
            } catch {
              // Not enough valid players waiting for this court.
            }
          }
          for (const court of s.courts) {
            const teams = s.courts.find((c) => c.id === court.id)!.teams
            if (!teams) continue
            games.push({ four: side(teams.flat()), teams: teams.map(side).sort() })
            const teamAWins = (round + court.id) % 2 === 0
            s = recordScore(s, court.id, teamAWins ? 11 : 5, teamAWins ? 5 : 11, { now: ++clock }).state
          }
        }
        expect(games.length).toBeGreaterThan(count > 4 ? 5 : 3)
        games.forEach((game, i) => {
          if (i === 0) return
          // The same four in the previous round (one game per court): they must not get the same teams.
          const before = games.slice(Math.max(0, i - courts), i).reverse().find((g) => g.four === game.four)
          if (before) expect(game.teams, `game ${i + 1}`).not.toEqual(before.teams)
        })
      })
    }
  }
})
