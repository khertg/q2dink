# Deploying Q2Dink to a server

One small Linux server (a $5/month VPS is plenty) runs everything with Docker Compose:

```
internet ──► Caddy ──┬── /            the web app (static files)
 (80, 443, HTTPS)    └── /api/*  ──►  API ──► Postgres
```

Only Caddy is reachable from the internet. The API and the database sit on a private Docker network with no
published ports and no route out. Caddy gets and renews the HTTPS certificate by itself.

## Before you start

- A server with **Docker** and the **Compose plugin** (`docker compose version` works). Any recent Ubuntu or Debian is fine.
- A **domain** whose DNS **A record** points at the server's IP address (for example `q2dink.example.com`).
- Ports **80 and 443** open to the internet (Caddy needs 80 to prove you own the domain).

## First deployment

```bash
git clone <your repository> q2dink && cd q2dink/deploy
cp .env.example .env
nano .env        # set DOMAIN and a long random POSTGRES_PASSWORD (openssl rand -base64 24)
GIT_SHA=$(git rev-parse --short HEAD) docker compose -f docker-compose.prod.yml up -d --build
```

`GIT_SHA` is only there so the app and `/api/health` can say which commit they were built from (Docker builds do not see `.git`); leave it out and they show `dev`.

The first build takes a few minutes. Then check it:

```bash
docker compose -f docker-compose.prod.yml ps              # all three "running", api and db "healthy"
curl https://your-domain/api/health                        # {"ok":true,"version":"0.1.0","commit":"a1b2c3d"}
```

To check a deployment more thoroughly (security headers, client routes, the API's build, the service worker), run `bash deploy/smoke.sh https://your-domain` from the repository. CI runs the same script against the production stack on every push. The Caddyfile sends a strict Content-Security-Policy (only this site's own scripts, styles and API), HSTS and a no-framing rule; the policy is defined in `apps/web/csp.ts` and must be changed in both places if the app ever needs to load something from elsewhere.

Open `https://your-domain` in a browser, create a club, and start a session. Players open
`https://your-domain/club/<your-club>/live` (the Share button shows a QR code for it; the older `/club/<your-club>` still opens it).

The database schema is created automatically the first time the API starts.

## Updating

```bash
cd q2dink && git pull
cd deploy && GIT_SHA=$(git rev-parse --short HEAD) docker compose -f docker-compose.prod.yml up -d --build
```

Only what changed is rebuilt. Migrations run automatically on start. **Never run `docker compose down -v`**: the
`-v` deletes the database volume.

## Upgrading from Matchup (the app was renamed to Q2Dink)

The database user and database used to default to `matchup`; they now default to `q2dink`. Postgres does not
rename an existing database, so a server that was set up before the rename **must keep the old names**. Before you
pull and rebuild, add these two lines to `deploy/.env`:

```
POSTGRES_USER=matchup
POSTGRES_DB=matchup
```

Then update as usual. (Without them the API cannot sign in to the existing database and the stack will not become
healthy.) A brand-new server needs nothing. To move an existing server to the new names, restore a backup into a fresh
`q2dink` database instead (see Backups) and remove the two lines.

Old backup files named `matchup-<date>.sql.gz` still restore with the command below, and `backup.sh` rotates them
together with the new `q2dink-<date>.sql.gz` files. Nothing else on the server depends on the folder name.

## Voice call-outs (optional)

Staff can tap a speaker button on Next up and on each court, or **Call out** in a player's ⋮ menu, to have the call read out loud ("Next up: Ann and Bob, against Cal and Dee. Please get ready."). Without any setup, each staff device uses its own built-in voice. For a more natural voice, the API can use [ElevenLabs](https://elevenlabs.io):

1. Create an ElevenLabs account and an API key (Developers, API keys). Restrict the key to **Text to Speech** (access), **Voices** (read) and **User** (read). Voices lets the app list the account's voices (without it, staff paste a voice id instead); User lets it see the account's plan, so Voice Library voices are only marked as needing a paid plan on the free plan.
2. Set it in `deploy/.env` and restart: `ELEVENLABS_API_KEY=...`, and optionally `ELEVENLABS_MODEL=...` (default `eleven_flash_v2_5`, about half a credit per character).
3. Each club picks its voice **in the app** (club panel, or **Call-out voice…** in the session menu): a list of the account's own voices (its **My voices**; ElevenLabs' built-in default voices are not listed, except the default Rachel at the top), or **Other voice id** to paste one from the ElevenLabs website, with **Test voice**. Until then the default voice (Rachel) is used. On the free plan (or when the key may not read the plan), voices from the ElevenLabs **Voice Library** are marked "Needs a paid ElevenLabs plan": the free plan can only use the default voices and your own through the API.

ElevenLabs charges in **credits**: a call-out is about 60 characters, so roughly 30 credits on the default model. The API keeps recent call-outs in memory, so repeating the same one (from any staff device) costs nothing, and `RATE_LIMIT_SPEECH_MAX` (default 30 a minute per address) caps what one device can spend. The key stays on the server. When the key is wrong or the credits run out, the API logs it and devices fall back to their own voice for ten minutes at a time. A club can also stop using credits altogether by choosing **Device voice** (club panel, or **Call-out voice…** in the session menu): the API then never calls ElevenLabs for it.

## Backups

Run a backup by hand, or schedule it:

```bash
cd q2dink/deploy && ./backup.sh              # writes ./backups/q2dink-<date>.sql.gz, keeps the newest 14
```

Daily at 03:00 with cron (`crontab -e`):

```
0 3 * * * cd /home/you/q2dink/deploy && ./backup.sh /home/you/q2dink-backups >> /home/you/backup.log 2>&1
```

**Copy the backups off the server** (another machine, or object storage). A backup on the same disk does not
protect you from losing the disk.

To restore into an empty database:

```bash
cd q2dink/deploy
gunzip -c backups/q2dink-<date>.sql.gz | docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

Try a restore once, on a scratch database, before you need it.

## Hardening the server (worth an hour)

- **Firewall:** allow only SSH, 80 and 443, e.g. `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable`.
  (Docker publishes ports by editing firewall rules itself, so also keep Postgres unpublished, as it is here.)
- **SSH:** use keys and turn off password login.
- **Updates:** enable unattended security upgrades (`apt install unattended-upgrades`), and reboot occasionally.
- **Monitoring:** point a free uptime checker at `https://your-domain/api/health`.

## Everyday operations

```bash
docker compose -f docker-compose.prod.yml logs -f api      # API logs (rate limits, errors)
docker compose -f docker-compose.prod.yml logs -f caddy    # HTTPS and proxy logs
docker compose -f docker-compose.prod.yml restart api
```

**A club lost both its password and its recovery code.** There is no email reset. Delete the club so it can be
created again (its live board and leaderboard go with it):

```bash
docker compose -f docker-compose.prod.yml exec -T db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' <<'SQL'
delete from clubs where slug = 'the-club-slug';
SQL
```

## Good to know

- **One server.** Login lockouts and live-board connections are held in memory, which is right for one API
  process. Running several would need Postgres `LISTEN/NOTIFY` and a shared limiter (see `apps/api/README.md`).
- **Capacity.** A small server comfortably serves a few thousand simultaneous viewers; the API caps open live
  streams per address (`MAX_SUBSCRIBERS_PER_IP`) and in total (`MAX_SUBSCRIBERS_TOTAL`).
- **Behind another proxy or CDN** (for example Cloudflare in front): keep `TRUST_PROXY=true` only if that proxy
  is the one that sets the client address, and make sure it does not buffer `/api/*/live/stream`.
- **Try it locally first:** set `DOMAIN=:80`, `HTTP_PORT=8081` and a password in `.env`, then open
  `http://localhost:8081`. `:80` means plain HTTP on any host name, so use it for testing only.
