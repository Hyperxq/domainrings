import { useMemo, useRef, useState } from 'react'
import { canCompact } from './layout/compactHexagon'
import { hexagonBounds } from './layout/lattice'
import { currentHexagon, layoutMap } from './layout/map'
import { legendFor, legendForClean, legendForOnion } from './layout/legend'
import { layoutClean } from './layout/clean'
import { layoutOnion } from './layout/onion'
import { EXAMPLES } from './model/example'
import { collectionOf } from './model/links'
import { diagramOf, UNTITLED_HEXAGON } from './model/map'
import { useCleanStore } from './model/cleanStore'
import { useOnionStore } from './model/onionStore'
import { useSaveFailed, type Recovery } from './model/persistence'
import type { StoredFile } from './model/fileFormat'
import type { CleanFile, OnionFile } from './model/schema'
import { useMapStore } from './model/store'
import { ArchitectureChoiceDialog } from './ui/ArchitectureChoiceDialog'
import { useExport } from './ui/useExport'
import { useOpenDocument } from './ui/useOpenDocument'
import { useHistoryStore } from './ui/state/historyStore'
import { useUndoHistory } from './ui/useUndoHistory'
import { usePreferencesStore } from './ui/state/preferencesStore'
import { useViewStore } from './ui/state/viewStore'
import { encodeSharePayload, isOversizedShareLink, shareLinkURL } from './ui/shareLink'
import { useShareLinkOnMount } from './ui/useShareLinkOnMount'
import type { Notice, UndoSnapshot } from './ui/notice'
import { CleanWorkspace } from './ui/CleanWorkspace'
import { HexagonalWorkspace } from './ui/HexagonalWorkspace'
import { NoticeColumn } from './ui/NoticeColumn'
import { OnionWorkspace } from './ui/OnionWorkspace'
import { Toast } from './ui/Toast'
import { Toolbar } from './ui/Toolbar'


const RECOVERY_MESSAGE: Record<'kept' | 'not-kept', string> = {
  kept: "Your last session couldn't be restored, so the example is open. Your saved work is kept in this browser; nothing was deleted.",
  'not-kept': "Your last session couldn't be restored and a copy couldn't be kept, so autosave is off.",
}

const { restore, setMeta } = useMapStore.getState()

interface AppProps {
  boot?: { recovery: Recovery; unreadableText?: string; kind?: StoredFile['kind'] }
}

export function App({ boot = { recovery: 'none' } }: AppProps = {}) {
  // The sole branch point (ADR-02): both stores are read unconditionally — the inactive one never mutates,
  // since its UI never mounts — and `activeKind` (flipped by the chooser and by swap()) decides which renders.
  const [activeKind, setActiveKind] = useState<StoredFile['kind']>(() => boot.kind ?? 'hexagonal')
  const onionMap = useOnionStore((s) => s.map)
  // Onion's own layout is only ever read while its view is active (export, OnionStage) — skip it on a Hexagonal
  // render. Memoised on the map reference: the sizing search it runs (binary-search band growth × 1-3 radial
  // tracks × O(n²) overlap checks, twice — raw order vs the crossing-optimised order) is too expensive to redo on
  // every render a theme/legend/mode toggle causes without the document itself changing.
  const onionModel = useMemo(() => (activeKind === 'onion' ? layoutOnion(onionMap) : undefined), [activeKind, onionMap])
  const cleanMap = useCleanStore((s) => s.map)
  const cleanModel = useMemo(() => (activeKind === 'clean' ? layoutClean(cleanMap) : undefined), [activeKind, cleanMap])
  const map = useMapStore((s) => s.map)
  const hexId = useMapStore((s) => s.focus)
  // The undo snapshot every action below restores on request; each site takes it as-is or spreads `swap: true`.
  const before = { map, focus: hexId }
  const revision = useMapStore((s) => s.revision)
  const diagram = diagramOf(map, hexId)
  const multiHexagon = map.hexagons.length > 1
  const mode = usePreferencesStore((s) => s.mode)
  const legendInExport = usePreferencesStore((s) => s.legendInExport)
  const expanded = useViewStore((s) => s.expanded)
  const model = layoutMap(map, { mode, current: hexId, expanded })
  const [notice, setNotice] = useState<Notice | null>(null)
  // Its own slot, never touched by show()/startLinking: it stays until the user dismisses it (REQ-03.2),
  // whatever status toasts or link-mode hints come and go in the meantime.
  const [recoveryNotice, setRecoveryNotice] = useState<Notice | null>(() =>
    boot.recovery === 'none'
      ? null
      : { id: 0, tone: 'recovery', message: RECOVERY_MESSAGE[boot.recovery], download: boot.recovery === 'kept' ? boot.unreadableText : undefined },
  )
  const saveFailed = useSaveFailed((s) => s.failed)
  const noticeSeq = useRef(0)
  const growing = useViewStore((s) => s.growing)
  const exportScope = useViewStore((s) => s.exportScope)
  const choosingArchitecture = useViewStore((s) => s.choosingArchitecture)
  const linking = useViewStore((s) => s.linking)
  // Export scope (Hexagon vs Map) only exists for a multi-hexagon Hexagonal map (EXPORT-03.1) — Onion and Clean
  // are always one diagram, so neither scopes or carries a legend (neither has a legend panel at all). Resolved
  // once, here, so a third kind only ever touches this one branch instead of every read below it.
  const canScopeExport = activeKind === 'hexagonal' && multiHexagon
  const scoped = canScopeExport && exportScope === 'hexagon'
  const active =
    activeKind === 'onion'
      ? { file: onionMap, bounds: onionModel!.bounds, title: onionMap.title, scoped: false, legend: legendInExport }
      : activeKind === 'clean'
        ? { file: cleanMap, bounds: cleanModel!.bounds, title: cleanMap.title, scoped: false, legend: legendInExport }
        : { file: map, bounds: scoped ? hexagonBounds(currentHexagon(model, hexId)) : model.bounds, title: scoped ? diagram.title || UNTITLED_HEXAGON : map.title, scoped, legend: legendInExport }
  const undoLast = useUndoHistory({
    activeFile: active.file,
    hexId,
    onUnavailable: () => show({ tone: 'status', message: "Undo isn't available: the document changed in ways Undo doesn't track." }),
    onRestored: (entry) => {
      // The restored document's own kind IS the view to bring back (REQ-09) — a same-kind edit's undo
      // just re-sets the kind already on screen, a no-op render.
      setActiveKind(entry.map.kind)
      setNotice((n) => (n?.undo === entry ? null : n))
      // Undoing a grow is the same restore as Esc-while-naming — close the field too.
      useViewStore.setState({ growing: null })
    },
  })
  const show = (next: Omit<Notice, 'id'>) => {
    if (next.undo) useHistoryStore.getState().record(next.undo)
    setNotice({ ...next, id: ++noticeSeq.current })
  }
  // The one undo mechanism (REQ-09), instantiated once per kind: OnionEditor/OnionStage and CleanEditor/CleanStage
  // each get the SAME callback for every action they offer, so a dependency created from the canvas gesture
  // toasts identically to one created from the editor's own form (ADR-02).
  const mutateOnion = (message: string, before: OnionFile) => show({ tone: 'status', message, undo: { map: before } })
  const mutateClean = (message: string, before: CleanFile) => show({ tone: 'status', message, undo: { map: before } })
  // Retracts the toast for an add that was immediately cancelled (naming Esc'd out) without offering it as an
  // undo step — the add already unwound itself; mirrors onNamingCancel's own setNotice(null) below.
  const clearNotice = () => {
    useHistoryStore.getState().dropUndo(notice?.undo)
    setNotice(null)
  }
  // Onion and Clean have no ports or adapters — each kind builds the legend it actually draws (ADR-01), all
  // three sharing the one open/close and "include in export" state above.
  const legend = activeKind === 'onion' ? legendForOnion(onionMap) : activeKind === 'clean' ? legendForClean(cleanMap) : legendFor(diagram)
  // The document being replaced (REQ-09), captured before any store mutation whatever kind is currently active —
  // Undo restores it into its own store (`restoreUndo`) and the toast's onUndo below flips `activeKind` back from
  // `undo.map.kind`, so the view returns with it. One snapshot, one restore path, for every swap direction.
  const beforeSwap: UndoSnapshot = activeKind === 'onion' ? { map: onionMap, swap: true } : activeKind === 'clean' ? { map: cleanMap, swap: true } : { ...before, swap: true }

  const { swap, completeNew, parseSource, parseFile, importFile } = useOpenDocument({ beforeSwap, show, setActiveKind })

  const nameOf = (ref: string) => {
    const collection = collectionOf(diagram, ref)
    const items: { id: string; name: string }[] = collection ? diagram[collection] : []
    return items.find((i) => i.id === ref)?.name ?? ''
  }

  // A sticky toast (DEL-02) clears itself the moment the map next changes for any OTHER reason — not on a timer.
  if (notice?.sticky && notice.staleWhenMapIsnt && map !== notice.staleWhenMapIsnt) setNotice(null)

  const startLinking = (ref: string | null) => {
    // The hint replaces any status toast; an error stays until it is read.
    if (ref) setNotice((n) => (n?.tone === 'error' ? n : null))
    useViewStore.setState({ linking: ref })
  }
  useShareLinkOnMount({ parseSource, swap, showError: (message) => show({ tone: 'error', message }) })

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

  const { svgRef, exportAs } = useExport(active, legend, hexId, show)

  return (
    <>
      <Toolbar
        showScope={canScopeExport}
        onNew={() => useViewStore.setState({ choosingArchitecture: true })}
        onExample={(id) => {
          const example = EXAMPLES.find((x) => x.id === id)!
          swap(example.map, `Loaded the ${example.label} example.`)
        }}
        onOpen={importFile}
        onCopyLink={handleCopyLink}
        onExport={exportAs}
        canExpandAll={activeKind === 'hexagonal' && canCompact(map.hexagons.length)}
      />
      {activeKind === 'hexagonal' && (
        <HexagonalWorkspace
          legend={legend}
          fieldSession={{ begin: useHistoryStore.getState().beginField, end: () => useHistoryStore.getState().endField() }}
          show={show}
          nameOf={nameOf}
          parseFile={parseFile}
          onRecord={useHistoryStore.getState().record}
          model={model}
          map={map}
          hexId={hexId}
          diagram={diagram}
          revision={revision}
          title={diagram.title}
          svgRef={svgRef}
          onLinking={startLinking}
          onNamed={(title) => {
            useHistoryStore.getState().absorbEdit()
            setMeta(growing!.hexId, { title })
            useViewStore.setState({ growing: null })
          }}
          onNamingCancel={() => {
            useHistoryStore.getState().dropUndo(growing!.before)
            restore(growing!.before)
            useViewStore.setState({ growing: null })
            setNotice(null)
          }}
        />
      )}
      {activeKind === 'onion' && (
        <OnionWorkspace
          legend={legend}
          model={onionModel!}
          doc={onionMap}
          svgRef={svgRef}
          onReject={(message) => show({ tone: 'error', message })}
          onMutate={mutateOnion}
          onNamed={useHistoryStore.getState().absorbEdit}
          onCancelMutate={clearNotice}
        />
      )}
      {activeKind === 'clean' && (
        <CleanWorkspace
          legend={legend}
          model={cleanModel!}
          doc={cleanMap}
          svgRef={svgRef}
          onReject={(message) => show({ tone: 'error', message })}
          onMutate={mutateClean}
          onNamed={useHistoryStore.getState().absorbEdit}
          onCancelMutate={clearNotice}
        />
      )}
      {choosingArchitecture && <ArchitectureChoiceDialog onChoose={completeNew} onCancel={() => useViewStore.setState({ choosingArchitecture: false })} />}
      {linking && <Toast key={`link:${linking}`} sticky message={`Choose a target for ${nameOf(linking)} · Esc to cancel`} onClose={() => useViewStore.setState({ linking: null })} />}
      {!linking && notice?.tone === 'status' && (
        <Toast
          key={notice.id}
          message={notice.message}
          sticky={notice.sticky}
          onUndo={notice.undo && undoLast}
          onClose={() => setNotice(null)}
        />
      )}
      <NoticeColumn notice={notice} saveFailed={saveFailed} recoveryNotice={recoveryNotice} onDismiss={() => setNotice(null)} onDismissRecovery={() => setRecoveryNotice(null)} />
    </>
  )
}
