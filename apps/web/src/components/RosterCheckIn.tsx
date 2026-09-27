import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Player } from '@/db/db'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SkillBadge } from '@/components/SkillBadge'
import { requestRosterSync } from '@/cloud/sync'
import { setRosterRating } from '@/db/roster'
import { levelOnScale, ratingForLevel, skillLabel } from '@/lib/skill'
import { useSkillScale } from '@/lib/skillScaleContext'
import { activeIds } from '@/rotation/engine'
import type { RosterPlayer, SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

interface Props {
  session: SessionState
  /** The saved roster, alphabetical. Undefined while it loads. */
  roster: Player[] | undefined
}

const plural = (count: number) => `${count} player${count === 1 ? '' : 's'}`

/**
 * Check in several returning players with one press. Their skill and gender come from the
 * roster, so nothing is retyped. The order the boxes are ticked is the order they queue in.
 */
export function RosterCheckIn({ session, roster }: Props) {
  const checkInPlayers = useSessionStore((s) => s.checkInPlayers)
  // Inside a session: its own scale, so each saved player shows the level they would check in at.
  const scale = useSkillScale()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<number[]>([])

  const genderRequired = session.mode === 'doubles' && session.matchmaking === 'mixed'
  // Anyone already in this session (waiting, playing or on a break) is handled elsewhere; someone removed
  // from it can be checked in again. Matched by name: the session's ids are its own, shared by every
  // staff device, not this device's roster ids.
  const inSession = new Set(activeIds(session).map((id) => session.players[id]?.name.trim().toLowerCase()))
  const available = (roster ?? []).filter((p) => p.id !== undefined && !inSession.has(p.name.trim().toLowerCase()))
  const needle = query.trim().toLowerCase()
  const shown = available.filter((p) => p.name.toLowerCase().includes(needle))
  const canTick = (p: Player) => !genderRequired || p.gender !== undefined
  const tickable = shown.filter(canTick)

  // Drop ticks for anyone who is no longer available (checked in on another tab, say).
  const chosen = selected.filter((id) => available.some((p) => p.id === id))

  function toggle(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function selectAllShown() {
    setSelected((prev) => [...prev, ...tickable.map((p) => p.id!).filter((id) => !prev.includes(id))])
  }

  function handleCheckIn() {
    const players: RosterPlayer[] = chosen.flatMap((id) => {
      const p = available.find((x) => x.id === id)
      return p ? [{ id, name: p.name, skill: p.skill, rating: p.rating, gender: p.gender }] : []
    })
    const added = checkInPlayers(players)
    toast(added === 0 ? 'Everyone ticked was already checked in' : `${plural(added)} checked in`)
    setSelected([])
    setQuery('')
  }

  let empty: string | null = null
  if (roster && roster.length === 0) {
    empty = 'No saved players yet. Players you check in are saved here for next time.'
  } else if (roster && available.length === 0) {
    empty = 'Everyone saved is already checked in.'
  } else if (shown.length === 0) {
    empty = 'No one matches.'
  }

  return (
    <Card role="group" aria-label="Check in from the roster">
      <CardHeader>
        <CardTitle>Check in from the roster</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {available.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="roster-search">Search saved players</Label>
            <Input
              id="roster-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        {empty ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={tickable.length === 0}
                onClick={selectAllShown}
              >
                Select all shown
              </Button>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                disabled={chosen.length === 0}
                onClick={() => setSelected([])}
              >
                Clear
              </Button>
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {shown.map((p) => {
                const id = p.id!
                const blocked = !canTick(p)
                return (
                  <li key={id}>
                    <label
                      className={`flex min-h-11 items-center gap-3 px-3 py-2 ${blocked ? 'opacity-60' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={chosen.includes(id)}
                        // Named by the player alone: the row also holds the avatar and level buttons.
                        aria-label={p.name}
                        disabled={blocked}
                        onChange={() => toggle(id)}
                      />
                      <PlayerAvatar name={p.name} size="sm" editable viewable />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {blocked && <span className="text-xs text-muted-foreground">Set gender first</span>}
                      <SkillBadge
                        player={{ name: p.name, skill: levelOnScale(scale, p) }}
                        onChange={(skill) => {
                          void setRosterRating(id, ratingForLevel(scale, skill)).then(() => requestRosterSync())
                          toast(`${p.name} is now ${skillLabel(scale, skill)}`)
                        }}
                      />
                    </label>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <Button className="h-11 w-full" disabled={chosen.length === 0} onClick={handleCheckIn}>
          {chosen.length === 0 ? 'Check in players' : `Check in ${plural(chosen.length)}`}
        </Button>
      </CardContent>
    </Card>
  )
}
