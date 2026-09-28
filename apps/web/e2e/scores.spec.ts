import { expect, test, type Locator, type Page } from '@playwright/test'
import { queueRow } from './avatarHelpers'
import { cancelGame, checkIn, openSessionMenu, recordWin, startGame, startSession, teamName } from './helpers'

// Standings columns: 0 rank, 1 player, 2 GP, 3 W, 4 L, 5 Win %, 6 +/-, 7 Opp., 8 Time, 9 share.
const DIFF = 6
const TIME = 8

const court = (page: Page, name = 'Court 1') => page.getByRole('region', { name, exact: true })

/** Finish the game on a court with this score. Whoever scored more won. */
async function enterScore(page: Page, scoreA: number, scoreB: number, courtName = 'Court 1') {
  await recordWin(page, courtName, scoreA > scoreB ? 'A' : 'B', [scoreA, scoreB])
}

/** Press a winner button and leave the score pop-up open. */
async function openScorePopup(page: Page, winner: 'A' | 'B' = 'A', courtName = 'Court 1') {
  await court(page, courtName).getByRole('button', { name: `${teamName(winner)} won` }).click()
  const dialog = page.getByRole('dialog', { name: `${teamName(winner)} won` })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Singles on one court: Ann is Blue, Bob is Orange. */
async function startSingles(page: Page, options: { courts?: number; players?: string[] } = {}) {
  await startSession(page, { mode: 'Singles', courts: options.courts ?? 1 })
  await checkIn(page, options.players ?? ['Ann', 'Bob'])
  await startGame(page)
}

const openStandings = (page: Page) => page.getByRole('tab', { name: 'Standings' }).click()
const cell = (row: Locator, index: number) => row.getByRole('cell').nth(index)

test.describe('match log', () => {
  test('a finished game is listed in Matches below the queue, and undo removes it', async ({ page }) => {
    await startSingles(page)
    const matches = page.getByRole('group', { name: 'Matches' })
    await expect(matches).toContainText('No games finished yet')

    await enterScore(page, 4, 11)
    await expect(matches).toContainText('Matches (1)')
    await expect(matches).toContainText('Court 1')
    await expect(matches).toContainText('Bob')
    await expect(matches).toContainText('Ann')
    await expect(matches).toContainText('11')
    await expect(matches).toContainText('4')

    // It sits at the very bottom of the Board, after the Queue.
    const queueY = (await page.getByText('Queue (2)').boundingBox())!.y
    expect((await matches.boundingBox())!.y).toBeGreaterThan(queueY)

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(matches).toContainText('Matches (0)')
  })

  test('editing a match\'s score corrects the log and the standings', async ({ page }) => {
    await startSingles(page)
    await enterScore(page, 11, 4) // Ann beats Bob 11-4
    const matches = page.getByRole('group', { name: 'Matches' })

    await page.getByRole('button', { name: 'Match 1 menu' }).click()
    await page.getByRole('button', { name: 'Edit score' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit score' })
    await dialog.getByLabel('Blue score').fill('8')
    await dialog.getByLabel('Orange score').fill('11')
    await dialog.getByRole('button', { name: 'Save score' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(matches).toContainText('8')
    await expect(matches).toContainText('11')

    await openStandings(page)
    const rows = page.getByRole('table').first().getByRole('row')
    await expect(rows.nth(1)).toContainText('Bob')
    await expect(rows.nth(1)).toContainText('Gold medal')
    await expect(cell(rows.nth(1), DIFF)).toHaveText('+3')
    await expect(rows.nth(2)).toContainText('Ann')
    await expect(cell(rows.nth(2), DIFF)).toHaveText('-3')
  })

  test('editing a match\'s players moves the win\'s credit to the new player', async ({ page }) => {
    await startSession(page, { mode: 'Doubles', courts: 1 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    await startGame(page)
    await recordWin(page) // Ann & Bob beat Cy & Dee, 11-5
    const matches = page.getByRole('group', { name: 'Matches' })
    await expect(matches).toContainText('Bob')

    await page.getByRole('button', { name: 'Match 1 menu' }).click()
    await page.getByRole('button', { name: 'Edit players' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit players' })
    await dialog.getByRole('combobox').filter({ hasText: 'Bob' }).click()
    await page.getByRole('option', { name: 'Eve' }).click()
    await dialog.getByRole('button', { name: 'Save players' }).click()
    await expect(dialog).toHaveCount(0)

    await expect(matches).toContainText('Eve')
    await expect(matches).not.toContainText('Bob')

    await openStandings(page)
    // Bob is no longer in the match at all, so he drops out of the standings entirely; Eve
    // (who now stands in for him) picks up the win instead.
    const rankings = page.getByRole('table').first().getByRole('row')
    await expect(rankings.filter({ hasText: 'Eve' })).toContainText('Gold medal')
    await expect(rankings.filter({ hasText: 'Bob' })).toHaveCount(0)
  })
})

test.describe('entering a score', () => {
  test('the higher score wins, the court opens and the toast says the score', async ({ page }) => {
    await startSingles(page)
    await enterScore(page, 11, 7)

    await expect(page.getByText('Court 1: Blue won 11–7')).toBeVisible()
    await expect(court(page).getByText('Open')).toBeVisible()
    // Both players wait for the next game, the winner first.
    await page.getByRole('tab', { name: 'Board' }).click()
    await expect(page.getByText('Queue (2)')).toBeVisible()

    await openStandings(page)
    const rows = page.getByRole('row')
    await expect(rows.nth(1)).toContainText('Ann')
    await expect(cell(rows.nth(1), 3)).toHaveText('1') // wins
    await expect(cell(rows.nth(1), DIFF)).toHaveText('+4')
    await expect(rows.nth(2)).toContainText('Bob')
    await expect(cell(rows.nth(2), DIFF)).toHaveText('-4')
  })

  test('a winner button asks for the score before anything is recorded', async ({ page }) => {
    await startSingles(page)
    const dialog = await openScorePopup(page, 'B')
    await expect(dialog).toContainText('Court 1')
    await expect(dialog).toContainText("Orange's score starts at 11 and must be the higher one")
    // Nothing is recorded yet: the game is still on the court.
    await expect(page.getByText('Court 1: Orange won')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(court(page).getByText('In play')).toBeVisible()
    // There is no other way to finish a game.
    await expect(court(page).getByRole('button', { name: 'Enter score' })).toHaveCount(0)
  })

  test('closing the pop-up records nothing and leaves the game in play', async ({ page }) => {
    await startSingles(page)
    const dialog = await openScorePopup(page)
    await dialog.getByLabel('Blue score').fill('11')
    await dialog.getByLabel('Orange score').fill('4')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(court(page).getByText('In play')).toBeVisible()
    await openStandings(page)
    await expect(page.getByText('No games played yet.')).toBeVisible()
  })

  test('refuses a score that gives the win to the other team, and says why', async ({ page }) => {
    await startSingles(page)
    let dialog = await openScorePopup(page, 'A')
    const submit = dialog.getByRole('button', { name: 'Record score' })
    await dialog.getByLabel('Blue score').fill('4')
    await dialog.getByLabel('Orange score').fill('11')
    await expect(dialog.getByRole('alert')).toHaveText('Blue won, so their score must be higher.')
    await expect(submit).toBeDisabled()
    await dialog.getByLabel('Blue score').fill('12')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(submit).toBeEnabled()
    await page.keyboard.press('Escape')

    dialog = await openScorePopup(page, 'B')
    await dialog.getByLabel('Blue score').fill('11')
    await dialog.getByLabel('Orange score').fill('4')
    await expect(dialog.getByRole('alert')).toHaveText('Orange won, so their score must be higher.')
    await expect(dialog.getByRole('button', { name: 'Record score' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(court(page).getByText('In play')).toBeVisible()
  })

  test('the winner button decides who won, and the score records the points', async ({ page }) => {
    await startSingles(page)
    const dialog = await openScorePopup(page, 'B')
    await dialog.getByLabel('Blue score').fill('6')
    await dialog.getByLabel('Orange score').fill('11')
    await dialog.getByRole('button', { name: 'Record score' }).click()
    await expect(page.getByText('Court 1: Orange won 11–6')).toBeVisible()
  })

  test('Record sits beside the score being typed, so a phone keyboard never hides it; Enter records too', async ({ page }) => {
    await startSingles(page)
    let dialog = await openScorePopup(page, 'B')
    // Orange won: Blue's score is typed, at the top.
    await expect(dialog.getByLabel('Blue score')).toBeFocused()
    await expect(dialog.getByRole('group', { name: 'Blue' }).getByRole('button', { name: 'Record score' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Record score' })).toHaveCount(1)
    await page.keyboard.press('Escape')

    dialog = await openScorePopup(page, 'A')
    await expect(dialog.getByLabel('Orange score')).toBeFocused()
    await expect(dialog.getByRole('group', { name: 'Orange' }).getByRole('button', { name: 'Record score' })).toBeVisible()
    await dialog.getByLabel('Orange score').fill('8')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Court 1: Blue won 11–8')).toBeVisible()
  })

  test('derives the winner from the scores even when Orange scores more', async ({ page }) => {
    await startSingles(page)
    await enterScore(page, 6, 11)

    await expect(page.getByText('Court 1: Orange won 11–6')).toBeVisible()
    await openStandings(page)
    const rows = page.getByRole('row')
    await expect(rows.nth(1)).toContainText('Bob')
    await expect(cell(rows.nth(1), DIFF)).toHaveText('+5')
  })

  test('undo takes a score back: the game is on the court again and nothing is counted', async ({ page }) => {
    await startSingles(page)
    await enterScore(page, 11, 7)
    await expect(court(page).getByText('Open')).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(court(page).getByText('In play')).toBeVisible()
    await openStandings(page)
    await expect(page.getByText('No games played yet.')).toBeVisible()
  })

  test('refuses level scores with a message, and does not record anything', async ({ page }) => {
    await startSingles(page)
    const dialog = await openScorePopup(page)
    const submit = dialog.getByRole('button', { name: 'Record score' })
    await expect(submit).toBeDisabled()

    await dialog.getByLabel('Blue score').fill('9')
    await expect(submit).toBeDisabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0) // still typing
    await dialog.getByLabel('Orange score').fill('9')
    await expect(dialog.getByRole('alert')).toContainText('The scores are level')
    await expect(submit).toBeDisabled()

    await dialog.getByLabel('Orange score').fill('8')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(submit).toBeEnabled()

    await dialog.getByLabel('Blue score').fill('8')
    await expect(submit).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(court(page).getByText('In play')).toBeVisible()
  })

  test('refuses scores that are not whole numbers from 0 to 99', async ({ page }) => {
    await startSingles(page)
    let dialog = await openScorePopup(page)
    let submit = dialog.getByRole('button', { name: 'Record score' })

    await dialog.getByLabel('Orange score').fill('5')
    for (const bad of ['100', '-1', '2.5']) {
      await dialog.getByLabel('Blue score').fill(bad)
      await expect(dialog.getByRole('alert'), bad).toContainText('whole numbers from 0 to 99')
      await expect(submit, bad).toBeDisabled()
    }
    // The limits themselves are fine, and 0 is a real score.
    await dialog.getByLabel('Blue score').fill('99')
    await expect(submit).toBeEnabled()
    await page.keyboard.press('Escape')

    dialog = await openScorePopup(page, 'B')
    submit = dialog.getByRole('button', { name: 'Record score' })
    await dialog.getByLabel('Blue score').fill('0')
    await dialog.getByLabel('Orange score').fill('5')
    await expect(submit).toBeEnabled()
    await dialog.getByLabel('Orange score').fill('')
    await expect(submit).toBeDisabled()
  })

  test('starts the winner at 11, so only the other score is typed', async ({ page }) => {
    await startSingles(page)
    let dialog = await openScorePopup(page, 'A')
    await expect(dialog.getByLabel('Blue score')).toHaveValue('11')
    await expect(dialog.getByLabel('Orange score')).toHaveValue('')
    await expect(dialog.getByLabel('Orange score')).toBeFocused() // the score that still needs typing
    await expect(dialog.getByRole('button', { name: 'Record score' })).toBeDisabled()
    await dialog.getByLabel('Orange score').fill('7')
    await expect(dialog.getByRole('button', { name: 'Record score' })).toBeEnabled()
    await page.keyboard.press('Escape')

    // Orange won: the boxes are the other way round.
    dialog = await openScorePopup(page, 'B')
    await expect(dialog.getByLabel('Orange score')).toHaveValue('11')
    await expect(dialog.getByLabel('Blue score')).toHaveValue('')
    await expect(dialog.getByLabel('Blue score')).toBeFocused()
    await expect(dialog.getByRole('button', { name: 'Record score' })).toBeDisabled()
  })

  test('typing only the other score and pressing Enter records 11 and that score', async ({ page }) => {
    await startSingles(page)
    const dialog = await openScorePopup(page, 'A')
    await dialog.getByLabel('Orange score').fill('4')
    await dialog.getByLabel('Orange score').press('Enter')
    await expect(page.getByText('Court 1: Blue won 11–4')).toBeVisible()

    await startGame(page)
    const second = await openScorePopup(page, 'B')
    await second.getByLabel('Blue score').fill('9')
    await second.getByLabel('Blue score').press('Enter')
    await expect(page.getByText('Court 1: Orange won 11–9')).toBeVisible()
  })

  test('the winner can still be given another score, and the pop-up starts fresh each time', async ({ page }) => {
    await startSingles(page)
    let dialog = await openScorePopup(page, 'A')
    await dialog.getByLabel('Blue score').fill('15')
    await dialog.getByLabel('Orange score').fill('13')
    await page.keyboard.press('Escape')

    dialog = await openScorePopup(page, 'A')
    await expect(dialog.getByLabel('Blue score')).toHaveValue('11')
    await expect(dialog.getByLabel('Orange score')).toHaveValue('')
    await dialog.getByLabel('Blue score').fill('15')
    await dialog.getByLabel('Orange score').fill('13')
    await dialog.getByRole('button', { name: 'Record score' }).click()
    await expect(page.getByText('Court 1: Blue won 15–13')).toBeVisible()
  })

  test('a losing score of 11 or more is refused with the reason', async ({ page }) => {
    await startSingles(page)
    const dialog = await openScorePopup(page, 'A')
    await dialog.getByLabel('Orange score').fill('11')
    await expect(dialog.getByRole('alert')).toContainText('The scores are level')
    await dialog.getByLabel('Orange score').fill('12')
    await expect(dialog.getByRole('alert')).toContainText('Blue won, so their score must be higher.')
    await expect(dialog.getByRole('button', { name: 'Record score' })).toBeDisabled()
  })
})

test.describe('ranking', () => {
  test('the point differential decides between players level on wins', async ({ page }) => {
    // Two courts: Ann v Bob and Cy v Dee. Ann and Cy win once each with the same opponent
    // strength and win rate, so before scores they ranked alphabetically (Ann first).
    await startSession(page, { mode: 'Singles', courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page, 'Court 1')
    await startGame(page, 'Court 2')

    await enterScore(page, 11, 9, 'Court 1') // Ann +2
    await enterScore(page, 11, 2, 'Court 2') // Cy +9

    await openStandings(page)
    const rows = page.getByRole('table').first().getByRole('row')
    await expect(rows).toHaveCount(5)
    await expect(cell(rows.nth(1), 1)).toHaveText('Cy')
    await expect(cell(rows.nth(1), DIFF)).toHaveText('+9')
    await expect(rows.nth(1)).toContainText('Gold medal')
    await expect(cell(rows.nth(2), 1)).toHaveText('Ann')
    await expect(cell(rows.nth(2), DIFF)).toHaveText('+2')
    await expect(rows.nth(2)).toContainText('Silver medal')
    // The losers follow, the smaller loss first.
    await expect(cell(rows.nth(3), 1)).toHaveText('Bob')
    await expect(cell(rows.nth(3), DIFF)).toHaveText('-2')
    await expect(cell(rows.nth(4), 1)).toHaveText('Dee')
    await expect(cell(rows.nth(4), DIFF)).toHaveText('-9')
    await expect(page.getByText('Ranked by wins, then point differential')).toBeVisible()
  })

  test('equal differentials still share a rank', async ({ page }) => {
    await startSession(page, { mode: 'Singles', courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page, 'Court 1')
    await startGame(page, 'Court 2')
    await enterScore(page, 11, 5, 'Court 1')
    await enterScore(page, 11, 5, 'Court 2')

    await openStandings(page)
    const rows = page.getByRole('row')
    await expect(rows.nth(1)).toContainText('Gold medal')
    await expect(rows.nth(2)).toContainText('Gold medal')
    await expect(rows.nth(3)).toContainText('Bronze medal')
  })

  test('undoing a score puts the ranking back', async ({ page }) => {
    await startSession(page, { mode: 'Singles', courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page, 'Court 1')
    await startGame(page, 'Court 2')
    await enterScore(page, 11, 9, 'Court 1')
    await enterScore(page, 11, 2, 'Court 2')
    // Two toasts are showing; only the latest can be undone, and it takes back Court 2 only.
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Court 2: Blue won 11–2' })
      .getByRole('button', { name: 'Undo' })
      .click()

    await openStandings(page)
    const rows = page.getByRole('table').first().getByRole('row')
    await expect(rows).toHaveCount(3)
    await expect(cell(rows.nth(1), 1)).toHaveText('Ann')
    await expect(cell(rows.nth(1), DIFF)).toHaveText('+2')
  })
})

test.describe('time played', () => {
  test('an in-play court shows how long the game has been going, and keeps counting', async ({ page }) => {
    await page.clock.install()
    await startSingles(page)
    // Real time still passes between steps, so the seconds are only roughly known.
    await expect(court(page).getByText(/^In play \d+s$/)).toBeVisible()

    await page.clock.fastForward('07:10')
    await expect(court(page).getByText(/^In play 7m\d+s$/)).toBeVisible()
    await page.clock.fastForward('58:00')
    await expect(court(page).getByText(/^In play 1h5m\d+s$/)).toBeVisible()
  })

  test('an open court shows no timer', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await expect(court(page).getByText(/In play [0-9]/)).toHaveCount(0)
  })

  test('the time a game took shows in the standings, for every game that finishes', async ({ page }) => {
    await page.clock.install()
    await startSession(page, { mode: 'Singles', courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page, 'Court 1')
    await startGame(page, 'Court 2')

    await page.clock.fastForward('07:10')
    await enterScore(page, 11, 6, 'Court 1')
    await page.clock.fastForward('05:00')
    await enterScore(page, 11, 4, 'Court 2')

    await openStandings(page)
    const rows = page.getByRole('row')
    await expect(rows.getByRole('columnheader', { name: 'Time' })).toBeVisible()
    const timeOf = (name: string) => cell(rows.filter({ hasText: name }), TIME)
    await expect(timeOf('Ann')).toHaveText(/^7m\d+s$/)
    await expect(timeOf('Bob')).toHaveText(/^7m\d+s$/)
    await expect(timeOf('Cy')).toHaveText(/^12m\d+s$/)
    await expect(timeOf('Dee')).toHaveText(/^12m\d+s$/)
  })

  test('a long game adds up over the session, in hours, minutes and seconds', async ({ page }) => {
    await page.clock.install()
    await startSingles(page)
    await page.clock.fastForward('01:05:00')
    await enterScore(page, 11, 6)

    await openStandings(page)
    await expect(cell(page.getByRole('row').nth(1), TIME)).toHaveText(/^1h5m(\d+s)?$/)
  })

  test('a cancelled game records no time', async ({ page }) => {
    await page.clock.install()
    await startSingles(page)
    await page.clock.fastForward('20:00')
    await cancelGame(page)
    await startGame(page)
    await enterScore(page, 11, 6)

    await openStandings(page)
    // Only the second game counts, which lasted no time at all: nowhere near the 20 minutes.
    await expect(cell(page.getByRole('row').nth(1), TIME)).toHaveText('-')
  })

  test('a game already running before the upgrade shows no timer and records no time', async ({ page }) => {
    await startSingles(page)
    // Simulate a session saved by the previous version: the game on court 1 has no start time.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('q2dink-session')!)
      delete saved.state.session.courts[0].startedAt
      localStorage.setItem('q2dink-session', JSON.stringify(saved))
    })
    await page.reload()
    await expect(court(page).getByText('In play')).toBeVisible()
    await expect(court(page).getByText(/In play [0-9]/)).toHaveCount(0)

    await enterScore(page, 11, 4)
    await openStandings(page)
    await expect(cell(page.getByRole('row').nth(1), DIFF)).toHaveText('+7')
    await expect(cell(page.getByRole('row').nth(1), TIME)).toHaveText('-')
  })

  test('a session saved before scores existed upgrades and keeps playing', async ({ page }) => {
    await startSingles(page)
    await enterScore(page, 11, 6)
    // Rewrite the saved session as version 6: stats without points or time.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('q2dink-session')!)
      saved.version = 6
      for (const stats of Object.values(saved.state.session.stats) as Record<string, unknown>[]) {
        delete stats.pointsFor
        delete stats.pointsAgainst
        delete stats.scoredGames
        delete stats.secondsPlayed
      }
      localStorage.setItem('q2dink-session', JSON.stringify(saved))
    })
    await page.reload()

    await openStandings(page)
    const rows = page.getByRole('row')
    await expect(cell(rows.nth(1), 1)).toHaveText('Ann')
    await expect(cell(rows.nth(1), DIFF)).toHaveText('-')
    await expect(cell(rows.nth(1), TIME)).toHaveText('-')

    await page.getByRole('tab', { name: 'Board' }).click()
    await startGame(page)
    await enterScore(page, 11, 3)
    await openStandings(page)
    // Stats are rebuilt from the match log, not the (here, artificially stripped) stats cache, so the
    // first game's 11-6 is recovered alongside the new 11-3: 22 points for, 9 against.
    await expect(cell(page.getByRole('row').nth(1), DIFF)).toHaveText('+13')
  })
})

test.describe('queue wait time', () => {
  test('ticks while waiting, freezes once playing, and carries into Matches', async ({ page }) => {
    await page.clock.install()
    await startSession(page, { mode: 'Singles' })
    // Ann and Bob are next up (singles needs 2); Cy is left waiting with a ticking counter.
    await checkIn(page, ['Ann', 'Bob', 'Cy'])
    await expect(queueRow(page, 'Cy')).toContainText(/\d+s/)

    await page.clock.fastForward('05:00')
    await expect(queueRow(page, 'Cy')).toContainText(/5m(\d+s)?/)
    const nextUp = page.getByRole('group', { name: 'Next up' })
    await expect(nextUp).toContainText(/5m(\d+s)?/)

    await startGame(page)
    await page.clock.fastForward('02:00')
    const waited = court(page).getByText(/^5m(\d+s)?$/)
    await expect(waited).toHaveCount(2)
    const frozen = await waited.allTextContents()
    await expect(court(page).getByTitle('Waited before this game')).toHaveCount(2)
    // Playing time keeps ticking, but the frozen wait time does not.
    await expect(court(page).getByText(/^In play 2m(\d+s)?$/)).toBeVisible()
    await page.clock.fastForward('00:10')
    await expect(waited).toHaveText(frozen)

    await enterScore(page, 11, 6)
    const matches = page.getByRole('group', { name: 'Matches' })
    await expect(matches).toContainText(/Ann \(5m(\d+s)?\)/)
    await expect(matches).toContainText(/Bob \(5m(\d+s)?\)/)
  })
})

test.describe('past sessions', () => {
  test('keep the scores and time played of an ended session', async ({ page }) => {
    await page.clock.install()
    await startSingles(page)
    await page.clock.fastForward('12:30')
    await enterScore(page, 11, 7)

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Save and end session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()

    await page.getByRole('button', { name: 'Past sessions' }).click()
    await page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Test Club/ }).click()
    const view = page.getByRole('dialog', { name: 'Test Club' })
    const rows = view.getByRole('row')
    await expect(cell(rows.nth(1), 1)).toHaveText('Ann')
    await expect(cell(rows.nth(1), DIFF)).toHaveText('+4')
    await expect(cell(rows.nth(1), TIME)).toHaveText(/^12m\d+s$/)
    await expect(cell(rows.nth(2), DIFF)).toHaveText('-4')
  })
})

test.describe('on a phone', () => {
  test('the standings fit the page, scrolling inside their card if needed', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await page.clock.install()
    await startSession(page, { mode: 'Doubles' })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page)
    await page.clock.fastForward('42:00')
    await enterScore(page, 11, 7)

    await openStandings(page)
    await expect(page.getByRole('columnheader', { name: '+/-' })).toBeAttached()
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeAttached()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    // Everything is still reachable inside the table.
    await page.getByRole('columnheader', { name: 'Time' }).scrollIntoViewIfNeeded()
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeInViewport()
  })

  test('a long player name in the Matches list does not overflow the page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await startSession(page, { mode: 'Singles' })
    await checkIn(page, ['Featherstonehaugh', 'Bob'])
    await startGame(page)
    await enterScore(page, 11, 4)

    const matches = page.getByRole('group', { name: 'Matches' })
    await expect(matches).toContainText('Featherstonehaugh')
    await expect(matches).toContainText('Bob')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
