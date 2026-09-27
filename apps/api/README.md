# Q2Dink API

The server behind the optional cloud features: club login, the public live board, resuming a session on a
second device, and the club leaderboard. It is a small [Fastify](https://fastify.dev) app on Postgres.

The web app works fully without it. Everything here is opt-in.

## Run it

```bash
npm install                      # once, from the repository root
npm run dev -w @q2dink/api      # http://localhost:8787, hot reload
```

With no configuration it uses an **embedded Postgres (PGlite)** stored in `apps/api/.data`, so you need no
database or Docker to develop. To use a real Postgres, set `DATABASE_URL` (see `.env.example`). The schema is
created automatically on start.

## Configuration

All settings are environment variables. Nothing is required in development.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `pglite://./.data` | `postgres://user:pass@host:5432/db` in production. `pglite://memory` for throwaway data. **Required in production**; the embedded database is refused there. |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Where to listen. |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy (Caddy, nginx) so rate limits see the real client address. |
| `ALLOWED_ORIGINS` | none | Comma-separated origins allowed to call the API from a browser. Leave empty when the web app and API share one origin (the normal setup). |
| `TOKEN_TTL_DAYS` | `30` | How long a staff login lasts. |
| `LIVE_TTL_HOURS` | `24` | A live board nobody has updated for this long counts as ended. |
| `AUDIT_RETENTION_DAYS` | `180` | How long the club's activity log keeps an entry. |
| `RATE_LIMIT_MAX` | `300` | Requests per minute per address, all routes. |
| `RATE_LIMIT_AUTH_MAX` | `10` | Create club, login and password reset, per 15 minutes per address (each has its own budget). |
| `RATE_LIMIT_WRITE_MAX` | `240` | Publish and clear, per minute per address. |
| `LOGIN_MAX_FAILURES_PER_IP` | `5` | Wrong passwords for one club from one address per 15 minutes before it is locked. |
| `LOGIN_MAX_FAILURES_PER_CLUB` | `25` | The same, counted across all addresses. |
| `MAX_SUBSCRIBERS_PER_IP` / `_TOTAL` | `20` / `2000` | Open live-board streams. |
| `SSE_HEARTBEAT_MS` | `25000` | Keep-alive interval for live-board streams. |
| `LOG_LEVEL` | `info` | pino log level. |

## API

Everything is under `/api` and speaks JSON. Errors look like `{ "error": "<code>", "message": "..." }`
(codes are listed in `packages/shared/src/protocol.ts`). Staff routes need `Authorization: Bearer <token>`.

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /clubs` `{name, slug, password}` | none | Create a club. Returns `{token, recoveryCode}`; the recovery code is shown **once**. `409 club_slug_taken`, `400 weak_password` / `invalid_club`. |
| `POST /clubs/:slug/login` `{password}` | none | Returns `{token, name}`. An unknown club and a wrong password give the same `401 invalid_credentials`. |
| `POST /clubs/:slug/reset-password` `{recoveryCode, newPassword}` | none | Set a new password using the recovery code. Revokes every login and returns a new `{token, recoveryCode, name}`. |
| `POST /logout` | staff | End this login. |
| `PUT /session` `{public, full, live?}` | staff | Publish the running session. `public` is validated and stripped to known fields; `full` is a private backup. With `live: false` the public board is taken down (viewers get `cleared`) while the private copy is still stored for staff devices; missing `live` (older apps) means live. |
| `GET /session?sessionId` | staff | The private backup, for resuming on another device (`404` if none). A club runs several sessions at once, each keyed by the `sessionId` sent with `PUT /session`; with no `sessionId` (older apps) this and the routes below mean the club's latest session. |
| `GET /session/state?sessionId` | staff | The private copy with its revision, for staff devices running a session together. |
| `GET /sessions` | staff | Every session the club is running: name, `status` (`notStarted`/`paused`/`running`), live or not, players, who paused it, and `openOn` (staff devices that have it open). |
| `PUT /sessions/:id/presence` `{deviceId}` / `DELETE …?deviceId` | staff | This device has the session open (sent every 15 s) / left it. Leaving a session pauses it only when no other device has it open. |
| `DELETE /session?sessionId` | staff | That session ended; the club's other sessions keep running. |
| `PUT /history/:id` `{endedAt, mode, players, games, full}` | staff | Keep an ended session in the club's history (`id` is a UUID made by the device). Sending the same id again replaces it; the newest 100 per club are kept. `full` is a private backup, like `PUT /session`. |
| `GET /history` | staff | The club's ended sessions that are not deleted, newest first, without their contents. |
| `GET /history/deleted` | staff | Recently deleted: `{sessions}` with `deletedAt`, most recently deleted first. Sessions deleted more than 30 days ago are removed for good. |
| `GET /history/:id` | staff | One ended session in full, deleted or not (`404` if unknown or another club's). |
| `DELETE /history/:id` | staff | Move an ended session to Recently deleted (a `PUT` of it later keeps it deleted). With `?permanent=1`, remove it for good. |
| `POST /history/:id/restore` | staff | Bring a deleted session back. |
| `POST /lifetime` `{batchId, players[]}` | staff | Add a session's totals to the club leaderboard. A `batchId` is applied once, so retries are safe. |
| `POST /players/rename` `{from, to}` | staff | A player was renamed: their leaderboard row and shared avatar move to the new name (matched ignoring case). If the new name already has totals they are added together; if it already has an avatar that one is kept. A name the club has nothing under is a successful no-op, so it is safe to repeat. |
| `GET /clubs/:slug/live` | none | The club's latest live board, with `ETag` (`304` when unchanged). `404` for an unknown club and for a club with no session, identically. |
| `GET /clubs/:slug/live/:sessionId` | none | One session's live board (same rules). |
| `GET /clubs/:slug/lives` | none | The club's sessions on the live page (id, name, status), latest first, so viewers can choose. |
| `GET /clubs/:slug/live/stream` | none | Server-Sent Events: `update` (carries the latest live board), `cleared`, `revision` (`{revision, sessionId}`, on every publish, live or not: staff devices follow each other with it) and `ended` (`{sessionId}`), plus a heartbeat. |
| `GET /clubs/:slug/live/:sessionId/stream` | none | Server-Sent Events for one session's board: `update` and `cleared`. |
| `GET /clubs/:slug/players` | none | The club leaderboard. |
| `PUT /logo`, `DELETE /logo` | staff | Kept for older cached apps: accepted (`204`) and ignored. Clubs no longer have logos. |
| `PUT /avatars/:key`, `DELETE /avatars/:key`, `DELETE /avatars` | staff | Set or remove a player's avatar (`key` is the lower-case name): `{kind: "emoji", emoji, color?}`, `{kind: "initials", color}` or `{kind: "photo", photo: {data}}` (at most 48 KB). `DELETE /avatars` removes every photo and keeps emoji and initials. At most 500 per club. |
| `GET /clubs/:slug/avatars` | none | `{avatars, logo, name}`: every avatar by name (without photos), with `ETag`. `logo` is always `null` (kept for older apps). |
| `GET /clubs/:slug/avatars/:key/photo` | none | A player's photo image. |
| `POST /audit` `{entries[]}` | staff | Add to the club's activity log (at most 100 per request). Each entry's `id` is a UUID made on the device, so sending it again stores it once. |
| `GET /audit?sessionId&deviceId&q&page&limit` | staff | The activity log, newest first. `q` searches (ignoring case, `%` and `_` literal) what happened, the device name and its details. `page` (from 0, 20 a page) returns `{entries, total}`; without it (older apps) `{entries, next}`, with `next` passed as `before` for the following page. |
| `PUT /devices/me` `{id, name, label}` | staff | Name this staff device. `409 name_taken` when another device of the club has the name (ignoring case). |
| `GET /devices` | staff | The club's named devices, `{devices}`. |
| `GET /health` | none | Liveness, checks the database, and reports the build: `{ok, version, commit}` (`dev` when run from source or built without `GIT_SHA`). |

There is deliberately **no endpoint that lists clubs**.

## Security notes

- **Passwords** are hashed with argon2id. **Staff tokens** are 32 random bytes; only their SHA-256 is stored, and
  they expire. The **recovery code** (100 bits) is stored as a SHA-256 and is single use.
- **Rate limits** per address, stricter for login, create and reset, plus a **lockout per club** after repeated
  failures (clubs that do not exist are counted the same way, so lockouts reveal nothing). Login for an unknown
  club does the same hashing work as a wrong password, so timing reveals nothing either.
- The **live board never contains private data**: the public snapshot is copied field by field, so a genders or
  results history sent by a buggy client cannot reach viewers.
  The board carries `nextUp` (up to four player ids, Team A then Team B) worked out by the staff device; older clients
  may omit it and viewers then see no next group.
- Requests are validated strictly (no type coercion, unknown fields rejected), bodies are capped, errors never
  include internal detail, and secrets are never logged.
- **Limits of the current design:** the login lockout and the live-stream fan-out are in memory, which is right
  for one server. Running several instances would need Postgres `LISTEN/NOTIFY` and a shared limiter.

## Tests

```bash
npm test -w @q2dink/api                       # embedded Postgres, no Docker needed
TEST_DATABASE_URL=postgres://... npm test -w @q2dink/api   # the same suite on a real Postgres
```

The suite covers every route, authentication and expiry, rate limits and lockouts, privacy of the public board,
Server-Sent Events over a real connection, migrations, and configuration. Run it against real Postgres before a
release.

## Layout

```
src/index.ts        start-up: config, database, migrations, listen, graceful shutdown
src/app.ts          builds the Fastify app (plugins, errors); used by tests too
src/config.ts       environment variables
src/db/             database driver (Postgres and PGlite), migrations
src/services/       the rules: clubs, sessions, leaderboard, tokens, passwords, lockout
src/routes/         HTTP layer only: validation and calling services
src/realtime.ts     live-board fan-out
```
