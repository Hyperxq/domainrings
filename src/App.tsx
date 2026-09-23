import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { layoutDiagram, type LayoutMode } from './layout/layout'
import { legendFor, legendSize } from './layout/legend'
import { EXAMPLES } from './model/example'
import { parseHexa, toHexa } from './model/hexa'
import { collectionOf, type LinkTarget } from './model/links'
import type { Diagram } from './model/schema'
import { useDiagramStore } from './model/store'
import { Editor, revealInEditor } from './ui/Editor'
import { download, exportBounds, fileSlug, pngBlob, svgMarkup } from './ui/exporters'
import { Icon } from './ui/Icon'
import { Legend } from './ui/Legend'
import { readPref, writePref } from './ui/prefs'
import { Stage } from './ui/Stage'
import { Toast } from './ui/Toast'
import { Toolbar } from './ui/Toolbar'

type Theme = 'light' | 'dark'

interface Notice {
  /** A new notice restarts the toast's countdown even when its text repeats. */
  id: number
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
const LEGEND_OPEN_KEY = 'domainrings:legend-open'
const { replace, setMeta, removeItem, updateItem } = useDiagramStore.getState()

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
  const reveal = (ref: string, focus: boolean) => {
    // The card only exists to scroll to once the collapsed editor has rendered open.
    flushSync(() => setEditorOpen(true))
    revealInEditor(ref, focus)
  }
  const [theme, setTheme] = useState(currentTheme)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeSeq = useRef(0)
  const show = (next: Omit<Notice, 'id'>) => setNotice({ ...next, id: ++noticeSeq.current })
  const [legendInExport, setLegendInExport] = useState(() => readPref(LEGEND_EXPORT_KEY, true))
  const [legendOpen, setLegendOpen] = useState(() => readPref(LEGEND_OPEN_KEY, false))
  const legend = legendFor(diagram)

  const swap = (next: Diagram, message: string) => {
    show({ tone: 'status', message, undo: diagram })
    replace(next)
  }

  const nameOf = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    const items: { id: string; name: string }[] = collection ? diagram[collection] : []
    return items.find((i) => i.id === ref)?.name ?? ''
  }

  const deleteItem = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    if (!collection) return false
    show({ tone: 'status', message: `Deleted ${nameOf(ref)}.`, undo: diagram })
    removeItem(collection, ref)
    return true
  }

  // Link mode: the element being linked. It ends when that element goes, or the whole diagram is swapped.
  const [linking, setLinking] = useState<string | null>(null)
  const [linkRevision, setLinkRevision] = useState(revision)
  if (revision !== linkRevision) {
    setLinkRevision(revision)
    setLinking(null)
  }
  if (linking && !collectionOf(diagram, linking)) setLinking(null)
  const startLinking = (ref: string | null) => {
    // The hint replaces any status toast; an error stays until it is read.
    if (ref) setNotice((n) => (n?.tone === 'error' ? n : null))
    setLinking(ref)
  }
  const link = (source: string, { targetRef, patch }: LinkTarget) => {
    const collection = collectionOf(diagram, source)!
    show({ tone: 'status', message: `Linked ${nameOf(source)} → ${nameOf(targetRef)}.`, undo: diagram })
    // The same store action the editor's link dropdowns use. linkTargets only returns fields of the source's own
    // collection, which the store's per-collection typing cannot see through a union.
    updateItem(collection, source, patch as never)
    setLinking(null)
  }

  const importFile = async (file: File) => {
    const result = parseHexa(await file.text())
    if (result.ok) swap(result.diagram, `Opened ${file.name}.`)
    else show({ tone: 'error', message: `${file.name} could not be opened. Fix these problems and try again:`, details: result.errors })
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
      show({ tone: 'error', message: `Export failed: ${(error as Error).message}` })
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
        open={legendOpen}
        onOpen={(open) => {
          writePref(LEGEND_OPEN_KEY, open)
          setLegendOpen(open)
        }}
        includeInExport={legendInExport}
        onIncludeInExport={(include) => {
          writePref(LEGEND_EXPORT_KEY, include)
          setLegendInExport(include)
        }}
      />
      <Stage model={model} diagram={diagram} mode={mode} highlight={highlight} legend={legend} revision={revision} title={diagram.title} svgRef={svgRef} panelOpen={editorOpen} legendOpen={legendOpen} showGuides={guides} onReveal={reveal} onDelete={deleteItem} linking={linking} onLinking={startLinking} onLink={link} />
      {linking && <Toast key={`link:${linking}`} sticky message={`Choose a target for ${nameOf(linking)} · Esc to cancel`} onClose={() => setLinking(null)} />}
      {!linking && notice?.tone === 'status' && (
        <Toast
          key={notice.id}
          message={notice.message}
          onUndo={
            notice.undo &&
            (() => {
              replace(notice.undo!)
              setNotice(null)
            })
          }
          onClose={() => setNotice(null)}
        />
      )}
      {notice?.tone === 'error' && (
        <section className="island notice notice-error" role="alert">
          <p>{notice.message}</p>
          {notice.details && (
            <ul>
              {notice.details.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          <div className="notice-actions">
            <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <Icon name="close" />
            </button>
          </div>
        </section>
      )}
    </>
  )
}
