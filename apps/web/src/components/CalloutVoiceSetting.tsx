import { DEFAULT_VOICE_ID, isVoiceId, type CalloutVoice, type VoiceOption } from '@q2dink/shared'
import { MessageSquareText, Volume2 } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { cloud } from '@/cloud/client'
import { saveClubVoice } from '@/cloud/sync'
import { CalloutTextsDialog } from '@/components/CalloutTextsDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { testVoiceText } from '@/lib/callout'
import { announce } from '@/lib/useAnnouncer'
import { entryFor, voiceEntries, voiceIdFor } from '@/lib/voicePicker'
import { useClubVoice } from '@/lib/voiceStore'

const OPTIONS: { voice: CalloutVoice; label: string; hint: string }[] = [
  {
    voice: 'elevenlabs',
    label: 'ElevenLabs',
    hint: 'A natural voice, using the club’s ElevenLabs credits. Each device uses its own voice when ElevenLabs can’t be reached.',
  },
  {
    voice: 'device',
    label: 'Device voice',
    hint: 'Each phone or tablet’s built-in voice. Free, and works offline.',
  },
]


/** The ElevenLabs voices the server can list: loading, loaded, or why not. */
type VoiceList = { state: 'loading' } | { state: 'loaded'; voices: VoiceOption[] } | { state: 'unlistable' | 'failed' }

/** The account's voices, fetched while the ElevenLabs choice is shown (signed in, with a server that has a key). */
function useVoiceList(enabled: boolean): VoiceList {
  const token = useClubAuth((s) => s.club?.token)
  // The answer, with the login it was fetched for: another login (or none yet) reads as loading.
  const [result, setResult] = useState<{ token: string; list: VoiceList } | null>(null)
  useEffect(() => {
    if (!enabled || !cloud || !token) return
    let live = true
    const done = (list: VoiceList) => live && setResult({ token, list })
    cloud
      .fetchVoiceOptions(token)
      .then((options) => done(options.listable ? { state: 'loaded', voices: options.voices } : { state: 'unlistable' }))
      .catch(() => done({ state: 'failed' }))
    return () => {
      live = false
    }
  }, [enabled, token])
  return result && result.token === token ? result.list : { state: 'loading' }
}

/** Which voice reads the club's call-outs, for the whole club (setup screen's club panel, and the session menu). */
export function CalloutVoiceSetting() {
  const { voice, voiceId, texts, elevenLabs } = useClubVoice()
  const name = useId()
  const list = useVoiceList(voice === 'elevenlabs' && elevenLabs !== false)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [editingTexts, setEditingTexts] = useState(false)
  const voices = list.state === 'loaded' ? list.voices : []
  const entries = voiceEntries(voices, voiceId)

  function choose(next: CalloutVoice) {
    if (next === voice) return
    saveClubVoice({ voice: next })
    toast(next === 'device' ? 'Call-outs now use each device’s own voice.' : 'Call-outs now use ElevenLabs.')
  }

  function pick(value: string) {
    const id = voiceIdFor(value)
    if (id === voiceId) return
    const label = entries.find((e) => e.value === value)?.label ?? value
    saveClubVoice({ voice, voiceId: id, voiceName: label })
    toast(`Call-out voice: ${label}`)
  }

  function usePasted(event: FormEvent) {
    event.preventDefault()
    const id = pasted.trim()
    if (!isVoiceId(id)) {
      setPasteError('A voice id is letters and digits only, such as 21m00Tcm4TlvDq8ikWAM.')
      return
    }
    setPasteError(null)
    setPasted('')
    const known = voices.find((v) => v.id === id)
    saveClubVoice({ voice, voiceId: id === DEFAULT_VOICE_ID ? null : id, voiceName: known?.name ?? id })
    toast(`Call-out voice: ${known?.name ?? id}`)
  }

  async function test() {
    // Named, so the server reads with this voice even before the club has been sent the choice.
    const spoken = await announce(testVoiceText(texts), voice === 'elevenlabs' ? { voiceId: voiceId ?? DEFAULT_VOICE_ID } : undefined)
    if (spoken === 'device' && voice === 'elevenlabs' && elevenLabs !== false) {
      toast('ElevenLabs could not read it with this voice, so this device’s own voice was used. A voice marked “paid plan” needs a paid ElevenLabs plan.')
    }
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Call-out voice</legend>
      {OPTIONS.map((option) => (
        <div key={option.voice} className="flex items-start gap-2">
          <input
            id={`${name}-${option.voice}`}
            type="radio"
            name={name}
            className="mt-1 size-4 accent-primary"
            checked={voice === option.voice}
            onChange={() => choose(option.voice)}
          />
          <div>
            <Label htmlFor={`${name}-${option.voice}`}>{option.label}</Label>
            <p className="text-xs text-muted-foreground">{option.hint}</p>
          </div>
        </div>
      ))}
      {voice === 'elevenlabs' && elevenLabs === false && (
        <p className="text-xs text-muted-foreground">
          ElevenLabs is not set up on this server, so devices use their own voice.
        </p>
      )}
      {voice === 'elevenlabs' && elevenLabs !== false && (
        <div className="space-y-2 pl-6">
          <div className="space-y-1">
            <Label htmlFor={`${name}-voice`}>ElevenLabs voice</Label>
            <Select value={entryFor(voiceId)} onValueChange={pick}>
              <SelectTrigger id={`${name}-voice`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entries.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    <span className="flex flex-col items-start">
                      <span>{entry.label}</span>
                      {entry.hint && <span className="text-xs text-muted-foreground">{entry.hint}</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {list.state === 'loading' && <p className="text-xs text-muted-foreground">Loading the account’s voices…</p>}
            {list.state === 'loaded' && list.voices.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Only your ElevenLabs <em>My voices</em> are listed. Add voices in ElevenLabs, or paste a voice id below.
              </p>
            )}
            {list.state === 'unlistable' && (
              <p className="text-xs text-muted-foreground">
                The server’s ElevenLabs key may not list voices (it needs the Voices permission). Paste a voice id below.
              </p>
            )}
            {list.state === 'failed' && (
              <p className="text-xs text-muted-foreground">The account’s voices could not be loaded. Paste a voice id below.</p>
            )}
          </div>
          <form className="space-y-1" onSubmit={usePasted}>
            <Label htmlFor={`${name}-paste`}>Other voice id</Label>
            <div className="flex gap-2">
              <Input
                id={`${name}-paste`}
                value={pasted}
                placeholder="From the ElevenLabs website"
                onChange={(e) => setPasted(e.target.value)}
                aria-invalid={pasteError !== null}
              />
              <Button type="submit" variant="outline" disabled={pasted.trim() === ''}>
                Use
              </Button>
            </div>
            {pasteError && (
              <p role="alert" className="text-xs text-destructive">
                {pasteError}
              </p>
            )}
          </form>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void test()}>
          <Volume2 aria-hidden="true" /> Test voice
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setEditingTexts(true)}>
          <MessageSquareText aria-hidden="true" /> Edit wording…
        </Button>
      </div>
      <CalloutTextsDialog open={editingTexts} onOpenChange={setEditingTexts} />
    </fieldset>
  )
}
