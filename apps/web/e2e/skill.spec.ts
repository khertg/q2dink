import { expect, test, type Page } from '@playwright/test'
import { checkIn, openSessionMenu, recordWin, startGame, startSession, waitingAction } from './helpers'

const EXPERT = '6 · Elite / Pro (4.50+)'
const BEGINNER = '1 · Beginner (NR / < 2.50)'

const court = (page: Page, name = 'Court 1') => page.getByRole('region', { name, exact: true })
const nextUp = (page: Page) => page.getByRole('group', { name: 'Next up' })
/** A row of the Board's queue (an ordered list), not the Next up card's list. */
const queueRow = (page: Page, name: string) => page.locator('ol > li').filter({ hasText: name })
const levelButton = (scope: ReturnType<Page['locator']> | Page, name: string) =>
  scope.getByRole('button', { name: new RegExp(`^Change ${name}'s level`) })

/** Pick a level in the "Change <name>'s level" pop-up. */
async function pickLevel(page: Page, name: string, option: string | RegExp) {
  const dialog = page.getByRole('dialog', { name: `Change ${name}'s level` })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: option }).click()
  await expect(dialog).toHaveCount(0)
}

test.describe('editing a level in a session', () => {
  test('a waiting player, from the Check-in tab, and it shows on the Board', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await page.getByRole('tab', { name: 'Check-in' }).click()

    const row = page.getByRole('listitem').filter({ hasText: 'Ann' })
    await expect(levelButton(row, 'Ann')).toHaveText('Low Intermediate')
    await levelButton(row, 'Ann').click()
    const dialog = page.getByRole('dialog', { name: "Change Ann's level" })
    // The current level is marked, and every level shows its rating.
    await expect(dialog.getByRole('button', { name: '3 · Low Intermediate (3.00–3.49)' })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('button', { name: /^[1-6] · / })).toHaveCount(6)
    await dialog.getByRole('button', { name: '5 · Advanced (4.00–4.49)' }).click()

    await expect(page.getByText('Ann is now Advanced')).toBeVisible()
    await expect(levelButton(row, 'Ann')).toHaveText('Advanced')
    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(levelButton(queueRow(page, 'Ann'), 'Ann')).toHaveText('Lv 5')
    await expect(levelButton(queueRow(page, 'Bob'), 'Bob')).toHaveText('Lv 3')
  })

  test('choosing the level they already have changes nothing', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const row = page.getByRole('listitem').filter({ hasText: 'Ann' })
    await levelButton(row, 'Ann').click()
    await pickLevel(page, 'Ann', '3 · Low Intermediate (3.00–3.49)')
    await expect(page.getByText('Ann is now')).toHaveCount(0)
  })

  test('a player on a court, and in Next up', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'])
    await startGame(page, 'Court 1')

    await levelButton(court(page), 'Ann').click()
    await pickLevel(page, 'Ann', EXPERT)
    await expect(levelButton(court(page), 'Ann')).toHaveText('Lv 6')

    await levelButton(nextUp(page), 'Eve').click()
    await pickLevel(page, 'Eve', BEGINNER)
    await expect(levelButton(nextUp(page), 'Eve')).toHaveText('Lv 1')
    // The same person in the queue shows the same level.
    await expect(levelButton(queueRow(page, 'Eve'), 'Eve')).toHaveText('Lv 1')
  })

  test('a player on a break', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await waitingAction(page, 'Ann', 'Take a break')
    const row = page.getByRole('listitem').filter({ hasText: 'Ann' })
    await expect(page.getByText('On a break (1)')).toBeVisible()
    await levelButton(row, 'Ann').click()
    await pickLevel(page, 'Ann', '2 · Novice (2.50–2.99)')
    await expect(levelButton(row, 'Ann')).toHaveText('Novice')
    // Back in the queue with the new level.
    await row.getByRole('button', { name: 'Back to queue' }).click()
    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(levelButton(queueRow(page, 'Ann'), 'Ann')).toHaveText('Lv 2')
  })

  test('Next up re-balances at once with the new level', async ({ page }) => {
    await startSession(page, { matchmaking: 'Skill-separated' })
    await checkIn(page, [
      { name: 'Ann', skill: BEGINNER },
      { name: 'Bob', skill: EXPERT },
      { name: 'Cy', skill: BEGINNER },
      { name: 'Dee', skill: EXPERT },
      { name: 'Eve', skill: BEGINNER },
      { name: 'Fay', skill: EXPERT },
      { name: 'Gus', skill: BEGINNER },
    ])
    // The four beginners are grouped together, skipping the experts in between.
    for (const name of ['Ann', 'Cy', 'Eve', 'Gus']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page).getByText('Bob')).toHaveCount(0)

    await levelButton(nextUp(page), 'Gus').click()
    await pickLevel(page, 'Gus', EXPERT)
    // Only three beginners are left, so the group changes straight away: Gus drops out and the
    // experts who queued first are drawn in.
    await expect(nextUp(page).getByText('Gus')).toHaveCount(0)
    await expect(nextUp(page).getByText('Bob')).toBeVisible()
  })

  test('the change survives a reload and does not touch a game already on the court', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    // Who is on which team, without the level badges (which will change).
    const teamOf = async () =>
      court(page)
        .getByRole('group')
        .evaluateAll((teams) => teams.map((team) => [...team.querySelectorAll('li > span:first-child')].map((n) => n.textContent)))
    const before = await teamOf()
    await levelButton(court(page), 'Ann').click()
    await pickLevel(page, 'Ann', EXPERT)
    expect(await teamOf()).toEqual(before)

    await page.reload()
    await expect(levelButton(court(page), 'Ann')).toHaveText('Lv 6')
  })

  test('a pending Undo still works and keeps the new level', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    await recordWin(page)
    await expect(page.getByText('Court 1: Blue won')).toBeVisible()

    await levelButton(queueRow(page, 'Ann'), 'Ann').click()
    await pickLevel(page, 'Ann', EXPERT)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(court(page).getByText('In play')).toBeVisible()
    await expect(levelButton(court(page), 'Ann')).toHaveText('Lv 6')
  })
})

test.describe('editing a level on the saved roster', () => {
  /** Save Zed at Novice, end that session and start another, so Zed is a returning player. */
  async function withSavedZed(page: Page) {
    await startSession(page)
    await checkIn(page, [{ name: 'Zed', skill: '2 · Novice (2.50–2.99)' }])
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()
    await startSession(page)
    await page.getByRole('tab', { name: 'Check-in' }).click()
  }

  test('changes a returning player before they are checked in, without ticking them', async ({ page }) => {
    await withSavedZed(page)
    const roster = page.getByRole('group', { name: 'Check in from the roster' })
    await expect(levelButton(roster, 'Zed')).toHaveText('Lv 2')
    await levelButton(roster, 'Zed').click()
    await pickLevel(page, 'Zed', '4 · Intermediate (3.50–3.99)')

    await expect(page.getByText('Zed is now Intermediate')).toBeVisible()
    await expect(levelButton(roster, 'Zed')).toHaveText('Lv 4')
    // Tapping the level is not ticking the player.
    await expect(roster.getByRole('checkbox', { name: /^Zed/ })).not.toBeChecked()

    await roster.getByRole('checkbox', { name: /^Zed/ }).check()
    await roster.getByRole('button', { name: 'Check in 1 player' }).click()
    await expect(levelButton(page.getByRole('listitem').filter({ hasText: 'Zed' }), 'Zed')).toHaveText('Intermediate')
  })

  test('an edit made during a session is what the player starts the next session with', async ({ page }) => {
    await startSession(page)
    await checkIn(page, [{ name: 'Zed', skill: '2 · Novice (2.50–2.99)' }])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await levelButton(page.getByRole('listitem').filter({ hasText: 'Zed' }), 'Zed').click()
    await pickLevel(page, 'Zed', '5 · Advanced (4.00–4.49)')

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()
    await startSession(page)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(levelButton(page.getByRole('group', { name: 'Check in from the roster' }), 'Zed')).toHaveText('Lv 5')
  })
})

test.describe('players per level', () => {
  const pills = (page: Page, label: string) => page.getByRole('list', { name: label }).getByRole('listitem')

  test('counts everyone checked in and everyone waiting, leaving out levels with nobody', async ({ page }) => {
    await startSession(page)
    await checkIn(page, [
      'Ann',
      'Bob',
      { name: 'Cy', skill: '5 · Advanced (4.00–4.49)' },
      'Dee',
      { name: 'Eve', skill: BEGINNER },
    ])

    await expect(pills(page, 'Checked in per level')).toHaveText(['Lv 1 · 1', 'Lv 3 · 3', 'Lv 5 · 1'])
    await expect(pills(page, 'Waiting per level')).toHaveText(['Lv 1 · 1', 'Lv 3 · 3', 'Lv 5 · 1'])
    await expect(page.getByRole('list', { name: 'Checked in per level' })).not.toContainText('Lv 6')
    await expect(page.getByTitle('Low Intermediate (3.00–3.49): 3 players')).toHaveCount(2)

    // Four go on court: they still count as checked in, but no longer as waiting.
    await startGame(page)
    await expect(pills(page, 'Checked in per level')).toHaveText(['Lv 1 · 1', 'Lv 3 · 3', 'Lv 5 · 1'])
    await expect(pills(page, 'Waiting per level')).toHaveCount(1)
    await expect(pills(page, 'Waiting per level')).toHaveText([/^Lv \d · 1$/])
  })
})
