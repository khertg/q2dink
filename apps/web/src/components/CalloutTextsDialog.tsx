import {
  CALLOUT_TEXT_KEYS,
  CALLOUT_TEXT_MAX_CHARS,
  CALLOUT_TEXTS,
  COURT_TEXT_KEYS,
  PLAYER_TEXT_KEYS,
  type CalloutTextKey,
  type CalloutTexts,
  type CourtTexts,
  type PlayerTexts,
} from '@q2dink/shared'
import { RotateCcw, Volume2, X } from 'lucide-react'
import { useRef, useState } from 'react'
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
import { calloutSample, changedTexts, setCourtText, setPlayerText, unknownPlaceholders, wordingOf } from '@/lib/callout'
import { announce } from '@/lib/useAnnouncer'
import { useClubVoice } from '@/lib/voiceStore'

/**
 * Whose wording is edited: the club's (all its texts, or only `keys`), or one court's or one player's own, which is read
 * instead of the club's for them.
 */
export type WordingScope =
  | { kind: 'club'; keys?: readonly CalloutTextKey[] }
  | { kind: 'court'; name: string }
  | { kind: 'player'; name: string }

interface Props {
  scope: WordingScope
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Change what the call-outs say, for the whole club (saved for the club and sent to all its staff devices). */
export function CalloutTextsDialog({ scope, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {/* Mounted only while open, so it always starts from the club's wording as it is now. */}
        {open && <WordingEditor initial={scope} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

const keysOf = (scope: WordingScope): readonly CalloutTextKey[] =>
  scope.kind === 'court' ? COURT_TEXT_KEYS : scope.kind === 'player' ? PLAYER_TEXT_KEYS : (scope.keys ?? CALLOUT_TEXT_KEYS)

/** A court's or player's own wording (empty: none), or the club's (its default when it has none). */
function draftOf(scope: WordingScope, texts: CalloutTexts): Partial<Record<CalloutTextKey, string>> {
  const own = (key: CalloutTextKey) =>
    scope.kind === 'court'
      ? (texts.courts?.[scope.name.trim().toLowerCase()]?.[key as keyof CourtTexts] ?? '')
      : scope.kind === 'player'
        ? (texts.players?.[scope.name.trim().toLowerCase()]?.[key as keyof PlayerTexts] ?? '')
        : (texts[key] ?? CALLOUT_TEXTS[key].text)
  return Object.fromEntries(keysOf(scope).map((key) => [key, own(key)]))
}

function WordingEditor({ initial, onClose }: { initial: WordingScope; onClose: () => void }) {
  const { texts } = useClubVoice()
  const [scope, setScope] = useState(initial)
  const [draft, setDraft] = useState(() => draftOf(initial, texts))
  // The court and player wordings, in the club's scope, so they can be removed there.
  const [overrides, setOverrides] = useState({ courts: texts.courts ?? {}, players: texts.players ?? {} })
  const inputs = useRef<Partial<Record<CalloutTextKey, HTMLInputElement | null>>>({})
  const target = scope.kind === 'club' ? undefined : scope.name
  const own = scope.kind !== 'club'

  function switchTo(next: WordingScope) {
    setScope(next)
    setDraft(draftOf(next, texts))
  }

  /** Put a placeholder where the cursor is (or at the end). */
  function insert(key: CalloutTextKey, placeholder: string) {
    const input = inputs.current[key]
    const value = draft[key] ?? ''
    const at = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? at
    const next = `${value.slice(0, at)}{${placeholder}}${value.slice(end)}`.slice(0, CALLOUT_TEXT_MAX_CHARS)
    setDraft((d) => ({ ...d, [key]: next }))
    requestAnimationFrame(() => {
      input?.focus()
      const cursor = at + placeholder.length + 2
      input?.setSelectionRange(cursor, cursor)
    })
  }

  function save() {
    let next: CalloutTexts
    if (scope.kind === 'court') {
      next = COURT_TEXT_KEYS.reduce((t, key) => setCourtText(t, scope.name, key, draft[key] ?? ''), texts)
    } else if (scope.kind === 'player') {
      next = PLAYER_TEXT_KEYS.reduce((t, key) => setPlayerText(t, scope.name, key, draft[key] ?? ''), texts)
    } else {
      // Only the rows shown change; the club's other texts stay.
      const shown = keysOf(scope)
      const general = Object.fromEntries(CALLOUT_TEXT_KEYS.filter((k) => !shown.includes(k) && texts[k]).map((k) => [k, texts[k]]))
      const courts = Object.keys(overrides.courts).length > 0 ? { courts: overrides.courts } : {}
      const players = Object.keys(overrides.players).length > 0 ? { players: overrides.players } : {}
      next = { ...general, ...changedTexts(draft), ...courts, ...players }
    }
    saveClubVoice({ texts: next })
    toast(own ? `Call-out wording saved for ${target}.` : 'Call-out wording saved for the club.')
    onClose()
  }

  const removable = [
    ...Object.entries(overrides.courts).map(([name, group]) => ({ map: 'courts' as const, name, keys: Object.keys(group) })),
    ...Object.entries(overrides.players).map(([name, group]) => ({ map: 'players' as const, name, keys: Object.keys(group) })),
  ]

  return (
    <>
      <DialogHeader>
        <DialogTitle>{own ? `Call-out wording for ${target}` : 'Call-out wording'}</DialogTitle>
        <DialogDescription>
          {own
            ? `What is said for ${target} only, instead of the club’s wording. Leave a text empty to use the club’s.`
            : 'What each call-out says, for every staff device of the club. Words in braces are filled in at each tap.'}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {keysOf(scope).map((key) => {
          const { label, placeholders } = CALLOUT_TEXTS[key]
          const value = draft[key] ?? ''
          // What is read when this text is empty: the club's wording for a court or player, the default for the club.
          const fallback = own ? wordingOf(key, texts) : CALLOUT_TEXTS[key].text
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
                  placeholder={own ? `Uses the club’s: ${fallback}` : undefined}
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
                  onClick={() =>
                    void announce(
                      calloutSample(value.trim() || fallback, {
                        court: scope.kind === 'court' ? scope.name : undefined,
                        name: scope.kind === 'player' ? scope.name : undefined,
                      }),
                    )
                  }
                >
                  <Volume2 aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Reset ${label}`}
                  title={own ? 'Use the club’s wording' : 'Back to the default'}
                  disabled={own ? value === '' : value === CALLOUT_TEXTS[key].text}
                  onClick={() => setDraft((d) => ({ ...d, [key]: own ? '' : CALLOUT_TEXTS[key].text }))}
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
        {own && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            onClick={() => switchTo({ kind: 'club', keys: keysOf(scope) })}
          >
            Edit the club’s wording instead
          </Button>
        )}
        {scope.kind === 'club' && removable.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-medium">Court and player wording</p>
            <ul className="divide-y rounded-md border">
              {removable.map(({ map, name, keys }) => (
                <li key={`${map}-${name}`} className="flex items-center gap-2 px-2 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="capitalize">{name}</span>
                    <span className="text-muted-foreground">
                      {' · '}
                      {keys.map((k) => CALLOUT_TEXTS[k as CalloutTextKey]?.label ?? k).join(', ')}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove the wording for ${name}`}
                    onClick={() =>
                      setOverrides((o) => {
                        const { [name]: _removed, ...rest } = o[map]
                        return { ...o, [map]: rest }
                      })
                    }
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
