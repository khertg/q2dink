import {
  isErrorCode,
  type AuditPage,
  type ClubDevice,
  type ClubSessionSummary,
  type DeletedHistorySummary,
  type AuthGrant,
  type AvatarIndex,
  type HistorySummary,
  type LifetimePlayer,
  type LiveRow,
  type LiveSessionsResponse,
  type LoginResponse,
  type ConflictBody,
  type PublishResponse,
  type RenameClubResponse,
  type ResetPasswordResponse,
  type SessionStateRow,
  type SessionsResponse,
  type RosterResponse,
  type StaffAvatar,
  type StaffAvatarIndex,
} from '@q2dink/shared'
import { CloudError, type CloudApi } from './api'

interface Options {
  /** Overridable for tests. */
  fetch?: typeof fetch
  EventSource?: typeof EventSource
}

interface RequestOptions {
  token?: string
  body?: unknown
  /** Treat "404 not found" as an empty result instead of an error. */
  nullOn404?: boolean
}

/** Turn an HTTP error reply into the matching CloudError. */
function errorFrom(status: number, body: unknown): CloudError {
  const code = (body as { error?: unknown } | null)?.error
  if (isErrorCode(code)) return new CloudError(code, undefined, body)
  // A proxy in front of the API answers 502/503/504 while it restarts: treat as unreachable.
  if (status === 502 || status === 503 || status === 504) return new CloudError('network')
  const message = (body as { message?: unknown } | null)?.message
  return new CloudError('unknown', typeof message === 'string' ? message : `Request failed (${status})`)
}

/**
 * The Q2Dink API over HTTP. `baseUrl` is where /api lives, for example `/api`
 * (same origin, the normal setup) or `https://example.com/api`.
 */
export function createHttpApi(baseUrl: string, options: Options = {}): CloudApi {
  const doFetch = options.fetch ?? ((...args) => fetch(...args))
  const EventSourceImpl = options.EventSource ?? (typeof EventSource === 'undefined' ? undefined : EventSource)
  const base = baseUrl.replace(/\/+$/, '')
  const slugPath = (slug: string) => encodeURIComponent(slug)
  const sessionQuery = (sessionId?: string) => (sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '')
  /** A club's live board, or one of its sessions' boards. */
  const livePath = (slug: string, sessionId?: string) =>
    `/clubs/${slugPath(slug)}/live${sessionId ? `/${encodeURIComponent(sessionId)}` : ''}`

  async function request<T>(method: string, path: string, opts: RequestOptions & { nullOn404: true }): Promise<T | null>
  async function request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>
  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T | null> {
    let response: Response
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        headers: {
          ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch {
      throw new CloudError('network')
    }

    if (response.status === 204) return null
    if (response.status === 404 && opts.nullOn404) return null

    const body: unknown = await response.json().catch(() => null)
    if (!response.ok) throw errorFrom(response.status, body)
    return body as T
  }

  return {
    createClub: (name, slug, password) =>
      request<AuthGrant>('POST', '/clubs', { body: { name, slug, password } }),

    login: (slug, password) =>
      request<LoginResponse>('POST', `/clubs/${slugPath(slug)}/login`, { body: { password } }),

    resetPassword: (slug, recoveryCode, newPassword) =>
      request<ResetPasswordResponse>('POST', `/clubs/${slugPath(slug)}/reset-password`, {
        body: { recoveryCode, newPassword },
      }),

    async logout(token) {
      await request('POST', '/logout', { token })
    },

    renameClub: (token, name) => request<RenameClubResponse>('PUT', '/club/name', { token, body: { name } }),

    async publish(token, snapshot, backup, meta = {}) {
      try {
        const result = await request<PublishResponse>('PUT', '/session', {
          token,
          body: { public: snapshot, full: backup, ...meta },
        })
        return { revision: result.revision }
      } catch (error) {
        // Another staff device moved the session on: hand back the club's copy to rebase on.
        if (error instanceof CloudError && error.code === 'conflict') {
          return { conflict: (error.body as ConflictBody | undefined)?.current ?? null }
        }
        throw error
      }
    },

    fetchFullSession: (token, sessionId) =>
      request<unknown>('GET', `/session${sessionQuery(sessionId)}`, { token, nullOn404: true }),

    fetchSessionState: (token, sessionId) =>
      request<SessionStateRow>('GET', `/session/state${sessionQuery(sessionId)}`, { token, nullOn404: true }),

    async listSessions(token) {
      return (await request<SessionsResponse>('GET', '/sessions', { token })).sessions satisfies ClubSessionSummary[]
    },

    async putPresence(token, sessionId, deviceId) {
      await request('PUT', `/sessions/${encodeURIComponent(sessionId)}/presence`, { token, body: { deviceId } })
    },

    async dropPresence(token, sessionId, deviceId) {
      await request(
        'DELETE',
        `/sessions/${encodeURIComponent(sessionId)}/presence?deviceId=${encodeURIComponent(deviceId)}`,
        { token },
      )
    },

    async clear(token, sessionId) {
      await request('DELETE', sessionId ? `/session?sessionId=${encodeURIComponent(sessionId)}` : '/session', { token })
    },

    async recordLifetime(token, batchId, players) {
      await request('POST', '/lifetime', { token, body: { batchId, players } })
    },

    async renamePlayer(token, from, to) {
      await request('POST', '/players/rename', { token, body: { from, to } })
    },

    async putRoster(token, players) {
      await request('PUT', '/roster', { token, body: { players } })
    },

    async fetchRoster(token) {
      const result = await request<RosterResponse>('GET', '/roster', { token })
      return result.players
    },

    async putHistory(token, id, entry, backup) {
      await request('PUT', `/history/${encodeURIComponent(id)}`, { token, body: { ...entry, full: backup } })
    },

    async listHistory(token) {
      const result = await request<{ sessions: HistorySummary[] }>('GET', '/history', { token })
      return result.sessions
    },

    fetchHistory: (token, id) =>
      request<unknown>('GET', `/history/${encodeURIComponent(id)}`, { token, nullOn404: true }),

    async deleteHistory(token, id, options = {}) {
      await request('DELETE', `/history/${encodeURIComponent(id)}${options.permanent ? '?permanent=1' : ''}`, { token })
    },

    async restoreHistory(token, id) {
      await request('POST', `/history/${encodeURIComponent(id)}/restore`, { token })
    },

    async listDeletedHistory(token) {
      return (await request<{ sessions: DeletedHistorySummary[] }>('GET', '/history/deleted', { token })).sessions
    },

    async postAudit(token, entries) {
      await request('POST', '/audit', { token, body: { entries } })
    },

    listAudit(token, query = {}) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value))
      const search = params.toString()
      return request<AuditPage>('GET', `/audit${search ? `?${search}` : ''}`, { token })
    },

    async registerDevice(token, device) {
      await request('PUT', '/devices/me', { token, body: device })
    },

    async listDevices(token) {
      return (await request<{ devices: ClubDevice[] }>('GET', '/devices', { token })).devices
    },

    async putAvatar(token, key, avatar) {
      await request('PUT', `/avatars/${encodeURIComponent(key)}`, { token, body: avatar })
    },

    async deleteAvatar(token, key) {
      await request('DELETE', `/avatars/${encodeURIComponent(key)}`, { token })
    },

    async putPhotoSharing(token, on) {
      await request('PUT', '/photo-sharing', { token, body: { on } })
    },

    fetchStaffAvatars: (token) => request<StaffAvatarIndex>('GET', '/avatars', { token }),

    fetchStaffAvatar: (token, key) =>
      request<StaffAvatar>('GET', `/avatars/${encodeURIComponent(key)}`, { token, nullOn404: true }),

    fetchAvatarIndex: (slug) => request<AvatarIndex>('GET', `/clubs/${slugPath(slug)}/avatars`),

    avatarPhotoUrl: (slug, key, version) =>
      `${base}/clubs/${slugPath(slug)}/avatars/${encodeURIComponent(key)}/photo?v=${version}`,

    fetchLive: (slug, sessionId) => request<LiveRow>('GET', livePath(slug, sessionId), { nullOn404: true }),

    async listLive(slug) {
      return (await request<LiveSessionsResponse>('GET', `/clubs/${slugPath(slug)}/lives`)).sessions
    },

    async fetchClubPlayers(slug) {
      const result = await request<{ players: LifetimePlayer[] }>('GET', `/clubs/${slugPath(slug)}/players`)
      return result.players
    },

    subscribeLive(slug, onChange, onRevision, subscribeOptions = {}) {
      // Without EventSource (very old browsers) callers simply rely on polling.
      if (!EventSourceImpl) return () => undefined
      const source = new EventSourceImpl(`${base}${livePath(slug, subscribeOptions.sessionId)}/stream`)

      const listen = (type: 'update' | 'cleared') =>
        source.addEventListener(type, (event) => {
          if (type === 'cleared') return onChange(null)
          try {
            onChange(JSON.parse((event as MessageEvent<string>).data) as LiveRow)
          } catch {
            // Ignore a garbled event; the next one or the poll will correct it.
          }
        })
      listen('update')
      listen('cleared')
      // Staff devices only: the club's copy changed, even while it is not on the public page.
      if (onRevision) {
        source.addEventListener('revision', (event) => {
          try {
            const { revision, sessionId } = JSON.parse((event as MessageEvent<string>).data) as {
              revision: unknown
              sessionId?: unknown
            }
            if (typeof revision === 'number') onRevision(revision, typeof sessionId === 'string' ? sessionId : undefined)
          } catch {
            // Ignore a garbled event; the poll will correct it.
          }
        })
      }
      const { onEnded } = subscribeOptions
      if (onEnded) {
        source.addEventListener('ended', (event) => {
          try {
            const { sessionId } = JSON.parse((event as MessageEvent<string>).data) as { sessionId: unknown }
            if (typeof sessionId === 'string') onEnded(sessionId)
          } catch {
            // Ignore a garbled event; the poll will correct it.
          }
        })
      }
      // EventSource reconnects by itself after an error, and the server sends the current board on connect.
      return () => source.close()
    },
  }
}
