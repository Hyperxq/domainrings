import { EXAMPLES } from '../model/example'
import type { LayoutMode } from '../layout/layout'
import { useEffect, useRef } from 'react'
import { ChoiceMenu } from './ChoiceMenu'
import { Icon } from './Icon'
import { typing } from './keys'
import type { ExportFormat } from './useExport'
import { PALETTES, type PaletteId } from './palette'
import { usePreferencesStore, type ThemeChoice } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const REPOSITORY_URL = 'https://github.com/Hyperxq/domainrings'


interface ToolbarProps {
  onNew: () => void
  onExample: (id: (typeof EXAMPLES)[number]['id']) => void
  /** Replaces the whole map — distinct from Editor's "Add subdomain from file…", which adds one hexagon. */
  onOpen: (file: File) => void
  /** Always copies the whole map (REQ-05), regardless of the export scope selection. */
  onCopyLink: () => void
  onExport: (format: ExportFormat) => void
  /** Only a multi-hexagon map has more than one thing to export (EXPORT-03) — a single hexagon has nothing to choose between. */
  showScope: boolean
  /** The Planned switch only has something to show or hide once the map holds a planned item. */
  hasPlanned: boolean
}

const MODES = ['overview', 'detailed'] as const
const EDITING = [
  { label: 'View', viewOnly: true },
  { label: 'Edit', viewOnly: false },
] as const
const VIEW_SWITCHES = [
  { id: 'guides', label: 'Corridor guides' },
  { id: 'highlight', label: 'Dim other flows on hover' },
  { id: 'dependents', label: 'Dependents', description: 'Emphasize what depends on the selection, not what it depends on' },
  { id: 'showPlanned', label: 'Planned', description: 'Show what is not built yet; off hides it from the canvas and image exports' },
] as const
const MODE_LABEL: Record<LayoutMode, string> = { overview: 'Overview', detailed: 'Detailed' }
const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function Toolbar({ onNew, onExample, onOpen, onCopyLink, onExport, showScope, hasPlanned }: ToolbarProps) {
  const preferences = usePreferencesStore()
  const { mode, theme: themeChoice, palette, viewOnly } = preferences
  const exportScope = useViewStore((s) => s.exportScope)
  const openFile = useRef<HTMLInputElement>(null)
  const mod = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'
  useEffect(() => {
    if (viewOnly) return
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (key !== 'o' && key !== 's') || e.defaultPrevented || typing(e.target)) return
      if (document.querySelector('[role="menu"], dialog[open]')) return
      e.preventDefault()
      if (key === 'o') openFile.current?.click()
      else onExport('hexa')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [viewOnly, onExport])
  return (
    <header className="island toolbar">
      <h1 className="wordmark">domainrings</h1>

      <span className="divider" aria-hidden="true" />

      <span
        className="segmented"
        role="radiogroup"
        aria-label="Detail level"
        onKeyDown={(e) => {
          if (!e.key.startsWith('Arrow')) return
          e.preventDefault()
          const next = MODES[(MODES.indexOf(mode) + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + MODES.length) % MODES.length]
          usePreferencesStore.setState({ mode: next })
          e.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus()
        }}
      >
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} data-mode={m} className="segmented-option" onClick={() => usePreferencesStore.setState({ mode: m })}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </span>

      <span className="divider" aria-hidden="true" />

      <span
        className="segmented"
        role="radiogroup"
        aria-label="Editing mode"
        onKeyDown={(e) => {
          if (!e.key.startsWith('Arrow')) return
          e.preventDefault()
          usePreferencesStore.setState({ viewOnly: !viewOnly })
          e.currentTarget.querySelector<HTMLElement>(`[data-view-only="${!viewOnly}"]`)?.focus()
        }}
      >
        {EDITING.map((o) => (
          <button key={o.label} type="button" role="radio" aria-checked={viewOnly === o.viewOnly} tabIndex={viewOnly === o.viewOnly ? 0 : -1} data-view-only={o.viewOnly} className="segmented-option" onClick={() => usePreferencesStore.setState({ viewOnly: o.viewOnly })}>
            {o.label}
          </button>
        ))}
      </span>

      <ChoiceMenu
        label={<Icon name="sliders" />}
        ariaLabel="View options"
        className="icon-trigger"
        align="end"
        stayOpen
        choices={[
          ...VIEW_SWITCHES.filter((s) => hasPlanned || s.id !== 'showPlanned').map(({ id, label, ...hint }) => ({ id, label, ...hint, checked: preferences[id], control: 'switch' as const })),
          ...(['light', 'dark', 'system'] as const).map((id) => ({ id, label: THEME_LABEL[id], checked: themeChoice === id, control: 'radio' as const, group: 'Theme' })),
          ...(Object.keys(PALETTES) as PaletteId[]).map((id) => ({ id, label: PALETTES[id].label, description: PALETTES[id].description, checked: palette === id, group: 'Palette' })),
        ]}
        onChoose={(id) =>
          id === 'light' || id === 'dark' || id === 'system'
            ? usePreferencesStore.setState({ theme: id })
            : id in PALETTES
              ? usePreferencesStore.setState({ palette: id as PaletteId })
              : usePreferencesStore.setState({ [id]: !preferences[id as (typeof VIEW_SWITCHES)[number]['id']] })
        }
      />

      {!viewOnly && (
        <>
          <ChoiceMenu
            label={
              <>
                File
                <Icon name="chevron" />
              </>
            }
            choices={[
              { id: 'new', label: 'New', control: 'action', icon: 'new' },
              { id: 'open', label: 'Open .hexa…', control: 'action', icon: 'upload', shortcut: `${mod}O` },
              { id: 'save', label: 'Save .hexa', control: 'action', icon: 'download', shortcut: `${mod}S` },
              {
                id: 'examples',
                label: 'Start from an example',
                submenu: EXAMPLES.map((x) => ({ id: x.id, label: x.label, control: 'action' as const, group: x.architecture })),
              },
            ]}
            onChoose={(id) => (id === 'new' ? onNew() : id === 'open' ? openFile.current?.click() : id === 'save' ? onExport('hexa') : onExample(id))}
          />
          <input
            ref={openFile}
            type="file"
            accept=".hexa,application/json"
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Open a .hexa file, replacing the map"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              if (file) onOpen(file)
              e.currentTarget.value = ''
            }}
          />
        </>
      )}
      <ChoiceMenu
        label={
          <>
            Share
            <Icon name="chevron" />
          </>
        }
        choices={[
          { id: 'copy-link', label: 'Copy link', control: 'action', icon: 'link' },
          ...(showScope ? [{ id: 'scope' as const, label: 'Only the current hexagon', checked: exportScope === 'hexagon', control: 'switch' as const, group: 'Export image' }] : []),
          { id: 'png', label: 'Download PNG', control: 'action', group: 'Export image' },
          { id: 'svg', label: 'Download SVG', control: 'action', group: 'Export image' },
          { id: 'png-copy', label: 'Copy image', shortcut: `${mod}C`, control: 'action', group: 'Export image' },
        ]}
        onChoose={(id) => (id === 'copy-link' ? onCopyLink() : id === 'scope' ? useViewStore.setState({ exportScope: exportScope === 'hexagon' ? 'map' : 'hexagon' }) : onExport(id))}
      />

      <span className="divider" aria-hidden="true" />

      <a className="icon-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="View the source on GitHub" title="Source on GitHub">
        <Icon name="github" />
      </a>
    </header>
  )
}
