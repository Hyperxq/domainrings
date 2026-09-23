import { describe, expect, it } from 'vitest'
import { parseHexa, toHexa } from './hexa'
import { EXAMPLE_DIAGRAM } from './example'

const errorsOf = (text: string) => {
  const result = parseHexa(text)
  if (result.ok) throw new Error('expected parse to fail')
  return result.errors
}

describe('.hexa serialization', () => {
  it('roundtrips a diagram', () => {
    expect(parseHexa(toHexa(EXAMPLE_DIAGRAM))).toEqual({ ok: true, diagram: EXAMPLE_DIAGRAM })
  })

  it('tags the file with the app marker', () => {
    expect(JSON.parse(toHexa(EXAMPLE_DIAGRAM))).toMatchObject({ app: 'domainrings', version: 1 })
  })

  it('opens a file saved under the legacy app name and re-exports it as domainrings', () => {
    const legacy = JSON.stringify({ ...EXAMPLE_DIAGRAM, app: 'archviz' })
    const result = parseHexa(legacy)
    expect(result).toEqual({ ok: true, diagram: EXAMPLE_DIAGRAM })
    expect(JSON.parse(toHexa(result.ok ? result.diagram : EXAMPLE_DIAGRAM)).app).toBe('domainrings')
  })

  it('rejects a file from another app', () => {
    const text = JSON.stringify({ ...EXAMPLE_DIAGRAM, app: 'excalidraw' })
    expect(errorsOf(text)).toEqual([expect.stringMatching(/^app: /)])
  })

  it('rejects a file without the app marker', () => {
    expect(errorsOf(JSON.stringify(EXAMPLE_DIAGRAM))).toEqual([expect.stringMatching(/^app: /)])
  })

  it('rejects an unsupported version', () => {
    const text = JSON.stringify({ ...EXAMPLE_DIAGRAM, app: 'domainrings', version: 2 })
    expect(errorsOf(text)).toEqual([expect.stringMatching(/^version: /)])
  })

  it('reports every schema issue with its path', () => {
    const text = JSON.stringify({ ...EXAMPLE_DIAGRAM, app: 'domainrings', kind: 'mvc', title: 7 })
    expect(errorsOf(text)).toEqual([
      expect.stringMatching(/^kind: /),
      expect.stringMatching(/^title: /),
    ])
  })

  it('reports malformed JSON as a single readable error', () => {
    expect(errorsOf('{ not json')).toEqual([expect.stringMatching(/^The file is not valid JSON/)])
  })
})
