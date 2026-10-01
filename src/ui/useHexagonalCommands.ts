import { collectionOf, type LinkChoice } from '../model/links'
import { contextName, linkEndLabel, occupiedContexts, UNTITLED_HEXAGON, type Destination, type LinkPatch } from '../model/map'
import type { Diagram as DiagramModel, HexaMap, Link, LinkEnd, Wall } from '../model/schema'
import { useMapStore } from '../model/store'
import { CHOICES } from './ArchitectureChoiceDialog'
import type { Notice } from './notice'

const { removeItem, updateItem, addHexagon, importHexagon, removeHexagon, moveToContext, addLink, updateLink: updateLinkAction, removeLink: removeLinkAction } = useMapStore.getState()

/** Only Onion/Clean ever reach this (Hexagonal is excluded before the caller needs it) — genuinely closed to those
 * two labels, not a general-purpose English article rule. */
const article = (label: string) => (/^[aeiou]/i.test(label) ? 'an' : 'a')

interface HexagonalCommandsContext {
  map: HexaMap
  hexId: string
  diagram: DiagramModel
  show: (next: Omit<Notice, 'id'>) => void
  nameOf: (ref: string) => string
  setGrowing: (growing: { hexId: string; before: { map: HexaMap; focus: string } }) => void
  setLinking: (ref: null) => void
  /** Structural, so this module never names the document-root union (ADR-01). */
  parseFile: (file: File) => Promise<HexaMap | { kind: 'onion' | 'clean' } | undefined>
}

/** The Hexagonal edits that toast an undoable step: each captures the undo snapshot `before` as this render saw it. */
export function useHexagonalCommands({ map, hexId, diagram, show, nameOf, setGrowing, setLinking, parseFile }: HexagonalCommandsContext) {
  // The undo snapshot every command below restores on request.
  const before = { map, focus: hexId }

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

  const completeGrow = (side: Wall | undefined, context: Destination) => {
    const newHexId = addHexagon(hexId, { side, context })
    if (!newHexId) return
    const grownMap = useMapStore.getState().map
    const label = contextName(grownMap, grownMap.hexagons.find((h) => h.id === newHexId)!.contextId)
    show({ tone: 'status', message: `Added ${UNTITLED_HEXAGON} to ${label}. It is now the current hexagon.`, undo: before })
    setGrowing({ hexId: newHexId, before })
  }

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

  const handleMoveToContext = (contextId: string | undefined) => {
    moveToContext(hexId, contextId)
    const after = useMapStore.getState().map
    if (after === map) return
    const label = contextName(after, after.hexagons.find((h) => h.id === hexId)!.contextId)
    show({ tone: 'status', message: `Moved ${diagram.title || UNTITLED_HEXAGON} to ${label}.`, undo: before })
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

  const completeImport = (file: HexaMap, context: Destination, fileName: string) => {
    // Read at commit time: the map may have changed while the file was read or the destination question was open.
    const { map: beforeMap, focus: beforeFocus } = useMapStore.getState()
    const newHexId = importHexagon(file, { context })
    const imported = useMapStore.getState().map.hexagons.find((h) => h.id === newHexId)!
    const contexts = occupiedContexts(file).length
    const message =
      file.hexagons.length > 1
        ? `Added ${file.hexagons.length} hexagons and ${contexts} bounded ${contexts === 1 ? 'context' : 'contexts'} from ${fileName}.`
        : `Added ${imported.title || UNTITLED_HEXAGON} from ${fileName}.`
    show({ tone: 'status', message, undo: { map: beforeMap, focus: beforeFocus } })
  }

  // "Add hexagon from file…" (IMP-01..07): only a Hexagonal source has hexagons to add; refuses an Onion source
  // (REQ-03). A several-hexagon file merges at once; a one-hexagon file hands back the step that imports it once
  // the author has picked a destination, so the question is only asked of a file that needs it.
  const handleAddFromFile = async (file: File): Promise<((context: Destination) => void) | undefined> => {
    const parsed = await parseFile(file)
    if (!parsed) return undefined
    if (parsed.kind !== 'hexagonal') {
      const kindLabel = CHOICES.find((c) => c.kind === parsed.kind)!.label
      show({ tone: 'error', message: `${file.name} is ${article(kindLabel)} ${kindLabel} file. Add hexagon from file… only accepts a Hexagonal map.` })
      return undefined
    }
    if (parsed.hexagons.length > 1) {
      completeImport(parsed, 'new', file.name)
      return undefined
    }
    return (context) => completeImport(parsed, context, file.name)
  }

  return { pruneToast, deleteItem, completeGrow, handleRenameContext, handleDelete, handleMoveToContext, createLink, editLink, deleteLink, link, handleAddFromFile }
}
