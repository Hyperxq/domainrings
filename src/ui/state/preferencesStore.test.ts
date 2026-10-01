import { describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from './preferencesStore'

const { rehydrate } = usePreferencesStore.persist
const root = document.documentElement

describe('preferences store', () => {
  it('reads each preference from its own raw key', () => {
    localStorage.setItem('domainrings:overview', 'true')
    localStorage.setItem('domainrings:guides', 'false')
    localStorage.setItem('domainrings:legend-open', 'true')
    localStorage.setItem('domainrings:theme', 'dark')
    localStorage.setItem('domainrings:palette', 'purple')
    rehydrate()
    expect(usePreferencesStore.getState()).toMatchObject({ mode: 'overview', guides: false, legendOpen: true, theme: 'dark', palette: 'purple', highlight: true, legendInExport: true })
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.palette).toBe('purple')
  })

  it('keeps view-only off by default and persists it under its own raw key', () => {
    expect(usePreferencesStore.getState().viewOnly).toBe(false)
    usePreferencesStore.setState({ viewOnly: true })
    expect(localStorage.getItem('domainrings:view-only')).toBe('true')
    usePreferencesStore.setState({ viewOnly: false, highlight: true })
    rehydrate()
    expect(usePreferencesStore.getState().viewOnly).toBe(false)
    localStorage.setItem('domainrings:view-only', 'true')
    rehydrate()
    expect(usePreferencesStore.getState().viewOnly).toBe(true)
  })

  it('ignores a stored theme or palette it does not know', () => {
    localStorage.setItem('domainrings:theme', 'sepia')
    localStorage.setItem('domainrings:palette', 'toString')
    rehydrate()
    expect(usePreferencesStore.getState()).toMatchObject({ theme: 'system', palette: 'default' })
    expect(root.dataset.theme).toBeUndefined()
    expect(root.dataset.palette).toBeUndefined()
  })

  it('falls back to the default palette for a stored palette that no longer exists', () => {
    localStorage.setItem('domainrings:palette', 'ink')
    rehydrate()
    expect(usePreferencesStore.getState().palette).toBe('default')
    expect(root.dataset.palette).toBeUndefined()
  })

  it('writes only the preference that changed, as raw text', () => {
    usePreferencesStore.setState({ dependents: true })
    expect(localStorage.getItem('domainrings:dependents')).toBe('true')
    expect(localStorage).toHaveLength(1)
    usePreferencesStore.setState({ mode: 'overview' })
    expect(localStorage.getItem('domainrings:overview')).toBe('true')
  })

  it('removes the stored theme and palette when they return to their defaults', () => {
    usePreferencesStore.setState({ theme: 'light', palette: 'cool' })
    expect(localStorage.getItem('domainrings:theme')).toBe('light')
    usePreferencesStore.setState({ theme: 'system', palette: 'default' })
    expect(localStorage).toHaveLength(0)
  })

  it('keeps working for the session when storage is blocked', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    usePreferencesStore.setState({ guides: false })
    expect(usePreferencesStore.getState().guides).toBe(false)
    blocked.mockRestore()
  })
})
