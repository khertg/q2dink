import { toast } from 'sonner'
import { CourtCard } from '@/components/CourtCard'
import { CourtGrid } from '@/components/CourtGrid'
import { MatchLog } from '@/components/MatchLog'
import { NextUpCard, type NextUpLane } from '@/components/NextUpCard'
import { QueueList } from '@/components/QueueList'
import type { Candidate } from '@/components/ReplacePlayerDialog'
import { waitingMessage } from '@/lib/nextUp'
import { playerStatuses } from '@/lib/playerStatus'
import { levelLabel } from '@/lib/skill'
import { TEAM_NAMES } from '@/lib/teams'
import { useSkillEditor } from '@/lib/useSkillEditor'
import { isNextUpPicked, nextGroup, nextGroups, nextUpSpots, nextUpStandIn, sessionStatus, type NextGroup } from '@/rotation/engine'
import { hasLevelCourts, sameLevels } from '@/rotation/levels'
import type { Court, SessionState, Teams } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

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
        label: levelLabel(lane.levels) ?? 'Any level',
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

  /** Whether the player is in a partner lock, in force or waiting. */
  const hasLock = (id: number) =>
    [...session.partners, ...(session.pendingPartners ?? []).map(({ pair }) => pair)].some((pair) => pair.includes(id))

  function handleReplace(courtId: number, outId: number, inId: number, sendOnBreak: boolean) {
    const from = statusOf(inId)
    const out = session.players[outId].name
    const into = session.players[inId].name
    if (from?.place === 'court') {
      const wasLocked = hasLock(outId) || hasLock(inId)
      replacePlayer(courtId, outId, inId)
      const where =
        from.courtId === courtId ? `on ${courtName(courtId)}` : `(${courtName(courtId)} ↔ ${courtName(from.courtId!)})`
      toast(`${into} and ${out} traded places ${where}.` + (wasLocked ? ' Partner locks were removed.' : ''))
      return
    }
    const wasLocked = hasLock(outId)
    replacePlayer(courtId, outId, inId, { sendOnBreak })
    toast(
      `${into}${from?.place === 'break' ? ' is back from a break and' : ''} replaced ${out}. ` +
        `${out} ${sendOnBreak ? 'is on a break' : from?.place === 'nextUp' ? `takes ${into}'s spot in Next up` : 'is first in the queue'}.` +
        (wasLocked ? ' Their partner lock was removed.' : ''),
    )
  }

  function handleReplaceNextUp(outId: number, inId: number) {
    const from = statusOf(inId)
    const out = session.players[outId].name
    const into = session.players[inId].name
    const sameGroup = from?.place === 'nextUp' && from.lane === statusOf(outId)?.lane
    const wasLocked = !sameGroup && (hasLock(outId) || hasLock(inId))
    replaceNextUp(outId, inId)
    const message = sameGroup
      ? `${into} and ${out} changed places in Next up.`
      : from?.place === 'court'
        ? `${into} and ${out} traded places: ${out} is on ${courtName(from.courtId!)}, ${into} is next up.`
        : from?.place === 'break'
          ? `${into} is back from a break and next up instead of ${out}.`
          : `${into} is next up instead of ${out}.`
    toast(message + (wasLocked ? ' Partner locks were removed.' : ''))
  }

  /** Take a player off a court: their spot stays open and the game pauses until someone fills it. */
  function handleOffCourt(courtId: number, outId: number, onBreak: boolean) {
    const wasLocked = hasLock(outId)
    const staged = session.courts.find((c) => c.id === courtId)?.notStarted
    removeFromCourt(courtId, outId, onBreak)
    const out = session.players[outId].name
    toast(
      `${out} is off ${courtName(courtId)} and ${onBreak ? 'on a break' : 'first in the queue'}.` +
        (staged ? '' : ' The game is paused until the spot is filled.') +
        (wasLocked ? ' Their partner lock was removed.' : ''),
    )
  }

  /** Put someone in an open spot on a court: a game missing a player, or a court being set up by hand. */
  function handleFill(courtId: number, team: 0 | 1, slot: number, inId: number) {
    const court = session.courts.find((c) => c.id === courtId)
    fillCourtSpot(courtId, team, slot, inId)
    const lastSpot = (court?.teams?.flat().length ?? 0) === slotsPerTeam * 2 - 1
    const after = !lastSpot ? '' : court?.teams && !court.notStarted ? ' The game is back on.' : ' Ready to start.'
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
    dropFromNextUp(outId, onBreak)
    if (!nextUpIds.includes(outId)) {
      // Pinned into a group that has not formed yet: their spot is simply open again.
      toast(onBreak ? `${out} is on a break.` : `${out} is no longer pinned to Next up.`)
      return
    }
    const instead = standIn === undefined ? '' : `${session.players[standIn].name} is next up instead`
    toast(onBreak ? `${out} is on a break.${instead ? ` ${instead}.` : ''}` : `${instead} of ${out}.`)
  }

  /** Why a Next up player cannot be removed: nobody is waiting outside the groups (in their level range). */
  const nextUpRemoveBlocked = (id: number) =>
    nextUpIds.includes(id) && nextUpStandIn(session, id) === undefined
      ? 'No one else is waiting to take their spot'
      : undefined

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
        {session.courts.map((court) => (
          <CourtCard
            key={court.id}
            court={court}
            players={session.players}
            candidates={candidates}
            slotsPerTeam={slotsPerTeam}
            partners={session.partners}
            startState={startStateFor(court)}
            waitingMessage={waitingMessage(session, court.levels)}
            nextHere={nextHereFor(court)}
            onStart={(options) => handleStart(court.id, options)}
            stoppedReason={stoppedReason}
            onReplace={(outId, inId, options) => handleReplace(court.id, outId, inId, options.sendOnBreak)}
            onRemove={(id) => handleOffCourt(court.id, id, false)}
            onTakeBreak={(id) => handleOffCourt(court.id, id, true)}
            onFill={(team, slot, inId) => handleFill(court.id, team, slot, inId)}
            onSkillChange={changeSkill}
            onScore={(a, b) => handleScore(court.id, a, b)}
            onCancel={() => handleCancel(court.id)}
          />
        ))}
      </CourtGrid>
      <NextUpCard
        nextUp={group?.players ?? []}
        spots={nextUpSpots(session, 0)}
        players={session.players}
        emptyMessage={waitingMessage(session)}
        candidates={candidates}
        slotsPerTeam={slotsPerTeam}
        onReplace={handleReplaceNextUp}
        onRemove={(id) => handleOffNextUp(id, false)}
        onTakeBreak={(id) => handleOffNextUp(id, true)}
        removeBlocked={nextUpRemoveBlocked}
        onFillSpot={handleFillNextUp}
        picked={isNextUpPicked(session)}
        onReset={resetNextUp}
        onSkillChange={changeSkill}
        editable
        queuedAt={session.queuedAt}
        lanes={levelLanes}
      />
      <QueueList
        session={session}
        nextUp={nextUpIds}
        onSkillChange={changeSkill}
        onTakeBreak={checkOutPlayer}
        editable
      />
      <MatchLog
        matches={session.matches ?? []}
        players={session.players}
        onEditScore={handleEditScore}
        onEditPlayers={handleEditPlayers}
      />
    </div>
  )
}
