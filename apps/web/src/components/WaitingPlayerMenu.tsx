import { Coffee, MoreVerticalIcon, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  name: string
  onTakeBreak?: () => void
  /** Take the player out of the session (the caller confirms first). */
  onRemoveFromSession?: () => void
}

/** The ⋮ menu on a waiting player's row (Board queue, Check-in): Take a break, Remove from session. */
export function WaitingPlayerMenu({ name, onTakeBreak, onRemoveFromSession }: Props) {
  if (!onTakeBreak && !onRemoveFromSession) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${name} menu`}>
          <MoreVerticalIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {onTakeBreak && (
          <PopoverClose asChild>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={onTakeBreak}>
              <Coffee aria-hidden="true" />
              Take a break
            </Button>
          </PopoverClose>
        )}
        {onRemoveFromSession && (
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start text-destructive hover:text-destructive"
              onClick={onRemoveFromSession}
            >
              <UserX aria-hidden="true" />
              Remove from session
            </Button>
          </PopoverClose>
        )}
      </PopoverContent>
    </Popover>
  )
}
