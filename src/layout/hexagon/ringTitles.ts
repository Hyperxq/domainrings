import { HEXAGONAL_KIND } from '../../model/kinds'
import type { Diagram } from '../../model/schema'
import type { LayoutRing } from '../layout'
import { SQRT3, type Outline } from '../outline'
import { DOMAIN_TITLE, measure, RING_LABEL, RING_SUBTITLE } from '../text'
import { LABEL_PAD_X } from './spacing'

const LABEL_INSET = 8
const SUBTITLE_GAP = 4

export function ringTitles(d: Diagram) {
  // Layer titles: the kind's defaults, overridden per diagram; an empty override falls back to the default. Layer
  // titles are uppercase and tracked; the domain's is the one big sentence-case heading.
  const config = HEXAGONAL_KIND
  const last = config.rings.length - 1
  const titleMetrics = (i: number) => (i === last ? DOMAIN_TITLE : RING_LABEL)
  const titleLine = (i: number) => titleMetrics(i).size + 4
  const ringTitle = (i: number) => {
    const spec = config.rings[i]
    const override = d.layers?.[spec.role]
    const title = override?.title?.trim() || spec.name
    return { title: i === last ? title : title.toUpperCase(), subtitle: override?.subtitle?.trim() || spec.subtitle }
  }
  const titleWidth = (i: number) => {
    const { title, subtitle } = ringTitle(i)
    return Math.max(measure(title, titleMetrics(i)), subtitle ? measure(subtitle, RING_SUBTITLE) : 0)
  }
  const titleHeight = (i: number) => titleLine(i) + (ringTitle(i).subtitle ? SUBTITLE_GAP + RING_SUBTITLE.size + 4 : 0)
  // One title depth for every ring: the depth under a hexagon's vertex where the widest title fits the slope.
  const titleDepth = Math.max(LABEL_INSET, ...config.rings.map((_, i) => (titleWidth(i) / 2 + LABEL_PAD_X) / SQRT3))

  /** The solved outlines as the diagram's rings, each with its title block tucked `titleDepth` under its top vertex. */
  const rings = (outlines: Outline[]): LayoutRing[] =>
    config.rings.map((spec, i) => ({
      key: `ring:${spec.role}`,
      role: spec.role,
      ...ringTitle(i),
      ...outlines[i],
      labelAt: { x: 0, y: -outlines[i].apex + titleDepth + titleLine(i) / 2 },
      titleBox: { x: -titleWidth(i) / 2, y: -outlines[i].apex + titleDepth, width: titleWidth(i), height: titleHeight(i) },
    }))
  return { titleWidth, titleHeight, titleDepth, rings }
}
