import { toast } from 'sonner'
import { create } from 'zustand'
import { useClubAuth } from '@/cloud/auth'
import { cloud } from '@/cloud/client'
import { browserAudio, browserSynth, createAnnouncer, type AnnounceOptions, type Announcer, type Spoken } from '@/lib/announcer'
import { clubVoiceFor } from '@/lib/voiceStore'

/** The call-out being read out right now, so its button can show it. */
const useSpeaking = create<{ text: string | null }>(() => ({ text: null }))

let announcer: Announcer | null = null

/** One announcer for the whole app, made on first use (the browser's audio and voice only exist then). */
function getAnnouncer(): Announcer {
  announcer ??= createAnnouncer({
    api: cloud,
    token: () => useClubAuth.getState().club?.token,
    voice: () => clubVoiceFor(useClubAuth.getState().club?.slug).voice,
    voiceId: () => clubVoiceFor(useClubAuth.getState().club?.slug).voiceId,
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    now: () => Date.now(),
    audio: browserAudio(),
    synth: browserSynth(),
  })
  return announcer
}

/** Read a call-out out loud (a tap on a speaker button or a Call out item). Must be called inside the tap. */
export async function announce(text: string, options?: AnnounceOptions): Promise<Spoken> {
  useSpeaking.setState({ text })
  const spoken = await getAnnouncer().announce(text, options)
  if (spoken === 'superseded') return spoken
  useSpeaking.setState({ text: null })
  if (spoken === 'none') toast.error('This device cannot read call-outs out loud.')
  return spoken
}

/** Whether this call-out is being read out right now. */
export const useSpeakingText = (text: string | null) => useSpeaking((s) => text !== null && s.text === text)
