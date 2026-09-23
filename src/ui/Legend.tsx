import { useState } from 'react'
import type { LegendModel } from '../layout/legend'
import { readPref, writePref } from './prefs'

const OPEN_KEY = 'domainrings:legend-open'

interface LegendProps {
  legend: LegendModel
  includeInExport: boolean
  onIncludeInExport: (include: boolean) => void
}

export function Legend({ legend, includeInExport, onIncludeInExport }: LegendProps) {
  const [open, setOpen] = useState(() => readPref(OPEN_KEY, false))
  const toggle = () => {
    writePref(OPEN_KEY, !open)
    setOpen(!open)
  }
  return (
    <section className="island legend" aria-label="Legend">
      <button type="button" className="text-button legend-toggle" aria-expanded={open} aria-controls="legend-body" onClick={toggle}>
        Legend
      </button>
      <div id="legend-body" className="legend-body" hidden={!open}>
        <h3>Colour = layer</h3>
        <ul>
          {legend.colours.map((c) => (
            <li key={c.label}>
              <span className={`legend-swatch swatch-${c.swatch}`} aria-hidden="true" />
              {c.label}
            </li>
          ))}
        </ul>
        <h3>Stroke = role</h3>
        <ul>
          {legend.strokes.map((s) => (
            <li key={s.stroke}>
              <svg className="legend-line" viewBox="0 0 24 8" width="24" height="8" aria-hidden="true">
                <line className={`stroke-${s.stroke}`} x1="1" y1="4" x2="23" y2="4" />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
        <h3>Glyph = type</h3>
        <ul className="legend-tags">
          {legend.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <label className="legend-export">
          <input type="checkbox" checked={includeInExport} onChange={(e) => onIncludeInExport(e.currentTarget.checked)} />
          Include legend in export
        </label>
      </div>
    </section>
  )
}
