import { Medal as MedalIcon } from 'lucide-react'
import type { Ref } from 'react'
import { CardLogo, CardTop } from '@/components/CardTop'
import { PlayerAvatar } from '@/components/PlayerAvatar'
import { useSessionTitle } from '@/lib/avatars'
import type { CardColors } from '@/lib/cardPalette'
import { medalStyle } from '@/lib/medalStyle'
import type { Standing } from '@/rotation/standings'

interface Props {
  standing: Standing
  location: string
  date: string
  /** The picked colours (see cardColors). */
  colors: CardColors
  /** The club's card logo for these colours (a data URL), shown beside the card's title. */
  logo?: string
  ref?: Ref<HTMLDivElement>
}

/**
 * Square stats card sized for Instagram, Facebook and WhatsApp. It uses the picked fixed colours
 * (`colors`), not theme tokens, so the exported image looks the same in light and dark mode. A medallist
 * stands out: the card is edged in the medal's colour, the avatar ringed in it, and a pill names the medal.
 */
export function StatsCard({ standing, location, date, colors, logo, ref }: Props) {
  const { name, rank, medal, wins, losses, games, winRate } = standing
  const title = useSessionTitle(location)
  const style = medalStyle(medal)
  return (
    <div
      ref={ref}
      className="flex h-[360px] w-[360px] shrink-0 flex-col justify-between p-6"
      style={{
        background: colors.background,
        color: colors.text,
        boxShadow: style ? `inset 0 0 0 4px ${style.color}` : undefined,
      }}
    >
      <CardTop date={date} />

      <div>
        {style ? (
          <p
            className="flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold uppercase tracking-wide"
            style={{ background: style.color, color: style.ink }}
          >
            <MedalIcon className="size-4" aria-hidden />
            {style.label} medal
          </p>
        ) : (
          <p className="w-fit text-sm uppercase tracking-wide opacity-80">Rank #{rank}</p>
        )}
        <div className="mt-2.5 flex items-center gap-3">
          <span
            className="inline-flex shrink-0 rounded-full"
            // A medallist's ring is their medal's colour. inline-flex: it hugs the picture (a photo sits on the text
            // baseline and would leave a gap below it, making the ring an oval).
            style={style ? { boxShadow: `0 0 0 4px ${style.color}` } : undefined}
          >
            <PlayerAvatar
              name={name}
              size="lg"
              className={style ? undefined : colors.lightText ? 'ring-2 ring-white/70' : 'ring-2 ring-black/20'}
            />
          </span>
          <p className="min-w-0 flex-1 break-words text-4xl leading-tight font-bold">{name}</p>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="w-fit text-lg opacity-90">Finished #{rank}</p>
            <p className="w-fit text-sm opacity-90">{title}</p>
          </div>
          {logo && <CardLogo src={logo} />}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ['Games', games],
          ['Wins', wins],
          ['Losses', losses],
          ['Win rate', `${Math.round(winRate * 100)}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg px-1 py-2" style={{ background: colors.panel }}>
            <p className="text-xl font-bold">{value}</p>
            <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
