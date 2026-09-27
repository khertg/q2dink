import type { ClubSessionSummary } from '@q2dink/shared'
import { describe, expect, it } from 'vitest'
import { createSession, markNotStarted, pauseSession, resumeSession, startSessionClock } from '@/rotation/engine'
import { otherDevicesOpen, pausedNoticeFor, statusChangeMessage } from './pause'

const ME = 'me'
const DESK = { deviceId: 'desk', name: 'Desk' }
const running = () => startSessionClock(markNotStarted(createSession('doubles', 1), 0), 1000)

describe('pausedNoticeFor', () => {
  it('tells staff here that another device paused the session, and when', () => {
    const paused = pauseSession(running(), 5000, DESK)
    expect(pausedNoticeFor(paused, ME, null)).toEqual({ name: 'Desk', left: false, at: 5000 })
  })

  it('says when it was paused because that device left it', () => {
    const paused = pauseSession(running(), 5000, { ...DESK, reason: 'left' })
    expect(pausedNoticeFor(paused, ME, null)?.left).toBe(true)
  })

  it('says nothing for this device’s own pause, a running session or one not started', () => {
    expect(pausedNoticeFor(pauseSession(running(), 5000, { deviceId: ME, name: 'Me' }), ME, null)).toBeNull()
    expect(pausedNoticeFor(running(), ME, null)).toBeNull()
    expect(pausedNoticeFor(markNotStarted(createSession('doubles', 1), 0), ME, null)).toBeNull()
    expect(pausedNoticeFor(pauseSession(running(), 5000), ME, null)).toBeNull()
  })

  it('stays closed once dismissed, and comes back for the next pause', () => {
    const first = pauseSession(running(), 5000, DESK)
    expect(pausedNoticeFor(first, ME, 5000)).toBeNull()
    const second = pauseSession(resumeSession(first, 6000), 9000, DESK)
    expect(pausedNoticeFor(second, ME, 5000)).toEqual({ name: 'Desk', left: false, at: 9000 })
  })
})

describe('statusChangeMessage', () => {
  it('says who started or resumed the session on another device', () => {
    const notStarted = markNotStarted(createSession('doubles', 1), 0)
    expect(statusChangeMessage(notStarted, startSessionClock(notStarted, 10, DESK), ME)).toBe('Session started by Desk')
    const paused = pauseSession(running(), 5000, DESK)
    expect(statusChangeMessage(paused, resumeSession(paused, 6000, DESK), ME)).toBe('Resumed by Desk')
  })

  it('says nothing for this device’s own change, a pause, or no change', () => {
    const paused = pauseSession(running(), 5000)
    expect(statusChangeMessage(paused, resumeSession(paused, 6000, { deviceId: ME, name: 'Me' }), ME)).toBeNull()
    expect(statusChangeMessage(running(), paused, ME)).toBeNull()
    expect(statusChangeMessage(paused, paused, ME)).toBeNull()
  })
})

describe('otherDevicesOpen', () => {
  it('lists the devices other than this one that have the session open', () => {
    const summary = { openOn: [DESK, { deviceId: ME, name: 'Me' }] } as ClubSessionSummary
    expect(otherDevicesOpen(summary, ME)).toEqual([DESK])
    expect(otherDevicesOpen(undefined, ME)).toEqual([])
  })
})
