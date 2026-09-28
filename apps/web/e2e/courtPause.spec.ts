import { expect, test, type Page } from '@playwright/test'
import { checkIn, playerAction, startGame, startSession } from './helpers'

const court = (page: Page) => page.getByRole('region', { name: 'Court 1', exact: true })

async function courtMenu(page: Page, item: 'Pause game' | 'Resume game') {
  await court(page).getByRole('button', { name: 'Court menu' }).click()
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: item }).click()
}

test('Pause game stands one court still until Resume game', async ({ page }) => {
  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
  await startGame(page)

  await courtMenu(page, 'Pause game')
  await expect(court(page).getByText(/^Paused/)).toBeVisible()
  await expect(court(page).getByText('Game paused. Its time stands still.')).toBeVisible()

  // The menu offers Resume game now; the button on the card does the same.
  await court(page).getByRole('button', { name: 'Court menu' }).click()
  await expect(page.locator('[data-slot="popover-content"]').getByRole('button', { name: 'Resume game' })).toBeVisible()
  await page.keyboard.press('Escape')
  await court(page).getByRole('button', { name: 'Resume game' }).click()
  await expect(court(page).getByText('In play')).toBeAttached()
  await expect(court(page).getByText('Game paused. Its time stands still.')).toHaveCount(0)
})

test('while the session is paused, a game can be paused, a player taken off and the spot filled', async ({ page }) => {
  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
  await startGame(page)
  await page.getByRole('button', { name: 'Pause' }).click()
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()

  await courtMenu(page, 'Pause game')
  await expect(court(page).getByText('Game paused. Its time stands still.')).toBeVisible()

  await playerAction(court(page), 'Ann', 'Remove from court')
  await court(page).getByRole('button', { name: 'Fill open spot on Blue' }).click()
  await page.getByRole('dialog', { name: 'Fill the open spot · Court 1, Blue' }).getByRole('button', { name: /Eve/ }).click()
  // Filling the spot does not resume a game staff paused.
  await expect(page.getByText('Eve is on Court 1. The game stays paused until you resume it.')).toBeVisible()
  await expect(court(page).getByText('Game paused. Its time stands still.')).toBeVisible()

  await court(page).getByRole('button', { name: 'Resume game' }).click()
  await expect(court(page).getByText('Game paused. Its time stands still.')).toHaveCount(0)
})
