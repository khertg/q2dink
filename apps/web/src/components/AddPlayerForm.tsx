import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MAX_PLAYER_NAME_LENGTH } from '@q2dink/shared'
import type { Gender, Player, SkillLevel } from '@/db/db'
import { defaultLevel, levelOnScale, levelsOf, ratingForLevel, skillOptionLabel } from '@/lib/skill'
import { useSkillScale } from '@/lib/skillScaleContext'

/** Select values can't be empty, so "not set" is a sentinel. */
type GenderChoice = Gender | 'U'

const GENDER_OPTIONS: { value: GenderChoice; label: string }[] = [
  { value: 'U', label: 'Not set' },
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
]

interface Props {
  /** The saved roster, for auto-complete. Undefined while it loads. */
  roster: Player[] | undefined
  genderRequired: boolean
  submitLabel: string
  /**
   * Save (and check in) the player, with the rating the chosen level starts at on the scale in use (a returning
   * player whose level was not changed keeps their own). Returns whether the form should be cleared for the next one.
   */
  onSubmit: (name: string, rating: number, gender: Gender | undefined) => Promise<boolean>
}

/** Name, skill and gender of one player, as used to check someone in or to save them for later. */
export function AddPlayerForm({ roster, genderRequired, submitLabel, onSubmit }: Props) {
  const id = useId()
  const scale = useSkillScale()
  const levels = levelsOf(scale)
  const [name, setName] = useState('')
  const [chosenLevel, setSkill] = useState<SkillLevel>(() => defaultLevel(scale))
  // The scale can change while the form is open (the club's levels arrive, or the session switches): stay on it.
  const skill = Math.min(chosenLevel, levels.length)
  // A returning player's own rating, while their level is left as it was.
  const [knownRating, setKnownRating] = useState<number | null>(null)
  const [gender, setGender] = useState<GenderChoice>('U')
  const chosen = levels.find((level) => level.value === skill)

  const canSubmit = name.trim() !== '' && (!genderRequired || gender !== 'U')

  function handleNameChange(value: string) {
    setName(value)
    // Returning players (picked from auto-complete) keep their saved details.
    const known = roster?.find((p) => p.name.toLowerCase() === value.trim().toLowerCase())
    if (known) {
      setSkill(levelOnScale(scale, known))
      setKnownRating(known.rating ?? null)
      if (known.gender) setGender(known.gender)
    } else {
      setKnownRating(null)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    const rating = knownRating ?? ratingForLevel(scale, skill)
    if (await onSubmit(name, rating, gender === 'U' ? undefined : gender)) {
      setName('')
      setSkill(defaultLevel(scale))
      setKnownRating(null)
      setGender('U')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>Player name</Label>
        <Input
          id={`${id}-name`}
          list={`${id}-roster`}
          autoComplete="off"
          maxLength={MAX_PLAYER_NAME_LENGTH}
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
        />
        <datalist id={`${id}-roster`}>
          {roster?.map((p) => <option key={p.id} value={p.name} />)}
        </datalist>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-skill`}>Skill level</Label>
        <Select
          value={String(skill)}
          onValueChange={(v) => {
            setSkill(Number(v))
            setKnownRating(null)
          }}
        >
          <SelectTrigger id={`${id}-skill`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {levels.map((s) => (
              <SelectItem key={s.value} value={String(s.value)}>
                {skillOptionLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {chosen?.description && <p className="text-xs text-muted-foreground">{chosen.description}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-gender`}>
          Gender{genderRequired ? ' (required for mixed doubles)' : ' (optional)'}
        </Label>
        <Select value={gender} onValueChange={(v) => setGender(v as GenderChoice)}>
          <SelectTrigger id={`${id}-gender`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GENDER_OPTIONS.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="h-11 w-full" disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </form>
  )
}
