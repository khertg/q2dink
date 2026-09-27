import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { SkillLevel } from '@/db/db'
import { levelsOf, skillLabel, skillOptionLabel } from '@/lib/skill'
import { useSkillScale } from '@/lib/skillScaleContext'

interface Props {
  /** `skill` is the player's level on the scale in use (the session's, or the club's for saved players). */
  player: { name: string; skill: SkillLevel }
  /** "level" shows "Lv 3"; "name" shows the level's name, such as "Intermediate". */
  display?: 'level' | 'name'
  /** Staff only. Without it the badge is plain, as on the players' live page. */
  onChange?: (skill: SkillLevel) => void
}

/**
 * A player's skill level. For staff it is a button: tap it to change the level. Only what
 * happens from now on follows the change (see setPlayerSkill).
 */
export function SkillBadge({ player, display = 'level', onChange }: Props) {
  const [open, setOpen] = useState(false)
  const scale = useSkillScale()
  const label = skillLabel(scale, player.skill)
  const text = display === 'level' ? `Lv ${player.skill}` : label

  if (!onChange) {
    return (
      <Badge variant="secondary" title={label}>
        {text}
      </Badge>
    )
  }

  return (
    <>
      <Badge asChild variant="secondary" className="cursor-pointer hover:bg-secondary/70">
        <button
          type="button"
          title={`${label}. Tap to change`}
          aria-label={`Change ${player.name}'s level, now ${label}`}
          onClick={(e) => {
            // Inside a checkbox row, tapping the level must not tick the box.
            e.preventDefault()
            e.stopPropagation()
            setOpen(true)
          }}
        >
          {text}
        </button>
      </Badge>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change {player.name}&apos;s level</DialogTitle>
            <DialogDescription>
              {player.name} is {label} now. The new level is used for who they are
              matched with from now on; games already on a court and results already recorded stay as they
              are.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {levelsOf(scale).map((level) => (
              <li key={level.value}>
                <Button
                  variant={level.value === player.skill ? 'default' : 'outline'}
                  className="h-11 w-full justify-start"
                  title={level.description}
                  aria-pressed={level.value === player.skill}
                  onClick={() => {
                    if (level.value !== player.skill) onChange(level.value)
                    setOpen(false)
                  }}
                >
                  {skillOptionLabel(level)}
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
