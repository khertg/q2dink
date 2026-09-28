import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ClubPanel } from '@/components/ClubPanel'
import { OpenSessionsCard } from '@/components/OpenSessionsCard'
import { LifetimeLeaderboard } from '@/components/LifetimeLeaderboard'
import { PastSessionsDialog } from '@/components/PastSessionsDialog'
import { SavedPlayersDialog } from '@/components/SavedPlayersDialog'
import { SkillScaleDialog } from '@/components/SkillScaleDialog'
import { ActivityDialog } from '@/components/ActivityDialog'
import { ResetDeviceDialog } from '@/components/ResetDeviceDialog'
import { cloud } from '@/cloud/client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEFAULT_MATCHMAKING, MATCHMAKING_MODES } from '@/lib/matchmaking'
import {
  DEFAULT_AVG_GAME_MINUTES,
  isValidGameMinutes,
  MAX_AVG_GAME_MINUTES,
  MAX_COURTS,
  MIN_AVG_GAME_MINUTES,
  MIN_COURTS,
} from '@/rotation/engine'
import { MAX_LOCATION_LENGTH } from '@q2dink/shared'
import type { GameMode, MatchmakingMode } from '@/rotation/types'
import { useSessionStore } from '@/store/session'

const MODES: { value: GameMode; label: string }[] = [
  { value: 'doubles', label: 'Doubles' },
  { value: 'singles', label: 'Singles' },
]

function SetupCard() {
  const startSession = useSessionStore((s) => s.startSession)
  const [location, setLocation] = useState('')
  const [courts, setCourts] = useState('4')
  const [mode, setMode] = useState<GameMode>('doubles')
  const [matchmaking, setMatchmaking] = useState<MatchmakingMode>(DEFAULT_MATCHMAKING)
  const [gameMinutes, setGameMinutes] = useState(String(DEFAULT_AVG_GAME_MINUTES))

  const courtCount = Number(courts)
  const courtsValid = Number.isInteger(courtCount) && courtCount >= MIN_COURTS && courtCount <= MAX_COURTS
  const gameMinutesValue = Number(gameMinutes)
  const gameMinutesValid = isValidGameMinutes(gameMinutesValue)
  const formValid = courtsValid && gameMinutesValid

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!formValid) return
    startSession(location.trim() || 'Open play', mode, courtCount, {
      avgGameMinutes: gameMinutesValue,
      matchmaking: mode === 'doubles' ? matchmaking : 'balanced',
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up an open play session</CardTitle>
        <CardDescription>
          Nothing starts yet: check players in and set up courts first, then press Start session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="location">Session name</Label>
            <Input
              id="location"
              value={location}
              maxLength={MAX_LOCATION_LENGTH}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Open play"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="courts">
              Number of courts ({MIN_COURTS} to {MAX_COURTS})
            </Label>
            <Input
              id="courts"
              type="number"
              inputMode="numeric"
              min={MIN_COURTS}
              max={MAX_COURTS}
              value={courts}
              onChange={(e) => setCourts(e.target.value)}
              aria-invalid={!courtsValid}
            />
            {!courtsValid && (
              <p className="text-sm text-destructive">
                Enter a whole number from {MIN_COURTS} to {MAX_COURTS}.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label id="mode-label">Game mode</Label>
            <div role="group" aria-labelledby="mode-label" className="grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <Button
                  key={m.value}
                  type="button"
                  className="h-11"
                  variant={mode === m.value ? 'default' : 'outline'}
                  aria-pressed={mode === m.value}
                  onClick={() => setMode(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          {mode === 'doubles' && (
            <div className="space-y-2">
              <Label htmlFor="matchmaking">Matchmaking</Label>
              <Select value={matchmaking} onValueChange={(v) => setMatchmaking(v as MatchmakingMode)}>
                <SelectTrigger id="matchmaking" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATCHMAKING_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                {MATCHMAKING_MODES.find((m) => m.value === matchmaking)?.description}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="game-minutes">Average game length (minutes)</Label>
            <Input
              id="game-minutes"
              type="number"
              inputMode="numeric"
              min={MIN_AVG_GAME_MINUTES}
              max={MAX_AVG_GAME_MINUTES}
              value={gameMinutes}
              onChange={(e) => setGameMinutes(e.target.value)}
              aria-invalid={!gameMinutesValid}
            />
            {!gameMinutesValid && (
              <p className="text-sm text-destructive">
                Enter a whole number from {MIN_AVG_GAME_MINUTES} to {MAX_AVG_GAME_MINUTES}.
              </p>
            )}
          </div>

          <Button type="submit" className="h-11 w-full" disabled={!formValid}>
            Create session
          </Button>
        </form>
        <div className="mt-2 space-y-1">
          <SavedPlayersDialog />
          <SkillScaleDialog />
          <PastSessionsDialog />
          <LifetimeLeaderboard />
          <ActivityDialog label="Club activity" />
          {/* With a cloud it sits in the club panel, next to Log out. */}
          {!cloud && <ResetDeviceDialog variant="ghost" />}
        </div>
      </CardContent>
    </Card>
  )
}

export function SetupScreen() {
  return (
    <div className="space-y-4">
      <OpenSessionsCard />
      <SetupCard />
      <ClubPanel />
    </div>
  )
}
