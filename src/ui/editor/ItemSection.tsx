import type { ReactNode } from 'react'
import type { CollectionKey, HexaMap, Link } from '../../model/schema'
import { useMapStore, type Item } from '../../model/store'
import { Fold } from '../Fold'
import { Icon } from '../Icon'
import { sessionOf, type FieldSession, type OnPrune, type OnRecord } from './fieldSession'

const { addItem, updateItem, removeItem } = useMapStore.getState()

type Patch<K extends CollectionKey> = Partial<Omit<Item<K>, 'id'>>

interface ItemSectionProps<K extends CollectionKey> {
  hexId: string
  map: HexaMap
  onPrune: OnPrune
  onRecord: OnRecord
  fieldSession: FieldSession
  collection: K
  items: Item<K>[]
  title: string
  noun: string
  empty: string
  fields?: (item: Item<K>, update: (patch: Patch<K>) => void) => ReactNode
  /** Replaces the single "+". */
  actions?: ReactNode
  /** Cards listed under subheadings instead of one list. */
  groups?: { key: string; title: string; items: Item<K>[] }[]
}

export function ItemSection<K extends CollectionKey>({ hexId, map, onPrune, onRecord, fieldSession, collection, items, title, noun, empty, fields, actions, groups }: ItemSectionProps<K>) {
  const session = sessionOf(fieldSession)
  const before = { map, focus: hexId }
  // A discrete edit is its own step: the prune toast when it broke links, a silent step otherwise.
  const report = (pruned: Link[]) => (pruned.length ? onPrune(pruned, before) : onRecord(before))
  const add = (
    <button
      type="button"
      className="icon-button small"
      aria-label={`Add ${noun}`}
      title={`Add ${noun}`}
      onClick={() => {
        onRecord(before)
        addItem(hexId, collection)
      }}
    >
      <Icon name="plus" />
    </button>
  )
  const cards = (list: Item<K>[]) => (
        <ul className="items">
          {list.map((item) => {
            const update = (patch: Patch<K>) => report(updateItem(hexId, collection, item.id, patch))
            const type = (patch: Patch<K>) => updateItem(hexId, collection, item.id, patch)
            return (
              <li key={item.id} className="item" data-item-id={item.id}>
                <input className="name" aria-label={`${noun} name`} value={item.name} onChange={(e) => type({ name: e.target.value } as Patch<K>)} {...session} />
                <button
                  type="button"
                  className="icon-button small remove"
                  aria-label={`Remove ${noun} ${item.name}`}
                  title={`Remove ${noun}`}
                  onClick={() => report(removeItem(hexId, collection, item.id))}
                >
                  <Icon name="close" />
                </button>
                {fields?.(item, update)}
                <details className="note">
                  <summary>Note</summary>
                  <textarea aria-label={`Note for ${item.name}`} rows={2} value={item.note ?? ''} onChange={(e) => type({ note: e.target.value || undefined } as Patch<K>)} {...session} />
                </details>
              </li>
            )
          })}
        </ul>
  )
  return (
    <Fold id={collection} title={title} count={items.length} actions={actions ?? add}>
      {!items.length ? (
        <p className="empty">{empty}</p>
      ) : groups ? (
        groups.map((g) => (
          <div key={g.key} className="port-group">
            <h3>
              {g.title} · {g.items.length}
            </h3>
            {cards(g.items)}
          </div>
        ))
      ) : (
        cards(items)
      )}
    </Fold>
  )
}
