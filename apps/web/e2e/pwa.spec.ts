import { expect, test } from '@playwright/test'

test('serves a web app manifest', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest')
  expect(res.ok()).toBe(true)
  const manifest = await res.json()
  expect(manifest.name).toBe('Q2Dink')
  expect(manifest.display).toBe('standalone')
  expect(manifest.theme_color).toBe('#16a34a')
})

test('keeps working offline after the first load', async ({ page, context }) => {
  await page.goto('/')
  // Wait for the service worker to take control so the app shell is precached.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByText('Set up an open play session')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create session' })).toBeVisible()
})
