import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { listRoster, savePlayer, setRosterRating } from './roster'

beforeEach(async () => {
  await db.players.clear()
})

const row = async (id: number) => (await db.players.get(id))!

describe('savePlayer', () => {
  it('saves a new player on the club’s roster without a session, marked to send to the club', async () => {
    const { player, added } = await savePlayer('  Ann ', 4, 'F', 'downtown')
    expect(added).toBe(true)
    // The rating is kept, with its level on the default scale beside it (4.0 is Advanced, level 5).
    expect(player).toEqual({ id: player.id, name: 'Ann', rating: 4, skill: 5, gender: 'F' })
    expect(await row(player.id)).toMatchObject({ name: 'Ann', rating: 4, skill: 5, gender: 'F', clubSlug: 'downtown', rosterDirty: true })
    expect((await listRoster('downtown')).map((p) => p.name)).toEqual(['Ann'])
  })

  it('finds a player already saved, whatever the case, and takes a new level and gender', async () => {
    const first = await savePlayer('Ann', 3, undefined, 'downtown')
    await db.players.update(first.player.id, { rosterDirty: false })

    const again = await savePlayer('ann', 3.5, 'F', 'downtown')
    expect(again.added).toBe(false)
    expect(again.player).toEqual({ id: first.player.id, name: 'Ann', rating: 3.5, skill: 4, gender: 'F' })
    expect(await db.players.count()).toBe(1)
    expect(await row(first.player.id)).toMatchObject({ rating: 3.5, skill: 4, gender: 'F', rosterDirty: true })
  })

  it('keeps a saved gender when none is given, and changes nothing when nothing differs', async () => {
    const first = await savePlayer('Bob', 3, 'M', 'downtown')
    await db.players.update(first.player.id, { rosterDirty: false })

    const again = await savePlayer('Bob', 3, undefined, 'downtown')
    expect(again).toEqual({ player: { id: first.player.id, name: 'Bob', rating: 3, skill: 3, gender: 'M' }, added: false })
    expect((await row(first.player.id)).rosterDirty).toBe(false)
  })

  it('keeps each club’s players apart: the same name is a new player for another club', async () => {
    await savePlayer('Ann', 3, undefined, 'downtown')
    const other = await savePlayer('Ann', 2.5, undefined, 'uptown')
    expect(other.added).toBe(true)
    expect((await listRoster('downtown')).map((p) => p.skill)).toEqual([3])
    expect((await listRoster('uptown')).map((p) => p.skill)).toEqual([2])
    expect(await listRoster(undefined)).toEqual([])
  })

  it('lists the saved players alphabetically', async () => {
    for (const name of ['Cy', 'Ann', 'Bob']) await savePlayer(name, 3, undefined, 'downtown')
    expect((await listRoster('downtown')).map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cy'])
  })
})

describe('setRosterRating', () => {
  it('changes a saved player’s level and marks it to send to the club', async () => {
    const { player } = await savePlayer('Ann', 3, undefined, 'downtown')
    await db.players.update(player.id, { rosterDirty: false })
    await setRosterRating(player.id, 4.5)
    expect(await row(player.id)).toMatchObject({ skill: 6, rosterDirty: true })
  })
})

describe('saved players from before ratings existed', () => {
  it('keep their level (it stands for a rating) and get a rating when their level changes', async () => {
    const id = (await db.players.add({ name: 'Old', skill: 4, clubSlug: 'downtown' }))!
    const same = await savePlayer('Old', 3.5, undefined, 'downtown')
    expect(same.player).toMatchObject({ rating: 3.5, skill: 4 })
    expect((await row(id)).rosterDirty).toBeUndefined() // nothing changed: 3.5 is what level 4 stood for
    await setRosterRating(id, 3)
    expect(await row(id)).toMatchObject({ rating: 3, skill: 3 })
  })
})
