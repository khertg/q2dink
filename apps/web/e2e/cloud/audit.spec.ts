import { expect, test, type Browser, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, choose, confirmLock, openFromList, openSessionMenu, playerAction, startGame, startSession } from '../helpers'
import { apiCreateClub, bearer, expectSignedIn, nameDevice, storedToken, uiLogin, uniqueClub, type TestClub } from './support'

failOnCspViolations(test)

/** The same phone twice: two iPhone 16s say exactly the same about themselves. */
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const FOLLOW = { timeout: 15_000 }

async function iPhone(browser: Browser) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    serviceWorkers: 'block',
    userAgent: IPHONE,
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    isMobile: true,
  })
  return { context, page: await context.newPage() }
}

/** Log in and land on the naming step, without naming the device yet. */
async function logIn(page: Page, club: TestClub) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Log in' }).click()
  const dialog = page.getByRole('dialog', { name: 'Log in to your club' })
  await dialog.getByLabel('Club link name').fill(club.slug)
  await dialog.getByLabel('Password').fill(club.password)
  await dialog.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByLabel('Device name')).toBeVisible()
}

async function openActivity(page: Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Activity' }).click()
  return page.getByRole('dialog', { name: 'Session activity' })
}

test('tells two identical iPhones apart, and shows who did what', async ({ browser, request }) => {
  test.setTimeout(90_000)
  const club = uniqueClub('Audit')
  await apiCreateClub(request, club)
  const desk = await iPhone(browser)
  const maria = await iPhone(browser)

  // Each iPhone is asked for a name; the second cannot take the first one's.
  await logIn(desk.page, club)
  await expect(desk.page.getByText(/This device: iPhone · iOS 18 · Safari #[0-9a-f]{4}/)).toBeVisible()
  await nameDevice(desk.page, 'Desk')
  await logIn(maria.page, club)
  await maria.page.getByLabel('Device name').fill('desk')
  await maria.page.getByRole('button', { name: 'Continue' }).click()
  await expect(maria.page.getByRole('alert')).toContainText('Another device of this club already has that name')
  await nameDevice(maria.page, 'Maria')

  // Desk starts the session and checks players in; Maria joins and starts a game.
  await startSession(desk.page, { location: 'Audit Night' })
  await checkIn(desk.page, ['Ann', 'Bob', 'Cy', 'Dee'])
  await openFromList(maria.page, 'Audit Night', FOLLOW)
  await expect(maria.page.getByRole('heading', { name: 'Audit Night' })).toBeVisible()
  await startGame(maria.page)

  // Both devices see both devices' changes, each under its own name.
  for (const page of [desk.page, maria.page]) {
    const activity = await openActivity(page)
    const rows = activity.getByRole('list', { name: 'Activity' }).getByRole('listitem')
    await expect(rows.filter({ hasText: 'Checked in Ann' }).filter({ hasText: 'Desk' })).toHaveCount(1, FOLLOW)
    await expect(rows.filter({ hasText: /^Court 1: started / }).filter({ hasText: 'Maria' })).toHaveCount(1, FOLLOW)
    await expect(rows.filter({ hasText: 'Created “Audit Night”' }).filter({ hasText: 'Desk' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Started the session' }).filter({ hasText: 'Desk' })).toHaveCount(1)
    await expect(rows.filter({ hasText: 'Joined “Audit Night”' }).filter({ hasText: 'Maria' })).toHaveCount(1)
    await page.keyboard.press('Escape')
  }

  // The club-wide log can show one device only.
  await openSessionMenu(desk.page)
  await desk.page.getByRole('button', { name: 'End session' }).click()
  await desk.page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
  await desk.page.getByRole('button', { name: 'Club activity' }).click()
  const clubLog = desk.page.getByRole('dialog', { name: 'Club activity' })
  const rows = clubLog.getByRole('list', { name: 'Activity' }).getByRole('listitem')
  await expect(rows.filter({ hasText: 'Ended “Audit Night”' })).toHaveCount(1, FOLLOW)
  await clubLog.getByLabel('Show activity of').click()
  await desk.page.getByRole('option', { name: /^Maria · iPhone/ }).click()
  await expect(rows.filter({ hasText: /^Court 1: started / })).toHaveCount(1, FOLLOW)
  await expect(rows.filter({ hasText: 'Desk' })).toHaveCount(0)
  await desk.page.keyboard.press('Escape')

  // Past sessions show the session's own log.
  await desk.page.getByRole('button', { name: 'Past sessions' }).click()
  await desk.page.getByRole('button', { name: /Audit Night/ }).first().click()
  await desk.page.getByRole('button', { name: 'Activity' }).click()
  const pastLog = desk.page.getByRole('dialog', { name: 'Session activity' })
  await expect(pastLog.getByRole('listitem').filter({ hasText: 'Checked in Ann' })).toHaveCount(1, FOLLOW)

  await desk.context.close()
  await maria.context.close()
})

test('club activity is paged 20 at a time and can be searched', async ({ page, request }) => {
  const club = uniqueClub('Paged')
  await apiCreateClub(request, club)
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
  const token = await storedToken(page)

  // 45 older entries from another device, "Checked in P1" to "Checked in P45".
  const seeder = { id: 'seeder-device', label: 'iPhone · iOS 18 · Safari', name: 'Seeder' }
  expect((await request.put('/api/devices/me', { headers: bearer(token), data: seeder })).status()).toBe(204)
  const start = Date.now() - 60 * 60 * 1000
  const entries = Array.from({ length: 45 }, (_, i) => ({
    // Random, like a device's: an entry id is unique across the whole server, and this test runs in more than one project.
    id: crypto.randomUUID(),
    at: new Date(start + (i + 1) * 1000).toISOString(),
    device: seeder,
    kind: 'checkIn',
    summary: `Checked in P${i + 1}`,
  }))
  expect((await request.post('/api/audit', { headers: bearer(token), data: { entries } })).status()).toBe(204)

  await page.getByRole('button', { name: 'Club activity' }).click()
  const log = page.getByRole('dialog', { name: 'Club activity' })
  const rows = log.getByRole('list', { name: 'Activity' }).getByRole('listitem')
  const pages = log.getByRole('navigation', { name: 'Activity pages' })
  // This device's own entries (logging in, naming it) come first, then the 45: three pages.
  await expect(pages.getByText('Page 1 of 3')).toBeVisible()
  await expect(rows).toHaveCount(20)
  await pages.getByRole('button', { name: 'Next' }).click()
  await expect(pages.getByText('Page 2 of 3')).toBeVisible()
  await expect(rows.filter({ hasText: 'Checked in P20' })).toHaveCount(1)
  await pages.getByRole('button', { name: 'Previous' }).click()
  await expect(pages.getByText('Page 1 of 3')).toBeVisible()

  // A search looks through the whole log, and fits on one page here.
  await log.getByLabel('Search activity').fill('checked in p4')
  await expect(rows).toHaveCount(7) // P4 and P40 to P45
  await expect(pages).toHaveCount(0)
  await log.getByLabel('Search activity').fill('nobody did this')
  await expect(log.getByText('Nothing matches “nobody did this”.')).toBeVisible()

  // One device, with and without a search.
  await log.getByLabel('Search activity').fill('')
  await log.getByLabel('Show activity of').click()
  await page.getByRole('option', { name: /^Seeder · / }).click()
  await expect(pages.getByText('Page 1 of 3')).toBeVisible()
  await log.getByLabel('Search activity').fill('P4')
  await expect(rows).toHaveCount(7)
})

test('the log says which partners a change unlocked, and by what', async ({ page, request }) => {
  const club = uniqueClub('Audit')
  await apiCreateClub(request, club)
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
  await startSession(page, { location: 'Lock Night' })
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'])
  await startGame(page)
  const court = page.getByRole('region', { name: 'Court 1', exact: true })
  const blue = await court.getByRole('group', { name: 'Blue' }).locator('li').allInnerTexts()
  const [a, b] = blue.map((row) => row.split('\n')[0].trim())

  await page.getByRole('tab', { name: 'Check-in' }).click()
  await choose(page, 'First partner', a)
  await choose(page, 'Second partner', b)
  await page.getByRole('button', { name: 'Lock partners' }).click()
  await confirmLock(page)
  await page.getByRole('tab', { name: 'Board' }).click()

  await playerAction(court, a, 'Remove from court')
  await page.getByRole('dialog', { name: `Unlock ${a} and ${b}?` }).getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText(`${a} and ${b} are no longer locked partners.`).first()).toBeVisible()

  const activity = await openActivity(page)
  await expect(activity.getByText(`Court 1: took ${a} off, spot left open. Unlocked ${a} & ${b}`)).toBeVisible(FOLLOW)
  await expect(activity.getByText(`Locked ${a} & ${b} as partners`, { exact: true })).toBeVisible()
})
