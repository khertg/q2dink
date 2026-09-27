import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The stores persist to localStorage; give the node test environment a tiny in-memory one.
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

import { db } from '@/db/db'
import { archiveSession, getHistory } from '@/db/history'
import { addOrGetPlayer, renameRosterPlayer, setRosterAvatar } from '@/db/roster'
import { useSessionStore } from '@/store/session'
import { renamePlayer } from './rename'

const store = () => useSessionStore.getState()

async function checkedIn(...names: string[]) {
  store().startSession('Club', 'doubles', 1)
  const players = []
  for (const name of names) {
    const player = await addOrGetPlayer(name, 3)
    store().checkInPlayer(player)
    players.push(player)
  }
  return players
}

beforeEach(async () => {
  await db.players.clear()
  await db.history.clear()
  await db.settings.clear()
  useSessionStore.setState({ location: '', session: null, previous: null })
})

describe('renameRosterPlayer', () => {
  it('renames a saved player and keeps their level, totals and avatar', async () => {
    const ann = await addOrGetPlayer('Ann', 4)
    await db.players.update(ann.id, { games: 9, wins: 5, losses: 4 })
    await setRosterAvatar(ann.id, { kind: 'emoji', value: '🎾', color: '#123456' })
    expect(await renameRosterPlayer(ann.id, '  Anne ')).toEqual({ from: 'Ann', to: 'Anne' })
    const saved = await db.players.get(ann.id)
    expect(saved).toMatchObject({ name: 'Anne', rating: 4, skill: 5, games: 9, wins: 5, losses: 4 })
    expect(saved?.avatar).toEqual({ kind: 'emoji', value: '🎾', color: '#123456' })
    // A later check-in by the new name finds the same player.
    expect((await addOrGetPlayer('anne', 4)).id).toBe(ann.id)
    expect(await db.players.where('name').equalsIgnoreCase('Ann').count()).toBe(0)
  })

  it('refuses a name another saved player has, in words, and changes nothing', async () => {
    const ann = await addOrGetPlayer('Ann', 3)
    await addOrGetPlayer('Bob', 3)
    await expect(renameRosterPlayer(ann.id, ' BOB ')).rejects.toThrow('BOB is already saved as a player')
    expect((await db.players.get(ann.id))?.name).toBe('Ann')
  })

  it('allows changing only the capitals, and a same-name save is a quiet no-op', async () => {
    const ann = await addOrGetPlayer('ann', 3)
    expect(await renameRosterPlayer(ann.id, 'Ann')).toEqual({ from: 'ann', to: 'Ann' })
    expect(await renameRosterPlayer(ann.id, 'Ann')).toEqual({ from: 'Ann', to: 'Ann' })
  })

  it('refuses an empty name and a player that is not saved', async () => {
    const ann = await addOrGetPlayer('Ann', 3)
    await expect(renameRosterPlayer(ann.id, '  ')).rejects.toThrow('Enter a name')
    await expect(renameRosterPlayer(999, 'Zed')).rejects.toThrow('not saved')
  })
})

describe('renamePlayer (roster and running session together)', () => {
  it('changes both, so the queue and future check-ins use the new name', async () => {
    const [ann] = await checkedIn('Ann', 'Bob')
    await renamePlayer(ann.name, 'Anne')
    expect(Object.values(store().session!.players).map((p) => p.name)).toEqual(['Anne', 'Bob'])
    expect((await db.players.get(ann.id))?.name).toBe('Anne')
  })

  it('changes a saved player who is not in the session, and leaves the session alone', async () => {
    await checkedIn('Bob')
    const cy = await addOrGetPlayer('Cy', 3)
    const before = store().session
    await renamePlayer(cy.name, 'Cyrus')
    expect((await db.players.get(cy.id))?.name).toBe('Cyrus')
    expect(store().session).toBe(before)
  })

  it('changes nothing at all when the name is refused', async () => {
    const [ann] = await checkedIn('Ann', 'Bob')
    const before = store().session
    await expect(renamePlayer(ann.name, 'bob')).rejects.toBeInstanceOf(RangeError)
    expect(store().session).toBe(before)
    expect((await db.players.get(ann.id))?.name).toBe('Ann')
  })

  it('leaves sessions that already ended with the name they had that day', async () => {
    const [ann] = await checkedIn('Ann', 'Bob')
    const session = store().session!
    await archiveSession({ id: 'old', location: 'Club', startedAt: 1, session, lifetimeCounted: {} })
    await renamePlayer(ann.name, 'Anne')
    expect(Object.values((await getHistory('old'))!.session.players).map((p) => p.name)).toEqual(['Ann', 'Bob'])
  })
})
