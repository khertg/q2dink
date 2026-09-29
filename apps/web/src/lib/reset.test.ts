import { describe, expect, it, vi } from 'vitest'
import { LOCAL_STORAGE_KEYS_TO_CLEAR, NOTHING_UNSENT, resetDevice, unsentChanges } from './reset'

function fakeStorage(keys: string[]) {
  const data = new Map(keys.map((k) => [k, 'x']))
  return { data, storage: { removeItem: (k: string) => void data.delete(k) } }
}

const ALL_KEYS = ['q2dink-session', 'q2dink-club', 'q2dink-device', 'theme', 'q2dink-card-colors', 'q2dink-install-dismissed']

describe('resetDevice', () => {
  it('removes the session and the login, and keeps the device and the display preferences', async () => {
    const { data, storage } = fakeStorage(ALL_KEYS)
    const deleteDatabase = vi.fn(async () => {})
    await resetDevice({ storage, deleteDatabase })
    expect(deleteDatabase).toHaveBeenCalledOnce()
    expect([...data.keys()]).toEqual(['q2dink-device', 'theme', 'q2dink-card-colors', 'q2dink-install-dismissed'])
    expect(LOCAL_STORAGE_KEYS_TO_CLEAR).toEqual(['q2dink-session', 'q2dink-club', 'q2dink-skill-scale', 'q2dink-voice'])
  })

  it('ends the login on the server first', async () => {
    const order: string[] = []
    const { storage } = fakeStorage(ALL_KEYS)
    await resetDevice({
      storage: { removeItem: (k) => (order.push(`remove ${k}`), storage.removeItem(k)) },
      deleteDatabase: async () => void order.push('delete database'),
      logout: async () => void order.push('logout'),
    })
    expect(order).toEqual(['logout', 'delete database', 'remove q2dink-session', 'remove q2dink-club', 'remove q2dink-skill-scale', 'remove q2dink-voice'])
  })

  it('still resets when the server cannot be reached', async () => {
    const { data, storage } = fakeStorage(ALL_KEYS)
    const deleteDatabase = vi.fn(async () => {})
    await resetDevice({
      storage,
      deleteDatabase,
      logout: async () => {
        throw new Error('offline')
      },
    })
    expect(deleteDatabase).toHaveBeenCalledOnce()
    expect(data.has('q2dink-club')).toBe(false)
  })

  it('does not stop at storage it cannot write', async () => {
    await expect(
      resetDevice({
        storage: {
          removeItem: () => {
            throw new Error('blocked')
          },
        },
        deleteDatabase: async () => {},
      }),
    ).resolves.toBeUndefined()
  })
})

describe('unsentChanges', () => {
  it('says nothing is lost when the club has everything', () => {
    expect(unsentChanges(NOTHING_UNSENT)).toEqual([])
  })

  it('names each kind of unsent change, one or many', () => {
    expect(
      unsentChanges({
        sessionChanges: 1,
        sessionEnd: true,
        activity: 12,
        pastSessions: 1,
        savedPlayers: 2,
        renames: 1,
        leaderboard: 3,
        avatars: 1,
        photoSharing: true,
        skillLevels: true,
        calloutVoice: true,
        cardLogos: 2,
      }),
    ).toEqual([
      '1 change to the running session',
      'The end of a session (the club still shows it as running)',
      '1 ended session',
      '2 saved players',
      '1 player rename',
      '3 results for the leaderboard',
      '1 avatar',
      'The player photos switch',
      'The club’s skill levels',
      'The club’s call-out voice',
      '2 changes to the card logos',
      '12 activity log entries',
    ])
    expect(unsentChanges({ ...NOTHING_UNSENT, sessionChanges: 3, activity: 1 })).toEqual([
      '3 changes to the running session',
      '1 activity log entry',
    ])
  })
})
