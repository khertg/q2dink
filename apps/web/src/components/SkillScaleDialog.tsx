import {
  MAX_LEVEL_DESCRIPTION_LENGTH,
  MAX_LEVEL_LABEL_LENGTH,
  MAX_LEVEL_RANGE_LENGTH,
  MAX_RATING,
  MAX_SCALE_LEVELS,
  MIN_RATING,
  MIN_SCALE_LEVELS,
  SCALE_PRESETS,
  sameScale,
} from '@q2dink/shared'
import { useLiveQuery } from 'dexie-react-hooks'
import { GaugeIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { saveClubSkillScale } from '@/cloud/sync'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { listRoster } from '@/db/roster'
import { DEFAULT_SCALE, ratingOf } from '@/lib/skill'
import { addLevel, fromDraft, placements, removeLevel, toDraft, type DraftLevel } from '@/lib/skillScaleDraft'
import { useClubSkillScale } from '@/lib/skillScaleStore'

const plural = (n: number) => `${n} player${n === 1 ? '' : 's'}`

/**
 * The club's skill levels: start from a preset (Suggested DUPR, USA Pickleball) or edit each level (name, the rating it
 * starts at, range text, description), 2 to 10 levels. Players keep their rating, so changing levels never loses
 * anyone's level: they land in whichever new level holds their rating (shown under each level before saving).
 */
export function SkillScaleDialog() {
  const clubScale = useClubSkillScale()
  const clubSlug = useClubAuth((s) => s.club?.slug)
  const roster = useLiveQuery(() => listRoster(clubSlug), [clubSlug])
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DraftLevel[]>(() => toDraft(clubScale))
  const [error, setError] = useState<string | null>(null)

  const parsed = fromDraft(draft)
  const counts = 'scale' in parsed && roster ? placements(parsed.scale, roster.map(ratingOf)) : null

  function change(next: boolean) {
    if (next) {
      setDraft(toDraft(clubScale))
      setError(null)
    }
    setOpen(next)
  }

  function update(index: number, field: keyof DraftLevel, value: string) {
    setDraft((d) => d.map((level, i) => (i === index ? { ...level, [field]: value } : level)))
    setError(null)
  }

  function save() {
    if ('error' in parsed) return setError(parsed.error)
    // The default is kept as "no choice", so a club on it follows any later improvement to it.
    saveClubSkillScale(sameScale(parsed.scale, DEFAULT_SCALE) ? null : parsed.scale)
    toast('Skill levels saved. New sessions use them; a running session can switch from its menu.')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className="w-full">
          <GaugeIcon aria-hidden="true" /> Skill levels
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Skill levels</DialogTitle>
          <DialogDescription>
            Each player keeps a rating ({MIN_RATING} to {MAX_RATING}, like DUPR). A level holds everyone from the rating
            it starts at up to where the next level starts. New sessions use these levels.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Start from</span>
          {SCALE_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(toDraft(preset.scale))
                setError(null)
              }}
            >
              {preset.name}
            </Button>
          ))}
        </div>

        <ol className="space-y-3" aria-label="Levels">
          {draft.map((level, index) => {
            const n = index + 1
            return (
              <li key={index} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Level {n}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove level ${n}`}
                    disabled={draft.length <= MIN_SCALE_LEVELS}
                    onClick={() => setDraft((d) => removeLevel(d, index))}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
                  <div className="space-y-1">
                    <Label htmlFor={`level-${n}-name`}>Name</Label>
                    <Input
                      id={`level-${n}-name`}
                      aria-label={`Name of level ${n}`}
                      maxLength={MAX_LEVEL_LABEL_LENGTH}
                      value={level.label}
                      onChange={(e) => update(index, 'label', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`level-${n}-from`}>Starts at</Label>
                    <Input
                      id={`level-${n}-from`}
                      aria-label={`Rating level ${n} starts at`}
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min={MIN_RATING}
                      max={MAX_RATING}
                      value={level.from}
                      onChange={(e) => update(index, 'from', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
                  <div className="space-y-1">
                    <Label htmlFor={`level-${n}-range`}>Range text</Label>
                    <Input
                      id={`level-${n}-range`}
                      aria-label={`Range of level ${n}`}
                      placeholder="Optional"
                      maxLength={MAX_LEVEL_RANGE_LENGTH}
                      value={level.range}
                      onChange={(e) => update(index, 'range', e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`level-${n}-description`}>Description</Label>
                    <Input
                      id={`level-${n}-description`}
                      aria-label={`Description of level ${n}`}
                      placeholder="Optional"
                      maxLength={MAX_LEVEL_DESCRIPTION_LENGTH}
                      value={level.description}
                      onChange={(e) => update(index, 'description', e.target.value)}
                    />
                  </div>
                </div>
                {counts && <p className="text-xs text-muted-foreground">Saved players here: {plural(counts[index])}</p>}
              </li>
            )
          })}
        </ol>

        <Button
          type="button"
          variant="outline"
          disabled={draft.length >= MAX_SCALE_LEVELS}
          onClick={() => setDraft(addLevel)}
        >
          <PlusIcon aria-hidden="true" /> Add level
        </Button>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={save}>
            Save levels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
