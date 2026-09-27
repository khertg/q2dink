import { expect, test, type Page } from '@playwright/test'
import { checkIn, openFromList, openSessionMenu, startSession } from './helpers'

/** Open the setup screen's Skill levels dialog. */
async function openLevels(page: Page) {
  await page.getByRole('button', { name: 'Skill levels' }).click()
  return page.getByRole('dialog', { name: 'Skill levels' })
}

/** The options of the Check-in tab's level picker. */
async function levelOptions(page: Page) {
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await page.getByLabel('Skill level').click()
  const options = await page.getByRole('option').allInnerTexts()
  await page.keyboard.press('Escape')
  return options
}

test.describe('the club’s skill levels', () => {
  test('are the suggested DUPR ranges by default, and can be switched to USA Pickleball', async ({ page }) => {
    await startSession(page)
    expect(await levelOptions(page)).toEqual([
      '1 · Beginner (NR / < 2.50)',
      '2 · Novice (2.50–2.99)',
      '3 · Low Intermediate (3.00–3.49)',
      '4 · Intermediate (3.50–3.99)',
      '5 · Advanced (4.00–4.49)',
      '6 · Elite / Pro (4.50+)',
    ])
    // The chosen level's description helps pick one.
    await expect(page.getByText('Developing consistency, placement, and basic strategy')).toBeVisible()

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Leave session' }).click()
    const dialog = await openLevels(page)
    await dialog.getByRole('button', { name: 'USA Pickleball' }).click()
    await dialog.getByRole('button', { name: 'Save levels' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByLabel('Session name').fill('USA night')
    await page.getByRole('button', { name: 'Create session' }).click()
    expect(await levelOptions(page)).toContain('6 · Expert (5.0+)')
  })

  test('can have any number of levels with their own names, and says what to fix', async ({ page }) => {
    await page.goto('/')
    const dialog = await openLevels(page)
    await dialog.getByRole('button', { name: 'Remove level 6' }).click()
    await dialog.getByRole('button', { name: 'Remove level 5' }).click()
    await dialog.getByLabel('Name of level 4').fill('Top')
    await dialog.getByLabel('Range of level 4').fill('3.5+')
    await dialog.getByLabel('Rating level 2 starts at').fill('0.5')
    await dialog.getByRole('button', { name: 'Save levels' }).click()
    await expect(dialog.getByRole('alert')).toHaveText('Level 2 must start at a rating from 1 to 8.')
    await dialog.getByLabel('Rating level 2 starts at').fill('2.5')
    await dialog.getByRole('button', { name: 'Save levels' }).click()
    await expect(dialog).toHaveCount(0)

    await startSession(page, { location: 'Four levels' })
    expect(await levelOptions(page)).toEqual([
      '1 · Beginner (NR / < 2.50)',
      '2 · Novice (2.50–2.99)',
      '3 · Low Intermediate (3.00–3.49)',
      '4 · Top (3.5+)',
    ])
  })

  test('a running session keeps its levels until staff switch it, and everyone keeps their rating', async ({ page }) => {
    await startSession(page, { location: 'Friday' })
    await checkIn(page, [{ name: 'Ann', skill: '4 · Intermediate (3.50–3.99)' }])
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Leave session' }).click()

    const dialog = await openLevels(page)
    await dialog.getByRole('button', { name: 'USA Pickleball' }).click()
    await dialog.getByRole('button', { name: 'Save levels' }).click()
    await expect(dialog).toHaveCount(0)

    await openFromList(page, 'Friday')
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const ann = page.getByRole('list', { name: 'Waiting players' }).getByRole('listitem').filter({ hasText: 'Ann' })
    await expect(ann.getByRole('button', { name: /^Change Ann's level/ })).toHaveText('Intermediate')

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Use the club’s new levels' }).click()
    // 3.5 is "Upper Intermediate" on the USA Pickleball scale.
    await expect(ann.getByRole('button', { name: /^Change Ann's level/ })).toHaveText('Upper Intermediate')
    await openSessionMenu(page)
    await expect(page.getByRole('button', { name: 'Use the club’s new levels' })).toHaveCount(0)
  })

  /** Keep only the first four of the club's levels (on the default: up to Intermediate, from 3.50). */
  async function fourLevels(page: Page) {
    const dialog = await openLevels(page)
    await dialog.getByRole('button', { name: 'Remove level 6' }).click()
    await dialog.getByRole('button', { name: 'Remove level 5' }).click()
    await dialog.getByRole('button', { name: 'Save levels' }).click()
    await expect(dialog).toHaveCount(0)
  }

  test('a court kept for levels keeps the same ratings when the session switches to the club’s new levels', async ({ page }) => {
    await startSession(page, { location: 'Courts', courts: 2 })
    const court1 = page.getByRole('region', { name: 'Court 1', exact: true })
    await court1.getByRole('button', { name: 'Court menu' }).click()
    await page.locator('[data-slot="popover-content"]').getByRole('button', { name: 'Skill levels…' }).click()
    const levels = page.getByRole('dialog', { name: 'Skill levels for Court 1' })
    await levels.getByLabel('Lowest level for Court 1').click()
    await page.getByRole('option', { name: '4.00–4.49 · Advanced', exact: true }).click()
    await levels.getByRole('button', { name: 'Done' }).click()
    await expect(court1.getByRole('img', { name: 'Skill levels: 4.00+' })).toBeVisible()

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Leave session' }).click()
    await fourLevels(page)
    await openFromList(page, 'Courts')
    await expect(court1.getByRole('img', { name: 'Skill levels: 4.00+' })).toBeVisible() // not switched yet
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Use the club’s new levels' }).click()
    // 4.00 and up is now inside the top level, Intermediate (from 3.50).
    await expect(court1.getByRole('img', { name: 'Skill levels: 3.50+' })).toBeVisible()
  })

  test('saved players show their level on the club’s levels, and new players start in the middle', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Saved players' }).click()
    const saved = page.getByRole('dialog', { name: /^Saved players/ })
    await saved.getByLabel('Player name').fill('Zed')
    await saved.getByLabel('Skill level').click()
    await page.getByRole('option', { name: '4 · Intermediate (3.50–3.99)', exact: true }).click()
    await saved.getByRole('button', { name: 'Save player' }).click()
    await expect(saved.getByRole('button', { name: /^Change Zed's level/ })).toHaveText('Intermediate')
    await page.keyboard.press('Escape')

    const dialog = await openLevels(page)
    await dialog.getByRole('button', { name: 'USA Pickleball' }).click()
    await dialog.getByRole('button', { name: 'Save levels' }).click()
    await page.getByRole('button', { name: 'Saved players' }).click()
    // Zed's rating (3.50) is Upper Intermediate on the USA Pickleball scale.
    await expect(saved.getByRole('button', { name: /^Change Zed's level/ })).toHaveText('Upper Intermediate')
    await page.keyboard.press('Escape')

    // The editor starts from the club's levels (now USA Pickleball): keep its first four.
    await fourLevels(page)
    await startSession(page, { location: 'Middle' })
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByLabel('Skill level')).toHaveText('2 · Novice (2.0-2.5)')
  })
})
