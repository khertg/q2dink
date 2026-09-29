import { useState } from 'react'
import { toast } from 'sonner'
import { CalloutTextsDialog, type WordingScope } from '@/components/CalloutTextsDialog'
import { CourtCard } from '@/components/CourtCard'
import { CourtGrid } from '@/components/CourtGrid'
import { MatchLog } from '@/components/MatchLog'
import { NextUpCard, type NextUpLane } from '@/components/NextUpCard'
import { LockPartnerDialog } from '@/components/LockPartnerDialog'
import { QueueList } from '@/components/QueueList'
import { RemovePlayerDialog } from '@/components/RemovePlayerDialog'
import type { Candidate } from '@/components/ReplacePlayerDialog'
import { courtCallout, nextUpCallout, playerCallout } from '@/lib/callout'
import { waitingMessage } from '@/lib/nextUp'
import { useClubVoice } from '@/lib/voiceStore'
import { playerStatuses } from '@/lib/playerStatus'
import { removedMessage } from '@/lib/removal'
import { levelLabel, sessionScale } from '@/lib/skill'
import { TEAM_NAMES } from '@/lib/teams'
import { locksBrokenBy } from '@/lib/lockGuard'
import { lockMarks, unlockedSentence } from '@/lib/partners'
import { useLockGuard } from '@/lib/useLockGuard'
import type { SessionAction } from '@/store/actions'
import { usePartnerOption } from '@/lib/usePartnerOption'
import { useSkillEditor } from '@/lib/useSkillEditor'
import { isNextUpPicked, nextGroup, nextGroups, nextUpSpots, nextUpStandIn, sessionStatus, type NextGroup } from '@/rotation/engine'
import { hasLevelCourts, sameLevels } from '@/rotation/levels'
import type { Court, SessionState, Teams } from '@/rotation/types'
import { useSessionStore } from '@/store/session'
import { useClubAuth } from '@/cloud/auth'

/** When a previewed change would happen (only the order of events matters to it, never the exact time). */
const clock = () => Date.now()

export function BoardScreen({ session }: { session: SessionState }) {
  const recordScore = useSessionStore((s) => s.recordScore)
  const undo = useSessionStore((s) => s.undo)
  const cancelMatch = useSessionStore((s) => s.cancelMatch)
  const replacePlayer = useSessionStore((s) => s.replacePlayer)
  const replaceNextUp = useSessionStore((s) => s.replaceNextUp)
  const resetNextUp = useSessionStore((s) => s.resetNextUp)
  const dropFromNextUp = useSessionStore((s) => s.dropFromNextUp)
  const removeFromCourt = useSessionStore((s) => s.removeFromCourt)
  const fillCourtSpot = useSessionStore((s) => s.fillCourtSpot)
  const fillNextUpSpot = useSessionStore((s) => s.fillNextUpSpot)
  const startGame = useSessionStore((s) => s.startGame)
  const checkOutPlayer = useSessionStore((s) => s.checkOutPlayer)
  const resumeGame = useSessionStore((s) => s.resumeGame)
  const removePlayer = useSessionStore((s) => s.removePlayer)
  // The player staff chose to remove from the session, while the confirm dialog is open.
  const [removing, setRemoving] = useState<number | null>(null)
  // The player whose partner is being chosen, while that dialog is open.
  const [locking, setLocking] = useState<number | null>(null)
  const partnerFor = usePartnerOption(session, setLocking)
  const { guard, dialog: lockGuardDialog } = useLockGuard(session)
  const marks = lockMarks(session)
  const editMatch = useSessionStore((s) => s.editMatch)
  const changeSkill = useSkillEditor()

  // Games never start by themselves. These are the groups staff would start next (one per level range
  // while courts are kept for levels), and what each open court offers: start its group, start with
  // whoever is waiting (mixed doubles, or too few players in the court's range), or wait.
  const lanes = nextGroups(session)
  const byLevel = hasLevelCourts(session)
  const group = lanes[0].group
  const anyone = nextGroup(session, { ignoreMode: true })
  const groupFor = (court: Court): NextGroup | null =>
    lanes.find((lane) => sameLevels(lane.levels, court.levels))?.group ?? null
  const startStateFor = (court: Court) => (groupFor(court) ? 'ready' : anyone ? 'override' : 'none')
  const teamNames = (g: NextGroup) =>
    g.teams.map((team) => team.map((id) => session.players[id]?.name ?? 'Player').join(' & ')).join(' vs ')
  /** On a level court, the group that would start there, so staff can call its players. */
  const nextHereFor = (court: Court) => {
    const courtGroup = court.levels ? groupFor(court) : null
    return courtGroup ? teamNames(courtGroup) : undefined
  }
  const nextUpIds = lanes.flatMap((lane) => lane.group?.players ?? [])
  const levelLanes: NextUpLane[] | undefined = byLevel
    ? lanes.map((lane, index) => ({
        label: levelLabel(sessionScale(session), lane.levels) ?? 'Any level',
        nextUp: lane.group?.players ?? [],
        emptyMessage: waitingMessage(session, lane.levels),
        spots: nextUpSpots(session, index),
      }))
    : undefined
  // Everyone, with where they are right now: any of them can be swapped in from any card.
  const statuses = playerStatuses(session, lanes)
  const candidates: Candidate[] = statuses.map((status) => ({ player: session.players[status.id], status }))
  const statusOf = (id: number) => statuses.find((s) => s.id === id)
  const slotsPerTeam = session.mode === 'doubles' ? 2 : 1
  // What the speaker buttons and each player's Call out read out loud, in the club's wording.
  const { texts } = useClubVoice()
  // Signed in to a club: each speaker and Call out can change its wording, saved for the club.
  const signedIn = useClubAuth((s) => !!s.club)
  const [wording, setWording] = useState<WordingScope | null>(null)
  const onEditWording = signedIn ? setWording : undefined
  const calloutFor = (id: number) => playerCallout(session, id, lanes, texts)
  // Games start only while the session's clock runs.
  const status = sessionStatus(session)
  const stoppedReason =
    status === 'notStarted'
      ? 'Start the session (at the top) to start games.'
      : status === 'paused'
        ? 'The session is paused: resume it to start games.'
        : undefined

  const courtName = (courtId: number) =>
    session.courts.find((c) => c.id === courtId)?.name ?? `Court ${courtId}`

  /** The toast that follows a result or a score, with the 10-second undo. */
  function announce(message: string) {
    toast(message, {
      duration: 10_000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (!undo()) toast.error("Can't undo: the session changed after that result")
        },
      },
    })
  }

  function handleScore(courtId: number, scoreA: number, scoreB: number) {
    recordScore(courtId, scoreA, scoreB)
    const winner = scoreA > scoreB ? 0 : 1
    announce(`${courtName(courtId)}: ${TEAM_NAMES[winner]} won ${Math.max(scoreA, scoreB)}–${Math.min(scoreA, scoreB)}`)
  }

  function handleCancel(courtId: number) {
    const staged = session.courts.find((c) => c.id === courtId)?.notStarted
    cancelMatch(courtId)
    toast(`${courtName(courtId)}: ${staged ? 'cleared' : 'game cancelled'}`)
  }

  function handleStart(courtId: number, options?: { ignoreMode?: boolean }) {
    startGame(courtId, options)
    toast(`${courtName(courtId)} started`)
  }

  /** The end of a message when a change ended partner locks (staff were asked first). */
  const unlockedNote = (pairs: [number, number][]) => (pairs.length === 0 ? '' : ` ${unlockedSentence(session, pairs)}`)

  function handleReplace(courtId: number, outId: number, inId: number, sendOnBreak: boolean) {
    const from = statusOf(inId)
    const out = session.players[outId].name
    const into = session.players[inId].name
    if (from?.place === 'court') {
      const action: SessionAction = { type: 'replacePlayer', courtId, outId, inId, now: clock() }
      guard(action, `Swapping ${out} and ${into}`, (pairs) => {
        replacePlayer(courtId, outId, inId)
        const where =
          from.courtId === courtId ? `on ${courtName(courtId)}` : `(${courtName(courtId)} ↔ ${courtName(from.courtId!)})`
        toast(`${into} and ${out} traded places ${where}.` + unlockedNote(pairs))
      })
      return
    }
    const action: SessionAction = { type: 'replacePlayer', courtId, outId, inId, options: { sendOnBreak }, now: clock() }
    guard(action, `Taking ${out} off ${courtName(courtId)}`, (pairs) => {
      replacePlayer(courtId, outId, inId, { sendOnBreak })
      toast(
        `${into}${from?.place === 'break' ? ' is back from a break and' : ''} replaced ${out}. ` +
          `${out} ${sendOnBreak ? 'is on a break' : from?.place === 'nextUp' ? `takes ${into}'s spot in Next up` : 'is first in the queue'}.` +
          unlockedNote(pairs),
      )
    })
  }

  function handleReplaceNextUp(outId: number, inId: number) {
    const from = statusOf(inId)
    const out = session.players[outId].name
    const into = session.players[inId].name
    const sameGroup = from?.place === 'nextUp' && from.lane === statusOf(outId)?.lane
    guard({ type: 'replaceNextUp', outId, inId, now: clock() }, `Swapping ${into} into Next up`, (pairs) => {
      replaceNextUp(outId, inId)
      const message = sameGroup
        ? `${into} and ${out} changed places in Next up.`
        : from?.place === 'court'
          ? `${into} and ${out} traded places: ${out} is on ${courtName(from.courtId!)}, ${into} is next up.`
          : from?.place === 'break'
            ? `${into} is back from a break and next up instead of ${out}.`
            : `${into} is next up instead of ${out}.`
      toast(message + unlockedNote(pairs))
    })
  }

  /** Take a player off a court: their spot stays open and the game pauses until someone fills it. */
  function handleOffCourt(courtId: number, outId: number, onBreak: boolean) {
    const staged = session.courts.find((c) => c.id === courtId)?.notStarted
    const out = session.players[outId].name
    const action: SessionAction = { type: 'removeFromCourt', courtId, playerId: outId, onBreak, now: clock() }
    guard(action, `Taking ${out} off ${courtName(courtId)}`, (pairs) => {
      removeFromCourt(courtId, outId, onBreak)
      toast(
        `${out} is off ${courtName(courtId)} and ${onBreak ? 'on a break' : 'first in the queue'}.` +
          (staged ? '' : ' The game is paused until the spot is filled.') +
          unlockedNote(pairs),
      )
    })
  }

  /** A waiting player takes a break. A break ends their partner locks, so staff are asked first. */
  function handleQueueBreak(id: number) {
    const name = session.players[id].name
    guard({ type: 'checkOut', playerId: id }, `${name} taking a break`, (pairs) => {
      checkOutPlayer(id)
      if (pairs.length > 0) toast(`${name} is on a break.` + unlockedNote(pairs))
    })
  }

  /** Put someone in an open spot on a court: a game missing a player, or a court being set up by hand. */
  function handleFill(courtId: number, team: 0 | 1, slot: number, inId: number) {
    const court = session.courts.find((c) => c.id === courtId)
    fillCourtSpot(courtId, team, slot, inId)
    const lastSpot = (court?.teams?.flat().length ?? 0) === slotsPerTeam * 2 - 1
    const after = !lastSpot
      ? ''
      : court?.teams && !court.notStarted
        ? court.pausedByStaff
          ? ' The game stays paused until you resume it.'
          : ' The game is back on.'
        : ' Ready to start.'
    toast(`${session.players[inId].name} is on ${courtName(courtId)}.${after}`)
  }

  function handleFillNextUp(lane: number, slot: number, inId: number) {
    fillNextUpSpot(lane, slot, inId)
    toast(`${session.players[inId].name} is pinned to Next up.`)
  }

  /** Take a player out of Next up: a stand-in takes their spot and the rest of the group stays. */
  function handleOffNextUp(outId: number, onBreak: boolean) {
    const standIn = nextUpStandIn(session, outId)
    const out = session.players[outId].name
    guard({ type: 'dropFromNextUp', playerId: outId, onBreak }, `Taking ${out} out of Next up`, (pairs) => {
      dropFromNextUp(outId, onBreak)
      if (!nextUpIds.includes(outId)) {
        // Pinned into a group that has not formed yet: their spot is simply open again.
        toast((onBreak ? `${out} is on a break.` : `${out} is no longer pinned to Next up.`) + unlockedNote(pairs))
        return
      }
      const instead = standIn === undefined ? '' : `${session.players[standIn].name} is next up instead`
      toast(
        (onBreak ? `${out} is on a break.${instead ? ` ${instead}.` : ''}` : `${instead} of ${out}.`) + unlockedNote(pairs),
      )
    })
  }

  /** Why a Next up player cannot be removed: nobody is waiting outside the groups (in their level range). */
  const nextUpRemoveBlocked = (id: number) =>
    nextUpIds.includes(id) && nextUpStandIn(session, id) === undefined
      ? 'No one else is waiting to take their spot'
      : undefined

  /** Take a player out of the session altogether, from a court or Next up (after the confirm dialog). */
  function handleRemoveFromSession(id: number) {
    const pairs = locksBrokenBy(session, { type: 'removePlayer', playerId: id, now: clock() })
    const message = removedMessage(session, id)
    removePlayer(id)
    toast(message + unlockedNote(pairs))
  }

  function handleEditScore(matchIndex: number, score: [number, number]) {
    editMatch(matchIndex, { score })
    toast(`Match ${matchIndex + 1}: score corrected`)
  }

  function handleEditPlayers(matchIndex: number, teams: Teams) {
    editMatch(matchIndex, { teams })
    toast(`Match ${matchIndex + 1}: players corrected`)
  }

  return (
    <div className="space-y-4">
      <CourtGrid>
        {session.courts.map((court, index) => (
          <CourtCard
            key={court.id}
            court={court}
            lockMarks={marks}
            position={{ index, count: session.courts.length }}
            players={session.players}
            candidates={candidates}
            slotsPerTeam={slotsPerTeam}
            partners={session.partners}
            startState={startStateFor(court)}
            waitingMessage={waitingMessage(session, court.levels)}
            nextHere={nextHereFor(court)}
            announceText={courtCallout(session, court, court.teams ? null : groupFor(court), texts)}
            calloutFor={calloutFor}
            onEditWording={onEditWording}
            onStart={(options) => handleStart(court.id, options)}
            stoppedReason={stoppedReason}
            onReplace={(outId, inId, options) => handleReplace(court.id, outId, inId, options.sendOnBreak)}
            onRemove={(id) => handleOffCourt(court.id, id, false)}
            onTakeBreak={(id) => handleOffCourt(court.id, id, true)}
            onRemoveFromSession={setRemoving}
            partnerFor={partnerFor}
            onFill={(team, slot, inId) => handleFill(court.id, team, slot, inId)}
            onSkillChange={changeSkill}
            onScore={(a, b) => handleScore(court.id, a, b)}
            onCancel={() => handleCancel(court.id)}
            onResume={() => {
              resumeGame(court.id)
              toast(`${court.name}: game resumed.`)
            }}
          />
        ))}
      </CourtGrid>
      <NextUpCard
        lockMarks={marks}
        nextUp={group?.players ?? []}
        spots={nextUpSpots(session, 0)}
        players={session.players}
        emptyMessage={waitingMessage(session)}
        candidates={candidates}
        slotsPerTeam={slotsPerTeam}
        onReplace={handleReplaceNextUp}
        onRemove={(id) => handleOffNextUp(id, false)}
        onTakeBreak={(id) => handleOffNextUp(id, true)}
        onRemoveFromSession={setRemoving}
        partnerFor={partnerFor}
        removeBlocked={nextUpRemoveBlocked}
        onFillSpot={handleFillNextUp}
        picked={isNextUpPicked(session)}
        onReset={resetNextUp}
        onSkillChange={changeSkill}
        editable
        queuedAt={session.queuedAt}
        lanes={levelLanes}
        announceText={nextUpCallout(session, lanes, texts)}
        calloutFor={calloutFor}
        onEditWording={onEditWording}
      />
      <QueueList
        session={session}
        nextUp={nextUpIds}
        onSkillChange={changeSkill}
        onTakeBreak={handleQueueBreak}
        onRemoveFromSession={setRemoving}
        partnerFor={partnerFor}
        editable
        calloutFor={calloutFor}
        onEditWording={onEditWording}
      />
      <MatchLog
        matches={session.matches ?? []}
        players={session.players}
        onEditScore={handleEditScore}
        onEditPlayers={handleEditPlayers}
      />
      <LockPartnerDialog session={session} playerId={locking} onClose={() => setLocking(null)} />
      {lockGuardDialog}
      <CalloutTextsDialog
        scope={wording ?? { kind: 'club' }}
        open={wording !== null}
        onOpenChange={(open) => !open && setWording(null)}
      />
      <RemovePlayerDialog
        session={session}
        playerId={removing}
        onClose={() => setRemoving(null)}
        onConfirm={handleRemoveFromSession}
      />
    </div>
  )
}
