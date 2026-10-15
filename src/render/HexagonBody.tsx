import type { CompactLayout } from '../layout/compactHexagon'
import type { LayoutEdge, LayoutModel, LayoutNode, LayoutText } from '../layout/layout'
import type { Point } from '../layout/geometry'
import { EDGE_LABEL, LINE_METRICS, SUBTITLE, TAG_GAP, TITLE } from '../layout/text'
import { bandPath } from './band'
import { NOTE_INSET, NOTE_POPOVER_ID, NoteMarker } from './NoteMarker'
import { Ring } from './Ring'
import { roundedPath } from './roundedPath'
import { ThreadDots, threadStyle } from './ThreadDots'

const BOX_PAD_X = 12
// The domain block is plain text on the solid domain ring.
const FRAMELESS = new Set<LayoutNode['kind']>(['domainItem'])
// A note belongs to the element's box, not to its outline, its declaration or its overview label.
const NOTE_CARRIERS = new Set<LayoutNode['kind']>(['actor', 'adapter', 'port', 'useCase', 'external', 'domainItem', 'composition'])

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
  const marker = edge.kind === 'import' ? `url(#arrow${edge.thread ? `-thread-${edge.thread.slot}` : ''})` : undefined
  const chain = chained ? '' : undefined
  // A label with no room on the canvas is still there on hover.
  const title = edge.label && !edge.labelAt ? <title>{edge.label}</title> : null
  const thread = edge.thread ? { 'data-thread': edge.thread.id, style: threadStyle(edge.thread.slot) } : {}
  // An edge that runs wholly on the domain fill keeps its thread colour; one with no thread takes the domain's own ink.
  if (edge.intoDomain === 0) {
    return <path className={`edge edge-${edge.kind}${edge.thread ? '' : ' on-domain'}`} data-chain={chain} {...thread} d={roundedPath(edge.points)} markerEnd={edge.thread ? marker : 'url(#arrow-on-domain)'}>{title}</path>
  }
  if (edge.intoDomain === undefined) {
    return <path className={`edge edge-${edge.kind}`} data-chain={chain} {...thread} d={roundedPath(edge.points)} markerEnd={marker}>{title}</path>
  }
  return (
    <>
      <path className={`edge edge-${edge.kind}`} data-chain={chain} {...thread} d={roundedPath(edge.points.slice(0, edge.intoDomain + 1))}>{title}</path>
      <path className={`edge edge-${edge.kind} on-domain`} data-chain={chain} d={roundedPath(edge.points.slice(edge.intoDomain))} markerEnd="url(#arrow-on-domain)" />
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

function Node({ node, selected, target, chained, interactive, noted, planned }: { node: LayoutNode; selected: boolean; target: boolean; chained: boolean; interactive: boolean; noted: boolean; planned: boolean }) {
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
      className={`node node-${node.kind} tone-${node.tone}${planned ? ' planned' : ''}`}
      data-layer={node.layer}
      data-ref={node.ref}
      data-selected={selected ? '' : undefined}
      data-link-target={target ? '' : undefined}
      data-chain={chained ? '' : undefined}
      data-threads={node.threads?.map((t) => t.id).join(' ')}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? `Edit ${node.lines.map((l) => l.text).join(' ')}` : undefined}
      aria-describedby={selected && noted ? NOTE_POPOVER_ID : undefined}
    >
      {node.kind === 'aggregate' ? (
        <rect className="aggregate-outline" x={left} y={top} width={node.width} height={node.height} rx={6} />
      ) : (
        !FRAMELESS.has(node.kind) && (
          <rect className="box" x={left} y={top} width={node.width} height={node.height} rx={node.kind === 'port' ? 10 : 8} />
        )
      )}
      {node.rule !== undefined && <line className="card-rule" x1={left + 10} x2={left + node.width - 10} y1={top + node.rule} y2={top + node.rule} />}
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
              {line.right && (
                <tspan className="line-right" x={left + node.width} textAnchor="end">
                  {line.right}
                </tspan>
              )}
            </tspan>
          )
        })}
      </text>
      {node.threads && <ThreadDots node={node} />}
      {noted && NOTE_CARRIERS.has(node.kind) && <NoteMarker x={left + node.width - NOTE_INSET} y={top + NOTE_INSET} />}
    </g>
  )
}

function Heading({ text }: { text: LayoutText }) {
  return (
    <text className={`diagram-${text.style}`} data-hexagon-title={text.style === 'title' ? '' : undefined} x={text.x} y={text.y} fontSize={text.style === 'title' ? TITLE.size : SUBTITLE.size}>
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
  /** The refs of this hexagon that carry a note, with its text. */
  notes: ReadonlyMap<string, string>
  /** The refs of this hexagon that are planned. */
  planned: ReadonlySet<string>
}

/** One hexagon's rings, edges and nodes — everything but the shared `<defs>` and the once-per-map legend. */
export function HexagonBody({ model, showGuides, selected, linkTargets, chain, interactive, notes, planned }: HexagonBodyProps) {
  return (
    <>
      {model.rings.map((ring, i) => <Ring key={ring.key} ring={ring} shape={model.shape} inner={model.rings[i + 1]} interactive={interactive} />)}
      {model.region && <path className="domain-region" d={bandPath(model.shape, model.region)} aria-hidden="true" />}
      {showGuides && model.guides.map((g, k) => <line key={k} className="guide" x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} />)}
      {showGuides && model.corridors.map((c, k) => <path key={`corridor-${k}`} className="guide" fill="none" d={bandPath(model.shape, c)} aria-hidden="true" />)}
      {model.edges.map((edge) => <Edge key={edge.key} edge={edge} chained={inChain(edge, chain)} />)}
      {model.nodes.map((node) => <Node key={node.key} node={node} selected={node.ref === selected} target={linkTargets.has(node.ref)} chained={!!chain?.has(node.ref)} interactive={interactive} noted={notes.has(node.ref)} planned={planned.has(node.ref)} />)}
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
      <text className="compact-title" data-hexagon-title="" y={-size * 0.4} fontSize={size}>{label}</text>
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
