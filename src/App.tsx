import { useRef, useState } from 'react'
import { layoutDiagram, type LayoutMode } from './layout/layout'
import { legendFor, legendSize } from './layout/legend'
import { EXAMPLES } from './model/example'
import { parseHexa, toHexa } from './model/hexa'
import type { Diagram } from './model/schema'
import { useDiagramStore } from './model/store'
import { Editor } from './ui/Editor'
import { download, exportBounds, fileSlug, pngBlob, svgMarkup } from './ui/exporters'
import { Icon } from './ui/Icon'
import { Legend } from './ui/Legend'
import { readPref, writePref } from './ui/prefs'
import { Stage } from './ui/Stage'
import { Toolbar } from './ui/Toolbar'

type Theme = 'light' | 'dark'

interface Notice {
  tone: 'status' | 'error'
  message: string
  details?: string[]
  undo?: Diagram
}

const THEME_KEY = 'domainrings:theme'
const LEGEND_EXPORT_KEY = 'domainrings:legend-export'
const OVERVIEW_KEY = 'domainrings:overview'
const GUIDES_KEY = 'domainrings:guides'
const HIGHLIGHT_KEY = 'domainrings:highlight'
const { replace, setMeta } = useDiagramStore.getState()

function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'light' || explicit === 'dark') return explicit
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function App() {
  const diagram = useDiagramStore((s) => s.diagram)
  const revision = useDiagramStore((s) => s.revision)
  const [mode, setMode] = useState<LayoutMode>(() => (readPref(OVERVIEW_KEY, false) ? 'overview' : 'detailed'))
  const [guides, setGuides] = useState(() => readPref(GUIDES_KEY, true))
  const [highlight, setHighlight] = useState(() => readPref(HIGHLIGHT_KEY, true))
  const model = layoutDiagram(diagram, { mode })
  const svgRef = useRef<SVGSVGElement>(null)
  const [editorOpen, setEditorOpen] = useState(() => !matchMedia('(max-width: 720px)').matches)
  const [theme, setTheme] = useState(currentTheme)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [legendInExport, setLegendInExport] = useState(() => readPref(LEGEND_EXPORT_KEY, true))
  const legend = legendFor(diagram)

  const swap = (next: Diagram, message: string) => {
    setNotice({ tone: 'status', message, undo: diagram })
    replace(next)
  }

  const importFile = async (file: File) => {
    const result = parseHexa(await file.text())
    if (result.ok) swap(result.diagram, `Opened ${file.name}.`)
    else setNotice({ tone: 'error', message: `${file.name} could not be opened. Fix these problems and try again:`, details: result.errors })
  }

  const exportAs = async (format: 'hexa' | 'svg' | 'png') => {
    const name = fileSlug(diagram.title)
    try {
      if (format === 'hexa') return download(toHexa(diagram), `${name}.hexa`, 'application/json')
      if (!svgRef.current) return
      const options = { legend: legendInExport, legendHeight: legendSize(legend).height }
      const markup = await svgMarkup(svgRef.current, model.bounds, diagram.title, options)
      if (format === 'svg') download(markup, `${name}.svg`, 'image/svg+xml')
      else download(await pngBlob(markup, exportBounds(model.bounds, options)), `${name}.png`)
    } catch (error) {
      setNotice({ tone: 'error', message: `Export failed: ${(error as Error).message}` })
    }
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // The theme still applies for this session.
    }
    setTheme(next)
  }

  return (
    <>
      <Toolbar
        kind={diagram.kind}
        theme={theme}
        onKind={(kind) => setMeta({ kind })}
        onNew={() => swap({ version: 1, kind: diagram.kind, title: 'Untitled architecture', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }, 'Started a new diagram.')}
        onExample={(id) => {
          const example = EXAMPLES.find((x) => x.id === id)!
          swap(example.diagram, `Loaded the ${example.label} example.`)
        }}
        onImport={importFile}
        onExport={exportAs}
        onTheme={toggleTheme}
        mode={mode}
        onMode={(next) => {
          writePref(OVERVIEW_KEY, next === 'overview')
          setMode(next)
        }}
        guides={guides}
        onGuides={(show) => {
          writePref(GUIDES_KEY, show)
          setGuides(show)
        }}
        highlight={highlight}
        onHighlight={(on) => {
          writePref(HIGHLIGHT_KEY, on)
          setHighlight(on)
        }}
      />
      <Editor open={editorOpen} onToggle={() => setEditorOpen(!editorOpen)} />
      <Legend
        legend={legend}
        includeInExport={legendInExport}
        onIncludeInExport={(include) => {
          writePref(LEGEND_EXPORT_KEY, include)
          setLegendInExport(include)
        }}
      />
      <Stage model={model} diagram={diagram} mode={mode} highlight={highlight} legend={legend} revision={revision} title={diagram.title} svgRef={svgRef} panelOpen={editorOpen} showGuides={guides} />
      {notice && (
        <section className={`island notice notice-${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <p>{notice.message}</p>
          {notice.details && (
            <ul>
              {notice.details.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          <div className="notice-actions">
            {notice.undo && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  replace(notice.undo!)
                  setNotice(null)
                }}
              >
                Undo
              </button>
            )}
            <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <Icon name="close" />
            </button>
          </div>
        </section>
      )}
    </>
  )
}
