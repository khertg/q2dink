/**
 * Schema migrations, applied in order and recorded in schema_migrations.
 * Never edit a migration that has shipped: add a new one instead.
 * They live in TypeScript (not .sql files) so they are bundled with the server
 * and work the same under tsx, tsup and the tests.
 */
export interface Migration {
  id: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_init',
    sql: `
      create table clubs (
        slug          text primary key
                      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
        name          text not null check (char_length(name) between 1 and 80),
        password_hash text not null,
        -- SHA-256 of the one-time recovery code (high entropy, so a fast hash is enough).
        recovery_hash text not null,
        created_at    timestamptz not null default now()
      );

      -- Staff tokens. Only the SHA-256 of a token is stored.
      create table club_tokens (
        token_hash text primary key,
        club_slug  text not null references clubs (slug) on delete cascade,
        expires_at timestamptz not null
      );
      create index club_tokens_club_idx on club_tokens (club_slug);
      create index club_tokens_expires_idx on club_tokens (expires_at);

      -- What the public viewer page renders (no genders, no results history).
      create table live_sessions (
        club_slug  text primary key references clubs (slug) on delete cascade,
        state      jsonb not null,
        updated_at timestamptz not null default now()
      );

      -- The full session, so a second staff device can resume it. Never public.
      create table session_backups (
        club_slug  text primary key references clubs (slug) on delete cascade,
        state      jsonb not null,
        updated_at timestamptz not null default now()
      );

      create table club_players (
        club_slug text not null references clubs (slug) on delete cascade,
        name_key  text not null,
        name      text not null,
        games     integer not null default 0 check (games >= 0),
        wins      integer not null default 0 check (wins >= 0),
        losses    integer not null default 0 check (losses >= 0),
        primary key (club_slug, name_key)
      );

      -- Makes retrying a leaderboard upload safe: a batch id is applied at most once.
      create table lifetime_batches (
        club_slug text not null references clubs (slug) on delete cascade,
        batch_id  uuid not null,
        primary key (club_slug, batch_id)
      );
    `,
  },
  {
    id: '002_session_history',
    sql: `
      -- Ended sessions, so a club can look back at them and resume one from any staff device.
      -- Only reachable with a staff token.
      create table session_history (
        club_slug text not null references clubs (slug) on delete cascade,
        id        uuid not null,
        location  text not null,
        mode      text not null check (mode in ('doubles', 'singles')),
        players   integer not null check (players >= 0),
        games     integer not null check (games >= 0),
        ended_at  timestamptz not null,
        state     jsonb not null,
        primary key (club_slug, id)
      );
      create index session_history_recent_idx on session_history (club_slug, ended_at desc);
    `,
  },
  {
    id: '003_media',
    sql: `
      -- The club's logo, one per club. Images are stored as base64 text; the server checks
      -- the bytes are a PNG, JPEG or WebP and of a sensible size before saving.
      create table club_logos (
        club_slug    text primary key references clubs (slug) on delete cascade,
        content_type text not null check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
        data         text not null,
        updated_at   timestamptz not null default now()
      );

      -- Player avatars, by lower-case player name (the same key as the club leaderboard).
      create table club_avatars (
        club_slug    text not null references clubs (slug) on delete cascade,
        name_key     text not null check (char_length(name_key) between 1 and 80),
        kind         text not null check (kind in ('photo', 'emoji', 'initials')),
        emoji        text,
        color        text check (color ~ '^#[0-9a-f]{6}$'),
        content_type text check (content_type in ('image/png', 'image/jpeg', 'image/webp')),
        photo        text,
        updated_at   timestamptz not null default now(),
        primary key (club_slug, name_key)
      );
    `,
  },
  {
    id: '004_club_roster',
    sql: `
      -- The club's saved players, shared by all its staff devices, by lower-case name (the same key as
      -- the leaderboard and avatars). Only reachable with a staff token: gender is private.
      create table club_roster (
        club_slug  text not null references clubs (slug) on delete cascade,
        name_key   text not null check (char_length(name_key) between 1 and 80),
        name       text not null,
        skill      smallint not null check (skill between 1 and 6),
        gender     text check (gender in ('M', 'F')),
        updated_at timestamptz not null default now(),
        primary key (club_slug, name_key)
      );
    `,
  },
  {
    id: '005_photo_sharing',
    sql: `
      -- Player photos always reach the club's staff devices; this says whether the public live page
      -- shows them too. Photos already on the server were only ever sent with sharing on, so those
      -- clubs keep showing them.
      alter table clubs add column share_photos boolean not null default false;
      update clubs set share_photos = true
        where slug in (select club_slug from club_avatars where kind = 'photo');
    `,
  },
  {
    id: '006_session_revision',
    sql: `
      -- Several staff devices run one session together. Each write moves the revision on; a device
      -- writing on an older revision is refused and rebases on the club's copy first.
      alter table session_backups
        add column revision   bigint not null default 0,
        add column session_id uuid,
        add column started_at timestamptz;
    `,
  },
  {
    id: '007_audit_log',
    sql: `
      -- Which staff device did what. Staff share one club password, so a device is known by its own
      -- random id, what its browser says about it (label) and the name staff gave it.
      create table club_devices (
        club_slug text not null references clubs (slug) on delete cascade,
        device_id text not null check (char_length(device_id) between 1 and 64),
        name      text not null check (char_length(name) between 1 and 40),
        label     text not null check (char_length(label) between 1 and 80),
        last_seen timestamptz not null default now(),
        primary key (club_slug, device_id)
      );
      -- Two identical phones must be told apart: no two devices of a club share a name.
      create unique index club_devices_name on club_devices (club_slug, lower(name));

      create table audit_log (
        id           uuid primary key,
        club_slug    text not null references clubs (slug) on delete cascade,
        at           timestamptz not null,
        received_at  timestamptz not null default now(),
        device_id    text not null,
        device_label text not null,
        device_name  text,
        kind         text not null,
        summary      text not null,
        session_id   uuid
      );
      create index audit_log_club_at on audit_log (club_slug, at desc);
      create index audit_log_session on audit_log (club_slug, session_id, at desc);
    `,
  },
  {
    id: '008_drop_club_logos',
    sql: `
      -- Clubs no longer have logos: the stored ones go, so no device or live page shows one again.
      drop table if exists club_logos;
    `,
  },
  {
    id: '009_history_soft_delete',
    sql: `
      -- A deleted past session is kept for a while (Recently deleted) so it can be restored.
      alter table session_history add column deleted_at timestamptz;
      create index session_history_deleted_idx on session_history (club_slug, deleted_at);
    `,
  },
  {
    id: '010_multi_session',
    sql: `
      -- A club can run several sessions at once: each has its own private copy, revision and live board.
      update session_backups set session_id = gen_random_uuid() where session_id is null;
      alter table session_backups alter column session_id set not null;
      alter table session_backups drop constraint session_backups_pkey;
      alter table session_backups add primary key (club_slug, session_id);

      alter table live_sessions add column session_id uuid;
      update live_sessions l set session_id = b.session_id from session_backups b where b.club_slug = l.club_slug;
      delete from live_sessions where session_id is null;
      alter table live_sessions alter column session_id set not null;
      alter table live_sessions drop constraint live_sessions_pkey;
      alter table live_sessions add primary key (club_slug, session_id);

      -- Which staff devices have a session open, so leaving one another device has open does not pause it.
      create table session_presence (
        club_slug  text not null references clubs (slug) on delete cascade,
        session_id uuid not null,
        device_id  text not null check (char_length(device_id) between 1 and 64),
        seen_at    timestamptz not null default now(),
        primary key (club_slug, session_id, device_id)
      );
    `,
  },
  {
    id: '011_skill_scales',
    sql: `
      -- Each club chooses its skill levels (null: the default, suggested DUPR ranges).
      alter table clubs add column skill_scale jsonb;
      -- Players keep a rating (1.0 to 8.0, DUPR style); a club's scale turns it into a level. The skill column stays for
      -- older apps: the level 1 to 6 of the rating on the default scale. Saved levels become the rating that keeps
      -- them at the same level under that scale.
      alter table club_roster add column rating numeric(4, 3);
      update club_roster set rating = case skill
        when 1 then 1 when 2 then 2.5 when 3 then 3 when 4 then 3.5 when 5 then 4 else 4.5 end;
      alter table club_roster alter column rating set not null;
      alter table club_roster add constraint club_roster_rating_range check (rating between 1 and 8);
    `,
  },
]
