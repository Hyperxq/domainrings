import { EXAMPLES } from '../model/example'
import type { LayoutMode } from '../layout/layout'
import { useRef, useSyncExternalStore } from 'react'
import { ChoiceMenu } from './ChoiceMenu'
import { Icon } from './Icon'
import { PALETTES, type PaletteId } from './palette'
import { usePreferencesStore, type ThemeChoice } from './state/preferencesStore'
import { useViewStore } from './state/viewStore'

const REPOSITORY_URL = 'https://github.com/Hyperxq/domainrings'


interface ToolbarProps {
  onNew: () => void
  onExample: (id: (typeof EXAMPLES)[number]['id']) => void
  /** Replaces the whole map — distinct from Editor's "Add hexagon from file…", which adds one hexagon. */
  onOpen: (file: File) => void
  /** Always copies the whole map (REQ-05), regardless of the export scope selection. */
  onCopyLink: () => void
  onExport: (format: 'hexa' | 'svg' | 'png') => void
  /** Only a multi-hexagon map has more than one thing to export (EXPORT-03) — a single hexagon has nothing to choose between. */
  showScope: boolean
}

const MODES = ['overview', 'detailed'] as const
const SWITCHES = [
  { id: 'guides', label: 'Guides', title: 'Show the dashed guide spokes' },
  { id: 'highlight', label: 'Highlight', title: 'Highlight the layer under the pointer' },
  { id: 'dependents', label: 'Dependents', title: 'Emphasize what depends on the selection, not what it depends on' },
] as const
const MODE_LABEL: Record<LayoutMode, string> = { overview: 'Overview', detailed: 'Detailed' }
const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' }
/* The widest toolbar with the view controls in the bar (a multi-hexagon map, fallback fonts) plus the 12px side margins,
 * measured in Chrome, is 1112px: below 1136 the view controls fold into a menu. */
export const ROOMY_TOOLBAR = '(min-width: 1136px)'
const media = (query: string) => ({
  subscribe: (onChange: () => void) => {
    const list = matchMedia(query)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  },
  matches: () => matchMedia(query).matches,
})
const roomyMedia = media(ROOMY_TOOLBAR)
const darkMedia = media('(prefers-color-scheme: dark)')

export function Toolbar({ onNew, onExample, onOpen, onCopyLink, onExport, showScope }: ToolbarProps) {
  const preferences = usePreferencesStore()
  const { mode, theme: themeChoice, palette } = preferences
  const exportScope = useViewStore((s) => s.exportScope)
  const roomy = useSyncExternalStore(roomyMedia.subscribe, roomyMedia.matches)
  const systemDark = useSyncExternalStore(darkMedia.subscribe, darkMedia.matches)
  const dark = themeChoice === 'system' ? systemDark : themeChoice === 'dark'
  const openFile = useRef<HTMLInputElement>(null)
  return (
    <header className="island toolbar">
      <h1 className="wordmark">domainrings</h1>

      <span className="divider" aria-hidden="true" />

      {roomy ? (
        <>
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

          {SWITCHES.map(({ id, label, title }) => (
            <button key={id} type="button" role="switch" aria-checked={preferences[id]} className="switch" title={title} onClick={() => usePreferencesStore.setState({ [id]: !preferences[id] })}>
              <span className="switch-track" aria-hidden="true">
                <span className="switch-knob" />
              </span>
              {label}
            </button>
          ))}
        </>
      ) : (
        <ChoiceMenu
          label={
            <>
              View
              <Icon name="chevron" />
            </>
          }
          choices={[
            ...MODES.map((m) => ({ id: m, label: MODE_LABEL[m], checked: mode === m, control: 'radio' as const })),
            ...SWITCHES.map(({ id, label }) => ({ id, label, checked: preferences[id], control: 'switch' as const })),
          ]}
          onChoose={(id) => {
            if (id === 'overview' || id === 'detailed') usePreferencesStore.setState({ mode: id })
            else usePreferencesStore.setState({ [id]: !preferences[id] })
          }}
        />
      )}

      <span className="divider" aria-hidden="true" />

      <ChoiceMenu
        label={
          <>
            File
            <Icon name="chevron" />
          </>
        }
        choices={[
          { id: 'new', label: 'New', control: 'action', icon: 'new' },
          { id: 'open', label: 'Open…', control: 'action', icon: 'upload' },
          { id: 'save', label: 'Save (.hexa)', control: 'action', icon: 'download' },
          ...EXAMPLES.map((x) => ({ id: x.id, label: x.label, control: 'action' as const, group: `Load example · ${x.architecture}` })),
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
          { id: 'svg', label: 'SVG', control: 'action', group: 'Export image' },
          { id: 'png', label: 'PNG', control: 'action', group: 'Export image' },
        ]}
        onChoose={(id) => (id === 'copy-link' ? onCopyLink() : id === 'scope' ? useViewStore.setState({ exportScope: exportScope === 'hexagon' ? 'map' : 'hexagon' }) : onExport(id))}
      />

      <span className="divider" aria-hidden="true" />

      <ChoiceMenu
        label={<Icon name={dark ? 'sun' : 'moon'} />}
        ariaLabel="Appearance"
        className="icon-trigger"
        align="end"
        choices={[
          ...(['light', 'dark', 'system'] as const).map((id) => ({ id, label: THEME_LABEL[id], checked: themeChoice === id })),
          ...(Object.keys(PALETTES) as PaletteId[]).map((id) => ({ id, label: PALETTES[id].label, description: PALETTES[id].description, checked: palette === id })),
        ]}
        onChoose={(id) => usePreferencesStore.setState(id === 'light' || id === 'dark' || id === 'system' ? { theme: id } : { palette: id })}
      />
      <a className="icon-button" href={REPOSITORY_URL} target="_blank" rel="noreferrer" aria-label="View the source on GitHub" title="Source on GitHub">
        <Icon name="github" />
      </a>
    </header>
  )
}
