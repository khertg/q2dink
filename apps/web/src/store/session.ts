import { MAX_LOCATION_LENGTH } from '@q2dink/shared'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  createSession,
  markNotStarted,
  playingIds,
  sessionStatus,
  setAvgGameMinutes as setAvgGameMinutesEngine,
  setLive as setLiveEngine,
  renamePlayer as renamePlayerEngine,
  setPlayerSkill as setPlayerSkillEngine,
  shiftSessionClock,
  type MatchEdit,
  type NextGroupOptions,
  type ReplacePlayerOptions,
  type SessionOptions,
} from '@/rotation/engine'
import { applyAction, rebase, type PendingAction, type Rebased, type SessionAction } from './actions'
import type { SkillLevel } from '@/db/db'
import type { GameMode, RosterPlayer, SessionState } from '@/rotation/types'
import { newAuditEntry, queueAudit, recordAudit } from '@/cloud/audit'
import { newBatchId } from '@/cloud/id'
import { describeAction } from './auditText'
import type { LifetimeCounts } from '@/rotation/lifetime'
import { migrateSession, SESSION_STORE_VERSION } from './migrate'
import { belongsTo, NONE_OPEN, notAppliedAudits, park, unpark, type SessionSlice } from './slices'
import { deviceRef } from '@/lib/device'
import { DEFAULT_SCALE, ratingOf } from '@/lib/skill'
import { clubScaleFor } from '@/lib/skillScaleStore'
import { sameScale, type SkillScale } from '@q2dink/shared'
import { useClubAuth } from '@/cloud/auth'

interface SessionStore {
  location: string
  session: SessionState | null
  /** Snapshot from before the last recorded result; cleared by any other change. */
  previous: SessionState | null
  /** Identifies this session in history; a resumed session keeps it. Empty when none is running. */
  sessionId: string
  /** When the session began (ms since the epoch). */
  startedAt: number
  /** What this session has already added to the all-time totals. */
  lifetimeCounted: LifetimeCounts
  /**
   * While the session is shared with the club (several staff devices can run it): the club's copy as
   * this device last had it, and its revision. `session` is always `base.session` with `pending` applied.
   * Null when not shared (no cloud, or not sent yet).
   */
  base: { revision: number; session: SessionState } | null
  /** This device's changes the club has not taken yet, oldest first. Empty while not shared. */
  pending: PendingAction[]
  /**
   * Sessions that ended here whose end the club may not have been told yet (the app can close or
   * reload right after), so the cloud sync ends exactly those there. Each is removed once it is told.
   */
  endedSessionIds: string[]
  /**
   * Sessions staff left without ending, by id, each with its unsent changes. Several sessions can run at
   * once; only the open one is in the fields above. The sync still sends a parked one's changes.
   */
  parked: Record<string, SessionSlice>
  /**
   * The session was renamed here and the club has not taken the new name yet. Until then, a club copy
   * adopted from another device keeps this name rather than bringing the old one back.
   */
  locationPending: boolean
  /**
   * The club the open session belongs to: the one signed in when it was created, resumed, joined or opened here.
   * While another club is signed in it is parked, never shown or sent. Missing: none yet (older data, no cloud).
   */
  clubSlug?: string
  /**
   * Sessions that ended here, by id, with the club they belong to, so an end waiting to be sent only ever goes
   * to that club. Missing entry: any club (ended before this was kept).
   */
  endedClubs?: Record<string, string>

  /**
   * Put the open session away when it belongs to a club other than `slug` (just signed in): it is parked under its
   * own club, not paused (its club may still run it on other devices), and shown again when that club logs in.
   * An open session with no club yet is taken by this one.
   */
  parkIfOtherClub: (slug: string) => void

  /**
   * Create a session and open it, not started: players can be checked in, but no clock runs and no game
   * starts until startClock. A session already open is left running (parked), not ended.
   */
  startSession: (
    location: string,
    mode: GameMode,
    courtCount: number,
    options?: SessionOptions,
  ) => void
  /** Start the open session (Start session): waiting times run from now and games can begin. */
  startClock: () => void
  /** Pause the open session: every clock stands still and no game starts until it is resumed. */
  pauseSession: () => void
  resumeSession: () => void
  /**
   * Leave the open session without ending it: it stays running (or is paused first with `pause`, recorded
   * as paused because this device left) and can be opened again from the setup screen.
   */
  leaveSession: (options: { pause: boolean }) => void
  /** Open a session left here earlier. The session open now, if any, is left running. */
  openSession: (sessionId: string) => void
  /** A parked session's slice after the sync sent or rebased it. */
  updateParked: (sessionId: string, update: (slice: SessionSlice) => SessionSlice) => void
  /** Forget a parked session (it ended on another device and was kept in Past sessions). */
  dropParked: (sessionId: string) => void
  /** Rename the running session. Throws a RangeError with a readable message if the name is not allowed. */
  renameSession: (name: string) => void
  setAvgGameMinutes: (minutes: number) => void
  /** Use other skill levels for the open session (the club's new ones): levels follow the players' ratings. */
  setSkillScale: (scale: SkillScale) => void
  /** Show the session on the club's public live page, or keep it off it (staff devices share it either way). */
  setLive: (live: boolean) => void
  /** Change a checked-in player's skill level. Future matching follows it; a pending result undo stays. */
  setPlayerSkill: (playerId: number, skill: SkillLevel) => void
  /** Rename a checked-in player. Throws a RangeError with a readable message if the name is not allowed. */
  renamePlayer: (playerId: number, name: string) => void
  /** Returns false if the player was already queued or playing. */
  checkInPlayer: (player: RosterPlayer) => boolean
  /** Check several players in at once, in the order given. Returns how many were newly checked in. */
  checkInPlayers: (players: RosterPlayer[]) => number
  checkOutPlayer: (playerId: number) => void
  /** Take a player out of the session, from the queue, a break, Next up or a court. */
  removePlayer: (playerId: number) => void
  recordResult: (courtId: number, winner: 0 | 1) => void
  /**
   * Record a game from its score (Team A, then Team B); the higher score wins. Throws a RangeError
   * for equal or out-of-range scores. One change, undone exactly like recordResult.
   */
  recordScore: (courtId: number, scoreA: number, scoreB: number) => void
  /**
   * Correct an already-recorded match's score and/or which players were on each team. Recomputes
   * every player's stats from the whole corrected match history. Throws a RangeError for an
   * invalid score, or an Error for an out-of-range match index.
   */
  editMatch: (matchIndex: number, edit: MatchEdit) => void
  /** Restores the state from before the last result. Returns false if it is no longer safe. */
  undo: () => boolean
  cancelMatch: (courtId: number) => void
  /**
   * Put the next group on an open court. Games never start by themselves; this is the only
   * way one begins. `ignoreMode` is the mixed-doubles override (start with whoever is waiting).
   */
  startGame: (courtId: number, options?: NextGroupOptions) => void
  /** Open another court (named with the lowest free number unless given). It starts open. */
  addCourt: (name?: string) => void
  /** Rename a court. Throws a RangeError with a readable message if the name is empty, too long or taken. */
  renameCourt: (courtId: number, name: string) => void
  /** Keep a court for a range of skill levels (min, max), or any level with null. Throws a RangeError for a bad range. */
  setCourtLevels: (courtId: number, levels: [number, number] | null) => void
  /** Move a court one place up (-1) or down (1) on the board. */
  moveCourt: (courtId: number, offset: -1 | 1) => void
  /** Close a court. A game in progress is cancelled and its players return to the front of the queue. */
  closeCourt: (courtId: number) => void
  /**
   * Swap a playing player for anyone else (defaults to the front of the queue). One from the queue or a
   * break sends the other to the front of the queue (or on a break with `sendOnBreak`); two on courts trade places.
   */
  replacePlayer: (courtId: number, outId: number, inId?: number, options?: ReplacePlayerOptions) => void
  /** Put anyone in the next group in the spot of one of its players (see the engine). The group stays as chosen. */
  replaceNextUp: (outId: number, inId: number) => void
  /** Take a player out of the next group: a stand-in takes their spot; they keep their queue place, or go on a break. */
  dropFromNextUp: (playerId: number, onBreak: boolean) => void
  /** Take a player off a court, leaving the spot open and the game paused; they go to the front of the queue or on a break. */
  removeFromCourt: (courtId: number, playerId: number, onBreak: boolean) => void
  /** Put a waiting (or resting) player in an open spot on a team; the game runs again once the court is full. */
  fillCourtSpot: (courtId: number, team: 0 | 1, slot: number, playerId: number) => void
  /** Pin a waiting (or resting) player into an open Next up spot of a lane; the group forms around them. */
  fillNextUpSpot: (lane: number, slot: number, playerId: number) => void
  /** Go back to the automatic next group. */
  resetNextUp: () => void
  /** Lock two checked-in players as doubles partners. */
  /** `now`: in force at once even while one of them is away (see LockOptions in the engine). */
  lockPartners: (a: number, b: number, now?: boolean) => void
  unlockPartners: (playerId: number) => void
  /** Replace the running session, for example one resumed from the cloud on another device. */
  loadSession: (location: string, session: SessionState, meta?: ResumeMeta) => void
  /** Remember what has been added to the all-time totals, so a resumed session adds only what is new. */
  markLifetimeCounted: (counted: LifetimeCounts) => void
  endSession: () => void

  /** Start sharing the running session with the club: from now on changes are kept until it has them. */
  shareSession: () => void
  /**
   * The club took this session, with the first `count` pending changes in it, at `revision`, under the
   * name `sentLocation` (a rename made while it was being sent stays pending).
   */
  confirmPublished: (count: number, sent: SessionState, revision: number, sentLocation?: string) => void
  /**
   * Another staff device moved the club's copy on: take it, and apply this device's unsent changes on
   * top, and its name unless this device renamed the session and has not sent that yet. Returns the
   * changes that no longer applied, and why.
   */
  rebaseOnto: (revision: number, session: SessionState, clubLocation?: string) => Rebased['dropped']
  /** Run the club's session here too, alongside the device that started it. */
  joinShared: (location: string, session: SessionState, meta: ResumeMeta, revision: number) => void
}

/** What identifies a session across ending and resuming it. */
export interface ResumeMeta {
  sessionId: string
  startedAt: number
  lifetimeCounted: LifetimeCounts
  /**
   * When the session ended (ms since the epoch), if it did. Given only when resuming a session
   * that was actually ended (the toast's "Resume", or Past sessions) — never for picking up a
   * session another staff device is actively running, which never ended. When given, wait times
   * and an in-progress game's elapsed time are frozen at what they were when it ended, instead of
   * counting the gap until now as more waiting/playing.
   */
  endedAt?: number
}

const requireSession = (session: SessionState | null) => {
  if (!session) throw new Error('No session in progress')
  return session
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => {
      /**
       * Apply one change here and, while the session is shared with the club, keep it until the club has
       * it, so it can be applied again on the club's copy if another staff device changed that meanwhile.
       */
      const dispatch = (action: SessionAction, previous: SessionState | null) => {
        const session = requireSession(get().session)
        const applied = applyAction(session, action)
        const { base, pending, sessionId } = get()
        const text = describeAction(session, action, applied.session)
        const audit = newAuditEntry(text.kind, text.summary, sessionId)
        set({
          session: applied.session,
          previous,
          ...(base
            ? { pending: [...pending, { action, ...(applied.ids ? { ids: applied.ids } : {}), ...(audit ? { audit } : {}) }] }
            : {}),
        })
        // Not shared with the club yet: nothing can refuse it, so it goes straight into the log.
        if (!base && audit) void queueAudit([audit])
      }

      return {
        location: '',
        session: null,
        previous: null,
        sessionId: '',
        startedAt: 0,
        lifetimeCounted: {},
        base: null,
        pending: [],
        endedSessionIds: [],
        parked: {},
        locationPending: false,

        startSession: (location, mode, courtCount, options) => {
          const sessionId = newBatchId()
          const now = Date.now()
          set((state) => ({
            parked: park(state.parked, state, useClubAuth.getState().club?.slug),
            location,
            // Not started (no clock runs) and not on the public live page until staff choose Go live.
            // It keeps the club's skill levels as they are now; a later change is applied to it only when staff choose.
            session: setLiveEngine(
              markNotStarted(
                createSession(mode, courtCount, { ...options, skillScale: ownScale(clubScaleFor(useClubAuth.getState().club?.slug)) }),
                now,
              ),
              false,
            ),
            previous: null,
            sessionId,
            startedAt: now,
            lifetimeCounted: {},
            base: null,
            pending: [],
            locationPending: false,
            clubSlug: useClubAuth.getState().club?.slug,
          }))
          const courts = `${courtCount} court${courtCount === 1 ? '' : 's'}`
          recordAudit('sessionCreated', `Created “${location}” (${mode === 'doubles' ? 'Doubles' : 'Singles'}, ${courts})`, sessionId)
        },

        // Undoing a result across a start or pause would also undo the clock change: the undo is cleared.
        startClock: () => dispatch({ type: 'startClock', now: Date.now(), by: deviceRef() }, null),

        pauseSession: () => dispatch({ type: 'pause', now: Date.now(), by: deviceRef() }, null),

        resumeSession: () => dispatch({ type: 'resume', now: Date.now(), by: deviceRef() }, null),

        leaveSession: ({ pause }) => {
          const { session, location, sessionId } = get()
          if (!session) return
          const pausing = pause && sessionStatus(session) === 'running'
          if (pausing) dispatch({ type: 'pause', now: Date.now(), by: { ...deviceRef(), reason: 'left' } }, null)
          set((state) => ({ parked: park(state.parked, state, useClubAuth.getState().club?.slug), ...NONE_OPEN, previous: null }))
          recordAudit('sessionLeft', `Left “${location}”${pausing ? ' and paused it' : ' running'}`, sessionId)
        },

        openSession: (sessionId) => {
          const slice = get().parked[sessionId]
          if (!slice || get().sessionId === sessionId) return
          set((state) => ({
            parked: unpark(park(state.parked, state, useClubAuth.getState().club?.slug), sessionId),
            ...slice,
            // Opened here, it belongs to the club signed in unless it already has one.
            clubSlug: slice.clubSlug ?? useClubAuth.getState().club?.slug,
            previous: null,
          }))
          recordAudit('sessionOpened', `Opened “${slice.location}”`, sessionId)
        },

        updateParked: (sessionId, update) =>
          set((state) => {
            const slice = state.parked[sessionId]
            return slice ? { parked: { ...state.parked, [sessionId]: update(slice) } } : {}
          }),

        dropParked: (sessionId) => set((state) => ({ parked: unpark(state.parked, sessionId) })),

        parkIfOtherClub: (slug) => {
          const { session, clubSlug } = get()
          if (!session || clubSlug === slug) return
          if (!clubSlug) return set({ clubSlug: slug })
          set((state) => ({ parked: park(state.parked, state), ...NONE_OPEN, previous: null }))
        },

        renameSession: (name) => {
          requireSession(get().session)
          const trimmed = name.trim()
          if (!trimmed) throw new RangeError('Enter a session name.')
          if (trimmed.length > MAX_LOCATION_LENGTH) {
            throw new RangeError(`Keep the name to ${MAX_LOCATION_LENGTH} characters or fewer.`)
          }
          const { location: was, sessionId } = get()
          if (trimmed === was) return
          // While shared, the club has to be sent the new name even with no other change pending.
          set((state) => ({ location: trimmed, locationPending: state.base !== null }))
          recordAudit('sessionRenamed', `Renamed the session “${was}” to “${trimmed}”`, sessionId)
        },

        setLive: (live) => {
          const { previous } = get()
          // A setting, not a game event: undoing a result must never take the session off (or onto) the live page.
          dispatch({ type: 'setLive', live }, previous && setLiveEngine(previous, live))
        },

        setSkillScale: (scale) => dispatch({ type: 'setSkillScale', scale }, null),

        setAvgGameMinutes: (minutes) => {
          const { previous } = get()
          // A setting, not a game event: keep the pending result undo, but carry the
          // new value into its snapshot so undoing a result never reverts the setting.
          dispatch({ type: 'setAvgGameMinutes', minutes }, previous && setAvgGameMinutesEngine(previous, minutes))
        },

        setPlayerSkill: (playerId, skill) => {
          const { previous } = get()
          // Like the game length, a correction rather than a game event: keep the pending result undo,
          // and carry the new level into its snapshot so undoing a result never reverts it.
          dispatch(
            { type: 'setPlayerSkill', playerId, skill },
            previous?.players[playerId] ? setPlayerSkillEngine(previous, playerId, skill) : previous,
          )
        },

        renamePlayer: (playerId, name) => {
          const { previous } = get()
          // A correction, like a skill change: undoing a result must never bring the old name back.
          dispatch(
            { type: 'renamePlayer', playerId, name },
            previous?.players[playerId] ? renamePlayerEngine(previous, playerId, name) : previous,
          )
        },

        checkInPlayer: (player) => get().checkInPlayers([player]) === 1,

        checkInPlayers: (players) => {
          const session = requireSession(get().session)
          const action: SessionAction = {
            type: 'checkIn',
            // The rating decides their level on the session's scale when the check-in is applied.
            players: players.map((p) => ({
              name: p.name,
              skill: p.skill,
              rating: ratingOf(p),
              ...(p.gender ? { gender: p.gender } : {}),
            })),
            now: Date.now(),
          }
          // Players already waiting or playing (matched by name) are not checked in again.
          const waiting = new Set([...session.queue, ...playingIds(session)])
          const { ids = [] } = applyAction(session, action)
          const added = new Set(ids.filter((id) => !waiting.has(id))).size
          if (added > 0) dispatch(action, null)
          return added
        },

        checkOutPlayer: (playerId) => dispatch({ type: 'checkOut', playerId }, null),
        removePlayer: (playerId) => dispatch({ type: 'removePlayer', playerId, now: Date.now() }, null),

        recordResult: (courtId, winner) =>
          dispatch({ type: 'recordResult', courtId, winner, now: Date.now() }, requireSession(get().session)),

        recordScore: (courtId, scoreA, scoreB) =>
          dispatch({ type: 'recordScore', courtId, scoreA, scoreB, now: Date.now() }, requireSession(get().session)),

        editMatch: (matchIndex, edit) => dispatch({ type: 'editMatch', matchIndex, edit }, null),

        undo: () => {
          const { previous, session } = get()
          if (!previous || !session) return false
          dispatch({ type: 'restore', before: previous, after: session }, null)
          return true
        },

        cancelMatch: (courtId) => dispatch({ type: 'cancelMatch', courtId, now: Date.now() }, null),

        startGame: (courtId, options) =>
          dispatch({ type: 'startGame', courtId, ...(options ? { options } : {}), now: Date.now() }, null),

        // Court changes clear the result undo: undoing a result would otherwise put players back
        // on a court that has since been closed, or quietly reverse the change.
        addCourt: (name) => dispatch({ type: 'addCourt', ...(name !== undefined ? { name } : {}) }, null),

        renameCourt: (courtId, name) => dispatch({ type: 'renameCourt', courtId, name }, null),

        setCourtLevels: (courtId, levels) => dispatch({ type: 'setCourtLevels', courtId, levels }, null),

        moveCourt: (courtId, offset) => dispatch({ type: 'moveCourt', courtId, offset }, null),

        // A cancelled game's players wait at the front of the queue until staff start a game.
        closeCourt: (courtId) => dispatch({ type: 'closeCourt', courtId, now: Date.now() }, null),

        replacePlayer: (courtId, outId, inId, options) =>
          dispatch(
            {
              type: 'replacePlayer',
              courtId,
              outId,
              ...(inId !== undefined ? { inId } : {}),
              ...(options ? { options } : {}),
              now: Date.now(),
            },
            null,
          ),

        replaceNextUp: (outId, inId) => dispatch({ type: 'replaceNextUp', outId, inId, now: Date.now() }, null),

        dropFromNextUp: (playerId, onBreak) => dispatch({ type: 'dropFromNextUp', playerId, onBreak }, null),

        removeFromCourt: (courtId, playerId, onBreak) =>
          dispatch({ type: 'removeFromCourt', courtId, playerId, onBreak, now: Date.now() }, null),

        fillCourtSpot: (courtId, team, slot, playerId) =>
          dispatch({ type: 'fillCourtSpot', courtId, team, slot, playerId, now: Date.now() }, null),

        fillNextUpSpot: (lane, slot, playerId) =>
          dispatch({ type: 'fillNextUpSpot', lane, slot, playerId, now: Date.now() }, null),

        resetNextUp: () => dispatch({ type: 'resetNextUp' }, null),

        lockPartners: (a, b, now) => dispatch({ type: 'lockPartners', a, b, ...(now ? { lockNow: true } : {}) }, null),

        unlockPartners: (playerId) => dispatch({ type: 'unlockPartners', playerId }, null),

        loadSession: (location, session, meta) =>
          set((state) => ({
            // A session open here keeps running; the resumed one takes its place on screen.
            parked: unpark(park(state.parked, state, useClubAuth.getState().club?.slug), meta?.sessionId ?? ''),
            location,
            // A session whose clock stood still when it ended (paused, not started) counts the gap when resumed.
            session:
              meta?.endedAt === undefined || session.clockStoppedAt !== undefined
                ? session
                : shiftSessionClock(session, Date.now() - meta.endedAt),
            previous: null,
            // Resuming keeps the session's identity, so ending it again updates its history entry.
            sessionId: meta?.sessionId ?? newBatchId(),
            startedAt: meta?.startedAt ?? Date.now(),
            lifetimeCounted: meta?.lifetimeCounted ?? {},
            base: null,
            pending: [],
            locationPending: false,
            clubSlug: useClubAuth.getState().club?.slug,
          })),

        shareSession: () => {
          const { session, base } = get()
          if (session && !base) set({ base: { revision: 0, session }, pending: [] })
        },

        confirmPublished: (count, sent, revision, sentLocation) => {
          // The club has these changes now: they go into the log.
          const confirmed = get().pending.slice(0, count).flatMap((p) => (p.audit ? [p.audit] : []))
          if (confirmed.length > 0) void queueAudit(confirmed)
          set((state) => ({
            base: { revision, session: sent },
            pending: state.pending.slice(count),
            locationPending: state.locationPending && sentLocation !== state.location,
          }))
        },

        rebaseOnto: (revision, clubSession, clubLocation) => {
          const { session, pending, locationPending } = get()
          if (!session) return []
          const rebased = rebase(clubSession, pending)
          // What another device got to first is logged as not done, so the log never claims it happened.
          const notApplied = notAppliedAudits(rebased.dropped)
          if (notApplied.length > 0) void queueAudit(notApplied)
          set({
            base: { revision, session: clubSession },
            session: rebased.session,
            pending: rebased.pending,
            previous: null,
            ...(clubLocation !== undefined && !locationPending ? { location: clubLocation } : {}),
          })
          return rebased.dropped
        },

        joinShared: (location, session, meta, revision) =>
          set((state) => ({
            parked: unpark(park(state.parked, state, useClubAuth.getState().club?.slug), meta.sessionId),
            location,
            session,
            previous: null,
            sessionId: meta.sessionId,
            startedAt: meta.startedAt,
            lifetimeCounted: meta.lifetimeCounted,
            base: { revision, session },
            pending: [],
            locationPending: false,
            clubSlug: useClubAuth.getState().club?.slug,
          })),

        /** Record which all-time totals this session has now contributed, after saving them. */
        markLifetimeCounted: (counted) => set({ lifetimeCounted: counted }),

        endSession: () =>
          set((state) => ({
            ...NONE_OPEN,
            previous: null,
            endedSessionIds:
              state.session && !state.endedSessionIds.includes(state.sessionId)
                ? [...state.endedSessionIds, state.sessionId]
                : state.endedSessionIds,
            // Its end is only ever sent to its own club.
            ...(state.session && state.clubSlug
              ? { endedClubs: { ...state.endedClubs, [state.sessionId]: state.clubSlug } }
              : {}),
          })),
      }
    },
    {
      name: 'q2dink-session',
      version: SESSION_STORE_VERSION,
      migrate: (persisted, version) => {
        const { endedSessionId, ...saved } = persisted as {
          location: string
          session: SessionState | null
          sessionId?: string
          startedAt?: number
          lifetimeCounted?: LifetimeCounts
          endedSessionId?: string
          endedSessionIds?: string[]
          parked?: Record<string, SessionSlice>
        }
        // A session already running when history arrived gets an identity now.
        return {
          ...saved,
          session: migrateSession(saved.session, version),
          // Version 9: several sessions (parked ones), and several ends waiting to reach the club.
          endedSessionIds: saved.endedSessionIds ?? (endedSessionId ? [endedSessionId] : []),
          parked: Object.fromEntries(
            Object.entries(saved.parked ?? {}).map(([id, slice]) => [
              id,
              { ...slice, session: migrateSession(slice.session, version) ?? slice.session },
            ]),
          ),
          sessionId: saved.sessionId ?? (saved.session ? newBatchId() : ''),
          startedAt: saved.startedAt ?? (saved.session ? Date.now() : 0),
          lifetimeCounted: saved.lifetimeCounted ?? {},
        }
      },
      storage: createJSONStorage(() => localStorage),
      // The undo snapshot only makes sense for a few seconds, so never persist it.
      // `base` and `pending` are kept, so changes made offline still reach the club after a reload.
      partialize: ({
        location,
        session,
        sessionId,
        startedAt,
        lifetimeCounted,
        base,
        pending,
        endedSessionIds,
        endedClubs,
        parked,
        locationPending,
        clubSlug,
      }) => ({
        location,
        locationPending,
        session,
        sessionId,
        startedAt,
        lifetimeCounted,
        base,
        pending,
        endedSessionIds,
        endedClubs,
        parked,
        clubSlug,
      }),
    },
  ),
)

/**
 * The scale a new session keeps: none when the club uses the default one, so the session follows the default (and
 * never offers "new levels" just because the default's wording was improved later).
 */
const ownScale = (scale: SkillScale) => (sameScale(scale, DEFAULT_SCALE) ? undefined : scale)

/** Whether the open session (if any) belongs with this club: one owned by another club is never shown or sent. */
export const openBelongsTo = (clubSlug: string | null | undefined) =>
  belongsTo(useSessionStore.getState().clubSlug, clubSlug)

/**
 * A session belongs to its club: when another club logs in on this device, the open session is put away at once,
 * before the cloud sync reacts to the login (it subscribed later), so it is never shown, sent or taken as ended.
 */
function guardOpenSession(slug: string | undefined) {
  if (slug) useSessionStore.getState().parkIfOtherClub(slug)
}
guardOpenSession(useClubAuth.getState().club?.slug)
useClubAuth.subscribe((state, prev) => {
  if (state.club?.slug !== prev.club?.slug) guardOpenSession(state.club?.slug)
})

/** Number of players currently checked in and not on a break (queued or playing). */
export const activePlayerCount = (session: SessionState) =>
  session.queue.length + playingIds(session).length
