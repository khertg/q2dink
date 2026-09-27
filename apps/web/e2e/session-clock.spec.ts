import { expect, test } from '@playwright/test'
import { checkIn, openFromList, openSessionMenu, openSessionsList, startGame } from './helpers'

const FOUR = ['Ann', 'Bob', 'Cy', 'Dee']

test('a session is set up without starting: players check in, no clock runs and no game starts', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByLabel('Session name').fill('Tuesday')
  await page.getByRole('button', { name: 'Create session' }).click()
  await expect(page.getByRole('heading', { name: 'Tuesday' })).toBeVisible()
  await expect(page.getByText('Not started', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Not started yet' })).toBeVisible()

  await checkIn(page, [...FOUR, 'Eve'])
  const court = page.getByRole('region', { name: 'Court 1' })
  await expect(court.getByText('Start the session (at the top) to start games.')).toBeVisible()
  await expect(court.getByRole('button', { name: 'Start game' })).toHaveCount(0)

  // Ten minutes pass before staff start: nobody has been waiting yet.
  await page.clock.runFor(10 * 60_000)
  // Eve is fifth: not in Next up, so her row shows how long she has waited.
  const queue = page.locator('ol:not([data-sonner-toaster]) > li').filter({ hasText: 'Eve' })
  await expect(queue.getByTitle('Waiting')).toHaveText('0s')

  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByText('Not started', { exact: true })).toHaveCount(0)
  await page.clock.runFor(65_000)
  await expect(queue.getByTitle('Waiting')).toHaveText('1m5s')
  await startGame(page)
})

test('pausing freezes the clocks and blocks new games until it is resumed', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await checkIn(page, [...FOUR, 'Eve', 'Fay', 'Gus', 'Hal', 'Ida'])
  await startGame(page)

  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Paused by this device/ })).toBeVisible()
  // Ida is behind the next group, so her row shows her wait.
  const ida = page.locator('ol:not([data-sonner-toaster]) > li').filter({ hasText: 'Ida' })
  const frozen = await ida.getByTitle('Waiting').textContent()
  await page.clock.runFor(5 * 60_000)
  await expect(ida.getByTitle('Waiting')).toHaveText(frozen!)
  await expect(page.getByText('The session is paused: resume it to start games.').first()).toBeVisible()

  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Paused/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('leaving a session keeps it (paused) to open again, beside a new one', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Session name').fill('Morning')
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await checkIn(page, ['Ann'])

  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Leave session' }).click()
  await expect(page.getByText('Set up an open play session')).toBeVisible()
  const morning = openSessionsList(page).getByRole('listitem').filter({ hasText: 'Morning' })
  await expect(morning.getByText('Paused', { exact: true })).toBeVisible()
  await expect(morning.getByText('1 player')).toBeVisible()

  // A second session, left too: both are listed.
  await page.getByLabel('Session name').fill('Evening')
  await page.getByRole('button', { name: 'Create session' }).click()
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Leave session' }).click()
  await expect(openSessionsList(page).getByRole('listitem')).toHaveCount(2)

  // Morning survives a reload, and opens as it was left: paused by this device, with Ann still waiting.
  await page.reload()
  await openFromList(page, 'Morning')
  await expect(page.getByRole('status').filter({ hasText: 'this device left the session' })).toBeVisible()
  await expect(page.locator('ol:not([data-sonner-toaster]) > li').filter({ hasText: 'Ann' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
})
