import type { Dispatch, SetStateAction } from 'react'
import { newCleanMap, newOnionMap, parseHexa, toMap } from '../model/hexa'
import { useCleanStore } from '../model/cleanStore'
import { useOnionStore } from '../model/onionStore'
import { useMapStore } from '../model/store'
import type { StoredFile } from '../model/fileFormat'
import type { ArchitectureChoice } from './ArchitectureChoiceDialog'
import type { Notice, UndoSnapshot } from './notice'
import { useViewStore } from './state/viewStore'

const { replace } = useMapStore.getState()
const { replace: replaceOnion } = useOnionStore.getState()
const { replace: replaceClean } = useCleanStore.getState()

interface OpenDocumentContext {
  /** The document being replaced, captured before any store mutation whatever kind is active. */
  beforeSwap: UndoSnapshot
  show: (next: Omit<Notice, 'id'>) => void
  setActiveKind: Dispatch<SetStateAction<StoredFile['kind']>>
}

/** Turns a new, opened or loaded document into the active one: routes it to the store of its own kind and flips the view. */
export function useOpenDocument({ beforeSwap, show, setActiveKind }: OpenDocumentContext) {
  // The one kind-dispatch outside the render fork (ADR-02): routes a newly created/opened/loaded document to
  // whichever store matches its own kind and flips the active view.
  const swap = (file: StoredFile, message: string) => {
    show({ tone: 'status', message, undo: beforeSwap })
    if (file.kind === 'onion') {
      replaceOnion(file)
      setActiveKind('onion')
      return
    }
    if (file.kind === 'clean') {
      replaceClean(file)
      setActiveKind('clean')
      return
    }
    replace(file)
    setActiveKind('hexagonal')
    useViewStore.setState({ exportScope: 'map' })
  }

  // REQ-01: the one-time, permanent architecture choice for a brand-new file — Toolbar's New button opens this
  // instead of creating a Hexagonal map directly.
  const completeNew = (kind: ArchitectureChoice) => {
    useViewStore.setState({ choosingArchitecture: false })
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

  return { swap, completeNew, parseSource, parseFile, importFile }
}
