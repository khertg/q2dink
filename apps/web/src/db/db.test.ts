import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { db } from './db'

it('drops the club logo a device kept when it moves past version 6, keeps its other settings, and gains card logos', async () => {
  // The device as version 5 of the app left it, logo and all.
  const old = new Dexie('q2dink')
  old.version(5).stores({
    players: '++id, name, clubSlug',
    sessions: '++id, createdAt',
    history: 'id, endedAt',
    settings: 'key',
    auditQueue: 'id, at, clubSlug',
  })
  await old.table('settings').bulkPut([
    { key: 'logo', value: { data: 'data:image/png;base64,AAAA', dirty: true } },
    { key: 'sharePhotos', value: true },
  ])
  old.close()

  await db.open()
  expect(db.verno).toBe(7)
  expect(await db.settings.get('logo')).toBeUndefined()
  expect(await db.settings.get('sharePhotos')).toEqual({ key: 'sharePhotos', value: true })
  expect(await db.cardLogos.count()).toBe(0)
})
