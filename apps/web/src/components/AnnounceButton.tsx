import { Pencil, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { announce, useSpeakingText } from '@/lib/useAnnouncer'

interface Props {
  /** What is read out (see lib/callout.ts); null when there is nobody to call, which disables the button. */
  text: string | null
  /** What is called, for the buttons' names: "Announce Next up", "Edit wording of Court 1". */
  label: string
  /** Signed in to a club: change what this speaker says (a pencil beside it). */
  onEdit?: () => void
}

/** A speaker button (staff only) that reads a call-out out loud, with a pencil to change its wording. */
export function AnnounceButton({ text, label, onEdit }: Props) {
  const speaking = useSpeakingText(text)
  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Announce ${label}`}
        title={text ?? 'Nobody to call yet'}
        disabled={text === null}
        onClick={() => text && void announce(text)}
      >
        <Volume2 aria-hidden="true" className={cn(speaking && 'animate-pulse text-primary')} />
      </Button>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`Edit wording of ${label}`}
          title="Change what this says"
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </span>
  )
}
