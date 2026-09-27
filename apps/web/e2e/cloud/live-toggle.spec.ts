import { expect, test, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, openFromList, openSessionMenu, startSession } from '../helpers'
import { apiCreateClub, apiLive, expectSignedIn, goLive, uiLogin, uniqueClub } from './support'

failOnCspViolations(test)

/** Seconds a change may take to reach another page: a short send delay plus the live stream. */
const FOLLOW = { timeout: 10_000 }

const queued = (page: Page, name: string) => page.locator('ol:not([data-sonner-toaster]) > li').filter({ hasText: name })

test('a new session stays off the public page until staff go live, and can be taken off again', async ({ page, browser, request }) => {
  const club = uniqueClub('Toggle')
  await apiCreateClub(request, club)
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)

  // The players' page is open before anything starts.
  const viewerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const viewer = await viewerContext.newPage()
  await viewer.goto(`/club/${club.slug}/live`)
  await expect(viewer.getByText('No game in progress')).toBeVisible()

  // Set up privately: players still see no game.
  await startSession(page, { location: 'Toggle Night' })
  await checkIn(page, ['Ann', 'Bob'])
  await expect(page.getByTestId('live-status')).toHaveAttribute('title', 'Not live: players cannot see this session')
  await page.waitForTimeout(1500) // long enough for anything sent to have arrived
  await expect(viewer.getByText('No game in progress')).toBeVisible()
  expect((await apiLive(request, club.slug)).status()).toBe(404)

  // A second staff device can join and follow changes while it is not live.
  const pcContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const pc = await pcContext.newPage()
  await pc.goto('/')
  await uiLogin(pc, club)
  await expectSignedIn(pc)
  await openFromList(pc, 'Toggle Night', FOLLOW)
  await checkIn(page, ['Cy'])
  await expect(queued(pc, 'Cy')).toBeVisible(FOLLOW)

  // Go live: the players' page shows the board by itself.
  await goLive(page)
  await expect(viewer.getByRole('heading', { name: 'Toggle Night' })).toBeVisible(FOLLOW)
  await expect(page.getByTestId('live-status')).not.toHaveAttribute('title', /Not live/)
  // The other staff device sees the same choice in its menu.
  await openSessionMenu(pc)
  await expect(pc.getByRole('button', { name: 'Stop live' })).toBeVisible(FOLLOW)
  await pc.keyboard.press('Escape')

  // Stop live: the players' page goes back to no game.
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Stop live' }).click()
  await expect(page.getByText('Not live: the public page shows no game')).toBeVisible()
  await expect(viewer.getByText('No game in progress')).toBeVisible(FOLLOW)

  await pcContext.close()
  await viewerContext.close()
})
