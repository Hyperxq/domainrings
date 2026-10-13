import { describe, expect, it } from 'vitest'
import { hiddenTextRule } from './overlays'

describe('hiddenTextRule', () => {
  it('is empty with nothing labelled', () => {
    expect(hiddenTextRule([])).toBe('')
  })

  it('targets each labelled node by hexagon, kind and ref, on the canvas only', () => {
    const rule = hiddenTextRule([
      { hexagonId: 'h1', kind: 'useCase', ref: 'uc-1' },
      { hexagonId: 'h2', kind: 'port', ref: 'p-1' },
    ])
    expect(rule).toBe('.canvas:not(.exporting) [data-hex="h1"] .node-useCase[data-ref="uc-1"] text,.canvas:not(.exporting) [data-hex="h2"] .node-port[data-ref="p-1"] text{display:none}')
  })

  it('keeps an id with quotes or backslashes inside its string', () => {
    document.body.innerHTML = '<div class="canvas"><svg><g data-hex="h&quot;1"><g class="node node-port" data-ref="a\\b&quot;]x"><text>t</text></g></g></svg></div>'
    const style = document.head.appendChild(document.createElement('style'))
    style.textContent = hiddenTextRule([{ hexagonId: 'h"1', kind: 'port', ref: 'a\\b"]x' }])
    try {
      expect(getComputedStyle(document.querySelector('text')!).display).toBe('none')
    } finally {
      style.remove()
      document.body.innerHTML = ''
    }
  })
})
