import { describe, expect, it } from 'vitest'
import { checkIn, checkOut, createSession, nextGroups, setCourtLevels } from '@/rotation/engine'
import { fillCourts } from '@/rotation/testing'
import type { Court, SessionState } from '@/rotation/types'
import {
  calloutSample,
  changedTexts,
  courtCallout,
  fillCallout,
  nextUpCallout,
  playerCallout,
  spoken,
  testVoiceText,
  unknownPlaceholders,
} from './callout'

const NAMES = ['Ann', 'Bob', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo']

function withPlayers(state: SessionState, skills: number[]): SessionState {
  return skills.reduce(
    (s, skill, i) => checkIn(s, { id: i + 1, name: NAMES[i], skill: skill as 1, gender: 'M' }),
    state,
  )
}

/** "Ann and Bob, against Cal and Dee" for the ids of a group or court, in their teams. */
const vs = (s: SessionState, teams: number[][]) =>
  teams.map((team) => team.map((id) => s.players[id].name).join(' and ')).join(', against ')

describe('spoken', () => {
  it('spells out symbols a voice would stumble on', () => {
    expect(spoken('Ann & Bob')).toBe('Ann and Bob')
    expect(spoken('Next up for 3.5+:')).toBe('Next up for 3.5 plus:')
    expect(spoken('3.0–3.49')).toBe('3.0 to 3.49')
    expect(spoken('  a   b ')).toBe('a b')
  })
})

describe('nextUpCallout', () => {
  it('reads the next group in its teams', () => {
    const s = withPlayers(createSession('doubles', 1), [3, 3, 3, 3])
    const lanes = nextGroups(s)
    expect(nextUpCallout(s, lanes)).toBe(`Next up: ${vs(s, lanes[0].group!.teams)}. Please get ready.`)
  })

  it('reads single names in singles', () => {
    const s = withPlayers(createSession('singles', 1), [3, 3])
    const text = nextUpCallout(s, nextGroups(s))!
    expect(text).toMatch(/^Next up: (Ann, against Bob|Bob, against Ann)\. Please get ready\.$/)
  })

  it('is null while no group can be formed', () => {
    const s = withPlayers(createSession('doubles', 1), [3, 3])
    expect(nextUpCallout(s, nextGroups(s))).toBeNull()
  })

  it('names each level while courts are kept for levels, and skips a level with no group', () => {
    let s = withPlayers(createSession('doubles', 2), [5, 5, 5, 5, 2, 2, 2, 2])
    s = setCourtLevels(s, 1, [4, 6])
    const text = nextUpCallout(s, nextGroups(s))!
    expect(text).toMatch(/^For \d\.\d+ plus: Next up: .+\. Please get ready\. For any level: Next up: .+\. Please get ready\.$/)
    expect(text).not.toMatch(/[+–&]/)

    const fewer = withPlayers(setCourtLevels(createSession('doubles', 2), 1, [4, 6]), [2, 2, 2, 2])
    expect(nextUpCallout(fewer, nextGroups(fewer))).toMatch(/^For any level: Next up: .+\. Please get ready\.$/)
  })
})

describe('courtCallout', () => {
  it('names a court in play, then its players', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3]))
    const court = s.courts[0]
    expect(courtCallout(s, court)).toBe(`Court 1: ${vs(s, court.teams!)}.`)
  })

  it('sends the group that would start on an open court there', () => {
    const s = withPlayers(createSession('doubles', 1), [3, 3, 3, 3])
    const group = nextGroups(s)[0].group
    expect(courtCallout(s, s.courts[0], group)).toBe(`${vs(s, group!.teams)}, please go to Court 1.`)
    expect(courtCallout(s, s.courts[0], null)).toBeNull()
  })

  it('sends a line-up set up by hand to its court, leaving out an empty team', () => {
    const s = withPlayers(createSession('doubles', 1), [3, 3, 3, 3])
    const staged: Court = { ...s.courts[0], teams: [[1, 2], []], notStarted: true }
    expect(courtCallout(s, staged)).toBe('Ann and Bob, please go to Court 1.')
    expect(courtCallout(s, { ...staged, teams: [[], []] })).toBeNull()
  })
})

describe('playerCallout', () => {
  it('calls a player by where they are', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]))
    s = checkOut(s, 10)
    const lanes = nextGroups(s)
    const onCourt = s.courts[0].teams![0][0]
    expect(playerCallout(s, onCourt, lanes)).toBe(`${s.players[onCourt].name}, please go to Court 1.`)
    const next = lanes[0].group!.players[0]
    expect(playerCallout(s, next, lanes)).toBe(`${s.players[next].name}, you are next up. Please get ready.`)
    expect(playerCallout(s, 9, lanes)).toBe('Ivy, please come to the front desk.')
    expect(playerCallout(s, 10, lanes)).toBe('Jo, please come to the front desk.')
    expect(playerCallout(s, 99, lanes)).toBeNull()
  })
})

describe('the club’s own wording', () => {
  it('keeps only the wording that differs from the defaults', () => {
    expect(
      changedTexts({ nextUp: ' Next up: {players}. Please get ready. ', courtGame: ' ', playerWaiting: '{name}, over here' }),
    ).toEqual({ playerWaiting: '{name}, over here' })
  })

  it('fills known placeholders and leaves anything else in braces as written', () => {
    expect(fillCallout('{name} to {court} {nmae}', { name: 'Ann', court: 'Court 2' })).toBe('Ann to Court 2 {nmae}')
    expect(unknownPlaceholders('playerWaiting', '{name} and {court} and {nmae}')).toEqual(['court', 'nmae'])
    expect(unknownPlaceholders('nextUp', 'Blue {bluePlayers}, Orange {orangePlayers}, all {players}')).toEqual([])
    expect(calloutSample('Blue: {bluePlayers}. Orange: {orangePlayers}. Head to {court}.')).toBe(
      'Blue: Ann and Bob. Orange: Cal and Dee. Head to Court 1.',
    )
  })

  it('reads each team by colour, in doubles and singles', () => {
    const doubles = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3]))
    const [blue, orange] = doubles.courts[0].teams!.map((team) => team.map((id) => doubles.players[id].name).join(' and '))
    const texts = { courtGame: 'Blue: {bluePlayers}. Orange: {orangePlayers}. On {court}.' }
    expect(courtCallout(doubles, doubles.courts[0], null, texts)).toBe(`Blue: ${blue}. Orange: ${orange}. On Court 1.`)

    const singles = withPlayers(createSession('singles', 1), [3, 3])
    const group = nextGroups(singles)[0].group!
    const [one, two] = group.teams.map((team) => singles.players[team[0]].name)
    expect(nextUpCallout(singles, nextGroups(singles), { nextUp: '{bluePlayers} versus {orangePlayers}!' })).toBe(`${one} versus ${two}!`)
  })

  it('uses the club’s wording for every call-out, and the default for the rest', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3, 3, 3, 3, 3, 3, 3]))
    s = checkOut(s, 10)
    const lanes = nextGroups(s)
    const texts = { courtCall: 'Over to {court}: {players}', playerWaiting: '{name}, come see us', playerNextUp: '{name} is up soon' }
    const next = lanes[0].group!.players[0]
    expect(playerCallout(s, 9, lanes, texts)).toBe('Ivy, come see us')
    expect(playerCallout(s, next, lanes, texts)).toBe(`${s.players[next].name} is up soon`)
    // Not changed: the default.
    expect(playerCallout(s, s.courts[0].teams![0][0], lanes, texts)).toMatch(/, please go to Court 1\.$/)
    const open = withPlayers(createSession('doubles', 1), [3, 3, 3, 3])
    expect(courtCallout(open, open.courts[0], nextGroups(open)[0].group, texts)).toMatch(/^Over to Court 1: .+ and .+, against .+ and .+$/)
  })
})

describe('every placeholder', () => {
  it('fills team, partner and the game for a player on a court, in doubles and singles', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3]))
    const [[b1, b2], [o1, o2]] = s.courts[0].teams!
    const n = (id: number) => s.players[id].name
    const texts = { playerCourt: '{name} on {team} with {partner}: {bluePlayers} vs {orangePlayers} at {court}' }
    expect(playerCallout(s, o2, nextGroups(s), texts)).toBe(
      `${n(o2)} on Orange with ${n(o1)}: ${n(b1)} and ${n(b2)} vs ${n(o1)} and ${n(o2)} at Court 1`,
    )
    const single = fillCourts(withPlayers(createSession('singles', 1), [3, 3]))
    const [[blue]] = single.courts[0].teams!
    expect(playerCallout(single, blue, nextGroups(single), { playerCourt: '{name} {team} with {partner}.' })).toBe(
      `${single.players[blue].name} Blue with .`,
    )
  })

  it('fills the next game and its level for a player who is next up', () => {
    let s = withPlayers(createSession('doubles', 2), [5, 5, 5, 5, 2, 2, 2, 2])
    s = setCourtLevels(s, 1, [4, 6])
    const lanes = nextGroups(s)
    const id = lanes[0].group!.players[0]
    expect(playerCallout(s, id, lanes, { playerNextUp: '{name}, {level}, {team}, {players}' })).toMatch(
      /^\w+, \d\.\d+ plus, (Blue|Orange), \w+ and \w+, against \w+ and \w+$/,
    )
    const other = lanes[1].group!.players[0]
    expect(playerCallout(s, other, lanes, { playerNextUp: '{level}' })).toBe('any level')
  })

  it('fills a waiting player’s place, the court’s level and the club’s level prefix', () => {
    let s = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3, 3, 3, 3, 3, 3]))
    expect(playerCallout(s, 9, nextGroups(s), { playerWaiting: '{name} is number {place}' })).toBe('Ivy is number 5')
    s = setCourtLevels(withPlayers(createSession('doubles', 1), [5, 5, 5, 5]), 1, [4, 6])
    const lanes = nextGroups(s)
    expect(courtCallout(s, s.courts[0], lanes[0].group, { courtCall: '{level} game on {court}' })).toMatch(/^\d\.\d+ plus game on Court 1$/)
    expect(nextUpCallout(s, lanes, { levelPrefix: 'Level {level}!', nextUp: '{bluePlayers}.' })).toMatch(/^Level \d\.\d+ plus! \w+ and \w+\.$/)
  })

  it('reads the Test voice sentence with every placeholder as an example', () => {
    expect(testVoiceText(undefined)).toBe('This is how call-outs will sound.')
    expect(testVoiceText({ testVoice: '{name} on {team} with {partner}, {court}, {level}, number {place}' })).toBe(
      'Ann on Blue with Bob, Court 1, 3.5 plus, number 3',
    )
    expect(testVoiceText({ testVoice: '{bluePlayer1}, {bluePlayer2}, {orangePlayer1}, {orangePlayer2}' })).toBe('Ann, Bob, Cal, Dee')
  })
})

describe('each player of a team', () => {
  it('fills {bluePlayer1} to {orangePlayer2} in board order, on a court and in Next up', () => {
    const s = fillCourts(withPlayers(createSession('doubles', 1), [3, 3, 3, 3, 3, 3, 3, 3]))
    const [[b1, b2], [o1, o2]] = s.courts[0].teams!.map((team) => team.map((id) => s.players[id].name))
    const wording = '{bluePlayer1}+{bluePlayer2} v {orangePlayer1}+{orangePlayer2}'
    expect(courtCallout(s, s.courts[0], null, { courtGame: wording })).toBe(`${b1}+${b2} v ${o1}+${o2}`)

    const lanes = nextGroups(s)
    const [[nb1, nb2], [no1, no2]] = lanes[0].group!.teams.map((team) => team.map((id) => s.players[id].name))
    expect(nextUpCallout(s, lanes, { nextUp: wording })).toBe(`${nb1}+${nb2} v ${no1}+${no2}`)
    const next = lanes[0].group!.players[0]
    expect(playerCallout(s, next, lanes, { playerNextUp: `{name}: ${wording}` })).toBe(
      `${s.players[next].name}: ${nb1}+${nb2} v ${no1}+${no2}`,
    )
  })

  it('leaves the 2s empty in singles', () => {
    const s = fillCourts(withPlayers(createSession('singles', 1), [3, 3]))
    const [[blue], [orange]] = s.courts[0].teams!.map((team) => team.map((id) => s.players[id].name))
    expect(courtCallout(s, s.courts[0], null, { courtGame: '{bluePlayer1}|{bluePlayer2}|{orangePlayer1}|{orangePlayer2}' })).toBe(
      `${blue}||${orange}|`,
    )
  })
})
