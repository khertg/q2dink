import { useLiveQuery } from 'dexie-react-hooks'
import { toast } from 'sonner'
import { recordAudit } from '@/cloud/audit'
import { useClubAuth } from '@/cloud/auth'
import { requestRosterSync } from '@/cloud/sync'
import { AddPlayerForm } from '@/components/AddPlayerForm'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { SkillBadge } from '@/components/SkillBadge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Gender, SkillLevel } from '@/db/db'
import { listRoster, savePlayer, setRosterRating } from '@/db/roster'
import { levelForRating, levelOnScale, ratingForLevel, skillLabel } from '@/lib/skill'
import { useSkillScale } from '@/lib/skillScaleContext'

/**
 * The club's saved players, and a way to add more before any session has started. Saving only puts
 * them on the roster: they are checked in later, from "Check in from the roster".
 */
export function SavedPlayersDialog() {
  const clubSlug = useClubAuth((s) => s.club?.slug)
  const roster = useLiveQuery(() => listRoster(clubSlug), [clubSlug])
  // Saved players are shown on the club's scale.
  const scale = useSkillScale()

  async function handleAdd(name: string, rating: number, gender: Gender | undefined) {
    const { player, added } = await savePlayer(name, rating, gender, clubSlug)
    requestRosterSync()
    recordAudit(
      added ? 'rosterAdd' : 'rosterUpdate',
      `${added ? 'Saved' : 'Updated'} player ${player.name} (${skillLabel(scale, levelForRating(scale, rating))})`,
    )
    toast(added ? `${player.name} saved` : `${player.name} is already saved`)
    return true
  }

  async function changeSkill(id: number, name: string, skill: SkillLevel) {
    await setRosterRating(id, ratingForLevel(scale, skill))
    requestRosterSync()
    recordAudit('rosterSkill', `Changed saved player ${name}'s level to ${skillLabel(scale, skill)}`)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="w-full">
          Saved players
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Saved players{roster ? ` (${roster.length})` : ''}</DialogTitle>
          <DialogDescription>
            Add players ahead of time. Once a session starts, check them in from the roster with one tap.
          </DialogDescription>
        </DialogHeader>

        <AddPlayerForm roster={roster} genderRequired={false} submitLabel="Save player" onSubmit={handleAdd} />

        {roster && roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved players yet.</p>
        ) : (
          <ul aria-label="Saved players" className="divide-y">
            {roster?.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <PlayerAvatar name={p.name} editable />
                  <span className="min-w-0 truncate">{p.name}</span>
                </span>
                <SkillBadge
                  player={{ name: p.name, skill: levelOnScale(scale, p) }}
                  display="name"
                  onChange={(skill) => void changeSkill(p.id!, p.name, skill)}
                />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
