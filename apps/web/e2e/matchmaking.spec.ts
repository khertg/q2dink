import { expect, test, type Page } from '@playwright/test'
import { checkIn, choose, confirmLock, recordWin, startSession, startGame } from './helpers'

const MODES = ['Auto-balanced', 'Skill-separated', 'Winners vs. Losers', 'Mixed doubles']

test('offers matchmaking modes for doubles only', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Matchmaking')).toBeVisible()
  await expect(page.getByText('First come, first served, with teams split evenly by skill.')).toBeVisible()

  await choose(page, 'Matchmaking', 'Mixed doubles')
  await expect(page.getByText(/Every team has one man and one woman/)).toBeVisible()

  await page.getByRole('button', { name: 'Singles' }).click()
  await expect(page.getByLabel('Matchmaking')).toHaveCount(0)
})

for (const mode of MODES) {
  test(`starts a session in ${mode} mode`, async ({ page }) => {
    await startSession(page, { matchmaking: mode })
    await expect(page.getByText(mode, { exact: true })).toBeVisible()
  })
}

test.describe('mixed doubles', () => {
  test('requires a gender at check-in', async ({ page }) => {
    await startSession(page, { matchmaking: 'Mixed doubles' })
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('Gender (required for mixed doubles)')).toBeVisible()

    await page.getByLabel('Player name').fill('Alex')
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeDisabled()

    await choose(page, /^Gender/, 'Male')
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeEnabled()
  })

  test('waits for two men and two women, then stages the match', async ({ page }) => {
    await startSession(page, { matchmaking: 'Mixed doubles' })
    await checkIn(page, [
      { name: 'Alex', gender: 'Male' },
      { name: 'Ben', gender: 'Male' },
      { name: 'Carl', gender: 'Male' },
      { name: 'Dan', gender: 'Male' },
      { name: 'Eva', gender: 'Female' },
    ])
    const court = page.getByRole('region', { name: 'Court 1' })
    // Four men and one woman: no valid mixed group yet, so the court stays open.
    await expect(court.getByText('Open')).toBeVisible()
    await expect(court.getByRole('button', { name: 'Start with waiting players' })).toBeVisible()

    await expect(page.getByRole('group', { name: 'Next up' })).toContainText('Waiting for two men and two women')

    await checkIn(page, [{ name: 'Fay', gender: 'Female' }])
    await expect(court.getByText('Open')).toBeVisible() // still nothing starts by itself
    await startGame(page)
    // The earliest two men and both women play; the other men wait.
    for (const name of ['Alex', 'Ben', 'Eva', 'Fay']) await expect(court.getByText(name)).toBeVisible()
    for (const name of ['Carl', 'Dan']) await expect(court.getByText(name)).toHaveCount(0)
    await expect(page.getByText('Queue (2)')).toBeVisible()
  })

  test('lets staff start an open court by hand', async ({ page }) => {
    await startSession(page, { matchmaking: 'Mixed doubles' })
    await checkIn(page, ['Alex', 'Ben', 'Carl', 'Dan'].map((name) => ({ name, gender: 'Male' as const })))
    const court = page.getByRole('region', { name: 'Court 1' })
    await court.getByRole('button', { name: 'Start with waiting players' }).click()
    await expect(page.getByText('Court 1 started')).toBeVisible()
    await expect(court.getByText('In play')).toBeVisible()
  })
})

test.describe('partner locking', () => {
  test('keeps locked partners on the same team', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await choose(page, 'First partner', 'Ann')
    await choose(page, 'Second partner', 'Cy')
    await page.getByRole('button', { name: 'Lock partners' }).click()
    await confirmLock(page)
    await expect(page.getByText('Ann & Cy')).toBeVisible()

    await checkIn(page, ['Dee'])
    const court = page.getByRole('region', { name: 'Court 1' })
    await expect(court.getByText('Open')).toBeVisible()
    // Next up already shows the pair together.
    const preview = page
      .getByRole('group', { name: 'Next up' })
      .getByRole('group', { name: /^(Blue|Orange)$/ })
      .filter({ hasText: 'Ann' })
    await expect(preview.getByText('Cy')).toBeVisible()
    await startGame(page)
    const annsTeam = court.getByRole('group').filter({ has: page.getByText('Ann') })
    await expect(annsTeam.getByText('Cy')).toBeVisible()
    await expect(annsTeam.getByLabel('Locked partners')).toBeVisible()
  })

  test('unlocks partners', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await choose(page, 'First partner', 'Ann')
    await choose(page, 'Second partner', 'Bob')
    await page.getByRole('button', { name: 'Lock partners' }).click()
    await confirmLock(page)
    await expect(page.getByText('Ann & Bob')).toBeVisible()

    await page.getByRole('button', { name: 'Unlock Ann and Bob' }).click()
    await expect(page.getByText('Ann & Bob')).toHaveCount(0)
  })

  test('is not offered in singles', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('Locked partners always share a team')).toHaveCount(0)
  })

  test('shows a lock next to queued partners', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await choose(page, 'First partner', 'Ann')
    await choose(page, 'Second partner', 'Bob')
    await page.getByRole('button', { name: 'Lock partners' }).click()
    await confirmLock(page)
    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(page.getByLabel('Locked with Bob')).toBeVisible()
    await expect(page.getByLabel('Locked with Ann')).toBeVisible()
  })
})

test.describe('partners and opponents rotate', () => {
  const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal']

  /** The two teams in the Next up card, as sorted name lists. */
  async function nextUpTeams(page: Page) {
    const lists = page.getByRole('group', { name: 'Next up' }).locator('ul')
    await expect(lists).toHaveCount(2)
    const teams: string[][] = []
    for (let i = 0; i < 2; i++) {
      const rows = await lists.nth(i).locator('li').allTextContents()
      teams.push(rows.map((row) => NAMES.find((name) => row.startsWith(name))!).sort())
    }
    return teams
  }

  test('Winners vs. Losers keeps the ladder but does not lock the winning pairs together', async ({ page }) => {
    await startSession(page, { courts: 2, matchmaking: 'Winners vs. Losers' })
    await checkIn(page, NAMES)
    await startGame(page, 'Court 1') // Ann + Bob against Cy + Dee
    await startGame(page, 'Court 2') // Eve + Fay against Gus + Hal
    await recordWin(page, 'Court 1', 'A')
    await recordWin(page, 'Court 2', 'A')

    // The four winners meet, but with new partners: neither winning pair plays together again.
    const winners = await nextUpTeams(page)
    expect(winners.flat().sort()).toEqual(['Ann', 'Bob', 'Eve', 'Fay'])
    for (const team of winners) {
      expect(team).not.toEqual(['Ann', 'Bob'])
      expect(team).not.toEqual(['Eve', 'Fay'])
    }
    await startGame(page, 'Court 1')
    await recordWin(page, 'Court 1', 'A')

    // The four losers are next, also with new partners.
    const losers = await nextUpTeams(page)
    expect(losers.flat().sort()).toEqual(['Cy', 'Dee', 'Gus', 'Hal'])
    for (const team of losers) {
      expect(team).not.toEqual(['Cy', 'Dee'])
      expect(team).not.toEqual(['Gus', 'Hal'])
    }
  })

  test('Auto-balanced pairs everyone with everyone before repeating a partner', async ({ page }) => {
    await startSession(page, { matchmaking: 'Auto-balanced' })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    const partnerships = new Set<string>()
    for (let game = 0; game < 3; game++) {
      for (const team of await nextUpTeams(page)) partnerships.add(team.join('+'))
      await startGame(page)
      await recordWin(page)
    }
    // Four players make six pairs, and three games use each of them once.
    expect(partnerships.size).toBe(6)
  })
})
