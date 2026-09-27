import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RosterPlayer } from '@/rotation/types'

// The store persists to localStorage; give the node test environment a tiny in-memory one.
vi.hoisted(() => {
  const data = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  })
})

import { activePlayerCount, useSessionStore } from './session'

const player = (id: number): RosterPlayer => ({ id, name: `P${id}`, skill: 3 })
const store = () => useSessionStore.getState()

/** A session created and started straight away, as most tests want. */
function startRunning(...args: Parameters<ReturnType<typeof store>['startSession']>) {
  store().startSession(...args)
  store().startClock()
}

function checkInMany(count: number) {
  for (let id = 1; id <= count; id++) store().checkInPlayer(player(id))
}

beforeEach(() => {
  useSessionStore.setState({ location: '', session: null, previous: null, parked: {}, endedSessionIds: [], base: null, pending: [] })
})

describe('session store', () => {
  describe('the public live page', () => {
    it('keeps a new session off it until staff go live, and can take it off again', () => {
      startRunning('Club', 'doubles', 1)
      expect(store().session!.live).toBe(false)
      store().setLive(true)
      expect(store().session!.live).toBe(true)
      store().setLive(false)
      expect(store().session!.live).toBe(false)
    })

    it('keeps the pending result undo, and undoing never changes whether it is live', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().recordScore(1, 11, 5)
      store().setLive(true)
      expect(store().undo()).toBe(true)
      expect(store().session!.live).toBe(true)
      expect(store().session!.courts[0].teams).not.toBeNull()
    })
  })

  it('starts a session with empty courts', () => {
    startRunning('Downtown Club', 'doubles', 2)
    expect(store().location).toBe('Downtown Club')
    expect(store().session?.courts).toHaveLength(2)
    expect(store().session?.queue).toEqual([])
  })

  it('does not start a game by itself, however many players check in', () => {
    startRunning('Club', 'doubles', 2)
    checkInMany(8)
    expect(store().session!.courts.every((c) => c.teams === null)).toBe(true)
    expect(store().session!.queue).toHaveLength(8)
  })

  it('starts the next group on the chosen court', () => {
    startRunning('Club', 'doubles', 2)
    checkInMany(6)
    store().startGame(2)
    expect(store().session!.courts[0].teams).toBeNull()
    expect(store().session!.courts[1].teams?.flat().sort()).toEqual([1, 2, 3, 4])
    expect(store().session!.queue).toEqual([5, 6])
  })

  it('refuses to start with too few players and changes nothing', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(3)
    expect(() => store().startGame(1)).toThrow('Not enough players')
    expect(store().session!.queue).toEqual([1, 2, 3])
  })

  it('clears the pending result undo when a game starts', () => {
    startRunning('Club', 'doubles', 2)
    checkInMany(8)
    store().startGame(1)
    store().recordResult(1, 0)
    store().startGame(1)
    expect(store().undo()).toBe(false)
  })

  describe('renaming the session', () => {
    it('trims the new name and refuses an empty or too long one', () => {
      startRunning('Tuesday', 'doubles', 1)
      store().renameSession('  Tuesday open play  ')
      expect(store().location).toBe('Tuesday open play')
      expect(() => store().renameSession('   ')).toThrow('Enter a session name.')
      expect(() => store().renameSession('x'.repeat(121))).toThrow(/120 characters/)
      expect(store().location).toBe('Tuesday open play')
    })

    it('is only waiting to be sent while the session is shared with the club', () => {
      startRunning('Tuesday', 'doubles', 1)
      store().renameSession('Not shared')
      expect(store().locationPending).toBe(false)

      store().shareSession()
      store().renameSession('Shared')
      expect(store().locationPending).toBe(true)
    })

    it('keeps a rename not sent yet when another device moves the club copy on, and takes theirs otherwise', () => {
      startRunning('Tuesday', 'doubles', 1)
      store().shareSession()
      const clubCopy = store().session!

      store().rebaseOnto(1, clubCopy, 'Their name')
      expect(store().location).toBe('Their name')

      store().renameSession('My name')
      store().rebaseOnto(2, clubCopy, 'Their newer name')
      expect(store().location).toBe('My name')
    })

    it('is sent once the club takes the name, but not if it changed again meanwhile', () => {
      startRunning('Tuesday', 'doubles', 1)
      store().shareSession()
      store().renameSession('First')
      store().renameSession('Second')
      store().confirmPublished(0, store().session!, 1, 'First')
      expect(store().locationPending).toBe(true)
      store().confirmPublished(0, store().session!, 2, 'Second')
      expect(store().locationPending).toBe(false)
    })
  })

  describe('renaming a player', () => {
    it('changes the name for the rest of the session and survives a reload', async () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().renamePlayer(2, 'Anne')
      expect(store().session!.players[2].name).toBe('Anne')
      await useSessionStore.persist.rehydrate()
      expect(store().session!.players[2].name).toBe('Anne')
    })

    it('keeps the pending result undo, and undoing never brings the old name back', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().recordScore(1, 11, 5)
      store().renamePlayer(3, 'Cyrus')
      expect(store().undo()).toBe(true)
      expect(store().session!.players[3].name).toBe('Cyrus')
    })

    it('refuses a taken name and changes nothing', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(2)
      const before = store().session
      expect(() => store().renamePlayer(1, 'p2')).toThrow('already in this session')
      expect(store().session).toBe(before)
    })
  })

  describe('changing a skill level', () => {
    it('changes the level for the rest of the session and survives a reload', async () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().setPlayerSkill(2, 6)
      expect(store().session!.players[2].skill).toBe(6)
      await useSessionStore.persist.rehydrate()
      expect(store().session!.players[2].skill).toBe(6)
    })

    it('keeps the pending result undo, and undoing never reverts the level', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().recordScore(1, 11, 5)
      store().setPlayerSkill(3, 5)
      expect(store().undo()).toBe(true)
      expect(store().session!.players[3].skill).toBe(5)
      expect(store().session!.courts[0].teams).not.toBeNull()
    })

    it('refuses a player who is not in the session and changes nothing', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(2)
      const before = store().session
      expect(() => store().setPlayerSkill(9, 4)).toThrow()
      expect(store().session).toBe(before)
    })
  })

  describe('session identity', () => {
    it('gives each new session its own id and start time, with nothing counted yet', () => {
      startRunning('One', 'doubles', 1)
      const first = store()
      expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(first.startedAt).toBeGreaterThan(0)
      expect(first.lifetimeCounted).toEqual({})
      store().endSession()
      startRunning('Two', 'doubles', 1)
      expect(store().sessionId).not.toBe(first.sessionId)
    })

    it('is cleared when the session ends', () => {
      startRunning('One', 'doubles', 1)
      store().markLifetimeCounted({ 1: { games: 2, wins: 1, losses: 1 } })
      store().endSession()
      expect(store()).toMatchObject({ sessionId: '', startedAt: 0, lifetimeCounted: {}, session: null })
    })

    it('is kept when a session is resumed, so ending it again updates the same history entry', () => {
      startRunning('One', 'doubles', 1)
      const session = store().session!
      const meta = { sessionId: 'abc', startedAt: 123, lifetimeCounted: { 1: { games: 1, wins: 1, losses: 0 } } }
      store().endSession()
      store().loadSession('One', session, meta)
      expect(store()).toMatchObject({ ...meta, location: 'One' })
    })

    it('gets a fresh identity when loaded without one (a session resumed from the club’s live backup)', () => {
      startRunning('One', 'doubles', 1)
      const session = store().session!
      store().endSession()
      store().loadSession('One', session)
      expect(store().sessionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(store().lifetimeCounted).toEqual({})
    })

    it('remembers what was counted, and survives a reload', async () => {
      startRunning('One', 'doubles', 1)
      store().markLifetimeCounted({ 1: { games: 2, wins: 1, losses: 1 } })
      const { sessionId } = store()
      await useSessionStore.persist.rehydrate()
      expect(store().sessionId).toBe(sessionId)
      expect(store().lifetimeCounted).toEqual({ 1: { games: 2, wins: 1, losses: 1 } })
    })

    it('gives a session that was already running before history existed an identity on upgrade', async () => {
      startRunning('Old', 'doubles', 1)
      const session = store().session!
      localStorage.setItem('q2dink-session', JSON.stringify({ state: { location: 'Old', session }, version: 5 }))
      await useSessionStore.persist.rehydrate()
      expect(store().location).toBe('Old')
      expect(store().sessionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(store().startedAt).toBeGreaterThan(0)
      expect(store().lifetimeCounted).toEqual({})
    })

    it('has no identity when an upgraded store had no session running', async () => {
      localStorage.setItem('q2dink-session', JSON.stringify({ state: { location: '', session: null }, version: 5 }))
      await useSessionStore.persist.rehydrate()
      expect(store()).toMatchObject({ session: null, sessionId: '', startedAt: 0 })
    })
  })

  describe('resuming after ending', () => {
    afterEach(() => vi.useRealTimers())

    it('freezes a queued player\'s wait, and an in-progress game\'s elapsed time, across the gap', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      startRunning('One', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      // Checks in after the game starts, so still waiting when the session ends.
      store().checkInPlayer(player(5))

      vi.setSystemTime(new Date('2026-01-01T10:05:00Z')) // ended 5 minutes later
      const session = store().session!
      const endedAt = Date.now()

      vi.setSystemTime(new Date('2026-01-02T10:05:00Z')) // resumed a full day later
      store().loadSession('One', session, { sessionId: 'abc', startedAt: 0, lifetimeCounted: {}, endedAt })

      // Waited 5 minutes when it ended; resuming a day later must not add that day to it.
      expect(Date.now() - store().session!.queuedAt![5]).toBe(5 * 60 * 1000)
      // The in-progress game had been going 5 minutes when it ended; same freeze.
      expect(Date.now() - store().session!.courts[0].startedAt!).toBe(5 * 60 * 1000)
    })

    it('does not shift anything when resuming a session that never ended (no endedAt given)', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      startRunning('One', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().checkInPlayer(player(5))
      const session = store().session!
      const queuedAtBefore = session.queuedAt![5]
      const startedAtBefore = session.courts[0].startedAt!

      vi.setSystemTime(new Date('2026-01-02T10:00:00Z'))
      store().loadSession('One', session)

      expect(store().session!.queuedAt![5]).toBe(queuedAtBefore)
      expect(store().session!.courts[0].startedAt).toBe(startedAtBefore)
    })
  })

  describe('checking in several players', () => {
    const queuedNames = () => store().session!.queue.map((id) => store().session!.players[id].name)

    it('queues them in the order given, numbered by the session, without starting anything', () => {
      startRunning('Club', 'doubles', 1)
      expect(store().checkInPlayers([player(3), player(1), player(2), player(4)])).toBe(4)
      expect(queuedNames()).toEqual(['P3', 'P1', 'P2', 'P4'])
      // The session's own ids, the same on every staff device: never this device's roster ids.
      expect(store().session!.queue).toEqual([1, 2, 3, 4])
      expect(store().session!.courts[0].teams).toBeNull()
    })

    it('skips anyone already checked in, matched by name, and says how many were new', () => {
      startRunning('Club', 'doubles', 1)
      store().checkInPlayer(player(2))
      expect(store().checkInPlayers([player(1), player(2), player(3), player(3)])).toBe(2)
      expect(queuedNames()).toEqual(['P2', 'P1', 'P3'])
      expect(store().checkInPlayer({ id: 99, name: ' p1 ', skill: 3 })).toBe(false)
    })

    it('clears the pending result undo once, and does nothing for an empty or repeated list', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().recordResult(1, 0)
      const before = store().session
      expect(store().checkInPlayers([])).toBe(0)
      expect(store().checkInPlayers([player(1)])).toBe(0)
      expect(store().session).toBe(before)
      expect(store().undo()).toBe(true) // still possible: nothing changed

      store().recordResult(1, 0)
      expect(store().checkInPlayers([player(5), player(6)])).toBe(2)
      expect(store().undo()).toBe(false)
    })
  })

  it('reports false when a player is checked in twice', () => {
    startRunning('Club', 'doubles', 1)
    expect(store().checkInPlayer(player(1))).toBe(true)
    expect(store().checkInPlayer(player(1))).toBe(false)
  })

  it('requeues players after a result and leaves the court open', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(8)
    store().startGame(1)
    store().recordResult(1, 0)
    expect(store().session!.courts[0].teams).toBeNull()
    expect(store().session!.queue.slice(0, 4).sort()).toEqual([5, 6, 7, 8])
    expect(store().session!.queue.slice(4).sort()).toEqual([1, 2, 3, 4])
  })

  it('undoes the last result', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(8)
    store().startGame(1)
    const before = store().session
    store().recordResult(1, 1)
    expect(store().undo()).toBe(true)
    expect(store().session).toEqual(before)
  })

  it('refuses to undo after another change so later actions are not lost', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(8)
    store().startGame(1)
    store().recordResult(1, 0)
    store().checkInPlayer(player(9))
    expect(store().undo()).toBe(false)
    expect(store().session!.queue).toContain(9)
  })

  it('cancels a match and puts its players back in the queue', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(4)
    store().startGame(1)
    store().cancelMatch(1)
    expect(store().session!.courts[0].teams).toBeNull()
    expect(store().session!.queue).toHaveLength(4)
  })

  it('checks a waiting player out to a break', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(2)
    store().checkOutPlayer(1)
    expect(store().session!.onBreak).toEqual([1])
    expect(activePlayerCount(store().session!)).toBe(1)
  })

  it('uses the chosen game length', () => {
    startRunning('Club', 'doubles', 1, { avgGameMinutes: 20 })
    expect(store().session!.avgGameMinutes).toBe(20)
  })

  it('keeps a pending undo and does not revert the game length when it changes', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(8)
    store().startGame(1)
    store().recordResult(1, 0)
    store().setAvgGameMinutes(30)
    expect(store().undo()).toBe(true)
    expect(store().session!.avgGameMinutes).toBe(30)
    expect(store().session!.courts[0].teams?.flat().sort()).toEqual([1, 2, 3, 4])
  })

  it('replaces a playing player with a chosen waiting one', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(6)
    store().startGame(1)
    store().replacePlayer(1, 1, 6)
    expect(store().session!.courts[0].teams!.flat()).toContain(6)
    expect(store().session!.onBreak).toEqual([])
    expect(store().session!.queue).toEqual([1, 5])
  })

  it('can send the player who comes off on a break instead', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(6)
    store().startGame(1)
    store().replacePlayer(1, 1, 6, { sendOnBreak: true })
    expect(store().session!.onBreak).toEqual([1])
    expect(store().session!.queue).toEqual([5])
  })

  describe('changing who is next up', () => {
    it('keeps the chosen group until a game starts, and clears the pending result undo', () => {
      startRunning('Club', 'doubles', 2)
      checkInMany(8)
      store().startGame(1)
      store().recordResult(1, 0)
      store().replaceNextUp(5, 1)
      expect(store().undo()).toBe(false)
      expect(store().session!.nextUpPick).toBeDefined()
      store().startGame(2)
      expect(store().session!.courts[1].teams!.flat()).toContain(1)
      expect(store().session!.nextUpPick).toBeUndefined()
    })

    it('can be reset, and survives a reload', async () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(6)
      store().replaceNextUp(1, 6)
      await useSessionStore.persist.rehydrate()
      expect(store().session!.nextUpPick).toEqual(expect.arrayContaining([6]))
      store().resetNextUp()
      expect(store().session!.nextUpPick).toBeUndefined()
    })

    it('refuses an impossible change and changes nothing', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(6)
      const before = store().session
      expect(() => store().replaceNextUp(5, 6)).toThrow()
      expect(store().session).toBe(before)
    })
  })

  it('starts a match with the locked pair on one team, and locking never starts one', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(4)
    store().lockPartners(1, 3)
    expect(store().session!.courts[0].teams).toBeNull()
    store().startGame(1)
    const teams = store().session!.courts[0].teams!
    expect(teams.some((t) => t.includes(1) && t.includes(3))).toBe(true)
  })

  it('starts an open mixed court by hand', () => {
    startRunning('Club', 'doubles', 1, { matchmaking: 'mixed' })
    for (let id = 1; id <= 4; id++) {
      store().checkInPlayer({ id, name: `P${id}`, skill: 3, gender: 'M' })
    }
    expect(() => store().startGame(1)).toThrow('Not enough players')
    store().startGame(1, { ignoreMode: true })
    expect(store().session!.courts[0].teams!.flat().sort()).toEqual([1, 2, 3, 4])
  })

  it('tracks stats per result and undo reverts them', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(4)
    store().startGame(1)
    store().recordResult(1, 0)
    expect(Object.keys(store().session!.stats)).toHaveLength(4)
    expect(store().undo()).toBe(true)
    expect(store().session!.stats).toEqual({})
  })

  describe('scores and time played', () => {
    afterEach(() => vi.useRealTimers())

    it('records a score, deriving the winner', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      const [teamA, teamB] = store().session!.courts[0].teams!
      store().recordScore(1, 7, 11)
      expect(store().session!.courts[0].teams).toBeNull()
      for (const id of teamB) {
        expect(store().session!.stats[id]).toMatchObject({ wins: 1, pointsFor: 11, pointsAgainst: 7, scoredGames: 1 })
      }
      for (const id of teamA) {
        expect(store().session!.stats[id]).toMatchObject({ losses: 1, pointsFor: 7, pointsAgainst: 11 })
      }
    })

    it('requeues players after a score like after a result', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(8)
      store().startGame(1)
      store().recordScore(1, 11, 5)
      expect(store().session!.queue.slice(0, 4).sort()).toEqual([5, 6, 7, 8])
      expect(store().session!.queue.slice(4).sort()).toEqual([1, 2, 3, 4])
    })

    it('undoes a score, restoring the game in progress and its start time', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(8)
      store().startGame(1)
      const before = store().session
      store().recordScore(1, 11, 5)
      expect(store().previous).toEqual(before)
      expect(store().undo()).toBe(true)
      expect(store().session).toEqual(before)
      expect(store().session!.stats).toEqual({})
      expect(store().session!.courts[0].startedAt).toBeDefined()
    })

    it('logs a finished game and drops it again on undo', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().recordScore(1, 11, 5)
      expect(store().session!.matches).toHaveLength(1)
      expect(store().session!.matches![0]).toMatchObject({ courtName: 'Court 1', winner: 0, score: [11, 5] })
      expect(store().undo()).toBe(true)
      expect(store().session!.matches ?? []).toEqual([])
    })

    it('refuses to undo a score after another change', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      store().recordScore(1, 11, 5)
      store().checkInPlayer(player(9))
      expect(store().undo()).toBe(false)
    })

    it('refuses level and out-of-range scores and changes nothing', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      const before = store().session
      expect(() => store().recordScore(1, 7, 7)).toThrow(RangeError)
      expect(() => store().recordScore(1, 100, 7)).toThrow(RangeError)
      expect(store().session).toBe(before)
      expect(store().previous).toBeNull()
    })

    it('startGame stamps the court with the time, and a result adds the time played', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      expect(store().session!.courts[0].startedAt).toBe(Date.parse('2026-01-01T10:00:00Z'))
      vi.setSystemTime(new Date('2026-01-01T10:07:30Z'))
      store().recordResult(1, 0)
      for (const id of [1, 2, 3, 4]) expect(store().session!.stats[id].secondsPlayed).toBe(450)
      expect(store().session!.courts[0]).not.toHaveProperty('startedAt')
    })

    it('a score adds the time played too, and undo takes it back', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      vi.setSystemTime(new Date('2026-01-01T10:12:00Z'))
      store().recordScore(1, 11, 9)
      expect(store().session!.stats[1]).toMatchObject({ secondsPlayed: 720, scoredGames: 1 })
      store().undo()
      expect(store().session!.stats).toEqual({})
    })

    it('cancelling a game records no time', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      startRunning('Club', 'doubles', 1)
      checkInMany(4)
      store().startGame(1)
      vi.setSystemTime(new Date('2026-01-01T10:20:00Z'))
      store().cancelMatch(1)
      expect(store().session!.stats).toEqual({})
    })
  })

  it('unlocks partners', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(2)
    store().lockPartners(1, 2)
    store().unlockPartners(2)
    expect(store().session!.partners).toEqual([])
  })

  it('starts a session with the chosen matchmaking mode', () => {
    startRunning('Club', 'doubles', 1, { matchmaking: 'mixed' })
    expect(store().session!.matchmaking).toBe('mixed')
  })

  describe('managing courts', () => {
    const courts = () => store().session!.courts

    it('adds a new court open, without starting anything on it', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(8)
      store().addCourt()
      expect(courts()).toHaveLength(2)
      expect(courts()[1].name).toBe('Court 2')
      expect(courts()[1].teams).toBeNull()
      expect(store().session!.queue).toHaveLength(8)
    })

    it('lets staff start the new court by hand', () => {
      startRunning('Club', 'doubles', 1)
      checkInMany(8)
      store().startGame(1)
      store().addCourt()
      store().startGame(2)
      expect(courts()[1].teams?.flat().sort()).toEqual([5, 6, 7, 8])
      expect(store().session!.queue).toEqual([])
    })

    it('puts a cancelled game’s players first in the queue when a busy court closes', () => {
      startRunning('Club', 'doubles', 2)
      checkInMany(4)
      store().startGame(1)
      store().closeCourt(1)
      expect(courts().map((c) => c.id)).toEqual([2])
      expect(courts()[0].teams).toBeNull()
      expect(store().session!.queue.slice().sort()).toEqual([1, 2, 3, 4])
    })

    it('keeps the queue order of a cancelled game’s players ahead of those still waiting', () => {
      startRunning('Club', 'doubles', 2)
      checkInMany(5) // player 5 waits
      store().startGame(1)
      store().closeCourt(1)
      expect(courts().map((c) => c.id)).toEqual([2])
      expect(store().session!.queue.slice(0, 4).sort()).toEqual([1, 2, 3, 4])
      expect(store().session!.queue[4]).toBe(5)
    })

    it('renames and reorders courts, and results still land on the right court', () => {
      startRunning('Club', 'doubles', 3)
      checkInMany(4)
      store().startGame(1)
      store().renameCourt(1, 'Center Court')
      store().moveCourt(1, 1)
      expect(courts().map((c) => c.name)).toEqual(['Court 2', 'Center Court', 'Court 3'])
      store().recordResult(1, 0) // by id, unaffected by the new order
      expect(courts().find((c) => c.id === 1)!.teams).toBeNull()
      expect(courts().every((c) => c.teams === null)).toBe(true)
      expect(store().session!.queue.slice().sort()).toEqual([1, 2, 3, 4])
    })

    it('lets an invalid name through as an error instead of changing anything', () => {
      startRunning('Club', 'doubles', 2)
      expect(() => store().renameCourt(1, 'court 2')).toThrow(RangeError)
      expect(courts().map((c) => c.name)).toEqual(['Court 1', 'Court 2'])
    })

    it('every court change clears the pending result undo', () => {
      const actions: [string, () => void][] = [
        ['add', () => store().addCourt()],
        ['rename', () => store().renameCourt(1, 'Renamed')],
        ['move', () => store().moveCourt(1, 1)],
        ['close', () => store().closeCourt(2)],
      ]
      for (const [label, act] of actions) {
        startRunning('Club', 'doubles', 2)
        checkInMany(8)
        store().startGame(1)
        store().recordResult(1, 0)
        act()
        expect(store().undo(), label).toBe(false)
      }
    })

    it('will not close the last court', () => {
      startRunning('Club', 'doubles', 1)
      expect(() => store().closeCourt(1)).toThrow(RangeError)
      expect(courts()).toHaveLength(1)
    })
  })

  it('ends the session', () => {
    startRunning('Club', 'singles', 1)
    store().endSession()
    expect(store().session).toBeNull()
  })
})

describe('a session set up before it starts', () => {
  afterEach(() => vi.useRealTimers())

  it('checks players in without any clock running, and starts everyone waiting from zero', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    store().startSession('Club', 'doubles', 1)
    expect(store().session!.notStarted).toBe(true)
    vi.setSystemTime(1_060_000)
    checkInMany(4)
    expect(() => store().startGame(1)).toThrow(/Start the session/)
    vi.setSystemTime(1_600_000)
    store().startClock()
    expect(store().session!.queuedAt![1]).toBe(1_600_000)
    expect(store().session!.startedAt).toBe(1_600_000)
    store().startGame(1)
    expect(store().session!.courts[0].teams).not.toBeNull()
  })

  it('pauses and resumes, keeping who paused it, and blocks new games while paused', () => {
    startRunning('Club', 'doubles', 1)
    checkInMany(4)
    store().pauseSession()
    expect(store().session!.pausedBy?.deviceId).toBeTruthy()
    expect(() => store().startGame(1)).toThrow(/paused/)
    store().resumeSession()
    expect(store().session!.clockStoppedAt).toBeUndefined()
    store().startGame(1)
  })
})

describe('several sessions on one device', () => {
  it('keeps the open session running when another is created, and opens it again with nothing lost', () => {
    startRunning('Morning', 'doubles', 1)
    checkInMany(2)
    const morning = store().sessionId
    store().startSession('Evening', 'doubles', 2)
    expect(store().location).toBe('Evening')
    expect(store().parked[morning].location).toBe('Morning')
    const evening = store().sessionId

    store().openSession(morning)
    expect(store().location).toBe('Morning')
    expect(store().session!.queue).toEqual([1, 2])
    expect(Object.keys(store().parked)).toEqual([evening])
  })

  it('leaves a session without ending it, paused when asked, and ending another leaves it alone', () => {
    startRunning('Morning', 'doubles', 1)
    const morning = store().sessionId
    store().leaveSession({ pause: true })
    expect(store().session).toBeNull()
    expect(store().parked[morning].session.pausedBy?.reason).toBe('left')
    expect(store().endedSessionIds).toEqual([])

    store().startSession('Evening', 'doubles', 1)
    const evening = store().sessionId
    store().endSession()
    expect(store().endedSessionIds).toEqual([evening])
    expect(store().parked[morning]).toBeDefined()
  })

  it('leaves without pausing when told another device has it open', () => {
    startRunning('Morning', 'doubles', 1)
    const morning = store().sessionId
    store().leaveSession({ pause: false })
    expect(store().parked[morning].session.clockStoppedAt).toBeUndefined()
  })

  it('keeps sessions left here, and several unsent ends, across a reload and an upgrade', async () => {
    startRunning('Morning', 'doubles', 1)
    const morning = store().sessionId
    store().leaveSession({ pause: true })
    await useSessionStore.persist.rehydrate()
    expect(store().parked[morning].location).toBe('Morning')

    const saved = JSON.parse(localStorage.getItem('q2dink-session')!) as { state: Record<string, unknown>; version: number }
    const { parked: _parked, endedSessionIds: _ended, ...older } = saved.state
    localStorage.setItem('q2dink-session', JSON.stringify({ state: { ...older, endedSessionId: 'old-one' }, version: 8 }))
    await useSessionStore.persist.rehydrate()
    expect(store().endedSessionIds).toEqual(['old-one'])
    expect(store().parked).toEqual({})
  })
})

describe('upgrading a device that is in the middle of a session', () => {
  it('keeps it running (not "not started"), shared, with its unsent changes', async () => {
    startRunning('Live now', 'doubles', 1)
    checkInMany(4)
    store().shareSession()
    store().checkInPlayer(player(5))
    const { session, base, pending, sessionId } = store()
    // As 1.21 saved it: store version 8, a session from before the clock fields, one end field.
    const { notStarted: _n, clockStoppedAt: _c, startedAt: _s, startedBy: _b, ...older } = session!
    localStorage.setItem(
      'q2dink-session',
      JSON.stringify({
        state: { location: 'Live now', session: older, sessionId, startedAt: 1, lifetimeCounted: {}, base, pending, endedSessionId: '' },
        version: 8,
      }),
    )
    await useSessionStore.persist.rehydrate()
    expect(store().session!.notStarted).toBeUndefined()
    expect(store().session!.queue).toEqual([1, 2, 3, 4, 5])
    expect(store().pending).toHaveLength(1)
    expect(store().base?.revision).toBe(base!.revision)
    expect(store().endedSessionIds).toEqual([])
    store().startGame(1)
  })
})
