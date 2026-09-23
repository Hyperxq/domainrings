import { legendSections, type LegendModel } from '../layout/legend'
import { Icon } from './Icon'

interface LegendProps {
  legend: LegendModel
  open: boolean
  onOpen: (open: boolean) => void
  includeInExport: boolean
  onIncludeInExport: (include: boolean) => void
}

/** A help panel in the corner: the header row opens and closes it, and Esc inside it closes it. */
export function Legend({ legend, open, onOpen, includeInExport, onIncludeInExport }: LegendProps) {
  return (
    <section
      className="island legend"
      data-open={open ? '' : undefined}
      aria-label="Legend"
      onKeyDown={(e) => {
        if (!open || e.key !== 'Escape') return
        e.stopPropagation()
        onOpen(false)
      }}
    >
      <button
        type="button"
        className="legend-head"
        aria-expanded={open}
        aria-controls="legend-body"
        aria-label={open ? 'Hide legend' : undefined}
        title={open ? 'Hide legend' : 'Show legend'}
        onClick={() => onOpen(!open)}
      >
        <Icon name="info" />
        <span>Legend</span>
        <Icon name="chevron" />
      </button>
      <div id="legend-body" className="legend-body" inert={!open}>
        <div className="legend-inner">
          {legendSections(legend).map((s) => (
            <div key={s.key} className="legend-section">
              <h3>{s.title}</h3>
              {s.key === 'colours' && (
                <ul>
                  {legend.colours.map((c) => (
                    <li key={c.label}>
                      <span className={`legend-swatch swatch-${c.swatch}`} aria-hidden="true" />
                      {c.label}
                    </li>
                  ))}
                </ul>
              )}
              {s.key === 'strokes' && (
                <ul>
                  {legend.strokes.map((st) => (
                    <li key={st.stroke}>
                      <svg className="legend-line" viewBox="0 0 24 8" width="24" height="8" aria-hidden="true">
                        <line className={`stroke-${st.stroke}`} x1="1" y1="4" x2="23" y2="4" />
                      </svg>
                      {st.label}
                    </li>
                  ))}
                </ul>
              )}
              {s.key === 'tags' && (
                <ul className="legend-tags">
                  {legend.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <footer className="legend-footer">
            <label className="legend-export">
              <input type="checkbox" checked={includeInExport} onChange={(e) => onIncludeInExport(e.currentTarget.checked)} />
              Include legend in export
            </label>
          </footer>
        </div>
      </div>
    </section>
  )
}
