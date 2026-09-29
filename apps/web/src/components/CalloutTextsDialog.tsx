import { CALLOUT_TEXT_KEYS, CALLOUT_TEXT_MAX_CHARS, CALLOUT_TEXTS, type CalloutTextKey, type CalloutTexts } from '@q2dink/shared'
import { RotateCcw, Volume2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { saveClubVoice } from '@/cloud/sync'
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
import { calloutSample, changedTexts, unknownPlaceholders } from '@/lib/callout'
import { announce } from '@/lib/useAnnouncer'
import { useClubVoice } from '@/lib/voiceStore'

type Draft = Record<CalloutTextKey, string>

/** Every text as the editor shows it: the club's, or the default. */
const draftOf = (texts: CalloutTexts): Draft =>
  Object.fromEntries(CALLOUT_TEXT_KEYS.map((key) => [key, texts[key] ?? CALLOUT_TEXTS[key].text])) as Draft

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Change what the call-outs say, for the whole club (saved for the club and sent to all its staff devices). Opened from
 * the club panel, the Call-out voice dialog and the session menu.
 */
export function CalloutTextsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {/* Mounted only while open, so it always starts from the club's wording as it is now. */}
        {open && <WordingEditor onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function WordingEditor({ onClose }: { onClose: () => void }) {
  const { texts } = useClubVoice()
  const [draft, setDraft] = useState(() => draftOf(texts))
  const inputs = useRef<Partial<Record<CalloutTextKey, HTMLInputElement | null>>>({})
  // Where the cursor goes once an inserted placeholder is on screen.
  const cursorAfter = useRef<{ key: CalloutTextKey; at: number } | null>(null)

  // Right after the new text is rendered, before anything else is typed, so typing carries on after the placeholder.
  useLayoutEffect(() => {
    const pending = cursorAfter.current
    if (!pending) return
    cursorAfter.current = null
    const input = inputs.current[pending.key]
    input?.focus()
    input?.setSelectionRange(pending.at, pending.at)
  }, [draft])

  /** Put a placeholder where the cursor is (or at the end). */
  function insert(key: CalloutTextKey, placeholder: string) {
    const input = inputs.current[key]
    const value = draft[key]
    const at = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? at
    const next = `${value.slice(0, at)}{${placeholder}}${value.slice(end)}`.slice(0, CALLOUT_TEXT_MAX_CHARS)
    cursorAfter.current = { key, at: Math.min(at + placeholder.length + 2, next.length) }
    setDraft((d) => ({ ...d, [key]: next }))
  }

  function save() {
    saveClubVoice({ texts: changedTexts(draft) })
    toast('Call-out wording saved for the club.')
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Call-out wording</DialogTitle>
        <DialogDescription>
          What each call-out says, for every staff device of the club. Words in braces are filled in at each tap.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {CALLOUT_TEXT_KEYS.map((key) => {
          const { label, text: fallback, placeholders } = CALLOUT_TEXTS[key]
          const value = draft[key]
          const unknown = unknownPlaceholders(key, value)
          const id = `callout-text-${key}`
          return (
            <div key={key} className="space-y-1">
              <Label htmlFor={id}>{label}</Label>
              <div className="flex gap-1">
                <Input
                  id={id}
                  ref={(el) => {
                    inputs.current[key] = el
                  }}
                  value={value}
                  maxLength={CALLOUT_TEXT_MAX_CHARS}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  aria-invalid={unknown.length > 0}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Test ${label}`}
                  title="Test"
                  onClick={() => void announce(calloutSample(value.trim() || fallback))}
                >
                  <Volume2 aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Reset ${label}`}
                  title="Back to the default"
                  disabled={value === fallback}
                  onClick={() => setDraft((d) => ({ ...d, [key]: fallback }))}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1" aria-label={`Placeholders for ${label}`}>
                {placeholders.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="rounded-md border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    aria-label={`Insert {${p}} into ${label}`}
                    onClick={() => insert(key, p)}
                  >
                    {`{${p}}`}
                  </button>
                ))}
              </div>
              {unknown.length > 0 && (
                <p role="alert" className="text-xs text-destructive">
                  {unknown.map((p) => `{${p}}`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not filled in here and
                  would be read as written.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
