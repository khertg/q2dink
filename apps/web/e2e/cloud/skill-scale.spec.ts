import { expect, test, type Browser, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { apiCreateClub, apiPublish, bearer, expectSignedIn, liveSnapshot, uiLogin, uniqueClub, type TestClub } from './support'

failOnCspViolations(test)

const FOUR = {
  levels: [
    { label: 'Social', from: 1 },
    { label: 'Club', from: 3 },
    { label: 'Strong', from: 4 },
    { label: 'Pro', from: 5, range: '5.0+' },
  ],
}

async function signIn(page: Page, club: TestClub) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
}

async function otherDevice(browser: Browser, club: TestClub) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const page = await context.newPage()
  await signIn(page, club)
  return { context, page }
}

test('the live page names levels and court ranges on the session’s own scale', async ({ page, request }) => {
  const club = uniqueClub('Scale')
  const { token } = await apiCreateClub(request, club)
  await apiPublish(request, token, {
    ...liveSnapshot(),
    skillScale: FOUR,
    courts: [
      { id: 1, name: 'Court 1', teams: [[1, 2], [3, 4]], levels: [2, 3] },
      { id: 2, name: 'Court 2', teams: null },
    ],
  })
  await page.goto(`/club/${club.slug}/live`)
  await expect(page.getByRole('region', { name: 'Court 1' }).getByRole('img', { name: 'Skill levels: 3.00–4.99' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Court 2' }).getByRole('img', { name: 'Skill levels: All levels' })).toBeVisible()
})

test('a club’s skill levels reach its other staff devices and new sessions there', async ({ page, browser, request }) => {
  const club = uniqueClub('Scale')
  const { token } = await apiCreateClub(request, club)
  await signIn(page, club)

  const dialog = page.getByRole('dialog', { name: 'Skill levels' })
  await page.getByRole('button', { name: 'Skill levels' }).click()
  await dialog.getByRole('button', { name: 'USA Pickleball' }).click()
  await dialog.getByRole('button', { name: 'Save levels' }).click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(async () => (await (await request.get('/api/skill-scale', { headers: bearer(token) })).json()).scale?.levels?.[5]?.label)
    .toBe('Expert')

  const desk = await otherDevice(browser, club)
  const deskDialog = desk.page.getByRole('dialog', { name: 'Skill levels' })
  // The dialog copies the levels when it opens: reopen it until the club's have arrived.
  await expect(async () => {
    await desk.page.getByRole('button', { name: 'Skill levels' }).click()
    try {
      await expect(deskDialog.getByLabel('Name of level 6')).toHaveValue('Expert', { timeout: 1000 })
    } finally {
      await desk.page.keyboard.press('Escape')
      await expect(deskDialog).toHaveCount(0)
    }
  }).toPass()

  await desk.page.getByLabel('Session name').fill('Desk night')
  await desk.page.getByRole('button', { name: 'Create session' }).click()
  await desk.page.getByRole('tab', { name: 'Check-in' }).click()
  await desk.page.getByLabel('Skill level').click()
  await expect(desk.page.getByRole('option', { name: '6 · Expert (5.0+)' })).toBeVisible()
  await desk.context.close()
})
