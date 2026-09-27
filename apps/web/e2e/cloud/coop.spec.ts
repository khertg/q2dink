import { expect, test, type Browser, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, openFromList, openSessionMenu, openSessionsList, recordWin, startGame, startSession } from '../helpers'
import { apiCreateClub, expectSignedIn, uiLogin, uniqueClub, type TestClub, goLive } from './support'

failOnCspViolations(test)

/** Seconds a change may take to reach the other device: a short send delay plus the live stream. */
const FOLLOW = { timeout: 10_000 }

async function signIn(page: Page, club: TestClub) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
}

async function secondDevice(browser: Browser, club: TestClub) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const page = await context.newPage()
  await signIn(page, club)
  return { context, page }
}

// Queue rows, not the toasts (also an ordered list) that say who was checked in.
const queued = (page: Page, name: string) => page.locator('ol:not([data-sonner-toaster]) > li').filter({ hasText: name })
const court = (page: Page, name = 'Court 1') => page.getByRole('region', { name, exact: true })

test.describe('two staff devices running one session', () => {
  test('join from the setup screen, then changes on either show on both', async ({ page, browser, request }) => {
    const club = uniqueClub('Coop')
    await apiCreateClub(request, club)
    const pc = await secondDevice(browser, club)

    // The phone starts the session while the PC waits on its setup screen: it is offered without a reload.
    await signIn(page, club)
    await startSession(page, { location: 'Co-op Night' })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await openFromList(pc.page, 'Co-op Night', FOLLOW)
    await expect(pc.page.getByRole('heading', { name: 'Co-op Night' })).toBeVisible()
    await expect(queued(pc.page, 'Dee')).toBeVisible()

    // A check-in on the PC reaches the phone; a game and its score on the phone reach the PC.
    await checkIn(pc.page, ['Eve'])
    await expect(queued(page, 'Eve')).toBeVisible(FOLLOW)
    await startGame(page)
    await expect(court(pc.page).getByText('In play')).toBeVisible(FOLLOW)
    await recordWin(page, 'Court 1', 'A', [11, 4])
    await expect(pc.page.getByRole('group', { name: 'Matches' })).toContainText('Matches (1)', FOLLOW)

    // Each device changes something while the phone is offline; afterwards both have both changes.
    await page.context().setOffline(true)
    await checkIn(page, ['Fay'])
    await checkIn(pc.page, ['Gus'])
    await page.context().setOffline(false)
    for (const device of [page, pc.page]) {
      await expect(queued(device, 'Fay')).toBeVisible(FOLLOW)
      await expect(queued(device, 'Gus')).toBeVisible(FOLLOW)
    }
    await pc.context.close()
  })

  test('when both finish the same game, the first result stands and the other device is told', async ({ page, browser, request }) => {
    const club = uniqueClub('Clash')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page, { location: 'Clash Night' })
    await goLive(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    const pc = await secondDevice(browser, club)
    await openFromList(pc.page, 'Clash Night', FOLLOW)
    await expect(court(pc.page).getByText('In play')).toBeVisible()

    // The phone is offline when it records Court 1; the PC records it, and the club has the PC's first.
    await page.context().setOffline(true)
    await recordWin(page, 'Court 1', 'B', [4, 11])
    await recordWin(pc.page, 'Court 1', 'A', [11, 7])
    await expect
      .poll(async () => ((await (await request.get(`/api/clubs/${club.slug}/live`)).json()) as { state: { courts: { teams: unknown }[] } }).state.courts[0].teams)
      .toBeNull()
    await page.context().setOffline(false)

    await expect(page.getByText(/Not applied, changed on another device/).first()).toBeVisible(FOLLOW)
    const matches = page.getByRole('group', { name: 'Matches' })
    await expect(matches).toContainText('Matches (1)')
    await expect(matches).toContainText('11')
    await expect(matches).toContainText('7')
    await pc.context.close()
  })

  test('ending on one device takes the other back to its setup screen', async ({ page, browser, request }) => {
    const club = uniqueClub('Ending')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page, { location: 'Ending Night' })
    await checkIn(page, ['Ann', 'Bob'])
    const pc = await secondDevice(browser, club)
    await openFromList(pc.page, 'Ending Night', FOLLOW)
    await expect(pc.page.getByRole('heading', { name: 'Ending Night' })).toBeVisible()

    await openSessionMenu(pc.page)
    await pc.page.getByRole('button', { name: 'End session' }).click()
    await pc.page.getByRole('dialog').getByRole('button', { name: /^(Save and end session|End session)$/ }).click()
    await expect(pc.page.getByText('Set up an open play session')).toBeVisible()

    await expect(page.getByText('“Ending Night” was ended on another device')).toBeVisible(FOLLOW)
    await expect(page.getByText('Set up an open play session')).toBeVisible()
    await pc.context.close()
  })

  test('a second session runs beside the first, each on its own live board', async ({ page, browser, request }) => {
    const club = uniqueClub('Two')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page, { location: 'First Night' })
    await goLive(page)
    await checkIn(page, ['Ann'])

    // The PC starts its own session instead of opening the phone's: both keep running.
    const pc = await secondDevice(browser, club)
    await expect(openSessionsList(pc.page).getByText('First Night')).toBeVisible(FOLLOW)
    await startSession(pc.page, { location: 'Second Night' })
    await goLive(pc.page)
    await checkIn(pc.page, ['Zed'])
    await expect(pc.page.getByRole('alert').filter({ hasText: 'Another staff device is running' })).toHaveCount(0)
    await expect(queued(page, 'Ann')).toBeVisible()
    await expect(queued(page, 'Zed')).toHaveCount(0)

    // Players choose their session on the club's link; each session's own link shows just that one.
    const viewer = await pc.context.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    const chooser = viewer.getByText(/This club is running 2 sessions/)
    await expect(chooser).toBeVisible(FOLLOW)
    await viewer.getByRole('link', { name: 'First Night' }).click()
    await expect(viewer).toHaveURL(new RegExp(`/club/${club.slug}/live/[0-9a-f-]{36}$`))
    await expect(viewer.getByText('Ann').first()).toBeVisible(FOLLOW)
    await expect(viewer.getByText('Zed')).toHaveCount(0)
    await pc.context.close()
  })
})

test.describe('pausing and leaving with several staff devices', () => {
  test('a pause on one device is shown on the other, which can resume it for both', async ({ page, browser, request }) => {
    const club = uniqueClub('Pause')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page, { location: 'Pause Night' })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    const pc = await secondDevice(browser, club)
    await openFromList(pc.page, 'Pause Night', FOLLOW)

    // The phone pauses (its own banner says so); the PC is told who paused it, and can resume.
    await page.getByRole('button', { name: 'Pause' }).click()
    await expect(page.getByRole('status').filter({ hasText: /^Paused by this device/ })).toBeVisible()
    const dialog = pc.page.getByRole('dialog', { name: /^Session paused by / })
    await expect(dialog).toBeVisible(FOLLOW)
    // Closing it keeps the session paused, and the banner and the board keep saying so.
    await dialog.getByRole('button', { name: 'Keep paused' }).click()
    await expect(pc.page.getByRole('status').filter({ hasText: /^Paused by / })).toBeVisible()
    await expect(court(pc.page).getByText('The session is paused: resume it to start games.')).toBeVisible()
    await pc.page.getByRole('button', { name: 'Resume' }).click()

    // The phone sees it running again, and who resumed it.
    await expect(page.getByText(/^Resumed by /).first()).toBeVisible(FOLLOW)
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await startGame(page)
    await pc.context.close()
  })

  test('leaving keeps a session running while another device has it open, and pauses it when nobody does', async ({ page, browser, request }) => {
    const club = uniqueClub('Leave')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page, { location: 'Leave Night' })
    await checkIn(page, ['Ann'])
    const pc = await secondDevice(browser, club)
    await openFromList(pc.page, 'Leave Night', FOLLOW)

    // The PC has it open: the phone leaves, and it keeps running.
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Leave session' }).click()
    await expect(page.getByText(/It keeps running on /).first()).toBeVisible()
    await expect(openSessionsList(page).getByText('Leave Night')).toBeVisible()
    await expect(pc.page.getByRole('button', { name: 'Pause' })).toBeVisible()

    // Now the PC leaves too, alone: it is paused, and the phone opening it again is told why, with Resume.
    await openSessionMenu(pc.page)
    await pc.page.getByRole('button', { name: 'Leave session' }).click()
    await expect(pc.page.getByText(/^Paused and left “Leave Night”/).first()).toBeVisible()
    await expect(openSessionsList(page).getByText('Paused', { exact: true })).toBeVisible(FOLLOW)
    await openFromList(page, 'Leave Night')
    const dialog = page.getByRole('dialog', { name: /^Session paused by / })
    await expect(dialog).toContainText('left the session')
    await dialog.getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await pc.context.close()
  })
})

test.describe('renaming', () => {
  /** The club's name reaches other devices with the avatar index, fetched every 15 seconds. */
  const INDEX = { timeout: 20_000 }

  test('a session renamed on one device shows on the other and on the live page', async ({ page, browser, request }) => {
    const club = uniqueClub('Renamed')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page, { location: 'Tusday' })
    await goLive(page)
    await checkIn(page, ['Ann'])
    const pc = await secondDevice(browser, club)
    await openFromList(pc.page, 'Tusday', FOLLOW)
    await expect(pc.page.getByRole('heading', { name: 'Tusday' })).toBeVisible()

    // Only the name changes: nothing else is pending, and it must still be sent.
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Rename session' }).click()
    await page.getByRole('dialog', { name: 'Rename session' }).getByLabel('Session name').fill('Tuesday')
    await page.getByRole('dialog', { name: 'Rename session' }).getByRole('button', { name: 'Save' }).click()

    await expect(pc.page.getByRole('heading', { name: 'Tuesday' })).toBeVisible(FOLLOW)
    const viewer = await pc.context.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    await expect(viewer.getByText('Tuesday', { exact: true }).first()).toBeVisible(FOLLOW)
    await pc.context.close()
  })

  test('a club renamed on one device shows on the other and on the live page, with the same link', async ({ page, browser, request }) => {
    const club = uniqueClub('Old Name')
    await apiCreateClub(request, club)
    await signIn(page, club)
    const pc = await secondDevice(browser, club)
    await expect(pc.page.getByText(club.name, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Rename club' }).click()
    const dialog = page.getByRole('dialog', { name: 'Rename club' })
    await expect(dialog.getByLabel('Club name')).toHaveValue(club.name)
    await dialog.getByLabel('Club name').fill('Riverside Picklers')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByText('Riverside Picklers', { exact: true })).toBeVisible()

    await expect(pc.page.getByText('Riverside Picklers', { exact: true })).toBeVisible(INDEX)
    // The live page names the club above a running session.
    await startSession(page, { location: 'Night Play' })
    await goLive(page)
    const viewer = await pc.context.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    await expect(viewer.getByText('Riverside Picklers').first()).toBeVisible(FOLLOW)
    await pc.context.close()
  })
})
