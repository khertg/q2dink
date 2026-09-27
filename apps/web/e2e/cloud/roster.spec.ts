import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, openSessionMenu } from '../helpers'
import { apiCreateClub, bearer, expectSignedIn, uiLogin, uniqueClub, type TestClub } from './support'

failOnCspViolations(test)

async function signIn(page: Page, club: TestClub) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
}

async function startSession(page: Page, location = 'Roster Night') {
  await page.getByLabel('Session name').fill(location)
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('heading', { name: location })).toBeVisible()
}

/** End a session nobody checked in to, back on the setup screen. */
async function endEmptySession(page: Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'End session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
  await expect(page.getByText('Set up an open play session')).toBeVisible()
}

/** The saved players offered for check-in, after opening the Check-in tab. */
async function savedPlayers(page: Page) {
  await page.getByRole('tab', { name: 'Check-in' }).click()
  return page.getByRole('group', { name: 'Check in from the roster' })
}

const clubRoster = (request: APIRequestContext, token: string) => async () => {
  const response = await request.get('/api/roster', { headers: bearer(token) })
  return ((await response.json()) as { players: { name: string }[] }).players.map((p) => p.name)
}

test.describe('club roster', () => {
  test('players saved on one staff device show on the club’s other devices, and only for that club', async ({
    page,
    browser,
    request,
  }) => {
    const alpha = uniqueClub('Alpha')
    const bravo = uniqueClub('Bravo')
    const { token } = await apiCreateClub(request, alpha)
    await apiCreateClub(request, bravo)

    // The front desk checks two players in: they are saved for the club.
    await signIn(page, alpha)
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await expect.poll(clubRoster(request, token), { timeout: 15_000 }).toEqual(['Ann', 'Bob'])

    // A second staff device of the same club offers them for check-in.
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const second = await other.newPage()
    await signIn(second, alpha)
    await startSession(second, 'Second Device')
    let roster = await savedPlayers(second)
    await expect(roster.getByRole('checkbox', { name: 'Ann' })).toBeVisible({ timeout: 15_000 })
    await expect(roster.getByRole('checkbox', { name: 'Bob' })).toBeVisible()

    // Another club on that device does not see them.
    await endEmptySession(second)
    await second.getByRole('button', { name: 'Log out' }).click()
    await uiLogin(second, bravo)
    await expectSignedIn(second)
    await startSession(second, 'Bravo Night')
    roster = await savedPlayers(second)
    await expect(roster.getByText('No saved players yet.')).toBeVisible()
    await expect(roster.getByRole('checkbox', { name: 'Ann' })).toHaveCount(0)

    // Back on the first club, they are there again.
    await endEmptySession(second)
    await second.getByRole('button', { name: 'Log out' }).click()
    await uiLogin(second, alpha)
    await expectSignedIn(second)
    await startSession(second, 'Alpha Again')
    roster = await savedPlayers(second)
    await expect(roster.getByRole('checkbox', { name: 'Ann' })).toBeVisible()
    await other.close()
  })
})
