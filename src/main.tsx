import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { wireAutosave } from './model/autosaveWiring'
import { browserStorage } from './model/persistence'
import { boot } from './model/store'
import { paletteCss } from './ui/palette'
import './styles.css'

const palette = document.createElement('style')
palette.textContent = paletteCss()
document.head.prepend(palette)

const storage = browserStorage()
wireAutosave(storage, boot.recovery)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App boot={{ recovery: boot.recovery, unreadableText: boot.unreadableText, kind: boot.map.kind }} />
  </StrictMode>,
)
