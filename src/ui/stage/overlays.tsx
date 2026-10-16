import { useMemo } from 'react'
import type { LayoutNode, LayoutText } from '../../layout/layout'
import { unionBox, type Box, type Point } from '../../layout/geometry'
import { canCompact, ellipsize } from '../../layout/compactHexagon'
import { hexagonBounds } from '../../layout/lattice'
import { boxLabels, boxObstacles, type BoxLabel } from '../../layout/boxLabels'
import { TITLE } from '../../layout/text'
import { growAnchor, hexagonTitle, type MapContextLayout, type MapHexagonLayout, type MapLayout } from '../../layout/map'
import { freeSides, UNTITLED_HEXAGON, type Destination } from '../../model/map'
import type { HexaMap, Wall } from '../../model/schema'
import { hullPath } from '../../render/Diagram'
import { ChoiceMenu } from '../ChoiceMenu'
import { Icon } from '../Icon'
import { centreZones, cullLabels, touches } from './labelCulling'
import { labelTextWidth } from './labelWidth'
import type { Reveal } from './useContextReveal'

/** Half the side "+" button's 24px circle. */
const SIDE_PLUS_RADIUS = 12
/** Half the Expand / Collapse toggle's 24px circle. */
const EXPAND_TOGGLE_RADIUS = 12
/** Lowercase, hyphenated compass names for the grow "+" aria-label ("Add hexagon to the {…} of {title}"). */
const SIDE_NAME: Record<Wall, string> = { e: 'east', se: 'south-east', sw: 'south-west', w: 'west', nw: 'north-west', ne: 'north-east' }

/** The smallest on-screen size a hexagon's title is read at, in px. */
export const TITLE_FLOOR_PX = 12
/** Whether the SVG titles are too small to read at `scale`, so the overlay draws them instead. */
export const titlesOverlaid = (scale: number) => TITLE.size * scale < TITLE_FLOOR_PX

/** Whether the map title, which grows with the context chips, renders under the floor at `scale`. */
export const mapTitleOverlaid = (title: LayoutText, scale: number) => (title.size ?? TITLE.size) * scale < TITLE_FLOOR_PX

/** Detail by zoom: far shows context outlines and names with hexagon names only, mid adds box labels, near shows the
 * hexagons in full and fades the context outline and name. */
export const FAR_BELOW_SCALE = 0.25
export const NEAR_FROM_SCALE = 0.5
export const zoomLevel = (scale: number) => (scale < FAR_BELOW_SCALE ? 'far' : scale < NEAR_FROM_SCALE ? 'mid' : 'near')

/** At mid a 14px box name renders under 7px, which no one reads, so the labels replace it. Nearer it is legible and the
 * labels would only cover the diagram; farther out the boxes are too small to name. */
export const boxLabelsOverlaid = (scale: number) => zoomLevel(scale) === 'mid'

const BOX_LABEL_PX = 11
const BOX_LABEL_PAD = { x: 5, y: 2 }
const BOX_LABEL_BORDER = 1
const BOX_LABEL_GAP = 3
/** Half the side of the zone around each box's centre that no other label may cover. */
const BOX_CENTRE_CLEARANCE = 6
const BOX_LABEL_HEIGHT = BOX_LABEL_PX * 1.3 + 2 * (BOX_LABEL_PAD.y + BOX_LABEL_BORDER)

type ToScreen = (p: Point) => Point

const growChoices = (context: string) => [
  { id: 'same' as const, label: `Hexagon in ${context}` },
  { id: 'new' as const, label: 'Hexagon in a new bounded context' },
]

/** The name of each revealed context, centred on its region and held to the region's on-screen width (two lines at
 * most, then an ellipsis) so neighbouring names can't overlap. It is set like the context chip: the same face, and a
 * size that follows the map's zoom. A blur reveal also frosts the region itself: an HTML `backdrop-filter` clipped to
 * the hull's own path, since SVG elements get no backdrop-filter in Firefox or Safari and a `foreignObject` inside a
 * transformed, scaled SVG is unreliable in WebKit. */
export function ContextReveals({
  contexts,
  reveals,
  mapToScreen,
  scale,
}: {
  contexts: MapContextLayout[]
  reveals: (contextId: string) => Reveal | undefined
  mapToScreen: ToScreen
  scale: number
}) {
  return contexts.map((c) => {
    const reveal = reveals(c.id)
    if (!reveal) return null
    const loops = c.loops.map((loop) => loop.map(mapToScreen))
    const box = unionBox(loops.flat().map((p): Box => ({ x: p.x, y: p.y, width: 0, height: 0 })))
    return (
      <div key={c.id} className="context-reveal" data-context-reveal={c.id} aria-hidden="true">
        {reveal === 'blur' && <div className="context-blur" style={{ clipPath: `path(evenodd, '${hullPath(loops)}')` }} />}
        <span className="context-name" style={{ left: box.x + box.width / 2, top: box.y + box.height / 2, maxWidth: box.width, fontSize: c.size * scale }}>
          {c.label}
        </span>
      </div>
    )
  })
}

const TITLE_HEIGHT = TITLE_FLOOR_PX * 1.3
const TITLE_GAP = 3

/** Each hexagon's title as the overlay draws it, from the full name. Up to mid it is shortened with an ellipsis to its
 * hexagon's on-screen width and left out only when not even one letter fits. Far out those widths are a few pixels,
 * so the names run free and collide with each other instead: the larger hexagon keeps its name, the other is dropped.
 * `rect` is the screen box it covers. */
function hexagonTitleOverlays(model: MapLayout, mapToScreen: ToScreen, scale: number) {
  if (!titlesOverlaid(scale)) return []
  const far = zoomLevel(scale) === 'far'
  const titles = model.hexagons.flatMap((h) => {
    const title = h.model.texts.find((t) => t.key === 'title')
    const name = h.compact ? hexagonTitle(h.model) : title?.text
    if (!name) return []
    const width = hexagonBounds(h).width * scale
    const label = far ? name : ellipsize(name, (candidate) => labelTextWidth(candidate, TITLE_FLOOR_PX) <= width)
    const textWidth = labelTextWidth(label, TITLE_FLOOR_PX)
    if (!far && textWidth > width) return []
    // Full hexagons anchor at the heading's own spot (its left edge), compact ones on their centre.
    const at = mapToScreen(h.compact ? { x: h.centre.x, y: h.centre.y - h.compact.size * 0.4 } : { x: h.centre.x + title!.x, y: h.centre.y + title!.y })
    const rect = { x: h.compact ? at.x - textWidth / 2 : at.x, y: at.y - TITLE_HEIGHT, width: textWidth, height: TITLE_HEIGHT }
    return [{ id: h.id, label, at, width: far ? textWidth : width, rect, compact: !!h.compact, area: width * hexagonBounds(h).height * scale }]
  })
  if (!far) return titles
  const shown = cullLabels(titles.map((t) => ({ key: t.id, rect: t.rect, tier: 0, area: t.area })), TITLE_GAP)
  return titles.filter((t) => shown.has(t.id))
}

/** Every hexagon's title at a readable size over the map, once zoomed out far enough that the SVG ones are not. */
export function HexagonTitles({ model, mapToScreen, scale }: { model: MapLayout; mapToScreen: ToScreen; scale: number }) {
  return hexagonTitleOverlays(model, mapToScreen, scale).map(({ id, label, at, width, compact }) => (
    <span key={id} className="hexagon-title" data-hexagon-title-overlay={id} aria-hidden="true" style={{ left: at.x, top: at.y, maxWidth: width, fontSize: TITLE_FLOOR_PX, ...(!compact && { transform: 'translate(0, -100%)' }) }}>
      {label}
    </span>
  ))
}

const quoted = (value: string) => `"${value.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\a ')}"`

/** One rule hiding the SVG text of the labelled boxes only, so a box without a label keeps its name. It lives outside
 * the diagram tree: zooming rewrites this rule, never the diagram. An export keeps every text. */
export const hiddenTextRule = (labelled: readonly Pick<BoxLabel, 'hexagonId' | 'kind' | 'ref'>[]) =>
  labelled.length
    ? `${labelled.map((l) => `.canvas:not(.exporting) [data-hex=${quoted(l.hexagonId)}] .node-${l.kind}[data-ref=${quoted(l.ref)}] text`).join(',')}{display:none}`
    : ''

/** Every box's name at a readable size over the map, once the SVG text is too small to read. A name may run past its
 * box and over other boxes' edges, but never over another box's centre or another name; they are placed by priority (use cases, ports and the aggregate, then
 * adapters, actors and externals, then the rest of the domain), and the selected and hovered boxes of the current
 * hexagon always keep theirs, over anything. Only a labelled box loses its SVG text. Placement works on the layout and
 * the viewport alone. */
export function BoxLabels({ model, map, hexId, forced, mapToScreen, scale, size }: { model: MapLayout; map: HexaMap; hexId: string; forced: readonly (string | null)[]; mapToScreen: ToScreen; scale: number; size: { width: number; height: number } }) {
  const labels = useMemo(() => boxLabels(model, map), [model, map])
  const obstacles = useMemo(() => boxObstacles(model, map), [model, map])
  if (!boxLabelsOverlaid(scale)) return null
  const placed = labels.flatMap((label) => {
    const at = mapToScreen(label)
    const width = labelTextWidth(label.text, BOX_LABEL_PX) + 2 * (BOX_LABEL_PAD.x + BOX_LABEL_BORDER)
    const rect = { x: at.x - width / 2, y: at.y - BOX_LABEL_HEIGHT / 2, width, height: BOX_LABEL_HEIGHT }
    const onScreen = !size.width || (rect.x < size.width && rect.x + width > 0 && rect.y < size.height && rect.y + rect.height > 0)
    return onScreen ? [{ label, at, candidate: { key: label.key, owner: label.owner, rect, tier: label.tier, area: label.area, forced: label.hexagonId === hexId && forced.includes(label.ref) } }] : []
  })
  const screenBoxes = obstacles.map(({ owner, rect }) => {
    const from = mapToScreen(rect)
    return { owner, rect: { ...from, width: rect.width * scale, height: rect.height * scale } }
  })
  const titles = hexagonTitleOverlays(model, mapToScreen, scale).map(({ id, rect }) => ({ owner: `title:${id}`, rect }))
  const shown = cullLabels(placed.map((p) => p.candidate), BOX_LABEL_GAP, [...centreZones(screenBoxes, BOX_CENTRE_CLEARANCE), ...titles])
  const visible = placed.filter((p) => shown.has(p.label.key))
  return (
    <>
      <style>{hiddenTextRule(visible.map((p) => p.label))}</style>
      {visible.map(({ label, at }) => (
        <span key={label.key} className="box-label" data-box-label={label.key} aria-hidden="true" style={{ left: at.x, top: at.y, fontSize: BOX_LABEL_PX }}>
          {label.text}
        </span>
      ))}
    </>
  )
}

/** The map title at a readable size over the canvas, once the SVG one renders under the floor. It sits at the title's
 * left edge and baseline, like the hexagon headings, and rises above any hexagon title it would otherwise cover. */
export function MapTitle({ model, mapToScreen, scale }: { model: MapLayout; mapToScreen: ToScreen; scale: number }) {
  const { title } = model
  if (!title || !mapTitleOverlaid(title, scale)) return null
  const at = mapToScreen({ x: title.x, y: title.y })
  const titles = hexagonTitleOverlays(model, mapToScreen, scale).map((t) => t.rect)
  const rect = { x: at.x, y: at.y - TITLE_HEIGHT, width: labelTextWidth(title.text, TITLE_FLOOR_PX), height: TITLE_HEIGHT }
  const padded = () => ({ x: rect.x - TITLE_GAP, y: rect.y - TITLE_GAP, width: rect.width + 2 * TITLE_GAP, height: rect.height + 2 * TITLE_GAP })
  for (let hit = titles.find((t) => touches(padded(), t)); hit; hit = titles.find((t) => touches(padded(), t))) rect.y = hit.y - TITLE_GAP - TITLE_HEIGHT
  return (
    <span className="hexagon-title" data-map-title-overlay="" aria-hidden="true" style={{ left: at.x, top: rect.y + TITLE_HEIGHT, fontSize: TITLE_FLOOR_PX, transform: 'translate(0, -100%)', textAlign: 'left' }}>
      {title.text}
    </span>
  )
}

/** One "+" per free side of the current hexagon, each opening the choice of context to grow into. */
export function GrowButtons({
  model,
  hex,
  scale,
  mapToScreen,
  title,
  contextLabel,
  onGrow,
}: {
  model: MapLayout
  hex: MapHexagonLayout
  scale: number
  mapToScreen: ToScreen
  title: string
  contextLabel: string
  onGrow: (side: Wall, context: Destination) => void
}) {
  const boxes = model.hexagons.map(hexagonBounds)
  return freeSides(model, hex.cell).map((side) => {
    const at = mapToScreen(growAnchor(hex, side, model.pitch, SIDE_PLUS_RADIUS / scale, boxes))
    return (
      // No `transform` here (e.g. translate to centre): ChoiceMenu's own menu is `position: fixed` under the
      // trigger, whose containing block a transformed ancestor would hijack — the half-button-size offset is
      // baked into left/top instead, matching .plus's own 24px circle.
      <span key={side} className="side-plus" style={{ left: at.x - SIDE_PLUS_RADIUS, top: at.y - SIDE_PLUS_RADIUS }}>
        <ChoiceMenu
          label={<Icon name="plus" />}
          ariaLabel={`Add hexagon to the ${SIDE_NAME[side]} of ${title || UNTITLED_HEXAGON}`}
          choices={growChoices(contextLabel)}
          onChoose={(context) => onGrow(side, context)}
        />
      </span>
    )
  })
}

/** An Expand / Collapse toggle on each hexagon's top-right corner, once the map is large enough to compact. */
export function ExpandToggles({ model, currentId, mapToScreen, onToggle }: { model: MapLayout; currentId: string; mapToScreen: ToScreen; onToggle: (id: string) => void }) {
  if (!canCompact(model.hexagons.length)) return null
  return model.hexagons.map((h) => {
    const box = hexagonBounds(h)
    const corner = mapToScreen({ x: box.x + box.width, y: box.y })
    const name = hexagonTitle(h.model)
    const current = h.id === currentId
    return (
      <button
        key={h.id}
        type="button"
        className="expand-toggle"
        // Like every canvas overlay control: a press on it neither pans nor drops the hover, and exports leave it out.
        data-plus=""
        style={{ left: corner.x - EXPAND_TOGGLE_RADIUS, top: corner.y - EXPAND_TOGGLE_RADIUS }}
        aria-label={`${h.compact ? 'Expand' : 'Collapse'} ${name}`}
        title={current ? 'The current hexagon is always expanded' : h.compact ? 'Expand' : 'Collapse'}
        disabled={current}
        onClick={() => onToggle(h.id)}
      >
        <Icon name={h.compact ? 'expand' : 'shrink'} />
      </button>
    )
  })
}

/** The "Link to…" chip hanging off a selected node's top-right corner. */
export function LinkChip({ node, name, toScreen, onLink }: { node: LayoutNode; name: string; toScreen: ToScreen; onLink: () => void }) {
  const corner = toScreen({ x: node.x + node.width / 2, y: node.y - node.height / 2 })
  return (
    <button type="button" className="link-chip" data-plus="" style={{ left: corner.x, top: corner.y }} aria-label={`Link ${name} to…`} onClick={onLink}>
      Link to…
    </button>
  )
}
