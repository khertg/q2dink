import { describe, expect, it } from 'vitest'
import {
  checkIn,
  createSession,
  markNotStarted,
  pauseSession,
  recordResult,
  recordScore,
  setCourtLevels,
  startGame,
  startSessionClock,
} from '@/rotation/engine'
import { fillCourts } from '@/rotation/testing'
import type { SessionState } from '@/rotation/types'
import {
  parseFullBackup,
  parsePublicSnapshot,
  toFullBackup,
  toHistoryBackup,
  toPublicSnapshot,
  toViewerState,
} from './snapshot'

function playedSession(): SessionState {
  let s = createSession('doubles', 1, { matchmaking: 'mixed' })
  for (let id = 1; id <= 5; id++) {
    s = checkIn(s, { id, name: `P${id}`, skill: 3, gender: id % 2 ? 'M' : 'F' })
  }
  return recordResult(fillCourts(s), 1, 0).state
}

describe('public snapshot', () => {
  it('carries each court’s levels and the next group per level, and none without level courts', () => {
    let s = setCourtLevels(createSession('doubles', 2), 1, [4, 6])
    const skills = [5, 2, 6, 1, 4, 3, 5, 2] as const
    skills.forEach((skill, i) => (s = checkIn(s, { id: i + 1, name: `P${i + 1}`, skill })))
    const snap = parsePublicSnapshot(toPublicSnapshot('Club', s))!
    expect(snap.courts[0].levels).toEqual([4, 6])
    expect(snap.courts[1]).not.toHaveProperty('levels')
    expect(snap.nextUpLanes?.map((lane) => lane.levels)).toEqual([[4, 6], null])
    expect([...snap.nextUpLanes![0].players].sort()).toEqual([1, 3, 5, 7])
    expect(snap.nextUp).toEqual(snap.nextUpLanes![0].players)
    expect(toViewerState(snap).courts[0].levels).toEqual([4, 6])

    expect(toPublicSnapshot('Club', playedSession())).not.toHaveProperty('nextUpLanes')
  })

  it('leaves out genders and result history', () => {
    const snap = toPublicSnapshot('Club', playedSession())
    const json = JSON.stringify(snap)
    expect(json).not.toContain('gender')
    expect(json).not.toContain('lastResult')
    expect(snap.players[1]).toEqual({ id: 1, name: 'P1', skill: 3 })
  })

  it('round-trips through JSON and validation', () => {
    const snap = toPublicSnapshot('Club', playedSession())
    expect(parsePublicSnapshot(JSON.parse(JSON.stringify(snap)))).toEqual(snap)
  })

  it('rebuilds a viewer state that the display components can use', () => {
    const session = playedSession()
    const viewer = toViewerState(toPublicSnapshot('Club', session))
    expect(viewer.queue).toEqual(session.queue)
    expect(viewer.courts).toEqual(session.courts)
    expect(viewer.stats).toEqual(session.stats)
    expect(viewer.lastResult).toEqual({})
  })

  it('carries scores and time played to the viewer, and leaves the start time off the wire', () => {
    let s = createSession('doubles', 1)
    for (let id = 1; id <= 4; id++) s = checkIn(s, { id, name: 'P' + id, skill: 3 })
    s = startGame(s, 1, { now: 1_000_000 })
    const playing = toPublicSnapshot('Club', s)
    expect(playing.courts[0]).toEqual({ id: 1, name: 'Court 1', teams: s.courts[0].teams })
    s = recordScore(s, 1, 11, 7, { now: 1_000_000 + 600_000 }).state
    const snap = parsePublicSnapshot(JSON.parse(JSON.stringify(toPublicSnapshot('Club', s))))!
    expect(Object.values(snap.stats).map((st) => st.secondsPlayed)).toEqual([600, 600, 600, 600])
    expect(toViewerState(snap).stats).toEqual(s.stats)
    expect(Object.values(snap.stats).reduce((sum, st) => sum + st.pointsFor, 0)).toBe(11 * 2 + 7 * 2)
  })

  it('rejects malformed or unknown-version data instead of rendering it', () => {
    const good = toPublicSnapshot('Club', playedSession())
    const bad: unknown[] = [
      null,
      'text',
      [],
      {},
      { ...good, schemaVersion: 2 },
      { ...good, mode: 'triples' },
      { ...good, location: 42 },
      { ...good, courts: [{ id: 1, teams: [[1], 'x'] }] },
      { ...good, queue: ['a'] },
      { ...good, players: { 1: { id: 1, name: 'A', skill: 9 } } },
      { ...good, stats: null },
    ]
    for (const value of bad) expect(parsePublicSnapshot(value)).toBeNull()
  })
})

describe('full backup', () => {
  it('round-trips a session for resuming on another device', () => {
    const session = playedSession()
    const restored = parseFullBackup(JSON.parse(JSON.stringify(toFullBackup('Club', session))))
    expect(restored).toEqual({ location: 'Club', session, lifetimeCounted: {} })
  })

  it('carries what a saved session had already added to the all-time totals', () => {
    const session = playedSession()
    const counted = { 1: { games: 1, wins: 1, losses: 0 }, 2: { games: 1, wins: 0, losses: 1 } }
    const restored = parseFullBackup(JSON.parse(JSON.stringify(toHistoryBackup('Club', session, 6, counted))))
    expect(restored?.lifetimeCounted).toEqual(counted)
    expect(restored?.session).toEqual(session)
  })

  it('keeps the session shape a history entry was saved in, so it can be upgraded later', () => {
    expect(toHistoryBackup('Club', playedSession(), 4, {}).storeVersion).toBe(4)
  })

  it('trusts only well-formed counts', () => {
    const base = toFullBackup('Club', playedSession())
    const counted = (lifetimeCounted: unknown) => parseFullBackup({ ...base, lifetimeCounted })?.lifetimeCounted
    expect(counted('x')).toEqual({})
    expect(counted([1, 2])).toEqual({})
    expect(counted({ 1: { games: -1, wins: 0, losses: 0 } })).toEqual({})
    expect(counted({ 1: { games: 'a', wins: 0, losses: 0 } })).toEqual({})
    expect(counted({ x: { games: 1, wins: 1, losses: 0 } })).toEqual({})
    expect(counted({ 1: { games: 1, wins: 1, losses: 0 }, 2: null })).toEqual({ 1: { games: 1, wins: 1, losses: 0 } })
  })

  it('upgrades a backup made by an older session version', () => {
    const { stats: _stats, ...old } = playedSession()
    const restored = parseFullBackup({
      schemaVersion: 1,
      storeVersion: 3,
      location: 'Club',
      session: old,
    })
    expect(restored?.session.stats).toEqual({})
  })

  it('upgrades a v6 backup whose stats have no scores or time', () => {
    const { stats, ...rest } = playedSession()
    const v6Stats = Object.fromEntries(
      Object.entries(stats).map(([id, st]) => [id, { games: st.games, wins: st.wins, losses: st.losses, opponentSkill: st.opponentSkill }]),
    )
    const restored = parseFullBackup({ schemaVersion: 1, storeVersion: 6, location: 'Club', session: { ...rest, stats: v6Stats } })
    expect(restored?.session.stats).toEqual(stats)
    expect(Object.values(restored!.session.stats)[0]).toMatchObject({ pointsFor: 0, scoredGames: 0, secondsPlayed: 0 })
  })

  it('rejects junk', () => {
    expect(parseFullBackup(null)).toBeNull()
    expect(parseFullBackup({ schemaVersion: 1, location: 'x', storeVersion: 4, session: 'no' })).toBeNull()
    expect(parseFullBackup({ schemaVersion: 9, location: 'x', storeVersion: 4, session: {} })).toBeNull()
  })
})

describe('the session clock on the live page', () => {
  it('says a session is paused or not started, and never which device paused it', () => {
    const notStarted = markNotStarted(createSession('doubles', 1), 0)
    expect(toPublicSnapshot('Club', notStarted).status).toBe('notStarted')
    const running = startSessionClock(notStarted, 1)
    expect(toPublicSnapshot('Club', running)).not.toHaveProperty('status')
    const paused = toPublicSnapshot('Club', pauseSession(running, 2, { deviceId: 'd', name: 'Front desk' }))
    expect(paused.status).toBe('paused')
    expect(JSON.stringify(paused)).not.toContain('Front desk')
  })
})
