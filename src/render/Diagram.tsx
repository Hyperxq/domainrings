import type { ReactNode } from 'react'
import type { Shape } from '../model/kinds'
import { bandPath } from './band'
import type { LayoutEdge, LayoutModel, LayoutNode, LayoutRing, LayoutText, Point } from '../layout/layout'
import type { Box } from '../layout/layout'
import { LEGEND_GAP, LEGEND_HEADING, LEGEND_PAD, LEGEND_ROW, LEGEND_SECTIONS, LEGEND_SWATCH, legendSize, type LegendModel } from '../layout/legend'
import { DOMAIN_TITLE, EDGE_LABEL, LINE_METRICS, RING_LABEL, RING_SUBTITLE, SUBTITLE, TAG_GAP, TITLE } from '../layout/text'

const SUBTITLE_GAP = 4
const BOX_PAD_X = 12
// The domain block is plain text on the solid domain ring.
const FRAMELESS = new Set<LayoutNode['kind']>(['domainItem', 'note', 'portDecl', 'portLabel'])

function Ring({ ring, shape, inner }: { ring: LayoutRing; shape: Shape; inner?: LayoutRing }) {
  const innermost = !inner
  const className = `ring ring-${ring.role}`
  const ref = `layer:${ring.role}`
  return (
    <>
      <path
        className={className}
        d={bandPath(shape, ring, inner)}
        fillRule="evenodd"
        data-band={ring.role}
        data-layer={ring.role}
        data-ref={ref}
        tabIndex={0}
        role="group"
        aria-label={ring.title}
      />
      <text
        className={innermost ? 'domain-title' : 'ring-label'}
        data-layer={ring.role}
        data-ref={ref}
        x={ring.labelAt.x}
        y={ring.labelAt.y}
        fontSize={innermost ? DOMAIN_TITLE.size : RING_LABEL.size}
      >
        {ring.title}
      </text>
      {ring.subtitle && (
        <text
          className={`ring-subtitle${innermost ? ' on-domain' : ''}`}
          data-layer={ring.role}
          data-ref={ref}
          x={ring.labelAt.x}
          y={ring.labelAt.y + ((innermost ? DOMAIN_TITLE.size : RING_LABEL.size) + 4) / 2 + SUBTITLE_GAP + RING_SUBTITLE.size / 2 + 2}
          fontSize={RING_SUBTITLE.size}
        >
          {ring.subtitle}
        </text>
      )}
    </>
  )
}

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

function Edge({ edge }: { edge: LayoutEdge }) {
  const marker = edge.kind === 'import' ? 'url(#arrow)' : undefined
  if (edge.insideTo === undefined) {
    return <path className={`edge edge-${edge.kind}`} d={orthogonalPath(edge.points)} markerEnd={marker} />
  }
  return (
    <>
      <path className={`edge edge-${edge.kind} on-domain`} d={orthogonalPath(edge.points.slice(0, edge.insideTo + 1))} />
      <path className={`edge edge-${edge.kind}`} d={orthogonalPath(edge.points.slice(edge.insideTo))} markerEnd={marker} />
    </>
  )
}

function EdgeLabel({ edge }: { edge: LayoutEdge }) {
  if (!edge.label || !edge.labelAt) return null
  return (
    <text className="edge-label" x={edge.labelAt.x} y={edge.labelAt.y} fontSize={EDGE_LABEL.size}>
      {edge.label}
    </text>
  )
}

function Node({ node, selected }: { node: LayoutNode; selected: boolean }) {
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
      tabIndex={0}
      role="button"
      aria-label={`Edit ${node.lines.map((l) => l.text).join(' ')}`}
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

/** The legend drawn under the diagram's bottom-right corner; hidden on the canvas, shown only in exports. */
function SvgLegend({ legend, bounds }: { legend: LegendModel; bounds: Box }) {
  const size = legendSize(legend)
  const rows: ReactNode[] = []
  let y = LEGEND_PAD
  const heading = (text: string) => {
    rows.push(<text key={text} className="legend-heading" x={LEGEND_PAD} y={y + LEGEND_HEADING / 2} fontSize={13}>{text}</text>)
    y += LEGEND_HEADING
  }
  heading(LEGEND_SECTIONS[0])
  for (const c of legend.colours) {
    rows.push(<rect key={`c-${c.label}`} className={`legend-swatch swatch-${c.swatch}`} x={LEGEND_PAD} y={y + 4} width={16} height={10} rx={2} />)
    rows.push(<text key={`ct-${c.label}`} className="legend-label" x={LEGEND_PAD + LEGEND_SWATCH} y={y + LEGEND_ROW / 2} fontSize={LINE_METRICS.muted.size}>{c.label}</text>)
    y += LEGEND_ROW
  }
  heading(LEGEND_SECTIONS[1])
  for (const s of legend.strokes) {
    rows.push(<line key={`s-${s.stroke}`} className={`stroke-${s.stroke}`} x1={LEGEND_PAD} y1={y + LEGEND_ROW / 2} x2={LEGEND_PAD + 18} y2={y + LEGEND_ROW / 2} />)
    rows.push(<text key={`st-${s.stroke}`} className="legend-label" x={LEGEND_PAD + LEGEND_SWATCH} y={y + LEGEND_ROW / 2} fontSize={LINE_METRICS.muted.size}>{s.label}</text>)
    y += LEGEND_ROW
  }
  heading(LEGEND_SECTIONS[2])
  for (const t of legend.tags) {
    rows.push(<text key={`t-${t}`} className="legend-tag" x={LEGEND_PAD} y={y + LEGEND_ROW / 2} fontSize={LINE_METRICS.tag.size}>{t}</text>)
    y += LEGEND_ROW
  }
  return (
    <g data-legend="" className="svg-legend" transform={`translate(${bounds.x + bounds.width - size.width} ${bounds.y + bounds.height + LEGEND_GAP})`}>
      <rect className="legend-panel" width={size.width} height={size.height} rx={8} />
      {rows}
    </g>
  )
}

export function Diagram({ model, legend, showGuides, selected }: { model: LayoutModel; legend: LegendModel; showGuides: boolean; selected: string | null }) {
  return (
    <>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path className="arrow-head" d="M0 0L10 5L0 10z" />
        </marker>
        {model.rings.map((ring) => (
          // The glow colour follows each ring's stroke; flood-color comes from CSS per role.
          <filter key={ring.role} id={`glow-${ring.role}`} x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow className={`glow-${ring.role}`} dx="0" dy="0" stdDeviation="6" floodOpacity="0.35" />
          </filter>
        ))}
      </defs>
      {model.rings.map((ring, i) => <Ring key={ring.key} ring={ring} shape={model.shape} inner={model.rings[i + 1]} />)}
      {showGuides && model.guides.map((g, k) => <line key={k} className="guide" x1={g.from.x} y1={g.from.y} x2={g.to.x} y2={g.to.y} />)}
      {model.edges.map((edge) => <Edge key={edge.key} edge={edge} />)}
      {model.nodes.map((node) => <Node key={node.key} node={node} selected={node.ref === selected} />)}
      {model.edges.map((edge) => <EdgeLabel key={edge.key} edge={edge} />)}
      {model.texts.map((text) => <Heading key={text.key} text={text} />)}
      <SvgLegend legend={legend} bounds={model.bounds} />
    </>
  )
}
