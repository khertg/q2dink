import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

import type { AuditEntry } from '@q2dink/shared'
import { db } from '@/db/db'
import { useDevice } from '@/lib/device'
import type { RosterPlayer } from '@/rotation/types'
import { useSessionStore } from '@/store/session'
import { CloudError, type CloudApi } from './api'
import { matchesSearch, mergeEntries, newAuditEntry, pageCount, queueAudit, recordAudit, unsentAudit } from './audit'
import { useClubAuth } from './auth'
import { countUnsent, flushAudit } from './sync'
import { NOTHING_UNSENT } from '@/lib/reset'
import { addOrGetPlayer } from '@/db/roster'

const club = { slug: 'downtown', name: 'Downtown', token: 'tok-1' }
const player = (id: number): RosterPlayer => ({ id, name: `P${id}`, skill: 3 })
const store = () => useSessionStore.getState()
const queued = async () => (await db.auditQueue.toArray()).sort((a, b) => a.at.localeCompare(b.at))

beforeEach(async () => {
  await db.auditQueue.clear()
  useClubAuth.setState({ club, pendingLifetime: [] })
  useDevice.setState({ id: '3f2a91c7-0000-4000-8000-000000000001', name: 'Desk', namedFor: 'downtown', label: 'iPhone · iOS 18 · Safari' })
  useSessionStore.setState({ location: '', session: null, previous: null, base: null, pending: [], sessionId: '' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('newAuditEntry', () => {
  it('says which device did it, when, and in which session', () => {
    const entry = newAuditEntry('checkIn', 'Checked in Ann', '5c0e7a52-1d8b-4f6f-8a3e-7b9c2d1e0f44')!
    expect(entry).toMatchObject({
      kind: 'checkIn',
      summary: 'Checked in Ann',
      sessionId: '5c0e7a52-1d8b-4f6f-8a3e-7b9c2d1e0f44',
      device: { id: '3f2a91c7-0000-4000-8000-000000000001', name: 'Desk', label: 'iPhone · iOS 18 · Safari' },
    })
    expect(Date.parse(entry.at)).not.toBeNaN()
  })

  it('keeps no log when no club is signed in', async () => {
    useClubAuth.setState({ club: null })
    expect(newAuditEntry('checkIn', 'x')).toBeNull()
    recordAudit('checkIn', 'x')
    await queueAudit([])
    expect(await queued()).toEqual([])
  })
})

describe('recording session changes', () => {
  it('logs a change straight away while the session is not shared with the club yet', async () => {
    store().startSession('Open play', 'doubles', 2)
    store().checkInPlayer(player(1))
    store().startClock()
    await vi.waitFor(async () => expect((await queued()).map((e) => e.summary)).toEqual([
      'Created “Open play” (Doubles, 2 courts)',
      'Checked in P1',
      'Started the session: waiting times run from now',
    ]))
    expect((await queued()).every((e) => e.sessionId === store().sessionId && e.clubSlug === 'downtown')).toBe(true)
  })

  it('while shared, logs a change only once the club has taken it', async () => {
    store().startSession('Open play', 'doubles', 2)
    store().shareSession()
    await db.auditQueue.clear()
    store().checkInPlayer(player(1))
    store().checkInPlayer(player(2))
    expect(store().pending.map((p) => p.audit?.summary)).toEqual(['Checked in P1', 'Checked in P2'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await queued()).toEqual([])

    // The club took the first change only.
    const { session } = store()
    store().confirmPublished(1, session!, 1)
    await vi.waitFor(async () => expect((await queued()).map((e) => e.summary)).toEqual(['Checked in P1']))
    expect(store().pending.map((p) => p.audit?.summary)).toEqual(['Checked in P2'])
  })

  it('logs a change another device got to first as not applied, and one replayed as it was', async () => {
    store().startSession('Open play', 'singles', 2)
    store().startClock()
    for (const n of [1, 2]) store().checkInPlayer(player(n))
    store().shareSession()
    const club = store().session!
    store().startGame(1)
    store().checkInPlayer(player(3))
    await db.auditQueue.clear()

    // Meanwhile the other device closed Court 1, so this device's game cannot start there.
    const { applyAction } = await import('@/store/actions')
    const theirs = applyAction(club, { type: 'closeCourt', courtId: 1, now: 0 }).session
    store().rebaseOnto(5, theirs)
    await vi.waitFor(async () =>
      expect((await queued()).map((e) => [e.kind, e.summary])).toEqual([
        ['startGameNotApplied', expect.stringMatching(/^Not applied \(changed on another device\): Court 1: started /)],
      ]),
    )
    expect(store().pending.map((p) => p.audit?.summary)).toEqual(['Checked in P3'])
  })
})

describe('flushAudit', () => {
  const entry = (n: number): AuditEntry => ({
    ...newAuditEntry('checkIn', `Checked in P${n}`)!,
    at: new Date(Date.UTC(2026, 8, 27, 10, 0, 0, n)).toISOString(),
  })
  const fakeApi = (postAudit = vi.fn(async () => {})) => ({ api: { postAudit } as unknown as CloudApi, postAudit })

  it('sends what is queued in batches of 100, oldest first, and forgets what the club has', async () => {
    await queueAudit(Array.from({ length: 150 }, (_, i) => entry(i)))
    const { api, postAudit } = fakeApi()
    expect(await flushAudit(api)).toBe(true)
    expect(postAudit).toHaveBeenCalledTimes(2)
    const [first, second] = postAudit.mock.calls as unknown as [string, AuditEntry[]][]
    expect(first[0]).toBe('tok-1')
    expect(first[1]).toHaveLength(100)
    expect(first[1][0].summary).toBe('Checked in P0')
    expect(second[1]).toHaveLength(50)
    expect(await queued()).toEqual([])
  })

  it('keeps what did not go through for next time', async () => {
    await queueAudit(Array.from({ length: 150 }, (_, i) => entry(i)))
    let calls = 0
    const { api } = fakeApi(
      vi.fn(async () => {
        if (++calls === 2) throw new CloudError('network')
      }),
    )
    expect(await flushAudit(api)).toBe(false)
    expect(await queued()).toHaveLength(50)
  })

  it('never sends one club what was logged for another', async () => {
    await queueAudit([entry(1)])
    useClubAuth.setState({ club: { ...club, slug: 'uptown', token: 'tok-2' } })
    await queueAudit([entry(2)])
    const { api, postAudit } = fakeApi()
    await flushAudit(api)
    const sent = (postAudit.mock.calls as unknown as [string, AuditEntry[]][]).flatMap(([, batch]) => batch)
    expect(sent.map((e) => e.summary)).toEqual(['Checked in P2'])
    expect(await unsentAudit('downtown')).toEqual([])
  })
})

describe('mergeEntries', () => {
  const at = (n: number, summary: string): AuditEntry => ({ ...newAuditEntry('checkIn', summary)!, at: new Date(n * 1000).toISOString() })

  it('lists this device’s unsent entries among the club’s, newest first, each once', () => {
    const sent = [at(3, 'C'), at(1, 'A')]
    const alsoSent = { ...sent[0] }
    const unsent = [at(4, 'D'), at(2, 'B'), alsoSent]
    expect(mergeEntries(unsent, sent).map(({ entry, unsent }) => [entry.summary, unsent])).toEqual([
      ['D', true],
      ['C', false],
      ['B', true],
      ['A', false],
    ])
  })
})

describe('countUnsent', () => {
  beforeEach(async () => {
    await db.players.clear()
    await db.history.clear()
  })

  it('counts what the club has not been sent yet, for the club signed in', async () => {
    store().startSession('Open play', 'doubles', 1)
    store().shareSession()
    store().checkInPlayer(player(1))
    await addOrGetPlayer('Ann', 3, undefined, 'downtown')
    await addOrGetPlayer('Zed', 3, undefined, 'uptown')
    useClubAuth.setState({ pendingLifetime: [{ batchId: 'b', slug: 'downtown', players: [] }, { batchId: 'c', slug: 'uptown', players: [] }] })
    await vi.waitFor(async () => expect(await db.auditQueue.count()).toBeGreaterThan(0))

    const counts = await countUnsent()
    expect(counts).toMatchObject({ sessionChanges: 1, savedPlayers: 1, leaderboard: 1, pastSessions: 0 })
    expect(counts.activity).toBe(await db.auditQueue.where('clubSlug').equals('downtown').count())
  })

  it('counts nothing without a club: there is nowhere to send it', async () => {
    useClubAuth.setState({ club: null })
    expect(await countUnsent()).toEqual(NOTHING_UNSENT)
  })
})

describe('matchesSearch', () => {
  const entry: AuditEntry = {
    id: '0b6f4a4e-3c1d-4b8e-9a51-2f1f0c2d9e10',
    at: '2026-09-27T10:00:00.000Z',
    kind: 'recordScore',
    summary: 'Court 2: Blue won 11–7',
    device: { id: 'd', label: 'SM-S918B · Android 14 · Chrome', name: 'Maria' },
  }

  it('finds the text in what happened, the device name or its details, ignoring case', () => {
    expect(matchesSearch(entry, 'blue WON')).toBe(true)
    expect(matchesSearch(entry, 'maria')).toBe(true)
    expect(matchesSearch(entry, 'sm-s918')).toBe(true)
    expect(matchesSearch(entry, 'Desk')).toBe(false)
  })

  it('matches everything when there is no search', () => {
    expect(matchesSearch(entry, '')).toBe(true)
    expect(matchesSearch(entry, '   ')).toBe(true)
  })

  it('works for a device not named yet', () => {
    expect(matchesSearch({ ...entry, device: { id: 'd', label: 'iPhone' } }, 'iphone')).toBe(true)
  })
})

describe('pageCount', () => {
  it('is at least one page, and a page more for any leftover', () => {
    expect([0, 1, 20, 21, 45].map((total) => pageCount(total, 20))).toEqual([1, 1, 1, 2, 3])
  })
})
