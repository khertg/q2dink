import {
  CALLOUT_TEXT_KEYS,
  DEFAULT_CALLOUT_VOICE,
  isCalloutVoice,
  isVoiceId,
  parseCalloutTexts,
  type CalloutTexts,
  type CalloutVoice,
  type VoiceChoice,
} from '@q2dink/shared'
import type { Db, Queryable } from '../db'

type Scope = 'club' | 'court' | 'player'

interface TextRow {
  scope: Scope
  target: string
  key: string
  text: string
}

/** The club's wording rows as one CalloutTexts (checked through the parser, so an unknown row is left out). */
export function textsFromRows(rows: readonly TextRow[]): CalloutTexts {
  const raw: Record<string, unknown> & { courts: Record<string, Record<string, string>>; players: Record<string, Record<string, string>> } =
    { courts: {}, players: {} }
  for (const { scope, target, key, text } of rows) {
    if (scope === 'club') raw[key] = text
    else {
      const map = scope === 'court' ? raw.courts : raw.players
      map[target] = { ...map[target], [key]: text }
    }
  }
  return parseCalloutTexts(raw) ?? {}
}

/** One row per text of a CalloutTexts. */
export function rowsFromTexts(texts: CalloutTexts): TextRow[] {
  const rows: TextRow[] = []
  for (const key of CALLOUT_TEXT_KEYS) {
    const text = texts[key]
    if (text) rows.push({ scope: 'club', target: '', key, text })
  }
  for (const [scope, map] of [
    ['court', texts.courts],
    ['player', texts.players],
  ] as const) {
    for (const [target, group] of Object.entries(map ?? {})) {
      for (const [key, text] of Object.entries(group as Record<string, string | undefined>)) {
        if (text) rows.push({ scope, target, key, text })
      }
    }
  }
  return rows
}

/** Which voice reads the club's call-outs, its ElevenLabs voice (null: the default) and its own wording. */
export async function getVoiceSettings(
  db: Queryable,
  slug: string,
): Promise<{ voice: CalloutVoice; voiceId: string | null; texts: CalloutTexts }> {
  const [club, texts] = await Promise.all([
    db.query<{ callout_voice: string | null; elevenlabs_voice_id: string | null }>(
      'select callout_voice, elevenlabs_voice_id from clubs where slug = $1',
      [slug],
    ),
    db.query<TextRow>('select scope, target, key, text from club_callout_texts where club_slug = $1', [slug]),
  ])
  const row = club.rows[0]
  return {
    voice: isCalloutVoice(row?.callout_voice) ? row.callout_voice : DEFAULT_CALLOUT_VOICE,
    voiceId: isVoiceId(row?.elevenlabs_voice_id) ? row.elevenlabs_voice_id : null,
    texts: textsFromRows(texts.rows),
  }
}

/** Save the club's choice. A missing `voiceId` or `texts` keeps what it has; `texts` replaces all of the club's wording. */
export async function setVoice(db: Db, slug: string, choice: VoiceChoice): Promise<void> {
  await db.transaction(async (tx) => {
    if (choice.voiceId === undefined) {
      await tx.query('update clubs set callout_voice = $2 where slug = $1', [slug, choice.voice])
    } else {
      await tx.query('update clubs set callout_voice = $2, elevenlabs_voice_id = $3 where slug = $1', [
        slug,
        choice.voice,
        choice.voiceId,
      ])
    }
    if (choice.texts === undefined) return
    await tx.query('delete from club_callout_texts where club_slug = $1', [slug])
    for (const row of rowsFromTexts(choice.texts)) {
      await tx.query('insert into club_callout_texts (club_slug, scope, target, key, text) values ($1, $2, $3, $4, $5)', [
        slug,
        row.scope,
        row.target,
        row.key,
        row.text,
      ])
    }
  })
}
