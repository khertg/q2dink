import { expect, test, type APIRequestContext } from '@playwright/test'
import { failOnCspViolations } from '../cspWatch'
import { apiCreateClub, apiLive, apiPublish, bearer, liveSnapshot, uniqueClub } from './support'

failOnCspViolations(test)

/** A club that is already running a session, published straight to the API. */
async function runningClub(request: APIRequestContext, snapshot: object = liveSnapshot()) {
  const club = uniqueClub('Sunset')
  const { token } = await apiCreateClub(request, club)
  await apiPublish(request, token, snapshot)
  return { club, token }
}

test.describe('live viewer', () => {
  test('shows each court’s skill levels and the next group per level', async ({ page, request }) => {
    const snapshot = {
      ...liveSnapshot(),
      courts: [
        { id: 1, name: 'Court 1', teams: [[1, 2], [3, 4]], levels: [4, 6] },
        { id: 2, name: 'Court 2', teams: null, levels: [1, 3] },
      ],
      nextUp: [],
      nextUpLanes: [
        { levels: [4, 6], players: [] },
        { levels: [1, 3], players: [] },
      ],
    }
    const { club } = await runningClub(request, snapshot)
    await page.goto(`/club/${club.slug}/live`)

    await expect(page.getByRole('region', { name: 'Court 1' }).getByRole('img', { name: 'Skill levels: 3.50+' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Court 2' }).getByRole('img', { name: 'Skill levels: Up to 3.49' })).toBeVisible()
    const nextUp = page.getByRole('group', { name: 'Next up' })
    await expect(nextUp.getByRole('region', { name: '3.50+' })).toContainText('No group is ready yet.')
    await expect(nextUp.getByRole('region', { name: 'Up to 3.49' })).toBeVisible()
  })

  test('still opens from the older address without /live, and shows the new one', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}`)

    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`/club/${club.slug}/live`)
  })

  test('shows the courts, queue and standings without staff controls', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)

    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
    await expect(page.getByText('Skill-separated')).toBeVisible()

    const court1 = page.getByRole('region', { name: 'Court 1' })
    await expect(court1.getByText('In play')).toBeVisible()
    await expect(court1.getByRole('img', { name: 'Skill levels: All levels' })).toBeVisible()
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(court1.getByText(name)).toBeVisible()
    await expect(page.getByRole('region', { name: 'Court 2' }).getByText('Open')).toBeVisible()

    await expect(page.getByText('Queue (2)')).toBeVisible()
    await expect(page.getByText('Eve')).toBeVisible()
    await expect(page.getByLabel('Locked with Fay')).toBeVisible()

    // Players can look but not touch.
    await expect(page.getByRole('button', { name: /won$/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Replace/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Change .*level/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Cancel game' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'End session' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Check-in' })).toHaveCount(0)
  })

  test('shows who is next up, and marks them in the queue', async ({ page, request }) => {
    const { club } = await runningClub(request, {
      ...liveSnapshot(),
      courts: [
        { id: 1, name: 'Court 1', teams: null },
        { id: 2, name: 'Court 2', teams: null },
      ],
      queue: [1, 2, 3, 4, 5, 6],
      partners: [],
      nextUp: [1, 3, 2, 4],
    })
    await page.goto(`/club/${club.slug}/live`)

    const nextUp = page.getByRole('group', { name: 'Next up' })
    await expect(nextUp.getByRole('group', { name: 'Blue' })).toBeVisible()
    await expect(nextUp.getByRole('group', { name: 'Orange' })).toBeVisible()
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee']) await expect(nextUp.getByText(name)).toBeVisible()
    await expect(nextUp.getByText('Eve')).toHaveCount(0)
    await expect(page.getByText('Next up', { exact: true })).toHaveCount(5) // card title + four queue badges
    // The card sits above the queue, as on the staff board.
    const nextUpTop = (await nextUp.boundingBox())!.y
    const queueTop = (await page.getByText(/^Queue \(/).boundingBox())!.y
    expect(nextUpTop).toBeLessThan(queueTop)
    // Players can look but not change anything, including who is next up.
    await expect(page.getByRole('button', { name: /^Options for / })).toHaveCount(0)
    // The only buttons are the ones that show a picture large.
    for (const button of await nextUp.getByRole('button').all()) {
      await expect(button).toHaveAccessibleName(/^View .*avatar$/)
    }
    // Players can look but not start anything.
    await expect(page.getByRole('button', { name: /Start/ })).toHaveCount(0)
  })

  test('says so when no group is ready yet', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByRole('group', { name: 'Next up' })).toContainText('No group is ready yet')
  })

  test('shows standings with medals and no share buttons', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await page.getByRole('tab', { name: 'Standings' }).click()

    const rows = page.getByRole('row')
    await expect(rows.nth(1)).toContainText('Gold medal')
    await expect(rows.nth(1)).toContainText('100%')
    await expect(page.getByRole('button', { name: /^Share card/ })).toHaveCount(0)
  })

  test('shows the podium, with tied players sharing a place', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await page.getByRole('tab', { name: 'Standings' }).click()
    // Ann and Bob both won both games: they share gold, so the next place is bronze.
    await expect(page.getByRole('listitem', { name: /^1st place: Ann and Bob,/ })).toBeVisible()
    await expect(page.getByRole('listitem', { name: /^3rd place: Cy and Dee,/ })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Podium' }).getByRole('listitem')).toHaveCount(2)
  })

  test('does not show the partners and opponents card: the live page carries no game history', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await page.getByRole('tab', { name: 'Standings' }).click()
    await expect(page.getByRole('row').nth(1)).toContainText('Gold medal') // the standings themselves are there
    await expect(page.getByRole('group', { name: 'Partners and opponents' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Partners and opponents of/ })).toHaveCount(0)
  })

  test('shows the point differential and time played of each player', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await page.getByRole('tab', { name: 'Standings' }).click()

    await expect(page.getByRole('columnheader', { name: '+/-' })).toBeVisible()
    const rows = page.getByRole('row')
    // Columns: 0 rank, 1 player, 2 GP, 3 W, 4 L, 5 Win %, 6 +/-, 7 Opp., 8 Time.
    await expect(rows.filter({ hasText: 'Ann' }).getByRole('cell').nth(6)).toHaveText('+8')
    await expect(rows.filter({ hasText: 'Ann' }).getByRole('cell').nth(8)).toHaveText('21m')
    await expect(rows.filter({ hasText: 'Dee' }).getByRole('cell').nth(6)).toHaveText('-8')
  })

  test('shows a dash for a board from an older app that sends no scores or time', async ({ page, request }) => {
    const stats = { games: 2, wins: 2, losses: 0, opponentSkill: 6 }
    const { club } = await runningClub(request, { ...liveSnapshot(), stats: { 1: stats, 2: { ...stats, wins: 0, losses: 2 } } })
    await page.goto(`/club/${club.slug}/live`)
    await page.getByRole('tab', { name: 'Standings' }).click()

    const ann = page.getByRole('row').filter({ hasText: 'Ann' }).getByRole('cell')
    await expect(ann.nth(3)).toHaveText('2')
    await expect(ann.nth(6)).toHaveText('-')
    await expect(ann.nth(8)).toHaveText('-')
  })

  test('explains when no session is running, for any club', async ({ page, request }) => {
    const idle = uniqueClub('Idle')
    await apiCreateClub(request, idle)
    for (const slug of [idle.slug, uniqueClub('Ghost').slug]) {
      await page.goto(`/club/${slug}/live`)
      await expect(page.getByText('No game in progress')).toBeVisible()
    }
  })

  test('rejects an invalid club link', async ({ page }) => {
    await page.goto('/club/NOT_VALID/live')
    await expect(page.getByText(/That club link isn.t valid/)).toBeVisible()
  })

  test('refuses to render data from a newer version instead of showing something broken', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.route(/\/api\/clubs\/[^/]+\/live$/, (route) =>
      route.fulfill({
        json: { state: { ...liveSnapshot(), schemaVersion: 99 }, updatedAt: new Date().toISOString() },
      }),
    )
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByText('This board needs a newer version of Q2Dink')).toBeVisible()
    await expect(page.getByText('Ann')).toHaveCount(0)
  })

  test('is usable on a phone without horizontal scrolling', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)

    // The standings, with their extra columns, scroll inside their card instead of the page.
    await page.getByRole('tab', { name: 'Standings' }).click()
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeAttached()
    const standingsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(standingsOverflow).toBeLessThanOrEqual(0)
  })
})

test.describe('live updates', () => {
  test('changes on screen within moments of the club changing the board, with no refresh', async ({ page, request }) => {
    const { club, token } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByText('Queue (2)')).toBeVisible()

    // The club moves a game along: court 2 fills from the queue. The polling fallback runs every
    // 15 seconds, so seeing this within a few seconds proves the pushed stream is working.
    await apiPublish(request, token, {
      ...liveSnapshot(),
      courts: [liveSnapshot().courts[0], { id: 2, teams: [[5, 6], [1, 2]] }],
      queue: [],
    })
    await expect(page.getByRole('region', { name: 'Court 2' }).getByText('In play')).toBeVisible({ timeout: 6000 })
    await expect(page.getByText('No one waiting')).toBeVisible()
  })

  test('goes back to "no game" the moment the club ends the session', async ({ page, request }) => {
    const { club, token } = await runningClub(request)
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()

    await request.delete('/api/session', { headers: bearer(token) })
    await expect(page.getByText('No game in progress')).toBeVisible({ timeout: 6000 })
    expect((await apiLive(request, club.slug)).status()).toBe(404)
  })

  test('picks a session up when a club starts one while the page is already open', async ({ page, request }) => {
    const club = uniqueClub('Waiting')
    const { token } = await apiCreateClub(request, club)
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByText('No game in progress')).toBeVisible()

    await apiPublish(request, token, liveSnapshot('Just Started'))
    await expect(page.getByRole('heading', { name: 'Just Started' })).toBeVisible({ timeout: 6000 })
  })

  test('keeps working by polling when the live stream is blocked', async ({ page, request }) => {
    const { club, token } = await runningClub(request)
    await page.route('**/live/stream', (route) => route.abort('connectionrefused'))
    await page.clock.install()
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByText('Queue (2)')).toBeVisible()

    await apiPublish(request, token, { ...liveSnapshot(), queue: [5] })
    await page.clock.runFor(16_000)
    await expect(page.getByText('Queue (1)')).toBeVisible()
  })

  test('keeps the last board on screen, and says so, when the connection drops', async ({ page, request }) => {
    const { club } = await runningClub(request)
    await page.clock.install()
    await page.goto(`/club/${club.slug}/live`)
    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()

    await page.route('**/api/**', (route) => route.abort('connectionrefused'))
    await page.clock.runFor(16_000)
    await expect(page.getByText(/Offline\. Showing the update from/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()

    await page.unroute('**/api/**')
    await page.clock.runFor(16_000)
    await expect(page.getByText(/^Updated /)).toBeVisible()
  })

  test('never receives private details', async ({ page, request }) => {
    const club = uniqueClub('Private')
    const { token } = await apiCreateClub(request, club)
    const snapshot = liveSnapshot()
    // A buggy client that sends genders and extra fields on the public board.
    const dirty = {
      ...snapshot,
      email: 'owner@example.com',
      players: Object.fromEntries(
        Object.entries(snapshot.players).map(([id, p]) => [id, { ...p, gender: 'F', phone: 'private-phone-number' }]),
      ),
    }
    await apiPublish(request, token, dirty)

    // Wait for the board itself rather than collecting replies in the background.
    const board = page.waitForResponse((r) => /\/api\/clubs\/[^/]+\/live$/.test(r.url()))
    await page.goto(`/club/${club.slug}/live`)
    const body = await (await board).text()
    expect(body).toContain('Sunset Courts')
    expect(body).not.toMatch(/gender|email|phone|owner@/)

    // Nor did anything private make it onto the page the player sees.
    await expect(page.getByRole('heading', { name: 'Sunset Courts' })).toBeVisible()
    // (A marker that cannot turn up by chance, as digits can in the version label's commit id.)
    expect(await page.content()).not.toMatch(/gender|owner@example|private-phone-number/)
  })
})
