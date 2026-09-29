import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { moveCalloutWording } from '@/cloud/sync'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { levelCount, levelsOf } from '@/lib/skill'
import { useSkillScale } from '@/lib/skillScaleContext'
import {
  isValidGameMinutes,
  MAX_AVG_GAME_MINUTES,
  MAX_COURTS,
  MAX_COURT_NAME_LENGTH,
  MIN_AVG_GAME_MINUTES,
  MIN_COURTS,
} from '@/rotation/engine'
import type { Court, SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong')

/**
 * Which skill levels a court is kept for: lowest and highest (both ends included). The full range is
 * "Any level". Changing it never touches a game in progress; the court's next game follows it.
 */
export function CourtLevels({ court }: { court: Court }) {
  const setCourtLevels = useSessionStore((s) => s.setCourtLevels)
  const scale = useSkillScale()
  const levels = levelsOf(scale)
  const top = levelCount(scale)
  const [min, max] = court.levels ?? [1, top]

  function change(nextMin: number, nextMax: number) {
    try {
      setCourtLevels(court.id, [nextMin, nextMax])
    } catch (err) {
      toast.error(messageOf(err))
    }
  }

  const levelSelect = (which: 'lowest' | 'highest', value: number, onPick: (level: number) => void) => (
    <Select value={String(value)} onValueChange={(v) => onPick(Number(v))}>
      <SelectTrigger aria-label={`${which === 'lowest' ? 'Lowest' : 'Highest'} level for ${court.name}`} className="w-32">
        {/* Just the rating when closed, so it fits a phone; the list names each level in full. */}
        <SelectValue>
          <span className="truncate">{levels.find((level) => level.value === value)?.rating}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {levels.map((level) => (
          <SelectItem key={level.value} value={String(level.value)}>
            {level.rating} · {level.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Levels</span>
      {/* Keep the range the right way round: moving one end past the other brings the other along. */}
      {levelSelect('lowest', min, (level) => change(level, Math.max(level, max)))}
      <span className="text-muted-foreground">to</span>
      {levelSelect('highest', max, (level) => change(Math.min(level, min), level))}
      {court.levels ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => change(1, top)}>
          Any level
        </Button>
      ) : (
        <span className="text-muted-foreground">(any level)</span>
      )}
    </div>
  )
}

function GameLengthControl({ minutes }: { minutes: number }) {
  const setAvgGameMinutes = useSessionStore((s) => s.setAvgGameMinutes)
  const [text, setText] = useState(String(minutes))
  const valid = isValidGameMinutes(Number(text))

  function handleChange(value: string) {
    setText(value)
    if (isValidGameMinutes(Number(value))) setAvgGameMinutes(Number(value))
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="board-game-minutes" className="whitespace-nowrap">
        Game length (min)
      </Label>
      <Input
        id="board-game-minutes"
        type="number"
        inputMode="numeric"
        min={MIN_AVG_GAME_MINUTES}
        max={MAX_AVG_GAME_MINUTES}
        className="w-20"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        aria-invalid={!valid}
      />
    </div>
  )
}

interface RowProps {
  court: Court
  index: number
  count: number
}

/** One court: rename it, move it, or close it (asking first if a game is in progress). */
function CourtRow({ court, index, count }: RowProps) {
  const renameCourt = useSessionStore((s) => s.renameCourt)
  const moveCourt = useSessionStore((s) => s.moveCourt)
  const closeCourt = useSessionStore((s) => s.closeCourt)
  // While editing, the typed text; otherwise null so the field follows the court's real name.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const isLast = count <= MIN_COURTS

  function commitName(event?: FormEvent) {
    event?.preventDefault()
    if (draft === null || draft === court.name) {
      setDraft(null)
      setError(null)
      return
    }
    try {
      renameCourt(court.id, draft)
      moveCalloutWording('court', court.name, draft)
      setDraft(null)
      setError(null)
    } catch (err) {
      setError(messageOf(err)) // keep what was typed so it can be fixed
    }
  }

  function close() {
    closeCourt(court.id)
    toast(`${court.name} closed`)
  }

  return (
    <li className="space-y-2 rounded-lg border p-3">
      <form onSubmit={commitName} className="flex items-center gap-2">
        <Input
          aria-label={`Name of ${court.name}`}
          value={draft ?? court.name}
          maxLength={MAX_COURT_NAME_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitName()}
          aria-invalid={error !== null}
        />
        <Badge variant={court.teams ? 'default' : 'outline'}>{court.teams ? 'In play' : 'Open'}</Badge>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <CourtLevels court={court} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Move ${court.name} up`}
          disabled={index === 0}
          onClick={() => moveCourt(court.id, -1)}
        >
          <ChevronUp /> Up
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Move ${court.name} down`}
          disabled={index === count - 1}
          onClick={() => moveCourt(court.id, 1)}
        >
          <ChevronDown /> Down
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Close ${court.name}`}
          title={isLast ? 'A session needs at least one court' : undefined}
          disabled={isLast}
          onClick={() => (court.teams ? setConfirming(true) : close())}
        >
          <X /> Close
        </Button>
      </div>

      {confirming && (
        <div
          role="group"
          aria-label={`Confirm closing ${court.name}`}
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
        >
          <p className="text-sm">
            Cancel the game and close {court.name}? Its players go back to the front of the queue and
            no result is recorded.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" size="sm" onClick={close}>
              Cancel game and close
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)}>
              Keep court
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** Add a court. It lives only in the Manage courts dialog, beside renaming, reordering and closing. */
function AddCourtButton({ session }: { session: SessionState }) {
  const addCourt = useSessionStore((s) => s.addCourt)
  const atLimit = session.courts.length >= MAX_COURTS

  function handleAdd() {
    addCourt()
    const added = useSessionStore.getState().session?.courts.at(-1)
    toast(`${added?.name ?? 'Court'} added`)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" variant="outline" onClick={handleAdd} disabled={atLimit}>
        <Plus /> Add court
      </Button>
      {atLimit && <p className="text-xs text-muted-foreground">Maximum of {MAX_COURTS} courts</p>}
    </div>
  )
}

interface ManageCourtsDialogProps {
  session: SessionState
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ManageCourtsDialog({ session, open, onOpenChange }: ManageCourtsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage courts</DialogTitle>
          <DialogDescription>
            Rename, reorder or close courts. New games go to the first open court in this order.
          </DialogDescription>
        </DialogHeader>

        <GameLengthControl minutes={session.avgGameMinutes} />

        <ul className="space-y-3">
          {session.courts.map((court, index) => (
            <CourtRow key={court.id} court={court} index={index} count={session.courts.length} />
          ))}
        </ul>

        <AddCourtButton session={session} />
      </DialogContent>
    </Dialog>
  )
}
