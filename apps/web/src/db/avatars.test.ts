import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addOrGetPlayer, markPhotosDirty, setClubAvatar, setRosterAvatar } from './roster'
import {
  getPhotoSharingPending,
  getSharePhotos,
  markPhotosSentFor,
  photosSentFor,
  setPhotoSharingPending,
  setSharePhotos,
} from './settings'

beforeEach(async () => {
  await db.players.clear()
  await db.settings.clear()
})

const PHOTO = { kind: 'photo' as const, data: 'data:image/webp;base64,AAAA' }
const EMOJI = { kind: 'emoji' as const, value: '🎾', color: '#123456' }

describe('roster avatars', () => {
  it('are set on the roster player, marked as not yet sent, and replaced', async () => {
    const ann = await addOrGetPlayer('Ann', 3)
    await setRosterAvatar(ann.id, EMOJI)
    expect(await db.players.get(ann.id)).toMatchObject({ avatar: EMOJI, avatarDirty: true })
    await setRosterAvatar(ann.id, PHOTO)
    expect((await db.players.get(ann.id))?.avatar).toEqual(PHOTO)
  })

  it('can be removed, which is also a change to send', async () => {
    const ann = await addOrGetPlayer('Ann', 3)
    await setRosterAvatar(ann.id, EMOJI)
    await setRosterAvatar(ann.id, null)
    const saved = await db.players.get(ann.id)
    expect(saved?.avatar).toBeUndefined()
    expect(saved?.avatarDirty).toBe(true)
  })

  it('belong to one player only, and keep skill, gender and all-time totals', async () => {
    const ann = await addOrGetPlayer('Ann', 4, 'F')
    const bob = await addOrGetPlayer('Bob', 3)
    await db.players.update(ann.id, { games: 4, wins: 3, losses: 1 })
    await setRosterAvatar(ann.id, EMOJI)
    expect(await db.players.get(ann.id)).toMatchObject({ skill: 5, gender: 'F', games: 4, wins: 3, losses: 1 })
    expect((await db.players.get(bob.id))?.avatar).toBeUndefined()
  })

  it('never travel into a session: checking a player in copies only who they are', async () => {
    const ann = await addOrGetPlayer('Ann', 3)
    await setRosterAvatar(ann.id, PHOTO)
    const again = await addOrGetPlayer('ann', 3)
    expect(Object.keys(again).sort()).toEqual(['gender', 'id', 'name', 'rating', 'skill'])
  })

  it('can all be marked as not sent for one club, but only the photos', async () => {
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    const bob = await addOrGetPlayer('Bob', 3, undefined, 'downtown')
    const cy = await addOrGetPlayer('Cy', 3, undefined, 'downtown')
    const other = await addOrGetPlayer('Dee', 3, undefined, 'uptown')
    await setRosterAvatar(ann.id, PHOTO)
    await setRosterAvatar(bob.id, EMOJI)
    await setRosterAvatar(other.id, PHOTO)
    await db.players.toCollection().modify({ avatarDirty: false })

    await markPhotosDirty('downtown')
    expect((await db.players.get(ann.id))?.avatarDirty).toBe(true)
    expect((await db.players.get(bob.id))?.avatarDirty).toBe(false)
    expect((await db.players.get(cy.id))?.avatarDirty).toBe(false)
    expect((await db.players.get(other.id))?.avatarDirty).toBe(false)
  })

  it('take the club’s avatar only when not changed here, and drop one that came from the club', async () => {
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    await setClubAvatar(ann.id, PHOTO, 5)
    expect(await db.players.get(ann.id)).toMatchObject({ avatar: PHOTO, avatarVersion: 5 })
    await setClubAvatar(ann.id, null)
    expect((await db.players.get(ann.id))?.avatar).toBeUndefined()

    await setRosterAvatar(ann.id, EMOJI) // changed here, not yet sent
    await setClubAvatar(ann.id, PHOTO, 6)
    expect(await db.players.get(ann.id)).toMatchObject({ avatar: EMOJI, avatarDirty: true })
    expect((await db.players.get(ann.id))?.avatarVersion).toBeUndefined()
  })
})

describe('device settings', () => {
  it('share photos only once switched on, and remember a switch the club has not been told of', async () => {
    expect(await getSharePhotos()).toBe(false)
    await setSharePhotos(true)
    expect(await getSharePhotos()).toBe(true)
    await setSharePhotos(false)
    expect(await getSharePhotos()).toBe(false)

    expect(await getPhotoSharingPending()).toBe(false)
    await setPhotoSharingPending(true)
    expect(await getPhotoSharingPending()).toBe(true)
  })

  it('remember which clubs have been sent this device’s photos', async () => {
    expect(await photosSentFor('downtown')).toBe(false)
    await markPhotosSentFor('downtown')
    await markPhotosSentFor('downtown')
    expect(await photosSentFor('downtown')).toBe(true)
    expect(await photosSentFor('uptown')).toBe(false)
  })
})
