import { describe, expect, it } from 'vitest'
import {
  CALLOUT_MAX_COURTS,
  CALLOUT_TEXT_KEYS,
  CALLOUT_TEXT_MAX_CHARS,
  CALLOUT_TEXTS,
  DEFAULT_VOICE_ID,
  isVoiceId,
  parseCalloutTexts,
  parseSpeechRequest,
  parseVoiceChoice,
  SPEECH_MAX_CHARS,
} from './speech'

describe('parseSpeechRequest', () => {
  it('keeps only the trimmed text', () => {
    expect(parseSpeechRequest({ text: '  Next up: Ann  ', extra: 1 })).toEqual({ text: 'Next up: Ann' })
  })

  it('refuses empty, too long or missing text', () => {
    expect(parseSpeechRequest({ text: '   ' })).toBeNull()
    expect(parseSpeechRequest({ text: 'a'.repeat(SPEECH_MAX_CHARS + 1) })).toBeNull()
    expect(parseSpeechRequest({ text: 'a'.repeat(SPEECH_MAX_CHARS) })).not.toBeNull()
    expect(parseSpeechRequest({ text: 3 })).toBeNull()
    expect(parseSpeechRequest({})).toBeNull()
    expect(parseSpeechRequest(null)).toBeNull()
    expect(parseSpeechRequest(['text'])).toBeNull()
  })
})

describe('parseVoiceChoice', () => {
  it('keeps only a known voice', () => {
    expect(parseVoiceChoice({ voice: 'device', extra: 1 })).toEqual({ voice: 'device' })
    expect(parseVoiceChoice({ voice: 'elevenlabs' })).toEqual({ voice: 'elevenlabs' })
    expect(parseVoiceChoice({ voice: 'robot' })).toBeNull()
    expect(parseVoiceChoice({})).toBeNull()
    expect(parseVoiceChoice(null)).toBeNull()
  })
})

describe('voice ids', () => {
  it('takes a voice id on PUT /voice (null for the default, missing to keep it)', () => {
    expect(parseVoiceChoice({ voice: 'elevenlabs', voiceId: 'abcDEF123' })).toEqual({ voice: 'elevenlabs', voiceId: 'abcDEF123' })
    expect(parseVoiceChoice({ voice: 'elevenlabs', voiceId: null })).toEqual({ voice: 'elevenlabs', voiceId: null })
    expect(parseVoiceChoice({ voice: 'device' })).toEqual({ voice: 'device' })
    expect(parseVoiceChoice({ voice: 'elevenlabs', voiceId: 'bad id!' })).toBeNull()
    expect(parseVoiceChoice({ voice: 'elevenlabs', voiceId: 'a'.repeat(65) })).toBeNull()
    expect(isVoiceId(DEFAULT_VOICE_ID)).toBe(true)
  })

  it('keeps a valid voice id on a speech request and drops any other', () => {
    expect(parseSpeechRequest({ text: 'Hi', voiceId: 'abc123' })).toEqual({ text: 'Hi', voiceId: 'abc123' })
    expect(parseSpeechRequest({ text: 'Hi', voiceId: '../x' })).toEqual({ text: 'Hi' })
  })
})

describe('call-out wording', () => {
  it('keeps known call-outs, trimmed, and leaves out empty ones', () => {
    expect(parseCalloutTexts({ nextUp: '  Coming up: {players}! ', courtGame: '  ', madeUp: 'x', playerWaiting: null })).toEqual({
      nextUp: 'Coming up: {players}!',
    })
    expect(parseCalloutTexts({})).toEqual({})
  })

  it('refuses wording that is too long or not text', () => {
    expect(parseCalloutTexts({ nextUp: 'a'.repeat(CALLOUT_TEXT_MAX_CHARS + 1) })).toBeNull()
    expect(parseCalloutTexts({ nextUp: 3 })).toBeNull()
    expect(parseCalloutTexts('nextUp')).toBeNull()
  })

  it('rides on PUT /voice, missing to keep the club’s', () => {
    expect(parseVoiceChoice({ voice: 'elevenlabs', texts: { nextUp: 'Hi {players}' } })).toEqual({
      voice: 'elevenlabs',
      texts: { nextUp: 'Hi {players}' },
    })
    expect(parseVoiceChoice({ voice: 'elevenlabs' })).toEqual({ voice: 'elevenlabs' })
    expect(parseVoiceChoice({ voice: 'elevenlabs', texts: { nextUp: 'a'.repeat(201) } })).toBeNull()
  })

  it('has a default for every call-out that only uses its own placeholders', () => {
    for (const key of CALLOUT_TEXT_KEYS) {
      const { text, placeholders } = CALLOUT_TEXTS[key]
      const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      expect(used.every((p) => (placeholders as readonly string[]).includes(p))).toBe(true)
    }
  })
})

describe('a court’s and a player’s own wording', () => {
  it('is kept by lower-case name, only for the call-outs each can have', () => {
    expect(
      parseCalloutTexts({
        testVoice: ' Hello {name} ',
        courts: { ' Center Court ': { courtCall: '{players}, to the center!', playerWaiting: 'x' }, Empty: { courtGame: ' ' } },
        players: { Ann: { playerWaiting: '{name}, your table is ready', courtGame: 'x' } },
      }),
    ).toEqual({
      testVoice: 'Hello {name}',
      courts: { 'center court': { courtCall: '{players}, to the center!' } },
      players: { ann: { playerWaiting: '{name}, your table is ready' } },
    })
  })

  it('refuses too many, a too long text or a name that is too long', () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { courtGame: 'x' }]))
    expect(parseCalloutTexts({ courts: many(CALLOUT_MAX_COURTS) })).not.toBeNull()
    expect(parseCalloutTexts({ courts: many(CALLOUT_MAX_COURTS + 1) })).toBeNull()
    expect(parseCalloutTexts({ players: { ann: { playerWaiting: 'a'.repeat(201) } } })).toBeNull()
    expect(parseCalloutTexts({ players: { ['a'.repeat(81)]: { playerWaiting: 'x' } } })).toBeNull()
    expect(parseCalloutTexts({ players: ['ann'] })).toBeNull()
  })
})
