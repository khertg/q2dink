import type { Ref } from 'react'
import { CardLogo, CardTop } from '@/components/CardTop'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { useSessionTitle } from '@/lib/avatars'
import type { CardColors } from '@/lib/cardPalette'
import { medalRowBackground, medalStyle } from '@/lib/medalStyle'
import { cn } from '@/lib/utils'
import { formatDiff, STANDINGS_PAGE_SIZE, type Standing } from '@/rotation/standings'

interface Props {
  /** This page's players only (see pageStandings). */
  page: Standing[]
  pageNumber: number
  pageCount: number
  location: string
  date: string
  /** Shown only on the last page: the pair who played together most, if any pair repeated. */
  topPartnership?: { names: [string, string]; count: number }
  /** The picked colours (see cardColors). */
  colors: CardColors
  /** The club's card logo for these colours (a data URL), shown beside the card's title. */
  logo?: string
  ref?: Ref<HTMLDivElement>
}

/**
 * One page of the ranked standings, sized for a messaging app share. Uses the picked fixed colours
 * (`colors`), not theme tokens, so the exported image looks the same in light and dark mode (same
 * reasoning as StatsCard). Shows the club's name when there is one. Same fixed width as StatsCard, so every shared image (one player or the whole
 * standings) looks consistent side by side in a chat.
 *
 * When there is more than one page, every page reserves the same `STANDINGS_PAGE_SIZE` row slots
 * and the same footer line (invisible placeholders on pages with fewer players, or with nothing
 * to put in the footer) so every image in the set is exactly the same height. Without this, a
 * near-empty last page (e.g. 3 players) renders much shorter than a full one (10 players) — and
 * messaging apps that scale image previews to a shared height then display them at visibly
 * different widths too, which is the "inconsistent size" this guards against. A lone page (no
 * set to match) is left to size itself naturally.
 */
export function StandingsCard({ page, pageNumber, pageCount, location, date, topPartnership, colors, logo, ref }: Props) {
  const padded = pageCount > 1
  const rowSlots = padded ? STANDINGS_PAGE_SIZE : page.length
  const title = useSessionTitle(location)

  return (
    <div
      ref={ref}
      className="flex w-[360px] flex-col gap-4 p-6"
      style={{ background: colors.background, color: colors.text }}
    >
      <CardTop date={date} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl leading-tight font-bold">Standings</p>
          <p className="text-sm opacity-90">{title}</p>
          {pageCount > 1 && (
            <p className="text-xs uppercase tracking-wide opacity-70">
              Page {pageNumber} of {pageCount}
            </p>
          )}
        </div>
        {logo && <CardLogo src={logo} />}
      </div>

      <div className="flex flex-col gap-1.5">
        {Array.from({ length: rowSlots }, (_, i) => page[i]).map((row, i) =>
          row ? (
            <StandingRow key={row.id} row={row} panel={colors.panel} />
          ) : (
            // Reserves the same row height (the size-10 avatar sets it) on a page with fewer
            // players, so every page in the set matches.
            <div key={`empty-${i}`} aria-hidden className="invisible flex items-center gap-2 px-2 py-1.5">
              <span className="w-5 shrink-0" />
              <span className="size-10 shrink-0" />
            </div>
          ),
        )}
      </div>

      {padded ? (
        <p className={cn('text-center text-xs opacity-80', !topPartnership && 'invisible')}>
          {topPartnership
            ? `Most played together: ${topPartnership.names[0]} & ${topPartnership.names[1]} (${topPartnership.count}×)`
            : 'placeholder'}
        </p>
      ) : (
        topPartnership && (
          <p className="text-center text-xs opacity-80">
            Most played together: {topPartnership.names[0]} &amp; {topPartnership.names[1]} ({topPartnership.count}×)
          </p>
        )
      )}
    </div>
  )
}

/**
 * One player's row. Gold, silver and bronze stand out: the row is washed and edged in the medal's colour,
 * the avatar ringed in it, and a pill names the medal, so it reads in any card colour and without colour.
 */
function StandingRow({ row, panel }: { row: Standing; panel: string }) {
  const medal = medalStyle(row.medal)
  return (
    <div
      className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5', medal && 'font-semibold')}
      style={{
        background: medal ? medalRowBackground(medal, panel) : panel,
        boxShadow: medal ? `inset 0 0 0 2px ${medal.color}` : undefined,
      }}
    >
      <span className="w-5 shrink-0 text-center text-sm font-bold">{row.rank}</span>
      {/* inline-flex: the ring hugs the picture (a photo sits on the text baseline and would leave a gap below it). */}
      <span className="inline-flex shrink-0 rounded-full" style={medal ? { boxShadow: `0 0 0 2px ${medal.color}` } : undefined}>
        <PlayerAvatar name={row.name} size="sm" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
      {medal && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
          style={{ background: medal.color, color: medal.ink }}
        >
          {medal.label}
        </span>
      )}
      <span className="shrink-0 text-sm tabular-nums opacity-90">
        {row.wins}-{row.losses}
      </span>
      <span className="w-9 shrink-0 text-right text-sm tabular-nums opacity-90">{formatDiff(row)}</span>
    </div>
  )
}
