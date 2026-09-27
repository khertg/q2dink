import { describe, expect, it } from 'vitest'
import { createSession } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { applyAction, type SessionAction } from './actions'
import { describeAction } from './auditText'

const checkIn = (...names: string[]): SessionAction => ({
  type: 'checkIn',
  players: names.map((name) => ({ name, skill: 3 })),
  now: 0,
})
const apply = (session: SessionState, ...actions: SessionAction[]) =>
  actions.reduce((s, action) => applyAction(s, action).session, session)

/** What the log would say for `action` on `before`. */
const say = (before: SessionState, action: SessionAction) => describeAction(before, action, apply(before, action)).summary

// Ann=1, Bob=2, Cy=3, Dee=4 on Court 1 (Ann & Bob vs Cy & Dee), Eve=5 and Fay=6 waiting.
const waiting = apply(createSession('doubles', 2), checkIn('Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay'))
const playing = apply(waiting, { type: 'startGame', courtId: 1, now: 1000 })
const [blue, orange] = playing.courts[0].teams!
const n = (s: SessionState, ids: number[]) => ids.map((id) => s.players[id].name).join(' & ')
const lineUp = `${n(playing, blue)} vs ${n(playing, orange)}`

describe('describeAction', () => {
  it('names who was checked in, and who came back from a break', () => {
    expect(say(createSession('doubles', 1), checkIn('Ann', 'Bob'))).toBe('Checked in Ann, Bob')
    const onBreak = apply(waiting, { type: 'checkOut', playerId: 5 })
    expect(say(onBreak, checkIn('eve', 'Gus'))).toBe('Checked in Gus. Back from a break: eve')
    expect(say(waiting, { type: 'checkOut', playerId: 5 })).toBe('Eve took a break')
  })

  it('names who was removed from the session, and the court they left', () => {
    expect(say(waiting, { type: 'removePlayer', playerId: 5, now: 0 })).toBe('Removed Eve from the session')
    expect(say(playing, { type: 'removePlayer', playerId: blue[0], now: 2000 })).toBe(
      `Removed ${playing.players[blue[0]].name} from the session (off Court 1, spot left open)`,
    )
  })

  it('names the court and the players of a game started, won or cancelled', () => {
    expect(say(waiting, { type: 'startGame', courtId: 1, now: 1000 })).toBe(`Court 1: started ${lineUp}`)
    expect(say(playing, { type: 'recordScore', courtId: 1, scoreA: 7, scoreB: 11, now: 2000 })).toBe(
      `Court 1: Orange won 11–7 (${lineUp})`,
    )
    expect(say(playing, { type: 'recordResult', courtId: 1, winner: 0, now: 2000 })).toBe(`Court 1: Blue won (${lineUp})`)
    expect(say(playing, { type: 'cancelMatch', courtId: 1, now: 2000 })).toBe(`Court 1: game cancelled (${lineUp})`)
  })

  it('says a court being set up by hand was cleared, not a game cancelled', () => {
    const staged = apply(waiting, { type: 'fillCourtSpot', courtId: 2, team: 0, slot: 0, playerId: 5, now: 1000 })
    expect(say(waiting, { type: 'fillCourtSpot', courtId: 2, team: 0, slot: 0, playerId: 5, now: 1000 })).toBe(
      'Court 2: Eve into the open Blue spot',
    )
    expect(say(staged, { type: 'cancelMatch', courtId: 2, now: 2000 })).toBe('Court 2: cleared the line-up')
  })

  it('names a corrected game by its court and number', () => {
    const played = apply(playing, { type: 'recordScore', courtId: 1, scoreA: 11, scoreB: 5, now: 2000 })
    expect(say(played, { type: 'editMatch', matchIndex: 0, edit: { score: [11, 9] } })).toBe('Corrected Court 1, game 1: score 11–9')
  })

  it('names both players of a swap, even when the queue chose who came in', () => {
    const out = blue[0]
    expect(say(playing, { type: 'replacePlayer', courtId: 1, outId: out, inId: 6, now: 1500 })).toBe(
      `Court 1: Fay in for ${playing.players[out].name}`,
    )
    expect(say(playing, { type: 'replacePlayer', courtId: 1, outId: out, now: 1500 })).toBe(
      `Court 1: Eve in for ${playing.players[out].name}`,
    )
  })

  it('says a player taken off a court leaves their spot open', () => {
    expect(say(playing, { type: 'removeFromCourt', courtId: 1, playerId: blue[0], onBreak: true, now: 1500 })).toBe(
      `Court 1: took ${playing.players[blue[0]].name} off (on a break), spot left open`,
    )
  })

  it('covers the Next up card', () => {
    const next = playing.queue
    expect(say(playing, { type: 'resetNextUp' })).toBe('Next up: back to automatic')
    expect(say(waiting, { type: 'dropFromNextUp', playerId: 1, onBreak: false })).toBe('Next up: took out Ann')
    expect(say(waiting, { type: 'replaceNextUp', outId: 1, inId: 5, now: 0 })).toBe('Next up: Eve in for Ann')
    expect(next.length).toBeGreaterThan(0)
  })

  it('covers courts and settings', () => {
    expect(say(waiting, { type: 'addCourt' })).toBe('Added Court 3')
    expect(say(waiting, { type: 'renameCourt', courtId: 1, name: ' Center ' })).toBe('Renamed Court 1 to Center')
    expect(say(waiting, { type: 'setCourtLevels', courtId: 2, levels: null })).toBe('Court 2: open to any level')
    expect(say(waiting, { type: 'setCourtLevels', courtId: 2, levels: [4, 6] })).toMatch(/^Court 2: kept for /)
    expect(say(waiting, { type: 'moveCourt', courtId: 2, offset: -1 })).toBe('Moved Court 2 up')
    expect(say(waiting, { type: 'closeCourt', courtId: 2, now: 0 })).toBe('Closed Court 2')
    expect(say(waiting, { type: 'setAvgGameMinutes', minutes: 15 })).toBe('Set the game length to 15 min')
    expect(say(waiting, { type: 'setLive', live: true })).toBe('Went live: players can see the board')
    expect(say(waiting, { type: 'setLive', live: false })).toBe('Stopped live: the public page shows no game')
    expect(say(waiting, { type: 'setPlayerSkill', playerId: 1, skill: 5 })).toBe("Changed Ann's level to Advanced")
    expect(say(waiting, { type: 'renamePlayer', playerId: 1, name: 'Anne' })).toBe('Renamed Ann to Anne')
  })

  it('names both partners when locking and unlocking', () => {
    const locked = apply(waiting, { type: 'lockPartners', a: 5, b: 6 })
    expect(say(waiting, { type: 'lockPartners', a: 5, b: 6 })).toBe('Locked Eve & Fay as partners')
    expect(say(locked, { type: 'unlockPartners', playerId: 6 })).toBe('Unlocked Eve & Fay')
  })

  it('says an undo was an undo, and gives every action its type as the kind', () => {
    const text = describeAction(playing, { type: 'restore', before: waiting, after: playing }, waiting)
    expect(text).toEqual({ kind: 'restore', summary: 'Undid the last change' })
    expect(describeAction(waiting, checkIn('Gus'), apply(waiting, checkIn('Gus'))).kind).toBe('checkIn')
  })
})

describe('describeAction for the session clock', () => {
  const desk = { deviceId: 'd', name: 'Desk' }

  it('says the session started, was paused (and why) and resumed', () => {
    const notStarted = { ...waiting, notStarted: true as const, clockStoppedAt: 0 }
    expect(say(notStarted, { type: 'startClock', now: 5 })).toBe('Started the session: waiting times run from now')
    expect(say(waiting, { type: 'pause', now: 5, by: desk })).toBe('Paused the session')
    expect(say(waiting, { type: 'pause', now: 5, by: { ...desk, reason: 'left' } })).toBe('Paused the session on leaving it')
    const paused = apply(waiting, { type: 'pause', now: 5, by: desk })
    expect(say(paused, { type: 'pause', now: 6 })).toBe('Paused the session (it was already paused)')
    expect(say(paused, { type: 'resume', now: 9 })).toBe('Resumed the session')
  })
})

describe('describeAction for skill levels', () => {
  const FOUR = { levels: [{ label: 'Social', from: 1 }, { label: 'Club', from: 3 }, { label: 'Strong', from: 4 }, { label: 'Pro', from: 5 }] }

  it('names the new levels, and names a player’s level on the session’s scale', () => {
    expect(say(waiting, { type: 'setSkillScale', scale: FOUR })).toBe('Changed the skill levels to 4: Social, Club, Strong, Pro')
    const custom = apply(waiting, { type: 'setSkillScale', scale: FOUR })
    expect(say(custom, { type: 'setPlayerSkill', playerId: 1, skill: 4 })).toBe("Changed Ann's level to Pro")
    expect(say(waiting, { type: 'setPlayerSkill', playerId: 1, skill: 4 })).toBe("Changed Ann's level to Intermediate")
  })
})
