import { create } from 'zustand'
import { browserStorage, loadDiagram } from './persistence'
import { REFERENCES, type CollectionKey, type Diagram, type Linkable } from './schema'

export type Item<K extends CollectionKey> = Diagram[K][number]
type Meta = Partial<Pick<Diagram, 'title' | 'subtitle' | 'kind' | 'composition' | 'layers'>>

const NEW_ITEM: { [K in CollectionKey]: Omit<Item<K>, 'id'> } = {
  domain: { name: 'NewEntity', type: 'entity' },
  useCases: { name: 'NewUseCase' },
  ports: { name: 'newPort', side: 'driving' },
  adapters: { name: 'NewAdapter' },
  actors: { name: 'New actor' },
  externals: { name: 'New system' },
}

interface DiagramState {
  diagram: Diagram
  /** Bumps when the whole diagram is swapped, so the stage knows to refit. */
  revision: number
  replace: (diagram: Diagram) => void
  setMeta: (meta: Meta) => void
  addItem: <K extends CollectionKey>(key: K, patch?: Partial<Omit<Item<K>, 'id'>>) => string
  updateItem: <K extends CollectionKey>(key: K, id: string, patch: Partial<Omit<Item<K>, 'id'>>) => void
  removeItem: (key: CollectionKey, id: string) => void
}

// Computed keys widen to an index signature; this is the one place the collection type is re-asserted.
const withCollection = <K extends CollectionKey>(d: Diagram, key: K, items: Item<K>[]): Diagram =>
  ({ ...d, [key]: items }) as Diagram

export const useDiagramStore = create<DiagramState>()((set) => {
  const edit = (fn: (d: Diagram) => Diagram) => set((s) => ({ diagram: fn(s.diagram) }))
  return {
    diagram: loadDiagram(browserStorage()),
    revision: 0,
    replace: (diagram) => set((s) => ({ diagram, revision: s.revision + 1 })),
    setMeta: (meta) => edit((d) => ({ ...d, ...meta })),
    addItem: (key, patch) => {
      const id = `${key}-${crypto.randomUUID().slice(0, 8)}`
      edit((d) => withCollection(d, key, [...d[key], { ...NEW_ITEM[key], ...patch, id } as Item<typeof key>]))
      return id
    },
    updateItem: (key, id, patch) =>
      edit((d) => withCollection(d, key, (d[key] as Item<typeof key>[]).map((i) => (i.id === id ? { ...i, ...patch } : i)))),
    removeItem: (key, id) =>
      edit((d) => {
        let next = withCollection(d, key, (d[key] as Item<typeof key>[]).filter((i) => i.id !== id))
        for (const [owner, field, target] of REFERENCES) {
          if (target !== key) continue
          const items: Linkable[] = next[owner]
          next = withCollection(next, owner, items.map((i) => (i[field] === id ? { ...i, [field]: undefined } : i)) as Item<typeof owner>[])
        }
        return next
      }),
  }
})
