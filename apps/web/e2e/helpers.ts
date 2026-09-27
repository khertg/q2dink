import { expect, type Locator, type Page } from '@playwright/test'

/** A team's name as the app shows it: the first team (A) is Blue, the second (B) Orange. */
export const teamName = (team: 'A' | 'B') => (team === 'A' ? 'Blue' : 'Orange')

/**
 * Open a player's ⋮ menu on a card (a court, or Next up) and choose one of its items. The menu opens
 * in a popover outside the card, so the item is found on the page.
 */
export async function playerAction(scope: Locator | Page, name: string, item: 'Swap…' | 'Lock partner…' | 'Remove from court' | 'Remove from Next up' | 'Take a break' | 'Remove from session') {
  await scope.getByRole('button', { name: `Options for ${name}` }).click()
  const page = 'page' in scope ? scope.page() : scope
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: item }).click()
}

/** On the Check-in tab, open a waiting player's ⋮ menu and choose one of its items. */
export async function waitingAction(page: Page, name: string, item: 'Take a break' | 'Remove from session') {
  const trigger = page.getByRole('list', { name: 'Waiting players' }).getByRole('button', { name: `${name} menu` })
  // Mid-screen, so the menu does not open under the check-in toasts at the bottom of a phone screen.
  await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await trigger.click()
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: item }).click()
}

/**
 * Every lock asks first: confirm the dialog with the rule (both waiting, or in the same game), or choose while one of
 * them is away ('Wait for 1 game' or 'Lock now').
 */
export async function confirmLock(page: Page, choice: 'Lock partners' | 'Wait for 1 game' | 'Lock now' = 'Lock partners') {
  const dialog = page.getByRole('dialog', { name: /^Lock .+ and .+\?$/ })
  await dialog.getByRole('button', { name: choice }).click()
  await expect(dialog).toHaveCount(0)
}

/** Open a shadcn Select by its label and pick an option by name. */
export async function choose(page: Page, label: string | RegExp, option: string | RegExp) {
  await page.getByLabel(label).click()
  // Exact match so "Male" does not also match "Female".
  await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click()
}

/** Fill the setup form and start a session. */
export async function startSession(
  page: Page,
  {
    location = 'Test Club',
    courts = 1,
    mode = 'Doubles',
    gameMinutes = 12,
    matchmaking,
  }: {
    location?: string
    courts?: number
    mode?: 'Doubles' | 'Singles'
    gameMinutes?: number
    /** Option label, e.g. 'Mixed doubles'. Defaults to Auto-balanced. */
    matchmaking?: string
  } = {},
) {
  await page.goto('/')
  await page.getByLabel('Session name').fill(location)
  await page.getByLabel('Number of courts (1 to 15)').fill(String(courts))
  await page.getByRole('button', { name: mode }).click()
  if (matchmaking) await choose(page, 'Matchmaking', matchmaking)
  await page.getByLabel('Average game length (minutes)').fill(String(gameMinutes))
  await page.getByRole('button', { name: 'Create session' }).click()
  await expect(page.getByRole('heading', { name: location })).toBeVisible()
  // Created sessions do not start by themselves: most specs want one running.
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
}

export interface PlayerSpec {
  name: string
  gender?: 'Male' | 'Female'
  /** Option text such as '5 · Advanced (4.00–4.49)'. */
  skill?: string
}

/** Check players in from the Check-in tab, then return to the Board tab. */
export async function checkIn(page: Page, players: (string | PlayerSpec)[]) {
  await page.getByRole('tab', { name: 'Check-in' }).click()
  for (const entry of players) {
    const player = typeof entry === 'string' ? { name: entry } : entry
    await page.getByLabel('Player name').fill(player.name)
    if (player.skill) await choose(page, 'Skill level', player.skill)
    if (player.gender) await choose(page, /^Gender/, player.gender)
    await page.getByRole('button', { name: 'Check in', exact: true }).click()
    await expect(page.getByText(`${player.name} checked in`)).toBeVisible()
  }
  await page.getByRole('tab', { name: 'Board' }).click()
}

/** Press Start game on a court and wait for the game to be on it. Games never start by themselves. */
export async function startGame(page: Page, courtName = 'Court 1') {
  const court = page.getByRole('region', { name: courtName, exact: true })
  await court.getByRole('button', { name: 'Start game' }).click()
  await expect(court.getByText('In play')).toBeVisible()
}

/**
 * Finish the game on a court: press the winner's button, then give the score the pop-up asks for.
 * Games are always finished with a score. The winner scores 11 and the other team 5 unless told.
 */
export async function recordWin(
  page: Page,
  courtName = 'Court 1',
  winner: 'A' | 'B' = 'A',
  score?: [teamA: number, teamB: number],
) {
  const [a, b] = score ?? (winner === 'A' ? [11, 5] : [5, 11])
  await page
    .getByRole('region', { name: courtName, exact: true })
    .getByRole('button', { name: `${teamName(winner)} won` })
    .click()
  const dialog = page.getByRole('dialog', { name: `${teamName(winner)} won` })
  await dialog.getByLabel('Blue score').fill(String(a))
  await dialog.getByLabel('Orange score').fill(String(b))
  await dialog.getByRole('button', { name: 'Record score' }).click()
  await expect(dialog).toHaveCount(0)
}

/** Cancel the game on a court, confirming the question it asks first. */
export async function cancelGame(page: Page, courtName = 'Court 1') {
  await page
    .getByRole('region', { name: courtName, exact: true })
    .getByRole('button', { name: 'Court menu' })
    .click()
  await page.getByRole('button', { name: 'Cancel game' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cancel this game?' })
  await dialog.getByRole('button', { name: 'Cancel game' }).click()
  await expect(dialog).toHaveCount(0)
}

/** Open the session menu (Manage courts / Share live view / End session). */
export async function openSessionMenu(page: Page) {
  await page.getByRole('button', { name: 'Session menu' }).click()
}

/** Open the End session confirmation dialog. Leaves it open. */
export async function openEndSessionDialog(page: Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'End session' }).click()
}

/** Add a court the only way the app offers: through Manage courts. Leaves the dialog closed. */
export async function addCourt(page: Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Manage courts' }).click()
  const dialog = page.getByRole('dialog', { name: 'Manage courts' })
  await dialog.getByRole('button', { name: 'Add court' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** The setup screen's list of sessions running now (left on this device, or on the club's other devices). */
export const openSessionsList = (page: Page) => page.getByRole('list', { name: 'Open sessions' })

/** Open a running session from the setup screen's list, by name. */
export async function openFromList(page: Page, location: string, options: { timeout?: number } = {}) {
  await openSessionsList(page)
    .getByRole('listitem')
    .filter({ has: page.getByText(location, { exact: true }) })
    .getByRole('button', { name: 'Open' })
    .click(options)
  // A dialog (such as "Session paused by …") hides the page behind it from getByRole.
  await expect(page.getByRole('heading', { name: location }).or(page.getByRole('dialog'))).toBeVisible()
}
