import { createContext, useContext, useEffect, useState } from 'react'

/**
 * A duration in hours, minutes and seconds, leaving out every part that is zero: "45s", "7m10s",
 * "1h5m", "0s". Rounded down to the whole second, so it never claims more than was played.
 */
export function formatDuration(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds))
  const parts: [number, string][] = [
    [Math.floor(total / 3600), 'h'],
    [Math.floor(total / 60) % 60, 'm'],
    [total % 60, 's'],
  ]
  return parts.filter(([n]) => n > 0).map(([n, unit]) => `${n}${unit}`).join('') || '0s'
}

/** The current time (ms), refreshed every `intervalMs`. Only the component that calls it re-renders. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * When the session on screen stopped its clock (not started, or paused), for every timer under it; undefined
 * while it runs, and on the public viewer.
 */
export const SessionClockContext = createContext<number | undefined>(undefined)

/** The session's time: the moment its clock stopped while it stands still, else the current time. */
export function useSessionNow(intervalMs = 1_000): number {
  const stoppedAt = useContext(SessionClockContext)
  const now = useNow(intervalMs)
  return stoppedAt ?? now
}
