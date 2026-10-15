import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Adapter, Diagram, DomainItem, Endpoint, Port, Side, UseCase } from '../../model/schema'
import { adapterTag, portTag, USE_CASE_TAG } from '../tags'
import { LINE_METRICS, lineWidth, noteLines, SIGNATURE_BREAKS, styled, wrapLabel, type LineStyle, type TextLine } from '../text'
import { USE_CASE_TEXT_WIDTH } from './spacing'

const PAD_X = 12
const PAD_Y = 9

export function frame(lines: TextLine[], minWidth = 0, padY = PAD_Y, padX = PAD_X) {
  return {
    lines,
    width: Math.max(minWidth, ...lines.map(lineWidth)) + 2 * padX,
    height: lines.reduce((h, l) => h + LINE_METRICS[l.style].height, 0) + 2 * padY,
  }
}

export type Frame = ReturnType<typeof frame>

export type BoxFrames = ReturnType<typeof boxFrames>

/** Box contents: every size derives from the text a box has to hold, the same in Detailed and Overview. */
export function boxFrames() {
  const { labels } = HEXAGONAL_KIND
  const adapterFrame = (a: Adapter, side: Side) => frame([...styled('eyebrow', adapterTag(side, labels)), ...styled('name', a.name, 18), ...noteLines(a.note)], 110)
  const portFrame = (p: Port) => frame([...styled('tag', portTag(p.side, labels)), ...styled('name', p.name, 18), ...noteLines(p.note)], 70)
  const leafFrame = (e: Endpoint, side: Side) => frame([...styled('title', e.name, 16), ...noteLines(e.note, side === 'driven' ? 'mono' : 'muted')], 80)
  // A card names its root in bold; the type header above it and the rows below belong to the card.
  const domainFrame = (i: DomainItem) => frame([...styled('strong', i.name), ...noteLines(i.note)], 0, 2, 0)
  // A use case's box runs radially on the side walls, so its text wraps to a narrow column; a word that cannot wrap is cut.
  const narrow = (style: LineStyle, text: string | undefined, breaks?: RegExp): TextLine[] => {
    const max = Math.floor(USE_CASE_TEXT_WIDTH / (LINE_METRICS[style].size * LINE_METRICS[style].em))
    return text?.trim() ? wrapLabel(text.trim(), max, breaks).map((t) => ({ text: t.length > max ? `${t.slice(0, max - 1)}…` : t, style })) : []
  }
  const useCaseFrame = (u: UseCase) => {
    const [signature, ...steps] = (u.note ?? '').split('\n')
    return frame([...styled('tag', USE_CASE_TAG), ...narrow('name', u.name), ...narrow('mono', signature, SIGNATURE_BREAKS), ...steps.flatMap((s) => narrow('muted', s))], 120)
  }
  const compositionFrame = (composition: NonNullable<Diagram['composition']>) => frame([...styled('mono', composition.name), ...noteLines(composition.note)], 120)
  return { adapterFrame, portFrame, leafFrame, domainFrame, useCaseFrame, compositionFrame }
}
