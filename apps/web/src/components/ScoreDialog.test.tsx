import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScoreTeams, type ScoreField } from './ScoreDialog'

const field = (id: string, extra: Partial<ScoreField> = {}): ScoreField => ({ id, value: '', onChange: () => {}, ...extra })

/** The markup of one team's box (Blue first, then Orange). */
const teamBox = (html: string, team: 'Blue' | 'Orange') => {
  const start = html.indexOf(`aria-label="${team}"`)
  const end = team === 'Blue' ? html.indexOf('aria-label="Orange"') : html.length
  return html.slice(start, end)
}

describe('ScoreTeams', () => {
  it('puts a field’s action (the Record button) in that team’s box, beside its score', () => {
    const html = renderToStaticMarkup(
      <ScoreTeams
        teamNames={[['Ann'], ['Bob']]}
        fields={[field('score-a', { action: <button type="submit">Record</button> }), field('score-b')]}
      />,
    )
    expect(teamBox(html, 'Blue')).toMatch(/id="score-a"[^]*<button type="submit">Record<\/button>/)
    expect(teamBox(html, 'Orange')).not.toContain('Record')
  })
})
