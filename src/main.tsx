import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { wireAutosave } from './model/autosaveWiring'
import { browserStorage } from './model/persistence'
import { boot } from './model/store'
import { paletteCss } from './ui/palette'
import { useNoticeStore } from './ui/state/noticeStore'
import './styles.css'

const palette = document.createElement('style')
palette.textContent = paletteCss()
document.head.prepend(palette)

const storage = browserStorage()
wireAutosave(storage, boot.recovery)
useNoticeStore.getState().reportRecovery(boot.recovery, boot.unreadableText)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App boot={{ kind: boot.map.kind }} />
  </StrictMode>,
)
