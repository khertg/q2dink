import { expect, test, type Page } from '@playwright/test'
import { checkIn, openSessionMenu, playerAction, startGame, startSession, waitingAction } from './helpers'

// This build has no cloud, so call-outs use the device's own voice. It is replaced by a recorder, so the
// test hears what would be said (and nothing is played out loud).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const said: string[] = []
    ;(window as unknown as { said: string[] }).said = said
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak(utterance: SpeechSynthesisUtterance) {
          said.push(utterance.text)
          setTimeout(() => utterance.onend?.(new Event('end') as SpeechSynthesisEvent), 0)
        },
        cancel() {},
        getVoices: () => [],
      },
    })
  })
})

const said = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said)
const lastSaid = async (page: Page) => (await said(page)).at(-1)

const NAMES = /(Ann|Bob|Cy|Dee|Eve|Fay)/.source
const MATCHUP = new RegExp(`^${NAMES} and ${NAMES}, against ${NAMES} and ${NAMES}`)

test('reads out Next up, a court and a single player', async ({ page }) => {
  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'])

  // An open court with a group ready sends that group to it.
  const court = page.getByRole('region', { name: 'Court 1', exact: true })
  await court.getByRole('button', { name: 'Announce Court 1' }).click()
  await expect.poll(() => lastSaid(page)).toMatch(new RegExp(`${MATCHUP.source}, please go to Court 1\\.$`))

  await startGame(page)
  await court.getByRole('button', { name: 'Announce Court 1' }).click()
  await expect.poll(() => lastSaid(page)).toMatch(new RegExp(`^Court 1: ${MATCHUP.source.slice(1)}\\.$`))

  // Only two wait now: Next up has nobody to call.
  const nextUp = page.getByRole('group', { name: 'Next up' })
  await expect(nextUp.getByRole('button', { name: 'Announce Next up' })).toBeDisabled()

  // A player on the court is sent to it.
  const onCourt = (await court.getByRole('button', { name: /^Options for / }).first().getAttribute('aria-label'))!.slice(
    'Options for '.length,
  )
  await playerAction(court, onCourt, 'Call out')
  await expect.poll(() => lastSaid(page)).toBe(`${onCourt}, please go to Court 1.`)
})

test('reads out the next group, and calls a waiting player from the Check-in tab', async ({ page }) => {
  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])

  await page.getByRole('group', { name: 'Next up' }).getByRole('button', { name: 'Announce Next up' }).click()
  await expect.poll(() => lastSaid(page)).toMatch(new RegExp(`^Next up: ${MATCHUP.source.slice(1)}\\. Please get ready\\.$`))

  await page.getByRole('tab', { name: /Check-in/ }).click()
  await waitingAction(page, 'Eve', 'Call out')
  await expect.poll(() => lastSaid(page)).toBe('Eve, please come to the front desk.')
})

test('Say something reads out what staff type, and again on request', async ({ page }) => {
  await startSession(page)
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Say something…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Say something' })
  await expect(dialog.getByRole('button', { name: 'Speak' })).toBeDisabled()
  await dialog.getByLabel('Announcement').fill('Last games in 10 minutes')
  await dialog.getByRole('button', { name: 'Speak' }).click()
  await expect.poll(() => lastSaid(page)).toBe('Last games in 10 minutes')
  await dialog.getByRole('button', { name: 'Speak' }).click()
  await expect.poll(async () => (await said(page)).length).toBe(2)
})
