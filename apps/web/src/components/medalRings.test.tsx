import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AvatarContext } from '@/lib/avatars'
import { cardColors, DEFAULT_CARD_CHOICE } from '@/lib/cardPalette'
import type { Standing } from '@/rotation/standings'
import { Podium } from './Podium'
import { StandingsCard } from './StandingsCard'

const photo = { kind: 'photo', data: 'data:image/png;base64,' } as const
const withPhotos = (node: ReactNode) =>
  renderToStaticMarkup(
    <AvatarContext.Provider value={{ local: new Map([['ann', photo]]), club: null }}>{node}</AvatarContext.Provider>,
  )

const ann = { id: 1, name: 'Ann', rank: 1, medal: 'gold', wins: 3, losses: 0 } as Standing

/** The classes of the element right around Ann's photo (the one that draws the medal ring or glow). */
const photoWrapper = (html: string) =>
  /<span class="([^"]*)"[^>]*><span role="img"[^>]*data-avatar-kind="photo"/.exec(html)?.[1].split(' ') ?? []

// A photo's picture sits on the text baseline, so a plain inline wrapper is taller than it and its ring
// is an oval rather than a circle (initials have text in them and fit). The wrapper must be a flex box.
describe('medal rings around photos', () => {
  it('hug the photo on the podium', () => {
    expect(photoWrapper(withPhotos(<Podium places={[{ medal: 'gold', rank: 1, players: [ann] }]} />))).toContain(
      'inline-flex',
    )
  })

  it('hug the photo on the shared standings card', () => {
    const card = (
      <StandingsCard page={[ann]} pageNumber={1} pageCount={1} location="" date="" colors={cardColors(DEFAULT_CARD_CHOICE)} />
    )
    expect(photoWrapper(withPhotos(card))).toContain('inline-flex')
  })
})
