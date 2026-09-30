import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Adapter, Diagram, DomainItem, Endpoint, Port, Side, UseCase } from '../../model/schema'
import { adapterTag, DOMAIN_TAGS, portTag, USE_CASE_TAG } from '../tags'
import { LINE_METRICS, lineWidth, noteLines, styled, type TextLine } from '../text'
import { LABEL_GAP } from './spacing'

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

/** Box contents: every size derives from the text a box has to hold. */
export function boxFrames(overview: boolean) {
  const { labels } = HEXAGONAL_KIND
  // Overview pills carry the name only, unwrapped; its sockets are bare notches on the ring edge.
  const nameFrame = (name: string) => frame(styled('name', name), 80)
  const NOTCH: Frame = { lines: [], width: 14, height: 30 }
  // With the socket only a notch, the port name (the contract) sits beside it, inside the application ring.
  const portLabel = (p: Port) => frame(styled('label', p.name), 0, 0, 0)
  const labelReach = (p: Port) => (overview ? portLabel(p).width + LABEL_GAP : 0)
  const adapterFrame = (a: Adapter, side: Side) =>
    overview ? nameFrame(a.name) : frame([...styled('eyebrow', adapterTag(side, labels)), ...styled('name', a.name, 18), ...noteLines(a.note)], 110)
  const socketFrame = (p: Port) =>
    overview ? NOTCH : frame([...styled('tag', portTag(p.side, labels)), ...styled('name', p.name, 18), ...noteLines(p.note)], 70)
  const leafFrame = (e: Endpoint, side: Side) =>
    overview ? frame(styled('title', e.name), 80) : frame([...styled('title', e.name, 16), ...noteLines(e.note, side === 'driven' ? 'mono' : 'muted')], 80)
  // The type tag replaces the old type line. An aggregate root's tag sits on its outline, so the root line is just
  // its name, set strong; other roots carry the tag above their name.
  const domainFrame = (i: DomainItem) =>
    i.type === 'aggregate'
      ? frame([...styled('strong', i.name), ...noteLines(i.note)], 0, 2, 0)
      : frame([...styled('tag', DOMAIN_TAGS[i.type]), ...styled('mono', i.name), ...noteLines(i.note)], 0, 2, 0)
  const useCaseFrame = (u: UseCase) => {
    if (overview) return nameFrame(u.name)
    const [signature, ...steps] = (u.note ?? '').split('\n')
    return frame([...styled('tag', USE_CASE_TAG), ...styled('name', u.name), ...styled('mono', signature, 34), ...steps.flatMap((s) => styled('muted', s, 34))], 120)
  }
  const compositionFrame = (composition: NonNullable<Diagram['composition']>) => frame([...styled('mono', composition.name), ...noteLines(composition.note)], 120)
  return { NOTCH, portLabel, labelReach, adapterFrame, socketFrame, leafFrame, domainFrame, useCaseFrame, compositionFrame }
}
