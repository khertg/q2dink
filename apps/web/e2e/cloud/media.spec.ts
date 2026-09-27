import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { checkIn, openSessionMenu } from '../helpers'
import { avatarOf, openAvatarEditor, setEmojiAvatar, setPhotoAvatar, viewAvatar } from '../avatarHelpers'
import { apiCreateClub, bearer, expectSignedIn, uiLogin, uniqueClub, type TestClub, goLive } from './support'

failOnCspViolations(test)

async function signIn(page: Page, club: TestClub) {
  await page.goto('/')
  await uiLogin(page, club)
  await expectSignedIn(page)
}

async function startSession(page: Page, location = 'Media Night') {
  await page.getByLabel('Session name').fill(location)
  await page.getByRole('button', { name: 'Create session' }).click()
  await page.getByRole('button', { name: 'Start session' }).click()
  await expect(page.getByRole('heading', { name: location })).toBeVisible()
  await goLive(page)
}

async function viewerPage(browser: Browser, slug: string) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.goto(`/club/${slug}/live`)
  return { context, page }
}

const index = (request: APIRequestContext, slug: string) => async () => {
  const response = await request.get(`/api/clubs/${slug}/avatars`)
  return (await response.json()) as { avatars: Record<string, { kind: string; emoji?: string }>; logo: null }
}

const shareBox = (page: Page) => page.getByLabel('Show player photos on the live page')

test.describe('club media on the live page', () => {
  test('an emoji avatar reaches the players’ live page, which cannot change it', async ({ page, browser, request }) => {
    const club = uniqueClub('Media')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setEmojiAvatar(page, 'Ann', '🎾')

    await expect.poll(async () => (await index(request, club.slug)()).avatars.ann?.emoji).toBe('🎾')

    const { context, page: viewer } = await viewerPage(browser, club.slug)
    const row = viewer.locator('ol > li').filter({ hasText: 'Ann' })
    await expect(avatarOf(row, 'Ann')).toHaveAttribute('data-emoji', '🎾', { timeout: 20_000 })
    // Bob has none, so he shows the automatic initials.
    await expect(avatarOf(viewer.locator('ol > li').filter({ hasText: 'Bob' }), 'Bob')).toHaveAttribute('data-avatar-kind', 'initials')
    // Players can tap an avatar to see it large, but nothing can be changed from the live page.
    const large = await viewAvatar(viewer, 'Ann', row)
    await expect(avatarOf(large, 'Ann')).toHaveAttribute('data-emoji', '🎾')
    await expect(large.getByRole('button', { name: 'Change avatar' })).toHaveCount(0)
    await viewer.keyboard.press('Escape')
    await expect(viewer.getByRole('button', { name: /^Change .*avatar/ })).toHaveCount(0)
    await context.close()
  })

  test('a change of avatar reaches the live page without anyone reloading it', async ({ page, browser, request }) => {
    const club = uniqueClub('Change')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setEmojiAvatar(page, 'Ann', '🎾')

    const { context, page: viewer } = await viewerPage(browser, club.slug)
    const row = viewer.locator('ol > li').filter({ hasText: 'Ann' })
    await expect(avatarOf(row, 'Ann')).toHaveAttribute('data-emoji', '🎾', { timeout: 20_000 })
    await setEmojiAvatar(page, 'Ann', '🏆')
    await expect(avatarOf(row, 'Ann')).toHaveAttribute('data-emoji', '🏆', { timeout: 30_000 })
    await context.close()
  })

  test('photos reach the club’s staff devices always, and the live page only while sharing is on', async ({ page, browser, request }) => {
    const club = uniqueClub('Photos')
    const { token } = await apiCreateClub(request, club)
    await signIn(page, club)
    await expect(shareBox(page)).not.toBeChecked()
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setPhotoAvatar(page, 'Ann')
    await setEmojiAvatar(page, 'Bob', '🥇')

    // Both go to the club, but the live page shows Ann's photo as initials while sharing is off.
    const staffKind = async () =>
      ((await (await request.get('/api/avatars', { headers: bearer(token) })).json()) as { avatars: Record<string, { kind: string }> })
        .avatars.ann?.kind
    await expect.poll(staffKind).toBe('photo')
    await expect.poll(async () => (await index(request, club.slug)()).avatars.bob?.emoji).toBe('🥇')
    expect((await index(request, club.slug)()).avatars.ann?.kind).toBe('initials')
    const { context, page: viewer } = await viewerPage(browser, club.slug)
    await expect(avatarOf(viewer.locator('ol > li').filter({ hasText: 'Bob' }), 'Bob')).toHaveAttribute('data-emoji', '🥇', { timeout: 20_000 })
    await expect(avatarOf(viewer.locator('ol > li').filter({ hasText: 'Ann' }), 'Ann')).toHaveAttribute('data-avatar-kind', 'initials')
    expect((await request.get(`/api/clubs/${club.slug}/avatars/ann/photo`)).status()).toBe(404)

    // Switch sharing on from the running session (Share live view): the live page gets the photo.
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'Share live view' }).click()
    await shareBox(page).check()
    await expect.poll(async () => (await index(request, club.slug)()).avatars.ann?.kind).toBe('photo')
    const photo = await request.get(`/api/clubs/${club.slug}/avatars/ann/photo`)
    expect(photo.status()).toBe(200)
    expect(photo.headers()['content-type']).toMatch(/^image\//)

    // Switch it off: the live page loses the photo, the club's staff devices keep it.
    await shareBox(page).uncheck()
    await expect.poll(async () => (await index(request, club.slug)()).avatars.ann?.kind).toBe('initials')
    expect((await request.get(`/api/clubs/${club.slug}/avatars/ann/photo`)).status()).toBe(404)
    expect(await staffKind()).toBe('photo')
    await context.close()

    // The choice is the same one the setup screen shows.
    await page.keyboard.press('Escape')
    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /^(Save and end session|End session)$/ }).click()
    await expect(shareBox(page)).not.toBeChecked()
  })

  test('with sharing on, the live page shows the photo, from the club', async ({ page, browser, request }) => {
    const club = uniqueClub('Shared')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await shareBox(page).check()
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setPhotoAvatar(page, 'Ann')

    const { context, page: viewer } = await viewerPage(browser, club.slug)
    const avatar = avatarOf(viewer.locator('ol > li').filter({ hasText: 'Ann' }), 'Ann')
    await expect(avatar).toHaveAttribute('data-avatar-kind', 'photo', { timeout: 20_000 })
    await expect(avatar.locator('img')).toHaveAttribute('src', new RegExp(`/api/clubs/${club.slug}/avatars/ann/photo\\?v=\\d+`))
    await expect
      .poll(() => avatar.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0)
    await context.close()
  })

  test('another staff device shows the club’s avatar for a player it has none for', async ({ page, browser, request }) => {
    const club = uniqueClub('Devices')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setEmojiAvatar(page, 'Ann', '🎾')
    await expect.poll(async () => (await index(request, club.slug)()).avatars.ann?.emoji).toBe('🎾')

    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const second = await other.newPage()
    await signIn(second, club)
    await startSession(second, 'Second Device')
    await checkIn(second, ['Ann', 'Cy'])
    // Its own roster has no avatar for Ann, so the club's is used; Cy has none anywhere.
    await expect(avatarOf(second.locator('ol > li').filter({ hasText: 'Ann' }), 'Ann')).toHaveAttribute('data-emoji', '🎾', { timeout: 20_000 })
    await expect(avatarOf(second.locator('ol > li').filter({ hasText: 'Cy' }), 'Cy')).toHaveAttribute('data-avatar-kind', 'initials')
    await other.close()
  })

  test('a photo set on one staff device shows on the club’s other devices, with the live page kept private', async ({ page, browser, request }) => {
    const club = uniqueClub('Faces')
    const { token } = await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page)
    await checkIn(page, ['Ann'])
    await setPhotoAvatar(page, 'Ann')
    await expect
      .poll(async () => ((await (await request.get('/api/avatars', { headers: bearer(token) })).json()) as { avatars: Record<string, { kind: string }> }).avatars.ann?.kind)
      .toBe('photo')

    // The PC logs in to the same club: Ann is on its roster, with her photo.
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block' })
    const second = await other.newPage()
    await signIn(second, club)
    await startSession(second, 'Second Device')
    await second.getByRole('tab', { name: 'Check-in' }).click()
    const roster = second.getByRole('group', { name: 'Check in from the roster' })
    const avatar = avatarOf(roster.locator('label').filter({ hasText: 'Ann' }), 'Ann')
    await expect(avatar).toHaveAttribute('data-avatar-kind', 'photo', { timeout: 20_000 })
    await expect(avatar.locator('img')).toHaveAttribute('src', /^data:image\//)
    await other.close()

    // Nobody switched sharing on, so the public live page still shows initials.
    expect((await index(request, club.slug)()).avatars.ann?.kind).toBe('initials')
  })

  test('changes made while offline are sent when the connection returns', async ({ page, context, request }) => {
    const club = uniqueClub('Offline')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page)
    await checkIn(page, ['Ann'])

    await context.setOffline(true)
    await setEmojiAvatar(page, 'Ann', '🏓')
    await page.waitForTimeout(1500)
    expect((await index(request, club.slug)()).avatars).toEqual({})

    await context.setOffline(false)
    await expect.poll(async () => (await index(request, club.slug)()).avatars.ann?.emoji, { timeout: 20_000 }).toBe('🏓')
  })

  test('a removed avatar is removed from the club too', async ({ page, request }) => {
    const club = uniqueClub('Removal')
    await apiCreateClub(request, club)
    await signIn(page, club)
    await startSession(page)
    await checkIn(page, ['Ann'])
    await setEmojiAvatar(page, 'Ann', '🎾')
    await expect.poll(async () => (await index(request, club.slug)()).avatars.ann?.kind).toBe('emoji')

    const editor = await openAvatarEditor(page, 'Ann')
    await editor.getByRole('button', { name: 'Remove avatar' }).click()
    await expect.poll(async () => Object.keys((await index(request, club.slug)()).avatars)).toEqual([])
  })
})
