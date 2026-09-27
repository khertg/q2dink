import { expect, test, type Page } from '@playwright/test'
import { checkIn, choose, confirmLock, playerAction, recordWin, startGame, startSession, waitingAction } from './helpers'

const SIX = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay']
const EIGHT = [...SIX, 'Gus', 'Hal']

const court = (page: Page, name = 'Court 1') => page.getByRole('region', { name, exact: true })
const nextUp = (page: Page) => page.getByRole('group', { name: 'Next up' })

/** Names in queue order, read from the Board's queue card. */
async function queueNames(page: Page) {
  const rows = await page.locator('ol > li').filter({ hasText: /Lv \d/ }).allInnerTexts()
  return rows.map((row) => row.replace(/^\d+\s+/, '').split(/\s/)[0])
}

/** The Next up card's names, Blue then Orange, read from each team's list. */
async function nextUpTeams(page: Page) {
  const teams = nextUp(page).locator('ul')
  const names = async (i: number) =>
    (await teams.nth(i).locator('li').allInnerTexts()).map((row) => row.split('\n')[0].trim())
  return [await names(0), await names(1)]
}

/** Put a waiting player on a break from the Check-in tab, then go back to the Board. */
async function takeBreak(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await waitingAction(page, name, 'Take a break')
  await page.getByRole('tab', { name: 'Board' }).click()
}

test.describe('swapping a player on a court', () => {
  async function playing(page: Page) {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
  }

  test('puts the player who came off at the front of the queue, not on a break', async ({ page }) => {
    await playing(page)
    await playerAction(court(page), 'Ann', 'Swap…')
    const dialog = page.getByRole('dialog', { name: 'Replace Ann' })
    await expect(dialog).toContainText('Ann goes to the front of the queue')
    await dialog.getByRole('button', { name: /Fay/ }).click() // not the front of the queue: Eve is

    await expect(page.getByText('Fay replaced Ann. Ann is first in the queue.')).toBeVisible()
    await expect(court(page).getByText('Fay')).toBeVisible()
    await expect(court(page).getByText('Ann')).toHaveCount(0)
    expect(await queueNames(page)).toEqual(['Ann', 'Eve'])

    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('On a break')).toHaveCount(0)
  })

  test('sends them on a break instead when that is ticked', async ({ page }) => {
    await playing(page)
    await playerAction(court(page), 'Ann', 'Swap…')
    const dialog = page.getByRole('dialog', { name: 'Replace Ann' })
    await dialog.getByLabel('Send Ann on a break instead').check()
    await expect(dialog).toContainText('Ann will go on a break')
    await dialog.getByRole('button', { name: /Eve/ }).click()

    await expect(page.getByText('Eve replaced Ann. Ann is on a break.')).toBeVisible()
    expect(await queueNames(page)).toEqual(['Fay'])
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await expect(page.getByText('On a break (1)')).toBeVisible()
  })

  test('starts unticked every time the pop-up opens', async ({ page }) => {
    await playing(page)
    await playerAction(court(page), 'Ann', 'Swap…')
    const dialog = page.getByRole('dialog', { name: 'Replace Ann' })
    await dialog.getByLabel('Send Ann on a break instead').check()
    await page.keyboard.press('Escape')
    await playerAction(court(page), 'Bob', 'Swap…')
    await expect(page.getByRole('dialog', { name: 'Replace Bob' }).getByLabel('Send Bob on a break instead')).not.toBeChecked()
  })

  test('the player who came off can be swapped straight back in', async ({ page }) => {
    await playing(page)
    await playerAction(court(page), 'Ann', 'Swap…')
    await page.getByRole('dialog', { name: 'Replace Ann' }).getByRole('button', { name: /Eve/ }).click()
    await playerAction(court(page), 'Eve', 'Swap…')
    await page.getByRole('dialog', { name: 'Replace Eve' }).getByRole('button', { name: /Ann/ }).click()
    await expect(court(page).getByText('Ann')).toBeVisible()
    await expect(court(page).getByText('Eve')).toHaveCount(0)
  })

  test('shows where everyone is, and trades places with a player on another court', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, EIGHT)
    await startGame(page) // Ann, Bob, Cy, Dee
    await startGame(page, 'Court 2') // Eve, Fay, Gus, Hal
    await playerAction(court(page), 'Ann', 'Swap…')
    const dialog = page.getByRole('dialog', { name: 'Replace Ann' })
    await expect(dialog.getByRole('button', { name: /Bob/ })).toContainText('On this court')
    await expect(dialog.getByRole('button', { name: /Eve/ })).toContainText('On Court 2')
    await dialog.getByRole('button', { name: /Eve/ }).click()

    await expect(page.getByText('Eve and Ann traded places (Court 1 ↔ Court 2).')).toBeVisible()
    await expect(court(page).getByText('Eve')).toBeVisible()
    await expect(court(page, 'Court 2').getByText('Ann')).toBeVisible()
  })

  test('brings a substitute back from a break', async ({ page }) => {
    await playing(page)
    await takeBreak(page, 'Fay')
    await playerAction(court(page), 'Ann', 'Swap…')
    const dialog = page.getByRole('dialog', { name: 'Replace Ann' })
    await expect(dialog.getByRole('button', { name: /Fay/ })).toContainText('On a break')
    await dialog.getByRole('button', { name: /Fay/ }).click()
    await expect(page.getByText('Fay is back from a break and replaced Ann. Ann is first in the queue.')).toBeVisible()
    await expect(court(page).getByText('Fay')).toBeVisible()
  })

  test('removes a partner lock and says so', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await choose(page, 'First partner', 'Ann')
    await choose(page, 'Second partner', 'Bob')
    await page.getByRole('button', { name: 'Lock partners' }).click()
    await confirmLock(page)
    await page.getByRole('tab', { name: 'Board' }).click()
    await startGame(page)

    await playerAction(court(page), 'Ann', 'Swap…')
    await page.getByRole('dialog', { name: 'Replace Ann' }).getByRole('button', { name: /Eve/ }).click()
    // Asked first: the swap ends the lock.
    const ask = page.getByRole('dialog', { name: 'Unlock Ann and Bob?' })
    await expect(ask).toContainText('Taking Ann off Court 1 ends the partner lock of Ann & Bob.')
    await ask.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('Ann and Bob are no longer locked partners.')).toBeVisible()
  })
})

test.describe('changing who is next up', () => {
  async function withEight(page: Page) {
    await startSession(page, { courts: 2 })
    await checkIn(page, EIGHT)
  }

  test('puts the chosen player in the group, and the replaced player keeps their place in the queue', async ({ page }) => {
    await withEight(page)
    await playerAction(nextUp(page), 'Bob', 'Swap…')
    const dialog = page.getByRole('dialog', { name: 'Replace Bob in Next up' })
    await expect(dialog).toContainText('Bob stays in the queue where they are')
    // The rest of the group is offered too (to change places), marked as such.
    for (const name of ['Ann', 'Cy', 'Dee']) {
      await expect(dialog.getByRole('button', { name: new RegExp(name) })).toContainText('In this group')
    }
    await expect(dialog.getByRole('button', { name: /Gus/ })).toContainText('Waiting #7')
    await dialog.getByRole('button', { name: /Gus/ }).click()

    await expect(page.getByText('Gus is next up instead of Bob.')).toBeVisible()
    for (const name of ['Ann', 'Cy', 'Dee', 'Gus']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page).getByText('Bob')).toHaveCount(0)
    // The queue itself is untouched, and the badges follow the group.
    expect(await queueNames(page)).toEqual(EIGHT)
    await expect(page.getByText('Next up', { exact: true })).toHaveCount(5) // card title + four badges
    await expect(page.getByRole('listitem').filter({ hasText: /^2\s*Bob/ }).getByText('Next up')).toHaveCount(0)
    await expect(page.getByRole('listitem').filter({ hasText: /^7\s*Gus/ }).getByText('Next up')).toBeVisible()
  })

  test('Start game puts exactly the chosen group on the court, and the next group is automatic again', async ({ page }) => {
    await withEight(page)
    await playerAction(nextUp(page), 'Ann', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Hal/ }).click()

    await startGame(page, 'Court 2')
    for (const name of ['Bob', 'Cy', 'Dee', 'Hal']) await expect(court(page, 'Court 2').getByText(name)).toBeVisible()
    await expect(court(page, 'Court 1').getByText('Open')).toBeVisible()
    // Automatic again: Ann is first in line and the group is the next four in the queue.
    for (const name of ['Ann', 'Eve', 'Fay', 'Gus']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page).getByRole('button', { name: 'Reset' })).toHaveCount(0)
  })

  test('says the group was chosen, and Reset goes back to the automatic one', async ({ page }) => {
    await withEight(page)
    await expect(nextUp(page).getByRole('button', { name: 'Reset' })).toHaveCount(0)
    await playerAction(nextUp(page), 'Ann', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await expect(nextUp(page)).toContainText('Chosen by staff')

    await nextUp(page).getByRole('button', { name: 'Reset' }).click()
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page)).not.toContainText('Chosen by staff')
  })

  test('can be changed more than once', async ({ page }) => {
    await withEight(page)
    await playerAction(nextUp(page), 'Ann', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await playerAction(nextUp(page), 'Eve', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Ann/ }).click()
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp(page).getByText(name)).toBeVisible()
  })

  test('goes back to automatic if someone in the chosen group goes on a break', async ({ page }) => {
    await withEight(page)
    await playerAction(nextUp(page), 'Ann', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await expect(nextUp(page).getByText('Eve')).toBeVisible()

    await page.getByRole('tab', { name: 'Check-in' }).click()
    await waitingAction(page, 'Eve', 'Take a break')
    await page.getByRole('tab', { name: 'Board' }).click()
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp(page).getByText(name)).toBeVisible()
    await expect(nextUp(page)).not.toContainText('Chosen by staff')
  })

  test('lets two players of the group change places, keeping everyone else where they were', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    const before = await nextUpTeams(page)
    const [a, b] = [before[0][0], before[1][0]]
    await playerAction(nextUp(page), a, 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(b) }).click()
    await expect(page.getByText(`${b} and ${a} changed places in Next up.`)).toBeVisible()
    expect(await nextUpTeams(page)).toEqual([
      [b, before[0][1]],
      [a, before[1][1]],
    ])
  })

  test('trades places with a player on a court', async ({ page }) => {
    await withEight(page)
    await startGame(page) // Ann, Bob, Cy and Dee play; Eve, Fay, Gus and Hal are next up
    const before = await nextUpTeams(page)
    await playerAction(nextUp(page), 'Eve', 'Swap…')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: /Ann/ })).toContainText('On Court 1')
    await dialog.getByRole('button', { name: /Ann/ }).click()

    await expect(page.getByText('Ann and Eve traded places: Eve is on Court 1, Ann is next up.')).toBeVisible()
    await expect(court(page).getByText('Eve')).toBeVisible()
    await expect(court(page).getByText('Ann')).toHaveCount(0)
    expect(await nextUpTeams(page)).toEqual(before.map((team) => team.map((n) => (n === 'Eve' ? 'Ann' : n))))
  })

  test('brings someone back from a break', async ({ page }) => {
    await withEight(page)
    await takeBreak(page, 'Hal')
    await playerAction(nextUp(page), 'Ann', 'Swap…')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: /Hal/ })).toContainText('On a break')
    await dialog.getByRole('button', { name: /Hal/ }).click()
    await expect(page.getByText('Hal is back from a break and next up instead of Ann.')).toBeVisible()
    await expect(nextUp(page).getByText('Hal')).toBeVisible()
  })

  test('keeps the title in view and scrolls the list when many players are checked in', async ({ page }) => {
    const many = Array.from({ length: 24 }, (_, i) => `Player ${String.fromCharCode(65 + i)}`)
    await startSession(page)
    await checkIn(page, many)
    await playerAction(nextUp(page), 'Player A', 'Swap…')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Replace Player A in Next up' })).toBeInViewport()
    await dialog.getByLabel('Find a player').fill('Player X')
    await expect(dialog.getByRole('button', { name: /Player/ })).toHaveCount(1)
    await dialog.getByRole('button', { name: /Player X/ }).click()
    await expect(nextUp(page).getByText('Player X')).toBeVisible()
  })

  test('works in singles', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob', 'Cy'])
    await playerAction(nextUp(page), 'Bob', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Cy/ }).click()
    await expect(nextUp(page).getByText('Cy')).toBeVisible()
    await expect(nextUp(page).getByText('Bob')).toHaveCount(0)
    await startGame(page)
    await expect(court(page).getByText('Cy')).toBeVisible()
  })

  test('unlocks partners it has to split, and says so', async ({ page }) => {
    await withEight(page)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await choose(page, 'First partner', 'Ann')
    await choose(page, 'Second partner', 'Bob')
    await page.getByRole('button', { name: 'Lock partners' }).click()
    await confirmLock(page)
    await page.getByRole('tab', { name: 'Board' }).click()

    await playerAction(nextUp(page), 'Ann', 'Swap…')
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await page.getByRole('dialog', { name: 'Unlock Ann and Bob?' }).getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(/Ann and Bob are no longer locked partners\./)).toBeVisible()
  })
})

test.describe('the player menu: Remove and Take a break', () => {
  const menuItem = (page: Page, item: string) =>
    page.locator('[data-slot="popover-content"]').getByRole('button', { name: item })

  test('Remove from court leaves the spot open, pauses the game, and puts the player first in the queue', async ({
    page,
  }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
    await playerAction(court(page), 'Ann', 'Remove from court')
    await expect(
      page.getByText('Ann is off Court 1 and first in the queue. The game is paused until the spot is filled.'),
    ).toBeVisible()
    await expect(court(page).getByText('Ann')).toHaveCount(0)
    await expect(court(page).getByRole('button', { name: 'Fill open spot on Blue' })).toBeVisible()
    await expect(court(page).getByText('Paused')).toBeVisible()
    await expect(court(page).getByRole('button', { name: 'Blue won' })).toBeDisabled()
    await expect(court(page).getByRole('button', { name: 'Orange won' })).toBeDisabled()
    await expect(court(page)).toContainText('Fill the open spot to finish the game.')
    expect(await queueNames(page)).toEqual(['Ann', 'Eve', 'Fay'])
  })

  test('Take a break on a court does the same and puts the player on a break', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
    await playerAction(court(page), 'Bob', 'Take a break')
    await expect(page.getByText('Bob is off Court 1 and on a break.', { exact: false })).toBeVisible()
    await expect(court(page).getByText('Paused')).toBeVisible()
    expect(await queueNames(page)).toEqual(['Eve', 'Fay'])
  })

  test('filling the open spot puts the game back on, and it can then be finished', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
    await playerAction(court(page), 'Ann', 'Remove from court')
    await court(page).getByRole('button', { name: 'Fill open spot on Blue' }).click()
    const dialog = page.getByRole('dialog', { name: 'Fill the open spot · Court 1, Blue' })
    // Only people waiting or on a break can fill it; players on courts are not offered.
    await expect(dialog.getByRole('button', { name: /Bob/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: /Fay/ }).click()

    await expect(page.getByText('Fay is on Court 1. The game is back on.')).toBeVisible()
    await expect(court(page).getByRole('group', { name: 'Blue' }).getByText('Fay')).toBeVisible()
    await expect(court(page).getByText('Paused')).toHaveCount(0)
    await recordWin(page)
    await expect(court(page).getByText('Open', { exact: true })).toBeVisible()
  })

  test('a paused game can still be cancelled', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
    await playerAction(court(page), 'Ann', 'Remove from court')
    await court(page).getByRole('button', { name: 'Court menu' }).click()
    await page.getByRole('button', { name: 'Cancel game' }).click()
    await page.getByRole('dialog', { name: 'Cancel this game?' }).getByRole('button', { name: 'Cancel game' }).click()
    await expect(court(page).getByText('Open', { exact: true })).toBeVisible()
  })

  test('Remove from Next up brings in the next waiting player in the same spot, and the others stay put', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    const before = await nextUpTeams(page)
    await playerAction(nextUp(page), before[0][0], 'Remove from Next up')
    await expect(page.getByText(`Eve is next up instead of ${before[0][0]}.`)).toBeVisible()
    expect(await nextUpTeams(page)).toEqual([['Eve', before[0][1]], before[1]])
    expect(await queueNames(page)).toEqual(SIX) // they keep their place in the queue
  })

  test('Take a break in Next up does the same and puts the player on a break', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    const before = await nextUpTeams(page)
    const out = before[1][1]
    await playerAction(nextUp(page), out, 'Take a break')
    await expect(page.getByText(`${out} is on a break. Eve is next up instead.`)).toBeVisible()
    expect(await nextUpTeams(page)).toEqual([before[0], [before[1][0], 'Eve']])
    expect(await queueNames(page)).not.toContain(out)
  })

  test('Remove from Next up is unavailable when nobody can stand in; on a court it always is', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await nextUp(page).getByRole('button', { name: 'Options for Ann' }).click()
    await expect(menuItem(page, 'Remove from Next up')).toBeDisabled()
    await expect(menuItem(page, 'Remove from Next up')).toContainText('No one else is waiting to take their spot')
    await expect(menuItem(page, 'Take a break')).toBeEnabled() // from Next up, a break is always possible
    await page.keyboard.press('Escape')

    await startGame(page)
    await court(page).getByRole('button', { name: 'Options for Ann' }).click()
    await expect(menuItem(page, 'Remove from court')).toBeEnabled() // it leaves the spot open
    await expect(menuItem(page, 'Take a break')).toBeEnabled()
    await expect(menuItem(page, 'Swap…')).toBeEnabled()
  })
})

test.describe('open spots', () => {
  const openSpots = (scope: ReturnType<typeof court>) => scope.getByRole('button', { name: /^Fill open spot on / })

  test('an open court and an empty Next up show a spot to fill for every player', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    await expect(openSpots(court(page))).toHaveCount(0)
    await expect(openSpots(court(page, 'Court 2'))).toHaveCount(4)
    await expect(openSpots(nextUp(page))).toHaveCount(4)
  })

  test('singles has one spot per team', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await expect(openSpots(court(page))).toHaveCount(2)
  })

  test('a game can be set up by hand on an open court, and starts only when every spot is filled', async ({
    page,
  }) => {
    await startSession(page)
    await checkIn(page, SIX)
    const fill = async (team: 'Blue' | 'Orange', name: string) => {
      await court(page).getByRole('button', { name: `Fill open spot on ${team}` }).first().click()
      await page.getByRole('dialog', { name: `Fill the open spot · Court 1, ${team}` }).getByRole('button', { name: new RegExp(name) }).click()
    }
    await fill('Blue', 'Eve')
    await expect(court(page).getByText('Not started')).toBeVisible()
    await expect(court(page).getByRole('group', { name: 'Blue' }).getByText('Eve')).toBeVisible()
    await expect(court(page).getByRole('button', { name: 'Start game' })).toHaveCount(0)
    await expect(court(page)).toContainText('Fill every spot to start the game.')
    await fill('Blue', 'Fay')
    await fill('Orange', 'Ann')
    await fill('Orange', 'Bob')
    await expect(page.getByText('Bob is on Court 1. Ready to start.')).toBeVisible()
    await court(page).getByRole('button', { name: 'Start game' }).click()
    await expect(court(page).getByText('In play')).toBeVisible()
    for (const name of ['Eve', 'Fay', 'Ann', 'Bob']) await expect(court(page).getByText(name)).toBeVisible()
    expect(await queueNames(page)).toEqual(['Cy', 'Dee'])
  })

  /** A court team's spots top to bottom: each player's name, or null for an open spot. */
  const spots = async (page: Page, team: 'Blue' | 'Orange') => {
    const texts = await court(page).getByRole('group', { name: team }).locator('ul > li').allInnerTexts()
    return texts.map((text) => SIX.find((name) => text.includes(name)) ?? null)
  }

  test('removing a player keeps their spot where it was, and filling it puts the new player there', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
    const [top, bottom] = await spots(page, 'Blue')
    await playerAction(court(page), top!, 'Remove from court')
    await expect.poll(() => spots(page, 'Blue')).toEqual([null, bottom])
    await court(page).getByRole('button', { name: 'Fill open spot on Blue' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Fay/ }).click()
    await expect.poll(() => spots(page, 'Blue')).toEqual(['Fay', bottom])
  })

  test('on an open court, the spot tapped is the one filled', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await court(page).getByRole('button', { name: 'Fill open spot on Blue' }).last().click()
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await expect.poll(() => spots(page, 'Blue')).toEqual([null, 'Eve'])
    await court(page).getByRole('button', { name: 'Fill open spot on Blue' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Fay/ }).click()
    await expect.poll(() => spots(page, 'Blue')).toEqual(['Fay', 'Eve'])
  })

  test('a court being set up can be cleared', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await court(page).getByRole('button', { name: 'Fill open spot on Blue' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /Eve/ }).click()
    await court(page).getByRole('button', { name: 'Court menu' }).click()
    await page.getByRole('button', { name: 'Clear court' }).click()
    await expect(page.getByText('Court 1: cleared')).toBeVisible()
    await expect(court(page).getByText('Open', { exact: true })).toBeVisible()
    expect((await queueNames(page))[0]).toBe('Eve')
  })

  test('a player can be pinned into Next up, and the group forms around them', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy'])
    await openSpots(nextUp(page)).last().click()
    await page.getByRole('dialog').getByRole('button', { name: /Bob/ }).click()
    await expect(page.getByText('Bob is pinned to Next up.')).toBeVisible()
    await expect(nextUp(page).getByRole('group', { name: 'Orange' }).getByText('Bob')).toBeVisible()
    await expect(nextUp(page)).toContainText('Chosen by staff')

    await checkIn(page, ['Dee'])
    // Bob stays in the spot he was pinned to; the others fill in around him.
    expect(await nextUpTeams(page)).toEqual([
      ['Ann', 'Cy'],
      ['Dee', 'Bob'],
    ])
  })

  test('the Won button is a slim row across the bottom of its team', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    const team = court(page).getByRole('group', { name: 'Blue' })
    const box = (await team.boundingBox())!
    const won = (await team.getByRole('button', { name: 'Blue won' }).boundingBox())!
    const lastPlayer = (await team.locator('li').last().boundingBox())!
    expect(won.height).toBeLessThanOrEqual(40)
    expect(won.y).toBeGreaterThan(lastPlayer.y + lastPlayer.height - 1) // below the players
    expect(won.width).toBeGreaterThan(box.width - 24) // across the box
  })
})

test.describe('removing a player from the session', () => {
  const confirmRemove = async (page: Page, name: string) => {
    const dialog = page.getByRole('dialog', { name: `Remove ${name} from the session?` })
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  }

  test('from the Check-in list: they leave the queue and can be checked in again from the roster', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    await waitingAction(page, 'Fay', 'Remove from session')
    await expect(page.getByRole('dialog')).toContainText('They can be checked in again later.')
    await confirmRemove(page, 'Fay')
    await expect(page.getByText('Fay left the session.')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Fay' })).toBeVisible()
    await page.getByRole('tab', { name: 'Board' }).click()
    expect(await queueNames(page)).not.toContain('Fay')
  })

  test('from a court: their spot is left open and the game pauses', async ({ page }) => {
    await startSession(page)
    await checkIn(page, SIX)
    await startGame(page)
    await playerAction(court(page), 'Ann', 'Remove from session')
    await confirmRemove(page, 'Ann')
    await expect(page.getByText('Ann left the session. The game on Court 1 is paused until the spot is filled.')).toBeVisible()
    await expect(court(page).getByRole('button', { name: 'Fill open spot on Blue' })).toBeVisible()
    expect(await queueNames(page)).not.toContain('Ann')
  })
})
