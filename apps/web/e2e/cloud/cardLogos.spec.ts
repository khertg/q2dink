import { expect, test, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, recordWin, startGame } from '../helpers'
import { apiCreateClub, bearer, expectSignedIn, uiLogin, uniqueClub, type TestClub } from './support'

failOnCspViolations(test)

/** Sign in, play one game and open Share standings. */
async function openShareStandings(page: Page, club: TestClub, location: string) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
  await page.getByLabel('Session name').fill(location)
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
  await startGame(page)
  await recordWin(page)
  await page.getByRole('tab', { name: 'Standings' }).click()
  await page.getByRole('button', { name: 'Share standings' }).click()
  return page.getByRole('dialog', { name: 'Share standings' })
}

test('club logos and the one picked reach the club’s other staff devices', async ({ page, browser, request }) => {
  const club = uniqueClub('Logos')
  const { token } = await apiCreateClub(request, club)
  const dialog = await openShareStandings(page, club, 'Logo Night')

  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 120
      canvas.height = 60
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(10, 10, 100, 40)
      return canvas.toDataURL('image/png').split(',')[1]
    }),
    'base64',
  )
  await dialog.getByLabel('Logo file').setInputFiles({ name: 'club.png', mimeType: 'image/png', buffer: png })
  await page.getByRole('dialog', { name: 'Add logo' }).getByRole('button', { name: 'Add logo' }).click()
  await dialog.getByRole('radio', { name: 'Logo 1' }).click()
  await expect
    .poll(async () => (await (await request.get('/api/card-logos', { headers: bearer(token) })).json()) as unknown)
    .toMatchObject({ logos: [{ tone: 1 }], choice: { id: expect.any(String) } })

  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const second = await other.newPage()
  const theirs = await openShareStandings(second, club, 'Second Device')
  await expect(theirs.getByRole('radio', { name: 'Logo 1' })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 })
  await expect(theirs.getByRole('img', { name: 'Club logo' })).toHaveAttribute('src', /^data:image\//)
  await other.close()
})
