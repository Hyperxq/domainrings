import type { Chain } from '../model/chain'
import { currentHexagon, hexagonBounds, hexagonTitle, type CompactLayout, type MapContextLayout, type MapLayout } from '../layout/map'
import { bandPath } from './band'
import { Ring } from './Ring'
import type { LayoutEdge, LayoutModel, LayoutNode, LayoutRing, LayoutText, Point } from '../layout/layout'
import type { LegendModel } from '../layout/legend'
import { SvgLegend } from './SvgLegend'
import { EDGE_LABEL, LINE_METRICS, SUBTITLE, TAG_GAP, TITLE } from '../layout/text'

const BOX_PAD_X = 12
// The domain block is plain text on the solid domain ring.
const FRAMELESS = new Set<LayoutNode['kind']>(['domainItem', 'note', 'portDecl', 'portLabel'])

const ELBOW = 5

/** Axis-aligned polyline with small rounded elbows; the last run stays straight so the arrowhead sits square. */
function orthogonalPath(points: Point[]): string {
  let d = `M${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, at, next] = [points[i - 1], points[i], points[i + 1]]
    const k = Math.min(ELBOW, Math.hypot(at.x - prev.x, at.y - prev.y) / 2, Math.hypot(next.x - at.x, next.y - at.y) / 2)
    const toward = (p: Point, q: Point) => ({ x: Math.sign(q.x - p.x) * k, y: Math.sign(q.y - p.y) * k })
    const inDir = toward(prev, at)
    const outDir = toward(at, next)
    d += ` L${at.x - inDir.x} ${at.y - inDir.y} Q${at.x} ${at.y} ${at.x + outDir.x} ${at.y + outDir.y}`
  }
  const end = points[points.length - 1]
  return `${d} L${end.x} ${end.y}`
}

/** An edge is part of the chain when both its ends are. Edge keys are `<node key>-><node key>`, a node key being
 * `<kind>:<ref>`; the use cases' edges to the domain end in the bare `domain`, reached whenever a use case is. */
function inChain(edge: LayoutEdge, refs: ReadonlySet<string> | undefined): boolean {
  if (!refs) return false
  const [from, to] = edge.key.split('->')
  const refOf = (nodeKey: string) => nodeKey.slice(nodeKey.indexOf(':') + 1)
  return refs.has(refOf(from)) && (to === 'domain' || refs.has(refOf(to)))
}

function Edge({ edge, chained }: { edge: LayoutEdge; chained: boolean }) {
  const marker = edge.kind === 'import' ? 'url(#arrow)' : undefined
  const chain = chained ? '' : undefined
  if (edge.insideTo === undefined) {
    return <path className={`edge edge-${edge.kind}`} data-chain={chain} d={orthogonalPath(edge.points)} markerEnd={marker} />
  }
  return (
    <>
      <path className={`edge edge-${edge.kind} on-domain`} data-chain={chain} d={orthogonalPath(edge.points.slice(0, edge.insideTo + 1))} />
      <path className={`edge edge-${edge.kind}`} data-chain={chain} d={orthogonalPath(edge.points.slice(edge.insideTo))} markerEnd={marker} />
    </>
  )
}

function EdgeLabel({ edge, chained }: { edge: LayoutEdge; chained: boolean }) {
  if (!edge.label || !edge.labelAt) return null
  return (
    <text className="edge-label" data-chain={chained ? '' : undefined} x={edge.labelAt.x} y={edge.labelAt.y} fontSize={EDGE_LABEL.size}>
      {edge.label}
    </text>
  )
}

function Node({ node, selected, target, chained, interactive }: { node: LayoutNode; selected: boolean; target: boolean; chained: boolean; interactive: boolean }) {
  const left = node.x - node.width / 2
  const top = node.y - node.height / 2
  const centered = node.align === 'center'
  const textX =
    centered ? node.x : node.align === 'start' ? left : node.align === 'end' ? left + node.width : left + (node.kind === 'aggregate' ? 8 : BOX_PAD_X)
  const textHeight = node.lines.reduce((h, l) => h + LINE_METRICS[l.style].height, 0)
  // An outline's tag sits in its top-left corner; every other node centres its text block vertically.
  let y = node.kind === 'aggregate' ? top + 4 : node.y - textHeight / 2
  return (
    <g
      className={`node node-${node.kind} tone-${node.tone}`}
      data-layer={node.layer}
      data-ref={node.ref}
      data-selected={selected ? '' : undefined}
      data-link-target={target ? '' : undefined}
      data-chain={chained ? '' : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `Edit ${node.lines.map((l) => l.text).join(' ')}` : undefined}
      transform={node.rotation ? `rotate(${node.rotation} ${node.x} ${node.y})` : undefined}
    >
      {node.kind === 'aggregate' ? (
        <rect className="aggregate-outline" x={left} y={top} width={node.width} height={node.height} rx={6} />
      ) : (
        !FRAMELESS.has(node.kind) && (
          <rect className="box" x={left} y={top} width={node.width} height={node.height} rx={node.kind === 'port' ? 10 : 8} />
        )
      )}
      <text className={centered ? 'centered' : node.align === 'end' ? 'end' : undefined}>
        {node.lines.map((line, i) => {
          const m = LINE_METRICS[line.style]
          const lineY = y + m.height / 2
          y += m.height
          return (
            <tspan key={i} className={`line-${line.style}`} x={textX} y={lineY} fontSize={m.size}>
              {line.tag && (
                <>
                  <tspan className="inline-tag" fontSize={LINE_METRICS.tag.size}>{line.tag}</tspan>
                  <tspan dx={TAG_GAP}>{line.text}</tspan>
                </>
              )}
              {!line.tag && line.text}
            </tspan>
          )
        })}
      </text>
    </g>
  )
}

function Heading({ text }: { text: LayoutText }) {
  return (
    <text className={`diagram-${text.style}`} x={text.x} y={text.y} fontSize={text.style === 'title' ? TITLE.size : SUBTITLE.size}>
      {text.text}
    </text>
  )
}


function Defs({ rings }: { rings: LayoutRing[] }) {
  return (
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path className="arrow-head" d="M0 0L10 5L0 10z" />
      </marker>
      {rings.map((ring) => (
        // The glow colour follows each ring's stroke; flood-color comes from CSS per role.
        <filter key={ring.role} id={`glow-${ring.role}`} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow className={`glow-${ring.role}`} dx="0" dy="0" stdDeviation="6" floodOpacity="0.35" />
        </filter>
      ))}
    </defs>
  )
}

interface HexagonBodyProps {
  model: LayoutModel
  showGuides: boolean
  selected: string | null
  /** In link mode, the refs the selection can be linked to. */
  linkTargets: ReadonlySet<string>
  /** The refs of this hexagon that belong to the emphasized dependency chain; none when nothing is emphasized. */
  chain: ReadonlySet<string> | undefined
  /** False for a non-current hexagon in a multi-hexagon map: its rings and nodes carry no tabIndex/role of their own — the wrapping group is the one control (ADR-05). */
  interactive: boolean
}

/** One hexagon's rings, edges and nodes — everything but the shared `<defs>` and the once-per-map legend. */
function HexagonBody({ model, showGuides, selected, linkTargets, chain, interactive }: HexagonBodyProps) {
  return (
    <>
      {model.rings.map((ring, i) => <Ring key={ring.key} ring={ring} shape={model.shape} inner={model.rings[i + 1]} interactive={interactive} />)}
      {showGuides && model.guides.map((g, k) => <line key={k} className="guide" x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} />)}
      {model.edges.map((edge) => <Edge key={edge.key} edge={edge} chained={inChain(edge, chain)} />)}
      {model.nodes.map((node) => <Node key={node.key} node={node} selected={node.ref === selected} target={linkTargets.has(node.ref)} chained={!!chain?.has(node.ref)} interactive={interactive} />)}
      {model.edges.map((edge) => <EdgeLabel key={edge.key} edge={edge} chained={inChain(edge, chain)} />)}
      {model.texts.map((text) => <Heading key={text.key} text={text} />)}
    </>
  )
}

/** A non-current hexagon on a large map: its outer silhouette, title and element count, none of its rings or nodes. */
function CompactBody({ compact, title, linkTargets, chain }: { compact: CompactLayout; title: string; linkTargets: ReadonlySet<string>; chain: ReadonlySet<string> | undefined }) {
  const { radius, size, elements, label } = compact
  const outline = { halfWidth: (radius * Math.sqrt(3)) / 2, straight: radius / 2, apex: radius }
  return (
    <>
      <path className="ring ring-outer" d={bandPath('hexagon', outline)} />
      <text className="compact-title" y={-size * 0.4} fontSize={size}>{label}</text>
      <text className="compact-count" y={size * 0.8} fontSize={size * 0.85}>{elements} {elements === 1 ? 'element' : 'elements'}</text>
      {compact.ports.map((port) => {
        const target = linkTargets.has(port.id)
        return (
          <g
            key={port.id}
            className="node node-port compact-port"
            data-ref={port.id}
            data-link-target={target ? '' : undefined}
            data-chain={chain?.has(port.id) ? '' : undefined}
            tabIndex={target ? 0 : undefined}
            role={target ? 'button' : undefined}
            aria-label={target ? `${port.name} on ${title}` : undefined}
          >
            <circle cx={port.at.x} cy={port.at.y} r={size * 0.4} />
          </g>
        )
      })}
    </>
  )
}

/** The current hexagon's own outer silhouette, scaled outward slightly, as the visible "this one is current" cue (FOCUS-01). */
function HexCue({ model }: { model: LayoutModel }) {
  return <path className="hex-cue" data-cue="" aria-hidden="true" transform="scale(1.06)" d={bandPath(model.shape, model.rings[0])} />
}

const NO_TARGETS = new Set<string>()

/** One `M...Z` subpath per loop — several loops in one `<path>` drawn `fill-rule="evenodd"` is exactly how a
 * split context or a hole around a foreign hexagon is meant to paint (ADR-04). */
function hullPath(loops: Point[][]): string {
  return loops.map((loop) => `M${loop.map((p) => `${p.x} ${p.y}`).join('L')}Z`).join(' ')
}

/** One outlined region per context (CB-01, CB-02) — inert, painted below every hexagon group. */
function Hulls({ contexts }: { contexts: MapContextLayout[] }) {
  if (!contexts.length) return null
  return (
    <g data-hulls="" aria-hidden="true">
      {contexts.map((c) => (
        <path key={c.id} className="hull" data-hull={c.id} fillRule="evenodd" d={hullPath(c.loops)} />
      ))}
    </g>
  )
}

/** One name/placeholder chip per context (CB-01, CB-03) — inert, painted above every hexagon group and link. */
function Chips({ contexts }: { contexts: MapContextLayout[] }) {
  return (
    <>
      {contexts.map((c) => (
        <text key={c.id} className="chip" data-chip={c.id} aria-hidden="true" x={c.chip.x} y={c.chip.y} fontSize={c.size}>
          {c.label}
        </text>
      ))}
    </>
  )
}

interface MapDiagramProps {
  map: MapLayout
  legend: LegendModel
  showGuides: boolean
  /** The current hexagon's id — the only one rendered as editable; every other hexagon is one click-to-focus control. */
  focus: string
  selected: string | null
  /** In link mode, the refs the selection can be linked to. */
  linkTargets: ReadonlySet<string>
  /** In link mode, valid cross-hexagon port targets on hexagons OTHER than the current one, keyed by hexagon id
   * (decision 7387) — a port id alone is not enough, since ids collide across hexagons by construction. */
  crossLinkTargets: ReadonlyMap<string, ReadonlySet<string>>
  /** The hovered layer, scoped to the current hexagon only (CANVAS-03). */
  hovered: string | null
  /** The emphasized dependency chain of the selection; everything outside it dims (styles.css). */
  chain?: Chain
}

/** Composes every hexagon of a map into one SVG: one `<defs>`, one `<g data-hex>` per hexagon, the map's links
 * drawn above them, an optional map title, and the legend once — under the current hexagon. */
export function MapDiagram({ map, legend, showGuides, focus, selected, linkTargets, crossLinkTargets, hovered, chain }: MapDiagramProps) {
  const first = map.hexagons[0]
  const current = currentHexagon(map, focus)
  return (
    <>
      <Defs rings={first.model.rings} />
      <Hulls contexts={map.contexts} />
      {map.hexagons.map((hex) => {
        const isCurrent = hex.id === focus
        const title = hexagonTitle(hex.model)
        const chained = chain?.elements.get(hex.id)
        return (
          <g
            key={hex.id}
            data-hex={hex.id}
            transform={`translate(${hex.centre.x} ${hex.centre.y})`}
            aria-current={isCurrent ? 'true' : undefined}
            role={isCurrent ? 'group' : 'button'}
            tabIndex={isCurrent ? undefined : 0}
            aria-label={isCurrent ? title : `Make ${title} the current hexagon`}
            data-hover={isCurrent && hovered ? hovered : undefined}
            data-chain={chained ? '' : undefined}
          >
            {!isCurrent && <title>{title}</title>}
            {hex.compact ? (
              <CompactBody compact={hex.compact} title={title} linkTargets={crossLinkTargets.get(hex.id) ?? NO_TARGETS} chain={chained} />
            ) : (
              <HexagonBody
                model={hex.model}
                showGuides={showGuides}
                selected={isCurrent ? selected : null}
                linkTargets={isCurrent ? linkTargets : (crossLinkTargets.get(hex.id) ?? NO_TARGETS)}
                chain={chained}
                interactive={isCurrent}
              />
            )}
            {isCurrent && map.hexagons.length > 1 && <HexCue model={hex.model} />}
          </g>
        )
      })}
      {map.links.map((link) => (
        <path key={link.id} className="map-link" data-map-link="" data-chain={chain?.links.has(link.id) ? '' : undefined} aria-hidden="true" d={orthogonalPath(link.points)} markerEnd="url(#arrow)" />
      ))}
      {map.links.map(
        (link) =>
          link.pattern &&
          link.label && (
            <text
              key={link.id}
              className="link-pattern-label"
              data-link-pattern=""
              aria-hidden="true"
              x={link.label.at.x}
              y={link.label.at.y}
              transform={link.label.vertical ? `rotate(-90 ${link.label.at.x} ${link.label.at.y})` : undefined}
              fontSize={EDGE_LABEL.size}
            >
              {link.pattern}
            </text>
          ),
      )}
      <Chips contexts={map.contexts} />
      {map.title && <text data-map-title="" className="diagram-title" x={map.title.x} y={map.title.y} fontSize={map.title.size ?? TITLE.size}>{map.title.text}</text>}
      <SvgLegend legend={legend} bounds={hexagonBounds(current)} />
    </>
  )
}


