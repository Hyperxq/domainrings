import type { ReactNode } from 'react'
import type { Box } from '../layout/geometry'
import { LEGEND_GAP, LEGEND_HEADING, LEGEND_PAD, LEGEND_ROW, legendSections, LEGEND_SWATCH, legendSize, type LegendModel } from '../layout/legend'
import { LINE_METRICS } from '../layout/text'

/** The legend drawn under a diagram's bottom-right corner — shared by Hexagonal's own `MapDiagram` (below) and,
 * via export, Onion's/Clean's own diagrams (ADR-01): hidden on the canvas (`.canvas .svg-legend`), shown only in
 * exports (`ui/exporters.ts` toggles the `.exporting` class before capturing markup). */
export function SvgLegend({ legend, bounds }: { legend: LegendModel; bounds: Box }) {
  const size = legendSize(legend)
  const rows: ReactNode[] = []
  let y = LEGEND_PAD
  const heading = (text: string) => {
    rows.push(<text key={text} className="legend-heading" x={LEGEND_PAD} y={y + LEGEND_HEADING / 2} fontSize={13}>{text}</text>)
    y += LEGEND_HEADING
  }
  const titles = new Map(legendSections(legend).map((s) => [s.key, s.title]))
  const section = (key: 'colours' | 'strokes' | 'tags') => titles.has(key) && heading(titles.get(key)!)
  section('colours')
  for (const c of legend.colours) {
    rows.push(<rect key={`c-${c.label}`} className={`legend-swatch swatch-${c.swatch}`} x={LEGEND_PAD} y={y + 4} width={16} height={10} rx={2} />)
    rows.push(<text key={`ct-${c.label}`} className="legend-label" x={LEGEND_PAD + LEGEND_SWATCH} y={y + LEGEND_ROW / 2} fontSize={LINE_METRICS.muted.size}>{c.label}</text>)
    y += LEGEND_ROW
  }
  section('strokes')
  for (const s of legend.strokes) {
    rows.push(<line key={`s-${s.stroke}`} className={`stroke-${s.stroke}`} x1={LEGEND_PAD} y1={y + LEGEND_ROW / 2} x2={LEGEND_PAD + 18} y2={y + LEGEND_ROW / 2} />)
    rows.push(<text key={`st-${s.stroke}`} className="legend-label" x={LEGEND_PAD + LEGEND_SWATCH} y={y + LEGEND_ROW / 2} fontSize={LINE_METRICS.muted.size}>{s.label}</text>)
    y += LEGEND_ROW
  }
  section('tags')
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
