import { describe, expect, it, vi } from 'vitest'
import { openForReading, usePreferencesStore } from './preferencesStore'

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

  it('shows planned items by default and persists the choice under its own raw key', () => {
    expect(usePreferencesStore.getState().showPlanned).toBe(true)
    expect(localStorage).toHaveLength(0)
    usePreferencesStore.setState({ showPlanned: false })
    expect(localStorage.getItem('domainrings:show-planned')).toBe('false')
    usePreferencesStore.setState({ showPlanned: true })
    rehydrate()
    expect(usePreferencesStore.getState().showPlanned).toBe(true)
    localStorage.setItem('domainrings:show-planned', 'false')
    rehydrate()
    expect(usePreferencesStore.getState().showPlanned).toBe(false)
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

  describe('opening for reading', () => {
    it('applies view-only and the chosen mode without saving them', () => {
      openForReading('overview')
      expect(usePreferencesStore.getState()).toMatchObject({ viewOnly: true, mode: 'overview' })
      expect(localStorage).toHaveLength(0)
      usePreferencesStore.setState({ dependents: true })
      expect(localStorage).toHaveLength(1)
      expect(localStorage.getItem('domainrings:dependents')).toBe('true')
    })

    it('leaves what the reader had saved in place', () => {
      localStorage.setItem('domainrings:view-only', 'true')
      rehydrate()
      openForReading('detailed')
      usePreferencesStore.setState({ guides: false })
      expect(localStorage.getItem('domainrings:view-only')).toBe('true')
      expect(localStorage.getItem('domainrings:overview')).toBeNull()
    })

    it('saves a field the reader changes during the visit', () => {
      localStorage.setItem('domainrings:view-only', 'true')
      rehydrate()
      openForReading('overview')
      usePreferencesStore.setState({ viewOnly: false, mode: 'detailed' })
      expect(localStorage.getItem('domainrings:view-only')).toBe('false')
      usePreferencesStore.setState({ mode: 'overview' })
      expect(localStorage.getItem('domainrings:overview')).toBe('true')
    })
  })
})
