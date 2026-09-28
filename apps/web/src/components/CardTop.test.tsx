import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cardColors } from '@/lib/cardPalette'
import type { Standing } from '@/rotation/standings'
import { StandingsCard } from './StandingsCard'

const ann = { id: 1, name: 'Ann', rank: 1, wins: 1, losses: 0 } as Standing
const card = (logo?: string) =>
  renderToStaticMarkup(
    <StandingsCard page={[ann]} pageNumber={1} pageCount={1} location="Tuesday" date="Sep 28" colors={cardColors({ preset: 'court' })} logo={logo} />,
  )

describe('the club logo on a share card', () => {
  it('sits beside the Standings title and the session line, and is left out without one', () => {
    expect(card('data:image/png;base64,AAAA')).toMatch(/Standings<\/p><p[^>]*>Tuesday<\/p><\/div><img src="data:image\/png;base64,AAAA" alt="Club logo"/)
    expect(card()).not.toContain('<img src="data:image/png')
  })
})
