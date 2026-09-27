import { clubSlugFromPath, liveBoardPath, liveSessionIdFromPath } from '@q2dink/shared'

/**
 * The public live-board address for a club, which players open from the QR code, or for one of its sessions
 * (a club can run several at once).
 */
export const viewerUrl = (slug: string, sessionId?: string, origin: string = window.location.origin) =>
  `${origin}${liveBoardPath(slug, sessionId)}`

/**
 * The live-board path to show instead of this one, when it is the older /club/<name> or has a trailing
 * slash; null when the path is already canonical or is not a live board.
 */
export function canonicalLiveBoardPath(pathname: string): string | null {
  const slug = clubSlugFromPath(pathname)
  if (slug === null) return null
  const canonical = liveBoardPath(slug, liveSessionIdFromPath(pathname) ?? undefined)
  return pathname === canonical ? null : canonical
}

/** Show the canonical live-board address, so the link people copy or bookmark is the current one. */
export function showCanonicalLiveBoardAddress() {
  const canonical = canonicalLiveBoardPath(window.location.pathname)
  if (canonical) {
    window.history.replaceState(window.history.state, '', canonical + window.location.search + window.location.hash)
  }
}
