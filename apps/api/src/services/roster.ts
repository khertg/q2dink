import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_ROSTER_PLAYERS,
  avatarKey,
  isRating,
  legacyLevelForRating,
  ratingForLegacyLevel,
  type ClubRosterPlayer,
} from '@q2dink/shared'
import type { Db, Queryable } from '../db'
import { AppError } from '../errors'

interface RosterRow {
  name: string
  skill: number
  /** Null when an older app sent only a level. */
  rating: number | null
  gender?: 'M' | 'F'
}

/**
 * Add players to the club's roster, or update the ones it already has under those names (ignoring
 * case). A club keeps at most MAX_ROSTER_PLAYERS; a batch that would go past that is refused whole.
 * Newer apps send a rating (and its level on the default scale for older apps); older apps send only a level, which
 * keeps the player's rating when it is still that level, and otherwise becomes the rating that level starts at.
 */
export async function putRoster(db: Db, slug: string, players: ClubRosterPlayer[]): Promise<void> {
  const rows = new Map<string, RosterRow>()
  for (const p of players) {
    const name = p.name.trim()
    if (name.length < 1 || name.length > MAX_PLAYER_NAME_LENGTH) throw new AppError('invalid_request')
    const rating = isRating(p.rating) ? p.rating : null
    const skill = rating === null ? p.skill : legacyLevelForRating(rating)
    // A later entry for the same name wins, as if they had been sent one after another.
    rows.set(avatarKey(name), { name, skill, rating, ...(p.gender ? { gender: p.gender } : {}) })
  }
  if (rows.size === 0) return

  await db.transaction(async (tx) => {
    const keys = [...rows.keys()]
    const { rows: counts } = await tx.query<{ total: string | number; known: string | number }>(
      `select count(*) as total, count(*) filter (where name_key = any($2::text[])) as known
       from club_roster where club_slug = $1`,
      [slug, keys],
    )
    const added = keys.length - Number(counts[0].known)
    if (Number(counts[0].total) + added > MAX_ROSTER_PLAYERS) throw new AppError('payload_too_large')

    for (const [key, p] of rows) {
      await tx.query(
        `insert into club_roster (club_slug, name_key, name, skill, rating, gender, updated_at)
         values ($1, $2, $3, $4, coalesce($5::numeric, $6::numeric), $7, now())
         on conflict (club_slug, name_key) do update set
           name = excluded.name,
           skill = excluded.skill,
           rating = case
             when $5::numeric is not null then $5::numeric
             when club_roster.skill = excluded.skill then club_roster.rating
             else $6::numeric
           end,
           gender = excluded.gender,
           updated_at = now()`,
        [slug, key, p.name, p.skill, p.rating, ratingForLegacyLevel(p.skill), p.gender ?? null],
      )
    }
  })
}

/** The club's saved players, by name. */
export async function getRoster(db: Queryable, slug: string): Promise<ClubRosterPlayer[]> {
  const { rows } = await db.query<{ name: string; skill: number; rating: string | number; gender: 'M' | 'F' | null }>(
    'select name, skill, rating, gender from club_roster where club_slug = $1 order by name_key',
    [slug],
  )
  return rows.map((r) => ({
    name: r.name,
    skill: Number(r.skill),
    rating: Number(r.rating),
    ...(r.gender ? { gender: r.gender } : {}),
  }))
}
