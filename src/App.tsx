import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { LayoutMode } from './layout/layout'
import { currentHexagon, hexagonBounds, layoutMap } from './layout/map'
import { legendFor, legendSize } from './layout/legend'
import { EXAMPLES } from './model/example'
import { parseHexa, toHexa, toMap } from './model/hexa'
import { KINDS } from './model/kinds'
import { collectionOf, type LinkChoice } from './model/links'
import { contextName, diagramOf, linkEndLabel, UNTITLED_HEXAGON, type Destination, type LinkPatch } from './model/map'
import type { Recovery } from './model/persistence'
import type { HexaMap, Link, LinkEnd, Wall } from './model/schema'
import { useMapStore } from './model/store'
import { ConvertDialog } from './ui/ConvertDialog'
import { Editor, revealInEditor } from './ui/Editor'
import { download, exportBounds, fileSlug, legendDrawn, pngBlob, svgMarkup } from './ui/exporters'
import { Icon } from './ui/Icon'
import { Legend } from './ui/Legend'
import type { PaletteId } from './ui/palette'
import { readPref, setRootPref, writePref } from './ui/prefs'
import { decodeSharePayload, encodeSharePayload, isOversizedShareLink, shareLinkURL, SHARE_HASH_PREFIX } from './ui/shareLink'
import { Stage } from './ui/Stage'
import { Toast } from './ui/Toast'
import { Toolbar, type ExportScope, type ThemeChoice } from './ui/Toolbar'


interface Notice {
  /** A new notice restarts the toast's countdown even when its text repeats. */
  id: number
  tone: 'status' | 'error' | 'recovery'
  message: string
  details?: string[]
  undo?: { map: HexaMap; focus: string; swap?: boolean }
  /** The unreadable text a "recovery" notice offers to download, when a copy was kept. */
  download?: string
  /** Stays up past the usual 6 s countdown (DEL-02) — clears on the map's next edit, tracked via `staleWhenMapIsnt`. */
  sticky?: boolean
  /** For a sticky notice: the map right after the action it reports. The notice clears once `map` moves past it. */
  staleWhenMapIsnt?: HexaMap
}

const RECOVERY_MESSAGE: Record<'kept' | 'not-kept', string> = {
  kept: "Your last session couldn't be restored, so the example is open. Your saved work is kept in this browser; nothing was deleted.",
  'not-kept': "Your last session couldn't be restored and a copy couldn't be kept, so autosave is off.",
}

const LEGEND_EXPORT_KEY = 'domainrings:legend-export'
const OVERVIEW_KEY = 'domainrings:overview'
const GUIDES_KEY = 'domainrings:guides'
const HIGHLIGHT_KEY = 'domainrings:highlight'
const LEGEND_OPEN_KEY = 'domainrings:legend-open'
const { replace, restore, setMapMeta, removeItem, updateItem, addHexagon, importHexagon, removeHexagon, setMeta, addLink, updateLink: updateLinkAction, removeLink: removeLinkAction } = useMapStore.getState()

interface AppProps {
  boot?: { recovery: Recovery; unreadableText?: string }
}

export function App({ boot = { recovery: 'none' } }: AppProps = {}) {
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  // The undo snapshot every action below restores on request; each site takes it as-is or spreads `swap: true`.
  const before = { map, focus: hexId }
  const revision = useMapStore((s) => s.revision)
  const diagram = diagramOf(map, hexId)
  const multiHexagon = map.hexagons.length > 1
  const contextLabel = contextName(map, map.hexagons.find((h) => h.id === hexId)!.contextId)
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
  // main.tsx applies only valid stored values to the document before the first render.
  const [themeChoice, setThemeChoice] = useState(() => (document.documentElement.dataset.theme ?? 'system') as ThemeChoice)
  const [palette, setPalette] = useState(() => (document.documentElement.dataset.palette ?? 'default') as PaletteId)
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
    show({ tone: 'status', message, undo: { ...before, swap: true } })
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
    const pruned = removeItem(hexId, collection, ref)
    if (pruned.length) pruneToast(pruned, before)
    else show({ tone: 'status', message: `Deleted ${nameOf(ref)}.`, undo: before })
    return true
  }

  // Grow: the just-added hexagon's own inline title field is open until it commits (onNamed) or is undone
  // (onNamingCancel, or the toast's own Undo — either restores `before`, exactly as a one-step undo (GROW-03)).
  const [growing, setGrowing] = useState<{ hexId: string; before: { map: HexaMap; focus: string } } | null>(null)
  const completeGrow = (side: Wall | undefined, context: Destination, convert?: boolean) => {
    const newHexId = addHexagon(hexId, { side, context, convert })
    if (!newHexId) return
    const grownMap = useMapStore.getState().map
    const label = contextName(grownMap, grownMap.hexagons.find((h) => h.id === newHexId)!.contextId)
    show({ tone: 'status', message: `Added ${UNTITLED_HEXAGON} to ${label}. It is now the current hexagon.`, undo: before })
    setGrowing({ hexId: newHexId, before })
  }

  // Growing or importing into a Clean/Onion map asks first (CONV-01..05); `openerRef` remembers whatever had
  // focus at the moment the question was raised — the "+"/button ChoiceMenu already returned focus there before
  // this ran — so Cancel/Confirm can hand it back explicitly once the dialog unmounts.
  const [converting, setConverting] = useState<
    { action: 'add'; side: Wall | undefined; context: Destination } | { action: 'import'; file: HexaMap; context: Destination; fileName: string } | null
  >(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const handleGrow = (side: Wall | undefined, context: Destination) => {
    if (map.kind !== 'hexagonal') {
      openerRef.current = document.activeElement as HTMLElement | null
      return setConverting({ action: 'add', side, context })
    }
    completeGrow(side, context)
  }

  // A sticky toast (DEL-02) clears itself the moment the map next changes for any OTHER reason — not on a timer.
  if (notice?.sticky && notice.staleWhenMapIsnt && map !== notice.staleWhenMapIsnt) setNotice(null)

  // Renaming a bounded context (NAME-01..03): the store already updated live (Editor calls setContextName on
  // every keystroke, so the chip follows immediately) — this only fires once, on blur, when the whole edit
  // session actually changed the name, to toast one undoable step for it.
  const handleRenameContext = (before: HexaMap, contextId: string) => {
    const oldLabel = contextName(before, contextId)
    const newLabel = contextName(map, contextId)
    show({ tone: 'status', message: `Renamed ${oldLabel} to ${newLabel}.`, undo: { map: before, focus: hexId } })
  }

  const handleDelete = () => {
    const title = diagram.title || UNTITLED_HEXAGON
    const pruned = removeHexagon(hexId)
    const after = useMapStore.getState().map
    if (after === map) return // last hexagon — the Editor button is disabled, so this is defensive only
    const plural = pruned.length === 1 ? '' : 's'
    const message = pruned.length ? `Deleted ${title} and its ${pruned.length} link${plural}` : `Deleted ${title}`
    show({ tone: 'status', message, undo: before, sticky: true, staleWhenMapIsnt: after })
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
  // Shared by the canvas "Link to…" chip and the Links editor section's create form (ADR-02): one write path,
  // so the two entry points can never drift into producing different links for the same choice.
  const createLink = (from: LinkEnd, to: LinkEnd) => {
    const linkId = addLink(from, to)
    if (!linkId) return // REQ-LNK-01.3: an incompatible pair — MapSchema refused it, nothing created
    show({ tone: 'status', message: `Linked ${linkEndLabel(map, from)} → ${linkEndLabel(map, to)}.`, undo: before })
  }

  // REQ-LNK-02: edit an existing link's adapter(s) or pattern from the Links section's row — never its ends
  // (REQ-LNK-03.1, no such control is offered). False ⇒ no link has `id`, or the patch was structurally invalid;
  // either way nothing to toast.
  const editLink = (id: string, patch: LinkPatch) => {
    if (!updateLinkAction(id, patch)) return
    const updated = useMapStore.getState().map.links.find((l) => l.id === id)
    if (!updated) return
    show({ tone: 'status', message: `Updated the link ${linkEndLabel(map, updated.from)} → ${linkEndLabel(map, updated.to)}.`, undo: before })
  }

  // REQ-LNK-04: delete an existing link from the Links section's row; the message names its ends the same way
  // createLink's does, so Undo's toast reads as the mirror image of creating it.
  const deleteLink = (id: string) => {
    const removed = removeLinkAction(id)
    if (!removed) return
    show({ tone: 'status', message: `Deleted the link ${linkEndLabel(map, removed.from)} → ${linkEndLabel(map, removed.to)}.`, undo: before })
  }

  const link = (source: string, choice: LinkChoice) => {
    if (choice.kind === 'field') {
      const { targetRef, patch } = choice
      const collection = collectionOf(diagram, source)!
      show({ tone: 'status', message: `Linked ${nameOf(source)} → ${nameOf(targetRef)}.`, undo: before })
      // The same store action the editor's link dropdowns use. linkTargets only returns fields of the source's own
      // collection, which the store's per-collection typing cannot see through a union.
      updateItem(hexId, collection, source, patch as never)
      setLinking(null)
      return
    }
    // REQ-LNK-01.1b: the driven end is always `from`, regardless of which end the author started the chip from.
    const sourceSide = diagram.ports.find((p) => p.id === source)!.side
    const sourceEnd: LinkEnd = { hexagonId: hexId, portId: source }
    const chosenEnd: LinkEnd = { hexagonId: choice.hexagonId, portId: choice.portId }
    createLink(...(sourceSide === 'driven' ? ([sourceEnd, chosenEnd] as const) : ([chosenEnd, sourceEnd] as const)))
    setLinking(null)
  }

  // Shared by Open…, "Add hexagon from file…" and a share link: text that fails to parse is refused the same
  // way everywhere (IMP-07) — a newer-version source isn't broken (REQ-03.1), so it gets its own headline, no
  // fix-it framing. `label` names the source in the notice ("broken.hexa" for a file, "This link" for a link).
  const parseSource = async (text: string, label: string): Promise<HexaMap | undefined> => {
    const result = parseHexa(text)
    if (result.ok) return result.map
    const message =
      result.reason === 'newer' ? `${label} was made by a newer version of domainrings.` : `${label} could not be opened. Fix these problems and try again:`
    show({ tone: 'error', message, details: result.errors })
    return undefined
  }

  const parseFile = async (file: File): Promise<HexaMap | undefined> => parseSource(await file.text(), file.name)

  const importFile = async (file: File) => {
    const parsed = await parseFile(file)
    if (parsed) swap(parsed, `Opened ${file.name}.`)
  }

  // REQ-01/02/03/04: a share link in the address is consumed once, on mount. The ref is set before any await so
  // React StrictMode's double-invoke of this effect never re-enters the async branch below.
  const linkHandled = useRef(false)
  useEffect(() => {
    if (linkHandled.current) return
    linkHandled.current = true
    const finishLink = () => history.replaceState(null, '', location.pathname)
    const openLinkedText = async (text: string) => {
      const parsed = await parseSource(text, 'This link')
      if (parsed) swap(parsed, 'Opened from a link.')
    }
    void (async () => {
      if (location.hash.startsWith(SHARE_HASH_PREFIX)) {
        const text = await decodeSharePayload(location.hash.slice(SHARE_HASH_PREFIX.length))
        if (text === undefined) {
          show({ tone: 'error', message: 'This link could not be read.' })
          return finishLink()
        }
        await openLinkedText(text)
        return finishLink()
      }
      const src = new URLSearchParams(location.search).get('src')
      if (src === null) return
      if (!src.startsWith('https://')) {
        show({ tone: 'error', message: "This link's address is not https, so nothing was fetched." })
        return finishLink()
      }
      let text: string
      try {
        const response = await fetch(src)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        text = await response.text()
      } catch {
        show({ tone: 'error', message: "This link's file could not be reached." })
        return finishLink()
      }
      await openLinkedText(text)
      finishLink()
    })()
    // Runs once on mount only — the effect reads location/hash as they are at load, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // REQ-05/06: always the whole map (`map`, not the export-scoped diagram) — a link scoped to one hexagon
  // would reopen missing the rest, which "Copy link" never promises.
  const handleCopyLink = async () => {
    const url = shareLinkURL(location.origin, location.pathname, await encodeSharePayload(map))
    if (isOversizedShareLink(url)) {
      show({ tone: 'error', message: 'This map is too large for a link. Use Save to share it as .hexa instead.' })
      return
    }
    await navigator.clipboard.writeText(url)
    show({ tone: 'status', message: 'Copied a link to this map.' })
  }

  const completeImport = (file: HexaMap, context: Destination, fileName: string, convert?: boolean) => {
    const newHexId = importHexagon(file, { context, convert })
    if (!newHexId) return
    const imported = useMapStore.getState().map.hexagons.find((h) => h.id === newHexId)!
    const kindNotice = file.kind !== 'hexagonal' ? ` ${fileName} was ${KINDS[file.kind].label}; it now uses this map's hexagonal kind.` : ''
    show({ tone: 'status', message: `Added ${imported.title || UNTITLED_HEXAGON} from ${fileName}.${kindNotice}`, undo: before })
  }

  // "Add hexagon from file…" (IMP-01..07): refuses a multi-hexagon file before any conversion question (IMP-04.2),
  // then either asks to convert (map.kind isn't hexagonal) or imports straight away.
  const handleAddFromFile = async (file: File, context: Destination, opener: HTMLElement | null) => {
    const parsed = await parseFile(file)
    if (!parsed) return
    if (parsed.hexagons.length > 1) {
      show({ tone: 'error', message: `This file has ${parsed.hexagons.length} hexagons. Add hexagon from file… takes one; use Open to replace the map.` })
      return
    }
    if (map.kind !== 'hexagonal') {
      openerRef.current = opener
      return setConverting({ action: 'import', file: parsed, context, fileName: file.name })
    }
    completeImport(parsed, context, file.name)
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

  return (
    <>
      <Toolbar
        kind={map.kind}
        kindLocked={multiHexagon}
        showScope={multiHexagon}
        exportScope={exportScope}
        onExportScope={setExportScope}
        themeChoice={themeChoice}
        palette={palette}
        onKind={(kind) => setMapMeta({ kind })}
        onNew={() => swap(toMap({ version: 1, kind: map.kind, title: 'Untitled architecture', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }), 'Started a new diagram.')}
        onExample={(id) => {
          const example = EXAMPLES.find((x) => x.id === id)!
          swap(example.map, `Loaded the ${example.label} example.`)
        }}
        onOpen={importFile}
        onCopyLink={handleCopyLink}
        onExport={exportAs}
        onTheme={(choice) => {
          setRootPref('theme', choice === 'system' ? undefined : choice)
          setThemeChoice(choice)
        }}
        onPalette={(id) => {
          setRootPref('palette', id === 'default' ? undefined : id)
          setPalette(id)
        }}
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
      <Editor
        open={editorOpen}
        onToggle={() => setEditorOpen(!editorOpen)}
        onPrune={pruneToast}
        onAddHexagon={() => handleGrow(undefined, 'same')}
        onDeleteHexagon={handleDelete}
        onAddFromFile={handleAddFromFile}
        contextLabel={contextLabel}
        onRenameContext={handleRenameContext}
        onCreateLink={createLink}
        onUpdateLink={editLink}
        onDeleteLink={deleteLink}
      />
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
      <Stage
        model={model}
        map={map}
        hexId={hexId}
        diagram={diagram}
        mode={mode}
        highlight={highlight}
        legend={legend}
        revision={revision}
        title={diagram.title}
        svgRef={svgRef}
        panelOpen={editorOpen}
        legendOpen={legendOpen}
        showGuides={guides}
        onReveal={reveal}
        onDelete={deleteItem}
        linking={linking}
        onLinking={startLinking}
        onLink={link}
        contextLabel={contextLabel}
        onGrow={handleGrow}
        naming={!!growing}
        onNamed={(title) => {
          setMeta(growing!.hexId, { title })
          setGrowing(null)
        }}
        onNamingCancel={() => {
          restore(growing!.before)
          setGrowing(null)
          setNotice(null)
        }}
      />
      {converting && (
        <ConvertDialog
          kind={map.kind}
          action={converting.action}
          onConfirm={() => {
            if (converting.action === 'add') completeGrow(converting.side, converting.context, true)
            else completeImport(converting.file, converting.context, converting.fileName, true)
            setConverting(null)
            openerRef.current?.focus()
          }}
          onCancel={() => {
            setConverting(null)
            openerRef.current?.focus()
          }}
        />
      )}
      {linking && <Toast key={`link:${linking}`} sticky message={`Choose a target for ${nameOf(linking)} · Esc to cancel`} onClose={() => setLinking(null)} />}
      {!linking && notice?.tone === 'status' && (
        <Toast
          key={notice.id}
          message={notice.message}
          sticky={notice.sticky}
          onUndo={
            notice.undo &&
            (() => {
              restore(notice.undo!)
              setNotice(null)
              // Undoing a grow through the toast is the same restore as Esc-while-naming — close the field too.
              setGrowing(null)
            })
          }
          onClose={() => setNotice(null)}
        />
      )}
      {/* One positioned column for both — two independently fixed-position notices could sit at the same spot. */}
      <div className="notices">
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
      </div>
    </>
  )
}
