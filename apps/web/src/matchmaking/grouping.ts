import type { MatchmakingMode, SessionState, Teams } from '@/rotation/types'

/**
 * Doubles matchmaking: choose four players from the queue, then split them
 * into two teams.
 *
 * The queue is read as "units": a solo player, or a locked partner pair that
 * sits together at the later partner's spot. The first unit that can be
 * completed into a group is the anchor, so first come, first served always
 * holds for the player at the front. The other spots are then filled by the
 * chosen mode, looking only a few units ahead so nobody far back jumps the line.
 *
 * Every mode also avoids repeats: who has been partners or opponents lately is
 * remembered (from the finished games), so a group that just played together
 * counts as a few places further back in the queue, and the teams are split so
 * partners rotate instead of being paired again.
 */

/** How many units behind the anchor the scored modes may look. */
export const LOOKAHEAD_UNITS = 8
/** Cap for the plain first-come fallback, to bound the search on huge queues. */
const FALLBACK_POOL_UNITS = 24

type Partners = SessionState['partners']
type Score = number[]

/** How many finished games back "played together lately" reaches. */
export const RECENT_MATCHES = 12
/** A recent partnership counts double a recent opposition when rating how stale a group is. */
const PARTNER_WEIGHT = 2
/**
 * Fresh partners are preferred over the most balanced split, but never at the price of clearly
 * lopsided teams. Team skill totals of the same four players always differ by an even amount, so a
 * limit of 2 allows, for example, 6 against 4 instead of 5 against 5, and nothing more lopsided.
 */
export const LOPSIDED_LIMIT = 2

/**
 * How often each pair of players teamed up, or faced each other, in the recent games, and how
 * recently: `*Recency` adds up a weight per game that grows with how late it was (the oldest of the
 * remembered games weighs 1), so of two pairs seen equally often, the one seen longer ago is smaller.
 */
export interface PairHistory {
  partners: Map<string, number>
  opponents: Map<string, number>
  partnerRecency: Map<string, number>
  opponentRecency: Map<string, number>
}

const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
const bump = (counts: Map<string, number>, a: number, b: number, by = 1) => {
  const key = pairKey(a, b)
  counts.set(key, (counts.get(key) ?? 0) + by)
}

export function pairHistory(state: SessionState): PairHistory {
  const partners = new Map<string, number>()
  const opponents = new Map<string, number>()
  const partnerRecency = new Map<string, number>()
  const opponentRecency = new Map<string, number>()
  ;(state.matches ?? []).slice(-RECENT_MATCHES).forEach(({ teams }, index) => {
    const weight = index + 1
    for (const team of teams) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          bump(partners, team[i], team[j])
          bump(partnerRecency, team[i], team[j], weight)
        }
      }
    }
    for (const a of teams[0]) {
      for (const b of teams[1]) {
        bump(opponents, a, b)
        bump(opponentRecency, a, b, weight)
      }
    }
  })
  return { partners, opponents, partnerRecency, opponentRecency }
}

/** How much these players have already played together or against each other lately (0 when never). */
export function repeatPenalty(history: PairHistory, ids: number[]): number {
  let total = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = pairKey(ids[i], ids[j])
      total += (history.partners.get(key) ?? 0) * PARTNER_WEIGHT + (history.opponents.get(key) ?? 0)
    }
  }
  return total
}

interface Unit {
  ids: number[]
  /** Sum of the members' queue indices (a pair counts its later spot twice); lower means they have waited longer. */
  cost: number
}

interface Mode {
  feasible: (state: SessionState, ids: number[]) => boolean
  score: (state: SessionState, ids: number[], cost: number) => Score
}

export function partnerOf(partners: Partners, id: number): number | undefined {
  for (const [a, b] of partners) {
    if (a === id) return b
    if (b === id) return a
  }
  return undefined
}

/**
 * Whether a waiting player holds for their partner: their lock is in force but the partner is not waiting (on a court,
 * a court being set up, or a break). They are not picked on their own; once the partner is back in the queue the pair
 * stands at the later spot.
 */
export function isHeld(state: Pick<SessionState, 'partners' | 'queue'>, id: number): boolean {
  const partner = partnerOf(state.partners, id)
  return partner !== undefined && state.queue.includes(id) && !state.queue.includes(partner)
}

function buildUnits(queue: number[], partners: Partners): Unit[] {
  const seen = new Set<number>()
  const units: Unit[] = []
  queue.forEach((id, index) => {
    if (seen.has(id)) return
    const partner = partnerOf(partners, id)
    const partnerIndex = partner === undefined ? -1 : queue.indexOf(partner)
    if (partner === undefined || partnerIndex === -1) {
      seen.add(id)
      units.push({ ids: [id], cost: index })
    } else if (partnerIndex < index) {
      // A pair is only a unit while both partners are waiting, and it stands at the later
      // partner's spot, so being locked never moves anyone ahead of people who were waiting.
      seen.add(id)
      seen.add(partner)
      units.push({ ids: [partner, id], cost: index * 2 })
    }
    // else: the partner is further back; the pair is added when the queue reaches them.
  })
  return units
}

function* combos(units: Unit[], need: number, start = 0, chosen: Unit[] = []): Generator<Unit[]> {
  if (need === 0) {
    yield chosen
    return
  }
  for (let i = start; i < units.length; i++) {
    const size = units[i].ids.length
    if (size <= need) yield* combos(units, need - size, i + 1, [...chosen, units[i]])
  }
}

const compare = (a: Score, b: Score) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

const genderCount = (state: SessionState, ids: number[], gender: 'M' | 'F') =>
  ids.filter((id) => state.players[id].gender === gender).length

/** Two men and two women, and every locked pair in the group is one of each. */
export function isMixedGroup(state: SessionState, ids: number[]): boolean {
  if (genderCount(state, ids, 'M') !== 2 || genderCount(state, ids, 'F') !== 2) return false
  return state.partners.every(([a, b]) => {
    if (!ids.includes(a) || !ids.includes(b)) return true
    return state.players[a].gender !== state.players[b].gender
  })
}

const MODES: Record<MatchmakingMode, Mode> = {
  balanced: {
    feasible: () => true,
    score: (_s, _ids, cost) => [cost],
  },
  skill: {
    feasible: () => true,
    score: (state, ids, cost) => {
      const skills = ids.map((id) => state.players[id].skill)
      return [Math.max(...skills) - Math.min(...skills), cost]
    },
  },
  winners: {
    feasible: () => true,
    score: (state, ids, cost) => {
      const won = ids.filter((id) => state.lastResult[id] === 'W').length
      const lost = ids.filter((id) => state.lastResult[id] === 'L').length
      // Players with no result yet fit anywhere; only a W/L mix is penalised.
      return [Math.min(won, lost), cost]
    },
  },
  mixed: {
    feasible: isMixedGroup,
    score: (_s, _ids, cost) => [cost],
  },
}

function pickBest(
  state: SessionState,
  anchor: Unit,
  pool: Unit[],
  need: number,
  mode: Mode,
  history: PairHistory,
): number[] | null {
  let best: { ids: number[]; score: Score } | null = null
  for (const combo of combos(pool, need)) {
    const ids = [...anchor.ids, ...combo.flatMap((u) => u.ids)]
    if (!mode.feasible(state, ids)) continue
    // A group that has played together lately counts as if it stood further back in the queue.
    const cost = anchor.cost + combo.reduce((sum, u) => sum + u.cost, 0) + repeatPenalty(history, ids)
    const score = mode.score(state, ids, cost)
    if (!best || compare(score, best.score) < 0) best = { ids, score }
  }
  return best?.ids ?? null
}

export interface SelectOptions {
  /** Pick as if the mode were auto-balanced (used when staff start a court by hand). */
  ignoreMode?: boolean
}

/**
 * Pick the four players for the next doubles game, or null if the queue cannot
 * fill a court yet. Returned ids are in queue order.
 *
 * Skill and Winners vs. Losers are preferences and fall back to first come,
 * first served. Mixed doubles is a requirement: with no valid mixed group the
 * court stays open so a non-mixed game is never staged behind staff's back.
 */
export function selectGroup(
  state: SessionState,
  queue: number[],
  { ignoreMode = false }: SelectOptions = {},
): number[] | null {
  const matchmaking = ignoreMode ? 'balanced' : state.matchmaking
  // A player holding for a partner who is not waiting is never picked without them.
  const units = buildUnits(
    queue.filter((id) => !isHeld(state, id)),
    state.partners,
  )
  const history = pairHistory(state)
  for (let a = 0; a < units.length; a++) {
    const anchor = units[a]
    const rest = units.slice(a + 1)
    const need = 4 - anchor.ids.length
    if (rest.reduce((n, u) => n + u.ids.length, 0) < need) return null

    let group: number[] | null = null
    if (matchmaking !== 'balanced') {
      // Mixed is a hard requirement, so search wider for a valid group.
      const window = matchmaking === 'mixed' ? FALLBACK_POOL_UNITS : LOOKAHEAD_UNITS
      group = pickBest(state, anchor, rest.slice(0, window), need, MODES[matchmaking], history)
      if (!group && matchmaking === 'mixed') continue
    }
    group ??= pickBest(state, anchor, rest.slice(0, FALLBACK_POOL_UNITS), need, MODES.balanced, history)
    if (group) return group.sort((x, y) => queue.indexOf(x) - queue.indexOf(y))
  }
  return null
}

/**
 * Split four players into two teams: keep locked partners together, keep mixed
 * games one man and one woman per side, then prefer partners (and then opponents)
 * who have not been paired lately, as long as the teams are not clearly lopsided,
 * then minimise the skill gap, then prefer whoever was paired longest ago. Without
 * history this is simply the most balanced split.
 */
export function splitGroup(state: SessionState, group: number[]): Teams {
  const [a, b, c, d] = group
  const options: Teams[] = [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ]

  const pairs = state.partners.filter(([x, y]) => group.includes(x) && group.includes(y))
  let allowed = options.filter((teams) =>
    pairs.every(([x, y]) => teams.some((side) => side.includes(x) && side.includes(y))),
  )

  if (state.matchmaking === 'mixed' && isMixedGroup(state, group)) {
    const mixedOnly = allowed.filter((teams) =>
      teams.every((side) => genderCount(state, side, 'M') === 1),
    )
    if (mixedOnly.length > 0) allowed = mixedOnly
  }

  const skill = (side: number[]) => side.reduce((sum, id) => sum + state.players[id].skill, 0)
  const gap = (teams: Teams) => Math.abs(skill(teams[0]) - skill(teams[1]))
  const bestGap = Math.min(...allowed.map(gap))
  const fair = allowed.filter((teams) => gap(teams) <= bestGap + LOPSIDED_LIMIT)

  const history = pairHistory(state)
  const partnerSum = (teams: Teams, counts: Map<string, number>) =>
    teams.reduce((n, side) => n + (counts.get(pairKey(side[0], side[1])) ?? 0), 0)
  const opponentSum = (teams: Teams, counts: Map<string, number>) =>
    teams[0].reduce((n, a) => n + teams[1].reduce((m, b) => m + (counts.get(pairKey(a, b)) ?? 0), 0), 0)
  const rank = (teams: Teams): Score => [
    partnerSum(teams, history.partners),
    opponentSum(teams, history.opponents),
    gap(teams),
    partnerSum(teams, history.partnerRecency),
    opponentSum(teams, history.opponentRecency),
  ]
  return fair.reduce((best, teams) => (compare(rank(teams), rank(best)) < 0 ? teams : best), fair[0])
}
