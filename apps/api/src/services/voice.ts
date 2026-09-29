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
    db.query<{ key: string; text: string }>(
      "select key, text from club_callout_texts where club_slug = $1 and scope = 'club'",
      [slug],
    ),
  ])
  const row = club.rows[0]
  return {
    voice: isCalloutVoice(row?.callout_voice) ? row.callout_voice : DEFAULT_CALLOUT_VOICE,
    voiceId: isVoiceId(row?.elevenlabs_voice_id) ? row.elevenlabs_voice_id : null,
    // One row per text; read back through the parser, so a row for a text that no longer exists is left out.
    texts: parseCalloutTexts(Object.fromEntries(texts.rows.map((r) => [r.key, r.text]))) ?? {},
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
    const texts = choice.texts
    if (texts === undefined) return
    await tx.query('delete from club_callout_texts where club_slug = $1', [slug])
    for (const key of CALLOUT_TEXT_KEYS) {
      const text = texts[key]
      if (!text) continue
      await tx.query("insert into club_callout_texts (club_slug, scope, target, key, text) values ($1, 'club', '', $2, $3)", [
        slug,
        key,
        text,
      ])
    }
  })
}
