import type { CSSProperties } from 'react'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { cn } from '@/lib/utils'
import type { Medal, PodiumPlace } from '@/rotation/standings'

/** Fixed medal colours: the steps are solid blocks, so the same colours read well in both themes. */
const STEP: Record<Medal, { block: string; text: string; height: string; order: string; delay: number; place: string }> = {
  gold: { block: 'linear-gradient(180deg, #fcd34d 0%, #f59e0b 100%)', text: '#422006', height: 'h-20', order: 'order-2', delay: 300, place: '1st' },
  silver: { block: 'linear-gradient(180deg, #e2e8f0 0%, #94a3b8 100%)', text: '#1e293b', height: 'h-14', order: 'order-1', delay: 150, place: '2nd' },
  bronze: { block: 'linear-gradient(180deg, #fdba74 0%, #c2410c 100%)', text: '#ffffff', height: 'h-10', order: 'order-3', delay: 0, place: '3rd' },
}

/** At most this many names under a place; ties beyond that show as "+n". */
const MAX_NAMES = 2

const placeLabel = (place: PodiumPlace) => {
  const names = place.players.map((p) => p.name).join(' and ')
  const { wins, losses } = place.players[0]
  return `${STEP[place.medal].place} place: ${names}, ${wins} ${wins === 1 ? 'win' : 'wins'} ${losses} ${losses === 1 ? 'loss' : 'losses'}`
}

/**
 * The top three as a podium: gold in the middle and tallest, silver left, bronze right. The steps rise in
 * one after another when shown, then the gold avatar keeps a soft glow; nothing moves for anyone who asks
 * their device for reduced motion. Names and numbers are drawn from data attributes (like avatar initials)
 * and each place is labelled for screen readers, so the podium adds no text that would match a player's
 * name twice on the page.
 */
export function Podium({ places }: { places: PodiumPlace[] }) {
  if (places.length === 0) return null
  // A new leader plays the rise again.
  const key = places[0].players.map((p) => p.id).join('-')

  return (
    <ol key={key} aria-label="Podium" className="mb-4 grid grid-cols-3 items-end gap-2">
      {places.map((place) => {
        const step = STEP[place.medal]
        const gold = place.medal === 'gold'
        const shown = place.players.slice(0, MAX_NAMES)
        const more = place.players.length - shown.length
        const names = shown.map((p) => p.name).join(', ') + (more > 0 ? ` +${more}` : '')
        const { wins, losses } = place.players[0]
        return (
          <li
            key={place.medal}
            aria-label={placeLabel(place)}
            className={cn('flex min-w-0 flex-col items-center gap-1 motion-safe:animate-podium-rise', step.order)}
            style={{ animationDelay: `${step.delay}ms` } as CSSProperties}
          >
            <div aria-hidden="true" className="flex -space-x-3">
              {shown.map((p) => (
                <span key={p.id} className={cn('inline-flex rounded-full', gold && 'motion-safe:animate-podium-glow')}>
                  <PlayerAvatar name={p.name} size={gold ? 'md' : 'sm'} className="ring-2 ring-background" />
                </span>
              ))}
            </div>
            <span
              aria-hidden="true"
              data-names={names}
              className="w-full truncate text-center text-sm font-medium before:content-[attr(data-names)]"
            />
            <span
              aria-hidden="true"
              data-record={`${wins}-${losses}`}
              className="text-xs text-muted-foreground tabular-nums before:content-[attr(data-record)]"
            />
            <div
              aria-hidden="true"
              data-rank={String(place.rank)}
              className={cn(
                'flex w-full items-start justify-center rounded-t-lg pt-1 text-xl font-bold shadow-sm before:content-[attr(data-rank)]',
                step.height,
              )}
              style={{ background: step.block, color: step.text }}
            />
          </li>
        )
      })}
    </ol>
  )
}
