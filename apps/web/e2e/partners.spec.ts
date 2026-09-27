import { expect, test, type Page } from '@playwright/test'
import { avatarOf, queueRow } from './avatarHelpers'
import { checkIn, choose, confirmLock, playerAction, recordWin, startGame, startSession, waitingAction } from './helpers'

const NAMES = ['Suzy', 'Ann', 'Bob', 'Cy', 'Tong', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo']

const nextUp = (page: Page) => page.getByRole('group', { name: 'Next up' })
const court = (page: Page, name = 'Court 1') => page.getByRole('region', { name, exact: true })

/** Names in queue order, read from the Board's queue card. */
async function queueNames(page: Page) {
  const rows = await page.locator('ol > li').filter({ hasText: /Lv \d/ }).allInnerTexts()
  return rows.map((row) => row.replace(/^\d+\s+/, '').split(/\s/)[0])
}

async function openLockForm(page: Page, first: string, second: string) {
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await choose(page, 'First partner', first)
  await choose(page, 'Second partner', second)
  await page.getByRole('button', { name: 'Lock partners' }).click()
}

/** Suzy is playing on Court 1 with Ann, Bob and Cy; Tong is next up with Dee, Eve and Fay. */
async function suzyPlayingTongNextUp(page: Page) {
  await startSession(page, { courts: 2 })
  await checkIn(page, NAMES)
  await startGame(page, 'Court 1')
  for (const name of ['Suzy', 'Ann', 'Bob', 'Cy']) await expect(court(page).getByText(name)).toBeVisible()
  for (const name of ['Tong', 'Dee', 'Eve', 'Fay']) await expect(nextUp(page).getByText(name)).toBeVisible()
}

test.describe('locking a partner who is on a court', () => {
  test('asks first, names who is away, and does not change the line', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await openLockForm(page, 'Suzy', 'Tong')

    const dialog = page.getByRole('dialog', { name: 'Lock Suzy and Tong?' })
    await expect(dialog).toContainText('Suzy is playing on Court 1')
    await expect(dialog).toContainText('Tong keeps their place in line')
    await expect(dialog).toContainText('The lock starts once both of them have finished a game')
    await expect(dialog).toContainText('Tong waits for Suzy and plays no game without them. They queue together after Suzy’s game.')
    await dialog.getByRole('button', { name: 'Wait for 1 game' }).click()

    await expect(page.getByText('Suzy and Tong will be partners once both have finished a game')).toBeVisible()
    await expect(page.getByText('Starts after both have played')).toBeVisible()
    // Nothing moved: Tong is still next up.
    await page.getByRole('tab', { name: 'Board' }).click()
    for (const name of ['Tong', 'Dee', 'Eve', 'Fay']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page).getByText('Suzy')).toHaveCount(0)
  })

  test('the reported case: Suzy does not jump the line when her game ends, and Tong keeps his turn', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await openLockForm(page, 'Suzy', 'Tong')
    await page.getByRole('dialog').getByRole('button', { name: 'Wait for 1 game' }).click()
    await page.getByRole('tab', { name: 'Board' }).click()

    await recordWin(page, 'Court 1')
    // Suzy is at the back like anyone who has just played; Tong's group is still next.
    const queue = await queueNames(page)
    expect(queue.slice(0, 8)).toEqual(['Tong', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'])
    expect(queue.slice(8).sort()).toEqual(['Ann', 'Bob', 'Cy', 'Suzy'])
    for (const name of ['Tong', 'Dee', 'Eve', 'Fay']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page).getByText('Suzy')).toHaveCount(0)

    // Tong plays his game as normal, without a partner from the lock.
    await startGame(page, 'Court 2')
    await expect(court(page, 'Court 2').getByText('Tong')).toBeVisible()
    await expect(court(page, 'Court 2').getByText('Suzy')).toHaveCount(0)
    // Still waiting: Suzy has finished a game, Tong has not.
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('Starts after both have played')).toBeVisible()

    // Once Tong finishes too, the lock is in force.
    await page.getByRole('tab', { name: 'Board' }).click()
    await recordWin(page, 'Court 2')
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('Starts after both have played')).toHaveCount(0)
    await expect(page.getByText('Suzy & Tong')).toBeVisible()
    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(page.getByLabel('Locked with Tong')).toBeVisible()
    await expect(page.getByLabel('Locked with Suzy')).toBeVisible()
  })

  test('Cancel in the question locks nothing', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await openLockForm(page, 'Suzy', 'Tong')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Starts after both have played')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Lock partners' })).toBeEnabled()
  })

  test('a waiting lock can be unlocked before it starts', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await openLockForm(page, 'Suzy', 'Tong')
    await page.getByRole('dialog').getByRole('button', { name: 'Wait for 1 game' }).click()
    await page.getByRole('button', { name: 'Unlock Suzy and Tong' }).click()
    await expect(page.getByText('Suzy & Tong')).toHaveCount(0)
    await expect(page.getByText('Starts after both have played')).toHaveCount(0)
  })

  test('a partner returning from a break does not jump the line either', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await waitingAction(page, 'Ann', 'Take a break')
    await choose(page, 'First partner', 'Ann')
    await choose(page, 'Second partner', 'Eve')
    await page.getByRole('button', { name: 'Lock partners' }).click()
    const dialog = page.getByRole('dialog', { name: 'Lock Ann and Eve?' })
    await expect(dialog).toContainText('Ann is on a break')
    await dialog.getByRole('button', { name: 'Wait for 1 game' }).click()

    await page.getByRole('button', { name: 'Back to queue' }).click()
    await page.getByRole('tab', { name: 'Board' }).click()
    // Ann is at the back; Bob, Cy, Dee and Eve are still the next four.
    expect((await queueNames(page)).slice(-1)).toEqual(['Ann'])
    for (const name of ['Bob', 'Cy', 'Dee', 'Eve']) await expect(nextUp(page).getByText(name)).toBeVisible()
  })
})

test.describe('locking two players who are both waiting', () => {
  test('says the rule first, then Ann moves back beside Cy so nobody is passed', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    await openLockForm(page, 'Ann', 'Cy')
    await expect(page.getByRole('dialog', { name: 'Lock Ann and Cy?' })).toContainText(
      'Ann (#1) moves back to stand with Cy (#3), so nobody who is waiting is passed.',
    )
    await confirmLock(page)
    await expect(page.getByText('Ann and Cy are now partners')).toBeVisible()
    await expect(page.getByText('Starts after both have played')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Board' }).click()
    expect(await queueNames(page)).toEqual(['Bob', 'Ann', 'Cy', 'Dee', 'Eve'])
    // Together in the next group.
    for (const name of ['Ann', 'Cy']) await expect(nextUp(page).getByText(name)).toBeVisible()
    // Marked in Next up and in the queue alike.
    await expect(nextUp(page).getByLabel('Locked with Cy')).toBeVisible()
    await expect(queueRow(page, 'Ann').getByLabel('Locked with Cy')).toBeVisible()
  })

  test('two players in the same game are locked at once', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    await startGame(page)
    await openLockForm(page, 'Ann', 'Bob')
    await expect(page.getByRole('dialog', { name: 'Lock Ann and Bob?' })).toContainText('Both are playing on Court 1. The lock starts now')
    await confirmLock(page)
    await expect(page.getByText('Ann and Bob are now partners')).toBeVisible()
  })
})

test.describe('locking a partner from a player’s menu', () => {
  const menuItem = (page: Page, item: string) =>
    page.locator('[data-slot="popover-content"]').getByRole('button', { name: item })
  const partnerChoice = (page: Page, name: string) =>
    page.getByRole('list', { name: 'Possible partners' }).getByRole('button', { name: new RegExp(`^${name}`) })

  test('locks two waiting players from the queue, and unlocks them from the same menu', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'])
    await startGame(page)

    await page.getByRole('button', { name: 'Eve menu' }).click()
    await menuItem(page, 'Lock partner…').click()
    await expect(page.getByRole('dialog', { name: 'Lock a partner for Eve' })).toBeVisible()
    await partnerChoice(page, 'Fay').click()
    await confirmLock(page)
    await expect(page.getByText('Eve and Fay are now partners')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Locked with Fay' })).toBeVisible()

    await page.getByRole('button', { name: 'Eve menu' }).click()
    await menuItem(page, 'Unlock from Fay').click()
    await expect(page.getByText('Eve and Fay are no longer partners')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Locked with Fay' })).toHaveCount(0)
  })

  test('from a court, asks first when the lock has to wait, and the Partners card shows it waiting', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await playerAction(court(page), 'Suzy', 'Lock partner…')
    await partnerChoice(page, 'Tong').click()
    const confirm = page.getByRole('dialog', { name: 'Lock Suzy and Tong?' })
    await expect(confirm).toContainText('Suzy is playing on Court 1')
    await expect(confirm).toContainText('Tong keeps their place in line')
    await confirm.getByRole('button', { name: 'Wait for 1 game' }).click()
    await expect(page.getByText('Suzy and Tong will be partners once both have finished a game')).toBeVisible()

    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('Starts after both have played.')).toBeVisible()
  })

  test('is not offered in singles', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob', 'Cy'])
    await startGame(page)
    await page.getByRole('button', { name: 'Cy menu' }).click()
    await expect(menuItem(page, 'Take a break')).toBeVisible()
    await expect(menuItem(page, 'Lock partner…')).toHaveCount(0)
  })
})

test.describe('how locked partners look', () => {
  /** The ring around a player's avatar: its colour and style. */
  const ring = (scope: Page | ReturnType<Page['locator']>, name: string) =>
    avatarOf(scope, name).evaluate((el) => {
      const style = getComputedStyle(el)
      return { colour: style.outlineColor, style: style.outlineStyle }
    })

  test('each pair gets a ring in its own colour and a lock saying who with', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal'])
    await startGame(page)
    await openLockForm(page, 'Eve', 'Fay')
    await confirmLock(page)
    await openLockForm(page, 'Gus', 'Hal')
    await confirmLock(page)
    await page.getByRole('tab', { name: 'Board' }).click()

    await expect(queueRow(page, 'Eve').getByRole('img', { name: 'Locked with Fay' })).toBeVisible()
    await expect(queueRow(page, 'Fay').getByRole('img', { name: 'Locked with Eve' })).toBeVisible()
    await expect(queueRow(page, 'Gus').getByRole('img', { name: 'Locked with Hal' })).toBeVisible()
    const [eve, fay, gus] = [await ring(queueRow(page, 'Eve'), 'Eve'), await ring(queueRow(page, 'Fay'), 'Fay'), await ring(queueRow(page, 'Gus'), 'Gus')]
    expect(eve.style).toBe('solid')
    expect(fay.colour).toBe(eve.colour)
    expect(gus.colour).not.toBe(eve.colour)
    // Nobody else in the queue is marked.
    await expect(page.locator('ol > li').filter({ hasText: /Lv \d/ }).getByRole('img', { name: /^Locked with/ })).toHaveCount(4)
  })

  test('a lock that still waits has a dashed ring and says so; unlocking removes the marks', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await openLockForm(page, 'Suzy', 'Tong')
    await page.getByRole('dialog', { name: 'Lock Suzy and Tong?' }).getByRole('button', { name: 'Wait for 1 game' }).click()
    await page.getByRole('tab', { name: 'Board' }).click()

    await expect(court(page).getByRole('img', { name: 'Will be locked with Tong' })).toBeVisible()
    expect((await ring(court(page), 'Suzy')).style).toBe('dashed')

    await page.getByRole('tab', { name: 'Check-in' }).click()
    await page.getByRole('button', { name: 'Unlock Suzy and Tong' }).click()
    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(page.getByRole('img', { name: /locked with/i })).toHaveCount(0)
    expect((await ring(court(page), 'Suzy')).style).toBe('none')
  })
})

test.describe('Lock now, holding for a partner, and asking before unlocking', () => {
  test('Lock now: Tong waits for Suzy, then they queue together after her game', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await openLockForm(page, 'Suzy', 'Tong')
    await confirmLock(page, 'Lock now')
    await expect(page.getByText('Suzy and Tong are now partners, and wait for each other')).toBeVisible()
    await page.getByRole('tab', { name: 'Board' }).click()

    // Tong holds: out of Next up, and the queue says why.
    await expect(nextUp(page).getByText('Tong')).toHaveCount(0)
    await expect(queueRow(page, 'Tong')).toContainText('Waits for Suzy')
    await expect(queueRow(page, 'Tong').getByRole('img', { name: 'Locked with Suzy' })).toBeVisible()

    await recordWin(page, 'Court 1')
    // Suzy is back at the end; the pair stands at her spot, so Tong no longer says he waits.
    await expect(queueRow(page, 'Tong')).not.toContainText('Waits for')
    const queue = await queueNames(page)
    expect(queue.indexOf('Suzy')).toBeGreaterThan(queue.indexOf('Jo'))
    await expect(nextUp(page).getByText('Tong')).toHaveCount(0)
  })

  test('Lock now from a player’s menu', async ({ page }) => {
    await suzyPlayingTongNextUp(page)
    await playerAction(court(page), 'Suzy', 'Lock partner…')
    await page.getByRole('list', { name: 'Possible partners' }).getByRole('button', { name: /^Tong/ }).click()
    await confirmLock(page, 'Lock now')
    await expect(queueRow(page, 'Tong')).toContainText('Waits for Suzy')
  })

  test('taking a locked player off a court asks first: Cancel keeps the lock, Continue ends it', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'])
    await startGame(page)
    const [first, second] = await court(page).getByRole('group', { name: 'Blue' }).locator('li').allInnerTexts()
    const [a, b] = [first.split('\n')[0].trim(), second.split('\n')[0].trim()]
    await openLockForm(page, a, b)
    await confirmLock(page)
    await page.getByRole('tab', { name: 'Board' }).click()

    await playerAction(court(page), a, 'Remove from court')
    const ask = page.getByRole('dialog', { name: `Unlock ${a} and ${b}?` })
    await expect(ask).toContainText(`Taking ${a} off Court 1 ends the partner lock of ${a} & ${b}.`)
    await ask.getByRole('button', { name: 'Cancel' }).click()
    await expect(court(page).getByText(a)).toBeVisible()
    await expect(court(page).getByRole('img', { name: `Locked with ${b}` })).toBeVisible()

    await playerAction(court(page), a, 'Remove from court')
    await page.getByRole('dialog', { name: `Unlock ${a} and ${b}?` }).getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(`${a} and ${b} are no longer locked partners.`)).toBeVisible()
    await expect(page.getByRole('img', { name: /^Locked with/ })).toHaveCount(0)
  })

  test('a locked player taking a break: their partner waits for them, and says so', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'])
    await startGame(page)
    await openLockForm(page, 'Eve', 'Fay')
    await confirmLock(page)
    await page.getByRole('tab', { name: 'Board' }).click()
    await page.getByRole('button', { name: 'Eve menu' }).click()
    await page.locator('[data-slot="popover-content"]').getByRole('button', { name: 'Take a break' }).click()
    await expect(page.getByText('Fay waits for Eve to come back from the break.')).toBeVisible()
    await expect(queueRow(page, 'Fay')).toContainText('Waits for Eve')
  })
})
