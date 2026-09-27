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

import type { ClubRosterPlayer, StaffAvatar } from '@q2dink/shared'
import { db } from '@/db/db'
import {
  addOrGetPlayer,
  listRoster,
  mergeClubRoster,
  renameRosterPlayer,
  setRosterAvatar,
  setRosterRating,
} from '@/db/roster'
import { getSharePhotos } from '@/db/settings'
import { CloudError, type CloudApi } from './api'
import { useClubAuth } from './auth'
import { syncRoster } from './sync'

const downtown = { slug: 'downtown', name: 'Downtown', token: 'tok-1' }
const uptown = { slug: 'uptown', name: 'Uptown', token: 'tok-2' }

/** A club server holding one roster per token, like the real one keyed by lower-case name. */
function fakeApi(options: { putRoster?: (players: ClubRosterPlayer[]) => Promise<void> } = {}) {
  const rosters = new Map<string, Map<string, ClubRosterPlayer>>()
  const club = (token: string) => rosters.get(token) ?? rosters.set(token, new Map()).get(token)!
  /** Avatars by token, then by lower-case name. */
  const avatars = new Map<string, Map<string, StaffAvatar>>()
  const clubAvatars = (token: string) => avatars.get(token) ?? avatars.set(token, new Map()).get(token)!
  const shared = { photos: false }
  const sent: ClubRosterPlayer[][] = []
  const api = {
    renamePlayer: vi.fn(async () => {}),
    putRoster: vi.fn(async (token: string, players: ClubRosterPlayer[]) => {
      sent.push(players)
      await options.putRoster?.(players)
      for (const p of players) club(token).set(p.name.toLowerCase(), p)
    }),
    fetchRoster: vi.fn(async (token: string) => [...club(token).values()]),
    fetchStaffAvatars: vi.fn(async (token: string) => ({
      avatars: Object.fromEntries([...clubAvatars(token)].map(([key, a]) => [key, { kind: a.kind, v: a.v }])),
      logo: null,
      name: 'Club',
      sharePhotos: shared.photos,
    })),
    fetchStaffAvatar: vi.fn(async (token: string, key: string) => clubAvatars(token).get(key) ?? null),
  }
  return { api, cloudApi: api as unknown as CloudApi, sent, club, clubAvatars, shared }
}

const names = async (slug: string | undefined) => (await listRoster(slug)).map((p) => p.name)

beforeEach(async () => {
  await db.settings.clear()
  await db.players.clear()
  useClubAuth.setState({ club: downtown, pendingLifetime: [] })
})

describe('a club roster', () => {
  it('lists only the club’s own players; a name can be saved once per club', async () => {
    await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    await addOrGetPlayer('Bob', 2, undefined, 'downtown')
    const other = await addOrGetPlayer('ann', 4, undefined, 'uptown')
    expect(await names('downtown')).toEqual(['Ann', 'Bob'])
    expect(await names('uptown')).toEqual(['ann'])
    expect(other).toMatchObject({ rating: 4, skill: 5 })
    expect((await addOrGetPlayer('ANN', 4, undefined, 'uptown')).id).toBe(other.id)
    expect(await db.players.count()).toBe(3)
  })

  it('without a club (no cloud) lists just the players no club has taken', async () => {
    await addOrGetPlayer('Ann', 3)
    await addOrGetPlayer('Bob', 3, undefined, 'downtown')
    expect(await names(undefined)).toEqual(['Ann'])
  })

  it('checks a rename against the player’s own club only', async () => {
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    await addOrGetPlayer('Bob', 3, undefined, 'uptown')
    await expect(renameRosterPlayer(ann.id, 'Bob')).resolves.toEqual({ from: 'Ann', to: 'Bob' })
    await addOrGetPlayer('Cy', 3, undefined, 'downtown')
    await expect(renameRosterPlayer(ann.id, 'cy')).rejects.toThrow(RangeError)
  })
})

describe('mergeClubRoster', () => {
  it('adds the club’s new players and takes its changes, but keeps changes not yet sent', async () => {
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    const bob = await addOrGetPlayer('Bob', 3, undefined, 'downtown')
    await db.players.update(ann.id, { rosterDirty: false, avatar: { kind: 'emoji', value: '🎾', color: '#123456' }, games: 7 })
    await mergeClubRoster('downtown', [
      { name: 'ANN', skill: 5, gender: 'F' },
      { name: 'bob', skill: 1 },
      { name: 'Cy', skill: 4, gender: 'M' },
    ])
    const [a, b, c] = await listRoster('downtown')
    expect(a).toMatchObject({ id: ann.id, name: 'Ann', skill: 5, gender: 'F', games: 7, avatar: { kind: 'emoji' } })
    expect(b).toMatchObject({ id: bob.id, skill: 3, rosterDirty: true })
    expect(c).toMatchObject({ name: 'Cy', skill: 4, gender: 'M', clubSlug: 'downtown', rosterDirty: false })
    expect(await names('uptown')).toEqual([])
  })

  it('takes the club’s ratings, and reads a level from an older server as the rating it stands for', async () => {
    await mergeClubRoster('downtown', [
      { name: 'Ann', skill: 4, rating: 3.742 },
      { name: 'Old', skill: 2 },
    ])
    const [ann, old] = await listRoster('downtown')
    expect(ann).toMatchObject({ rating: 3.742, skill: 4 })
    expect(old).toMatchObject({ rating: 2.5, skill: 2 })
  })
})

describe('syncRoster', () => {
  it('takes the players no club had yet, sends them, and marks them sent', async () => {
    await addOrGetPlayer('Ann', 3, 'F')
    await addOrGetPlayer('Bob', 2.5)
    const { cloudApi, sent } = fakeApi()
    expect(await syncRoster(cloudApi)).toBe(true)
    // Each player's rating, and its level on the default scale for the club's older apps.
    expect(sent).toEqual([[{ name: 'Ann', skill: 3, rating: 3, gender: 'F' }, { name: 'Bob', skill: 2, rating: 2.5 }]])
    expect(await names('downtown')).toEqual(['Ann', 'Bob'])
    expect((await db.players.toArray()).every((p) => p.rosterDirty === false)).toBe(true)

    // Nothing changed: nothing is sent again.
    await syncRoster(cloudApi)
    expect(sent).toHaveLength(1)
  })

  it('sends only what changed, and brings in what another device of the club saved', async () => {
    const { cloudApi, sent, club } = fakeApi()
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    await syncRoster(cloudApi)
    club('tok-1').set('dee', { name: 'Dee', skill: 6 })
    await setRosterRating(ann.id, 3.5)
    await syncRoster(cloudApi)
    expect(sent.at(-1)).toEqual([{ name: 'Ann', skill: 4, rating: 3.5 }])
    expect(await names('downtown')).toEqual(['Ann', 'Dee'])
  })

  it('never sends one club’s players to another, and files what it brings in under the club signed in', async () => {
    await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    const { cloudApi, sent, club } = fakeApi()
    club('tok-2').set('zed', { name: 'Zed', skill: 2 })
    useClubAuth.setState({ club: uptown })
    await syncRoster(cloudApi)
    expect(sent).toEqual([])
    expect(await names('uptown')).toEqual(['Zed'])
    expect(await names('downtown')).toEqual(['Ann'])
  })

  it('keeps a player marked when they changed again while being sent', async () => {
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    const { cloudApi } = fakeApi({ putRoster: () => setRosterRating(ann.id, 4.5) })
    await syncRoster(cloudApi)
    expect(await db.players.get(ann.id)).toMatchObject({ skill: 6, rosterDirty: true })
  })

  it('brings in the photo another staff device set, and keeps it current', async () => {
    const { cloudApi, api, club, clubAvatars, shared } = fakeApi()
    club('tok-1').set('ann', { name: 'Ann', skill: 3 })
    clubAvatars('tok-1').set('ann', { kind: 'photo', photo: { data: 'QUJD', type: 'image/jpeg' }, v: 1 })
    await syncRoster(cloudApi)
    const [ann] = await listRoster('downtown')
    expect(ann).toMatchObject({ avatar: { kind: 'photo', data: 'data:image/jpeg;base64,QUJD' }, avatarVersion: 1 })
    expect(ann.avatarDirty).toBeFalsy()
    expect(await getSharePhotos()).toBe(false)

    // Unchanged: not fetched again. Changed on the other device: taken.
    await syncRoster(cloudApi)
    expect(api.fetchStaffAvatar).toHaveBeenCalledTimes(1)
    clubAvatars('tok-1').set('ann', { kind: 'emoji', emoji: '🎾', color: '#123456', v: 2 })
    shared.photos = true
    await syncRoster(cloudApi)
    expect((await listRoster('downtown'))[0].avatar).toEqual({ kind: 'emoji', value: '🎾', color: '#123456' })
    expect(await getSharePhotos()).toBe(true)

    // Removed on the other device: removed here too.
    clubAvatars('tok-1').delete('ann')
    await syncRoster(cloudApi)
    expect((await listRoster('downtown'))[0].avatar).toBeUndefined()
  })

  it('keeps an avatar changed here, and one set here that the club never had', async () => {
    const { cloudApi, club, clubAvatars } = fakeApi()
    const ann = await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    const bob = await addOrGetPlayer('Bob', 3, undefined, 'downtown')
    await setRosterAvatar(ann.id, { kind: 'emoji', value: '🏓', color: '#654321' })
    await setRosterAvatar(bob.id, { kind: 'initials', color: '#654321' })
    await db.players.update(bob.id, { avatarDirty: false }) // sent earlier, club lost it since
    club('tok-1').set('ann', { name: 'Ann', skill: 3 })
    clubAvatars('tok-1').set('ann', { kind: 'photo', photo: { data: 'QUJD', type: 'image/png' }, v: 9 })
    await syncRoster(cloudApi)
    expect((await db.players.get(ann.id))?.avatar).toEqual({ kind: 'emoji', value: '🏓', color: '#654321' })
    expect((await db.players.get(bob.id))?.avatar).toEqual({ kind: 'initials', color: '#654321' })
  })

  it('never gives one club’s players another club’s avatars', async () => {
    const { cloudApi, clubAvatars } = fakeApi()
    await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    clubAvatars('tok-2').set('ann', { kind: 'photo', photo: { data: 'QUJD', type: 'image/png' }, v: 1 })
    await syncRoster(cloudApi)
    expect((await listRoster('downtown'))[0].avatar).toBeUndefined()
  })

  it('keeps changes for later when the club cannot be reached', async () => {
    await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    const { cloudApi } = fakeApi({ putRoster: () => Promise.reject(new CloudError('network', 'offline')) })
    expect(await syncRoster(cloudApi)).toBe(false)
    expect((await listRoster('downtown'))[0].rosterDirty).toBe(true)
  })
})
