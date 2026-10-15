import { describe, expect, it } from 'vitest'
import { SIGNATURE_BREAKS, wrapLabel } from './text'

describe('wrapLabel', () => {
  it('keeps a short label on one line', () => {
    expect(wrapLabel('Postgres', 14)).toEqual(['Postgres'])
  })

  it('breaks after path separators', () => {
    expect(wrapLabel('feedback.routes/handler/schema', 16)).toEqual(['feedback.routes/', 'handler/schema'])
  })

  it('breaks identifiers at camel humps', () => {
    expect(wrapLabel('KnexFeedbackRepository', 16)).toEqual(['KnexFeedback', 'Repository'])
  })

  it('breaks at spaces and trims them', () => {
    expect(wrapLabel('LegacyUserDirectory · ACL', 16)).toEqual(['LegacyUser', 'Directory · ACL'])
    expect(wrapLabel('model-user (legacy)', 14)).toEqual(['model-user', '(legacy)'])
  })

  it('lets an unbreakable token overflow instead of cutting it', () => {
    expect(wrapLabel('supercalifragilistic', 8)).toEqual(['supercalifragilistic'])
  })

  it('never returns more lines than tokens and never an empty line', () => {
    for (const label of ['', ' ', 'a b c d e f', 'AaBbCcDd']) {
      expect(wrapLabel(label, 3).every((l) => l.length > 0 || label.trim() === '')).toBe(true)
    }
  })
})

describe('wrapLabel with signature breaks', () => {
  it('breaks a signature after the opening parenthesis, the commas and the closing colon', () => {
    expect(wrapLabel('execute(cmd: Place, ctx: Ctx): Promise<void>', 14, SIGNATURE_BREAKS)).toEqual(['execute(cmd:', 'Place, ctx:', 'Ctx):', 'Promise<void>'])
  })

  it('leaves the default breaks alone', () => {
    expect(wrapLabel('execute(cmd): Promise<void>', 14)).toEqual(['execute(cmd):', 'Promise<void>'])
  })
})
