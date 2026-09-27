import { parseSkillScale, type SkillScale } from '@q2dink/shared'
import type { Queryable } from '../db'
import { AppError } from '../errors'

/** The club's skill levels, or null when it uses the default scale. */
export async function getSkillScale(db: Queryable, slug: string): Promise<SkillScale | null> {
  const { rows } = await db.query<{ skill_scale: unknown }>('select skill_scale from clubs where slug = $1', [slug])
  const stored = rows[0]?.skill_scale
  // Stored as sent, after checking; read back through the parser all the same.
  return stored ? parseSkillScale(typeof stored === 'string' ? JSON.parse(stored) : stored) : null
}

/** Set the club's skill levels (null: back to the default). A scale that is not valid is refused. */
export async function setSkillScale(db: Queryable, slug: string, raw: unknown): Promise<SkillScale | null> {
  const scale = raw === null ? null : parseSkillScale(raw)
  if (raw !== null && !scale) throw new AppError('invalid_request')
  await db.query('update clubs set skill_scale = $2::jsonb where slug = $1', [slug, scale ? JSON.stringify(scale) : null])
  return scale
}
