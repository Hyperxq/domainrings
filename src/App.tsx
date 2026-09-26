import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { LayoutMode } from './layout/layout'
import { currentHexagon, hexagonBounds, layoutMap } from './layout/map'
import { legendFor, legendSize } from './layout/legend'
import { layoutClean } from './layout/clean'
import { layoutOnion } from './layout/onion'
import { EXAMPLES } from './model/example'
import { newCleanMap, newOnionMap, parseHexa, toHexa, toMap } from './model/hexa'
import { collectionOf, type LinkChoice } from './model/links'
import { contextName, diagramOf, linkEndLabel, UNTITLED_HEXAGON, type Destination, type LinkPatch } from './model/map'
import { useCleanStore } from './model/cleanStore'
import { useOnionStore } from './model/onionStore'
import type { Recovery } from './model/persistence'
import type { HexaMap, Link, LinkEnd, StoredFile, Wall } from './model/schema'
import { useMapStore } from './model/store'
import type { ArchitectureChoice } from './ui/ArchitectureChoiceDialog'
import { ArchitectureChoiceDialog, CHOICES } from './ui/ArchitectureChoiceDialog'
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
import { CleanEditor } from './ui/CleanEditor'
import { CleanStage } from './ui/CleanStage'
import { OnionEditor } from './ui/OnionEditor'
import { OnionStage } from './ui/OnionStage'


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

/** Only Onion/Clean ever reach this (Hexagonal is excluded before the caller needs it) — genuinely closed to those
 * two labels, not a general-purpose English article rule. */
const article = (label: string) => (/^[aeiou]/i.test(label) ? 'an' : 'a')

const LEGEND_EXPORT_KEY = 'domainrings:legend-export'
const OVERVIEW_KEY = 'domainrings:overview'
const GUIDES_KEY = 'domainrings:guides'
const HIGHLIGHT_KEY = 'domainrings:highlight'
const LEGEND_OPEN_KEY = 'domainrings:legend-open'
const { replace, restore, removeItem, updateItem, addHexagon, importHexagon, removeHexagon, setMeta, addLink, updateLink: updateLinkAction, removeLink: removeLinkAction } = useMapStore.getState()
const { replace: replaceOnion } = useOnionStore.getState()
const { replace: replaceClean } = useCleanStore.getState()

interface AppProps {
  boot?: { recovery: Recovery; unreadableText?: string; kind?: StoredFile['kind'] }
}

export function App({ boot = { recovery: 'none' } }: AppProps = {}) {
  // The sole branch point (ADR-02): both stores are read unconditionally — the inactive one never mutates,
  // since its UI never mounts — and `activeKind` (flipped by the chooser and by swap()) decides which renders.
  const [activeKind, setActiveKind] = useState<StoredFile['kind']>(() => boot.kind ?? 'hexagonal')
  const onionMap = useOnionStore((s) => s.map)
  // Onion's own layout is only ever read while its view is active (export, OnionStage) — skip it on a Hexagonal render.
  const onionModel = activeKind === 'onion' ? layoutOnion(onionMap) : undefined
  const cleanMap = useCleanStore((s) => s.map)
  const cleanModel = activeKind === 'clean' ? layoutClean(cleanMap) : undefined
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

  // The one kind-dispatch outside the render fork (ADR-02): routes a newly created/opened/loaded document to
  // whichever store matches its own kind and flips the active view. Undo is only offered when staying within
  // the kind already on screen — switching kind mid-session is rare enough that a wrong-kind undo isn't worth it.
  const swap = (file: StoredFile, message: string) => {
    if (file.kind === 'onion') {
      show({ tone: 'status', message })
      replaceOnion(file)
      setActiveKind('onion')
      return
    }
    if (file.kind === 'clean') {
      show({ tone: 'status', message })
      replaceClean(file)
      setActiveKind('clean')
      return
    }
    show({ tone: 'status', message, undo: activeKind === 'hexagonal' ? { ...before, swap: true } : undefined })
    replace(file)
    setActiveKind('hexagonal')
    setExportScope('map')
  }

  // REQ-01: the one-time, permanent architecture choice for a brand-new file — Toolbar's New button opens this
  // instead of creating a Hexagonal map directly.
  const [choosingArchitecture, setChoosingArchitecture] = useState(false)
  const completeNew = (kind: ArchitectureChoice) => {
    setChoosingArchitecture(false)
    if (kind === 'onion') {
      swap(newOnionMap('Untitled architecture'), 'Started a new Onion diagram.')
      return
    }
    if (kind === 'clean') {
      swap(newCleanMap('Untitled architecture'), 'Started a new Clean diagram.')
      return
    }
    swap(toMap({ version: 1, kind: 'hexagonal', title: 'Untitled architecture', domain: [], useCases: [], ports: [], adapters: [], actors: [], externals: [] }), 'Started a new diagram.')
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
  const completeGrow = (side: Wall | undefined, context: Destination) => {
    const newHexId = addHexagon(hexId, { side, context })
    if (!newHexId) return
    const grownMap = useMapStore.getState().map
    const label = contextName(grownMap, grownMap.hexagons.find((h) => h.id === newHexId)!.contextId)
    show({ tone: 'status', message: `Added ${UNTITLED_HEXAGON} to ${label}. It is now the current hexagon.`, undo: before })
    setGrowing({ hexId: newHexId, before })
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
    const updated = updateLinkAction(id, patch)
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
  const parseSource = async (text: string, label: string): Promise<StoredFile | undefined> => {
    const result = parseHexa(text)
    if (result.ok) return result.map
    const message =
      result.reason === 'newer' ? `${label} was made by a newer version of domainrings.` : `${label} could not be opened. Fix these problems and try again:`
    show({ tone: 'error', message, details: result.errors })
    return undefined
  }

  const parseFile = async (file: File): Promise<StoredFile | undefined> => parseSource(await file.text(), file.name)

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

  // REQ-05/06: the ACTIVE document's whole file (`active.file`, the same single resolution `exportAs` uses) —
  // not always the Hexagonal map, and never scoped to one hexagon, which "Copy link" never promises.
  const handleCopyLink = async () => {
    const url = shareLinkURL(location.origin, location.pathname, await encodeSharePayload(active.file))
    if (isOversizedShareLink(url)) {
      show({ tone: 'error', message: 'This map is too large for a link. Use Save to share it as .hexa instead.' })
      return
    }
    await navigator.clipboard.writeText(url)
    show({ tone: 'status', message: 'Copied a link to this map.' })
  }

  const completeImport = (file: HexaMap, context: Destination, fileName: string) => {
    const newHexId = importHexagon(file, { context })
    if (!newHexId) return
    const imported = useMapStore.getState().map.hexagons.find((h) => h.id === newHexId)!
    show({ tone: 'status', message: `Added ${imported.title || UNTITLED_HEXAGON} from ${fileName}.`, undo: before })
  }

  // "Add hexagon from file…" (IMP-01..07): only a Hexagonal source has hexagons to add; refuses an Onion source
  // (REQ-03) and a multi-hexagon file (IMP-04.2) before importing.
  const handleAddFromFile = async (file: File, context: Destination) => {
    const parsed = await parseFile(file)
    if (!parsed) return
    if (parsed.kind !== 'hexagonal') {
      const kindLabel = CHOICES.find((c) => c.kind === parsed.kind)!.label
      show({ tone: 'error', message: `${file.name} is ${article(kindLabel)} ${kindLabel} file. Add hexagon from file… only accepts a Hexagonal map.` })
      return
    }
    if (parsed.hexagons.length > 1) {
      show({ tone: 'error', message: `This file has ${parsed.hexagons.length} hexagons. Add hexagon from file… takes one; use Open to replace the map.` })
      return
    }
    completeImport(parsed, context, file.name)
  }

  // Export scope (Hexagon vs Map) only exists for a multi-hexagon Hexagonal map (EXPORT-03.1) — Onion and Clean
  // are always one diagram, so neither scopes or carries a legend (neither has a legend panel at all). Resolved
  // once, here, so a third kind only ever touches this one branch instead of every read below it.
  const canScopeExport = activeKind === 'hexagonal' && multiHexagon
  const scoped = canScopeExport && exportScope === 'hexagon'
  const active =
    activeKind === 'onion'
      ? { file: onionMap, bounds: onionModel!.bounds, title: onionMap.title, scoped: false, legend: false }
      : activeKind === 'clean'
        ? { file: cleanMap, bounds: cleanModel!.bounds, title: cleanMap.title, scoped: false, legend: false }
        : { file: map, bounds: scoped ? hexagonBounds(currentHexagon(model, hexId)) : model.bounds, title: scoped ? diagram.title || UNTITLED_HEXAGON : map.title, scoped, legend: legendInExport }

  const exportAs = async (format: 'hexa' | 'svg' | 'png') => {
    try {
      if (format === 'hexa') return download(toHexa(active.file), `${fileSlug(active.file.title)}.hexa`, 'application/json')
      if (!svgRef.current) return
      const name = fileSlug(active.title)
      const options = { legend: active.legend, legendHeight: legendSize(legend).height, only: active.scoped ? hexId : undefined }
      const markup = await svgMarkup(svgRef.current, active.bounds, active.title, options)
      if (format === 'svg') download(markup, `${name}.svg`, 'image/svg+xml')
      else download(await pngBlob(markup, exportBounds(active.bounds, { ...options, legend: legendDrawn(svgRef.current, options) })), `${name}.png`)
    } catch (error) {
      show({ tone: 'error', message: `Export failed: ${(error as Error).message}` })
    }
  }

  return (
    <>
      <Toolbar
        showScope={canScopeExport}
        exportScope={exportScope}
        onExportScope={setExportScope}
        themeChoice={themeChoice}
        palette={palette}
        onNew={() => setChoosingArchitecture(true)}
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
      {activeKind === 'hexagonal' && (
        <>
          <Editor
            open={editorOpen}
            onToggle={() => setEditorOpen(!editorOpen)}
            onPrune={pruneToast}
            onAddHexagon={() => completeGrow(undefined, 'same')}
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
            onGrow={completeGrow}
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
        </>
      )}
      {activeKind === 'onion' && (
        <>
          <OnionEditor open={editorOpen} onToggle={() => setEditorOpen(!editorOpen)} />
          <OnionStage model={onionModel!} doc={onionMap} svgRef={svgRef} onReject={(message) => show({ tone: 'error', message })} />
        </>
      )}
      {activeKind === 'clean' && (
        <>
          <CleanEditor open={editorOpen} onToggle={() => setEditorOpen(!editorOpen)} />
          <CleanStage model={cleanModel!} doc={cleanMap} svgRef={svgRef} onReject={(message) => show({ tone: 'error', message })} />
        </>
      )}
      {choosingArchitecture && <ArchitectureChoiceDialog onChoose={completeNew} onCancel={() => setChoosingArchitecture(false)} />}
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
