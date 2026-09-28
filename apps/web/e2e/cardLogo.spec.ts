import { expect, test, type Locator, type Page } from '@playwright/test'
import { checkIn, recordWin, startGame, startSession } from './helpers'

/** A PNG of a round logo in one colour on a transparent background, made by the browser. */
async function logoPng(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 100
    const context = canvas.getContext('2d')!
    context.fillStyle = fill
    context.beginPath()
    context.ellipse(100, 50, 90, 40, 0, 0, Math.PI * 2)
    context.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  }, color)
  return Buffer.from(base64, 'base64')
}

/** Pick a logo file and add it whole (Original) from the shape step. */
async function addLogo(page: Page, dialog: Locator, color: string, name: string) {
  const count = await dialog.getByRole('radio', { name: /^Logo \d$/ }).count()
  await dialog.getByLabel('Logo file').setInputFiles({ name, mimeType: 'image/png', buffer: await logoPng(page, color) })
  const crop = page.getByRole('dialog', { name: 'Add logo' })
  await expect(crop.getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true')
  await crop.getByRole('button', { name: 'Add logo' }).click()
  await expect(crop).toHaveCount(0)
  await expect(dialog.getByRole('radio', { name: /^Logo \d$/ })).toHaveCount(count + 1)
}

/** The size of logo `n`'s image, and the alpha of its top-left corner and of its centre. */
async function logoPixels(dialog: Locator, n: number) {
  return thumbnail(dialog, n).evaluate(async (img: HTMLImageElement) => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(img, 0, 0)
    const alpha = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      corner: alpha(1, 1),
      centre: alpha(Math.floor(img.naturalWidth / 2), Math.floor(img.naturalHeight / 2)),
    }
  })
}

const cardLogo = (dialog: Locator) => dialog.getByRole('img', { name: 'Club logo' })
const thumbnail = (dialog: Locator, n: number) => dialog.getByRole('radio', { name: `Logo ${n}` }).locator('img')

async function expectCardShows(dialog: Locator, n: number) {
  const src = await thumbnail(dialog, n).getAttribute('src')
  for (const logo of await cardLogo(dialog).all()) await expect(logo).toHaveAttribute('src', src!)
}

test('club logos: automatic by card colour, picked, none, and removed; the Stats card uses the same', async ({ page }) => {
  await startSession(page, { mode: 'Singles' })
  await checkIn(page, ['Ann', 'Bob'])
  await startGame(page)
  await recordWin(page)
  await page.getByRole('tab', { name: 'Standings' }).click()
  await page.getByRole('button', { name: 'Share standings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share standings' })

  // No logos yet: the card looks as it always did.
  await expect(cardLogo(dialog)).toHaveCount(0)
  await addLogo(page, dialog, '#ffffff', 'white.png')
  await addLogo(page, dialog, '#000000', 'black.png')
  await expect(dialog.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')

  // Automatic: the white logo on the default dark card, the black one on a light colour.
  await expectCardShows(dialog, 1)
  await expect(dialog.getByText('Automatic uses logo 1 on this colour, the one that stands out best.')).toBeVisible()
  await dialog.getByLabel('Custom colour').fill('#fde047')
  await expectCardShows(dialog, 2)

  // Picked: the same logo whatever the colour.
  await dialog.getByRole('radio', { name: 'Logo 1' }).click()
  await expectCardShows(dialog, 1)
  await dialog.getByRole('radio', { name: 'Court' }).click()
  await expectCardShows(dialog, 1)

  await dialog.getByRole('radio', { name: 'No logo' }).click()
  await expect(cardLogo(dialog)).toHaveCount(0)
  await dialog.getByRole('radio', { name: 'Logo 2' }).click()
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Share card for Ann' }).click()
  const stats = page.getByRole('dialog', { name: 'Stats card' })
  await expect(stats.getByRole('radio', { name: 'Logo 2' })).toHaveAttribute('aria-checked', 'true')
  await expectCardShows(stats, 2)

  // Removing the picked logo asks first, then goes back to automatic.
  await stats.getByRole('button', { name: 'Remove logo 2' }).click()
  await page.getByRole('dialog', { name: 'Remove logo 2?' }).getByRole('button', { name: 'Remove' }).click()
  await expect(stats.getByRole('radio', { name: /^Logo \d$/ })).toHaveCount(1)
  await expect(stats.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true')
  await expectCardShows(stats, 1)
})

test('club logos can be set up from the Create session page, before any session', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Club logos' }).click()
  const dialog = page.getByRole('dialog', { name: 'Club logos' })
  await addLogo(page, dialog, '#ffffff', 'white.png')
  await dialog.getByRole('radio', { name: 'Logo 1' }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()

  await startSession(page, { mode: 'Singles' })
  await checkIn(page, ['Ann', 'Bob'])
  await startGame(page)
  await recordWin(page)
  await page.getByRole('tab', { name: 'Standings' }).click()
  await page.getByRole('button', { name: 'Share standings' }).click()
  const share = page.getByRole('dialog', { name: 'Share standings' })
  await expect(share.getByRole('radio', { name: 'Logo 1' })).toHaveAttribute('aria-checked', 'true')
  await expectCardShows(share, 1)
})

test('a logo can be cut to a circle or a wide banner when it is added, and Back adds nothing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Club logos' }).click()
  const dialog = page.getByRole('dialog', { name: 'Club logos' })
  // A filled square picture: every pixel opaque before it is cut.
  const square = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 400
      canvas.height = 400
      const context = canvas.getContext('2d')!
      context.fillStyle = '#1d4ed8'
      context.fillRect(0, 0, 400, 400)
      return canvas.toDataURL('image/png').split(',')[1]
    }),
    'base64',
  )
  const pick = () => dialog.getByLabel('Logo file').setInputFiles({ name: 'square.png', mimeType: 'image/png', buffer: square })
  const crop = page.getByRole('dialog', { name: 'Add logo' })

  await pick()
  await crop.getByRole('button', { name: 'Back' }).click()
  await expect(crop).toHaveCount(0)
  await expect(dialog.getByRole('radio', { name: /^Logo \d$/ })).toHaveCount(0)

  await pick()
  await crop.getByRole('radio', { name: 'Circle' }).click()
  await expect(crop.getByTestId('crop-stage')).toBeVisible()
  await crop.getByRole('button', { name: 'Add logo' }).click()
  await expect(dialog.getByRole('radio', { name: 'Logo 1' })).toBeVisible()
  const circle = await logoPixels(dialog, 1)
  expect(circle.width).toBe(circle.height)
  expect(circle.corner).toBe(0)
  expect(circle.centre).toBe(255)

  await pick()
  // A new file starts on Original again.
  await expect(crop.getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true')
  await crop.getByRole('radio', { name: 'Wide' }).click()
  await crop.getByRole('button', { name: 'Add logo' }).click()
  await expect(dialog.getByRole('radio', { name: 'Logo 2' })).toBeVisible()
  const wide = await logoPixels(dialog, 2)
  expect(wide.width).toBe(wide.height * 2)
  expect(wide.corner).toBe(255)
})
