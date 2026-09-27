import { expect, test, type Page } from '@playwright/test'
import { checkIn, openSessionMenu, startSession, waitingAction, type PlayerSpec } from './helpers'

/**
 * Save players on the roster by checking them in once, then end that session without
 * saving results and start a fresh one, where they are all "returning" players.
 */
async function withRoster(
  page: Page,
  players: (string | PlayerSpec)[],
  session: Parameters<typeof startSession>[1] = {},
) {
  await startSession(page)
  await checkIn(page, players)
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'End session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
  await expect(page.getByText('Set up an open play session')).toBeVisible()
  await startSession(page, session)
  await page.getByRole('tab', { name: 'Check-in' }).click()
}

const card = (page: Page) => page.getByRole('group', { name: 'Check in from the roster' })
const box = (page: Page, name: string) => card(page).getByRole('checkbox', { name: new RegExp(`^${name}\\b`) })
const submit = (page: Page) => card(page).getByRole('button', { name: /^Check in( \d+ players?|\s+players)$/ })

/** Names in queue order, read from the Board tab. */
async function queueNames(page: Page) {
  await page.getByRole('tab', { name: 'Board' }).click()
  const rows = await page.locator('ol > li').filter({ hasText: /Lv \d/ }).allInnerTexts()
  await page.getByRole('tab', { name: 'Check-in' }).click()
  return rows.map((row) => row.replace(/^\d+\s+/, '').split(/\s/)[0])
}

test('checks in several returning players at once, in the order they were ticked', async ({ page }) => {
  await withRoster(page, ['Ann', 'Bob', 'Cy', 'Dee'])
  await expect(submit(page)).toBeDisabled()

  await box(page, 'Cy').check()
  await box(page, 'Ann').check()
  await box(page, 'Dee').check()
  await expect(submit(page)).toHaveText('Check in 3 players')
  await submit(page).click()

  await expect(page.getByText('3 players checked in')).toBeVisible()
  await expect(page.getByText('Waiting (3) · Playing (0)')).toBeVisible()
  expect(await queueNames(page)).toEqual(['Cy', 'Ann', 'Dee'])

  // Only Bob is left to pick, and the selection has cleared.
  await expect(card(page).getByRole('checkbox')).toHaveCount(1)
  await expect(box(page, 'Bob')).not.toBeChecked()
  await expect(submit(page)).toBeDisabled()
})

test('says "1 player" for a single pick, and keeps saved skill levels', async ({ page }) => {
  await withRoster(page, [{ name: 'Zed', skill: '5 · Advanced (4.00–4.49)' }])
  await box(page, 'Zed').check()
  await expect(submit(page)).toHaveText('Check in 1 player')
  await submit(page).click()

  await expect(page.getByText('1 player checked in')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Zed' }).getByText('Advanced')).toBeVisible()
})

test('does not start a game by itself, and updates who is next up', async ({ page }) => {
  await withRoster(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
  await card(page).getByRole('button', { name: 'Select all shown' }).click()
  await submit(page).click()
  await expect(page.getByText('5 players checked in')).toBeVisible()

  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page.getByRole('region', { name: 'Court 1' }).getByText('Open')).toBeVisible()
  const nextUp = page.getByRole('group', { name: 'Next up' })
  for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp.getByText(name)).toBeVisible()
})

test('filters by name, and select all only takes the matches', async ({ page }) => {
  await withRoster(page, ['Anna', 'Annie', 'Bob', 'Cy'])
  await card(page).getByLabel('Search saved players').fill('ann')
  await expect(card(page).getByRole('checkbox')).toHaveCount(2)

  await card(page).getByRole('button', { name: 'Select all shown' }).click()
  await expect(submit(page)).toHaveText('Check in 2 players')

  // A pick survives a change of search; clearing empties the whole selection.
  await card(page).getByLabel('Search saved players').fill('bob')
  await box(page, 'Bob').check()
  await expect(submit(page)).toHaveText('Check in 3 players')
  await card(page).getByRole('button', { name: 'Clear' }).click()
  await expect(submit(page)).toBeDisabled()

  await card(page).getByLabel('Search saved players').fill('zzz')
  await expect(card(page).getByText('No one matches.')).toBeVisible()
})

test('leaves out anyone already in the session, including people on a break', async ({ page }) => {
  await withRoster(page, ['Ann', 'Bob', 'Cy'])
  await box(page, 'Ann').check()
  await box(page, 'Bob').check()
  await submit(page).click()
  await expect(page.getByText('2 players checked in')).toBeVisible()

  await waitingAction(page, 'Ann', 'Take a break')
  await expect(page.getByText('On a break (1)')).toBeVisible()
  await expect(card(page).getByRole('checkbox')).toHaveCount(1)
  await expect(box(page, 'Cy')).toBeVisible()

  await box(page, 'Cy').check()
  await submit(page).click()
  await expect(card(page).getByText('Everyone saved is already checked in.')).toBeVisible()
})

test('explains itself when nobody is saved yet', async ({ page }) => {
  await startSession(page)
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await expect(card(page).getByText('No saved players yet.')).toBeVisible()
  await expect(submit(page)).toBeDisabled()
})

test('mixed doubles needs a saved gender before someone can be ticked', async ({ page }) => {
  await withRoster(page, [{ name: 'Ann', gender: 'Female' }, 'Bob', { name: 'Cy', gender: 'Male' }], {
    matchmaking: 'Mixed doubles',
  })

  await expect(box(page, 'Bob')).toBeDisabled()
  await expect(card(page).getByText('Set gender first')).toHaveCount(1)
  await card(page).getByRole('button', { name: 'Select all shown' }).click()
  await expect(submit(page)).toHaveText('Check in 2 players')
  await submit(page).click()

  await expect(page.getByText('2 players checked in')).toBeVisible()
  expect(await queueNames(page)).toEqual(['Ann', 'Cy'])
})

test('works on the single form and the roster together', async ({ page }) => {
  await withRoster(page, ['Ann', 'Bob'])
  await page.getByLabel('Player name').fill('Newcomer')
  await page.getByRole('button', { name: 'Check in', exact: true }).click()
  await expect(page.getByText('Newcomer checked in')).toBeVisible()

  await box(page, 'Bob').check()
  await box(page, 'Ann').check()
  await submit(page).click()
  await expect(page.getByText('2 players checked in')).toBeVisible()
  expect(await queueNames(page)).toEqual(['Newcomer', 'Bob', 'Ann'])
})
