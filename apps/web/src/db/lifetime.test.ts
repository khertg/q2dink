import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { checkIn, createSession, EMPTY_STATS, recordResult } from '@/rotation/engine'
import { lifetimeTotals } from '@/rotation/lifetime'
import { fillCourts } from '@/rotation/testing'
import type { SessionState } from '@/rotation/types'
import { db } from './db'
import { saveLifetimeStats } from './lifetime'
import { addOrGetPlayer, setRosterRating } from './roster'

beforeEach(async () => {
  await db.players.clear()
})

async function playOneGame(names: string[]): Promise<SessionState> {
  let s = createSession('doubles', 1)
  for (const name of names) s = checkIn(s, await addOrGetPlayer(name, 3))
  return recordResult(fillCourts(s), 1, 0).state
}

describe('addOrGetPlayer', () => {
  it('reuses a player by name, ignoring case and surrounding spaces', async () => {
    const first = await addOrGetPlayer('Ann', 3)
    const again = await addOrGetPlayer('  ann ', 3)
    expect(again.id).toBe(first.id)
    expect(await db.players.count()).toBe(1)
  })

  it('updates the saved rating and gender when they change', async () => {
    await addOrGetPlayer('Ann', 3)
    const updated = await addOrGetPlayer('Ann', 4, 'F')
    expect(updated).toMatchObject({ rating: 4, skill: 5, gender: 'F' })
    expect(await db.players.get(updated.id)).toMatchObject({ rating: 4, skill: 5, gender: 'F' })
  })

  it('keeps a saved gender when none is supplied', async () => {
    await addOrGetPlayer('Ann', 3, 'F')
    expect((await addOrGetPlayer('Ann', 3)).gender).toBe('F')
  })

  it('returns only identity fields, not all-time totals', async () => {
    const created = await addOrGetPlayer('Ann', 3)
    await db.players.update(created.id, { games: 9, wins: 5, losses: 4 })
    const again = await addOrGetPlayer('Ann', 3)
    expect(Object.keys(again).sort()).toEqual(['gender', 'id', 'name', 'rating', 'skill'])
  })
})

describe('saveLifetimeStats with an earlier save', () => {
  it('adds only the games played since, so a resumed session never counts twice', async () => {
    const first = await playOneGame(['A', 'B', 'C', 'D'])
    await saveLifetimeStats(first)
    const counted = lifetimeTotals(first)

    // The same session carries on: a second game, then it is saved again.
    const second = recordResult(fillCourts(first), 1, 0).state
    await saveLifetimeStats(second, counted)
    for (const p of await db.players.toArray()) expect(p.games).toBe(2)

    // Saving once more with nothing new adds nothing.
    await saveLifetimeStats(second, lifetimeTotals(second))
    for (const p of await db.players.toArray()) expect(p.games).toBe(2)
  })
})

describe('saveLifetimeStats', () => {
  it('adds a session to the roster totals and accumulates across sessions', async () => {
    const session = await playOneGame(['A', 'B', 'C', 'D'])
    await saveLifetimeStats(session)
    await saveLifetimeStats(session)

    const players = await db.players.toArray()
    expect(players).toHaveLength(4)
    for (const p of players) expect(p.games).toBe(2)
    expect(players.reduce((sum, p) => sum + (p.wins ?? 0), 0)).toBe(4)
    expect(players.reduce((sum, p) => sum + (p.losses ?? 0), 0)).toBe(4)
  })

  it('skips players who have no games and players missing from the roster', async () => {
    const session = await playOneGame(['A', 'B', 'C', 'D'])
    const withGhost: SessionState = {
      ...session,
      stats: { ...session.stats, 999: { ...EMPTY_STATS, games: 3, wins: 3, opponentSkill: 9 } },
    }
    await saveLifetimeStats(withGhost)
    expect(await db.players.count()).toBe(4)
  })
})

describe('setRosterRating', () => {
  it('changes the saved level, and a returning player keeps it', async () => {
    const ann = await addOrGetPlayer('Ann', 3, 'F')
    await setRosterRating(ann.id, 4)
    expect(await db.players.get(ann.id)).toMatchObject({ skill: 5, gender: 'F' })
    // Checking in again without picking a level keeps what was edited (the picker starts from it).
    expect((await db.players.where('name').equals('Ann').first())?.skill).toBe(5)
  })

  it('changes nobody else, and keeps all-time totals', async () => {
    const ann = await addOrGetPlayer('Ann', 3)
    const bob = await addOrGetPlayer('Bob', 3)
    await db.players.update(ann.id, { games: 4, wins: 3, losses: 1 })
    await setRosterRating(ann.id, 4.5)
    expect(await db.players.get(bob.id)).toMatchObject({ skill: 3 })
    expect(await db.players.get(ann.id)).toMatchObject({ skill: 6, games: 4, wins: 3, losses: 1 })
  })
})
