import { ArrowRightLeft, Coffee, MoreVerticalIcon, UserMinus, UserX } from 'lucide-react'
import { useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReplacePlayerDialog } from '@/components/ReplacePlayerDialog'
import type { RosterPlayer } from '@/rotation/types'

type SwapProps = Omit<ComponentProps<typeof ReplacePlayerDialog>, 'open' | 'onOpenChange' | 'player'> & {
  player: RosterPlayer
}

interface Props extends SwapProps {
  /** Take the player off this spot; someone else takes it. */
  onRemove?: () => void
  onTakeBreak?: () => void
  /** Take the player out of the session altogether (the caller confirms first). */
  onRemoveFromSession?: () => void
  /** Why Remove cannot be done right now (it is then shown disabled with this reason). */
  removeBlocked?: string
  /** Why Take a break cannot be done right now. */
  breakBlocked?: string
}

/**
 * The ⋮ menu on a player's tile, on a court or in Next up: Swap, Remove from court (or from Next up),
 * Take a break, Remove from session. Only the last one takes them out of the session; the others keep
 * them in it (in the queue or on a break).
 */
export function PlayerMenu({ onRemove, onTakeBreak, onRemoveFromSession, removeBlocked, breakBlocked, ...swap }: Props) {
  const [swapping, setSwapping] = useState(false)
  const name = swap.player.name
  const removeLabel = swap.mode === 'nextUp' ? 'Remove from Next up' : 'Remove from court'
  const items = [
    { label: 'Swap…', icon: ArrowRightLeft, onClick: () => setSwapping(true), blocked: undefined, danger: false },
    ...(onRemove ? [{ label: removeLabel, icon: UserMinus, onClick: onRemove, blocked: removeBlocked, danger: false }] : []),
    ...(onTakeBreak
      ? [{ label: 'Take a break', icon: Coffee, onClick: onTakeBreak, blocked: breakBlocked, danger: false }]
      : []),
    ...(onRemoveFromSession
      ? [{ label: 'Remove from session', icon: UserX, onClick: onRemoveFromSession, blocked: undefined, danger: true }]
      : []),
  ]
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Options for ${name}`}>
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
      <ReplacePlayerDialog {...swap} open={swapping} onOpenChange={setSwapping} />
    </>
  )
}
