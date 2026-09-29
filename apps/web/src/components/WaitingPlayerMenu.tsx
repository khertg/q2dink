import { Coffee, MessageSquareText, MoreVerticalIcon, UserX, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { partnerItem, type PartnerOption } from '@/components/partnerItem'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { announce } from '@/lib/useAnnouncer'

interface Props {
  name: string
  onTakeBreak?: () => void
  /** Take the player out of the session (the caller confirms first). */
  onRemoveFromSession?: () => void
  partner?: PartnerOption
  /** What Call out reads out for this player (see lib/callout.ts); no item without it. */
  callout?: string | null
  /** Signed in to a club: change what Call out says for this player. */
  onEditCallout?: () => void
}

/** The ⋮ menu on a waiting player's row (Board queue, Check-in): Call out, Lock partner, Take a break, Remove from session. */
export function WaitingPlayerMenu({ name, onTakeBreak, onRemoveFromSession, partner, callout, onEditCallout }: Props) {
  if (!onTakeBreak && !onRemoveFromSession && !partner && !callout) return null
  const lock = partner && partnerItem(partner)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`${name} menu`}>
          <MoreVerticalIcon aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {callout && (
          <PopoverClose asChild>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => void announce(callout)}>
              <Volume2 aria-hidden="true" />
              Call out
            </Button>
          </PopoverClose>
        )}
        {callout && onEditCallout && (
          <PopoverClose asChild>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={onEditCallout}>
              <MessageSquareText aria-hidden="true" />
              Call-out wording…
            </Button>
          </PopoverClose>
        )}
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
