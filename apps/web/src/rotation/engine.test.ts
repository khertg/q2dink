import { describe, expect, it } from 'vitest'
import {
  activeIds,
  addCourt,
  hasPlayed,
  cancelMatch,
  checkIn,
  checkOut,
  closeCourt,
  courtSlots,
  createSession,
  dropFromNextUp,
  defaultCourtName,
  editMatch,
  fillCourtSpot,
  fillNextUpSpot,
  heldPlayers,
  isShort,
  estimateWaitMinutes,
  lockPartners,
  lockStatus,
  MAX_COURTS,
  MAX_GAME_SECONDS,
  MAX_SCORE,
  moveCourt,
  nextGroup,
  nextGroups,
  nextUpSpots,
  nextUpStandIn,
  recordResult,
  recordScore,
  removeFromCourt,
  removePlayer,
  renameCourt,
  replaceNextUp,
  replacePlayer,
  resetNextUp,
  isNextUpPicked,
  scoreProblem,
  winnerScoreProblem,
  setAvgGameMinutes,
  setPlayerSkill,
  setCourtLevels,
  setSkillScale,
  lastActivityAt,
  shiftSessionClock,
  isLive,
  setLive,
  startGame,
  unlockPartners,
} from './engine'
import { waitingMessage } from '../lib/nextUp'
import { rankPlayers } from './standings'
import { fillCourts } from './testing'
import type { RosterPlayer, SessionState } from './types'

const player = (id: number, skill: RosterPlayer['skill'] = 3): RosterPlayer => ({
  id,
  name: `P${id}`,
  skill,
})

function withPlayers(state: SessionState, count: number): SessionState {
  let s = state
  for (let id = 1; id <= count; id++) s = checkIn(s, player(id))
  return s
}

describe('createSession', () => {
  it('rejects court counts outside 1-15', () => {
    expect(() => createSession('doubles', 0)).toThrow(RangeError)
    expect(() => createSession('doubles', 16)).toThrow(RangeError)
  })
})

describe('game length', () => {
  it('defaults to 12 minutes and accepts a custom length', () => {
    expect(createSession('doubles', 1).avgGameMinutes).toBe(12)
    expect(createSession('doubles', 1, { avgGameMinutes: 20 }).avgGameMinutes).toBe(20)
  })

  it('rejects lengths outside 5-60 or non-integers', () => {
    expect(() => createSession('doubles', 1, { avgGameMinutes: 4 })).toThrow(RangeError)
    expect(() => createSession('doubles', 1, { avgGameMinutes: 61 })).toThrow(RangeError)
    expect(() => setAvgGameMinutes(createSession('doubles', 1), 7.5)).toThrow(RangeError)
  })

  it('changes the wait estimate without mutating the old state', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 5))
    const slower = setAvgGameMinutes(s, 24)
    expect(estimateWaitMinutes(s, 5, s.avgGameMinutes)).toBe(12)
    expect(estimateWaitMinutes(slower, 5, slower.avgGameMinutes)).toBe(24)
    expect(s.avgGameMinutes).toBe(12)
  })
})

describe('checkIn / checkOut', () => {
  it('queues players in arrival order and ignores duplicates', () => {
    let s = createSession('doubles', 1)
    s = checkIn(s, player(1))
    s = checkIn(s, player(2))
    s = checkIn(s, player(1))
    expect(s.queue).toEqual([1, 2])
  })

  it('sends a returning player to the back of the queue', () => {
    let s = withPlayers(createSession('doubles', 1), 3)
    s = checkOut(s, 1)
    expect(s.onBreak).toEqual([1])
    s = checkIn(s, player(1))
    expect(s.queue).toEqual([2, 3, 1])
    expect(s.onBreak).toEqual([])
  })

  it('refuses to check out a player who is on a court', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 4))
    expect(() => checkOut(s, 1)).toThrow()
  })
})

describe('nothing starts by itself', () => {
  it('keeps every court open while people check in', () => {
    const s = withPlayers(createSession('doubles', 2), 8)
    expect(s.courts.every((c) => c.teams === null)).toBe(true)
    expect(s.queue).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('leaves the court open after a result', () => {
    const s = recordResult(fillCourts(withPlayers(createSession('doubles', 1), 8)), 1, 0).state
    expect(s.courts[0].teams).toBeNull()
    expect(s.queue).toHaveLength(8)
  })
})

describe('nextGroup', () => {
  it('is the first four waiting players, split into two teams', () => {
    const group = nextGroup(withPlayers(createSession('doubles', 2), 6))!
    expect(group.players.slice().sort()).toEqual([1, 2, 3, 4])
    expect(group.teams.flat()).toEqual(group.players)
    expect(group.teams.map((t) => t.length)).toEqual([2, 2])
  })

  it('balances doubles teams by skill', () => {
    let s = createSession('doubles', 1)
    for (const [id, skill] of [[1, 6], [2, 5], [3, 2], [4, 1]] as const) {
      s = checkIn(s, player(id, skill))
    }
    const [a, b] = nextGroup(s)!.teams
    const key = (t: number[]) => t.slice().sort().join()
    expect([key(a), key(b)].sort()).toEqual(['1,4', '2,3'])
  })

  it('is the first two players in singles', () => {
    const group = nextGroup(withPlayers(createSession('singles', 2), 5))!
    expect(group.teams).toEqual([[1], [2]])
    expect(group.players).toEqual([1, 2])
  })

  it('is null when too few players wait', () => {
    expect(nextGroup(withPlayers(createSession('doubles', 1), 3))).toBeNull()
    expect(nextGroup(withPlayers(createSession('singles', 1), 1))).toBeNull()
    expect(nextGroup(createSession('doubles', 1))).toBeNull()
  })

  it('does not depend on a court being open', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 8))
    expect(nextGroup(s)!.players.slice().sort()).toEqual([5, 6, 7, 8])
  })

  it('skips players on a break', () => {
    const s = checkOut(withPlayers(createSession('doubles', 1), 5), 1)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([2, 3, 4, 5])
  })

  it('keeps a locked pair together on one team', () => {
    const s = lockPartners(withPlayers(createSession('doubles', 1), 8), 1, 4)
    const { teams } = nextGroup(s)!
    expect(teams.some((t) => t.includes(1) && t.includes(4))).toBe(true)
  })

  it('does not change the state it was given', () => {
    const s = withPlayers(createSession('doubles', 1), 6)
    const snapshot = structuredClone(s)
    nextGroup(s)
    expect(s).toEqual(snapshot)
  })
})

describe('startGame', () => {
  it('stages exactly the previewed teams and removes those players from the queue', () => {
    const s = withPlayers(createSession('doubles', 2), 6)
    const preview = nextGroup(s)!
    const started = startGame(s, 1)
    expect(started.courts[0].teams).toEqual(preview.teams)
    expect(started.courts[1].teams).toBeNull()
    expect(started.queue).toEqual([5, 6])
  })

  it('starts the chosen court, not the first open one', () => {
    const s = startGame(withPlayers(createSession('doubles', 2), 4), 2)
    expect(s.courts[0].teams).toBeNull()
    expect(s.courts[1].teams!.flat().sort()).toEqual([1, 2, 3, 4])
  })

  it('moves next up on to the following group', () => {
    const s = startGame(withPlayers(createSession('doubles', 2), 8), 1)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([5, 6, 7, 8])
  })

  it('pairs two players in singles', () => {
    const s = startGame(withPlayers(createSession('singles', 1), 3), 1)
    expect(s.courts[0].teams).toEqual([[1], [2]])
    expect(s.queue).toEqual([3])
  })

  it('refuses a busy court, an unknown court and too few players', () => {
    const busy = startGame(withPlayers(createSession('doubles', 2), 8), 1)
    expect(() => startGame(busy, 1)).toThrow('already has a game in progress')
    expect(() => startGame(busy, 9)).toThrow()
    expect(() => startGame(withPlayers(createSession('doubles', 1), 3), 1)).toThrow(
      'Not enough players',
    )
  })

  it('never changes the state it was given', () => {
    const s = withPlayers(createSession('doubles', 1), 5)
    const snapshot = structuredClone(s)
    startGame(s, 1)
    expect(s).toEqual(snapshot)
  })
})

describe('recordResult', () => {
  it('frees the court and requeues winners then losers behind waiting players', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 6))
    const { state, winners, losers } = recordResult(s, 1, 0)
    expect(state.courts[0].teams).toBeNull()
    expect(state.queue).toEqual([5, 6, ...winners, ...losers])
    expect(winners).toHaveLength(2)
    expect(losers).toHaveLength(2)
  })

  it('does not mutate the previous state (undo-safe)', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 4))
    const snapshot = structuredClone(s)
    recordResult(s, 1, 1)
    expect(s).toEqual(snapshot)
  })

  it('throws for an empty court', () => {
    expect(() => recordResult(createSession('doubles', 1), 1, 0)).toThrow()
  })

  it('rotates the next waiting group onto the court', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 1), 8))
    expect(s.courts[0].teams!.flat().sort()).toEqual([1, 2, 3, 4])
    s = fillCourts(recordResult(s, 1, 0).state)
    expect(s.courts[0].teams!.flat().sort()).toEqual([5, 6, 7, 8])
  })
})

describe('recordScore', () => {
  /** Four players on court 1 (waiting: 5), started at T0. */
  const T0 = 1_000_000
  const started = () => startGame(withPlayers(createSession('doubles', 1), 5), 1, { now: T0 })

  it('lets the higher score win, whichever side it is', () => {
    const s = started()
    const [a, b] = s.courts[0].teams!
    const aWins = recordScore(s, 1, 11, 7)
    expect(aWins.winners).toEqual(a)
    expect(aWins.losers).toEqual(b)
    const bWins = recordScore(s, 1, 4, 11)
    expect(bWins.winners).toEqual(b)
    expect(bWins.losers).toEqual(a)
  })

  it('frees the court and requeues players exactly like recordResult', () => {
    const s = started()
    const scored = recordScore(s, 1, 11, 7, { now: T0 + 60_000 })
    const plain = recordResult(s, 1, 0, { now: T0 + 60_000 })
    expect(scored.state.courts).toEqual(plain.state.courts)
    expect(scored.state.queue).toEqual(plain.state.queue)
    expect(scored.state.lastResult).toEqual(plain.state.lastResult)
    expect(scored.state.courts[0].teams).toBeNull()
  })

  it('adds points for and against to every member of each team, and counts a scored game', () => {
    const s = started()
    const [a, b] = s.courts[0].teams!
    const { state } = recordScore(s, 1, 11, 7)
    for (const id of a) {
      expect(state.stats[id]).toMatchObject({ games: 1, wins: 1, pointsFor: 11, pointsAgainst: 7, scoredGames: 1 })
    }
    for (const id of b) {
      expect(state.stats[id]).toMatchObject({ games: 1, losses: 1, pointsFor: 7, pointsAgainst: 11, scoredGames: 1 })
    }
  })

  it('adds points from a team B win to team B', () => {
    const s = started()
    const [a, b] = s.courts[0].teams!
    const { state } = recordScore(s, 1, 4, 11)
    for (const id of b) expect(state.stats[id]).toMatchObject({ wins: 1, pointsFor: 11, pointsAgainst: 4 })
    for (const id of a) expect(state.stats[id]).toMatchObject({ losses: 1, pointsFor: 4, pointsAgainst: 11 })
  })

  it('accumulates over games, and a winner-only game in between adds no points', () => {
    let s = startGame(withPlayers(createSession('singles', 1), 2), 1, { now: T0 })
    s = recordScore(s, 1, 11, 7).state // player 1 wins 11-7
    s = startGame(s, 1, { now: T0 })
    s = recordResult(s, 1, 0).state // winner only
    s = startGame(s, 1, { now: T0 })
    s = recordScore(s, 1, 3, 11).state // the second team wins 11-3
    expect(s.stats[1].games).toBe(3)
    expect(s.stats[2].games).toBe(3)
    expect(s.stats[1].scoredGames).toBe(2)
    expect(s.stats[2].scoredGames).toBe(2)
    expect(s.stats[1].pointsFor + s.stats[2].pointsFor).toBe(11 + 7 + 3 + 11)
    expect(s.stats[1].pointsFor).toBe(s.stats[2].pointsAgainst)
  })

  it('a winner-only result adds no points and does not count as a scored game', () => {
    const { state } = recordResult(started(), 1, 1)
    expect(Object.keys(state.stats)).toHaveLength(4)
    for (const stats of Object.values(state.stats)) {
      expect(stats).toMatchObject({ games: 1, pointsFor: 0, pointsAgainst: 0, scoredGames: 0 })
    }
  })

  it('accepts 0 and the highest score', () => {
    expect(recordScore(started(), 1, 0, 1).winners).toEqual(started().courts[0].teams![1])
    expect(recordScore(started(), 1, MAX_SCORE, MAX_SCORE - 1).state.stats[1].pointsFor).toBeGreaterThan(0)
    expect(recordScore(started(), 1, 0, MAX_SCORE).state.courts[0].teams).toBeNull()
  })

  it('refuses level scores, out-of-range scores and non-integers, changing nothing', () => {
    const s = started()
    const snapshot = structuredClone(s)
    for (const [a, b] of [
      [5, 5],
      [0, 0],
      [-1, 3],
      [3, -1],
      [MAX_SCORE + 1, 3],
      [3, 100],
      [2.5, 1],
      [1, 0.5],
      [NaN, 3],
      [3, Infinity],
    ]) {
      expect(() => recordScore(s, 1, a, b), `${a}-${b}`).toThrow(RangeError)
    }
    expect(s).toEqual(snapshot)
  })

  it('explains why a score is refused', () => {
    expect(scoreProblem(11, 7)).toBeNull()
    expect(scoreProblem(7, 7)).toMatch(/level/)
    expect(scoreProblem(100, 7)).toMatch(/0 to 99/)
    expect(scoreProblem(1.5, 7)).toMatch(/whole numbers/)
    expect(scoreProblem(NaN, 7)).toMatch(/whole numbers/)
  })

  it('checks a score against the team that won', () => {
    expect(winnerScoreProblem(0, 11, 7)).toBeNull()
    expect(winnerScoreProblem(1, 7, 11)).toBeNull()
    expect(winnerScoreProblem(0, 7, 11)).toBe('Blue won, so their score must be higher.')
    expect(winnerScoreProblem(1, 11, 7)).toBe('Orange won, so their score must be higher.')
    // Level and invalid scores keep the plain reasons.
    expect(winnerScoreProblem(0, 7, 7)).toMatch(/level/)
    expect(winnerScoreProblem(1, 100, 7)).toMatch(/0 to 99/)
    expect(winnerScoreProblem(0, NaN, 7)).toMatch(/whole numbers/)
  })

  it('throws for an empty court and does not mutate the state it was given', () => {
    expect(() => recordScore(createSession('doubles', 1), 1, 11, 7)).toThrow('no game in progress')
    const s = started()
    const snapshot = structuredClone(s)
    recordScore(s, 1, 11, 7, { now: T0 + 600_000 })
    expect(s).toEqual(snapshot)
  })
})

describe('editMatch', () => {
  it('corrects a score and re-derives the winner and stats from it', () => {
    let s = startGame(withPlayers(createSession('singles', 1), 2), 1)
    s = recordScore(s, 1, 11, 7).state // player 1 wins 11-7
    expect(s.stats[1]).toMatchObject({ wins: 1, losses: 0, pointsFor: 11, pointsAgainst: 7 })
    expect(s.stats[2]).toMatchObject({ wins: 0, losses: 1, pointsFor: 7, pointsAgainst: 11 })

    s = editMatch(s, 0, { score: [8, 11] }) // actually player 2 won 11-8
    expect(s.matches![0]).toMatchObject({ winner: 1, score: [8, 11] })
    expect(s.stats[1]).toMatchObject({ wins: 0, losses: 1, pointsFor: 8, pointsAgainst: 11 })
    expect(s.stats[2]).toMatchObject({ wins: 1, losses: 0, pointsFor: 11, pointsAgainst: 8 })
  })

  it('refuses an invalid score and changes nothing', () => {
    let s = startGame(withPlayers(createSession('singles', 1), 2), 1)
    s = recordScore(s, 1, 11, 7).state
    const snapshot = structuredClone(s)
    expect(() => editMatch(s, 0, { score: [7, 7] })).toThrow(RangeError)
    expect(s).toEqual(snapshot)
  })

  it('reassigning a team moves stats from the old player to the new one', () => {
    let s = startGame(withPlayers(createSession('singles', 1), 3), 1) // players 1 & 2 play, 3 waits
    const teams = s.courts[0].teams!
    s = recordScore(s, 1, 11, 7).state
    const [a] = teams
    expect(s.stats[a[0]].games).toBe(1)
    expect(s.stats[3]).toBeUndefined()

    s = editMatch(s, 0, { teams: [[3], teams[1]] }) // player 3 stands in for the winner
    expect(s.matches![0].teams).toEqual([[3], teams[1]])
    expect(s.stats[3]).toMatchObject({ games: 1, wins: 1 })
    expect(s.stats[a[0]]).toBeUndefined()
  })

  it('throws for an out-of-range index and does not mutate the state it was given', () => {
    let s = startGame(withPlayers(createSession('singles', 1), 2), 1)
    s = recordScore(s, 1, 11, 7).state
    const snapshot = structuredClone(s)
    expect(() => editMatch(s, 5, { score: [11, 9] })).toThrow('No match at index 5')
    expect(s).toEqual(snapshot)
  })
})

describe('time played', () => {
  const T0 = 1_000_000
  const started = (mode: 'doubles' | 'singles' = 'doubles') =>
    startGame(withPlayers(createSession(mode, 1), mode === 'doubles' ? 5 : 3), 1, { now: T0 })

  it('startGame records when the game started, only when it is told the time', () => {
    expect(started().courts[0].startedAt).toBe(T0)
    expect(startGame(withPlayers(createSession('doubles', 1), 4), 1).courts[0]).not.toHaveProperty('startedAt')
  })

  it('does not record a start time on other courts', () => {
    const s = startGame(withPlayers(createSession('doubles', 2), 4), 1, { now: T0 })
    expect(s.courts[1]).toEqual({ id: 2, name: 'Court 2', teams: null })
  })

  it('credits the game in whole seconds to all four players, for a result and for a score', () => {
    const s = started()
    const ended = [recordResult(s, 1, 0, { now: T0 + 425_900 }), recordScore(s, 1, 3, 11, { now: T0 + 425_900 })]
    for (const { state } of ended) {
      for (const id of [1, 2, 3, 4]) expect(state.stats[id].secondsPlayed).toBe(425)
      expect(state.stats[5]).toBeUndefined()
    }
  })

  it('credits two players in singles', () => {
    const { state } = recordResult(started('singles'), 1, 0, { now: T0 + 90_000 })
    expect(state.stats[1].secondsPlayed).toBe(90)
    expect(state.stats[2].secondsPlayed).toBe(90)
    expect(state.stats[3]).toBeUndefined()
  })

  it('adds up over games', () => {
    let s = started('singles') // players 1 and 2 on court, 3 waiting
    s = recordResult(s, 1, 0, { now: T0 + 60_000 }).state
    s = startGame(s, 1, { now: T0 + 100_000 }) // 3 and 1 play next
    s = recordResult(s, 1, 1, { now: T0 + 400_000 }).state
    expect(s.stats[1].secondsPlayed).toBe(60 + 300)
    expect(s.stats[2].secondsPlayed).toBe(60)
    expect(s.stats[3].secondsPlayed).toBe(300)
  })

  it('caps a game left open for hours', () => {
    const { state } = recordResult(started(), 1, 0, { now: T0 + 14 * 3_600_000 })
    expect(state.stats[1].secondsPlayed).toBe(MAX_GAME_SECONDS)
    const exact = recordResult(started(), 1, 0, { now: T0 + (MAX_GAME_SECONDS - 1) * 1000 })
    expect(exact.state.stats[1].secondsPlayed).toBe(MAX_GAME_SECONDS - 1)
  })

  it('never records a negative time, for example when the clock was set back', () => {
    const { state } = recordResult(started(), 1, 0, { now: T0 - 5 * 60_000 })
    expect(state.stats[1].secondsPlayed).toBe(0)
  })

  it('records no time for a game without a start time (running before times were tracked)', () => {
    const legacy = startGame(withPlayers(createSession('doubles', 1), 4), 1)
    const { state } = recordResult(legacy, 1, 0, { now: T0 + 600_000 })
    for (const id of [1, 2, 3, 4]) expect(state.stats[id]).toMatchObject({ games: 1, secondsPlayed: 0 })
  })

  it('records no time when it is not told when the game ended', () => {
    const { state } = recordResult(started(), 1, 0)
    expect(state.stats[1].secondsPlayed).toBe(0)
  })

  it('gives a mid-game substitute the whole game and the player who left nothing', () => {
    const s = replacePlayer(started(), 1, 1)
    expect(s.courts[0].startedAt).toBe(T0)
    const { state } = recordResult(s, 1, 0, { now: T0 + 600_000 })
    expect(state.stats[5]).toMatchObject({ games: 1, secondsPlayed: 600 })
    expect(state.stats[1]).toBeUndefined()
  })

  it('clears the start time when the game ends, so the next game starts fresh', () => {
    const s = recordResult(started('singles'), 1, 0, { now: T0 + 60_000 }).state
    expect(s.courts[0]).toEqual({ id: 1, name: 'Court 1', teams: null })
    const next = startGame(s, 1, { now: T0 + 500_000 })
    expect(next.courts[0].startedAt).toBe(T0 + 500_000)
  })

  it('records no time when a game is cancelled or its court is closed', () => {
    const cancelled = cancelMatch(started(), 1)
    expect(cancelled.stats).toEqual({})
    expect(cancelled.courts[0]).toEqual({ id: 1, name: 'Court 1', teams: null })
    const two = startGame(withPlayers(createSession('doubles', 2), 4), 1, { now: T0 })
    const closed = closeCourt(two, 1)
    expect(closed.stats).toEqual({})
    expect(closed.courts.map((c) => c.id)).toEqual([2])
  })

  it('does not mutate the state it was given', () => {
    const s = started()
    const snapshot = structuredClone(s)
    recordResult(s, 1, 0, { now: T0 + 60_000 })
    expect(s).toEqual(snapshot)
  })
})

describe('match log', () => {
  const T0 = 1_000_000
  const started = () => startGame(withPlayers(createSession('doubles', 2), 8), 1, { now: T0 })

  it('starts with no matches', () => {
    expect(createSession('doubles', 1).matches ?? []).toEqual([])
  })

  it('records a scored game with its court, teams, winner, score and time', () => {
    const s = started()
    const teams = s.courts[0].teams!
    const { state } = recordScore(s, 1, 7, 11, { now: T0 + 600_000 })
    expect(state.matches).toEqual([
      { courtName: 'Court 1', teams, winner: 1, score: [7, 11], seconds: 600, endedAt: T0 + 600_000 },
    ])
  })

  it('records a winner-only game without a score', () => {
    const { state } = recordResult(started(), 1, 0, { now: T0 + 60_000 })
    expect(state.matches).toHaveLength(1)
    expect(state.matches![0]).toMatchObject({ winner: 0, seconds: 60 })
    expect(state.matches![0]).not.toHaveProperty('score')
  })

  it('records 0 seconds and no end time when the game has no times', () => {
    const { state } = recordResult(fillCourts(withPlayers(createSession('doubles', 1), 4)), 1, 0)
    expect(state.matches![0]).toMatchObject({ seconds: 0 })
    expect(state.matches![0]).not.toHaveProperty('endedAt')
  })

  it('keeps games in the order they ended', () => {
    let s = startGame(started(), 2, { now: T0 })
    s = recordScore(s, 2, 11, 1, { now: T0 + 1000 }).state
    s = recordScore(s, 1, 11, 2, { now: T0 + 2000 }).state
    expect(s.matches!.map((m) => [m.courtName, m.score])).toEqual([
      ['Court 2', [11, 1]],
      ['Court 1', [11, 2]],
    ])
  })

  it('does not record cancelled games or closed courts', () => {
    expect(cancelMatch(started(), 1).matches ?? []).toEqual([])
    expect(closeCourt(started(), 1).matches ?? []).toEqual([])
  })

  it('keeps the court name it had at the time', () => {
    let s = recordScore(started(), 1, 11, 5, { now: T0 + 1000 }).state
    s = renameCourt(s, 1, 'Center')
    expect(s.matches![0].courtName).toBe('Court 1')
  })
})

describe('cancelMatch', () => {
  it('returns players to the front of the queue', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 5))
    const c = cancelMatch(s, 1)
    expect(c.courts[0].teams).toBeNull()
    expect(c.queue.slice(0, 4).sort()).toEqual([1, 2, 3, 4])
    expect(c.queue[4]).toBe(5)
  })
})

describe('replacePlayer', () => {
  it('subs in the front of the queue on the same side and puts the leaver first in the queue', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 6))
    const sideOf1 = s.courts[0].teams![0].includes(1) ? 0 : 1
    const r = replacePlayer(s, 1, 1)
    expect(r.courts[0].teams![sideOf1]).toContain(5)
    expect(r.courts[0].teams!.flat()).not.toContain(1)
    expect(r.queue).toEqual([1, 6])
    expect(r.onBreak).toEqual([])
  })

  it('takes exactly the substitute out of the queue, whoever is chosen', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 7))
    const r = replacePlayer(s, 1, 2, 6)
    expect(r.courts[0].teams!.flat()).toContain(6)
    expect(r.queue).toEqual([2, 5, 7])
    expect(r.onBreak).toEqual([])
  })

  it('sends the leaver on a break instead when asked', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 6))
    const r = replacePlayer(s, 1, 1, 5, { sendOnBreak: true })
    expect(r.queue).toEqual([6])
    expect(r.onBreak).toEqual([1])
    expect(r.courts[0].teams!.flat()).toContain(5)
  })

  it('does not disturb anyone else, and never changes the state it was given', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 6))
    const snapshot = structuredClone(s)
    const r = replacePlayer(s, 1, 3, 6)
    expect(s).toEqual(snapshot)
    expect(r.courts[0].teams!.flat().sort()).toEqual([1, 2, 4, 6])
    expect(r.queue).toEqual([3, 5])
  })

  it('throws when the substitute is not queued or the leaver is not playing', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 4))
    expect(() => replacePlayer(s, 1, 1)).toThrow()
    const five = fillCourts(withPlayers(createSession('doubles', 1), 5))
    expect(() => replacePlayer(five, 1, 5, 5)).toThrow('not playing')
    expect(() => replacePlayer(five, 1, 1, 1)).toThrow('Substitute')
    expect(() => replacePlayer(five, 1, 1, 99)).toThrow('Substitute')
  })

  it('trades places with a player on another court, each keeping their pre-game wait', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 2), 8)) // 1-4 on court 1, 5-8 on court 2
    s = {
      ...s,
      courts: s.courts.map((c) => ({ ...c, waited: Object.fromEntries(c.teams!.flat().map((id) => [id, id * 10])) })),
    }
    const [here, there] = s.courts.map((c) => c.teams!)
    const t = replacePlayer(s, 1, 2, 7)
    expect(t.courts[0].teams).toEqual(tradeIn(here, 2, 7))
    expect(t.courts[1].teams).toEqual(tradeIn(there, 7, 2))
    expect(t.courts[0].waited).toEqual({ 1: 10, 7: 70, 3: 30, 4: 40 })
    expect(t.courts[1].waited).toEqual({ 5: 50, 2: 20, 6: 60, 8: 80 })
    expect(t.queue).toEqual(s.queue)
  })

  it('switches two players on the same court, for example to change teams', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 4))
    const [[a], [b]] = s.courts[0].teams!
    const t = replacePlayer(s, 1, a, b)
    expect(t.courts[0].teams![0]).toContain(b)
    expect(t.courts[0].teams![1]).toContain(a)
    expect(t.courts[0].teams!.flat().sort()).toEqual([1, 2, 3, 4])
  })

  it('brings a substitute back from a break', () => {
    const s = checkOut(fillCourts(withPlayers(createSession('doubles', 1), 6)), 6)
    const t = replacePlayer(s, 1, 1, 6)
    expect(t.courts[0].teams!.flat()).toContain(6)
    expect(t.onBreak).toEqual([])
    expect(t.queue).toEqual([1, 5])
  })

  it('gives the substitute their spot in Next up to whoever comes off, leaving the rest of the group as it was', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 8)) // 5-8 next up
    const group = nextGroup(s)!
    const t = replacePlayer(s, 1, 1, group.players[0])
    expect(nextGroup(t)!.teams).toEqual(tradeIn(group.teams, group.players[0], 1))
    expect(isNextUpPicked(t)).toBe(true)
  })
})

/** The teams with inId in the spot of outId. */
function tradeIn(teams: number[][], outId: number, inId: number) {
  return teams.map((team) => team.map((id) => (id === outId ? inId : id)))
}

describe('removing a player from a court', () => {
  const MIN = 60_000
  /** Court 1 with 1 and 2 against 3 and 4, started at 0; 5 and 6 wait. */
  const playing = () => {
    const s = withPlayers(createSession('doubles', 1), 6)
    return startGame(s, 1, { now: 0 })
  }

  it('leaves the spot open, pauses the game, and puts the player first in the queue', () => {
    const s = playing()
    const [a] = s.courts[0].teams![0]
    const t = removeFromCourt(s, 1, a, { now: 2 * MIN })
    expect(t.courts[0].teams![0]).toHaveLength(1)
    expect(t.courts[0].teams!.flat()).not.toContain(a)
    expect(t.courts[0].pausedAt).toBe(2 * MIN)
    expect(isShort(t.courts[0], t.mode)).toBe(true)
    expect(t.queue[0]).toBe(a)
    expect(t.queuedAt?.[a]).toBe(2 * MIN)
  })

  it('can send them on a break instead, and ends their partner lock', () => {
    const [a, b] = playing().courts[0].teams![0]
    const s = lockPartners(playing(), a, b)
    const t = removeFromCourt(s, 1, a, { onBreak: true, now: MIN })
    expect(t.onBreak).toEqual([a])
    expect(t.queue).not.toContain(a)
    expect(t.partners).toEqual([])
  })

  it('cannot be finished while short, but can be cancelled', () => {
    const t = removeFromCourt(playing(), 1, playing().courts[0].teams![0][0], { now: MIN })
    expect(() => recordScore(t, 1, 11, 5, { now: 2 * MIN })).toThrow('Fill the open spot on Court 1')
    const cancelled = cancelMatch(t, 1, 2 * MIN)
    expect(cancelled.courts[0].teams).toBeNull()
    expect(cancelled.courts[0].pausedAt).toBeUndefined()
  })

  it('fills the spot from the queue or a break, and leaves the paused time out of the game', () => {
    let s = checkOut(playing(), 6)
    const out = s.courts[0].teams![1][0]
    s = removeFromCourt(s, 1, out, { now: 2 * MIN }) // paused at 2 minutes
    s = fillCourtSpot(s, 1, 1, 6, 5 * MIN) // back on at 5: 3 minutes paused
    expect(s.courts[0].teams![1]).toContain(6)
    expect(s.onBreak).toEqual([])
    expect(s.courts[0].pausedAt).toBeUndefined()
    expect(s.courts[0].pausedSeconds).toBe(180)
    const done = recordScore(s, 1, 11, 5, { now: 10 * MIN }).state
    expect(done.matches!.at(-1)!.seconds).toBe(7 * 60) // 10 minutes, less 3 paused
  })

  it('refuses a full team, or a player on a court', () => {
    const s = removeFromCourt(playing(), 1, playing().courts[0].teams![0][0], { now: MIN })
    const [b] = s.courts[0].teams![1]
    expect(() => fillCourtSpot(s, 1, 1, 5, MIN)).toThrow('no open spot')
    expect(() => fillCourtSpot(s, 1, 0, b, MIN)).toThrow('waiting or on a break')
  })

  it('keeps the open spot where the removed player was, and fills exactly the spot chosen', () => {
    const s = playing()
    const [a, b] = s.courts[0].teams![0]
    const t = removeFromCourt(s, 1, a, { now: MIN })
    expect(courtSlots(t.courts[0], 2)[0]).toEqual([null, b]) // b does not move up
    expect(t.courts[0].teams![0]).toEqual([b])
    expect(() => fillCourtSpot(t, 1, 0, 5, MIN, 1)).toThrow('not open')
    const filled = fillCourtSpot(t, 1, 0, 5, 2 * MIN, 0)
    expect(filled.courts[0].teams![0]).toEqual([5, b])
    expect(filled.courts[0].openSlots).toBeUndefined()
  })

  it('fills the first open spot when no spot is given, as an older app sends it', () => {
    const s = playing()
    const [a, b] = s.courts[0].teams![0]
    let t = removeFromCourt(s, 1, b, { now: MIN })
    t = removeFromCourt(t, 1, a, { now: MIN })
    expect(courtSlots(t.courts[0], 2)[0]).toEqual([null, null])
    const filled = fillCourtSpot(t, 1, 0, 5, MIN)
    expect(courtSlots(filled.courts[0], 2)[0]).toEqual([5, null])
  })

  it('keeps the gap in place when a player on the court is swapped', () => {
    const s = playing()
    const [a, b] = s.courts[0].teams![0]
    const t = replacePlayer(removeFromCourt(s, 1, a, { now: MIN }), 1, b, 6)
    expect(courtSlots(t.courts[0], 2)[0]).toEqual([null, 6])
  })

  it('opens the court when nobody is left, and moves the pause with the session clock', () => {
    let s = createSession('singles', 1)
    s = startGame(withPlayers(s, 2), 1, { now: 0 })
    const one = removeFromCourt(s, 1, 1, { now: MIN })
    expect(shiftSessionClock(one, 1000).courts[0].pausedAt).toBe(MIN + 1000)
    const none = removeFromCourt(one, 1, 2, { now: MIN })
    expect(none.courts[0].teams).toBeNull()
    expect(none.queue).toEqual([2, 1])
  })
})

describe('setting up a court by hand', () => {
  const MIN = 60_000
  /** Six waiting, each since their id in minutes. */
  const six = () => {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 6; id++) s = checkIn(s, player(id), id * MIN)
    return s
  }
  const stage = (s: SessionState, spots: [0 | 1, number][]) =>
    spots.reduce((acc, [team, id]) => fillCourtSpot(acc, 1, team, id, 10 * MIN), s)

  it('puts each chosen player on the open court without starting anything', () => {
    const s = stage(six(), [[0, 5]])
    expect(s.courts[0].teams).toEqual([[5], []])
    expect(s.courts[0].notStarted).toBe(true)
    expect(s.courts[0].startedAt).toBeUndefined()
    expect(s.queue).toEqual([1, 2, 3, 4, 6])
    expect(s.queuedAt?.[5]).toBe(5 * MIN) // still counts as waiting until the game starts
    expect(() => recordScore(s, 1, 11, 5)).toThrow('has not started')
  })

  it('starts exactly that line-up once every spot is filled, recording each wait', () => {
    const s = stage(six(), [
      [0, 5],
      [0, 6],
      [1, 1],
    ])
    expect(() => startGame(s, 1, { now: 12 * MIN })).toThrow('Fill every spot')
    const full = stage(s, [[1, 2]])
    const started = startGame(full, 1, { now: 12 * MIN })
    expect(started.courts[0].teams).toEqual([
      [5, 6],
      [1, 2],
    ])
    expect(started.courts[0].notStarted).toBeUndefined()
    expect(started.courts[0].startedAt).toBe(12 * MIN)
    expect(started.courts[0].waited).toEqual({ 5: 7 * 60, 6: 6 * 60, 1: 11 * 60, 2: 10 * 60 })
    expect(started.queue).toEqual([3, 4])
    expect(started.queuedAt?.[5]).toBeUndefined()
  })

  it('takes players off again without pausing anything, keeping their wait; Clear court sends all back', () => {
    const s = stage(six(), [
      [0, 5],
      [1, 6],
    ])
    const off = removeFromCourt(s, 1, 5, { now: 11 * MIN })
    expect(off.courts[0].teams).toEqual([[], [6]])
    expect(off.courts[0].pausedAt).toBeUndefined()
    expect(off.queue[0]).toBe(5)
    expect(off.queuedAt?.[5]).toBe(5 * MIN)
    const cleared = cancelMatch(off, 1, 11 * MIN)
    expect(cleared.courts[0].teams).toBeNull()
    expect(cleared.queue.slice(0, 2)).toEqual([6, 5])
    expect(cleared.queuedAt?.[6]).toBe(6 * MIN)
  })

  it('fills the spots in the order staff tap them, and starts that exact line-up', () => {
    let s = fillCourtSpot(six(), 1, 0, 5, 10 * MIN, 1) // the lower Blue spot first
    expect(courtSlots(s.courts[0], 2)).toEqual([
      [null, 5],
      [null, null],
    ])
    s = fillCourtSpot(s, 1, 1, 1, 10 * MIN, 1)
    s = fillCourtSpot(s, 1, 1, 2, 10 * MIN, 0)
    s = fillCourtSpot(s, 1, 0, 6, 10 * MIN, 0)
    expect(s.courts[0].openSlots).toBeUndefined()
    const started = startGame(s, 1, { now: 12 * MIN })
    expect(started.courts[0].teams).toEqual([
      [6, 5],
      [2, 1],
    ])
  })

  it('brings a player back from a break onto the court', () => {
    const s = stage(checkOut(six(), 3), [[1, 3]])
    expect(s.onBreak).toEqual([])
    expect(s.courts[0].teams).toEqual([[], [3]])
  })
})

describe('pinning players into Next up', () => {
  it('keeps a pinned player in their spot while the group cannot form, then fills the rest around them', () => {
    let s = withPlayers(createSession('doubles', 1), 3)
    expect(nextGroup(s)).toBeNull()
    s = fillNextUpSpot(s, 0, 3, 2)
    expect(nextUpSpots(s, 0)).toEqual([null, null, null, 2])
    expect(isNextUpPicked(s)).toBe(true)
    expect(nextGroup(s)).toBeNull()
    s = checkIn(s, player(4))
    expect(nextGroup(s)!.teams).toEqual([
      [1, 3],
      [4, 2],
    ])
    // Starting it uses the choice up.
    expect(startGame(s, 1).nextUpPick).toBeUndefined()
  })

  it('brings a player back from a break, and refuses someone on a court or a taken spot', () => {
    let s = checkOut(withPlayers(createSession('doubles', 1), 3), 3)
    s = fillNextUpSpot(s, 0, 0, 3)
    expect(s.onBreak).toEqual([])
    expect(nextUpSpots(s, 0)[0]).toBe(3)
    expect(() => fillNextUpSpot(s, 0, 0, 1)).toThrow('not open')
    const playing = fillCourts(withPlayers(createSession('doubles', 2), 5))
    expect(() => fillNextUpSpot(playing, 0, 0, 1)).toThrow('waiting or on a break')
  })

  it('unpins through Remove, Swap and Reset', () => {
    let s = withPlayers(createSession('doubles', 1), 3)
    s = fillNextUpSpot(fillNextUpSpot(s, 0, 0, 1), 0, 1, 2)
    s = dropFromNextUp(s, 1)
    expect(nextUpSpots(s, 0)).toEqual([null, 2, null, null])
    s = replaceNextUp(s, 2, 3)
    expect(nextUpSpots(s, 0)).toEqual([null, 3, null, null])
    expect(isNextUpPicked(resetNextUp(s))).toBe(false)
    expect(isNextUpPicked(dropFromNextUp(s, 3))).toBe(false) // nobody pinned: automatic again
  })
})

describe('queue wait time', () => {
  it('checkIn stamps a newly queued player, and leaves an already-queued player alone', () => {
    let s = createSession('doubles', 1)
    s = checkIn(s, player(1), 1000)
    expect(s.queuedAt).toEqual({ 1: 1000 })
    s = checkIn(s, player(1), 2000)
    expect(s.queuedAt).toEqual({ 1: 1000 })
  })

  it('records nothing when no `now` is given', () => {
    const s = checkIn(createSession('doubles', 1), player(1))
    expect(s.queuedAt).toBeUndefined()
  })

  it('checkOut clears the stamp', () => {
    const s = checkOut(checkIn(createSession('doubles', 1), player(1), 1000), 1)
    expect(s.queuedAt).toEqual({})
  })

  it('startGame records how long each starting player had waited, and stops tracking them as queued', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), id * 1000)
    s = startGame(s, 1, { now: 10_000 })
    expect(s.courts[0].waited).toEqual({ 1: 9, 2: 8, 3: 7, 4: 6 })
    expect(s.queuedAt).toEqual({})
  })

  it('does not record a wait for a player whose queue-join time is unknown', () => {
    const s = startGame(withPlayers(createSession('doubles', 1), 4), 1, { now: 10_000 })
    expect(s.courts[0].waited).toBeUndefined()
  })

  it('carries the pre-game wait into the finished match, and restarts the wait for returning players', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 10_000 })
    const { state } = recordResult(s, 1, 0, { now: 40_000 })
    expect(state.matches![0].waited).toEqual({ 1: 10, 2: 10, 3: 10, 4: 10 })
    expect(state.queuedAt).toEqual({ 1: 40_000, 2: 40_000, 3: 40_000, 4: 40_000 })
  })

  it('adds up each player\'s waits over the games they finished, and keeps them when a match is edited', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 5; id++) s = checkIn(s, player(id), id * 1000)
    s = startGame(s, 1, { now: 10_000 }) // 1..4 waited 9, 8, 7, 6
    s = recordScore(s, 1, 11, 5, { now: 70_000 }).state // they rejoin behind 5 at 70 s
    s = startGame(s, 1, { now: 100_000 }) // 5 waited 95; 1, 2, 3 waited 30
    const players = s.courts[0].teams!.flat()
    s = recordScore(s, 1, 11, 7, { now: 160_000 }).state
    const expected: Record<number, number> = { 1: 9, 2: 8, 3: 7, 4: 6 }
    for (const id of players) expected[id] = (expected[id] ?? 0) + (id === 5 ? 95 : 30)
    for (let id = 1; id <= 5; id++) expect(s.stats[id].secondsWaited, `player ${id}`).toBe(expected[id])
    const edited = editMatch(s, 0, { score: [11, 9] })
    for (let id = 1; id <= 5; id++) expect(edited.stats[id].secondsWaited).toBe(expected[id])
  })

  it('cancelMatch restarts the wait for the returning players', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 10_000 })
    const cancelled = cancelMatch(s, 1, 20_000)
    expect(cancelled.queuedAt).toEqual({ 1: 20_000, 2: 20_000, 3: 20_000, 4: 20_000 })
  })

  it('closeCourt restarts the wait for the players on a cancelled game', () => {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 10_000 })
    const closed = closeCourt(s, 1, 20_000)
    expect(closed.queuedAt).toEqual({ 1: 20_000, 2: 20_000, 3: 20_000, 4: 20_000 })
  })

  it('replacePlayer records the substitute\'s own wait and restarts the leaver\'s', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 6; id++) s = checkIn(s, player(id), id * 1000)
    s = startGame(s, 1, { now: 10_000 })
    const r = replacePlayer(s, 1, 1, 5, { now: 20_000 })
    expect(r.courts[0].waited).toEqual({ 2: 8, 3: 7, 4: 6, 5: 15 })
    expect(r.queuedAt).toEqual({ 1: 20_000, 6: 6000 })
  })

  it('replacePlayer clears the leaver\'s wait entirely when they go on a break', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 5; id++) s = checkIn(s, player(id), id * 1000)
    s = startGame(s, 1, { now: 10_000 })
    const r = replacePlayer(s, 1, 1, 5, { sendOnBreak: true, now: 20_000 })
    expect(r.courts[0].waited).toEqual({ 2: 8, 3: 7, 4: 6, 5: 15 })
    expect(r.queuedAt).toEqual({})
  })
})

describe('live on the public page', () => {
  it('counts a session from before the choice as live, and follows the choice after it', () => {
    const s = createSession('doubles', 1)
    expect(isLive(s)).toBe(true)
    expect(isLive(setLive(s, false))).toBe(false)
    expect(isLive(setLive(setLive(s, false), true))).toBe(true)
    expect(s.live).toBeUndefined() // never changes the state it was given
  })
})

describe('shiftSessionClock', () => {
  it('shifts every queued player\'s timestamp forward by the offset', () => {
    let s = createSession('doubles', 1)
    s = checkIn(s, player(1), 1000)
    s = checkIn(s, player(2), 2000)
    const shifted = shiftSessionClock(s, 5000)
    expect(shifted.queuedAt).toEqual({ 1: 6000, 2: 7000 })
  })

  it('shifts an in-progress court\'s start time, but leaves an open court alone', () => {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 10_000 })
    const shifted = shiftSessionClock(s, 5000)
    expect(shifted.courts[0].startedAt).toBe(15_000)
    expect(shifted.courts[1].startedAt).toBeUndefined()
  })

  it('leaves a court with an untracked start time alone', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id))
    s = startGame(s, 1) // no `now`, so no startedAt
    const shifted = shiftSessionClock(s, 5000)
    expect(shifted.courts[0].startedAt).toBeUndefined()
  })

  it('does nothing for a zero or negative offset', () => {
    let s = createSession('doubles', 1)
    s = checkIn(s, player(1), 1000)
    expect(shiftSessionClock(s, 0)).toBe(s)
    expect(shiftSessionClock(s, -100)).toBe(s)
  })

  it('never changes the state it was given', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 10_000 })
    const snapshot = structuredClone(s)
    shiftSessionClock(s, 5000)
    expect(s).toEqual(snapshot)
  })
})

describe('lastActivityAt', () => {
  it('is the latest check-in or game start', () => {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), id * 1000)
    s = startGame(s, 1, { now: 10_000 })
    expect(lastActivityAt(s)).toBe(10_000)
    s = checkIn(s, player(5), 12_000)
    expect(lastActivityAt(s)).toBe(12_000)
  })

  it('counts a finished game and a paused court', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, player(id), 0)
    s = startGame(s, 1, { now: 10_000 })
    const finished = recordScore(s, 1, 11, 7, { now: 70_000 }).state
    expect(lastActivityAt({ ...finished, queuedAt: {} })).toBe(70_000)
    expect(lastActivityAt({ ...s, courts: [{ ...s.courts[0], pausedAt: 90_000 }] })).toBe(90_000)
  })

  it('is undefined for a session with no times', () => {
    expect(lastActivityAt(createSession('doubles', 1))).toBeUndefined()
    expect(lastActivityAt(checkIn(createSession('doubles', 1), player(1)))).toBeUndefined()
  })
})

describe('court management', () => {
  const names = (s: SessionState) => s.courts.map((c) => c.name)
  const ids = (s: SessionState) => s.courts.map((c) => c.id)

  describe('defaultCourtName', () => {
    it('is the lowest "Court N" not already used, ignoring case', () => {
      const s = createSession('doubles', 3)
      expect(defaultCourtName(s.courts)).toBe('Court 4')
      expect(defaultCourtName(closeCourt(s, 2).courts)).toBe('Court 2')
      expect(defaultCourtName([{ id: 1, name: 'court 1', teams: null }])).toBe('Court 2')
    })
  })

  describe('addCourt', () => {
    it('adds an empty court with the next id and the lowest free name', () => {
      const s = addCourt(createSession('doubles', 2))
      expect(s.courts).toHaveLength(3)
      expect(s.courts[2]).toEqual({ id: 3, name: 'Court 3', teams: null })
    })

    it('reuses a freed number for the name but never an id in use', () => {
      let s = closeCourt(createSession('doubles', 3), 2)
      s = addCourt(s)
      expect(names(s)).toEqual(['Court 1', 'Court 3', 'Court 2'])
      expect(ids(s)).toEqual([1, 3, 4])
    })

    it('takes a chosen name, trimmed, and checks it like a rename', () => {
      const s = addCourt(createSession('doubles', 1), '  Center Court ')
      expect(s.courts[1].name).toBe('Center Court')
      expect(() => addCourt(s, 'center court')).toThrow(RangeError)
      expect(() => addCourt(s, '   ')).toThrow(RangeError)
    })

    it('stops at the limit', () => {
      expect(() => addCourt(createSession('doubles', MAX_COURTS))).toThrow(RangeError)
      expect(addCourt(createSession('doubles', MAX_COURTS - 1)).courts).toHaveLength(MAX_COURTS)
    })

    it('leaves everything else alone and does not change the state it was given', () => {
      const before = fillCourts(withPlayers(createSession('singles', 1), 3))
      const snapshot = structuredClone(before)
      const after = addCourt(before)
      expect(before).toEqual(snapshot)
      expect(after.queue).toEqual(before.queue)
      expect(after.courts[0]).toEqual(before.courts[0])
    })

    it('lets waiting players fill the new court once the queue is assigned', () => {
      const s = fillCourts(addCourt(fillCourts(withPlayers(createSession('doubles', 1), 8))))
      expect(s.courts[1].teams?.flat().sort()).toEqual([5, 6, 7, 8])
      expect(s.queue).toEqual([])
    })
  })

  describe('renameCourt', () => {
    it('renames, trimming the name', () => {
      expect(names(renameCourt(createSession('doubles', 2), 2, '  Center Court  '))).toEqual(['Court 1', 'Center Court'])
    })

    it('lets a court keep its own name, even in a different case', () => {
      expect(names(renameCourt(createSession('doubles', 2), 2, 'COURT 2'))).toEqual(['Court 1', 'COURT 2'])
    })

    it('refuses empty, too long and duplicate names', () => {
      const s = createSession('doubles', 2)
      expect(() => renameCourt(s, 1, '')).toThrow('Give the court a name')
      expect(() => renameCourt(s, 1, '   ')).toThrow(RangeError)
      expect(() => renameCourt(s, 1, 'x'.repeat(41))).toThrow('at most 40')
      expect(renameCourt(s, 1, 'x'.repeat(40)).courts[0].name).toHaveLength(40)
      expect(() => renameCourt(s, 1, ' court 2 ')).toThrow('Another court already has that name')
    })

    it('throws for a court that does not exist', () => {
      expect(() => renameCourt(createSession('doubles', 1), 9, 'x')).toThrow()
    })

    it('does not disturb a game in progress', () => {
      const s = fillCourts(withPlayers(createSession('doubles', 1), 4))
      const renamed = renameCourt(s, 1, 'Center Court')
      expect(renamed.courts[0].teams).toEqual(s.courts[0].teams)
      expect(recordResult(renamed, 1, 0).state.courts[0].name).toBe('Center Court')
    })
  })

  describe('moveCourt', () => {
    it('swaps a court with its neighbour, its game and id going with it', () => {
      const s = fillCourts(withPlayers(createSession('doubles', 3), 4)) // court 1 is playing
      const moved = moveCourt(s, 1, 1)
      expect(ids(moved)).toEqual([2, 1, 3])
      expect(moved.courts[1].teams).toEqual(s.courts[0].teams)
      expect(ids(moveCourt(moved, 1, -1))).toEqual([1, 2, 3])
    })

    it('does nothing past either end', () => {
      const s = createSession('doubles', 3)
      expect(moveCourt(s, 1, -1)).toBe(s)
      expect(moveCourt(s, 3, 1)).toBe(s)
    })

    it('throws for a court that does not exist, and does not change its input', () => {
      const s = createSession('doubles', 3)
      const snapshot = structuredClone(s)
      expect(() => moveCourt(s, 9, 1)).toThrow()
      moveCourt(s, 2, 1)
      expect(s).toEqual(snapshot)
    })
  })

  describe('closeCourt', () => {
    it('removes an empty court and leaves the queue alone', () => {
      const s = withPlayers(createSession('doubles', 2), 3)
      const closed = closeCourt(s, 2)
      expect(ids(closed)).toEqual([1])
      expect(closed.queue).toEqual([1, 2, 3])
    })

    it('cancels a game in progress with no result, and puts its players first in the queue', () => {
      const s = fillCourts(withPlayers(createSession('doubles', 2), 6)) // 1-4 playing, 5 and 6 waiting
      const closed = closeCourt(s, 1)
      expect(ids(closed)).toEqual([2])
      expect(closed.queue.slice(0, 4).sort()).toEqual([1, 2, 3, 4])
      expect(closed.queue.slice(4)).toEqual([5, 6])
      expect(closed.stats).toEqual({})
      expect(closed.lastResult).toEqual({})
    })

    it('lets the cancelled players move onto another open court', () => {
      const s = fillCourts(withPlayers(createSession('doubles', 2), 4)) // court 2 is open
      const restaged = fillCourts(closeCourt(s, 1))
      expect(ids(restaged)).toEqual([2])
      expect(restaged.courts[0].teams?.flat().sort()).toEqual([1, 2, 3, 4])
      expect(restaged.queue).toEqual([])
    })

    it('always keeps one court', () => {
      const s = createSession('doubles', 1)
      expect(() => closeCourt(s, 1)).toThrow('at least one court')
      expect(() => closeCourt(closeCourt(createSession('doubles', 2), 1), 2)).toThrow(RangeError)
    })

    it('throws for a court that does not exist and never changes its input', () => {
      const s = fillCourts(withPlayers(createSession('doubles', 2), 4))
      const snapshot = structuredClone(s)
      expect(() => closeCourt(s, 9)).toThrow()
      closeCourt(s, 1)
      expect(s).toEqual(snapshot)
    })
  })

  describe('any order of changes', () => {
    /** A small seeded generator so a failure can be reproduced. */
    const random = (seed: number) => () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296
      return seed / 4_294_967_296
    }

    function checkInvariants(s: SessionState) {
      expect(s.courts.length).toBeGreaterThanOrEqual(1)
      expect(s.courts.length).toBeLessThanOrEqual(MAX_COURTS)
      expect(new Set(ids(s)).size).toBe(s.courts.length)
      expect(new Set(names(s).map((n) => n.toLowerCase())).size).toBe(s.courts.length)
      for (const court of s.courts) expect(court.name.trim()).not.toBe('')

      // Every checked-in player is in exactly one place: on a court, in the queue, or on a break.
      const places = [...s.courts.flatMap((c) => (c.teams ? c.teams.flat() : [])), ...s.queue, ...s.onBreak]
      expect(places.length).toBe(new Set(places).size)
      expect(new Set(places)).toEqual(new Set(Object.keys(s.players).map(Number)))

      // A player is in at most one lock, and a lock waiting is never also in force.
      const inLocks = [...s.partners, ...(s.pendingPartners ?? []).map((p) => p.pair)].flat()
      expect(inLocks.length).toBe(new Set(inLocks).size)
      for (const { pair, done } of s.pendingPartners ?? []) {
        expect(done.every((id) => pair.includes(id))).toBe(true)
        expect(pair.every((id) => done.includes(id))).toBe(false)
      }

      // Scores and time never go backwards or out of step with the games played.
      for (const stats of Object.values(s.stats)) {
        expect(stats.wins + stats.losses).toBe(stats.games)
        expect(stats.scoredGames).toBeLessThanOrEqual(stats.games)
        expect(stats.pointsFor).toBeGreaterThanOrEqual(0)
        expect(stats.pointsAgainst).toBeGreaterThanOrEqual(0)
        expect(stats.secondsPlayed).toBeGreaterThanOrEqual(0)
        expect(stats.secondsPlayed).toBeLessThanOrEqual(stats.games * MAX_GAME_SECONDS)
      }
      for (const court of s.courts) if (!court.teams) expect(court).not.toHaveProperty('startedAt')
    }

    it('never loses a player, duplicates one, or reuses a court id or name', () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const next = random(seed)
        const pick = <T,>(items: T[]) => items[Math.floor(next() * items.length)]
        let s = createSession('doubles', 3)
        let nextPlayer = 1
        let clock = 1_000_000

        for (let step = 0; step < 250; step++) {
          clock += Math.floor(next() * 20 * 60_000)
          const busy = s.courts.filter((c) => c.teams)
          try {
            switch (Math.floor(next() * 14)) {
              case 0:
                s = checkIn(checkIn(s, player(nextPlayer++)), player(nextPlayer++))
                break
              case 1:
                s = addCourt(s)
                break
              case 2:
                s = closeCourt(s, pick(s.courts).id)
                break
              case 3:
                s = renameCourt(s, pick(s.courts).id, `Court ${Math.floor(next() * 20)}`)
                break
              case 4:
                s = moveCourt(s, pick(s.courts).id, next() < 0.5 ? -1 : 1)
                break
              case 5:
                if (busy.length) s = recordResult(s, pick(busy).id, next() < 0.5 ? 0 : 1, { now: clock }).state
                break
              case 6:
                if (busy.length) s = cancelMatch(s, pick(busy).id)
                break
              case 7:
                if (s.queue.length) s = checkOut(s, pick(s.queue))
                break
              case 8:
                if (busy.length) {
                  // Level scores are refused with a RangeError, like any invalid change.
                  s = recordScore(s, pick(busy).id, Math.floor(next() * 12), Math.floor(next() * 12), { now: clock }).state
                }
                break
              case 9:
                if (busy.length && s.queue.length) {
                  const court = pick(busy)
                  s = replacePlayer(s, court.id, pick(court.teams!.flat()), pick(s.queue), { sendOnBreak: next() < 0.5 })
                }
                break
              case 11: {
                const locked = new Set([...s.partners.flat(), ...(s.pendingPartners ?? []).flatMap((p) => p.pair)])
                const free = Object.keys(s.players).map(Number).filter((id) => !locked.has(id))
                if (free.length >= 2) {
                  const first = pick(free)
                  s = lockPartners(s, first, pick(free.filter((id) => id !== first)))
                }
                break
              }
              case 12:
                if (Object.keys(s.players).length) s = unlockPartners(s, pick(Object.keys(s.players).map(Number)))
                break
              case 10: {
                const group = nextGroup(s)
                const others = s.queue.filter((id) => !group?.players.includes(id))
                if (group && others.length) s = replaceNextUp(s, pick(group.players), pick(others))
                break
              }
              default: {
                const open = s.courts.filter((c) => !c.teams)
                if (open.length && nextGroup(s)) s = startGame(s, pick(open).id, { now: clock })
              }
            }
          } catch (error) {
            // Refusing something invalid is fine; anything else is a bug.
            if (!(error instanceof RangeError)) throw error
          }
          checkInvariants(s)
        }
      }
    })
  })
})

describe('estimateWaitMinutes', () => {
  it('is 0 when a court is free for the player', () => {
    const s = withPlayers(createSession('doubles', 2), 4)
    expect(estimateWaitMinutes(s, 1, 12)).toBe(0)
  })

  it('grows with queue position and returns null for non-queued players', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 2), 16))
    // 2 courts busy, 8 waiting: player 9 is next (one court must free), player 13 is a match further back.
    expect(estimateWaitMinutes(s, 9, 12)).toBe(6)
    expect(estimateWaitMinutes(s, 13, 12)).toBe(12)
    expect(estimateWaitMinutes(s, 1, 12)).toBeNull()
  })
})

describe('partner locking', () => {
  it('locks two checked-in players and unlocks by either partner', () => {
    let s = withPlayers(createSession('doubles', 1), 3)
    s = lockPartners(s, 1, 3)
    expect(s.partners).toEqual([[1, 3]])
    expect(unlockPartners(s, 3).partners).toEqual([])
    expect(unlockPartners(s, 2).partners).toEqual([[1, 3]])
  })

  it('rejects invalid locks', () => {
    const s = withPlayers(createSession('doubles', 1), 3)
    expect(() => lockPartners(s, 1, 1)).toThrow()
    expect(() => lockPartners(s, 1, 99)).toThrow()
    expect(() => lockPartners(withPlayers(createSession('singles', 1), 3), 1, 2)).toThrow()
    const locked = lockPartners(s, 1, 2)
    expect(() => lockPartners(locked, 2, 3)).toThrow()
  })

  it('keeps partners on the same team and requeues them together after a game', () => {
    let s = lockPartners(withPlayers(createSession('doubles', 1), 8), 1, 4)
    s = fillCourts(s)
    const [a, b] = s.courts[0].teams!
    expect([a, b].some((t) => t.includes(1) && t.includes(4))).toBe(true)

    const { state } = recordResult(s, 1, 0)
    const at = state.queue.indexOf(1)
    expect(Math.abs(at - state.queue.indexOf(4))).toBe(1)
  })

  it('dissolves the lock when one partner is replaced mid-game', () => {
    let s = lockPartners(withPlayers(createSession('doubles', 1), 5), 1, 2)
    s = fillCourts(s)
    s = replacePlayer(s, 1, 1)
    expect(s.partners).toEqual([])
    const locked = fillCourts(lockPartners(withPlayers(createSession('doubles', 1), 5), 1, 2))
    expect(replacePlayer(locked, 1, 1, 5, { sendOnBreak: true }).partners).toEqual([])
  })

  it('is ignored when a session has no partners (singles stays first come, first served)', () => {
    const s = fillCourts(withPlayers(createSession('singles', 1), 3))
    expect(s.courts[0].teams).toEqual([[1], [2]])
  })
})

describe('lastResult', () => {
  it('records W for winners and L for losers and overwrites on the next game', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 1), 4))
    const first = recordResult(s, 1, 0)
    first.winners.forEach((id) => expect(first.state.lastResult[id]).toBe('W'))
    first.losers.forEach((id) => expect(first.state.lastResult[id]).toBe('L'))

    s = fillCourts(first.state)
    const second = recordResult(s, 1, 1)
    second.winners.forEach((id) => expect(second.state.lastResult[id]).toBe('W'))
  })
})

describe('mixed doubles', () => {
  const mixed = (genders: ('M' | 'F')[]) => {
    let st = createSession('doubles', 1, { matchmaking: 'mixed' })
    genders.forEach((gender, i) => {
      st = checkIn(st, { id: i + 1, name: `P${i + 1}`, skill: 3, gender })
    })
    return st
  }

  it('has no next group without two men and two women, but staff can override', () => {
    const s = mixed(['M', 'M', 'M', 'M', 'M'])
    expect(nextGroup(s)).toBeNull()
    expect(nextGroup(s, { ignoreMode: true })!.players.slice().sort()).toEqual([1, 2, 3, 4])
    expect(() => startGame(s, 1)).toThrow('Not enough players')
    const started = startGame(s, 1, { ignoreMode: true })
    expect(started.courts[0].teams!.flat().sort()).toEqual([1, 2, 3, 4])
    expect(started.queue).toEqual([5])
  })

  it('pairs a man and a woman on each team when it can', () => {
    const { teams } = nextGroup(mixed(['M', 'M', 'F', 'F']))!
    for (const team of teams) expect(team.some((id) => id <= 2) && team.some((id) => id > 2)).toBe(true)
  })
})

describe('changing who is next up', () => {
  const eight = () => withPlayers(createSession('doubles', 2), 8)

  it('puts the chosen waiting player in, and leaves the replaced one where they were in the queue', () => {
    const s = replaceNextUp(eight(), 2, 7)
    const group = nextGroup(s)!
    expect(group.players.slice().sort()).toEqual([1, 3, 4, 7])
    expect(s.queue).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(isNextUpPicked(s)).toBe(true)
  })

  it('is exactly what starts, on whichever court is chosen', () => {
    const s = replaceNextUp(eight(), 1, 8)
    const preview = nextGroup(s)!
    const started = startGame(s, 2)
    expect(started.courts[1].teams).toEqual(preview.teams)
    expect(started.courts[1].teams!.flat().sort()).toEqual([2, 3, 4, 8])
    expect(started.queue).toEqual([1, 5, 6, 7])
    // The choice is used up: the next group is automatic again.
    expect(isNextUpPicked(started)).toBe(false)
    expect(started.nextUpPick).toBeUndefined()
    expect(nextGroup(started)!.players.slice().sort()).toEqual([1, 5, 6, 7])
  })

  it('can be changed again, including putting the original player back', () => {
    let s = replaceNextUp(eight(), 2, 7)
    s = replaceNextUp(s, 7, 2)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 2, 3, 4])
    s = replaceNextUp(replaceNextUp(s, 1, 5), 3, 6)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([2, 4, 5, 6])
  })

  it('splits the new four into teams, keeping a locked pair that stays in the group together', () => {
    const s = lockPartners(eight(), 1, 2)
    const changed = replaceNextUp(s, 3, 5)
    expect(changed.partners).toEqual([[1, 2]])
    const { teams } = nextGroup(changed)!
    expect(teams.map((t) => t.length)).toEqual([2, 2])
    expect(teams.some((t) => t.includes(1) && t.includes(2))).toBe(true)
  })

  it('unlocks the pairs of both players involved', () => {
    const s = lockPartners(lockPartners(eight(), 1, 2), 5, 6)
    const changed = replaceNextUp(s, 1, 5)
    expect(changed.partners).toEqual([])
    expect(nextGroup(changed)!.players.slice().sort()).toEqual([2, 3, 4, 5])
  })

  it('swaps one of the two players in singles', () => {
    const s = replaceNextUp(withPlayers(createSession('singles', 1), 4), 2, 4)
    expect(nextGroup(s)!.teams).toEqual([[1], [4]])
    expect(startGame(s, 1).courts[0].teams).toEqual([[1], [4]])
  })

  it('allows a group that does not fit the matchmaking mode, as a deliberate choice', () => {
    let s = createSession('doubles', 1, { matchmaking: 'mixed' })
    const genders = ['M', 'F', 'M', 'F', 'M', 'M'] as const
    genders.forEach((gender, i) => {
      s = checkIn(s, { id: i + 1, name: 'P' + (i + 1), skill: 3, gender })
    })
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 2, 3, 4])
    const picked = replaceNextUp(s, 2, 5) // three men and one woman
    expect(nextGroup(picked)!.players.slice().sort()).toEqual([1, 3, 4, 5])
  })

  it('refuses a player who is not in the group, or a replacement who is not another session player', () => {
    const s = eight()
    expect(() => replaceNextUp(s, 5, 6)).toThrow('not in the next group')
    expect(() => replaceNextUp(s, 1, 1)).toThrow('another player')
    expect(() => replaceNextUp(s, 1, 99)).toThrow('another player')
    expect(() => replaceNextUp(withPlayers(createSession('doubles', 1), 3), 1, 2)).toThrow('no next group')
    const playing = fillCourts(withPlayers(createSession('doubles', 1), 5))
    expect(() => replaceNextUp(playing, 5, 1)).toThrow()
  })

  it('never changes the state it was given', () => {
    const s = eight()
    const snapshot = structuredClone(s)
    replaceNextUp(s, 1, 8)
    expect(s).toEqual(snapshot)
  })

  it('ends when someone in the group goes on a break, and never comes back by surprise', () => {
    let s = replaceNextUp(eight(), 1, 8)
    s = checkOut(s, 8)
    expect(s.nextUpPick).toBeUndefined()
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 2, 3, 4])
    s = checkIn(s, player(8))
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 2, 3, 4])
  })

  it('stays when someone outside the group goes on a break', () => {
    const s = checkOut(replaceNextUp(eight(), 1, 8), 5)
    expect(isNextUpPicked(s)).toBe(true)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([2, 3, 4, 8])
  })

  it('keeps the group when a court swap takes one of it: the player coming off takes their spot', () => {
    const start = replaceNextUp(fillCourts(withPlayers(createSession('doubles', 1), 9)), 5, 9) // 1-4 on court 1
    const before = nextGroup(start)!.teams
    expect(nextGroup(replacePlayer(start, 1, 1, 9))!.teams).toEqual(tradeIn(before, 9, 1))
    // Sent on a break instead, the one coming off is not waiting, so the group goes back to automatic.
    expect(replacePlayer(start, 1, 1, 9, { sendOnBreak: true }).nextUpPick).toBeUndefined()
  })

  it('keeps everyone else on the same team and in the same spot, however often it is changed', () => {
    let s = withPlayers(createSession('doubles', 2), 12)
    const { teams } = nextGroup(s)!
    s = replaceNextUp(s, teams[0][0], 9)
    s = replaceNextUp(s, teams[1][1], 10)
    s = replaceNextUp(s, 9, 11)
    expect(nextGroup(s)!.teams).toEqual([
      [11, teams[0][1]],
      [teams[1][0], 10],
    ])
  })

  it('lets two players of the group change places, so staff can change the teams', () => {
    const s = eight()
    const { teams } = nextGroup(s)!
    const t = replaceNextUp(s, teams[0][0], teams[1][0])
    expect(nextGroup(t)!.teams).toEqual([
      [teams[1][0], teams[0][1]],
      [teams[0][0], teams[1][1]],
    ])
    expect(t.queue).toEqual(s.queue)
  })

  it('brings a player back from a break into the group', () => {
    const t = replaceNextUp(checkOut(eight(), 8), 1, 8, 5000)
    expect(t.onBreak).toEqual([])
    expect(t.queue.at(-1)).toBe(8)
    expect(nextGroup(t)!.players).toContain(8)
    expect(nextGroup(t)!.players).not.toContain(1)
  })

  it('trades places with a player on a court', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 1), 8)) // 1-4 playing, 5-8 next up
    s = { ...s, queuedAt: { 5: 1000, 6: 1000, 7: 1000, 8: 1000 } }
    const court = s.courts[0].teams!
    const group = nextGroup(s)!
    const out = group.players[0]
    const t = replaceNextUp(s, out, 3, 61_000)
    expect(t.courts[0].teams).toEqual(tradeIn(court, 3, out))
    expect(t.courts[0].waited?.[out]).toBe(60)
    expect(nextGroup(t)!.teams).toEqual(tradeIn(group.teams, out, 3))
    expect(t.queue).toEqual(s.queue.map((id) => (id === out ? 3 : id)))
    expect(t.queuedAt?.[3]).toBe(61_000)
    expect(t.queuedAt?.[out]).toBeUndefined()
  })

  it('falls back to the automatic group if a chosen player is no longer waiting', () => {
    const s = { ...replaceNextUp(eight(), 1, 8), queue: [2, 3, 4, 5, 6, 7, 1] }
    expect(isNextUpPicked(s)).toBe(false)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([2, 3, 4, 5])
  })

  it('goes back to automatic when reset', () => {
    const s = resetNextUp(replaceNextUp(eight(), 1, 8))
    expect(isNextUpPicked(s)).toBe(false)
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 2, 3, 4])
    expect(resetNextUp(eight())).toEqual(eight())
  })
})

describe('taking a player out of Next up', () => {
  const eight = () => withPlayers(createSession('doubles', 2), 8)

  it('puts the first waiting player outside the group in their exact spot, and keeps them in the queue', () => {
    const s = eight()
    const { teams } = nextGroup(s)!
    const out = teams[0][0]
    expect(nextUpStandIn(s, out)).toBe(5)
    const t = dropFromNextUp(s, out)
    expect(nextGroup(t)!.teams).toEqual(tradeIn(teams, out, 5))
    expect(t.queue).toEqual(s.queue)
  })

  it('sends them on a break with the group still as it was', () => {
    const s = eight()
    const { teams } = nextGroup(s)!
    const out = teams[1][1]
    const t = dropFromNextUp(s, out, { onBreak: true })
    expect(t.onBreak).toEqual([out])
    expect(t.queue).not.toContain(out)
    expect(nextGroup(t)!.teams).toEqual(tradeIn(teams, out, 5))
  })

  it('with nobody to stand in, only allows a break', () => {
    const s = withPlayers(createSession('doubles', 1), 4)
    expect(nextUpStandIn(s, 1)).toBeUndefined()
    expect(() => dropFromNextUp(s, 1)).toThrow('No one is waiting')
    const t = dropFromNextUp(s, 1, { onBreak: true })
    expect(t.onBreak).toEqual([1])
    expect(nextGroup(t)).toBeNull()
  })

  it('refuses a player who is not next up', () => {
    expect(() => dropFromNextUp(eight(), 7)).toThrow('not in the next group')
    expect(nextUpStandIn(eight(), 7)).toBeUndefined()
  })
})

describe('partner locks that do not take effect at once', () => {
  const SUZY = 1
  const TONG = 5

  /** Suzy playing on Court 1, Tong waiting first in the queue, five more waiting behind. */
  function suzyAndTong() {
    let s = createSession('doubles', 2)
    for (let id = 1; id <= 12; id++) s = checkIn(s, player(id))
    s = startGame(s, 1) // 1-4 play; 5.. wait
    return s
  }

  it('waits when a partner is on a court, and changes nothing in the queue or the groups', () => {
    const s = suzyAndTong()
    const locked = lockPartners(s, SUZY, TONG)
    expect(locked.partners).toEqual([])
    expect(locked.pendingPartners).toEqual([{ pair: [SUZY, TONG], done: [] }])
    expect(locked.queue).toEqual(s.queue)
    expect(nextGroup(locked)!.players.slice().sort()).toEqual(nextGroup(s)!.players.slice().sort())
    expect(nextGroup(locked)!.players).toContain(TONG)
  })

  it('does not pull Suzy ahead of the line when her game ends: she joins the back, Tong keeps his turn', () => {
    const locked = lockPartners(suzyAndTong(), SUZY, TONG)
    const after = recordResult(locked, 1, 0).state
    expect(after.queue.slice(0, 8)).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    expect(after.queue.slice(8).sort()).toEqual([1, 2, 3, 4])
    expect(nextGroup(after)!.players.slice().sort()).toEqual([5, 6, 7, 8]) // Tong is still next up
    expect(after.partners).toEqual([]) // not in force yet
    expect(after.pendingPartners).toEqual([{ pair: [SUZY, TONG], done: [SUZY] }])
  })

  it('comes into force once both have finished a game, and the pair stands at the later partner spot', () => {
    let s = lockPartners(suzyAndTong(), SUZY, TONG)
    s = recordResult(s, 1, 0).state // Suzy finished; queue 5..12, then 1-4
    s = startGame(s, 1) // Tong plays with 6, 7, 8
    expect(s.courts[0].teams!.flat()).toContain(TONG)
    s = recordResult(s, 1, 0).state // Tong finished: the lock is now in force
    expect(s.pendingPartners).toBeUndefined()
    expect(s.partners).toEqual([[SUZY, TONG]])
    // Suzy's game ended first, Tong's second: both queued behind 9-12, Suzy ahead of Tong.
    expect(s.queue).toEqual([9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(nextGroup(s)!.players.slice().sort((a, b) => a - b)).toEqual([9, 10, 11, 12])
    // Once they play, the pair stands at Tong's (the later) spot: Suzy does not move up ahead of
    // 2, 3 and 4, and neither of them is pulled in before the players who queued between them.
    const later = startGame(s, 1)
    expect(later.queue).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(nextGroup(later)!.players.slice().sort((a, b) => a - b)).toEqual([2, 3, 4, 6])
  })

  it('a partner returning from a break does not jump the line', () => {
    // Tong (5) waits at the front, Suzy (1) is on a break and comes back at the back.
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 8; id++) s = checkIn(s, player(id))
    s = checkOut(s, 1)
    s = lockPartners(s, 1, 5) // one is on a break: waiting lock
    expect(s.pendingPartners).toHaveLength(1)
    s = checkIn(s, player(1))
    expect(s.queue).toEqual([2, 3, 4, 5, 6, 7, 8, 1])
    expect(nextGroup(s)!.players.slice().sort()).toEqual([2, 3, 4, 5])
  })

  it('an in-force pair never lets the later partner skip people who were waiting', () => {
    // Locked while both waited, then one goes on a break and returns at the back.
    let s = withPlayers(createSession('doubles', 1), 8)
    s = lockPartners(s, 1, 2)
    s = checkOut(s, 2)
    s = checkIn(s, player(2)) // queue: 1, 3..8, 2
    expect(s.queue).toEqual([1, 3, 4, 5, 6, 7, 8, 2])
    // The pair stands at 2's spot (the later one), behind everyone who was waiting.
    expect(nextGroup(s)!.players.slice().sort()).toEqual([3, 4, 5, 6])
  })

  it('is in force at once when both are waiting, standing together at the later partner’s spot', () => {
    const s = lockPartners(withPlayers(createSession('doubles', 1), 6), 2, 5)
    expect(s.partners).toEqual([[2, 5]])
    expect(s.pendingPartners).toBeUndefined()
    // 2 moves back to just before 5: nobody who waited is overtaken.
    expect(s.queue).toEqual([1, 3, 4, 2, 5, 6])
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 3, 4, 6])
  })

  it('is in force at once when both are in the same game', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), 5))
    const locked = lockPartners(s, 1, 2)
    expect(locked.partners).toEqual([[1, 2]])
    expect(locked.pendingPartners).toBeUndefined()
    expect(locked.queue).toEqual(s.queue)
  })

  it('waits when the two are on different courts, or when one is on a break', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 2), 8))
    expect(lockPartners(s, 1, 5).pendingPartners).toHaveLength(1)
    const onBreak = checkOut(withPlayers(createSession('doubles', 1), 3), 3)
    expect(lockPartners(onBreak, 1, 3).pendingPartners).toHaveLength(1)
  })

  it('says who is away and where', () => {
    const s = suzyAndTong()
    expect(lockStatus(s, SUZY, TONG)).toEqual({ inForce: false, away: [{ id: SUZY, courtName: 'Court 1' }] })
    expect(lockStatus(s, TONG, 6)).toEqual({ inForce: true })
    const brk = checkOut(s, TONG)
    expect(lockStatus(brk, SUZY, TONG)).toEqual({
      inForce: false,
      away: [{ id: SUZY, courtName: 'Court 1' }, { id: TONG, courtName: undefined }],
    })
    expect(lockStatus(fillCourts(withPlayers(createSession('doubles', 1), 5)), 1, 2)).toEqual({ inForce: true })
  })

  it('a game that is cancelled does not count as finished', () => {
    let s = lockPartners(suzyAndTong(), SUZY, TONG)
    s = cancelMatch(s, 1)
    expect(s.pendingPartners).toEqual([{ pair: [SUZY, TONG], done: [] }])
  })

  it('is refused for a player who already has a lock, in force or waiting', () => {
    const s = lockPartners(suzyAndTong(), SUZY, TONG)
    expect(() => lockPartners(s, SUZY, 6)).toThrow('already locked')
    expect(() => lockPartners(s, 6, TONG)).toThrow('already locked')
  })

  it('can be unlocked before it starts, by either partner', () => {
    const s = lockPartners(suzyAndTong(), SUZY, TONG)
    expect(unlockPartners(s, TONG).pendingPartners).toBeUndefined()
    expect(unlockPartners(s, SUZY).pendingPartners).toBeUndefined()
    expect(unlockPartners(s, 9)).toEqual(s)
  })

  it('is removed when one partner is swapped off the court or out of Next up', () => {
    const s = lockPartners(suzyAndTong(), SUZY, TONG)
    expect(replacePlayer(s, 1, SUZY, 6).pendingPartners).toBeUndefined()
    expect(replaceNextUp(s, TONG, 9).pendingPartners).toBeUndefined()
  })

  it('never changes the state it was given', () => {
    const s = suzyAndTong()
    const snapshot = structuredClone(s)
    const locked = lockPartners(s, SUZY, TONG)
    recordResult(locked, 1, 0)
    expect(s).toEqual(snapshot)
  })

  it('has no effect on the players’ live-board locks until it is in force', () => {
    const s = lockPartners(suzyAndTong(), SUZY, TONG)
    expect(s.partners).toEqual([])
  })
})

describe('setPlayerSkill', () => {
  const skilled = (skills: RosterPlayer['skill'][], matchmaking: 'balanced' | 'skill' = 'balanced') => {
    let s = createSession('doubles', 1, { matchmaking })
    skills.forEach((skill, i) => {
      s = checkIn(s, player(i + 1, skill))
    })
    return s
  }

  it('changes that player and nobody else', () => {
    const s = skilled([3, 3, 3, 3, 3])
    const changed = setPlayerSkill(s, 2, 5)
    expect(changed.players[2].skill).toBe(5)
    for (const id of [1, 3, 4, 5]) expect(changed.players[id]).toBe(s.players[id])
    expect(changed.players[2].name).toBe('P2')
    expect(changed.queue).toEqual(s.queue)
  })

  it('works for a player who is waiting, playing or on a break', () => {
    let s = fillCourts(skilled([3, 3, 3, 3, 3, 3]))
    s = checkOut(s, 5)
    for (const id of [1, 5, 6]) expect(setPlayerSkill(s, id, 6).players[id].skill).toBe(6)
  })

  it('returns the same state when the level does not change', () => {
    const s = skilled([3, 3])
    expect(setPlayerSkill(s, 1, 3)).toBe(s)
  })

  it('refuses a player who is not in the session and a level outside 1 to 6', () => {
    const s = skilled([3, 3])
    expect(() => setPlayerSkill(s, 9, 4)).toThrow('not in this session')
    expect(() => setPlayerSkill(s, 1, 0 as RosterPlayer['skill'])).toThrow(RangeError)
    expect(() => setPlayerSkill(s, 1, 7 as RosterPlayer['skill'])).toThrow(RangeError)
    expect(() => setPlayerSkill(s, 1, 2.5 as RosterPlayer['skill'])).toThrow(RangeError)
  })

  it('never changes the state it was given', () => {
    const s = skilled([3, 3, 3, 3])
    const snapshot = structuredClone(s)
    setPlayerSkill(s, 1, 6)
    expect(s).toEqual(snapshot)
  })

  it('re-balances the next group from the new level (skill-separated)', () => {
    const s = skilled([1, 6, 1, 6, 1, 6, 1], 'skill')
    expect(nextGroup(s)!.players.slice().sort()).toEqual([1, 3, 5, 7])
    // Player 3 turns out to be much better: the group no longer pairs them with the level-1s.
    const changed = setPlayerSkill(s, 3, 6)
    expect(nextGroup(changed)!.players.slice().sort()).not.toEqual([1, 3, 5, 7])
  })

  it('re-splits the next group into teams from the new level', () => {
    const s = skilled([6, 5, 2, 1])
    const key = (t: number[]) => t.slice().sort().join()
    expect(nextGroup(s)!.teams.map(key).sort()).toEqual(['1,4', '2,3'])
    const changed = setPlayerSkill(s, 4, 6) // levels now 6, 5, 2, 6
    expect(nextGroup(changed)!.teams.map(key).sort()).not.toEqual(['1,4', '2,3'])
  })

  it('keeps a hand-picked group as chosen, re-split with the new level', () => {
    const s = replaceNextUp(withPlayers(createSession('doubles', 2), 8), 1, 8)
    const before = nextGroup(s)!.players.slice().sort()
    const changed = setPlayerSkill(s, 8, 6)
    expect(isNextUpPicked(changed)).toBe(true)
    expect(nextGroup(changed)!.players.slice().sort()).toEqual(before)
  })

  it('leaves a game already on a court, and results already recorded, as they were', () => {
    const played = recordResult(fillCourts(skilled([3, 3, 3, 3, 3, 3, 3, 3])), 1, 0).state
    const s = fillCourts(played)
    const teams = structuredClone(s.courts[0].teams)
    const changed = setPlayerSkill(s, s.courts[0].teams!.flat()[0], 6)
    expect(changed.courts[0].teams).toEqual(teams)
    expect(changed.stats).toEqual(s.stats)
  })
})

describe('removing a player from the session', () => {
  const MIN = 60_000

  it('removes a waiting player who has not played completely', () => {
    const s = removePlayer(withPlayers(createSession('doubles', 1), 3), 2)
    expect(s.queue).toEqual([1, 3])
    expect(s.players[2]).toBeUndefined()
    expect(s.queuedAt?.[2]).toBeUndefined()
    expect(activeIds(s)).toEqual([1, 3])
  })

  it('removes a player on a break', () => {
    const s = removePlayer(checkOut(withPlayers(createSession('doubles', 1), 3), 3), 3)
    expect(s.onBreak).toEqual([])
    expect(s.players[3]).toBeUndefined()
  })

  it('takes a player off a court: the spot stays open and the game pauses', () => {
    const s = startGame(withPlayers(createSession('doubles', 1), 6), 1, { now: 0 })
    const [a] = s.courts[0].teams![0]
    const t = removePlayer(s, a, 2 * MIN)
    expect(t.courts[0].teams!.flat()).not.toContain(a)
    expect(t.courts[0].pausedAt).toBe(2 * MIN)
    expect(isShort(t.courts[0], t.mode)).toBe(true)
    expect(activeIds(t)).not.toContain(a)
    expect(t.queue).not.toContain(a)
    expect(t.onBreak).not.toContain(a)
  })

  it('takes a player out of the automatic Next up: the next group forms without them', () => {
    const s = withPlayers(createSession('doubles', 1), 5)
    const out = nextGroup(s)!.players[0]
    const t = removePlayer(s, out)
    expect(nextGroup(t)!.players).not.toContain(out)
    expect(t.queue).not.toContain(out)
  })

  it('puts a stand-in in a picked Next up spot', () => {
    let s = withPlayers(createSession('doubles', 1), 5)
    s = fillNextUpSpot(s, 0, 0, 2)
    const standIn = nextUpStandIn(s, 2)
    expect(standIn).toBeDefined()
    const t = removePlayer(s, 2)
    expect(nextGroup(t)!.players[0]).toBe(standIn)
    expect(t.players[2]).toBeUndefined()
  })

  it('ends locks, in force or waiting', () => {
    let s = withPlayers(createSession('doubles', 1), 4)
    s = lockPartners(s, 1, 2)
    s = lockPartners(checkOut(s, 3), 3, 4)
    expect(s.pendingPartners).toHaveLength(1)
    s = removePlayer(removePlayer(s, 1), 3)
    expect(s.partners).toEqual([])
    expect(s.pendingPartners).toBeUndefined()
  })

  it('keeps a player who played, so their results still count, and continues them on a new check-in', () => {
    let s = startGame(withPlayers(createSession('doubles', 1), 4), 1, { now: 0 })
    s = recordScore(s, 1, 11, 5, { now: 10 * MIN }).state
    const ranked = rankPlayers(s)
    expect(hasPlayed(s, 1)).toBe(true)
    const t = removePlayer(s, 1)
    expect(t.players[1]).toBeDefined()
    expect(activeIds(t)).not.toContain(1)
    expect(rankPlayers(t)).toEqual(ranked)
    const back = checkIn(t, t.players[1])
    expect(back.queue).toContain(1)
    expect(back.stats[1].games).toBe(1)
  })

  it('cannot lock a partner who was removed', () => {
    let s = startGame(withPlayers(createSession('doubles', 1), 5), 1, { now: 0 })
    s = recordScore(s, 1, 11, 5, { now: 1000 }).state
    s = removePlayer(s, 1)
    expect(() => lockPartners(s, 1, 5)).toThrow('Both players must be in the session')
  })

  it('refuses a player who is not in the session or already left', () => {
    const s = withPlayers(createSession('doubles', 1), 2)
    expect(() => removePlayer(s, 9)).toThrow('not in the session')
    expect(() => removePlayer(removePlayer(s, 1), 1)).toThrow('not in the session')
  })
})

describe('skill scales in a session', () => {
  const FOUR = {
    levels: [
      { label: 'Social', from: 1 },
      { label: 'Club', from: 3 },
      { label: 'Strong', from: 4 },
      { label: 'Pro', from: 5 },
    ],
  }

  it('gives a player the rating their new level starts at, and checks the level against the session’s scale', () => {
    let s = createSession('doubles', 1, { skillScale: FOUR })
    s = checkIn(s, { id: 1, name: 'Ann', skill: 2, rating: 3.2 })
    s = setPlayerSkill(s, 1, 3)
    expect(s.players[1]).toMatchObject({ skill: 3, rating: 4 })
    expect(() => setPlayerSkill(s, 1, 5)).toThrow('Skill level must be 1 to 4')
    expect(() => setCourtLevels(s, 1, [2, 5])).toThrow('from 1 to 4')
    expect(setCourtLevels(s, 1, [2, 4]).courts[0].levels).toEqual([2, 4])
    expect(setCourtLevels(s, 1, [1, 4]).courts[0]).not.toHaveProperty('levels')
  })

  it('moves everyone to their level on new levels, from their rating, and keeps courts on the same ratings', () => {
    // The default scale; Ann has a DUPR-style rating, Bob only his old level 6 (4.5).
    let s = createSession('doubles', 2)
    s = checkIn(s, { id: 1, name: 'Ann', skill: 4, rating: 3.742 })
    s = checkIn(s, { id: 2, name: 'Bob', skill: 6 })
    s = setCourtLevels(s, 1, [4, 6]) // 3.50 and up
    s = setCourtLevels(s, 2, [1, 3]) // up to 3.49
    const t = setSkillScale(s, FOUR)
    expect(t.skillScale).toEqual(FOUR)
    expect(t.players[1]).toMatchObject({ skill: 2, rating: 3.742 })
    expect(t.players[2]).toMatchObject({ skill: 3, rating: 4.5 })
    expect(t.courts[0].levels).toEqual([2, 4]) // 3.50+ falls in Club (3.0) and up
    expect(t.courts[1].levels).toEqual([1, 2]) // up to 3.49: Social and Club
  })

  it('copes with a court range beyond the session’s levels (set by an older app that knows six)', () => {
    let s = createSession('doubles', 1, { skillScale: FOUR })
    s = { ...s, courts: [{ ...s.courts[0], levels: [3, 6] }] }
    const t = setSkillScale(s, { levels: [{ label: 'Low', from: 1 }, { label: 'Mid', from: 3 }, { label: 'High', from: 4.5 }] })
    expect(t.courts[0].levels).toEqual([2, 3]) // from 4.0 (Strong) to the top
    const above = { ...s, courts: [{ ...s.courts[0], levels: [5, 6] as [number, number] }] }
    expect(setSkillScale(above, { levels: [{ label: 'Low', from: 1 }, { label: 'High', from: 4.5 }] }).courts[0].levels).toEqual([2, 2])
  })

  it('makes a court whose ratings now span the whole scale open to any level', () => {
    let s = setCourtLevels(createSession('doubles', 1), 1, [2, 6]) // 2.50 and up
    s = setSkillScale(s, { levels: [{ label: 'Low', from: 1 }, { label: 'High', from: 2.5 }] })
    expect(s.courts[0].levels).toEqual([2, 2])
    s = setSkillScale(s, { levels: [{ label: 'A', from: 1 }, { label: 'B', from: 4 }] })
    expect(s.courts[0]).not.toHaveProperty('levels')
  })
})

describe('lock scenarios: Lock now, holding, and the pair’s spot', () => {
  /** Court 1 in play; returns the session, the four playing and the ones waiting (in queue order). */
  function playing(count: number, courts = 1) {
    const s = fillCourts(withPlayers(createSession('doubles', courts), count))
    return { s, onCourt: s.courts[0].teams!.flat(), waiting: s.queue }
  }
  const together = (s: SessionState, a: number, b: number) => {
    const g = nextGroup(s)?.players ?? []
    return g.includes(a) === g.includes(b)
  }

  it('row 4, Lock now: the waiting partner holds until the other’s game ends, then they queue together at the back', () => {
    const { s, onCourt, waiting } = playing(8)
    const [ann] = waiting
    const [bob] = onCourt
    const locked = lockPartners(s, ann, bob, { now: true })
    expect(locked.partners).toEqual([[ann, bob]])
    expect(locked.pendingPartners).toBeUndefined()
    expect(heldPlayers(locked)).toEqual([ann])
    // Three others wait, but Ann holds: no group, and staff are told one more player is needed.
    expect(nextGroup(locked)).toBeNull()
    expect(waitingMessage(locked)).toBe('Waiting for 1 more player.')

    const after = recordScore(locked, 1, 11, 5, { now: 1000 }).state
    expect(heldPlayers(after)).toEqual([])
    expect(after.queue.indexOf(bob)).toBeGreaterThan(after.queue.indexOf(ann))
    expect(together(after, ann, bob)).toBe(true)
  })

  it('row 4, Wait for 1 game: the waiting partner still plays on their own meanwhile', () => {
    const { s, onCourt, waiting } = playing(8)
    const locked = lockPartners(s, waiting[0], onCourt[0])
    expect(locked.pendingPartners).toHaveLength(1)
    expect(heldPlayers(locked)).toEqual([])
    expect(nextGroup(locked)!.players.slice().sort()).toEqual(waiting.slice().sort())
  })

  it('row 3: locking a hand-picked Next up player with someone outside the pick drops the pick', () => {
    let s = withPlayers(createSession('doubles', 1), 6)
    s = fillNextUpSpot(s, 0, 0, 1)
    expect(isNextUpPicked(s)).toBe(true)
    s = lockPartners(s, 1, 6)
    expect(s.nextUpPick).toBeUndefined()
    expect(s.queue).toEqual([2, 3, 4, 5, 1, 6])
  })

  it('row 8: two partners on different courts, Lock now: the first to finish holds for the second', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 2), 8))
    const [ann] = s.courts[0].teams!.flat()
    const [bob] = s.courts[1].teams!.flat()
    let t = lockPartners(s, ann, bob, { now: true })
    t = recordScore(t, 1, 11, 3, { now: 1000 }).state
    expect(heldPlayers(t)).toEqual([ann])
    t = recordScore(t, 2, 11, 3, { now: 2000 }).state
    expect(heldPlayers(t)).toEqual([])
    expect(together(t, ann, bob)).toBe(true)
  })

  it('rows 9 and 28: Lock now with a partner on a break holds until they come back, at the back', () => {
    let s = checkOut(withPlayers(createSession('doubles', 1), 6), 6)
    s = lockPartners(s, 1, 6, { now: true })
    expect(heldPlayers(s)).toEqual([1])
    expect(nextGroup(s)!.players.slice().sort()).toEqual([2, 3, 4, 5])
    s = checkIn(s, player(6))
    expect(heldPlayers(s)).toEqual([])
    expect(s.queue.at(-1)).toBe(6)
  })

  it('row 27: an active pair where one takes a break: the other holds', () => {
    let s = lockPartners(withPlayers(createSession('doubles', 1), 6), 1, 2)
    s = checkOut(s, 2)
    expect(s.partners).toEqual([[1, 2]])
    expect(heldPlayers(s)).toEqual([1])
    expect(nextGroup(s)!.players).not.toContain(1)
  })

  it('row 17: the partner’s game is cancelled (players back to the front): the pair stands at the later spot', () => {
    const { s, onCourt, waiting } = playing(8)
    const [ann] = waiting
    const [bob] = onCourt
    const t = cancelMatch(lockPartners(s, ann, bob, { now: true }), 1, 1000)
    expect(heldPlayers(t)).toEqual([])
    expect(t.queue.indexOf(ann)).toBeGreaterThan(t.queue.indexOf(bob))
    expect(together(t, ann, bob)).toBe(true)
  })

  it('row 31: a waiting lock comes into force after both have played; from then the pair holds for each other', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 2), 8))
    const [ann] = s.courts[0].teams!.flat()
    const [bob] = s.courts[1].teams!.flat()
    let t = lockPartners(s, ann, bob)
    t = recordScore(t, 1, 11, 3, { now: 1000 }).state
    expect(t.partners).toEqual([])
    t = recordScore(t, 2, 11, 3, { now: 2000 }).state
    expect(t.partners).toEqual([[ann, bob]])
    t = checkOut(t, bob)
    expect(heldPlayers(t)).toEqual([ann])
  })

  it('row 5: a partner on a court being set up: Lock now holds; clearing the court brings the pair together', () => {
    let s = withPlayers(createSession('doubles', 1), 6)
    s = fillCourtSpot(s, 1, 0, 6, 0, 0) // Fay put on the court by hand, game not started
    s = lockPartners(s, 1, 6, { now: true })
    expect(heldPlayers(s)).toEqual([1])
    s = cancelMatch(s, 1, 1000) // "Clear court": Fay back to the queue
    expect(heldPlayers(s)).toEqual([])
    const g = nextGroup(s)?.players ?? []
    expect(g.includes(1)).toBe(g.includes(6))
  })

  it('row 6: a partner in a paused game (a spot left open): Lock now holds just the same', () => {
    const { s, onCourt, waiting } = playing(8)
    const paused = removeFromCourt(s, 1, onCourt[3], { now: 500 })
    const t = lockPartners(paused, waiting[0], onCourt[0], { now: true })
    expect(heldPlayers(t)).toEqual([waiting[0]])
  })

  it('rows 10 and 11: both away, Lock now: whoever is back in the queue first holds for the other', () => {
    let s = checkOut(checkOut(withPlayers(createSession('doubles', 1), 6), 5), 6)
    s = lockPartners(s, 5, 6, { now: true })
    expect(s.partners).toEqual([[5, 6]])
    s = checkIn(s, player(5))
    expect(heldPlayers(s)).toEqual([5])
    s = checkIn(s, player(6))
    expect(heldPlayers(s)).toEqual([])
    const { s: court, onCourt, waiting } = playing(8)
    const t = lockPartners(checkOut(court, waiting[0]), waiting[0], onCourt[0], { now: true })
    expect(heldPlayers(t)).toEqual([])
    expect(heldPlayers(recordScore(t, 1, 11, 2, { now: 1000 }).state)).toEqual([onCourt[0]])
  })

  it('row 18: the partner’s court is closed with the game: the pair stands at the later spot', () => {
    const { s, onCourt, waiting } = playing(10, 2)
    const t = closeCourt(lockPartners(s, waiting[0], onCourt[0], { now: true }), 1, 1000)
    expect(heldPlayers(t)).toEqual([])
    const g = nextGroup(t)?.players ?? []
    expect(g.includes(waiting[0])).toBe(g.includes(onCourt[0]))
  })

  it('row 30: staff can still hand-pick a held player into Next up; the lock stays', () => {
    const { s, onCourt, waiting } = playing(8)
    const held = waiting[0]
    let t = lockPartners(s, held, onCourt[0], { now: true })
    t = fillNextUpSpot(t, 0, 0, held)
    expect(nextGroup(t)?.players ?? []).toContain(held)
    expect(t.partners).toEqual([[held, onCourt[0]]])
  })

  it('never offers a held player as a Next up stand-in, nor to fill a pinned group', () => {
    const { s, onCourt, waiting } = playing(10)
    const held = waiting[4]
    const t = lockPartners(s, held, onCourt[0], { now: true })
    expect(nextUpStandIn(t, waiting[0])).toBe(waiting[5])
    const pinned = fillNextUpSpot(resetNextUp(t), 0, 0, waiting[0])
    expect(nextGroup(pinned)?.players ?? []).not.toContain(held)
  })

  it('row 33: courts kept for levels: a held player is in no lane', () => {
    let s = checkOut(withPlayers(createSession('doubles', 2), 6), 6)
    s = setCourtLevels(s, 1, [3, 6])
    s = lockPartners(s, 1, 6, { now: true })
    for (const lane of nextGroups(s)) expect(lane.group?.players ?? []).not.toContain(1)
  })
})
