import { expect, test, type Page } from '@playwright/test'
import { queueRow } from './avatarHelpers'
import { checkIn, openSessionMenu, startGame, startSession, recordWin, playerAction } from './helpers'

const FIVE = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve']

test('starts a session with the chosen courts and mode', async ({ page }) => {
  await startSession(page, { location: 'Downtown', courts: 3, mode: 'Singles' })
  await expect(page.getByText('Singles', { exact: true })).toBeVisible()
  await expect(page.getByText('3 courts')).toBeVisible()
  await expect(page.getByRole('region', { name: /Court \d/ })).toHaveCount(3)
  await expect(page.getByText('No one waiting')).toBeVisible()
})

test('does not start a game by itself, and shows who is next up', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)

  const court = page.getByRole('region', { name: 'Court 1' })
  await expect(court.getByText('Open')).toBeVisible()
  await expect(court.getByText('In play')).toHaveCount(0)
  await expect(page.getByText('Queue (5)')).toBeVisible()

  // Next up is the first four, already split into teams; the fifth keeps waiting.
  const nextUp = page.getByRole('group', { name: 'Next up' })
  await expect(nextUp.getByRole('group', { name: 'Blue' })).toBeVisible()
  await expect(nextUp.getByRole('group', { name: 'Orange' })).toBeVisible()
  await expect(nextUp.getByText('Eve')).toHaveCount(0)
  for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp.getByText(name)).toBeVisible()
  await expect(page.getByText('Next up', { exact: true })).toHaveCount(5) // card title + four queue badges
})

test('lists Next up right above the Queue, below the courts', async ({ page }) => {
  await startSession(page, { courts: 2 })
  await checkIn(page, FIVE)

  const top = async (locator: ReturnType<Page['locator']>) => (await locator.boundingBox())!.y
  const court2 = await top(page.getByRole('region', { name: 'Court 2' }))
  const nextUp = await top(page.getByRole('group', { name: 'Next up' }))
  const queue = await top(page.getByText(/^Queue \(/))
  expect(court2).toBeLessThan(nextUp)
  expect(nextUp).toBeLessThan(queue)

  // Nothing sits between the two cards: Next up ends where the Queue begins (one gap apart).
  const nextUpBox = (await page.getByRole('group', { name: 'Next up' }).boundingBox())!
  const queueCard = page.getByText(/^Queue \(/).locator('xpath=ancestor::*[@data-slot="card"][1]')
  const queueBox = (await queueCard.boundingBox())!
  expect(queueBox.y - (nextUpBox.y + nextUpBox.height)).toBeLessThan(40)
})

test('starts the next four on the court and queues the extra player', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)

  const court = page.getByRole('region', { name: 'Court 1' })
  await expect(page.getByText('Court 1 started')).toBeVisible()
  await expect(court.getByRole('group', { name: 'Blue' })).toBeVisible()
  await expect(court.getByRole('group', { name: 'Orange' })).toBeVisible()
  await expect(court.getByText('Eve')).toHaveCount(0)
  await expect(page.getByText('Queue (1)')).toBeVisible()
  // The only court is busy, so the waiting player sees how long they have been waiting.
  await expect(queueRow(page, 'Eve')).toContainText(/\d+s$/)
  // Only Eve is left, so nobody is next up until someone else checks in.
  await expect(page.getByRole('group', { name: 'Next up' }).getByText('Waiting for 3 more players.')).toBeVisible()
})

test('records a result, leaves the court open and undoes it', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)
  const court = page.getByRole('region', { name: 'Court 1' })

  await recordWin(page)
  await expect(page.getByText('Court 1: Blue won')).toBeVisible()
  // Nothing starts by itself: the court is open, and everyone is queued with Eve first.
  await expect(court.getByText('Open')).toBeVisible()
  await expect(page.getByText('Queue (5)')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Next up' }).getByText('Eve')).toBeVisible()

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(court.getByText('In play')).toBeVisible()
  await expect(page.getByText('Queue (1)')).toBeVisible()
})

test.describe('cancelling a game', () => {
  async function playingCourt(page: Page) {
    await startSession(page)
    await checkIn(page, FIVE)
    await startGame(page)
    const court = page.getByRole('region', { name: 'Court 1', exact: true })
    await court.getByRole('button', { name: 'Court menu' }).click()
    await page.getByRole('button', { name: 'Cancel game' }).click()
    const dialog = page.getByRole('dialog', { name: 'Cancel this game?' })
    await expect(dialog).toBeVisible()
    return { court, dialog }
  }

  test('asks first, and says what will happen', async ({ page }) => {
    const { court, dialog } = await playingCourt(page)
    await expect(dialog).toContainText('Court 1')
    await expect(dialog).toContainText('no result, score or time is recorded')
    await expect(dialog).toContainText('4 players go back to the front of the queue')
    // Nothing has happened behind it.
    await page.keyboard.press('Escape')
    await expect(court.getByText('In play')).toBeVisible()
    await expect(page.getByText('Queue (1)')).toBeVisible()
  })

  test('Keep playing, Escape and clicking outside all leave the game alone', async ({ page }) => {
    const { court, dialog } = await playingCourt(page)
    await dialog.getByRole('button', { name: 'Keep playing' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(court.getByText('In play')).toBeVisible()

    await court.getByRole('button', { name: 'Court menu' }).click()
    await page.getByRole('button', { name: 'Cancel game' }).click()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(court.getByText('In play')).toBeVisible()

    await court.getByRole('button', { name: 'Court menu' }).click()
    await page.getByRole('button', { name: 'Cancel game' }).click()
    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } })
    await expect(dialog).toHaveCount(0)
    await expect(court.getByText('In play')).toBeVisible()
    await expect(page.getByText('Court 1: game cancelled')).toHaveCount(0)
  })

  test('confirming empties the court and puts the players first in the queue, recording nothing', async ({ page }) => {
    const { court, dialog } = await playingCourt(page)
    await dialog.getByRole('button', { name: 'Cancel game' }).click()

    await expect(page.getByText('Court 1: game cancelled')).toBeVisible()
    await expect(court.getByText('Open')).toBeVisible()
    await expect(page.getByText('Queue (5)')).toBeVisible()
    // The four who were playing are next up again; Eve is still last in line.
    const nextUp = page.getByRole('group', { name: 'Next up' })
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp.getByText(name)).toBeVisible()
    await expect(nextUp.getByText('Eve')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Standings' }).click()
    await expect(page.getByText('No games played yet.')).toBeVisible()
  })

  test('offers no undo afterwards', async ({ page }) => {
    const { dialog } = await playingCourt(page)
    await dialog.getByRole('button', { name: 'Cancel game' }).click()
    await expect(page.getByText('Court 1: game cancelled')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  })
})

test('sends the next group to whichever court staff choose', async ({ page }) => {
  await startSession(page, { courts: 2 })
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Flo', 'Gus', 'Hal'])

  await startGame(page, 'Court 2')
  await expect(page.getByRole('region', { name: 'Court 1' }).getByText('Open')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Court 2' }).getByText('Ann')).toBeVisible()
  // Next up has moved on to the following four.
  const nextUp = page.getByRole('group', { name: 'Next up' })
  await expect(nextUp.getByText('Eve')).toBeVisible()
  await expect(nextUp.getByText('Ann')).toHaveCount(0)

  await startGame(page, 'Court 1')
  await expect(page.getByText('No one waiting')).toBeVisible()
})

test('skips a player on a break when choosing who is next up', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await page.getByRole('listitem').filter({ hasText: 'Ann' }).getByRole('button', { name: 'Take a break' }).click()
  await page.getByRole('tab', { name: 'Board' }).click()

  const nextUp = page.getByRole('group', { name: 'Next up' })
  await expect(nextUp.getByText('Ann')).toHaveCount(0)
  await expect(nextUp.getByText('Eve')).toBeVisible()
})

test('refuses to undo once the session has changed', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)

  await recordWin(page, 'Court 1', 'B')
  await expect(page.getByText('Court 1: Orange won')).toBeVisible()
  await checkIn(page, ['Flo'])

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText("Can't undo: the session changed after that result")).toBeVisible()
  await expect(page.getByText('Queue (6)')).toBeVisible()
})

test('lets a waiting player take a break and come back', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)

  await page.getByRole('tab', { name: 'Check-in' }).click()
  await page.getByRole('button', { name: 'Take a break' }).click()
  await expect(page.getByText('On a break (1)')).toBeVisible()
  await expect(page.getByText('No one is waiting.')).toBeVisible()

  await page.getByRole('button', { name: 'Back to queue' }).click()
  await expect(page.getByText('On a break')).toHaveCount(0)
  await expect(page.getByText('Waiting (1) · Playing (4)')).toBeVisible()
})

test('sends a waiting player on a break from the Board queue\'s menu', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)

  await expect(page.getByText('Queue (1)')).toBeVisible()
  await page.getByRole('button', { name: 'Eve menu' }).click()
  await page.getByRole('button', { name: 'Take a break' }).click()
  await expect(page.getByText('Queue (0)')).toBeVisible()

  await page.getByRole('tab', { name: 'Check-in' }).click()
  await expect(page.getByText('On a break (1)')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Eve' }).getByRole('button', { name: 'Back to queue' })).toBeVisible()
})

test('removes a waiting player from the session from the Board queue\'s menu', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)

  await expect(page.getByText('Queue (1)')).toBeVisible()
  await page.getByRole('button', { name: 'Eve menu' }).click()
  await page.getByRole('button', { name: 'Remove from session' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Eve from the session?' })
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.getByText('Eve left the session.')).toBeVisible()
  await expect(page.getByText('Queue (0)')).toBeVisible()

  await page.getByRole('tab', { name: 'Check-in' }).click()
  await expect(page.getByText('On a break')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Eve' })).toBeVisible()
})

test('saves the chosen skill level', async ({ page }) => {
  await startSession(page)
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await page.getByLabel('Player name').fill('Zed')
  await page.getByLabel('Skill level').click()
  await page.getByRole('option', { name: '5 · Advanced' }).click()
  await page.getByRole('button', { name: 'Check in', exact: true }).click()

  await expect(page.getByText('Zed checked in')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Zed' }).getByText('Advanced')).toBeVisible()
})

test('offers the six skill levels with their official ratings', async ({ page }) => {
  await startSession(page)
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await page.getByLabel('Skill level').click()
  const options = page.getByRole('option')
  await expect(options).toHaveText([
    '1 · Beginner (1.0)',
    '2 · Novice (2.0-2.5)',
    '3 · Intermediate (3.0)',
    '4 · Upper Intermediate (3.5)',
    '5 · Advanced (4.0-4.5)',
    '6 · Expert (5.0+)',
  ])
  await expect(page.getByText('Advanced Beginner')).toHaveCount(0)
})

test('replaces a playing player with someone waiting', async ({ page }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)
  const court = page.getByRole('region', { name: 'Court 1' })
  await expect(court.getByText('Ann')).toBeVisible()

  await playerAction(court, 'Ann', 'Swap…')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Replace Ann')).toBeVisible()
  await dialog.getByRole('button', { name: /Eve/ }).click()

  await expect(page.getByText('Eve replaced Ann. Ann is first in the queue.')).toBeVisible()
  await expect(court.getByText('Eve')).toBeVisible()
  await expect(court.getByText('Ann')).toHaveCount(0)
  // Nobody went on a break: Ann is waiting, first in line.
  await page.getByRole('tab', { name: 'Check-in' }).click()
  await expect(page.getByText('On a break')).toHaveCount(0)
  await expect(page.getByText('Waiting (1) · Playing (4)')).toBeVisible()
})

test('with nobody waiting, offers the others on the court so players can change sides', async ({ page }) => {
  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
  await startGame(page)
  await playerAction(page, 'Ann', 'Swap…')
  const dialog = page.getByRole('dialog', { name: 'Replace Ann' })
  await expect(dialog.getByRole('button', { name: /Bob|Cy|Dee/ })).toHaveCount(3)
  await expect(dialog.getByRole('button', { name: /Cy/ })).toContainText('On this court')
})

test('uses the game length from setup and lets it be changed', async ({ page }) => {
  await startSession(page, { gameMinutes: 20 })
  await checkIn(page, FIVE)
  await startGame(page)

  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Manage courts' }).click()
  await expect(page.getByLabel('Game length (min)')).toHaveValue('20')
  await page.getByLabel('Game length (min)').fill('30')
  await page.keyboard.press('Escape')

  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Manage courts' }).click()
  await expect(page.getByLabel('Game length (min)')).toHaveValue('30')
})

test('keeps the session after a reload', async ({ page }) => {
  await startSession(page, { location: 'Persistent Club' })
  await checkIn(page, FIVE)
  await startGame(page)

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Persistent Club' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Court 1' }).getByText('In play')).toBeVisible()
  await expect(page.getByText('Queue (1)')).toBeVisible()
})

test('keeps working offline', async ({ page, context }) => {
  await startSession(page)
  await checkIn(page, FIVE)
  await startGame(page)

  await context.setOffline(true)
  await recordWin(page)
  await expect(page.getByText('Court 1: Blue won')).toBeVisible()
})

test.describe('the End session dialog', () => {
  async function withResults(page: Page, width: number) {
    await page.setViewportSize({ width, height: 800 })
    await startSession(page, { mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob'])
    await startGame(page)
    await recordWin(page)
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    const dialog = page.getByRole('dialog', { name: 'End this session?' })
    await expect(dialog).toBeVisible()
    return dialog
  }

  for (const width of [1280, 375]) {
    test(`fits its content without anything overlapping at ${width}px wide`, async ({ page }) => {
      const dialog = await withResults(page, width)
      const box = (await dialog.boundingBox())!
      if (width >= 640) expect(box.width).toBeGreaterThanOrEqual(480)

      const names = ['Save and end session', 'Keep playing']
      const boxes = []
      for (const name of names) {
        const button = dialog.getByRole('button', { name, exact: true })
        await expect(button).toBeVisible()
        boxes.push((await button.boundingBox())!)
      }
      for (const b of boxes) {
        // Inside the dialog, never clipped at either side.
        expect(b.x).toBeGreaterThanOrEqual(box.x)
        expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width)
      }
      // Stacked in order, with no two buttons touching.
      for (let i = 1; i < boxes.length; i++) {
        expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height)
      }

      // The description and podium rows stay inside the dialog too.
      const rows = dialog.getByRole('listitem')
      await expect(rows).toHaveCount(2)
      for (const row of await rows.all()) {
        const r = (await row.boundingBox())!
        expect(r.x + r.width).toBeLessThanOrEqual(box.x + box.width)
        await expect(row.getByText(/^\dW \dL$/)).toBeVisible()
      }
    })
  }

  test('still ends the session from the stacked buttons', async ({ page }) => {
    const dialog = await withResults(page, 1280)
    await dialog.getByRole('button', { name: 'Save and end session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()
  })
})

test('ends the session after confirming', async ({ page }) => {
  await startSession(page)
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'End session' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('End this session?')).toBeVisible()
  await dialog.getByRole('button', { name: 'End session' }).click()

  await expect(page.getByText('Set up an open play session')).toBeVisible()
})

test('renames the session from the session menu, and keeps the new name after a reload', async ({ page }) => {
  await startSession(page, { location: 'Tuesdya' })
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Rename session' }).click()

  const dialog = page.getByRole('dialog', { name: 'Rename session' })
  const field = dialog.getByLabel('Session name')
  await expect(field).toHaveValue('Tuesdya')
  await field.fill('   ')
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled()
  await field.fill('Tuesday open play')
  await field.press('Enter')
  await expect(dialog).toHaveCount(0)

  await expect(page.getByRole('heading', { name: 'Tuesday open play' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Tuesday open play' })).toBeVisible()
})
