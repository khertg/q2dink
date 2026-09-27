import { expect, test, type Page } from '@playwright/test'
import { addCourt, checkIn, openFromList, openSessionMenu, openSessionsList, startGame, recordWin, playerAction } from '../helpers'
import {
  apiCreateClub,
  apiLive,
  bearer,
  confirmRecoveryCode,
  expectSignedIn,
  liveSnapshot,
  storedToken,
  uiCreateClub,
  uiLogin,
  uniqueClub,
  goLive,
  type TestClub,
} from './support'

/** Sign in to an existing club, then start a session on the setup screen that is already showing. */
async function signInAndStart(page: Page, club: TestClub, location = 'Test Session') {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
  await page.getByLabel('Session name').fill(location)
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('heading', { name: location })).toBeVisible()
  await goLive(page)
}

const queueLength = (request: Parameters<typeof apiLive>[0], slug: string) => async () => {
  const response = await apiLive(request, slug)
  return response.ok() ? ((await response.json()).state.queue as number[]).length : -1
}

test.describe('club sign-in', () => {
  test('asks to log in or create a club first when an API is configured (see gate.spec.ts)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Create a club' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  })

  test('creates a club, shows the recovery code once, and signs in', async ({ page, request }) => {
    const club = uniqueClub('Downtown')
    await page.goto('/')
    await page.getByRole('button', { name: 'Create a club' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a club' })
    await dialog.getByLabel('Club name').fill(club.name)
    await expect(dialog.getByText(`/club/${club.slug}/live`)).toBeVisible()

    // Passwords need at least eight characters.
    await dialog.getByLabel(/^Password/).fill('abcdefg')
    await expect(dialog.getByRole('button', { name: 'Create club' })).toBeDisabled()
    await dialog.getByLabel(/^Password/).fill(club.password)
    await dialog.getByRole('button', { name: 'Create club' }).click()

    // The recovery code cannot be dismissed by accident.
    const recovery = page.getByRole('dialog', { name: 'Save your recovery code' })
    await expect(recovery).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(recovery).toBeVisible()
    await expect(recovery.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await confirmRecoveryCode(page)

    await expect(page.getByText(club.name, { exact: true })).toBeVisible()
    await expect(page.getByText(`/club/${club.slug}/live`, { exact: true })).toBeVisible()

    // The club really exists on the server.
    const login = await request.post(`/api/clubs/${club.slug}/login`, { data: { password: club.password } })
    expect(login.status()).toBe(200)
    expect((await login.json()).name).toBe(club.name)
  })

  test('explains when the club URL is already taken', async ({ page, request }) => {
    const club = uniqueClub('Taken')
    await apiCreateClub(request, club)
    await page.goto('/')
    await page.getByRole('button', { name: 'Create a club' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create a club' })
    await dialog.getByLabel('Club name').fill(club.name)
    await dialog.getByLabel(/^Password/).fill('another-secret')
    await dialog.getByRole('button', { name: 'Create club' }).click()

    await expect(dialog.getByRole('alert')).toContainText('already taken')
    await expect(dialog).toBeVisible()
  })

  test('logs in to an existing club and stays signed in after a reload', async ({ page, request }) => {
    const club = uniqueClub('Existing')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)
    await expect(page.getByText(club.name, { exact: true })).toBeVisible()

    await page.reload()
    await expectSignedIn(page)
  })

  test('rejects a wrong password without signing in', async ({ page, request }) => {
    const club = uniqueClub('Guarded')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, { ...club, password: 'not-the-password' })
    await expect(page.getByRole('alert')).toHaveText('Wrong club URL or password.')
    await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  })

  test('says so when the club does not exist, without hinting whether it might', async ({ page }) => {
    await page.goto('/')
    await uiLogin(page, { slug: uniqueClub('Ghost').slug, password: 'secret-pass' })
    await expect(page.getByRole('alert')).toHaveText('Wrong club URL or password.')
  })

  test('logging out revokes the login on the server', async ({ page, request }) => {
    const club = uniqueClub('Leaving')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)
    const token = await storedToken(page)

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page.getByRole('button', { name: 'Create a club' })).toBeVisible()
    // Logging out again with the same token can only fail if the first logout revoked it.
    await expect
      .poll(async () => (await request.post('/api/logout', { headers: bearer(token) })).status())
      .toBe(401)
  })

  test('shows a clear message when the server says to slow down', async ({ page }) => {
    await page.route('**/api/clubs/*/login', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited', message: 'x' }) }),
    )
    await page.goto('/')
    await uiLogin(page, { slug: 'some-club', password: 'secret-pass' })
    await expect(page.getByRole('alert')).toContainText('Too many attempts')
  })

  test('says so when the server cannot be reached', async ({ page }) => {
    await page.route('**/api/clubs/*/login', (route) => route.abort('connectionrefused'))
    await page.goto('/')
    await uiLogin(page, { slug: 'some-club', password: 'secret-pass' })
    await expect(page.getByRole('alert')).toContainText('Cannot reach the server')
  })
})

test.describe('password recovery', () => {
  async function openReset(page: Page, slug: string, code: string, password: string) {
    await page.getByRole('button', { name: 'Log in' }).click()
    // The same dialog switches to reset mode, and its title (its accessible name) changes with it.
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('dialog', { name: 'Reset your password' })).toBeVisible()
    await dialog.getByLabel('Club link name').fill(slug)
    await dialog.getByLabel('Recovery code').fill(code)
    await dialog.getByLabel(/^New password/).fill(password)
    await dialog.getByRole('button', { name: 'Reset password' }).click()
  }

  test('sets a new password with the recovery code and issues a fresh code', async ({ page, request }) => {
    const club = uniqueClub('Forgetful')
    const { recoveryCode } = await apiCreateClub(request, club)
    await page.goto('/')
    // Typed loosely: lower case, no dashes.
    await openReset(page, club.slug, recoveryCode.toLowerCase().replaceAll('-', ''), 'brand-new-secret')

    const newCode = await confirmRecoveryCode(page)
    expect(newCode).not.toBe(recoveryCode)
    await expectSignedIn(page)
    await expect(page.getByText(club.name, { exact: true })).toBeVisible()

    const oldPassword = await request.post(`/api/clubs/${club.slug}/login`, { data: { password: club.password } })
    expect(oldPassword.status()).toBe(401)
    const newPassword = await request.post(`/api/clubs/${club.slug}/login`, { data: { password: 'brand-new-secret' } })
    expect(newPassword.status()).toBe(200)

    // The code that was just used no longer works; the new one does.
    const reused = await request.post(`/api/clubs/${club.slug}/reset-password`, {
      data: { recoveryCode, newPassword: 'third-secret' },
    })
    expect(reused.status()).toBe(401)
    const fresh = await request.post(`/api/clubs/${club.slug}/reset-password`, {
      data: { recoveryCode: newCode, newPassword: 'fourth-secret' },
    })
    expect(fresh.status()).toBe(200)
  })

  test('rejects a wrong recovery code', async ({ page, request }) => {
    const club = uniqueClub('Wrongcode')
    await apiCreateClub(request, club)
    await page.goto('/')
    await openReset(page, club.slug, 'AAAA-AAAA-AAAA-AAAA-AAAA', 'brand-new-secret')
    await expect(page.getByRole('alert')).toHaveText('That recovery code is not valid.')
    await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0)
  })

  test('needs a long enough new password and a recovery code before it can be submitted', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Log in' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Forgot password?' }).click()
    await dialog.getByLabel('Club link name').fill('some-club')
    await expect(dialog.getByRole('button', { name: 'Reset password' })).toBeDisabled()
    await dialog.getByLabel('Recovery code').fill('AAAA-AAAA-AAAA-AAAA-AAAA')
    await dialog.getByLabel(/^New password/).fill('abcdefg')
    await expect(dialog.getByRole('button', { name: 'Reset password' })).toBeDisabled()
    await dialog.getByLabel(/^New password/).fill('abcdefgh')
    await expect(dialog.getByRole('button', { name: 'Reset password' })).toBeEnabled()
  })

  test('can go back to logging in', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Log in' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(dialog.getByText('Reset your password')).toBeVisible()
    await dialog.getByRole('button', { name: 'Back to log in' }).click()
    await expect(dialog.getByText('Log in to your club')).toBeVisible()
    await expect(dialog.getByLabel('Recovery code')).toHaveCount(0)
  })

  test('creating a club through the UI also yields a working recovery code', async ({ page, request }) => {
    const club = uniqueClub('Fresh')
    await page.goto('/')
    const code = await uiCreateClub(page, club)
    const reset = await request.post(`/api/clubs/${club.slug}/reset-password`, {
      data: { recoveryCode: code, newPassword: 'reset-secret' },
    })
    expect(reset.status()).toBe(200)
  })
})

test.describe('publishing the live session', () => {
  test('publishes to the live board, and keeps genders off it', async ({ page, request }) => {
    const club = uniqueClub('Publisher')
    await apiCreateClub(request, club)
    await signInAndStart(page, club, 'Downtown Open')
    await checkIn(page, [{ name: 'Ann', gender: 'Female' }, 'Bob'])

    await expect.poll(queueLength(request, club.slug)).toBe(2)
    const publicBody = await (await apiLive(request, club.slug)).text()
    expect(publicBody).toContain('Downtown Open')
    expect(publicBody).not.toMatch(/gender/)

    // The private backup, only for staff, keeps everything.
    const backup = await request.get('/api/session', { headers: bearer(await storedToken(page)) })
    expect(await backup.text()).toContain('gender')
    await expect(page.getByTestId('sync-status')).toHaveText('Synced')
  })

  test('publishes a whole roster check-in as one update carrying everyone', async ({ page, request }) => {
    const club = uniqueClub('Batch')
    await apiCreateClub(request, club)
    await signInAndStart(page, club, 'Regulars')
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
    await page.getByLabel('Session name').fill('Regulars Again')
    await page.getByRole('button', { name: 'Create session' }).click()
    await page.getByRole('button', { name: 'Start session' }).click()
    await expect(page.getByRole('heading', { name: 'Regulars Again' })).toBeVisible()
    await goLive(page)
    await expect.poll(queueLength(request, club.slug)).toBe(0)

    const publishes: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith('/api/session')) publishes.push(r.url())
    })
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await page.getByRole('group', { name: 'Check in from the roster' }).getByRole('button', { name: 'Select all shown' }).click()
    await page.getByRole('button', { name: 'Check in 4 players' }).click()

    await expect.poll(queueLength(request, club.slug)).toBe(4)
    await expect(page.getByTestId('sync-status')).toHaveText('Synced')
    expect(publishes).toHaveLength(1)
  })

  test('holds changes while offline and sends them when the connection returns', async ({ page, context, request }) => {
    const club = uniqueClub('Offline')
    await apiCreateClub(request, club)
    await signInAndStart(page, club)
    await expect.poll(queueLength(request, club.slug)).toBe(0)

    await context.setOffline(true)
    await checkIn(page, ['Ann', 'Bob'])
    await expect(page.getByTestId('sync-status')).toHaveText('Offline, will sync')
    await page.waitForTimeout(1500)
    expect(await queueLength(request, club.slug)()).toBe(0) // the board has not changed yet

    await context.setOffline(false)
    await expect.poll(queueLength(request, club.slug)).toBe(2)
    await expect(page.getByTestId('sync-status')).toHaveText('Synced')
  })

  test('takes the board down when the session ends', async ({ page, request }) => {
    const club = uniqueClub('Ending')
    await apiCreateClub(request, club)
    await signInAndStart(page, club)
    await expect.poll(async () => (await apiLive(request, club.slug)).status()).toBe(200)

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
    await expect.poll(async () => (await apiLive(request, club.slug)).status()).toBe(404)
  })

  test('signs out with a clear message when the login has been revoked', async ({ page, request }) => {
    const club = uniqueClub('Revoked')
    await apiCreateClub(request, club)
    await signInAndStart(page, club)
    await expect.poll(async () => (await apiLive(request, club.slug)).status()).toBe(200)
    // Let the device send its activity log first, so the next thing it sends is the check-in below.
    const token = await storedToken(page)
    await expect
      .poll(async () => {
        const log = await (await request.get('/api/audit', { headers: bearer(token) })).json()
        return log.entries.some((e: { kind: string }) => e.kind === 'startClock')
      })
      .toBe(true)

    // Someone (another device, or expiry) ends this login on the server.
    await request.post('/api/logout', { headers: bearer(token) })
    await checkIn(page, ['Ann'])

    await expect(page.getByText('Your club login expired. Please log in again.').first()).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('sends nothing before a club login, because no session can be started', async ({ page }) => {
    const sessionRequests: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/api/session')) sessionRequests.push(r.method())
    })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create session' })).toHaveCount(0)
    await page.waitForTimeout(1000)
    expect(sessionRequests).toEqual([])
    await expect(page.getByRole('status')).toHaveCount(0)
  })
})

test.describe('sharing', () => {
  test('shows the session’s own live link and a QR code', async ({ page, request }) => {
    const club = uniqueClub('Sharing')
    await apiCreateClub(request, club)
    await signInAndStart(page, club)

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Share live view' }).click()
    const dialog = page.getByRole('dialog')
    // The club can run several sessions: from inside one, the link is to its own board.
    await expect(dialog.getByLabel('Live board link')).toHaveValue(
      new RegExp(`^http://localhost:4174/club/${club.slug}/live/[0-9a-f-]{36}$`),
    )
    const qr = dialog.getByRole('img', { name: 'QR code for the live board' })
    await expect(qr).toBeVisible()
    expect(await qr.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  })
})

test.describe('two browsers', () => {
  test('a player’s phone follows the staff device live, from start to finish', async ({ page, browser, request }) => {
    const club = uniqueClub('Followed')
    await apiCreateClub(request, club)
    const viewerContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      serviceWorkers: 'block',
    })
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    await expect(viewer.getByText('No game in progress')).toBeVisible()

    // The club starts a session: the viewer's page changes by itself, with no refresh.
    await signInAndStart(page, club, 'Live Night')
    await expect(viewer.getByRole('heading', { name: 'Live Night' })).toBeVisible({ timeout: 8000 })

    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    // Nothing has started, and the phone shows who is next up: the same four as staff see.
    const court = viewer.getByRole('region', { name: 'Court 1' })
    const nextUp = viewer.getByRole('group', { name: 'Next up' })
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp.getByText(name)).toBeVisible({ timeout: 8000 })
    await expect(nextUp.getByText('Eve')).toHaveCount(0)
    await expect(court.getByText('Open')).toBeVisible()

    // Staff start the game: it appears on the phone, and next up moves on.
    await startGame(page)
    await expect(court.getByText('In play')).toBeVisible({ timeout: 8000 })
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(court.getByText(name)).toBeVisible()
    await expect(viewer.getByText('Queue (1)')).toBeVisible()

    await recordWin(page)
    await viewer.getByRole('tab', { name: 'Standings' }).click()
    await expect(viewer.getByRole('row').nth(1)).toContainText('Gold medal', { timeout: 8000 })

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save and end session' }).click()
    await expect(viewer.getByText('No game in progress')).toBeVisible({ timeout: 8000 })

    await viewerContext.close()
  })
})

test.describe('editing a skill level', () => {
  test('a player’s phone shows the new level, with no way to change it', async ({ page, browser, request }) => {
    const club = uniqueClub('Levels')
    await apiCreateClub(request, club)
    const viewerContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      serviceWorkers: 'block',
    })
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    await signInAndStart(page, club, 'Level Night')
    await checkIn(page, ['Ann', 'Bob'])
    const viewerRow = viewer.locator('ol > li').filter({ hasText: 'Ann' })
    await expect(viewerRow).toContainText('Lv 3', { timeout: 8000 })

    await page.locator('ol > li').filter({ hasText: 'Ann' }).getByRole('button', { name: /^Change Ann's level/ }).click()
    await page.getByRole('dialog', { name: "Change Ann's level" }).getByRole('button', { name: /^5 · Advanced/ }).click()
    await expect(viewerRow).toContainText('Lv 5', { timeout: 8000 })
    await expect(viewer.getByRole('button', { name: /^Change .*level/ })).toHaveCount(0)
    await viewerContext.close()
  })
})

test.describe('changing who is next up', () => {
  test('a player’s phone shows the group staff chose, and follows a reset', async ({ page, browser, request }) => {
    const club = uniqueClub('Chosen')
    await apiCreateClub(request, club)
    const viewerContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      serviceWorkers: 'block',
    })
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    await signInAndStart(page, club, 'Chosen Night')
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    const viewerNext = viewer.getByRole('group', { name: 'Next up' })
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(viewerNext.getByText(name)).toBeVisible({ timeout: 8000 })

    const staffNext = page.getByRole('group', { name: 'Next up' })
    await playerAction(staffNext, 'Ann', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await expect(viewerNext.getByText('Eve')).toBeVisible({ timeout: 8000 })
    await expect(viewerNext.getByText('Ann')).toHaveCount(0)

    await staffNext.getByRole('button', { name: 'Reset' }).click()
    await expect(viewerNext.getByText('Ann')).toBeVisible({ timeout: 8000 })
    await expect(viewerNext.getByText('Eve')).toHaveCount(0)
    await viewerContext.close()
  })
})

test.describe('managing courts', () => {
  test('a player’s phone follows courts being added, renamed, reordered and closed', async ({ page, browser, request }) => {
    const club = uniqueClub('Courts')
    await apiCreateClub(request, club)
    const viewerContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      serviceWorkers: 'block',
    })
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/club/${club.slug}/live`)
    await signInAndStart(page, club, 'Court Night') // starts with the default four courts

    // Court cards set role="region" themselves; the attribute keeps out the toast area.
    const viewerCourts = () =>
      viewer.locator('[role="region"]').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
    const expectCourts = (names: string[]) =>
      expect.poll(viewerCourts, { timeout: 8000 }).toEqual(names)

    await expectCourts(['Court 1', 'Court 2', 'Court 3', 'Court 4'])

    await addCourt(page)
    await expectCourts(['Court 1', 'Court 2', 'Court 3', 'Court 4', 'Court 5'])

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Manage courts' }).click()
    const dialog = page.getByRole('dialog', { name: 'Manage courts' })
    const field = dialog.getByLabel('Name of Court 1')
    await field.fill('Center Court')
    await field.press('Enter')
    await expectCourts(['Center Court', 'Court 2', 'Court 3', 'Court 4', 'Court 5'])

    await dialog.getByRole('button', { name: 'Move Center Court down' }).click()
    await expectCourts(['Court 2', 'Center Court', 'Court 3', 'Court 4', 'Court 5'])

    await dialog.getByRole('button', { name: 'Close Court 4' }).click()
    await expectCourts(['Court 2', 'Center Court', 'Court 3', 'Court 5'])

    // And the server holds the same board.
    const board = (await (await apiLive(request, club.slug)).json()).state.courts
    expect(board.map((c: { name: string }) => c.name)).toEqual(['Court 2', 'Center Court', 'Court 3', 'Court 5'])
    await viewerContext.close()
  })

  test('a court added while people wait stays open until staff start it, and the viewer sees the game', async ({ page, browser, request }) => {
    const club = uniqueClub('Fill')
    await apiCreateClub(request, club)
    const viewerContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      serviceWorkers: 'block',
    })
    const viewer = await viewerContext.newPage()
    await viewer.goto(`/club/${club.slug}/live`)

    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)
    await page.getByLabel('Number of courts (1 to 15)').fill('1')
    await page.getByRole('button', { name: 'Create session' }).click()
    await page.getByRole('button', { name: 'Start session' }).click()
    await goLive(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'])
    await startGame(page)

    await addCourt(page)
    const court2 = viewer.getByRole('region', { name: 'Court 2' })
    await expect(court2.getByText('Open')).toBeVisible({ timeout: 8000 })
    await startGame(page, 'Court 2')
    await expect(court2.getByText('In play')).toBeVisible({ timeout: 8000 })
    for (const name of ['Eve', 'Fay', 'Gus', 'Hal']) await expect(court2.getByText(name)).toBeVisible()
    await viewerContext.close()
  })
})

test.describe('joining from another device', () => {
  test('offers the session another staff device is running and joins it', async ({ page, browser, request }) => {
    const club = uniqueClub('Resumable')
    await apiCreateClub(request, club)
    await signInAndStart(page, club, 'Saved Night')
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    await startGame(page)
    await expect.poll(queueLength(request, club.slug)).toBe(1)

    const second = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const other = await second.newPage()
    await other.goto('/')
    await uiLogin(other, club)
    await openFromList(other, 'Saved Night', { timeout: 10_000 })

    await expect(other.getByRole('heading', { name: 'Saved Night' })).toBeVisible()
    const court = other.getByRole('region', { name: 'Court 1' })
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(court.getByText(name)).toBeVisible()
    await expect(other.getByText('Queue (1)')).toBeVisible()
    await second.close()
  })

  test('offers nothing when no session is running', async ({ page, request }) => {
    const club = uniqueClub('Idle')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)
    await expect(openSessionsList(page)).toHaveCount(0)
  })
})

test.describe('club leaderboard', () => {
  async function playAndEnd(page: Page, club: TestClub) {
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)
    await page.getByRole('button', { name: 'Singles' }).click()
    await page.getByRole('button', { name: 'Create session' }).click()
    await page.getByRole('button', { name: 'Start session' }).click()
    await checkIn(page, ['Ann', 'Bob'])
    await startGame(page)
    await recordWin(page)
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save and end session' }).click()
  }

  const board = (request: Parameters<typeof apiLive>[0], slug: string) => async () => {
    const response = await request.get(`/api/clubs/${slug}/players`)
    return (await response.json()).players as { name: string; games: number; wins: number; losses: number }[]
  }

  test('uploads the finished session to the club leaderboard', async ({ page, request }) => {
    const club = uniqueClub('Board')
    await apiCreateClub(request, club)
    await playAndEnd(page, club)

    await expect(page.getByText('Session saved to the all-time leaderboard')).toBeVisible()
    await expect.poll(async () => (await board(request, club.slug)()).length).toBe(2)
    const rows = await board(request, club.slug)()
    expect(rows.find((p) => p.name === 'Ann')).toMatchObject({ games: 1, wins: 1, losses: 0 })
    expect(rows.find((p) => p.name === 'Bob')).toMatchObject({ games: 1, wins: 0, losses: 1 })
  })

  test('keeps the totals after a failed upload and retries without double counting', async ({ page, request }) => {
    const club = uniqueClub('Retry')
    await apiCreateClub(request, club)

    const batchIds: string[] = []
    let attempts = 0
    await page.route('**/api/lifetime', (route) => {
      batchIds.push(route.request().postDataJSON().batchId)
      // The first upload never reaches the server, as if the connection dropped.
      return attempts++ === 0 ? route.abort('connectionrefused') : route.continue()
    })
    await playAndEnd(page, club)

    await expect(page.getByText(/Saved on this device/)).toBeVisible()
    expect(await board(request, club.slug)()).toEqual([])

    // The connection is back: the queued batch is sent again, unchanged.
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect.poll(async () => (await board(request, club.slug)()).length).toBe(2)
    expect(batchIds).toHaveLength(2)
    expect(batchIds[1]).toBe(batchIds[0])
    expect((await board(request, club.slug)())[0].games).toBe(1)

    // Nothing is left to send, so another "online" changes nothing.
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await page.waitForTimeout(500)
    expect(batchIds).toHaveLength(2)
  })

  test('shows the club’s combined results in the lifetime leaderboard when signed in', async ({ page, request }) => {
    const club = uniqueClub('Combined')
    const { token } = await apiCreateClub(request, club)
    await request.post('/api/lifetime', {
      headers: bearer(token),
      data: {
        batchId: '00000000-0000-4000-8000-000000000001',
        players: [
          { name: 'Zoe', games: 12, wins: 9, losses: 3 },
          { name: 'Yan', games: 8, wins: 2, losses: 6 },
        ],
      },
    })
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)

    await page.getByRole('button', { name: 'Lifetime leaderboard' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(`Combined all-time results for ${club.name}`)).toBeVisible()
    await expect(dialog.getByRole('row').nth(1)).toContainText('Zoe')
    await expect(dialog.getByRole('row').nth(1)).toContainText('75%')
    await expect(dialog.getByRole('row').nth(2)).toContainText('Yan')
  })
})

// Keeps the fixture referenced so a future change to it is deliberate.
test('the shared live fixture is a valid public snapshot', async ({ request }) => {
  const club = uniqueClub('Fixture')
  const { token } = await apiCreateClub(request, club)
  const response = await request.put('/api/session', {
    headers: bearer(token),
    data: { public: liveSnapshot(), full: { schemaVersion: 1, storeVersion: 4, location: 'x', session: {} } },
  })
  expect(response.status()).toBe(200)
})
