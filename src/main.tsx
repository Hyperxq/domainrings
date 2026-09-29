import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { wireAutosave } from './model/autosaveWiring'
import { browserStorage } from './model/persistence'
import { boot } from './model/store'
import { PALETTES, paletteCss } from './ui/palette'
import './styles.css'

const palette = document.createElement('style')
palette.textContent = paletteCss()
document.head.prepend(palette)

const storage = browserStorage()
try {
  const theme = storage?.getItem('domainrings:theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
  const chosen = storage?.getItem('domainrings:palette')
  if (chosen && chosen !== 'default' && Object.hasOwn(PALETTES, chosen)) document.documentElement.dataset.palette = chosen
} catch {
  // Blocked storage falls back to the system theme and the default palette.
}
wireAutosave(storage, boot.recovery)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App boot={{ recovery: boot.recovery, unreadableText: boot.unreadableText, kind: boot.map.kind }} />
  </StrictMode>,
)
