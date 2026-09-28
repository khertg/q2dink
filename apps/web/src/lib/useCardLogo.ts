import type { CardLogoChoice } from '@q2dink/shared'
import { useClubAuth } from '@/cloud/auth'
import { useCardLogoChoice, useCardLogos } from '@/db/cardLogos'
import type { CardLogoRow } from '@/db/db'
import { logoForCard } from '@/lib/cardLogos'
import type { CardColors } from '@/lib/cardPalette'

/** The club's logo for cards in these colours (automatic, picked or none), the club's logos and its choice. */
export function useCardLogo(colors: CardColors): { logo?: CardLogoRow; logos: CardLogoRow[]; choice: CardLogoChoice } {
  const slug = useClubAuth((s) => s.club?.slug)
  const logos = useCardLogos(slug) ?? []
  const choice = useCardLogoChoice(slug)
  return { logo: logoForCard(logos, choice, colors), logos, choice }
}
