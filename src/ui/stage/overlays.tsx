import type { LayoutNode, Point } from '../../layout/layout'
import { canCompact, growAnchor, hexagonBounds, hexagonTitle, type MapHexagonLayout, type MapLayout } from '../../layout/map'
import { freeSides, UNTITLED_HEXAGON, type Destination } from '../../model/map'
import type { Wall } from '../../model/schema'
import { ChoiceMenu } from '../ChoiceMenu'
import { Icon } from '../Icon'

/** Half the side "+" button's 24px circle. */
const SIDE_PLUS_RADIUS = 12
/** Half the Expand / Collapse toggle's 24px circle. */
const EXPAND_TOGGLE_RADIUS = 12
/** Lowercase, hyphenated compass names for the grow "+" aria-label ("Add hexagon to the {…} of {title}"). */
const SIDE_NAME: Record<Wall, string> = { e: 'east', se: 'south-east', sw: 'south-west', w: 'west', nw: 'north-west', ne: 'north-east' }

type ToScreen = (p: Point) => Point

const growChoices = (context: string) => [
  { id: 'same' as const, label: `Hexagon in ${context}` },
  { id: 'new' as const, label: 'Hexagon in a new bounded context' },
]

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
  return freeSides(model, hex.cell).map((side) => {
    const at = mapToScreen(growAnchor(hex, side, model.pitch, SIDE_PLUS_RADIUS / scale))
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
  const a = ((node.rotation ?? 0) * Math.PI) / 180
  const [c, s] = [Math.abs(Math.cos(a)), Math.abs(Math.sin(a))]
  const corner = toScreen({ x: node.x + (node.width / 2) * c + (node.height / 2) * s, y: node.y - (node.width / 2) * s - (node.height / 2) * c })
  return (
    <button type="button" className="link-chip" data-plus="" style={{ left: corner.x, top: corner.y }} aria-label={`Link ${name} to…`} onClick={onLink}>
      Link to…
    </button>
  )
}
