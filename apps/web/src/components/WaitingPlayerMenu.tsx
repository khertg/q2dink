import { Coffee, MoreVerticalIcon, UserX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { partnerItem, type PartnerOption } from '@/components/partnerItem'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface Props {
  name: string
  onTakeBreak?: () => void
  /** Take the player out of the session (the caller confirms first). */
  onRemoveFromSession?: () => void
  partner?: PartnerOption
}

/** The ⋮ menu on a waiting player's row (Board queue, Check-in): Lock partner, Take a break, Remove from session. */
export function WaitingPlayerMenu({ name, onTakeBreak, onRemoveFromSession, partner }: Props) {
  if (!onTakeBreak && !onRemoveFromSession && !partner) return null
  const lock = partner && partnerItem(partner)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${name} menu`}>
          <MoreVerticalIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {lock && (
          <PopoverClose asChild>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={lock.onClick}>
              <lock.icon aria-hidden="true" />
              {lock.label}
            </Button>
          </PopoverClose>
        )}
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
