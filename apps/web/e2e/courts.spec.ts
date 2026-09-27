import { expect, test, type Page } from '@playwright/test'
import { addCourt, checkIn, openSessionMenu, startGame, startSession, recordWin } from './helpers'

const EIGHT = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal']

/**
 * The courts as they appear on the board, top to bottom. Court cards set role="region"
 * themselves; selecting on the attribute keeps out the toast area, which is also a region.
 */
const courtOrder = (page: Page) =>
  page.locator('[role="region"]').evaluateAll((elements) => elements.map((el) => el.getAttribute('aria-label')))

/** Open the Manage courts dialog. */
async function manage(page: Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Manage courts' }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage courts' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function closeDialog(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test.describe('adding a court', () => {
  test('opens another court, and staff start it when ready', async ({ page }) => {
    await startSession(page)
    await checkIn(page, EIGHT)
    await startGame(page)
    await expect(page.getByText('1 court')).toBeVisible()
    await expect(page.getByText('Queue (4)')).toBeVisible()

    await addCourt(page)

    await expect(page.getByText('Court 2 added')).toBeVisible()
    await expect(page.getByText('2 courts')).toBeVisible()
    // The new court is open: the waiting players do not move onto it by themselves.
    const court2 = page.getByRole('region', { name: 'Court 2' })
    await expect(court2.getByText('Open')).toBeVisible()
    await expect(page.getByText('Queue (4)')).toBeVisible()

    await startGame(page, 'Court 2')
    for (const name of ['Eve', 'Fay', 'Gus', 'Hal']) await expect(court2.getByText(name)).toBeVisible()
    await expect(page.getByText('No one waiting')).toBeVisible()
  })

  test('leaves the new court open when nobody is waiting', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    await addCourt(page)
    const court2 = page.getByRole('region', { name: 'Court 2' })
    await expect(court2.getByText('Open')).toBeVisible()
    await expect(court2.getByRole('button', { name: 'Start game' })).toHaveCount(0)
  })

  test('stops at 15 courts', async ({ page }) => {
    await startSession(page, { courts: 15 })
    const dialog = await manage(page)
    await expect(dialog.getByRole('button', { name: 'Add court' })).toBeDisabled()
    await expect(dialog.getByText('Maximum of 15 courts')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close Court 15' }).click()
    await expect(dialog.getByRole('button', { name: 'Add court' })).toBeEnabled()
  })

  test('adding is only offered inside Manage courts, not on the Board', async ({ page }) => {
    await startSession(page)
    await expect(page.getByRole('button', { name: 'Add court' })).toHaveCount(0)
    const dialog = await manage(page)
    await dialog.getByRole('button', { name: 'Add court' }).click()
    await expect(dialog.getByLabel('Name of Court 2')).toBeVisible()
    await expect(page.getByText('Court 2 added')).toBeVisible()
  })

  test('reuses the lowest free number', async ({ page }) => {
    await startSession(page, { courts: 3 })
    const dialog = await manage(page)
    await dialog.getByRole('button', { name: 'Close Court 2' }).click()
    await closeDialog(page)
    expect(await courtOrder(page)).toEqual(['Court 1', 'Court 3'])

    await addCourt(page)
    await expect(page.getByText('Court 2 added')).toBeVisible()
    expect(await courtOrder(page)).toEqual(['Court 1', 'Court 3', 'Court 2'])
  })
})

test.describe('renaming a court', () => {
  test('changes the name everywhere', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    const dialog = await manage(page)
    const field = dialog.getByLabel('Name of Court 1')
    await field.fill('  Center Court ')
    await field.press('Enter')
    await expect(dialog.getByLabel('Name of Center Court')).toHaveValue('Center Court')
    await closeDialog(page)

    expect(await courtOrder(page)).toEqual(['Center Court', 'Court 2'])
    // The game in progress is untouched, and results use the new name.
    const court = page.getByRole('region', { name: 'Center Court' })
    await expect(court.getByText('Ann')).toBeVisible()
    await recordWin(page, 'Center Court')
    await expect(page.getByText('Center Court: Blue won')).toBeVisible()
  })

  test('explains why an empty or duplicate name is refused, and changes nothing', async ({ page }) => {
    await startSession(page, { courts: 2 })
    const dialog = await manage(page)
    const field = dialog.getByLabel('Name of Court 1')

    await field.fill('court 2')
    await field.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveText('Another court already has that name')

    await field.fill('   ')
    await field.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveText('Give the court a name')

    await field.fill('Fixed')
    await field.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await closeDialog(page)
    expect(await courtOrder(page)).toEqual(['Fixed', 'Court 2'])
  })

  test('limits names to 40 characters', async ({ page }) => {
    await startSession(page)
    const dialog = await manage(page)
    const field = dialog.getByLabel('Name of Court 1')
    await field.fill('x'.repeat(60))
    await expect(field).toHaveValue('x'.repeat(40))
  })
})

test.describe('reordering courts', () => {
  test('moves a court up and down, and the board follows', async ({ page }) => {
    await startSession(page, { courts: 3 })
    const dialog = await manage(page)
    await expect(dialog.getByRole('button', { name: 'Move Court 1 up' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Move Court 3 down' })).toBeDisabled()

    await dialog.getByRole('button', { name: 'Move Court 1 down' }).click()
    await closeDialog(page)
    expect(await courtOrder(page)).toEqual(['Court 2', 'Court 1', 'Court 3'])

    const again = await manage(page)
    await again.getByRole('button', { name: 'Move Court 3 up' }).click()
    await closeDialog(page)
    expect(await courtOrder(page)).toEqual(['Court 2', 'Court 3', 'Court 1'])
  })

  test('keeps a game on its court when the order changes', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page, 'Court 2')
    const dialog = await manage(page)
    await dialog.getByRole('button', { name: 'Move Court 2 up' }).click()
    await closeDialog(page)

    expect(await courtOrder(page)).toEqual(['Court 2', 'Court 1'])
    await expect(page.getByRole('region', { name: 'Court 2' }).getByText('In play')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Court 1' }).getByText('Open')).toBeVisible()
  })
})

test.describe('closing a court', () => {
  test('closes an empty court straight away', async ({ page }) => {
    await startSession(page, { courts: 2 })
    const dialog = await manage(page)
    await dialog.getByRole('button', { name: 'Close Court 2' }).click()
    await expect(page.getByText('Court 2 closed')).toBeVisible()
    await closeDialog(page)
    await expect(page.getByText('1 court')).toBeVisible()
    expect(await courtOrder(page)).toEqual(['Court 1'])
  })

  test('never closes the last court', async ({ page }) => {
    await startSession(page)
    const dialog = await manage(page)
    await expect(dialog.getByRole('button', { name: 'Close Court 1' })).toBeDisabled()
  })

  test('asks before cancelling a game, and only cancels when confirmed', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page) // Court 1 plays, Court 2 is open
    const dialog = await manage(page)

    await dialog.getByRole('button', { name: 'Close Court 1' }).click()
    const confirm = dialog.getByRole('group', { name: 'Confirm closing Court 1' })
    await expect(confirm).toContainText('Cancel the game and close Court 1?')

    // Changing my mind leaves everything as it was.
    await confirm.getByRole('button', { name: 'Keep court' }).click()
    await expect(confirm).toHaveCount(0)
    await closeDialog(page)
    await expect(page.getByRole('region', { name: 'Court 1' }).getByText('In play')).toBeVisible()

    // Confirming closes it, and the four players go back to the queue.
    const again = await manage(page)
    await again.getByRole('button', { name: 'Close Court 1' }).click()
    await again.getByRole('button', { name: 'Cancel game and close' }).click()
    await expect(page.getByText('Court 1 closed')).toBeVisible()
    await closeDialog(page)

    expect(await courtOrder(page)).toEqual(['Court 2'])
    await expect(page.getByRole('region', { name: 'Court 2' }).getByText('Open')).toBeVisible()
    await expect(page.getByText('1 court')).toBeVisible()
    await expect(page.getByText('Queue (4)')).toBeVisible()
    const nextUp = page.getByRole('group', { name: 'Next up' })
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp.getByText(name)).toBeVisible()
  })

  test('puts a cancelled game’s players first in the queue when no court is free', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, [...EIGHT, 'Ivy'])
    await startGame(page, 'Court 1')
    await startGame(page, 'Court 2') // both courts busy, Ivy waits
    const dialog = await manage(page)
    await dialog.getByRole('button', { name: 'Close Court 1' }).click()
    await dialog.getByRole('button', { name: 'Cancel game and close' }).click()
    await closeDialog(page)

    await expect(page.getByText('Queue (5)')).toBeVisible()
    const first = page.getByRole('listitem').filter({ hasText: /^1/ }).first()
    await expect(first).toContainText(/Ann|Bob|Cy|Dee/)
    await expect(page.getByRole('listitem').filter({ hasText: /^5.*Ivy/ })).toBeVisible()
  })
})

test('keeps names and order after a reload', async ({ page }) => {
  await startSession(page, { courts: 3 })
  const dialog = await manage(page)
  const field = dialog.getByLabel('Name of Court 3')
  await field.fill('Center Court')
  await field.press('Enter')
  await dialog.getByRole('button', { name: 'Move Center Court up' }).click()
  await dialog.getByRole('button', { name: 'Move Center Court up' }).click()
  await closeDialog(page)
  expect(await courtOrder(page)).toEqual(['Center Court', 'Court 1', 'Court 2'])

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Test Club' })).toBeVisible()
  expect(await courtOrder(page)).toEqual(['Center Court', 'Court 1', 'Court 2'])
})

test.describe('court layout', () => {
  /** Each court's box, in board order. */
  async function courtBoxes(page: Page, count: number) {
    const boxes = []
    for (let i = 1; i <= count; i++) boxes.push((await page.getByRole('region', { name: `Court ${i}`, exact: true }).boundingBox())!)
    return boxes
  }

  for (const count of [1, 2, 4, 5]) {
    test(`${count} court${count === 1 ? '' : 's'} fill the width in balanced rows, all the same size`, async ({ page }) => {
      await startSession(page, { courts: count })
      const boxes = await courtBoxes(page, count)
      const left = Math.min(...boxes.map((b) => b.x))
      const right = Math.max(...boxes.map((b) => b.x + b.width))
      const rows = new Map<number, typeof boxes>()
      for (const box of boxes) rows.set(Math.round(box.y), [...(rows.get(Math.round(box.y)) ?? []), box])
      const widest = Math.max(...[...rows.values()].map((row) => row.length))
      for (const row of rows.values()) {
        // Every court is the same width, whichever row it is in.
        for (const box of row) expect(box.width).toBeCloseTo(boxes[0].width, 0)
        const rowLeft = Math.min(...row.map((b) => b.x))
        const rowRight = Math.max(...row.map((b) => b.x + b.width))
        if (row.length === widest) {
          // A full row reaches from the board's left edge to its right edge.
          expect(rowLeft).toBeCloseTo(left, 0)
          expect(rowRight).toBeCloseTo(right, 0)
        } else {
          // A shorter row sits centred under it.
          expect(rowLeft - left).toBeCloseTo(right - rowRight, 0)
        }
      }
      const perRow = [...rows.values()].map((row) => row.length)
      const wide = page.viewportSize()!.width >= 1024
      if (count === 4 && wide) expect(perRow).toEqual([2, 2])
      if (count === 5 && wide) expect(perRow).toEqual([3, 2])
      if (!wide && page.viewportSize()!.width < 640) expect(perRow.every((n) => n === 1)).toBe(true)
    })
  }
})

test.describe('skill levels per court', () => {
  const LEVEL = {
    1: '1 · Beginner (NR / < 2.50)',
    2: '2 · Novice (2.50–2.99)',
    3: '3 · Low Intermediate (3.00–3.49)',
    4: '4 · Intermediate (3.50–3.99)',
    5: '5 · Advanced (4.00–4.49)',
    6: '6 · Elite / Pro (4.50+)',
  } as const

  /** Set a court's lowest and highest level in Manage courts (the dialog must be open). */
  async function setLevels(page: Page, court: string, lowest: string, highest: string) {
    const dialog = page.getByRole('dialog', { name: 'Manage courts' })
    await dialog.getByLabel(`Lowest level for ${court}`).click()
    await page.getByRole('option', { name: lowest, exact: true }).click()
    await dialog.getByLabel(`Highest level for ${court}`).click()
    await page.getByRole('option', { name: highest, exact: true }).click()
  }

  test('each court starts games only from players in its range', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await manage(page)
    await setLevels(page, 'Court 1', '3.50–3.99 · Intermediate', '4.50+ · Elite / Pro')
    await setLevels(page, 'Court 2', 'NR / < 2.50 · Beginner', '3.00–3.49 · Low Intermediate')
    await closeDialog(page)

    await checkIn(page, [
      { name: 'Ann', skill: LEVEL[5] },
      { name: 'Bob', skill: LEVEL[2] },
      { name: 'Cy', skill: LEVEL[6] },
      { name: 'Dee', skill: LEVEL[1] },
      { name: 'Eve', skill: LEVEL[4] },
      { name: 'Fay', skill: LEVEL[3] },
      { name: 'Gus', skill: LEVEL[5] },
      { name: 'Hal', skill: LEVEL[2] },
    ])

    const court1 = page.getByRole('region', { name: 'Court 1' })
    const court2 = page.getByRole('region', { name: 'Court 2' })
    await expect(court1.getByRole('img', { name: 'Skill levels: 3.50+' })).toBeVisible()
    await expect(court2.getByRole('img', { name: 'Skill levels: Up to 3.49' })).toBeVisible()
    for (const name of ['Ann', 'Cy', 'Eve', 'Gus']) await expect(court1).toContainText(name)
    for (const name of ['Bob', 'Dee', 'Fay', 'Hal']) await expect(court2).toContainText(name)

    // The Next up card lists one group per level.
    const nextUp = page.getByRole('group', { name: 'Next up' })
    await expect(nextUp.getByRole('region', { name: '3.50+' })).toContainText('Ann')
    await expect(nextUp.getByRole('region', { name: 'Up to 3.49' })).toContainText('Bob')

    await startGame(page, 'Court 2')
    for (const name of ['Bob', 'Dee', 'Fay', 'Hal']) {
      await expect(court2.getByRole('group', { name: /^(Blue|Orange)$/ }).filter({ hasText: name })).toHaveCount(1)
    }
    await startGame(page, 'Court 1')
    await expect(page.getByText('Queue (0)')).toBeVisible()

    // The ranges are part of the session: they survive a reload.
    await page.reload()
    await expect(court1.getByRole('img', { name: 'Skill levels: 3.50+' })).toBeVisible()
  })

  test('a court waits for players in its range, and staff can start it with anyone', async ({ page }) => {
    await startSession(page, { courts: 1 })
    // Every court shows its setting, including one open to everyone.
    await expect(page.getByRole('region', { name: 'Court 1' }).getByRole('img', { name: 'Skill levels: All levels' })).toBeVisible()
    await manage(page)
    await setLevels(page, 'Court 1', '3.50–3.99 · Intermediate', '4.50+ · Elite / Pro')
    await closeDialog(page)
    await checkIn(page, [
      { name: 'Ann', skill: LEVEL[5] },
      { name: 'Bob', skill: LEVEL[2] },
      { name: 'Cy', skill: LEVEL[6] },
      { name: 'Dee', skill: LEVEL[1] },
    ])

    const court = page.getByRole('region', { name: 'Court 1' })
    await expect(court).toContainText('Waiting for 2 more players at 3.50+.')
    await expect(court.getByRole('button', { name: 'Start game' })).toHaveCount(0)
    await court.getByRole('button', { name: 'Start with waiting players' }).click()
    await expect(court.getByText('In play')).toBeVisible()
  })
})

test.describe('the court card menu', () => {
  const court = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
  const menuItem = (page: Page, item: string) =>
    page.locator('[data-slot="popover-content"]').getByRole('button', { name: item })

  async function courtAction(page: Page, name: string, item: string) {
    await court(page, name).getByRole('button', { name: 'Court menu' }).click()
    await menuItem(page, item).click()
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0)
  }

  test('renames a court, and keeps the typed name when it is taken', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await courtAction(page, 'Court 1', 'Rename…')
    const dialog = page.getByRole('dialog', { name: 'Rename Court 1' })
    await dialog.getByLabel('Court name').fill('Court 2')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(dialog.getByLabel('Court name')).toHaveValue('Court 2')
    await dialog.getByLabel('Court name').fill('Center')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0)
    expect(await courtOrder(page)).toEqual(['Center', 'Court 2'])
  })

  test('keeps a court for skill levels', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await courtAction(page, 'Court 2', 'Skill levels…')
    const dialog = page.getByRole('dialog', { name: 'Skill levels for Court 2' })
    await dialog.getByLabel('Lowest level for Court 2').click()
    await page.getByRole('option', { name: '3.50–3.99 · Intermediate', exact: true }).click()
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(court(page, 'Court 2').getByRole('img', { name: 'Skill levels: 3.50+' })).toBeVisible()
    await expect(court(page, 'Court 1').getByRole('img', { name: 'Skill levels: All levels' })).toBeVisible()
  })

  test('moves a court up and down the board', async ({ page }) => {
    await startSession(page, { courts: 3 })
    await court(page, 'Court 1').getByRole('button', { name: 'Court menu' }).click()
    await expect(menuItem(page, 'Move up')).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0)
    await courtAction(page, 'Court 3', 'Move up')
    expect(await courtOrder(page)).toEqual(['Court 1', 'Court 3', 'Court 2'])
    await courtAction(page, 'Court 1', 'Move down')
    expect(await courtOrder(page)).toEqual(['Court 3', 'Court 1', 'Court 2'])
  })

  test('closes an open court at once, and asks before closing a game in progress', async ({ page }) => {
    await startSession(page, { courts: 3 })
    await courtAction(page, 'Court 3', 'Close court')
    await expect(page.getByText('Court 3 closed')).toBeVisible()
    expect(await courtOrder(page)).toEqual(['Court 1', 'Court 2'])

    await checkIn(page, EIGHT.slice(0, 4))
    await startGame(page)
    await courtAction(page, 'Court 1', 'Close court')
    const dialog = page.getByRole('dialog', { name: 'Close Court 1?' })
    await dialog.getByRole('button', { name: 'Cancel game and close' }).click()
    expect(await courtOrder(page)).toEqual(['Court 2'])
    await expect(page.getByText('Queue (4)')).toBeVisible()

    await court(page, 'Court 2').getByRole('button', { name: 'Court menu' }).click()
    await expect(menuItem(page, 'Close court')).toBeDisabled()
    await expect(menuItem(page, 'Close court')).toContainText('A session needs at least one court')
  })
})
