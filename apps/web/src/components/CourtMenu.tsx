import { ChevronDown, ChevronUp, Gauge, MoreVerticalIcon, Pause, Pencil, Play, X, XCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CourtLevels } from '@/components/ManageCourtsDialog'
import { courtMenuState } from '@/lib/courtMenu'
import { MAX_COURT_NAME_LENGTH } from '@/rotation/engine'
import type { Court } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong')

interface Props {
  court: Court
  /** Where the court is in board order, and how many courts there are. */
  index: number
  count: number
  /** Cancel the game (the card asks first) or clear a line-up being set up. */
  onCancel: () => void
}

function RenameCourtDialog({ court, open, onOpenChange }: { court: Court; open: boolean; onOpenChange: (open: boolean) => void }) {
  const renameCourt = useSessionStore((s) => s.renameCourt)
  const [name, setName] = useState(court.name)
  const [error, setError] = useState<string | null>(null)

  function change(next: boolean) {
    if (next) {
      setName(court.name)
      setError(null)
    }
    onOpenChange(next)
  }

  function save(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === court.name) return onOpenChange(false)
    try {
      renameCourt(court.id, name)
      toast(`${court.name} renamed to ${name.trim()}`)
      onOpenChange(false)
    } catch (err) {
      setError(messageOf(err)) // keep what was typed so it can be fixed
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename {court.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`court-name-${court.id}`}>Court name</Label>
            <Input
              id={`court-name-${court.id}`}
              value={name}
              maxLength={MAX_COURT_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error !== null}
              autoFocus
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The ⋮ menu in a court card's header (staff only): cancel its game or clear it, rename it, keep it for
 * skill levels, move it in the board order, or close it. The same actions as Manage courts, on the court.
 */
export function CourtMenu({ court, index, count, onCancel }: Props) {
  const moveCourt = useSessionStore((s) => s.moveCourt)
  const closeCourt = useSessionStore((s) => s.closeCourt)
  const pauseGame = useSessionStore((s) => s.pauseGame)
  const resumeGame = useSessionStore((s) => s.resumeGame)
  const [renaming, setRenaming] = useState(false)
  const [levels, setLevels] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const state = courtMenuState(court, index, count)

  function move(offset: -1 | 1) {
    moveCourt(court.id, offset)
    toast(`${court.name} moved ${offset < 0 ? 'up' : 'down'}`)
  }

  function togglePause() {
    if (court.pausedByStaff) {
      resumeGame(court.id)
      toast(`${court.name}: game resumed.`)
    } else {
      pauseGame(court.id)
      toast(`${court.name}: game paused. Its time stands still until you resume it.`)
    }
  }

  function close() {
    closeCourt(court.id)
    toast(`${court.name} closed`)
  }

  const items = [
    ...(state.cancelLabel ? [{ label: state.cancelLabel, icon: XCircle, onClick: onCancel }] : []),
    ...(state.pauseLabel
      ? [{ label: state.pauseLabel, icon: court.pausedByStaff ? Play : Pause, onClick: togglePause }]
      : []),
    { label: 'Rename…', icon: Pencil, onClick: () => setRenaming(true) },
    { label: 'Skill levels…', icon: Gauge, onClick: () => setLevels(true) },
    { label: 'Move up', icon: ChevronUp, onClick: () => move(-1), blocked: state.canMoveUp ? undefined : '' },
    { label: 'Move down', icon: ChevronDown, onClick: () => move(1), blocked: state.canMoveDown ? undefined : '' },
    {
      label: 'Close court',
      icon: X,
      onClick: () => (state.closeNeedsConfirm ? setConfirmingClose(true) : close()),
      blocked: state.closeBlocked,
      danger: true,
    },
  ]

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Court menu">
            <MoreVerticalIcon aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          {items.map(({ label, icon: Icon, onClick, blocked, danger }) => (
            <PopoverClose asChild key={label}>
              <Button
                type="button"
                variant="ghost"
                className={`h-auto min-h-9 w-full flex-col items-start gap-0 py-1.5 ${danger ? 'text-destructive hover:text-destructive' : ''}`}
                disabled={blocked !== undefined}
                onClick={onClick}
              >
                <span className="flex items-center gap-2">
                  <Icon aria-hidden="true" />
                  {label}
                </span>
                {blocked && <span className="pl-6 text-xs font-normal whitespace-normal text-muted-foreground">{blocked}</span>}
              </Button>
            </PopoverClose>
          ))}
        </PopoverContent>
      </Popover>

      <RenameCourtDialog court={court} open={renaming} onOpenChange={setRenaming} />

      <Dialog open={levels} onOpenChange={setLevels}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Skill levels for {court.name}</DialogTitle>
            <DialogDescription>
              Its games are drawn only from waiting players in this range. A game in progress is not changed.
            </DialogDescription>
          </DialogHeader>
          <CourtLevels court={court} />
          <DialogFooter>
            <Button onClick={() => setLevels(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingClose} onOpenChange={setConfirmingClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {court.name}?</DialogTitle>
            <DialogDescription>
              Cancel the game and close {court.name}? Its players go back to the front of the queue and no result
              is recorded.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingClose(false)}>
              Keep court
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingClose(false)
                close()
              }}
            >
              Cancel game and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
