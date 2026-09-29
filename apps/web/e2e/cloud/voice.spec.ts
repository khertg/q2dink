import { expect, test, type Browser, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, openSessionMenu, startSession } from '../helpers'
import { apiCreateClub, bearer, expectSignedIn, uiLogin, uniqueClub, type TestClub } from './support'

failOnCspViolations(test)

/** Replace the device voice with a recorder, so the test hears what would be said and nothing plays. */
async function recordDeviceVoice(page: Page) {
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
}

const said = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said)

async function signIn(page: Page, club: TestClub) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
}

async function otherDevice(browser: Browser, club: TestClub) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const page = await context.newPage()
  await recordDeviceVoice(page)
  await signIn(page, club)
  return { context, page }
}

test('the club’s call-out voice is chosen once for every staff device, and the device voice never calls the server', async ({
  page,
  browser,
  request,
}) => {
  const club = uniqueClub('Voice')
  const { token } = await apiCreateClub(request, club)
  await signIn(page, club)

  // The test server has no ElevenLabs key, so the club panel says devices use their own voice.
  await expect(page.getByRole('radio', { name: 'ElevenLabs' })).toBeChecked()
  await expect(page.getByText('ElevenLabs is not set up on this server')).toBeVisible()

  await page.getByRole('radio', { name: 'Device voice' }).check()
  await expect
    .poll(async () => (await (await request.get('/api/voice', { headers: bearer(token) })).json()).voice)
    .toBe('device')

  // Another staff device follows, and its session menu shows the same choice.
  const desk = await otherDevice(browser, club)
  await expect(desk.page.getByRole('radio', { name: 'Device voice' })).toBeChecked()
  const speechRequests: string[] = []
  desk.page.on('request', (r) => {
    if (r.url().includes('/api/speech')) speechRequests.push(r.url())
  })
  await startSession(desk.page)
  await openSessionMenu(desk.page)
  await desk.page.getByRole('button', { name: 'Call-out voice…' }).click()
  const dialog = desk.page.getByRole('dialog', { name: 'Call-out voice' })
  await expect(dialog.getByRole('radio', { name: 'Device voice' })).toBeChecked()
  await dialog.getByRole('button', { name: 'Test voice' }).click()
  await expect.poll(() => said(desk.page)).toEqual(['This is how call-outs will sound.'])
  expect(speechRequests).toEqual([])

  // Back to ElevenLabs from the session menu: the first device follows.
  await dialog.getByRole('radio', { name: 'ElevenLabs' }).check()
  await expect
    .poll(async () => (await (await request.get('/api/voice', { headers: bearer(token) })).json()).voice)
    .toBe('elevenlabs')
  await page.reload()
  await expect(page.getByRole('radio', { name: 'ElevenLabs' })).toBeChecked()
  await desk.context.close()
})

test('staff pick the club’s ElevenLabs voice from the account’s list or paste an id', async ({ page, request }) => {
  const club = uniqueClub('Voices')
  const { token } = await apiCreateClub(request, club)
  // The test server has no ElevenLabs key: answer as a server that has one, listing a few voices. Saving is real.
  await page.route('**/api/voice', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), elevenLabs: true } })
  })
  await page.route('**/api/voice/options', (route) =>
    route.fulfill({
      json: {
        listable: true,
        voices: [
          { id: 'adam1', name: 'Adam', description: 'deep', paidOnly: false },
          { id: 'lib1', name: 'Zed', paidOnly: true },
        ],
      },
    }),
  )
  await signIn(page, club)
  const clubVoiceId = async () => (await (await request.get('/api/voice', { headers: bearer(token) })).json()).voiceId

  const picker = page.getByRole('combobox', { name: 'ElevenLabs voice' })
  await expect(picker).toHaveText(/Rachel \(default\)/)
  await picker.click()
  await expect(page.getByRole('option', { name: /Zed.*Needs a paid ElevenLabs plan/ })).toBeVisible()
  await page.getByRole('option', { name: /Adam/ }).click()
  await expect.poll(clubVoiceId).toBe('adam1')

  // A voice id the list does not have.
  const pasteField = page.getByLabel('Other voice id')
  await pasteField.fill('not an id!')
  await page.getByRole('button', { name: 'Use' }).click()
  await expect(page.getByRole('alert')).toHaveText(/letters and digits only/)
  await pasteField.fill('pastedVoice9')
  await page.getByRole('button', { name: 'Use' }).click()
  await expect.poll(clubVoiceId).toBe('pastedVoice9')
  await expect(picker).toHaveText(/Voice pastedVoice9/)

  // Back to the default voice.
  await picker.click()
  await page.getByRole('option', { name: /Rachel \(default\)/ }).click()
  await expect.poll(clubVoiceId).toBeNull()
})

test('the club changes what a call-out says, and every call-out of that kind follows', async ({ page, request }) => {
  const club = uniqueClub('Wording')
  const { token } = await apiCreateClub(request, club)
  await recordDeviceVoice(page)
  await signIn(page, club)

  await page.getByRole('button', { name: 'Edit wording…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Call-out wording' })
  const nextUp = dialog.getByLabel('Next up', { exact: true })
  await expect(nextUp).toHaveValue('Next up: {players}. Please get ready.')
  await nextUp.fill('Coming up: {bluePlayers} versus {orangePlayers} {nmae}!')
  await expect(dialog.getByRole('alert')).toHaveText(/\{nmae\} is not filled in here/)
  await nextUp.fill('Coming up: {bluePlayers} versus {orangePlayers}!')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Test Next up' }).click()
  await expect.poll(async () => (await said(page)).at(-1)).toBe('Coming up: Ann and Bob versus Cal and Dee!')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(async () => (await (await request.get('/api/voice', { headers: bearer(token) })).json()).texts)
    .toEqual({ nextUp: 'Coming up: {bluePlayers} versus {orangePlayers}!' })

  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
  await page.getByRole('group', { name: 'Next up' }).getByRole('button', { name: 'Announce Next up' }).click()
  await expect
    .poll(async () => (await said(page)).at(-1))
    .toMatch(/^Coming up: (Ann|Bob|Cy|Dee) and (Ann|Bob|Cy|Dee) versus (Ann|Bob|Cy|Dee) and (Ann|Bob|Cy|Dee)!$/)

  // Back to the default from the session menu.
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Call-out voice…' }).click()
  await page.getByRole('dialog', { name: 'Call-out voice' }).getByRole('button', { name: 'Edit wording…' }).click()
  await dialog.getByRole('button', { name: 'Reset Next up' }).click()
  await expect(nextUp).toHaveValue('Next up: {players}. Please get ready.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(async () => (await (await request.get('/api/voice', { headers: bearer(token) })).json()).texts)
    .toEqual({})
})

test('each speaker’s wording is changed right there: a court’s own, a player’s own, and the Test voice sentence', async ({
  page,
  request,
}) => {
  const club = uniqueClub('Speakers')
  const { token } = await apiCreateClub(request, club)
  await recordDeviceVoice(page)
  await signIn(page, club)
  const lastSaid = async () => (await said(page)).at(-1)
  const clubTexts = async () => (await (await request.get('/api/voice', { headers: bearer(token) })).json()).texts

  await startSession(page, { courts: 2 })
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])

  // Court 1's own wording, from the pencil beside its speaker.
  const court1 = page.getByRole('region', { name: 'Court 1', exact: true })
  await court1.getByRole('button', { name: 'Edit wording of Court 1' }).click()
  const courtDialog = page.getByRole('dialog', { name: 'Call-out wording for Court 1' })
  await courtDialog.getByRole('textbox', { name: 'Calling players to a court', exact: true }).fill('{players}, to the center court!')
  await courtDialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(clubTexts).toMatchObject({ courts: { 'court 1': { courtCall: '{players}, to the center court!' } } })
  await court1.getByRole('button', { name: 'Announce Court 1' }).click()
  await expect.poll(lastSaid).toMatch(/, to the center court!$/)
  await page.getByRole('region', { name: 'Court 2', exact: true }).getByRole('button', { name: 'Announce Court 2' }).click()
  await expect.poll(lastSaid).toMatch(/, please go to Court 2\.$/)

  // Ann's own wording, from her menu in Next up, with a placeholder put in by its chip.
  const nextUp = page.getByRole('group', { name: 'Next up' })
  await nextUp.getByRole('button', { name: 'Options for Ann' }).click()
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: 'Call-out wording…' }).click()
  const annDialog = page.getByRole('dialog', { name: 'Call-out wording for Ann' })
  await annDialog.getByRole('textbox', { name: 'A player who is next up', exact: true }).fill('{name}, your table is ready, ')
  await annDialog.getByRole('button', { name: 'Insert {team} into A player who is next up' }).click()
  await expect(annDialog.getByRole('textbox', { name: 'A player who is next up', exact: true })).toHaveValue('{name}, your table is ready, {team}')
  await annDialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(clubTexts).toMatchObject({ players: { ann: { playerNextUp: '{name}, your table is ready, {team}' } } })
  await nextUp.getByRole('button', { name: 'Options for Ann' }).click()
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: 'Call out', exact: true }).click()
  await expect.poll(lastSaid).toMatch(/^Ann, your table is ready, (Blue|Orange)$/)
  await nextUp.getByRole('button', { name: 'Options for Bob' }).click()
  await page.locator('[data-slot="popover-content"]').getByRole('button', { name: 'Call out', exact: true }).click()
  await expect.poll(lastSaid).toBe('Bob, you are next up. Please get ready.')

  // The Test voice sentence, and removing Ann's wording from the club's list.
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'Call-out voice…' }).click()
  const voiceDialog = page.getByRole('dialog', { name: 'Call-out voice' })
  await voiceDialog.getByRole('button', { name: 'Edit wording…' }).click()
  const clubDialog = page.getByRole('dialog', { name: 'Call-out wording' })
  await clubDialog.getByRole('textbox', { name: 'Test voice', exact: true }).fill('Testing {court} for {name}')
  await clubDialog.getByRole('button', { name: 'Remove the wording for ann' }).click()
  await clubDialog.getByRole('button', { name: 'Save' }).click()
  await expect.poll(clubTexts).toEqual({
    testVoice: 'Testing {court} for {name}',
    courts: { 'court 1': { courtCall: '{players}, to the center court!' } },
  })
  await voiceDialog.getByRole('button', { name: 'Test voice' }).click()
  await expect.poll(lastSaid).toBe('Testing Court 1 for Ann')
})
