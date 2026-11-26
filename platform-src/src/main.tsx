import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initInstall } from './lib/install'

// Catch the browser's install prompt before React mounts, so the Install button can use it.
initInstall()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Installable app (phase 26): register the shell cache in production builds only.
// The version query makes every deploy install a fresh cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`./sw.js?v=${__BUILD_ID__}`).catch(() => { /* offline shell is optional */ })
  })
}
