import type { CompactLayout } from '../layout/compactHexagon'
import type { LayoutEdge, LayoutModel, LayoutNode, LayoutText } from '../layout/layout'
import type { Point } from '../layout/geometry'
import { EDGE_LABEL, LINE_METRICS, SUBTITLE, TAG_GAP, TITLE } from '../layout/text'
import { bandPath } from './band'
import { Ring } from './Ring'

const BOX_PAD_X = 12
// The domain block is plain text on the solid domain ring.
const FRAMELESS = new Set<LayoutNode['kind']>(['domainItem', 'note', 'portDecl', 'portLabel'])

const ELBOW = 5

/** Axis-aligned polyline with small rounded elbows; the last run stays straight so the arrowhead sits square. */
export function orthogonalPath(points: Point[]): string {
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
export function HexagonBody({ model, showGuides, selected, linkTargets, chain, interactive }: HexagonBodyProps) {
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
export function CompactBody({ compact, title, linkTargets, chain }: { compact: CompactLayout; title: string; linkTargets: ReadonlySet<string>; chain: ReadonlySet<string> | undefined }) {
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
export function HexCue({ model }: { model: LayoutModel }) {
  return <path className="hex-cue" data-cue="" aria-hidden="true" transform="scale(1.06)" d={bandPath(model.shape, model.rings[0])} />
}
