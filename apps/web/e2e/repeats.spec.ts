import { expect, test, type Page } from '@playwright/test'
import { checkIn, choose, confirmLock, openSessionMenu, recordWin, startGame, startSession } from './helpers'

const card = (page: Page) => page.getByRole('group', { name: 'Partners and opponents' })

/** Four players with Ann and Bob locked as partners, so who teams up again does not depend on matchmaking. */
async function lockedPairSession(page: Page) {
  await startSession(page, { location: 'Repeat Club' })
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await choose(page, 'First partner', 'Ann')
  await choose(page, 'Second partner', 'Bob')
  await page.getByRole('button', { name: 'Lock partners' }).click()
  await confirmLock(page)
  await expect(page.getByText('Ann & Bob')).toBeVisible()
  await page.getByRole('tab', { name: 'Board' }).click()
}

async function playGames(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    await startGame(page)
    await recordWin(page)
  }
}

test.describe('partners and opponents', () => {
  test('are counted on the Standings tab once games are finished', async ({ page }) => {
    await lockedPairSession(page)
    await page.getByRole('tab', { name: 'Standings' }).click()
    await expect(card(page)).toHaveCount(0) // nothing to count before the first game

    await page.getByRole('tab', { name: 'Board' }).click()
    await playGames(page, 3)
    await page.getByRole('tab', { name: 'Standings' }).click()

    // Ann + Bob and Cy + Dee are the only two partnerships, three games each: 6 slots, 2 different.
    await expect(card(page)).toBeVisible()
    await expect(card(page).getByText('Repeated partnerships: 4 of 6 (67%)')).toBeVisible()
    // Every game had the same four opposing pairs: 12 pairings, 4 different.
    await expect(card(page).getByText('Repeated opponent pairings: 8 of 12 (67%)')).toBeVisible()
    await expect(card(page).getByText(/teamed up 3 times\./).first()).toBeVisible()
    await expect(card(page).getByText(/faced each other 3 times\./)).toBeVisible()

    const ann = card(page)
      .getByRole('row')
      .filter({ has: page.getByRole('button', { name: 'Partners and opponents of Ann' }) })
    await expect(ann).toContainText('Bob ×3')
    await expect(ann).toContainText('Cy ×3')
  })

  test('are broken down for one player, most repeated first', async ({ page }) => {
    await lockedPairSession(page)
    await playGames(page, 3)
    await page.getByRole('tab', { name: 'Standings' }).click()
    await card(page).getByRole('button', { name: 'Partners and opponents of Ann' }).click()

    const dialog = page.getByRole('dialog', { name: 'Ann: partners and opponents' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('3 games this session')).toBeVisible()
    const partners = dialog.getByRole('region', { name: 'Partners' })
    await expect(partners.getByRole('listitem')).toHaveCount(1)
    await expect(partners.getByRole('listitem').first()).toContainText('Bob')
    await expect(partners.getByRole('listitem').first()).toContainText('3 times')
    const opponents = dialog.getByRole('region', { name: 'Opponents' })
    await expect(opponents.getByRole('listitem')).toHaveCount(2)
    await expect(opponents).toContainText('Cy')
    await expect(opponents).toContainText('Dee')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })

  test('are also shown for an ended session in Past sessions', async ({ page }) => {
    await lockedPairSession(page)
    await playGames(page, 2)
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save and end session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()

    await page.getByRole('button', { name: 'Past sessions' }).click()
    await page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Repeat Club/ }).click()
    const view = page.getByRole('dialog', { name: 'Repeat Club' })
    // Two games: 4 partnership slots, 2 different (Ann + Bob, Cy + Dee).
    await expect(view.getByRole('group', { name: 'Partners and opponents' }).getByText('Repeated partnerships: 2 of 4 (50%)')).toBeVisible()
  })

  test('singles has opponents only', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob'])
    await playGames(page, 2)
    await page.getByRole('tab', { name: 'Standings' }).click()
    await expect(card(page).getByText('Repeated opponent pairings: 1 of 2 (50%)')).toBeVisible()
    await expect(card(page).getByText(/Repeated partnerships/)).toHaveCount(0)
    await expect(card(page).getByRole('columnheader', { name: 'Partners' })).toHaveCount(0)
    await expect(card(page).getByRole('columnheader', { name: 'Opponents' })).toBeVisible()
  })
})
