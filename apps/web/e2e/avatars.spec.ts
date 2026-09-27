import { expect, test, type Locator } from '@playwright/test'
import { checkIn, openSessionMenu, recordWin, startGame, startSession, playerAction } from './helpers'
import { TINY_PNG, avatarOf, openAvatarEditor, queueRow, setEmojiAvatar, setPhotoAvatar, viewAvatar } from './avatarHelpers'

const color = (locator: Locator) => locator.first().evaluate((el) => (el as HTMLElement).style.backgroundColor)

async function endSession(page: import('@playwright/test').Page) {
  await openSessionMenu(page)
  await page.getByRole('button', { name: 'End session' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /^(Save and end session|End session)$/ }).click()
  await expect(page.getByText('Set up an open play session')).toBeVisible()
}

test.describe('automatic avatars', () => {
  test('everyone has initials on a colour, the same everywhere they appear', async ({ page }) => {
    await startSession(page, { courts: 2 })
    await checkIn(page, ['Ann Lee', 'Bob', 'Cy', 'Dee', 'Eve'])
    await startGame(page, 'Court 1')

    await expect(avatarOf(queueRow(page, 'Eve'), 'Eve')).toHaveAttribute('data-avatar-kind', 'initials')
    await expect(avatarOf(page, 'Ann Lee').first()).toHaveAttribute('data-initials', 'AL')
    await expect(avatarOf(page, 'Bob').first()).toHaveAttribute('data-initials', 'B')
    // Same name, same colour, in the queue and on the check-in tab.
    const inQueue = await color(avatarOf(queueRow(page, 'Eve'), 'Eve'))
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const waiting = page.getByRole('list', { name: 'Waiting players' }).getByRole('listitem')
    expect(await color(avatarOf(waiting.filter({ hasText: 'Eve' }), 'Eve'))).toBe(inQueue)
  })

  test('adds no text to the page: names in lists stay exactly the names', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann Lee', 'Bob'])
    const row = queueRow(page, 'Ann Lee')
    await expect(row).not.toContainText('AL')
    await expect(row.getByText('Ann Lee', { exact: true })).toBeVisible()
  })
})

test.describe('changing an avatar', () => {
  test('an emoji, from the queue, shows on the Board, in Next up and on the court', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
    await setEmojiAvatar(page, 'Ann', '🎾')
    await expect(page.getByText("Ann's avatar updated")).toBeVisible()

    await expect(avatarOf(queueRow(page, 'Ann'), 'Ann')).toHaveAttribute('data-emoji', '🎾')
    await expect(avatarOf(page.getByRole('group', { name: 'Next up' }), 'Ann')).toHaveAttribute('data-avatar-kind', 'emoji')
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const waiting = page.getByRole('list', { name: 'Waiting players' }).getByRole('listitem')
    await expect(avatarOf(waiting.filter({ hasText: 'Ann' }), 'Ann')).toHaveAttribute('data-avatar-kind', 'emoji')
    await page.getByRole('tab', { name: 'Board' }).click()
    await startGame(page)
    const court = page.getByRole('region', { name: 'Court 1', exact: true })
    await expect(avatarOf(court, 'Ann')).toHaveAttribute('data-avatar-kind', 'emoji')
  })

  test('a colour alone gives initials on that colour', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    const dialog = await openAvatarEditor(page, 'Ann')
    await dialog.getByRole('button', { name: 'Colour #be185d' }).click()
    await expect(dialog.getByRole('button', { name: 'Colour #be185d' })).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'Save avatar' }).click()

    const avatar = avatarOf(queueRow(page, 'Ann'), 'Ann')
    await expect(avatar).toHaveAttribute('data-avatar-kind', 'initials')
    await expect(avatar).toHaveCSS('background-color', 'rgb(190, 24, 93)')
  })

  test('a photo is cropped small, kept, and shown as a picture', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setPhotoAvatar(page, 'Ann')

    const avatar = avatarOf(queueRow(page, 'Ann'), 'Ann')
    await expect(avatar).toHaveAttribute('data-avatar-kind', 'photo')
    const image = avatar.locator('img')
    const src = await image.getAttribute('src')
    expect(src).toMatch(/^data:image\/(webp|jpeg|png);base64,/)
    // Small enough to keep on the device and send to the club.
    expect((src!.length * 3) / 4).toBeLessThan(48 * 1024)
    const size = await image.evaluate((img) => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight])
    expect(size).toEqual([128, 128])
  })

  test('shows a preview before saving, and closing without saving changes nothing', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    const dialog = await openAvatarEditor(page, 'Ann')
    await dialog.getByRole('button', { name: 'Emoji 🏆' }).click()
    await expect(avatarOf(dialog, 'Ann')).toHaveAttribute('data-emoji', '🏆')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(avatarOf(queueRow(page, 'Ann'), 'Ann')).toHaveAttribute('data-avatar-kind', 'initials')
  })

  test('can be changed again, and removed', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setEmojiAvatar(page, 'Ann', '🎾')
    await setPhotoAvatar(page, 'Ann')
    await expect(avatarOf(queueRow(page, 'Ann'), 'Ann')).toHaveAttribute('data-avatar-kind', 'photo')

    const dialog = await openAvatarEditor(page, 'Ann')
    await dialog.getByRole('button', { name: 'Remove avatar' }).click()
    await expect(page.getByText("Ann's avatar removed")).toBeVisible()
    await expect(avatarOf(queueRow(page, 'Ann'), 'Ann')).toHaveAttribute('data-avatar-kind', 'initials')
  })

  test('remove is not offered when there is nothing to remove', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann'])
    const dialog = await openAvatarEditor(page, 'Ann')
    await expect(dialog.getByRole('button', { name: 'Remove avatar' })).toBeDisabled()
  })
})

test.describe('seeing an avatar large', () => {
  test('tapping a small avatar shows the picture large, with the name', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann Lee', 'Bob'])
    await setPhotoAvatar(page, 'Ann Lee')

    // Big enough to make out in a list, not just in the large view.
    const listed = (await avatarOf(queueRow(page, 'Ann Lee'), 'Ann Lee').boundingBox())!
    expect(listed.width).toBeGreaterThanOrEqual(36)
    expect(listed.height).toBeGreaterThanOrEqual(36)
    const small = await avatarOf(queueRow(page, 'Ann Lee'), 'Ann Lee').locator('img').getAttribute('src')
    const view = await viewAvatar(page, 'Ann Lee', queueRow(page, 'Ann Lee'))
    await expect(view.getByRole('heading', { name: 'Ann Lee' })).toBeVisible()
    const large = avatarOf(view, 'Ann Lee')
    await expect(large).toHaveAttribute('data-avatar-kind', 'photo')
    const box = (await large.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(200)
    expect(box.height).toBeGreaterThanOrEqual(200)
    // It is the same picture, not a new one.
    await expect(large.locator('img')).toHaveAttribute('src', small!)
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)
  })

  test('works for emoji and for initials too, and is big enough to read', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann Lee', 'Bob'])
    await setEmojiAvatar(page, 'Bob', '🔥')
    const emoji = await viewAvatar(page, 'Bob')
    await expect(avatarOf(emoji, 'Bob')).toHaveAttribute('data-emoji', '🔥')
    expect((await avatarOf(emoji, 'Bob').boundingBox())!.width).toBeGreaterThanOrEqual(200)
    await page.keyboard.press('Escape')

    const initials = await viewAvatar(page, 'Ann Lee')
    await expect(avatarOf(initials, 'Ann Lee')).toHaveAttribute('data-initials', 'AL')
    expect((await avatarOf(initials, 'Ann Lee').boundingBox())!.width).toBeGreaterThanOrEqual(200)
  })

  test('is available wherever the small avatar is: queue, Next up, court, check-in list and standings', async ({ page }) => {
    await startSession(page, { mode: 'Singles', courts: 2 })
    await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee'])
    await startGame(page, 'Court 1')
    const places = [
      queueRow(page, 'Cy'),
      page.getByRole('group', { name: 'Next up' }),
      page.getByRole('region', { name: 'Court 1', exact: true }),
    ]
    for (const scope of places) {
      const view = await viewAvatar(page, scope === places[0] ? 'Cy' : scope === places[1] ? 'Cy' : 'Ann', scope)
      await expect(view.getByRole('button', { name: 'Change avatar' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(view).toHaveCount(0)
    }
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const view = await viewAvatar(page, 'Cy', page.getByRole('list', { name: 'Waiting players' }).getByRole('listitem'))
    await expect(view).toBeVisible()
  })

  test('Change avatar goes on to the editor, and closing the large view changes nothing', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    const view = await viewAvatar(page, 'Ann')
    await view.getByRole('button', { name: 'Change avatar' }).click()
    await expect(page.getByRole('dialog', { name: 'Avatar for Ann' })).toBeVisible()
    await expect(view).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(avatarOf(queueRow(page, 'Ann'), 'Ann')).toHaveAttribute('data-avatar-kind', 'initials')
  })

  test('tapping the avatar in the roster list shows it large without ticking the player', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Zed'])
    await endSession(page)
    await startSession(page)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const roster = page.getByRole('group', { name: 'Check in from the roster' })
    const view = await viewAvatar(page, 'Zed', roster)
    await page.keyboard.press('Escape')
    await expect(view).toHaveCount(0)
    await expect(roster.getByRole('checkbox', { name: 'Zed' })).not.toBeChecked()
  })
})

test.describe('choosing a picture', () => {
  test('refuses a file that is not a picture, with a message, and keeps the avatar', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann'])
    const dialog = await openAvatarEditor(page, 'Ann')
    await dialog.getByLabel('Choose a photo file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(dialog.getByRole('alert')).toContainText('not a picture')
    await expect(avatarOf(dialog, 'Ann')).toHaveAttribute('data-avatar-kind', 'initials')
  })

  test('refuses a file that claims to be a picture but is not', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann'])
    const dialog = await openAvatarEditor(page, 'Ann')
    await dialog.getByLabel('Choose a photo file').setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') })
    await expect(dialog.getByRole('alert')).toContainText('could not be read')
    await expect(avatarOf(dialog, 'Ann')).toHaveAttribute('data-avatar-kind', 'initials')
  })

  test('offers the camera as well as a file: the second picker asks for the camera', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann'])
    const dialog = await openAvatarEditor(page, 'Ann')
    await expect(dialog.getByRole('button', { name: 'Take photo' })).toBeVisible()
    await expect(dialog.getByLabel('Take a photo with the camera')).toHaveAttribute('capture', 'user')
    await expect(dialog.getByLabel('Choose a photo file')).not.toHaveAttribute('capture', /.*/)
    // A picture from the camera input is used the same way, through the crop step.
    await dialog.getByLabel('Take a photo with the camera').setInputFiles({ name: 'camera.png', mimeType: 'image/png', buffer: TINY_PNG })
    const crop = page.getByRole('dialog', { name: 'Crop photo for Ann' })
    await expect(crop.getByTestId('crop-stage')).toBeVisible()
    await crop.getByRole('button', { name: 'Use photo' }).click()
    await expect(avatarOf(dialog, 'Ann')).toHaveAttribute('data-avatar-kind', 'photo')
  })
})

test.describe('where avatars are kept and shown', () => {
  test('they survive a reload and are still there the next session', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Ann', 'Bob'])
    await setEmojiAvatar(page, 'Ann', '🎾')
    await page.reload()
    await expect(avatarOf(queueRow(page, 'Ann'), 'Ann')).toHaveAttribute('data-emoji', '🎾')

    await endSession(page)
    await startSession(page)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const roster = page.getByRole('group', { name: 'Check in from the roster' })
    await expect(avatarOf(roster, 'Ann')).toHaveAttribute('data-emoji', '🎾')
  })

  test('the roster list lets staff change an avatar without ticking the player', async ({ page }) => {
    await startSession(page)
    await checkIn(page, ['Zed'])
    await endSession(page)
    await startSession(page)
    await page.getByRole('tab', { name: 'Check-in' }).click()
    const roster = page.getByRole('group', { name: 'Check in from the roster' })
    const dialog = await openAvatarEditor(page, 'Zed', roster)
    await dialog.getByRole('button', { name: 'Emoji 🥇' }).click()
    await dialog.getByRole('button', { name: 'Save avatar' }).click()
    await expect(avatarOf(roster, 'Zed')).toHaveAttribute('data-emoji', '🥇')
    await expect(roster.getByRole('checkbox', { name: 'Zed' })).not.toBeChecked()
  })

  test('show in the standings and the end-of-session podium, and in Past sessions without edit buttons', async ({ page }) => {
    await startSession(page, { mode: 'Singles' })
    await checkIn(page, ['Ann', 'Bob'])
    await setEmojiAvatar(page, 'Ann', '🎾')
    await startGame(page)
    await recordWin(page)
    await page.getByRole('tab', { name: 'Standings' }).click()
    await expect(avatarOf(page.getByRole('row').filter({ hasText: 'Ann' }), 'Ann')).toHaveAttribute('data-emoji', '🎾')

    await openSessionMenu(page)
    await page.getByRole('button', { name: 'End session' }).click()
    const end = page.getByRole('dialog', { name: 'End this session?' })
    await expect(avatarOf(end.getByRole('listitem').filter({ hasText: 'Ann' }), 'Ann')).toHaveAttribute('data-emoji', '🎾')
    await expect(end.getByRole('button', { name: /avatar$/ })).toHaveCount(0) // the podium is just a picture
    await end.getByRole('button', { name: 'Save and end session' }).click()
    await expect(page.getByText('Set up an open play session')).toBeVisible()

    await page.getByRole('button', { name: 'Past sessions' }).click()
    await page.getByRole('dialog', { name: 'Past sessions' }).getByRole('button', { name: /Test Club/ }).click()
    const past = page.getByRole('dialog', { name: 'Test Club' })
    await expect(avatarOf(past.getByRole('row').filter({ hasText: 'Ann' }), 'Ann')).toHaveAttribute('data-emoji', '🎾')
    // Past sessions can be looked at large, but nothing can be changed from there.
    const large = await viewAvatar(page, 'Ann', past)
    await expect(large.getByRole('button', { name: 'Change avatar' })).toHaveCount(0)
  })
})

test('the Replace dialog rows have room around the avatar', async ({ page }) => {
  await startSession(page)
  await checkIn(page, ['Ann', 'Bob', 'Cy', 'Dee', 'Eve'])
  await startGame(page)
  await playerAction(page.getByRole('region', { name: 'Court 1' }), 'Ann', 'Swap…')
  const option = page.getByRole('dialog').getByRole('button', { name: /Eve/ })
  const row = (await option.boundingBox())!
  const avatar = (await avatarOf(option, 'Eve').boundingBox())!
  // The avatar is never squeezed against the top or bottom of its row.
  expect(row.height).toBeGreaterThanOrEqual(avatar.height + 8)
  expect(avatar.y - row.y).toBeGreaterThanOrEqual(4)
  expect(row.y + row.height - (avatar.y + avatar.height)).toBeGreaterThanOrEqual(4)
})
