import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScoreTeams, type ScoreField } from './ScoreDialog'

const field = (id: string): ScoreField => ({ id, value: '', onChange: () => {} })

describe('ScoreTeams', () => {
  it('puts Blue and Orange side by side, each with its players and its score box', () => {
    const html = renderToStaticMarkup(
      <ScoreTeams teamNames={[['Ann', 'Bob'], ['Cy', 'Dee']]} fields={[field('score-a'), field('score-b')]} />,
    )
    // One grid of three columns: Blue, "vs", Orange.
    expect(html).toMatch(/^<div class="grid grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/)
    const blue = html.slice(html.indexOf('aria-label="Blue"'), html.indexOf('aria-label="Orange"'))
    const orange = html.slice(html.indexOf('aria-label="Orange"'))
    expect(blue).toMatch(/Ann[^]*Bob[^]*Blue score[^]*id="score-a"/)
    expect(orange).toMatch(/Cy[^]*Dee[^]*Orange score[^]*id="score-b"/)
  })
})
