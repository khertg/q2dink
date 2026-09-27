import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { checkIn, openFromList, openSessionMenu, openSessionsList, startGame, recordWin } from '../helpers'
import {
  apiCreateClub,
  bearer,
  expectSignedIn,
  storedToken,
  uiLogin,
  uniqueClub,
  goLive,
  type TestClub,
} from './support'

/** Sign in, then play one singles game to completion (Ann beats Bob). */
async function signInAndPlay(page: Page, club: TestClub, location: string) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
  await page.getByLabel('Session name').fill(location)
  await page.getByRole('button', { name: 'Singles' }).click()
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('heading', { name: location })).toBeVisible()
  await goLive(page)
  await checkIn(page, ['Ann', 'Bob'])
  await startGame(page)
  await recordWin(page)
  await expect(page.getByText('Court 1: Blue won')).toBeVisible()
}

async function end(page: Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'End session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Save and end session' }).click()
  await expect(page.getByText('Set up an open play session')).toBeVisible()
}

interface Summary {
  id: string
  location: string
  games: number
  players: number
}

const history = (request: APIRequestContext, token: string) => async () => {
  const response = await request.get('/api/history', { headers: bearer(token) })
  return response.ok() ? ((await response.json()).sessions as Summary[]) : []
}

const clubPlayers = (request: APIRequestContext, slug: string) => async () => {
  const response = await request.get(`/api/clubs/${slug}/players`)
  return (await response.json()).players as { name: string; games: number; wins: number }[]
}

test.describe('history in the club cloud', () => {
  test('uploads an ended session, without anyone doing anything', async ({ page, request }) => {
    const club = uniqueClub('Archive')
    await apiCreateClub(request, club)
    await signInAndPlay(page, club, 'Cloud Night')
    const token = await storedToken(page)
    await end(page)

    await expect.poll(async () => (await history(request, token)()).map((s) => s.location)).toEqual(['Cloud Night'])
    const [entry] = await history(request, token)()
    expect(entry).toMatchObject({ games: 1, players: 2 })
  })

  test('shows it on a second staff device, which can resume it', async ({ page, browser, request }) => {
    const club = uniqueClub('Two')
    await apiCreateClub(request, club)
    await signInAndPlay(page, club, 'Shared Night')
    const token = await storedToken(page)
    await end(page)
    await expect.poll(async () => (await history(request, token)()).length).toBe(1)

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const second = await other.newPage()
    await second.goto('/')
    await uiLogin(second, club)
    await expectSignedIn(second)

    await second.getByRole('button', { name: 'Past sessions' }).click()
    const list = second.getByRole('dialog', { name: 'Past sessions' })
    const row = list.getByRole('button', { name: /Shared Night/ })
    await expect(row).toContainText('1 game')
    await expect(row.getByText('Club')).toBeVisible() // this device has never seen it
    await row.click()
    await expect(second.getByRole('dialog', { name: 'Shared Night' }).getByRole('row').nth(1)).toContainText('Ann')
    await second.getByRole('dialog', { name: 'Shared Night' }).getByRole('button', { name: 'Resume this session' }).click()

    await expect(second.getByRole('heading', { name: 'Shared Night' })).toBeVisible()
    await second.getByRole('tab', { name: 'Standings' }).click()
    await expect(second.getByRole('row').nth(1)).toContainText('Gold medal')

    // Ending it again on the second device updates the club's copy in place.
    await second.getByRole('tab', { name: 'Board' }).click()
    await startGame(second)
    await recordWin(second)
    await expect(second.getByText('Court 1: Blue won').last()).toBeVisible()
    await end(second, false)
    await expect.poll(async () => (await history(request, token)()).map((s) => s.games)).toEqual([2])

    // The second device now keeps its own copy too.
    await second.getByRole('button', { name: 'Past sessions' }).click()
    await expect(second.getByRole('dialog', { name: 'Past sessions' }).getByRole('listitem')).toHaveCount(1)
    await other.close()
  })

  test('sends a session that ended offline once the connection returns', async ({ page, context, request }) => {
    const club = uniqueClub('Offline')
    await apiCreateClub(request, club)
    await signInAndPlay(page, club, 'Offline Night')
    const token = await storedToken(page)

    await context.setOffline(true)
    await end(page)
    await page.waitForTimeout(1500)
    expect(await history(request, token)()).toEqual([])

    // It is still there on this device meanwhile.
    await page.getByRole('button', { name: 'Past sessions' }).click()
    await expect(page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Offline Night/ })).toBeVisible()
    await page.keyboard.press('Escape')

    await context.setOffline(false)
    await expect.poll(async () => (await history(request, token)()).length, { timeout: 15_000 }).toBe(1)
  })

  test('deleting removes the club’s copy as well', async ({ page, request }) => {
    const club = uniqueClub('Delete')
    await apiCreateClub(request, club)
    await signInAndPlay(page, club, 'Doomed Night')
    const token = await storedToken(page)
    await end(page)
    await expect.poll(async () => (await history(request, token)()).length).toBe(1)

    await page.getByRole('button', { name: 'Past sessions' }).click()
    await page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Doomed Night/ }).click()
    const view = page.getByRole('dialog', { name: 'Doomed Night' })
    await view.getByRole('button', { name: 'Delete', exact: true }).click()
    await view.getByRole('button', { name: 'Delete session' }).click()
    await expect(page.getByText('Session deleted')).toBeVisible()
    await expect.poll(async () => (await history(request, token)()).length).toBe(0)
  })

  test('deleting and restoring is club-wide: another staff device follows both', async ({ page, browser, request }) => {
    const club = uniqueClub('Trash')
    await apiCreateClub(request, club)
    await signInAndPlay(page, club, 'Oops Night')
    const token = await storedToken(page)
    await end(page)
    await expect.poll(async () => (await history(request, token)()).length).toBe(1)

    // Deleted on this device: the club moves it to Recently deleted.
    await page.getByRole('button', { name: 'Past sessions' }).click()
    await page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Oops Night/ }).click()
    const view = page.getByRole('dialog', { name: 'Oops Night' })
    await view.getByRole('button', { name: 'Delete', exact: true }).click()
    await view.getByRole('button', { name: 'Delete session' }).click()
    const deletedOnClub = async () =>
      ((await (await request.get('/api/history/deleted', { headers: bearer(token) })).json()).sessions as Summary[]).map((s) => s.location)
    await expect.poll(deletedOnClub).toEqual(['Oops Night'])
    await page.keyboard.press('Escape')

    // Another staff device lists it only in Recently deleted, and restores it.
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const second = await other.newPage()
    await second.goto('/')
    await uiLogin(second, club)
    await expectSignedIn(second)
    await second.getByRole('button', { name: 'Past sessions' }).click()
    const list = second.getByRole('dialog', { name: 'Past sessions' })
    await expect(list.getByText('No past sessions yet.')).toBeVisible()
    await list.getByRole('button', { name: 'Recently deleted (1)' }).click()
    const trash = second.getByRole('dialog', { name: 'Recently deleted' })
    await trash.getByRole('button', { name: 'Restore' }).click()
    await expect(second.getByText('“Oops Night” restored')).toBeVisible()
    await expect.poll(async () => (await history(request, token)()).map((s) => s.location)).toEqual(['Oops Night'])

    // The first device, which deleted it, shows it again.
    await page.getByRole('button', { name: 'Past sessions' }).click()
    const again = page.getByRole('dialog', { name: 'Past sessions' })
    await expect(again.getByRole('button', { name: /Oops Night/ })).toBeVisible()
    await expect(again.getByRole('button', { name: /Recently deleted/ })).toHaveCount(0)
    await other.close()
  })

  test('a session resumed on another device does not count its old games again on the club leaderboard', async ({
    page,
    browser,
    request,
  }) => {
    const club = uniqueClub('Leaderboard')
    await apiCreateClub(request, club)
    await signInAndPlay(page, club, 'Count Night')
    const token = await storedToken(page)
    await end(page)
    await expect.poll(async () => (await clubPlayers(request, club.slug)()).find((p) => p.name === 'Ann')?.games).toBe(1)
    await expect.poll(async () => (await history(request, token)()).length).toBe(1)

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const second = await other.newPage()
    await second.goto('/')
    await uiLogin(second, club)
    await expectSignedIn(second)
    await second.getByRole('button', { name: 'Past sessions' }).click()
    await second.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Count Night/ }).click()
    await second.getByRole('dialog', { name: 'Count Night' }).getByRole('button', { name: 'Resume this session' }).click()
    await expect(second.getByRole('heading', { name: 'Count Night' })).toBeVisible()

    await startGame(second)
    await recordWin(second)
    await expect(second.getByText('Court 1: Blue won').last()).toBeVisible()
    await end(second, true)

    await expect.poll(async () => (await clubPlayers(request, club.slug)()).find((p) => p.name === 'Ann')?.games).toBe(2)
    const players = await clubPlayers(request, club.slug)()
    expect(players.find((p) => p.name === 'Bob')?.games).toBe(2)
    await other.close()
  })
})

test.describe('two clubs on one device', () => {
  test('a session that ended under one club is never uploaded to the next club that logs in', async ({ page, request }) => {
    const clubA = uniqueClub('Alpha')
    const clubB = uniqueClub('Bravo')
    await apiCreateClub(request, clubA)
    const { token: tokenB } = await apiCreateClub(request, clubB)

    await signInAndPlay(page, clubA, 'Alpha Night')
    // Alpha's session ends with no connection, so it is kept on the device, waiting to be sent.
    await page.route('**/api/**', (route) => route.abort('connectionrefused'))
    await end(page)
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.unroute('**/api/**')

    // Bravo logs in on the same device: Alpha's session must not go to Bravo.
    await uiLogin(page, clubB)
    await expectSignedIn(page)
    await page.waitForTimeout(2000)
    expect(await history(request, tokenB)()).toEqual([])
    // It is still on this device, but it is Alpha's: Bravo never sees it in Past sessions.
    await page.getByRole('button', { name: 'Past sessions' }).click()
    await expect(page.getByRole('dialog', { name: 'Past sessions' }).getByText('No past sessions yet.')).toBeVisible()
    await page.keyboard.press('Escape')

    // When Alpha logs back in, it is sent to Alpha.
    await page.getByRole('button', { name: 'Log out' }).click()
    await uiLogin(page, clubA)
    await expectSignedIn(page)
    const tokenA = await storedToken(page)
    await expect.poll(async () => (await history(request, tokenA)()).map((s) => s.location)).toEqual(['Alpha Night'])
    expect(await history(request, tokenB)()).toEqual([])
    await page.getByRole('button', { name: 'Past sessions' }).click()
    await expect(page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Alpha Night/ })).toBeVisible()
  })

  test('a session left open under one club is not listed for another club, and is there again for its own', async ({
    page,
    request,
  }) => {
    const clubA = uniqueClub('Alpha')
    const clubB = uniqueClub('Bravo')
    await apiCreateClub(request, clubA)
    await apiCreateClub(request, clubB)

    await signInAndPlay(page, clubA, 'Alpha Open')
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Leave session' }).click()
    await expect(openSessionsList(page).getByText('Alpha Open')).toBeVisible()
    await page.getByRole('button', { name: 'Log out' }).click()

    await uiLogin(page, clubB)
    await expectSignedIn(page)
    await page.waitForTimeout(2000)
    await expect(page.getByText('Alpha Open')).toHaveCount(0)

    await page.getByRole('button', { name: 'Log out' }).click()
    await uiLogin(page, clubA)
    await expectSignedIn(page)
    await openFromList(page, 'Alpha Open')
    await expect(page.getByRole('heading', { name: 'Alpha Open' })).toBeVisible()
  })
})
