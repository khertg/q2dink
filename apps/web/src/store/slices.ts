import type { LifetimeCounts } from '@/rotation/lifetime'
import type { SessionState } from '@/rotation/types'
import type { AuditEntry } from '@q2dink/shared'
import { rebase, type PendingAction, type Rebased } from './actions'

/**
 * Everything the store keeps about one session. The open one lives in the store's top-level fields (so the
 * board and the sync read it as ever); the others staff left without ending wait in `parked`, keyed by id,
 * unsent changes included, until they are opened again.
 */
export interface SessionSlice {
  location: string
  session: SessionState
  sessionId: string
  startedAt: number
  lifetimeCounted: LifetimeCounts
  base: { revision: number; session: SessionState } | null
  pending: PendingAction[]
  locationPending: boolean
  /**
   * The club signed in when it was left. Only that club is sent its changes, lists it, or can say it ended, so a
   * device used for two clubs never mixes their sessions. Missing: left with no club signed in (any club takes it).
   */
  clubSlug?: string
}

/** The store's fields that describe the open session (a slice, or none open). */
export interface OpenFields {
  location: string
  session: SessionState | null
  sessionId: string
  startedAt: number
  lifetimeCounted: LifetimeCounts
  base: { revision: number; session: SessionState } | null
  pending: PendingAction[]
  locationPending: boolean
}

/** The open fields with no session open. */
export const NONE_OPEN: OpenFields = {
  location: '',
  session: null,
  sessionId: '',
  startedAt: 0,
  lifetimeCounted: {},
  base: null,
  pending: [],
  locationPending: false,
}

/** The open session as a slice, or null when none is open. */
export function sliceOf(open: OpenFields): SessionSlice | null {
  if (!open.session) return null
  const { location, session, sessionId, startedAt, lifetimeCounted, base, pending, locationPending } = open
  return { location, session, sessionId, startedAt, lifetimeCounted, base, pending, locationPending }
}

/** `parked` with the open session (if any) put away in it, for the club signed in now (if any). */
export function park(
  parked: Record<string, SessionSlice>,
  open: OpenFields,
  clubSlug?: string | null,
): Record<string, SessionSlice> {
  const slice = sliceOf(open)
  return slice ? { ...parked, [slice.sessionId]: { ...slice, ...(clubSlug ? { clubSlug } : {}) } } : parked
}

/** Whether a parked session belongs with this club (or none signed in): one left for another club never does. */
export const parkedFor = (slice: SessionSlice, clubSlug: string | null | undefined) =>
  !slice.clubSlug || slice.clubSlug === clubSlug

/** `parked` without one session. */
export function unpark(parked: Record<string, SessionSlice>, sessionId: string): Record<string, SessionSlice> {
  if (!(sessionId in parked)) return parked
  const { [sessionId]: _taken, ...rest } = parked
  return rest
}

/** How many changes, across the parked sessions, the club has not taken yet (a rename counts as one). */
export const parkedUnsent = (parked: Record<string, SessionSlice>) =>
  Object.values(parked).reduce((sum, s) => sum + s.pending.length + (s.locationPending ? 1 : 0), 0)

/** Log entries saying which of this device's changes another device got to first, so the log never claims them. */
export function notAppliedAudits(dropped: Rebased['dropped']): AuditEntry[] {
  return dropped.flatMap(({ audit }) =>
    audit
      ? [{ ...audit, kind: `${audit.kind}NotApplied`, summary: `Not applied (changed on another device): ${audit.summary}`.slice(0, 300) }]
      : [],
  )
}

/**
 * A parked session the club took, with the first `count` pending changes in it, at `revision`, under the name
 * `sentLocation`. Returns the slice and the audit entries of the changes it took (to go into the log now).
 */
export function confirmSlice(
  slice: SessionSlice,
  count: number,
  sent: SessionState,
  revision: number,
  sentLocation: string,
): { slice: SessionSlice; confirmed: AuditEntry[] } {
  return {
    slice: {
      ...slice,
      base: { revision, session: sent },
      pending: slice.pending.slice(count),
      locationPending: slice.locationPending && sentLocation !== slice.location,
    },
    confirmed: slice.pending.slice(0, count).flatMap((p) => (p.audit ? [p.audit] : [])),
  }
}

/**
 * A parked session on the club's newer copy: its unsent changes applied again on top, its name the club's unless
 * it was renamed here and not sent yet. The same rule as the open session's rebaseOnto.
 */
export function rebaseSlice(
  slice: SessionSlice,
  revision: number,
  clubSession: SessionState,
  clubLocation?: string,
): { slice: SessionSlice; dropped: Rebased['dropped'] } {
  const rebased = rebase(clubSession, slice.pending)
  return {
    slice: {
      ...slice,
      base: { revision, session: clubSession },
      session: rebased.session,
      pending: rebased.pending,
      ...(clubLocation !== undefined && !slice.locationPending ? { location: clubLocation } : {}),
    },
    dropped: rebased.dropped,
  }
}
