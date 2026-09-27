import { expect, test, type Browser, type Page } from '@playwright/test'
import { checkIn, openSessionMenu, startGame, recordWin, startSession } from './helpers'

/**
 * The app used to be called Matchup and stored its data under `matchup...` names. A device that
 * already has that data must still have it after the rename. These tests make real data with the app,
 * move it to the old names in a fresh browser (as an older version would have left it), and load the app.
 */

interface Snapshot {
  local: Record<string, string>
  tables: Record<string, unknown[]>
}

/** Everything the app saved in this browser, read straight from storage. */
async function readSaved(page: Page): Promise<Snapshot> {
  return page.evaluate(async () => {
    const local: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      local[key] = localStorage.getItem(key)!
    }
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open('q2dink')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tables: Record<string, unknown[]> = {}
    for (const name of ['players', 'history', 'settings']) {
      tables[name] = await new Promise<unknown[]>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    db.close()
    return { local, tables }
  })
}

/** In a browser that has never seen the app, save that data under the old names, as the old version did. */
async function saveAsOldVersion(browser: Browser, baseURL: string, data: Snapshot) {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.goto('/favicon.svg') // any page on the site, so its storage can be written before the app runs
  await page.evaluate(async (saved) => {
    for (const [key, value] of Object.entries(saved.local)) {
      if (key === 'q2dink-session' || key === 'q2dink-club') localStorage.setItem(key.replace('q2dink', 'matchup'), value)
      else localStorage.setItem(key, value)
    }
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('matchup', 30)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('players', { keyPath: 'id', autoIncrement: true }).createIndex('name', 'name')
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true }).createIndex('createdAt', 'createdAt')
        db.createObjectStore('history', { keyPath: 'id' }).createIndex('endedAt', 'endedAt')
        db.createObjectStore('settings', { keyPath: 'key' })
      }
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['players', 'history', 'settings'], 'readwrite')
        for (const [table, rows] of Object.entries(saved.tables)) for (const row of rows) tx.objectStore(table).put(row)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  }, data)
  return { context, page }
}

const databases = (page: Page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort())

test.describe('data from before the app was renamed', () => {
  test('a running session, the saved roster and finished sessions are all still there', async ({ page, browser, baseURL }) => {
    // Make real data: a finished session in the history, a roster with a player who is not checked in, and a session in progress.
    await startSession(page, { location: 'Old Night', mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob'])
    await startGame(page)
    await recordWin(page)
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save and end session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()
    await startSession(page, { location: 'Running Night', mode: 'Singles' })
    await checkIn(page, ['Cy', 'Dee'])
    const saved = await readSaved(page)
    expect(saved.tables.players.length).toBeGreaterThanOrEqual(4)
    expect(saved.tables.history.length).toBe(1)
    expect(Object.keys(saved.local)).toContain('q2dink-session')

    const old = await saveAsOldVersion(browser, baseURL!, saved)
    const fresh = old.page
    // Before the app loads, only the old names exist.
    expect(await databases(fresh)).toEqual(['matchup'])
    expect(await fresh.evaluate(() => [localStorage.getItem('matchup-session') !== null, localStorage.getItem('q2dink-session')])).toEqual([true, null])

    await fresh.goto('/')
    // The running session is back, with its players.
    await expect(fresh.getByRole('heading', { name: 'Running Night' })).toBeVisible()
    await expect(fresh.getByText('Cy').first()).toBeVisible()
    await expect(fresh.getByText('Dee').first()).toBeVisible()

    // The roster came across: a player from the earlier session can be checked in from it.
    await fresh.getByRole('tab', { name: 'Check-in' }).click()
    const roster = fresh.getByRole('group', { name: 'Check in from the roster' })
    await expect(roster.getByRole('checkbox', { name: 'Ann' })).toBeVisible()
    await expect(roster.getByRole('checkbox', { name: 'Bob' })).toBeVisible()

    // Finished sessions came across too.
    await openSessionMenu(fresh)
    await fresh.getByRole('button', { name: 'End session' }).click()
    await fresh.getByRole('dialog').getByRole('button', { name: /^(Save and end session|End session)$/ }).click()
    await expect(fresh.getByText('Set up an open play session')).toBeVisible()
    await fresh.getByRole('button', { name: 'Past sessions' }).click()
    const list = fresh.getByRole('dialog', { name: 'Past sessions' })
    await expect(list.getByRole('button', { name: /Old Night/ })).toBeVisible()
    await expect(list.getByRole('button', { name: /Running Night/ })).toBeVisible()

    // The old names are gone from the browser: the data now lives under the new ones.
    expect(await fresh.evaluate(() => ['matchup-session', 'matchup-club'].map((key) => localStorage.getItem(key)))).toEqual([null, null])
    await expect.poll(() => databases(fresh)).toEqual(['q2dink'])
    await old.context.close()
  })

  test('starts fresh, with nothing to move, on a device that never had the old data', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Set up an open play session')).toBeVisible()
    // The database is opened a moment after the first screen shows.
    await expect.poll(() => databases(page)).toEqual(['q2dink'])
  })

  test('a second launch after the move changes nothing', async ({ page, browser, baseURL }) => {
    await startSession(page, { location: 'Once', mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob'])
    const old = await saveAsOldVersion(browser, baseURL!, await readSaved(page))
    await old.page.goto('/')
    await expect(old.page.getByRole('heading', { name: 'Once' })).toBeVisible()
    await old.page.reload()
    await expect(old.page.getByRole('heading', { name: 'Once' })).toBeVisible()
    await expect(old.page.getByText('Ann').first()).toBeVisible()
    await old.context.close()
  })
})
