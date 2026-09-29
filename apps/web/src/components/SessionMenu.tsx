import { MAX_LOCATION_LENGTH, sameScale } from '@q2dink/shared'
import {
  DoorOpenIcon,
  GaugeIcon,
  HistoryIcon,
  LogOutIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
  RadioIcon,
  SlidersHorizontalIcon,
  Volume2Icon,
  MegaphoneIcon,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useClubAuth } from '@/cloud/auth'
import { leaveOpenSession } from '@/cloud/sync'
import { viewerUrl } from '@/cloud/url'
import { ActivityDialog } from '@/components/ActivityDialog'
import { CalloutVoiceSetting } from '@/components/CalloutVoiceSetting'
import { SayDialog } from '@/components/SayDialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EndSessionDialog } from '@/components/EndSessionDialog'
import { ManageCourtsDialog } from '@/components/ManageCourtsDialog'
import { RenameDialog } from '@/components/RenameDialog'
import { SharePanel } from '@/components/SharePanel'
import { Button } from '@/components/ui/button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { sessionScale } from '@/lib/skill'
import { useClubSkillScale } from '@/lib/skillScaleStore'
import { isLive, MAX_COURTS, sessionStatus } from '@/rotation/engine'
import type { SessionState } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

type ActiveDialog = 'rename' | 'courts' | 'share' | 'activity' | 'voice' | 'say' | 'end' | null

/** Rename the session, manage courts, share the live view and end the session, tucked behind one button. */
export function SessionMenu({ session }: { session: SessionState }) {
  const club = useClubAuth((s) => s.club)
  const [active, setActive] = useState<ActiveDialog>(null)
  const location = useSessionStore((s) => s.location)
  const sessionId = useSessionStore((s) => s.sessionId)
  const setLive = useSessionStore((s) => s.setLive)
  const setSkillScale = useSessionStore((s) => s.setSkillScale)
  const addCourt = useSessionStore((s) => s.addCourt)
  const atCourtLimit = session.courts.length >= MAX_COURTS
  const clubScale = useClubSkillScale()
  // The club changed its skill levels after this session was created: staff choose when it follows.
  const newLevels = !sameScale(sessionScale(session), clubScale)
  const live = isLive(session)
  const notStarted = sessionStatus(session) === 'notStarted'

  /** One more court at the end of the board, without opening Manage courts. */
  function handleAddCourt() {
    addCourt()
    const added = useSessionStore.getState().session?.courts.at(-1)
    toast(`${added?.name ?? 'Court'} added`)
  }

  function toggleLive() {
    setLive(!live)
    if (live) toast('Not live: the public page shows no game')
    else toast(`Live: players can see the board at ${club ? viewerUrl(club.slug, sessionId) : 'the live link'}`)
  }

  /** Back to the setup screen without ending it: paused, unless another staff device has it open. */
  async function leave() {
    const name = location
    const { paused, stillOpenOn } = await leaveOpenSession()
    if (stillOpenOn.length > 0) {
      toast(`Left “${name}”. It keeps running on ${stillOpenOn.map((d) => d.name).join(', ')}.`)
    } else {
      toast(paused ? `Paused and left “${name}”. Open it again from the list to resume.` : `Left “${name}”.`)
    }
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="Session menu">
            <MoreVerticalIcon aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="flex w-56 flex-col gap-1 p-1">
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setActive('rename')}
            >
              <PencilIcon aria-hidden="true" /> Rename session
            </Button>
          </PopoverClose>
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-9 w-full flex-col items-start gap-0 py-1.5"
              onClick={handleAddCourt}
              disabled={atCourtLimit}
            >
              <span className="flex items-center gap-2">
                <PlusIcon aria-hidden="true" /> Add court
              </span>
              {atCourtLimit && (
                <span className="pl-6 text-xs font-normal whitespace-normal text-muted-foreground">
                  Maximum of {MAX_COURTS} courts
                </span>
              )}
            </Button>
          </PopoverClose>
          <PopoverClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => setActive('courts')}
            >
              <SlidersHorizontalIcon aria-hidden="true" /> Manage courts
            </Button>
          </PopoverClose>
          {newLevels && (
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-9 w-full justify-start whitespace-normal text-left"
                onClick={() => {
                  setSkillScale(clubScale)
                  toast('The session now uses the club’s skill levels. Each player’s level follows their rating.')
                }}
              >
                <GaugeIcon aria-hidden="true" /> Use the club’s new levels
              </Button>
            </PopoverClose>
          )}
          {club && (
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={toggleLive}
                disabled={notStarted}
                title={notStarted ? 'Start the session first' : undefined}
              >
                <RadioIcon aria-hidden="true" /> {live ? 'Stop live' : 'Go live'}
              </Button>
            </PopoverClose>
          )}
          {club && (
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setActive('share')}
              >
                <QrCodeIcon aria-hidden="true" /> Share live view
              </Button>
            </PopoverClose>
          )}
          {club && (
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setActive('activity')}
              >
                <HistoryIcon aria-hidden="true" /> Activity
              </Button>
            </PopoverClose>
          )}
          <PopoverClose asChild>
            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => setActive('say')}>
              <MegaphoneIcon aria-hidden="true" /> Say something…
            </Button>
          </PopoverClose>
          {club && (
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setActive('voice')}
              >
                <Volume2Icon aria-hidden="true" /> Call-out voice…
              </Button>
            </PopoverClose>
          )}
          <div className="border-t pt-1">
            <PopoverClose asChild>
              <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => void leave()}>
                <DoorOpenIcon aria-hidden="true" /> Leave session
              </Button>
            </PopoverClose>
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setActive('end')}
              >
                <LogOutIcon aria-hidden="true" /> End session
              </Button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>

      <ActivityDialog
        sessionId={sessionId}
        open={active === 'activity'}
        onOpenChange={(open) => setActive(open ? 'activity' : null)}
      />

      <RenameDialog
        open={active === 'rename'}
        onOpenChange={(open) => setActive(open ? 'rename' : null)}
        title="Rename session"
        description="Shown on the board, the live page and shared standings."
        label="Session name"
        current={location}
        maxLength={MAX_LOCATION_LENGTH}
        onSave={(name) => {
          try {
            useSessionStore.getState().renameSession(name)
            return null
          } catch (error) {
            return error instanceof RangeError ? error.message : 'Could not rename the session.'
          }
        }}
      />
      <ManageCourtsDialog
        session={session}
        open={active === 'courts'}
        onOpenChange={(open) => setActive(open ? 'courts' : null)}
      />
      {club && (
        <SharePanel
          photoToggle
          sessionId={sessionId}
          open={active === 'share'}
          onOpenChange={(open) => setActive(open ? 'share' : null)}
        />
      )}
      {club && (
        <Dialog open={active === 'voice'} onOpenChange={(open) => setActive(open ? 'voice' : null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Call-out voice</DialogTitle>
              <DialogDescription>
                The voice that reads Next up, courts and players out loud, for every staff device of the club.
              </DialogDescription>
            </DialogHeader>
            <CalloutVoiceSetting />
            <DialogFooter>
              <Button onClick={() => setActive(null)}>Done</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <SayDialog open={active === 'say'} onOpenChange={(open) => setActive(open ? 'say' : null)} />
      <EndSessionDialog
        session={session}
        open={active === 'end'}
        onOpenChange={(open) => setActive(open ? 'end' : null)}
      />
    </>
  )
}
