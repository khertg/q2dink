import { expect, test, type Page } from '@playwright/test'
import { choose, startSession } from './helpers'

const dialog = (page: Page) => page.getByRole('dialog', { name: /^Saved players/ })
const savedList = (page: Page) => dialog(page).getByRole('list', { name: 'Saved players' })
const rosterCard = (page: Page) => page.getByRole('group', { name: 'Check in from the roster' })

async function openSavedPlayers(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Saved players' }).click()
  await expect(dialog(page)).toBeVisible()
}

async function savePlayer(page: Page, name: string, skill?: RegExp) {
  await dialog(page).getByLabel('Player name').fill(name)
  if (skill) await choose(page, 'Skill level', skill)
  await dialog(page).getByRole('button', { name: 'Save player' }).click()
}

test('adds players before any session, ready to check in from the roster', async ({ page }) => {
  await openSavedPlayers(page)
  await expect(dialog(page).getByText('No saved players yet.')).toBeVisible()

  await savePlayer(page, 'Ann', /^5 ·/)
  await expect(page.getByText('Ann saved')).toBeVisible()
  await savePlayer(page, 'Bob')
  await expect(page.getByText('Bob saved')).toBeVisible()
  await expect(dialog(page).getByRole('heading', { name: 'Saved players (2)' })).toBeVisible()
  await expect(savedList(page).getByRole('listitem')).toHaveCount(2)

  // The same name again (any case) is the same player, not a second one.
  await savePlayer(page, 'ann')
  await expect(page.getByText('Ann is already saved')).toBeVisible()
  await expect(savedList(page).getByRole('listitem')).toHaveCount(2)

  // Nobody was checked in: no session is running.
  await page.keyboard.press('Escape')
  await expect(page.getByText('Set up an open play session')).toBeVisible()

  await startSession(page)
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await expect(page.getByText('Waiting (0) · Playing (0)')).toBeVisible()
  await rosterCard(page).getByRole('button', { name: 'Select all shown' }).click()
  await rosterCard(page).getByRole('button', { name: 'Check in 2 players' }).click()
  await expect(page.getByText('2 players checked in')).toBeVisible()
  await expect(page.getByText('Waiting (2) · Playing (0)')).toBeVisible()
})

test('changes a saved player’s level for the sessions to come', async ({ page }) => {
  await openSavedPlayers(page)
  await savePlayer(page, 'Cy')
  await expect(page.getByText('Cy saved')).toBeVisible()

  await savedList(page).getByRole('button', { name: /^Change Cy's level/ }).click()
  await page.getByRole('dialog', { name: "Change Cy's level" }).getByRole('button', { name: /^6 ·/ }).click()
  await expect(savedList(page).getByRole('button', { name: /^Change Cy's level/ })).toHaveText('Elite / Pro')

  await page.keyboard.press('Escape')
  await startSession(page)
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await rosterCard(page).getByRole('checkbox', { name: /^Cy\b/ }).check()
  await rosterCard(page).getByRole('button', { name: 'Check in 1 player' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cy' }).getByText('Elite / Pro')).toBeVisible()
})
