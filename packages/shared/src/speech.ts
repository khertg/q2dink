/**
 * Voice call-outs: staff tap to have a sentence ("Next up: Ann and Bob, against Cal and Dee.") read out.
 * POST /speech (staff) turns the text into MP3 audio with the server's voice service. When the server has
 * no voice service (503 `speech_unavailable`) or cannot be reached, the app uses the device's own voice.
 */

/**
 * Which voice reads the club's call-outs, chosen for the whole club: ElevenLabs (the device's own voice when it
 * cannot be reached), or each device's own voice only (no ElevenLabs credits are used).
 */
export const CALLOUT_VOICES = ['elevenlabs', 'device'] as const
export type CalloutVoice = (typeof CALLOUT_VOICES)[number]
export const DEFAULT_CALLOUT_VOICE: CalloutVoice = 'elevenlabs'

export const isCalloutVoice = (value: unknown): value is CalloutVoice =>
  typeof value === 'string' && (CALLOUT_VOICES as readonly string[]).includes(value)

/** The ElevenLabs voice used until a club picks one: "Rachel", one of the default voices every account can use. */
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'
export const DEFAULT_VOICE_NAME = 'Rachel'

/** An ElevenLabs voice id: letters and digits, such as 21m00Tcm4TlvDq8ikWAM. */
export const isVoiceId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9]{1,64}$/.test(value)

/**
 * A placeholder a call-out's wording can use, filled in at each tap. For Ann & Bob (Blue) against Cal & Dee (Orange) on
 * Court 1, a 3.5+ court: {bluePlayers} "Ann and Bob", {orangePlayers} "Cal and Dee", {players} "Ann and Bob, against Cal
 * and Dee", {court} "Court 1", {level} "3.5 plus", and for the player called, {name} "Ann", {team} "Blue", {partner}
 * "Bob" and, while waiting, {place} "3".
 */
export const CALLOUT_PLACEHOLDERS = [
  'players',
  'bluePlayers',
  'orangePlayers',
  'court',
  'level',
  'name',
  'team',
  'partner',
  'place',
] as const
export type CalloutPlaceholder = (typeof CALLOUT_PLACEHOLDERS)[number]

const GAME = ['players', 'bluePlayers', 'orangePlayers'] as const

/** Every text behind a speaker a club can change, with the wording it has until then and the placeholders it can use. */
export const CALLOUT_TEXTS = {
  nextUp: { label: 'Next up', text: 'Next up: {players}. Please get ready.', placeholders: [...GAME, 'level'] },
  levelPrefix: {
    label: 'Level before Next up (courts kept for levels)',
    text: 'For {level}:',
    placeholders: ['level'],
  },
  courtGame: { label: 'A court’s game', text: '{court}: {players}.', placeholders: ['court', ...GAME, 'level'] },
  courtCall: {
    label: 'Calling players to a court',
    text: '{players}, please go to {court}.',
    placeholders: ['court', ...GAME, 'level'],
  },
  playerCourt: {
    label: 'A player on a court',
    text: '{name}, please go to {court}.',
    placeholders: ['name', 'court', 'team', 'partner', ...GAME],
  },
  playerNextUp: {
    label: 'A player who is next up',
    text: '{name}, you are next up. Please get ready.',
    placeholders: ['name', 'team', 'partner', ...GAME, 'level'],
  },
  playerWaiting: { label: 'A waiting player', text: '{name}, please come to the front desk.', placeholders: ['name', 'place'] },
  testVoice: { label: 'Test voice', text: 'This is how call-outs will sound.', placeholders: CALLOUT_PLACEHOLDERS },
} as const satisfies Record<string, { label: string; text: string; placeholders: readonly CalloutPlaceholder[] }>

export type CalloutTextKey = keyof typeof CALLOUT_TEXTS
export const CALLOUT_TEXT_KEYS = Object.keys(CALLOUT_TEXTS) as CalloutTextKey[]

/** The call-outs a court can have its own wording for, and a player. */
export const COURT_TEXT_KEYS = ['courtGame', 'courtCall'] as const satisfies readonly CalloutTextKey[]
export const PLAYER_TEXT_KEYS = ['playerCourt', 'playerNextUp', 'playerWaiting'] as const satisfies readonly CalloutTextKey[]
export type CourtTexts = Partial<Record<(typeof COURT_TEXT_KEYS)[number], string>>
export type PlayerTexts = Partial<Record<(typeof PLAYER_TEXT_KEYS)[number], string>>

/**
 * A club's own wording, only for what it changed (the rest uses CALLOUT_TEXTS), plus a court's or a player's own
 * wording, by lower-case name, over the club's.
 */
export type CalloutTexts = Partial<Record<CalloutTextKey, string>> & {
  courts?: Record<string, CourtTexts>
  players?: Record<string, PlayerTexts>
}

/** The longest wording of one call-out, and how many courts and players can have their own. */
export const CALLOUT_TEXT_MAX_CHARS = 200
export const CALLOUT_MAX_COURTS = 50
export const CALLOUT_MAX_PLAYERS = 500
const MAX_NAME_CHARS = 80

/** How a court or player is keyed in CalloutTexts: its name, trimmed, in lower case. */
export const calloutTarget = (name: string) => name.trim().toLowerCase()

type Parsed<T> = T | null | 'invalid'

/** One wording: trimmed; null when empty (the default); 'invalid' when not text or too long. */
function parseText(value: unknown): Parsed<string> {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'
  const text = value.trim()
  if (text.length > CALLOUT_TEXT_MAX_CHARS) return 'invalid'
  return text || null
}

/** The given keys' wording from `raw`; null when there is none. */
function parseGroup<K extends string>(raw: unknown, keys: readonly K[]): Parsed<Partial<Record<K, string>>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'invalid'
  const out: Partial<Record<K, string>> = {}
  for (const key of keys) {
    const text = parseText((raw as Record<string, unknown>)[key])
    if (text === 'invalid') return 'invalid'
    if (text) out[key] = text
  }
  return Object.keys(out).length > 0 ? out : null
}

/** A map of courts or players to their own wording; null when there is none. */
function parseTargets<K extends string>(raw: unknown, keys: readonly K[], max: number): Parsed<Record<string, Partial<Record<K, string>>>> {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid'
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > max) return 'invalid'
  const out: Record<string, Partial<Record<K, string>>> = {}
  for (const [name, value] of entries) {
    const target = calloutTarget(name)
    if (!target || target.length > MAX_NAME_CHARS) return 'invalid'
    const group = parseGroup(value, keys)
    if (group === 'invalid') return 'invalid'
    if (group) out[target] = { ...out[target], ...group }
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * A fresh copy with known texts only, each trimmed; an empty one is left out (its default), and so is a court or player
 * left with none. Null when a text is too long or there are too many courts or players.
 */
export function parseCalloutTexts(raw: unknown): CalloutTexts | null {
  const general = parseGroup(raw, CALLOUT_TEXT_KEYS)
  if (general === 'invalid') return null
  const record = raw as Record<string, unknown>
  const courts = parseTargets(record.courts, COURT_TEXT_KEYS, CALLOUT_MAX_COURTS)
  const players = parseTargets(record.players, PLAYER_TEXT_KEYS, CALLOUT_MAX_PLAYERS)
  if (courts === 'invalid' || players === 'invalid') return null
  return { ...general, ...(courts ? { courts } : {}), ...(players ? { players } : {}) }
}

/** `GET /voice` and the answer to `PUT /voice` (staff): the club's choice, and whether this server has ElevenLabs. */
export interface VoiceSettings {
  voice: CalloutVoice
  /** The club's ElevenLabs voice, or null for the default (DEFAULT_VOICE_ID). */
  voiceId: string | null
  /** The club's own wording of its call-outs (empty: all the defaults). */
  texts: CalloutTexts
  /** The server has an ElevenLabs key. Without one every device uses its own voice, whatever the choice. */
  elevenLabs: boolean
}

/**
 * The body of `PUT /voice`. A missing `voiceId` leaves the club's voice as it is (null goes back to the default); a
 * missing `texts` leaves its wording, and an object replaces all of it.
 */
export interface VoiceChoice {
  voice: CalloutVoice
  voiceId?: string | null
  texts?: CalloutTexts
}

/** A fresh copy of a `PUT /voice` body, or null. */
export function parseVoiceChoice(raw: unknown): VoiceChoice | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { voice, voiceId, texts } = raw as Record<string, unknown>
  if (!isCalloutVoice(voice)) return null
  const choice: VoiceChoice = { voice }
  if (voiceId !== undefined) {
    if (voiceId !== null && !isVoiceId(voiceId)) return null
    choice.voiceId = voiceId
  }
  if (texts !== undefined) {
    const parsed = parseCalloutTexts(texts)
    if (!parsed) return null
    choice.texts = parsed
  }
  return choice
}

/** One ElevenLabs voice the server's key can use, for the club's choice (`GET /voice/options`). */
export interface VoiceOption {
  id: string
  name: string
  /** A few words about it, such as "calm, young, female". */
  description?: string
  /** A Voice Library voice: ElevenLabs only lets paid plans use it through the API. */
  paidOnly: boolean
}

/** `GET /voice/options` (staff). `listable` is false when the key may not list voices (then ids are pasted). */
export interface VoiceOptions {
  voices: VoiceOption[]
  listable: boolean
}

/** The longest sentence the server will read out. */
export const SPEECH_MAX_CHARS = 400

/** POST /speech (staff): the text to read out. Answers `audio/mpeg`. */
export interface SpeechRequest {
  text: string
  /** Read with this voice instead of the club's, to try it before choosing it. */
  voiceId?: string
}

/** A fresh copy with `text` (trimmed, 1 to SPEECH_MAX_CHARS characters) and a valid `voiceId`, or null. */
export function parseSpeechRequest(raw: unknown): SpeechRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { text: value, voiceId } = raw as Record<string, unknown>
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.length === 0 || text.length > SPEECH_MAX_CHARS) return null
  return isVoiceId(voiceId) ? { text, voiceId } : { text }
}
