import { expect, test } from '@playwright/test'

test('renders the setup screen', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Q2Dink')
  await expect(page.getByText('Set up an open play session')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Doubles' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Singles' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Create session' })).toBeEnabled()
})

test('blocks an invalid number of courts', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Number of courts (1 to 15)').fill('16')
  await expect(page.getByText('Enter a whole number from 1 to 15.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create session' })).toBeDisabled()

  await page.getByLabel('Number of courts (1 to 15)').fill('15')
  await expect(page.getByRole('button', { name: 'Create session' })).toBeEnabled()
})

test('blocks an invalid game length', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Average game length (minutes)').fill('4')
  await expect(page.getByText('Enter a whole number from 5 to 60.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create session' })).toBeDisabled()
})

test('loads without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Create session' })).toBeVisible()

  expect(errors).toEqual([])
})
