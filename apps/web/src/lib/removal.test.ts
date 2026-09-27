import { describe, expect, it } from 'vitest'
import { checkIn, createSession, lockPartners, nextGroup, nextUpStandIn, recordScore, startGame } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { removalNotice, removedMessage } from './removal'

function withPlayers(count: number, courts = 1): SessionState {
  let s = createSession('doubles', courts)
  for (let id = 1; id <= count; id++) s = checkIn(s, { id, name: `P${id}`, skill: 3 })
  return s
}

describe('removalNotice', () => {
  it('says a player who never played can be checked in again', () => {
    expect(removalNotice(withPlayers(2), 1)).toBe('They can be checked in again later.')
  })

  it('says the court spot is left open and the game paused', () => {
    const s = startGame(withPlayers(4), 1, { now: 0 })
    expect(removalNotice(s, 1)).toBe(
      'Their spot on Court 1 is left open and the game is paused until someone fills it. They can be checked in again later.',
    )
  })

  it('names the Next up stand-in, and keeps results of a player who played', () => {
    let s = startGame(withPlayers(4), 1, { now: 0 })
    s = recordScore(s, 1, 11, 3, { now: 1000 }).state
    s = checkIn(s, { id: 5, name: 'P5', skill: 3 })
    const out = nextGroup(s)!.players[0]
    const standIn = nextUpStandIn(s, out)!
    const notice = removalNotice(s, out)
    expect(notice).toContain(`${s.players[standIn].name} takes their place in Next up.`)
    expect(notice).toContain('Their results stay in Standings')
  })
})

describe('removedMessage', () => {
  it('says who left and what happened to their spot', () => {
    expect(removedMessage(withPlayers(2), 2)).toBe('P2 left the session.')
    const s = startGame(withPlayers(4), 1, { now: 0 })
    expect(removedMessage(s, 1)).toBe('P1 left the session. The game on Court 1 is paused until the spot is filled.')
    const five = withPlayers(5)
    const [first] = five.queue
    expect(removedMessage(five, first)).toMatch(/^P1 left the session\. P5 is next up instead\.$/)
  })
})

describe('removing a locked player', () => {
  it('says their partner lock ends', () => {
    const s = lockPartners(withPlayers(4), 1, 2)
    expect(removalNotice(s, 1)).toBe('Their partner lock with P2 ends. They can be checked in again later.')
  })
})
