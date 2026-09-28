import type { MatchmakingMode } from '@/rotation/types'

export const MATCHMAKING_MODES: { value: MatchmakingMode; label: string; description: string }[] = [
  {
    value: 'balanced',
    label: 'Auto-balanced',
    description: 'First come, first served, with teams split evenly by skill.',
  },
  {
    value: 'skill',
    label: 'Skill-separated',
    description: 'Players are matched with others of a similar skill level.',
  },
  {
    value: 'winners',
    label: 'Winners vs. Losers',
    description: 'Ladder style: winners play winners and losers play losers.',
  },
  {
    value: 'mixed',
    label: 'Mixed doubles',
    description: 'Every team has one man and one woman. Gender is required at check-in.',
  },
]

/** What the setup screen starts on for a new doubles session. */
export const DEFAULT_MATCHMAKING: MatchmakingMode = 'winners'

export const matchmakingLabel = (mode: MatchmakingMode) =>
  MATCHMAKING_MODES.find((m) => m.value === mode)?.label ?? mode
