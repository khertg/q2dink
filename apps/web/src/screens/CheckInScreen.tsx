import { useLiveQuery } from 'dexie-react-hooks'
import { Lock, UserX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AddPlayerForm } from '@/components/AddPlayerForm'
import { LockPartnerDialog } from '@/components/LockPartnerDialog'
import { RemovePlayerDialog } from '@/components/RemovePlayerDialog'
import { RosterCheckIn } from '@/components/RosterCheckIn'
import { WaitingPlayerMenu } from '@/components/WaitingPlayerMenu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Gender, SkillLevel } from '@/db/db'
import { addOrGetPlayer, listRoster } from '@/db/roster'
import { useClubAuth } from '@/cloud/auth'
import { requestRosterSync } from '@/cloud/sync'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SkillBadge } from '@/components/SkillBadge'
import { useSkillEditor } from '@/lib/useSkillEditor'
import { lockedMessage, lockExplanation } from '@/lib/partners'
import { removedMessage } from '@/lib/removal'
import { usePartnerOption } from '@/lib/usePartnerOption'
import { activeIds, lockStatus, playingIds } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

function PartnersCard({ session }: { session: SessionState }) {
  const lockPartners = useSessionStore((s) => s.lockPartners)
  const unlockPartners = useSessionStore((s) => s.unlockPartners)
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const canLock = first !== '' && second !== '' && first !== second

  const [confirming, setConfirming] = useState(false)

  const pending = session.pendingPartners ?? []
  const locked = new Set([...session.partners.flat(), ...pending.flatMap(({ pair }) => pair)])
  // Players removed from the session stay in `players` for their results, but cannot be locked.
  const available = activeIds(session)
    .map((id) => session.players[id])
    .filter((p) => p && !locked.has(p.id))

  const a = Number(first)
  const b = Number(second)
  // A lock made while a partner is on a court or a break waits until both have finished a game.
  const status = canLock ? lockStatus(session, a, b) : null
  const name = (id: number) => session.players[id].name

  function doLock() {
    const message = lockedMessage(session, a, b)
    lockPartners(a, b)
    toast(message)
    setFirst('')
    setSecond('')
    setConfirming(false)
  }

  function handleLock() {
    if (status?.inForce === false) setConfirming(true)
    else doLock()
  }

  const pick = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose a player" />
        </SelectTrigger>
        <SelectContent>
          {available.map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Partners</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Locked partners always share a team and wait in the queue together.
        </p>

        {(session.partners.length > 0 || pending.length > 0) && (
          <ul className="divide-y">
            {[...session.partners.map((pair) => ({ pair, waiting: false })), ...pending.map(({ pair }) => ({ pair, waiting: true }))].map(({ pair: [a, b], waiting }) => (
              <li key={`${a}-${b}`} className="flex items-center gap-3 py-2">
                <Lock className={`size-4 ${waiting ? 'text-muted-foreground/50' : 'text-muted-foreground'}`} aria-hidden />
                <span className="flex-1">
                  {session.players[a].name} &amp; {session.players[b].name}
                  {waiting && (
                    <span className="block text-xs text-muted-foreground">
                      Starts after both have played. Each keeps their own turn until then.
                    </span>
                  )}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Unlock ${session.players[a].name} and ${session.players[b].name}`}
                  onClick={() => unlockPartners(a)}
                >
                  Unlock
                </Button>
              </li>
            ))}
          </ul>
        )}

        {available.length < 2 ? (
          <p className="text-sm text-muted-foreground">
            Check in at least two unpaired players to lock partners.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {pick('partner-first', 'First partner', first, setFirst)}
              {pick('partner-second', 'Second partner', second, setSecond)}
            </div>
            <Button className="h-11 w-full" disabled={!canLock} onClick={handleLock}>
              Lock partners
            </Button>
            {status?.inForce === false && (
              <Dialog open={confirming} onOpenChange={setConfirming}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      Lock {name(a)} and {name(b)}?
                    </DialogTitle>
                    <DialogDescription>{lockExplanation(session, a, b)}</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                    <Button onClick={doLock}>Lock anyway</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function CheckInScreen({ session }: { session: SessionState }) {
  const checkInPlayer = useSessionStore((s) => s.checkInPlayer)
  const checkOutPlayer = useSessionStore((s) => s.checkOutPlayer)
  const removePlayer = useSessionStore((s) => s.removePlayer)
  const [removing, setRemoving] = useState<number | null>(null)
  const [locking, setLocking] = useState<number | null>(null)
  const partnerFor = usePartnerOption(session, setLocking)
  const changeSkill = useSkillEditor()
  const clubSlug = useClubAuth((s) => s.club?.slug)
  const roster = useLiveQuery(() => listRoster(clubSlug), [clubSlug])
  // Bring in players the club's other devices saved, as soon as check-in opens.
  useEffect(() => requestRosterSync(), [clubSlug])

  const genderRequired = session.mode === 'doubles' && session.matchmaking === 'mixed'

  async function handleAdd(name: string, skill: SkillLevel, gender: Gender | undefined) {
    const player = await addOrGetPlayer(name, skill, gender, clubSlug)
    requestRosterSync()
    const added = checkInPlayer(player)
    toast(added ? `${player.name} checked in` : `${player.name} is already checked in`)
    return added
  }

  const playing = playingIds(session).length

  function handleRemove(id: number) {
    const message = removedMessage(session, id)
    removePlayer(id)
    toast(message)
  }

  const removeButton = (id: number) => (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-destructive hover:text-destructive"
      aria-label={`Remove ${session.players[id].name} from the session`}
      title="Remove from session"
      onClick={() => setRemoving(id)}
    >
      <UserX aria-hidden="true" />
    </Button>
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Check in a player</CardTitle>
        </CardHeader>
        <CardContent>
          <AddPlayerForm roster={roster} genderRequired={genderRequired} submitLabel="Check in" onSubmit={handleAdd} />
        </CardContent>
      </Card>

      <RosterCheckIn session={session} roster={roster} />

      <Card>
        <CardHeader>
          <CardTitle>
            Waiting ({session.queue.length}) · Playing ({playing})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {session.queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one is waiting.</p>
          ) : (
            <ul className="divide-y" aria-label="Waiting players">
              {session.queue.map((id) => (
                <li key={id} className="flex items-center gap-3 py-2">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <PlayerAvatar name={session.players[id].name} editable viewable />
                    <span className="min-w-0 truncate">{session.players[id].name}</span>
                  </span>
                  <SkillBadge player={session.players[id]} display="name" onChange={(skill) => changeSkill(id, skill)} />
                  <WaitingPlayerMenu
                    name={session.players[id].name}
                    onTakeBreak={() => checkOutPlayer(id)}
                    onRemoveFromSession={() => setRemoving(id)}
                    partner={partnerFor?.(id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {session.mode === 'doubles' && <PartnersCard session={session} />}

      <LockPartnerDialog session={session} playerId={locking} onClose={() => setLocking(null)} />
      <RemovePlayerDialog session={session} playerId={removing} onClose={() => setRemoving(null)} onConfirm={handleRemove} />

      {session.onBreak.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>On a break ({session.onBreak.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {session.onBreak.map((id) => (
                <li key={id} className="flex items-center gap-3 py-2">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <PlayerAvatar name={session.players[id].name} editable />
                    <span className="min-w-0 truncate">{session.players[id].name}</span>
                  </span>
                  <SkillBadge player={session.players[id]} display="name" onChange={(skill) => changeSkill(id, skill)} />
                  <Button variant="outline" size="sm" onClick={() => checkInPlayer(session.players[id])}>
                    Back to queue
                  </Button>
                  {removeButton(id)}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
