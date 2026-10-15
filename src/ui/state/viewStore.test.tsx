import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { EXAMPLE_DIAGRAM, TWO_SLICES_MAP } from '../../model/example'
import { toMap } from '../../model/hexa'
import { useMapStore } from '../../model/store'
import { usePreferencesStore } from './preferencesStore'
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

  it('reveal leaves the editor closed while view-only is on', () => {
    useViewStore.setState({ editorOpen: false })
    usePreferencesStore.setState({ viewOnly: true })
    useViewStore.getState().reveal('card', false)
    expect(useViewStore.getState().editorOpen).toBe(false)
  })

  it('reveal on a use case focuses its flow and selects the inspector name field', () => {
    function Inspector() {
      const flow = useViewStore((s) => s.focusedFlow)
      return flow ? <input aria-label="Flow name" defaultValue="Name" /> : null
    }
    usePreferencesStore.setState({ viewOnly: false })
    useViewStore.setState({ focusedFlow: null })
    render(<Inspector />)

    useViewStore.getState().reveal(EXAMPLE_DIAGRAM.useCases[0].id, true, 'h1')

    expect(useViewStore.getState().focusedFlow).toBe(EXAMPLE_DIAGRAM.useCases[0].id)
    const field = document.activeElement as HTMLInputElement
    expect(field.getAttribute('aria-label')).toBe('Flow name')
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 4])
  })

  it("reveal on another hexagon's use case focuses that hexagon and its flow", () => {
    usePreferencesStore.setState({ viewOnly: false })
    useMapStore.getState().replace(TWO_SLICES_MAP)
    useMapStore.getState().setFocus('h1')
    useViewStore.getState().reveal('uc-receive', false, 'h2')
    expect(useMapStore.getState().focus).toBe('h2')
    expect(useViewStore.getState().focusedFlow).toBe('uc-receive')
  })

  it('reveal on a use case only focuses the flow in Edit mode', () => {
    usePreferencesStore.setState({ viewOnly: true })
    useViewStore.setState({ focusedFlow: null })
    useViewStore.getState().reveal(EXAMPLE_DIAGRAM.useCases[0].id, true, 'h1')
    expect(useViewStore.getState().focusedFlow).toBeNull()
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

  it('requestFit bumps the fit request so a watcher can tell each press apart', () => {
    const before = useViewStore.getState().fitRequest
    useViewStore.getState().requestFit()
    useViewStore.getState().requestFit()
    expect(useViewStore.getState().fitRequest).toBe(before + 2)
  })
})

describe('hoveredFlow', () => {
  it('is set and cleared through hoverFlow, and a swapped map clears it', () => {
    useViewStore.getState().hoverFlow('uc-submit')
    expect(useViewStore.getState().hoveredFlow).toBe('uc-submit')
    useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
    expect(useViewStore.getState().hoveredFlow).toBeNull()
    useViewStore.getState().hoverFlow('uc-submit')
    useViewStore.getState().hoverFlow(null)
    expect(useViewStore.getState().hoveredFlow).toBeNull()
  })
})

describe('focusedFlow', () => {
  const twoHex = () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    useMapStore.getState().replace({ ...map, hexagons: [...map.hexagons, { ...map.hexagons[0], id: 'h2', cell: { q: 1, r: 0 } }] })
  }

  it('is set and cleared through focusFlow', () => {
    expect(useViewStore.getState().focusedFlow).toBeNull()
    useViewStore.getState().focusFlow('uc-submit')
    expect(useViewStore.getState().focusedFlow).toBe('uc-submit')
    useViewStore.getState().focusFlow(null)
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it('clears when another hexagon becomes current', () => {
    twoHex()
    useViewStore.getState().focusFlow('uc-submit')
    useMapStore.getState().setFocus('h2')
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it('clears when its use case is deleted, and when the map is swapped', () => {
    useViewStore.getState().focusFlow('uc-submit')
    useMapStore.getState().removeItem('h1', 'useCases', 'uc-submit')
    expect(useViewStore.getState().focusedFlow).toBeNull()
    useViewStore.getState().focusFlow('x')
    useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })

  it('clears when switching to Edit mode', () => {
    usePreferencesStore.setState({ viewOnly: true })
    useViewStore.getState().focusFlow('uc-submit')
    usePreferencesStore.setState({ viewOnly: false })
    expect(useViewStore.getState().focusedFlow).toBeNull()
  })
})

describe('presentStep', () => {
  const walking = () => {
    useViewStore.getState().focusFlow('uc-submit')
    useViewStore.getState().present(2)
  }

  it('is set through present and cleared when the flow changes', () => {
    walking()
    expect(useViewStore.getState().presentStep).toBe(2)
    useViewStore.getState().focusFlow(null)
    expect(useViewStore.getState().presentStep).toBeNull()
  })

  it('clears with the flow: another hexagon, a deleted use case, a swapped map, Edit mode', () => {
    const map = toMap(EXAMPLE_DIAGRAM)
    useMapStore.getState().replace({ ...map, hexagons: [...map.hexagons, { ...map.hexagons[0], id: 'h2', cell: { q: 1, r: 0 } }] })
    walking()
    useMapStore.getState().setFocus('h2')
    expect(useViewStore.getState().presentStep).toBeNull()
    useMapStore.getState().setFocus('h1')
    walking()
    useMapStore.getState().removeItem('h1', 'useCases', 'uc-submit')
    expect(useViewStore.getState().presentStep).toBeNull()
    walking()
    useMapStore.getState().replace(toMap(EXAMPLE_DIAGRAM))
    expect(useViewStore.getState().presentStep).toBeNull()
    usePreferencesStore.setState({ viewOnly: true })
    walking()
    usePreferencesStore.setState({ viewOnly: false })
    expect(useViewStore.getState().presentStep).toBeNull()
  })
})
