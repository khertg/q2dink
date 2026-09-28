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

import { MEDIA_LIMITS, type CardLogo, type CardLogoChoice } from '@q2dink/shared'
import {
  addCardLogo,
  getCardLogoChoice,
  listCardLogos,
  removeCardLogo,
  setCardLogoChoice,
  unsentCardLogos,
} from '@/db/cardLogos'
import { db } from '@/db/db'
import { CloudError, type CloudApi } from './api'
import { useClubAuth } from './auth'
import { countUnsent, syncCardLogos } from './sync'

const downtown = { slug: 'downtown', name: 'Downtown', token: 'tok-1' }
const uptown = { slug: 'uptown', name: 'Uptown', token: 'tok-2' }
const PNG = 'data:image/png;base64,iVBORw0KGgo='

/** A club server keeping card logos and a choice per token, like the real one. */
function fakeServer() {
  const clubs = new Map<string, { logos: Map<string, CardLogo>; choice: CardLogoChoice }>()
  const club = (token: string) =>
    clubs.get(token) ?? clubs.set(token, { logos: new Map(), choice: 'auto' }).get(token)!
  let clock = 1000
  const api = {
    fetchCardLogoIndex: vi.fn(async (token: string) => ({
      logos: [...club(token).logos.values()].map(({ id, v, tone }) => ({ id, v, tone })),
      choice: club(token).choice,
    })),
    fetchCardLogo: vi.fn(async (token: string, id: string) => club(token).logos.get(id) ?? null),
    putCardLogo: vi.fn(async (token: string, id: string, data: string, tone: number) => {
      club(token).logos.set(id, { id, v: ++clock, tone, type: 'image/png', data })
    }),
    deleteCardLogo: vi.fn(async (token: string, id: string) => {
      club(token).logos.delete(id)
      const c = club(token).choice
      if (typeof c === 'object' && c.id === id) club(token).choice = 'auto'
    }),
    putCardLogoChoice: vi.fn(async (token: string, choice: CardLogoChoice) => {
      if (typeof choice === 'object' && !club(token).logos.has(choice.id)) throw new CloudError('invalid_request')
      club(token).choice = choice
    }),
  }
  return { api, cloudApi: api as unknown as CloudApi, club }
}

beforeEach(async () => {
  await db.settings.clear()
  await db.cardLogos.clear()
  useClubAuth.setState({ club: downtown, pendingLifetime: [] })
})

describe('card logos on the device', () => {
  it('lists a club’s own logos in the order they were added, up to the limit', async () => {
    for (let i = 0; i < MEDIA_LIMITS.cardLogos; i++) await addCardLogo('downtown', PNG, i / 10)
    await addCardLogo('uptown', PNG, 1)
    expect((await listCardLogos('downtown')).map((l) => l.tone)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => i / 10))
    await expect(addCardLogo('downtown', PNG, 1)).rejects.toThrow(/8 logos/)
    expect(await listCardLogos('uptown')).toHaveLength(1)
  })

  it('removing the picked logo goes back to automatic; one the club never had is simply forgotten', async () => {
    const logo = await addCardLogo('downtown', PNG, 1)
    await setCardLogoChoice('downtown', { id: logo.id })
    await removeCardLogo('downtown', logo.id)
    expect(await listCardLogos('downtown')).toEqual([])
    expect(await unsentCardLogos('downtown')).toEqual([])
    expect(await getCardLogoChoice('downtown')).toEqual({ choice: 'auto', dirty: true })
  })
})

describe('syncCardLogos', () => {
  it('sends logos and the pick made here, and another device of the club gets both', async () => {
    const server = fakeServer()
    const white = await addCardLogo('downtown', PNG, 1)
    await addCardLogo('downtown', PNG, 0)
    await setCardLogoChoice('downtown', { id: white.id })
    expect((await countUnsent()).cardLogos).toBe(3)

    expect(await syncCardLogos(server.cloudApi)).toBe(true)
    expect(server.club('tok-1').logos.size).toBe(2)
    expect(server.club('tok-1').choice).toEqual({ id: white.id })
    expect(await unsentCardLogos('downtown')).toEqual([])
    expect((await countUnsent()).cardLogos).toBe(0)
    // The club's version is taken without fetching the images back.
    expect(server.api.fetchCardLogo).not.toHaveBeenCalled()

    // Another device: nothing here yet.
    await db.cardLogos.clear()
    await db.settings.clear()
    await syncCardLogos(server.cloudApi)
    const theirs = await listCardLogos('downtown')
    expect(theirs.map((l) => l.tone)).toEqual([1, 0])
    expect(theirs[0].data).toBe(PNG)
    expect(await getCardLogoChoice('downtown')).toEqual({ choice: { id: white.id }, dirty: false })
  })

  it('follows a removal made on another device, and sends one made here', async () => {
    const server = fakeServer()
    const a = await addCardLogo('downtown', PNG, 1)
    const b = await addCardLogo('downtown', PNG, 0)
    await syncCardLogos(server.cloudApi)

    await server.api.deleteCardLogo('tok-1', a.id)
    await removeCardLogo('downtown', b.id)
    expect((await unsentCardLogos('downtown')).map((l) => l.dirty)).toEqual(['delete'])
    await syncCardLogos(server.cloudApi)
    expect(server.club('tok-1').logos.size).toBe(0)
    expect(await listCardLogos('downtown')).toEqual([])
    expect(await db.cardLogos.count()).toBe(0)
  })

  it('keeps the club’s choice when the logo picked here was removed elsewhere meanwhile', async () => {
    const server = fakeServer()
    const a = await addCardLogo('downtown', PNG, 1)
    await syncCardLogos(server.cloudApi)
    await server.api.deleteCardLogo('tok-1', a.id)
    await server.api.putCardLogoChoice('tok-1', 'none')
    await setCardLogoChoice('downtown', { id: a.id })
    expect(await syncCardLogos(server.cloudApi)).toBe(true)
    expect(await getCardLogoChoice('downtown')).toEqual({ choice: 'none', dirty: false })
  })

  it('never sends one club’s logos to another', async () => {
    const server = fakeServer()
    await addCardLogo('uptown', PNG, 1)
    await syncCardLogos(server.cloudApi)
    expect(server.club('tok-1').logos.size).toBe(0)
    useClubAuth.setState({ club: uptown })
    await syncCardLogos(server.cloudApi)
    expect(server.club('tok-2').logos.size).toBe(1)
  })
})
