import {
  CALLOUT_TEXTS,
  calloutTarget,
  type CalloutPlaceholder,
  type CalloutTextKey,
  type CalloutTexts,
  type CourtTexts,
  type PlayerTexts,
} from '@q2dink/shared'
import { playerStatuses } from '@/lib/playerStatus'
import { levelLabel, sessionScale } from '@/lib/skill'
import { TEAM_NAMES } from '@/lib/teams'
import type { Lane, NextGroup } from '@/rotation/engine'
import type { Court, SessionState } from '@/rotation/types'

/**
 * What staff have read out loud when they tap a speaker button (see announcer.ts): the next group, a
 * court's players, or one player. Plain sentences, written for a voice rather than a screen, in the club's own
 * wording (CalloutTexts: a player's or a court's own over the club's) or the default one (CALLOUT_TEXTS in shared),
 * with placeholders filled in.
 */

/** Text a voice reads well: "&" as "and", "3.5+" as "3.5 plus", "3.0–3.49" as "3.0 to 3.49". */
export function spoken(text: string): string {
  return text
    .replace(/\s*&\s*/g, ' and ')
    .replace(/(\d)\+/g, '$1 plus')
    .replace(/(\d)\s*[–—-]\s*(\d)/g, '$1 to $2')
    .replace(/\s+/g, ' ')
    .trim()
}

type Values = Partial<Record<CalloutPlaceholder, string>>

const PLACEHOLDER = /\{(\w+)\}/g

/** Fill a call-out's wording: each known {placeholder} gets its value; anything else in braces stays as written. */
export function fillCallout(template: string, values: Values): string {
  return template.replace(PLACEHOLDER, (whole, key: string) =>
    key in values ? (values[key as CalloutPlaceholder] ?? '') : whole,
  )
}

/** Whose wording to use: a court's or a player's own comes before the club's. */
interface Target {
  court?: string
  player?: string
}

/** The wording of a call-out: the player's own, else the court's own, else the club's, else the default. */
export function wordingOf(key: CalloutTextKey, texts: CalloutTexts | undefined, target: Target = {}): string {
  const player = target.player ? texts?.players?.[calloutTarget(target.player)]?.[key as keyof PlayerTexts] : undefined
  const court = target.court ? texts?.courts?.[calloutTarget(target.court)]?.[key as keyof CourtTexts] : undefined
  return player ?? court ?? texts?.[key] ?? CALLOUT_TEXTS[key].text
}

/** Placeholders in a wording that its call-out does not have (a typo such as {nmae}), for the editor to warn about. */
export function unknownPlaceholders(key: CalloutTextKey, template: string): string[] {
  const known: readonly string[] = CALLOUT_TEXTS[key].placeholders
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))].filter((p) => !known.includes(p))
}

/** What each placeholder is filled with in the editor's Test, and in the Test voice sentence. */
const EXAMPLE: Record<CalloutPlaceholder, string> = {
  players: 'Ann and Bob, against Cal and Dee',
  bluePlayers: 'Ann and Bob',
  orangePlayers: 'Cal and Dee',
  court: 'Court 1',
  level: '3.5 plus',
  name: 'Ann',
  team: 'Blue',
  partner: 'Bob',
  place: '3',
}

/** The wording filled with example names (or the court's or player's own name when it is theirs), for Test. */
export function calloutSample(template: string, target: { court?: string; name?: string } = {}): string {
  return spoken(fillCallout(template, { ...EXAMPLE, ...(target.court ? { court: target.court } : {}), ...(target.name ? { name: target.name } : {}) }))
}

/** The club's Test voice sentence, with any placeholders filled with the examples. */
export const testVoiceText = (texts: CalloutTexts | undefined) => calloutSample(wordingOf('testVoice', texts))

/** The editor's wording, keeping only what differs from the defaults (an emptied one goes back to its default). */
export function changedTexts(draft: Partial<Record<CalloutTextKey, string>>): Partial<Record<CalloutTextKey, string>> {
  const texts: Partial<Record<CalloutTextKey, string>> = {}
  for (const [key, value] of Object.entries(draft) as [CalloutTextKey, string][]) {
    const text = value.trim()
    if (key in CALLOUT_TEXTS && text && text !== CALLOUT_TEXTS[key].text) texts[key] = text
  }
  return texts
}

type Overrides = 'courts' | 'players'

/** The next CalloutTexts with one court's or player's own wording set (or cleared, with an empty text). */
function setTargetText(texts: CalloutTexts, map: Overrides, name: string, key: string, text: string): CalloutTexts {
  const target = calloutTarget(name)
  const group: Record<string, string> = { ...texts[map]?.[target] }
  if (text.trim()) group[key] = text.trim()
  else delete group[key]
  const next: Record<string, Record<string, string>> = { ...texts[map] }
  if (Object.keys(group).length > 0) next[target] = group
  else delete next[target]
  const { [map]: _dropped, ...rest } = texts
  return Object.keys(next).length > 0 ? { ...rest, [map]: next } : rest
}

export const setCourtText = (texts: CalloutTexts, court: string, key: keyof CourtTexts, text: string) =>
  setTargetText(texts, 'courts', court, key, text)
export const setPlayerText = (texts: CalloutTexts, player: string, key: keyof PlayerTexts, text: string) =>
  setTargetText(texts, 'players', player, key, text)

/** The next CalloutTexts with a court's or player's own wording moved to their new name (names are copies). */
function renameTarget(texts: CalloutTexts, map: Overrides, from: string, to: string): CalloutTexts {
  const old = calloutTarget(from)
  const renamed = calloutTarget(to)
  const group = texts[map]?.[old]
  if (!group || old === renamed) return texts
  const next: Record<string, Record<string, string>> = { ...texts[map] }
  delete next[old]
  next[renamed] = { ...next[renamed], ...group }
  return { ...texts, [map]: next }
}

export const renameCourtTexts = (texts: CalloutTexts, from: string, to: string) => renameTarget(texts, 'courts', from, to)
export const renamePlayerTexts = (texts: CalloutTexts, from: string, to: string) => renameTarget(texts, 'players', from, to)

const nameOf = (session: SessionState, id: number) => session.players[id]?.name ?? 'Player'

/** A game's players: {players} (a team with nobody on it is left out), {bluePlayers} and {orangePlayers}. */
function teamValues(session: SessionState, teams: readonly (readonly number[])[]): Values | null {
  const names = teams.map((team) => team.map((id) => nameOf(session, id)).join(' and '))
  const sides = names.filter((side) => side !== '')
  if (sides.length === 0) return null
  return { players: sides.join(', against '), bluePlayers: names[0] ?? '', orangePlayers: names[1] ?? '' }
}

/** One player's own team in a game: {team} (Blue or Orange) and {partner} (their teammates; empty in singles). */
function playerTeamValues(session: SessionState, id: number, teams: readonly (readonly number[])[]): Values {
  const index = teams.findIndex((team) => team.includes(id))
  if (index === -1) return {}
  const partners = teams[index].filter((other) => other !== id).map((other) => nameOf(session, other))
  return { team: TEAM_NAMES[index] ?? '', partner: partners.join(' and ') }
}

/** {level}: a level range as said out loud ("3.5 plus"), or "any level". */
const levelOf = (session: SessionState, levels: Court['levels']) =>
  spoken(levelLabel(sessionScale(session), levels) ?? 'any level')

/**
 * "Next up: Ann and Bob, against Cal and Dee. Please get ready." While courts keep levels, the wording is read for each
 * group, after the club's level prefix ("For 3.5 plus:").
 */
export function nextUpCallout(session: SessionState, lanes: Lane[], texts?: CalloutTexts): string | null {
  const byLevel = lanes.length > 1 || lanes[0]?.levels !== undefined
  const wording = wordingOf('nextUp', texts)
  const lines = lanes.flatMap((lane) => {
    const values = lane.group && teamValues(session, lane.group.teams)
    if (!values) return []
    const level = levelOf(session, lane.levels)
    const prefix = byLevel ? `${fillCallout(wordingOf('levelPrefix', texts), { level })} ` : ''
    return [prefix + fillCallout(wording, { ...values, level })]
  })
  return lines.length === 0 ? null : spoken(lines.join(' '))
}

/**
 * A court's players: "Court 1: Ann and Bob, against Cal and Dee." for a game in progress, and "Ann and Bob,
 * against Cal and Dee, please go to Court 1." for a line-up set up by hand or, on an open court, the group
 * that would start there (`ready`). Null when there is nobody to call.
 */
export function courtCallout(
  session: SessionState,
  court: Court,
  ready?: NextGroup | null,
  texts?: CalloutTexts,
): string | null {
  const teams = court.teams ?? ready?.teams
  const values = teams && teamValues(session, teams)
  if (!values) return null
  const key = court.teams && !court.notStarted ? 'courtGame' : 'courtCall'
  const wording = wordingOf(key, texts, { court: court.name })
  return spoken(fillCallout(wording, { ...values, court: court.name, level: levelOf(session, court.levels) }))
}

/** One player, by where they are: to their court, to get ready for Next up, or to the front desk. */
export function playerCallout(session: SessionState, id: number, lanes: Lane[], texts?: CalloutTexts): string | null {
  const status = playerStatuses(session, lanes).find((s) => s.id === id)
  if (!status) return null
  const name = nameOf(session, id)
  const say = (key: CalloutTextKey, values: Values) => spoken(fillCallout(wordingOf(key, texts, { player: name }), { name, ...values }))
  switch (status.place) {
    case 'court': {
      const court = session.courts.find((c) => c.id === status.courtId)
      const teams = court?.teams ?? []
      return say('playerCourt', {
        court: court?.name ?? 'your court',
        ...teamValues(session, teams),
        ...playerTeamValues(session, id, teams),
      })
    }
    case 'nextUp': {
      const lane = lanes[status.lane ?? 0]
      const teams = lane?.group?.teams ?? []
      return say('playerNextUp', {
        ...teamValues(session, teams),
        ...playerTeamValues(session, id, teams),
        level: levelOf(session, lane?.levels),
      })
    }
    default:
      return say('playerWaiting', { place: status.queuePlace ? String(status.queuePlace) : '' })
  }
}
