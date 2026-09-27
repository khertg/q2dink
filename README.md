# Q2Dink

Free, offline-first pickleball open play manager (see [docs/pickleq-specs.md](docs/pickleq-specs.md)).

## Repository layout

An npm-workspaces monorepo:

```
apps/web        React app (Vite, Tailwind, shadcn/ui, Dexie, PWA) and its tests
apps/api        Node API (Fastify + Postgres): clubs, live board, club leaderboard (see apps/api/README.md)
packages/shared wire contract used by both: types, snapshot validation, slug rules
docs/           product spec
deploy/         production deployment: Caddy + API + Postgres on one server (see deploy/README.md)
```

Run everything from the repository root: `npm install` once, then the scripts below. Each script runs in every workspace that defines it.

**Stack:** React, Vite, TypeScript, Tailwind CSS, Dexie (IndexedDB), Zustand, vite-plugin-pwa, Vitest.

## Scripts

- `npm run dev`: start the dev server
- `npm run build`: type-check and build (also generates the service worker)
- `npm test`: run unit tests
- `npm run typecheck`: type-check every workspace
- `npm run lint`: lint every workspace with oxlint
- `npm run test:e2e`: Playwright end-to-end tests (desktop and mobile Chrome) against production builds; `npm run test:e2e:ui` opens the interactive runner. First run needs `npx playwright install chromium`. Tests and config live in `apps/web/e2e` and `apps/web/playwright.config.ts`. Cloud features run against a second build (`npm run build:cloudtest`) that talks to a **real API** (embedded Postgres, started automatically for each run), so the whole stack is tested end to end.
- `npm test -w @q2dink/api`: the API suite on embedded Postgres; set `TEST_DATABASE_URL` to run it on a real Postgres instead (CI does both).

Requires Node 24 (what CI and the Docker images use; built with Node 26).

## Using the app

1. **Setup:** location, number of courts (1 to 15), Doubles or Singles, average game length, and (for doubles) a matchmaking mode.
2. **Check-in tab:** add players by name and skill level (gender is optional, required for mixed doubles). Returning players auto-complete from the saved roster (IndexedDB). Skill levels are the club's choice (**Skill levels** on the setup screen): by default the suggested DUPR ranges (Beginner NR / < 2.50, Novice 2.50–2.99, Low Intermediate 3.00–3.49, Intermediate 3.50–3.99, Advanced 4.00–4.49, Elite / Pro 4.50+, each with a short description), or the [USA Pickleball skill ratings](https://usapickleball.org/skill-level/), or your own list of 2 to 10 levels with their own names, ranges and descriptions. Each player keeps a rating (1.0 to 8.0, DUPR style) and lands in whichever level holds it, so changing the levels never loses anyone's place; a running session keeps its levels until staff choose **Use the club's new levels** in its menu. Tap a player's level badge anywhere on the Board or Check-in tab (or in the roster list) to change it: it is saved to their roster entry, and matching and Next up use the new level from then on, while games already on a court and recorded results stay as they were. A misspelt name can be fixed: tap the player's avatar anywhere (queue, courts, Next up, check-in lists, roster list, standings) and press **Edit name**. The saved player and the running session use the new name (a name another player already has is refused, but changing only the capitals is fine), their all-time totals and avatar stay with them, and when a club is connected its leaderboard row and shared avatar move to the new name too (queued and sent when online). Sessions that already ended keep the name they had that day. To check in regulars in one go, tick them in **Check in from the roster** (they queue in the order you tick them, with their saved skill and gender) and press one button. In doubles you can lock two players as partners (from the Partners card or a player's ⋮ menu): they share a team and wait in the queue together, at the later partner's place, so a lock never moves anyone ahead of people who were waiting. The app always explains what will happen before locking. If one of them is on a court or a break, you choose: **Wait for 1 game** (each keeps their own turn until both have finished a game) or **Lock now** (the one waiting holds, shown as "Waits for …", and they queue together once the other is back). A swap or removal that would break a lock asks first, and the activity log says which partners were unlocked and by what.
3. **Board tab:** **games never start by themselves.** The **Next up** card, just above the queue, shows the next four players (two in singles), already split into Team A and Team B, and the queue marks them too. Press **Start game** on the court that is free to put them on it; Next up then moves on to the following four. Courts show both teams; press "Team A won" or "Team B won" and enter the score in the pop-up (0 to 99 each; the winner's box starts at 11, so you only type the other score; the winner's score must be higher, and every game is finished with a score). Closing the pop-up records nothing. Each court shows how long its game has been going, and finishing a game adds that time (at most 3 hours) to everyone on the court. Players rejoin the back of the queue and the court stays open until you start the next game. Players on a break are skipped. Undo is available for 10 seconds, until anything else changes. **Cancel game** asks first, since nothing is recorded and it cannot be undone. Players watching the live page see the same Next up card. The replace button next to a player on a court swaps in someone waiting: the player who comes off goes to the front of the queue, or on a break if you tick that. The same button next to a player in **Next up** puts a different waiting player in the group (the replaced player keeps their place in the queue); the group stays as you set it until a game starts or someone in it leaves the queue, and **Reset** returns to the automatic group. **Manage courts** is where courts are added mid-session (there is no separate Add court button on the Board), renamed, reordered or closed. Closing a court with a game in progress asks first, then puts its players back at the front of the queue.
4. **Standings tab:** ranked by wins, then point differential (from entered scores; winner-only results add no points), then opponent strength, then win rate, with medals for the top three, each player's time played and total time waiting in the queue before their games, and a downloadable square stats card per player. Under the ranking, **Partners and opponents** shows how often players teamed up or faced each other again over the whole session: repeated partnerships and opponent pairings as a share of all of them, the most repeated pair, and for each player how many different partners and opponents they had and their most repeated ones (tap a name for the full list with counts). It is also shown for each ended session in Past sessions. The public live page does not show it, because it carries no game history.
5. **End session:** shows the final top players and can save results to the all-time (lifetime) leaderboard, which is available from the setup screen with a minimum-games filter. **Every ended session is kept** under **Past sessions** on the setup screen, with its full ranking, whether or not the results were saved to the all-time totals. **Deleting** one moves it to **Recently deleted** (with an **Undo** right away), where it can be **restored** or **deleted for good** for 30 days; with a club, this applies on every staff device. Ended by accident? A **Resume** button stays on screen for 30 seconds after ending, and any past session can be resumed later exactly as it ended (queue, games in progress, standings). A resumed session only adds the games played since to the all-time totals, so nothing is counted twice. Sessions are stored on the device (the latest 100), and also in the club cloud when signed in, so history and resume work from another staff device.

Matchmaking modes (doubles): *Auto-balanced* (first come, first served, even teams), *Skill-separated*, *Winners vs. Losers*, and *Mixed doubles* (one man and one woman per team). Mixed doubles never offers a non-mixed group as next up; if no valid group exists yet, use "Start with waiting players" on an open court.

**Partners and opponents rotate in every mode.** The app remembers who teamed up, and who played against whom, in the last 12 finished games. Teams are split so the same partners are not paired again (then the same opponents), unless that would make clearly lopsided teams, and a foursome that has just played together counts as a few places further back in the queue, so someone waiting a little longer can take a spot. Winners vs. Losers keeps its ladder (winners still play winners), only the partners and opponents inside the group change. Locked partners always stay together. With very few players some repeats cannot be avoided.

The active session is saved on the device, so a reload or going offline keeps it.

**Setting up, starting, pausing and leaving:** **Create session** sets a session up without starting it: check players in and arrange courts at your own pace, and no waiting time runs and no game can start until you press **Start session** at the top (it cannot go live before that either). **Pause** stops every clock (waiting times and games in progress, which are recorded without the pause) and no new game starts until **Resume**; check-ins and scores still work. **Leave session** (in the session menu) goes back to the setup screen without ending it: the session is listed under **Open sessions** to open again, and it is paused while nobody looks after it, unless another staff device still has it open. You can run **several sessions at once** (for example two venues, or a morning and an evening group): each one has its own board, queue and live page.

**Reset this device** (next to **Log out** in the club panel, or on the setup screen without a club) removes everything the app keeps on the device (saved players, past sessions, a running session, settings and the login), as if it were just installed. Anything the club has not been sent yet is listed first, with **Try sending first**. The club's own data on the server is kept and comes back after logging in again; the device keeps its name.

**Light and dark theme:** the button in the top-right corner of every screen (login, setup, session and the players' live page) chooses **Light**, **Dark** or **System** (follow the phone or computer, which is the default). The choice is remembered on the device.

## Player avatars

Every player has a round **avatar**, changeable at any time. (Clubs no longer have a logo; the Q2Dink mark is shown instead.)

- **Avatars:** with nothing set a player shows their initials on a colour taken from their name. **Tap any avatar to see the picture large** (on the Board, Next up, courts, Check-in lists, roster list and standings, and on the players' live page). Staff get a **Change avatar** button in that large view to choose a **photo** (from a file, or taken with **Take photo**: on a computer this opens a live camera view in the app with a **Take picture** button and, when the computer has several cameras, **Switch camera**; on a phone or tablet it opens the device's own camera app; if the camera is blocked or unavailable the app says why and offers the file picker instead), an **emoji**, or a **colour**, or to remove it. After choosing or taking a photo you **crop it yourself**: drag the picture inside the round frame and pinch, scroll or use the slider to zoom (arrow keys and + / - work too). Photos are saved as a 128px square and shrunk, so they stay small and work offline. An avatar belongs to the roster player, so it shows everywhere they appear, in every future session, on the stats card and on the end-of-session podium.
- **In the club cloud (signed in):** emoji and initials avatars are sent to the club, so the players' live page and other staff devices show them. **Photos are not shared unless staff switch on "Show player photos on the live page"** in the club panel (off by default, because anyone with the live link can then see them); switching it off removes the photos from the server. A device's own avatar wins over the club's for the same player, and the club's is matched by name.

## Cloud sync and live board

With the API running (see [apps/api/README.md](apps/api/README.md); `npm run dev -w @q2dink/api` needs no database) the app opens on a **login screen**: staff create a club (a password of at least 8 characters, and a one-time **recovery code**) or log in to their club before they can use it. The login is kept on the device, so the app then opens and works with no signal; it is asked for again only after **Log out** (the roster, sessions and history stay on the device) or when the login expires (30 days). You need a connection the first time you log in on a device. The public live page never asks for a login. Logging in gives you:

- a **live board** at `/club/<your-club>/live` that players open from a QR code (**Share live view**): courts, queue with wait times, and standings, updating by itself. **A new session is not live**: staff set it up privately and choose **Go live** in the session menu when players should see it (**Stop live** takes it off again; the dot in the top bar shows which). Staff devices share the session either way;
- **several staff devices on one session**: open it from **Open sessions** on the setup screen, and changes on any device show on all of them. When one device pauses, the others are told straight away which device paused it, with a **Resume** button;
- **several sessions at once**, each on its own live page at `/club/<your-club>/live/<session>` (the session's **Share live view**); the club's own link offers a choice when more than one is live;
- an **all-time club leaderboard** combined across devices.

Point the web app at the API with `VITE_API_URL=/api` (see `apps/web/.env.example`; the dev server proxies `/api` to `http://localhost:8787`). Without it there is no login: the app runs entirely on the device and every cloud feature is hidden. Changes made offline are held and sent when the connection returns.

## Version

The app shows its build at the bottom of every screen (login, setup, session and the players' live page), for example `v0.1.0 · a1b2c3d · 21 Sep 2026`: the release number, the git commit it was built from and the build date. It tells you which build a phone is really running, which matters for an installed app that updates itself in the background. Hover it for the full details. `GET /api/health` reports the API's own `version` and `commit`. A local build shows `dev` when git is not available, and Docker builds need `--build-arg GIT_SHA=$(git rev-parse --short HEAD)` (the compose files pass it through from the `GIT_SHA` environment variable).

**To release:** bump the one number in the root `package.json` (`npm version minor --no-git-tag-version` at the repo root), commit it, and deploy. The workspace packages stay `0.0.0`; nothing reads them.

## UI (shadcn/ui)

Components live in `apps/web/src/components/ui` and are ours to edit. Add more with `npx shadcn@latest add <name>`. Import them via the `@/` alias, e.g. `@/components/ui/button`. Theme tokens (green primary, light and dark) are in `apps/web/src/index.css`; dark mode is toggled through `next-themes`.

## Docker

**Development** (`docker-compose.yml`): the web app, the API and a Postgres database, all with hot reload.

```bash
docker compose up            # web http://localhost:5173, API http://localhost:8787, Postgres on 127.0.0.1:5432, Adminer http://localhost:8080
docker compose down -v       # after changing dependencies, so the containers get the new packages
```

The web app proxies `/api` to the API, so the cloud features work with no extra setup. You can also run each
piece without Docker: `npm run dev` (web) and `npm run dev -w @q2dink/api` (API, with an embedded database).

**Production** is one small server running Caddy, the API and Postgres. See [deploy/README.md](deploy/README.md)
for the step-by-step guide, backups and updates.

## Court rotation

`apps/web/src/rotation/engine.ts` is a pure, immutable engine (check-in, queue, court assignment, results, substitutions, wait estimates). Keep the previous state to implement the 10-second undo.
