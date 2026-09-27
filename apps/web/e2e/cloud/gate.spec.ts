import { expect, test, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { apiCreateClub, apiPublish, bearer, expectSignedIn, storedToken, uiCreateClub, uiLogin, uniqueClub } from './support'

failOnCspViolations(test)

/** The login screen: the description is unique to it. */
const gate = (page: Page) => page.getByText('Log in to your club to use Q2Dink')

test.describe('the login gate', () => {
  test('a signed-out device sees only the login screen', async ({ page }) => {
    await page.goto('/')
    await expect(gate(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create a club' })).toBeVisible()
    // Nothing of the app behind it.
    await expect(page.getByRole('button', { name: 'Create session' })).toHaveCount(0)
    await expect(page.getByLabel('Session name')).toHaveCount(0)
    await expect(page.getByText('Cloud club')).toHaveCount(0)
  })

  test('is served under the production Content-Security-Policy, which the specs here watch for violations', async ({ page }) => {
    const response = await page.goto('/')
    const policy = response?.headers()['content-security-policy'] ?? ''
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
  })

  test('the public live page is never gated', async ({ page, request }) => {
    const club = uniqueClub('Open')
    const { token } = await apiCreateClub(request, club)
    await apiPublish(request, token)
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()
    await expect(gate(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCount(0)
  })

  test('a wrong password shows the error and stays on the login screen', async ({ page, request }) => {
    const club = uniqueClub('Guarded')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, { ...club, password: 'not-the-password' })
    await expect(page.getByRole('alert')).toHaveText('Wrong club URL or password.')
    await page.keyboard.press('Escape')
    await expect(gate(page)).toBeVisible()
    await expect(page.getByLabel('Session name')).toHaveCount(0)
  })

  test('logging in opens the setup screen, and a reload stays logged in without asking again', async ({ page, request }) => {
    const club = uniqueClub('Regular')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)
    await expect(page.getByLabel('Session name')).toBeVisible()
    await expect(gate(page)).toHaveCount(0)

    await page.reload()
    await expectSignedIn(page)
    await expect(gate(page)).toHaveCount(0)
  })

  test('creating a club shows the recovery code once, then the setup screen', async ({ page }) => {
    const club = uniqueClub('Fresh')
    await page.goto('/')
    // The code is shown by the app, not by the login screen that is gone the moment the club exists.
    await uiCreateClub(page, club)
    await expectSignedIn(page)
    await expect(page.getByLabel('Session name')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Players can follow along at').first()).toBeVisible()

    await page.reload()
    await expect(page.getByRole('dialog', { name: 'Save your recovery code' })).toHaveCount(0)
  })

  test('the login screen still offers Forgot password', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Log in' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(dialog.getByText('Reset your password')).toBeVisible()
  })

  test('logging out returns to the login screen and keeps what is on the device', async ({ page, request }) => {
    const club = uniqueClub('Leaving')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)

    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(gate(page)).toBeVisible()
    await expect(page.getByLabel('Session name')).toHaveCount(0)

    await uiLogin(page, club)
    await expectSignedIn(page)
  })

  test('a login that was ended on the server sends the device back to the login screen at launch', async ({ page, request }) => {
    const club = uniqueClub('Revoked')
    await apiCreateClub(request, club)
    await page.goto('/')
    // Logging in syncs the club's roster; let that finish, so it cannot be the request that notices the
    // login ended (and sign out before the reload this test is about).
    const rosterSynced = page.waitForResponse((r) => r.url().endsWith('/api/roster') && r.request().method() === 'GET')
    await uiLogin(page, club)
    await expectSignedIn(page)
    await rosterSynced

    // Another device or the 30-day expiry ends this login while the app is closed.
    await request.post('/api/logout', { headers: bearer(await storedToken(page)) })
    await page.reload()

    await expect(gate(page)).toBeVisible()
    await expect(page.getByText('Your club login expired. Please log in again.').first()).toBeVisible()
  })

  test('with no connection to the server the device stays logged in and keeps working', async ({ page, request }) => {
    const club = uniqueClub('Offline')
    await apiCreateClub(request, club)
    await page.goto('/')
    await uiLogin(page, club)
    await expectSignedIn(page)

    // The API is unreachable from here on (the page itself still loads, as the cached app would).
    await page.route('**/api/**', (route) => route.abort('connectionrefused'))
    await page.reload()

    await expect(gate(page)).toHaveCount(0)
    await expectSignedIn(page)
    await page.getByLabel('Session name').fill('No signal')
    await page.getByRole('button', { name: 'Create session' }).click()
    await page.getByRole('button', { name: 'Start session' }).click()
    await expect(page.getByRole('heading', { name: 'No signal' })).toBeVisible()
  })
})
