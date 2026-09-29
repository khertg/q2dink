import { Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { announce, useSpeakingText } from '@/lib/useAnnouncer'

interface Props {
  /** What is read out (see lib/callout.ts); null when there is nobody to call, which disables the button. */
  text: string | null
  /** What is called, for the button's name: "Announce Next up", "Announce Court 1". */
  label: string
}

/** A speaker button (staff only) that reads a call-out out loud. */
export function AnnounceButton({ text, label }: Props) {
  const speaking = useSpeakingText(text)
  return (
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
  )
}
