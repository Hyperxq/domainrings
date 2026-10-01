import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { EXAMPLE_DIAGRAM } from '../../model/example'
import { toMap } from '../../model/hexa'
import { useMapStore } from '../../model/store'
import { useViewStore } from './viewStore'

beforeEach(() => useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM)))
afterEach(cleanup)

describe('view store', () => {
  it('reveal opens the collapsed editor synchronously, so the card exists when it scrolls to it', () => {
    function Panel() {
      const open = useViewStore((s) => s.editorOpen)
      return open ? <div data-item-id="card" /> : null
    }
    useViewStore.setState({ editorOpen: false })
    render(<Panel />)
    expect(document.querySelector('[data-item-id="card"]')).toBeNull()

    useViewStore.getState().reveal('card', false)

    expect(document.querySelector('[data-item-id="card"]')).not.toBeNull()
  })

  it('toggles a hexagon in and out of the expanded set', () => {
    useViewStore.getState().toggleExpanded('h1')
    expect([...useViewStore.getState().expanded]).toEqual(['h1'])
    useViewStore.getState().toggleExpanded('h1')
    expect([...useViewStore.getState().expanded]).toEqual([])
  })

  it('forgets the expanded hexagons and link mode when the map is replaced', () => {
    useViewStore.setState({ expanded: new Set(['h1']), linking: EXAMPLE_DIAGRAM.ports[0].id })
    useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
    expect(useViewStore.getState().expanded.size).toBe(0)
    expect(useViewStore.getState().linking).toBeNull()
  })

  it('ends link mode once the element being linked is gone, and keeps it otherwise', () => {
    const [first, second] = EXAMPLE_DIAGRAM.ports
    useViewStore.setState({ linking: first.id })
    useMapStore.getState().updateItem(useMapStore.getState().focus, 'ports', second.id, { name: 'Renamed' })
    expect(useViewStore.getState().linking).toBe(first.id)
    useMapStore.getState().removeItem(useMapStore.getState().focus, 'ports', first.id)
    expect(useViewStore.getState().linking).toBeNull()
  })
})
