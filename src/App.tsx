import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { LayoutMode } from './layout/layout'
import { currentHexagon, hexagonBounds, layoutMap } from './layout/map'
import { legendFor, legendSize } from './layout/legend'
import { EXAMPLES } from './model/example'
import { parseHexa, toHexa, toMap } from './model/hexa'
import { collectionOf, type LinkTarget } from './model/links'
import { diagramOf, UNTITLED_HEXAGON } from './model/map'
import type { Recovery } from './model/persistence'
import type { HexaMap, Link } from './model/schema'
import { useMapStore } from './model/store'
import { Editor, revealInEditor } from './ui/Editor'
import { download, exportBounds, fileSlug, legendDrawn, pngBlob, svgMarkup } from './ui/exporters'
import { Icon } from './ui/Icon'
import { Legend } from './ui/Legend'
import { readPref, writePref } from './ui/prefs'
import { Stage } from './ui/Stage'
import { Toast } from './ui/Toast'
import { Toolbar, type ExportScope } from './ui/Toolbar'

type Theme = 'light' | 'dark'

interface Notice {
  /** A new notice restarts the toast's countdown even when its text repeats. */
  id: number
  tone: 'status' | 'error' | 'recovery'
  message: string
  details?: string[]
  undo?: { map: HexaMap; focus: string }
  /** The unreadable text a "recovery" notice offers to download, when a copy was kept. */
  download?: string
}

const RECOVERY_MESSAGE: Record<'kept' | 'not-kept', string> = {
  kept: "Your last session couldn't be restored, so the example is open. Your saved work is kept in this browser; nothing was deleted.",
  'not-kept': "Your last session couldn't be restored and a copy couldn't be kept, so autosave is off.",
}

const THEME_KEY = 'domainrings:theme'
const LEGEND_EXPORT_KEY = 'domainrings:legend-export'
const OVERVIEW_KEY = 'domainrings:overview'
const GUIDES_KEY = 'domainrings:guides'
const HIGHLIGHT_KEY = 'domainrings:highlight'
const LEGEND_OPEN_KEY = 'domainrings:legend-open'
const { replace, restore, setMapMeta, removeItem, updateItem } = useMapStore.getState()

function currentTheme(): Theme {
  const explicit = document.documentElement.dataset.theme
  if (explicit === 'light' || explicit === 'dark') return explicit
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface AppProps {
  boot?: { recovery: Recovery; unreadableText?: string }
}

export function App({ boot = { recovery: 'none' } }: AppProps = {}) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  const revision = useMapStore((s) => s.revision)
  const diagram = diagramOf(map, hexId)
  const multiHexagon = map.hexagons.length > 1
  const [mode, setMode] = useState<LayoutMode>(() => (readPref(OVERVIEW_KEY, false) ? 'overview' : 'detailed'))
  const [guides, setGuides] = useState(() => readPref(GUIDES_KEY, true))
  const [highlight, setHighlight] = useState(() => readPref(HIGHLIGHT_KEY, true))
  const model = layoutMap(map, { mode })
  const svgRef = useRef<SVGSVGElement>(null)
  const [editorOpen, setEditorOpen] = useState(() => !matchMedia('(max-width: 720px)').matches)
  const reveal = (ref: string, focus: boolean) => {
    // The card only exists to scroll to once the collapsed editor has rendered open.
    flushSync(() => setEditorOpen(true))
    revealInEditor(ref, focus)
  }
  const [theme, setTheme] = useState(currentTheme)
  const [notice, setNotice] = useState<Notice | null>(null)
  // Its own slot, never touched by show()/startLinking: it stays until the user dismisses it (REQ-03.2),
  // whatever status toasts or link-mode hints come and go in the meantime.
  const [recoveryNotice, setRecoveryNotice] = useState<Notice | null>(() =>
    boot.recovery === 'none'
      ? null
      : { id: 0, tone: 'recovery', message: RECOVERY_MESSAGE[boot.recovery], download: boot.recovery === 'kept' ? boot.unreadableText : undefined },
  )
  const noticeSeq = useRef(0)
  const show = (next: Omit<Notice, 'id'>) => setNotice({ ...next, id: ++noticeSeq.current })
  const [legendInExport, setLegendInExport] = useState(() => readPref(LEGEND_EXPORT_KEY, true))
  const [legendOpen, setLegendOpen] = useState(() => readPref(LEGEND_OPEN_KEY, false))
  const legend = legendFor(diagram)
  const [exportScope, setExportScope] = useState<ExportScope>('map')

  const swap = (nextMap: HexaMap, message: string) => {
    show({ tone: 'status', message, undo: { map, focus: hexId } })
    replace(nextMap)
    setExportScope('map')
  }

  const nameOf = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    const items: { id: string; name: string }[] = collection ? diagram[collection] : []
    return items.find((i) => i.id === ref)?.name ?? ''
  }

  // The toast for an edit that pruned one or more links (LINK-01): "Deleted"/"Moved" is told apart by whether the
  // edited end's port still exists after the edit — the only two ways pruneLinks ever fires. `onPrune` is passed
  // to Editor too, since its own remove/update handlers call the store directly, bypassing deleteItem/link below.
  const pruneToast = (pruned: Link[], before: { map: HexaMap; focus: string }) => {
    if (!pruned.length) return
    const beforeHexagon = before.map.hexagons.find((h) => h.id === before.focus)!
    const afterHexagon = useMapStore.getState().map.hexagons.find((h) => h.id === before.focus)
    const editedEnd = (l: Link) => (l.from.hexagonId === before.focus ? l.from : l.to)
    const otherHexagonTitle = (l: Link) => {
      const end = l.from.hexagonId === before.focus ? l.to : l.from
      return before.map.hexagons.find((h) => h.id === end.hexagonId)?.title || UNTITLED_HEXAGON
    }
    const portId = editedEnd(pruned[0]).portId
    const portName = beforeHexagon.ports.find((p) => p.id === portId)?.name ?? 'the port'
    const stillExists = afterHexagon?.ports.some((p) => p.id === portId) ?? false
    const plural = pruned.length > 1 ? 's' : ''
    const hexes = pruned.map(otherHexagonTitle).join(' and ')
    const message = stillExists ? `Moved ${portName} and removed its link${plural} to ${hexes}.` : `Deleted ${portName} and its link${plural} to ${hexes}.`
    show({ tone: 'status', message, undo: before })
  }

  const deleteItem = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    if (!collection) return false
    const before = { map, focus: hexId }
    const pruned = removeItem(hexId, collection, ref)
    if (pruned.length) pruneToast(pruned, before)
    else show({ tone: 'status', message: `Deleted ${nameOf(ref)}.`, undo: before })
    return true
  }

  // Link mode: the element being linked. It ends when that element goes, or the whole map is swapped.
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
    show({ tone: 'status', message: `Linked ${nameOf(source)} → ${nameOf(targetRef)}.`, undo: { map, focus: hexId } })
    // The same store action the editor's link dropdowns use. linkTargets only returns fields of the source's own
    // collection, which the store's per-collection typing cannot see through a union.
    updateItem(hexId, collection, source, patch as never)
    setLinking(null)
  }

  const importFile = async (file: File) => {
    const result = parseHexa(await file.text())
    if (result.ok) swap(result.map, `Opened ${file.name}.`)
    else show({ tone: 'error', message: `${file.name} could not be opened. Fix these problems and try again:`, details: result.errors })
  }

  const exportAs = async (format: 'hexa' | 'svg' | 'png') => {
    try {
      if (format === 'hexa') return download(toHexa(map), `${fileSlug(map.title)}.hexa`, 'application/json')
      if (!svgRef.current) return
      // Only a multi-hexagon map has a scope to honour — a single hexagon always exports map-shaped (EXPORT-03.1).
      const scoped = exportScope === 'hexagon' && multiHexagon
      const frame = scoped ? hexagonBounds(currentHexagon(model, hexId)) : model.bounds
      const exportTitle = scoped ? diagram.title || UNTITLED_HEXAGON : map.title
      const name = fileSlug(exportTitle)
      const options = { legend: legendInExport, legendHeight: legendSize(legend).height, only: scoped ? hexId : undefined }
      const markup = await svgMarkup(svgRef.current, frame, exportTitle, options)
      if (format === 'svg') download(markup, `${name}.svg`, 'image/svg+xml')
      else download(await pngBlob(markup, exportBounds(frame, { ...options, legend: legendDrawn(svgRef.current, options) })), `${name}.png`)
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
        kind={map.kind}
        kindLocked={multiHexagon}
        showScope={multiHexagon}
        exportScope={exportScope}
        onExportScope={setExportScope}
        theme={theme}
        onKind={(kind) => setMapMeta({ kind })}
        onNew={() => swap(toMap({ version: 1, kind: map.kind, title: 'Untitled architecture', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }), 'Started a new diagram.')}
        onExample={(id) => {
          const example = EXAMPLES.find((x) => x.id === id)!
          swap(example.map, `Loaded the ${example.label} example.`)
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
      <Editor open={editorOpen} onToggle={() => setEditorOpen(!editorOpen)} onPrune={pruneToast} />
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
      <Stage model={model} hexId={hexId} diagram={diagram} mode={mode} highlight={highlight} legend={legend} revision={revision} title={diagram.title} svgRef={svgRef} panelOpen={editorOpen} legendOpen={legendOpen} showGuides={guides} onReveal={reveal} onDelete={deleteItem} linking={linking} onLinking={startLinking} onLink={link} />
      {linking && <Toast key={`link:${linking}`} sticky message={`Choose a target for ${nameOf(linking)} · Esc to cancel`} onClose={() => setLinking(null)} />}
      {!linking && notice?.tone === 'status' && (
        <Toast
          key={notice.id}
          message={notice.message}
          onUndo={
            notice.undo &&
            (() => {
              restore(notice.undo!)
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
      {recoveryNotice && (
        <section className="island notice" role="status" aria-live="polite">
          <p>{recoveryNotice.message}</p>
          <div className="notice-actions">
            {recoveryNotice.download !== undefined && (
              <button type="button" className="text-button" onClick={() => download(recoveryNotice.download!, 'unreadable-session.hexa', 'application/json')}>
                Download saved copy
              </button>
            )}
            <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setRecoveryNotice(null)}>
              <Icon name="close" />
            </button>
          </div>
        </section>
      )}
    </>
  )
}
