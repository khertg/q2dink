import { SPEECH_MAX_CHARS } from '@q2dink/shared'
import { Volume2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { announce } from '@/lib/useAnnouncer'

/**
 * Say something: staff type a one-off announcement ("Last games in 10 minutes") and have it read out in the club's
 * call-out voice. The text stays, so it can be spoken again.
 */
export function SayDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('')

  function speak(event: FormEvent) {
    event.preventDefault()
    if (text.trim()) void announce(text.trim())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={speak} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Say something</DialogTitle>
            <DialogDescription>Type an announcement and it is read out loud.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="say-text">Announcement</Label>
            <textarea
              id="say-text"
              value={text}
              maxLength={SPEECH_MAX_CHARS}
              rows={3}
              placeholder="Last games in 10 minutes"
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={text.trim() === ''}>
              <Volume2 aria-hidden="true" /> Speak
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
