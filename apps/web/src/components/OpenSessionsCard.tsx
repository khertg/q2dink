import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { openRunningSession, useSyncStore } from '@/cloud/sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useDevice } from '@/lib/device'
import { runningSessions, type RunningSession } from '@/lib/openSessions'
import { useSessionStore } from '@/store/session'
import { parkedFor } from '@/store/slices'

const STATUS_LABEL: Record<RunningSession['status'], string> = {
  notStarted: 'Not started',
  paused: 'Paused',
  running: 'Running',
}

function SessionRow({ entry, myDeviceId }: { entry: RunningSession; myDeviceId: string }) {
  const [opening, setOpening] = useState(false)
  const players = `${entry.players} ${entry.players === 1 ? 'player' : 'players'}`

  async function open() {
    setOpening(true)
    const opened = await openRunningSession(entry.sessionId)
    setOpening(false)
    if (!opened) toast.error(`“${entry.location}” could not be opened. It may have ended, or the club is out of reach.`)
  }

  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0 space-y-1">
        <p className="break-words font-medium">{entry.location}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={entry.status === 'running' ? 'secondary' : 'outline'}>{STATUS_LABEL[entry.status]}</Badge>
          {entry.live && <Badge variant="secondary">Live</Badge>}
          <Badge variant="outline">{players}</Badge>
        </div>
        {entry.status === 'paused' && entry.pausedBy && (
          <p className="text-xs text-muted-foreground">
            Paused by {entry.pausedBy.deviceId === myDeviceId ? 'this device' : entry.pausedBy.name}
          </p>
        )}
        {entry.openOn.length > 0 && (
          <p className="text-xs text-muted-foreground">Open on {entry.openOn.map((d) => d.name).join(', ')}</p>
        )}
        {entry.unsent > 0 && (
          <p className="text-xs text-muted-foreground">
            {entry.unsent === 1 ? '1 change' : `${entry.unsent} changes`} from this device not sent yet
          </p>
        )}
      </div>
      <Button className="h-11 shrink-0" variant="outline" disabled={opening} onClick={() => void open()}>
        Open
      </Button>
    </li>
  )
}

/**
 * The sessions running now, to open again: ones staff left on this device without ending them, and the ones
 * the club's other staff devices are running. Hidden when there are none.
 */
export function OpenSessionsCard() {
  const allParked = useSessionStore((s) => s.parked)
  const clubSlug = useClubAuth((s) => s.club?.slug ?? null)
  // Sessions left while another club was signed in stay on the device, hidden, until that club logs in again.
  const parked = useMemo(
    () => Object.fromEntries(Object.entries(allParked).filter(([, slice]) => parkedFor(slice, clubSlug))),
    [allParked, clubSlug],
  )
  const openId = useSessionStore((s) => (s.session ? s.sessionId : ''))
  const endedIds = useSessionStore((s) => s.endedSessionIds)
  const clubSessions = useSyncStore((s) => s.clubSessions)
  const myDeviceId = useDevice((s) => s.id)
  const list = useMemo(
    () => runningSessions(parked, clubSessions, { openId, endedIds, myDeviceId }),
    [parked, clubSessions, openId, endedIds, myDeviceId],
  )
  if (list.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open sessions</CardTitle>
        <CardDescription>
          Running now, and not ended. Open one to carry on; changes on any staff device show on all of them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul aria-label="Open sessions" className="divide-y">
          {list.map((entry) => (
            <SessionRow key={entry.sessionId} entry={entry} myDeviceId={myDeviceId} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
