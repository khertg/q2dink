import { Fragment, useState, type FormEvent } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { PlayerTile, TeamBox, Versus } from '@/components/PlayerTile'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TEAM_NAMES } from '@/lib/teams'
import { isValidScore, MAX_SCORE, winnerScoreProblem } from '@/rotation/engine'

interface Props {
  courtName: string
  /** Player names on Team A and Team B, shown so staff can check who they are scoring. */
  teamNames: [string[], string[]]
  /** The team whose win button was pressed. The pop-up is open while this is set. */
  winner: 0 | 1 | null
  /** Closed without recording anything: the game stays in play. */
  onClose: () => void
  /** Called with Team A's and Team B's score. The winner's score is always the higher one. */
  onSubmit: (scoreA: number, scoreB: number) => void
}

/** Games are usually played to 11, so the winner's box starts there; only the other score is typed. */
const DEFAULT_WINNING_SCORE = '11'

/** A blank field is not a number, so it is never a valid score. */
const parse = (text: string) => (text.trim() === '' ? NaN : Number(text))

/** The score of a finished game. Every game is finished with one, so points always count. */
export function ScoreDialog({ courtName, teamNames, winner, onClose, onSubmit }: Props) {
  return (
    <Dialog open={winner !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* Keyed by team so the fields start empty every time the pop-up opens. */}
        {winner !== null && (
          <ScoreForm
            key={winner}
            courtName={courtName}
            teamNames={teamNames}
            winner={winner}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** One team's score field. */
export interface ScoreField {
  id: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
  invalid?: boolean
}

/**
 * Both teams side by side: Blue, "vs", Orange, each in its colour with its players and its score field at the
 * bottom, so staff can see at a glance whose score they are typing, and the pop-up is short enough to stay above a
 * phone's keyboard.
 */
export function ScoreTeams({ teamNames, fields }: { teamNames: [string[], string[]]; fields: [ScoreField, ScoreField] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      {([0, 1] as const).map((team) => (
        <Fragment key={team}>
          {team === 1 && <Versus />}
          <TeamBox
            team={team}
            footer={
              <div className="space-y-1 px-1">
                <Label htmlFor={fields[team].id}>{TEAM_NAMES[team]} score</Label>
                <Input
                  id={fields[team].id}
                  type="number"
                  inputMode="numeric"
                  enterKeyHint="done"
                  min={0}
                  max={MAX_SCORE}
                  className="h-11 w-full text-center text-lg font-semibold"
                  autoFocus={fields[team].autoFocus}
                  value={fields[team].value}
                  onChange={(e) => fields[team].onChange(e.target.value)}
                  aria-invalid={fields[team].invalid}
                />
              </div>
            }
          >
            {teamNames[team].map((name, i) => (
              <PlayerTile key={i}>
                <PlayerAvatar name={name} size="sm" />
                <span className="min-w-0 truncate">{name}</span>
              </PlayerTile>
            ))}
          </TeamBox>
        </Fragment>
      ))}
    </div>
  )
}

function ScoreForm({
  courtName,
  teamNames,
  winner,
  onClose,
  onSubmit,
}: Omit<Props, 'winner'> & { winner: 0 | 1 }) {
  const [textA, setTextA] = useState(winner === 0 ? DEFAULT_WINNING_SCORE : '')
  const [textB, setTextB] = useState(winner === 1 ? DEFAULT_WINNING_SCORE : '')

  const a = parse(textA)
  const b = parse(textB)
  const problem = winnerScoreProblem(winner, a, b)
  // Say nothing while a field is still empty, unless what is already typed cannot be a score.
  const typedInvalid = (text: string, n: number) => text.trim() !== '' && !isValidScore(n)
  const bothTyped = textA.trim() !== '' && textB.trim() !== ''
  const message = problem && (bothTyped || typedInvalid(textA, a) || typedInvalid(textB, b)) ? problem : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (problem) return
    onSubmit(a, b)
    onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{TEAM_NAMES[winner]} won</DialogTitle>
        <DialogDescription>
          {courtName}: enter each team&apos;s score. {TEAM_NAMES[winner]}&apos;s score starts at 11 and must be the higher one.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ScoreTeams
          teamNames={teamNames}
          fields={[
            { id: 'score-a', value: textA, onChange: setTextA, autoFocus: winner === 1, invalid: typedInvalid(textA, a) },
            { id: 'score-b', value: textB, onChange: setTextB, autoFocus: winner === 0, invalid: typedInvalid(textB, b) },
          ]}
        />
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={problem !== null}>
          Record score
        </Button>
      </form>
    </>
  )
}
