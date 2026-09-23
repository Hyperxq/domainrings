import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { autosave, browserStorage } from './model/persistence'
import { useDiagramStore } from './model/store'
import { paletteCss } from './ui/palette'
import './styles.css'

const palette = document.createElement('style')
palette.textContent = paletteCss()
document.head.prepend(palette)

const storage = browserStorage()
try {
  const theme = storage?.getItem('domainrings:theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch {
  // Blocked storage falls back to the system theme.
}
if (storage) autosave(useDiagramStore, storage)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
