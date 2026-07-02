import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

let swRefreshing = false
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return
    swRefreshing = true
    window.location.reload()
  })
}

const lockPortrait = () => {
  // Modern API (Android Chrome, Edge)
  if (screen?.orientation?.lock) {
    screen.orientation.lock('portrait').catch(() => {})
  }
  // Legacy APIs (older Android browsers)
  const s = screen
  const legacyLock = s.lockOrientation || s.mozLockOrientation || s.msLockOrientation
  if (legacyLock) legacyLock.call(s, 'portrait-primary')
}

lockPortrait()
window.addEventListener('orientationchange', lockPortrait)

// iOS PWA standalone: pe cold-start, window.innerHeight/100dvh raporteaza o
// valoare mai mica decat ecranul real si nu se corecteaza singura decat dupa
// o schimbare fizica de geometrie (ex. rotatie) - de-aia landscape (care
// necesita rotirea telefonului) nu are gap-ul, dar portrait la cold-start da.
// Fortam recalcularea prin toggle pe viewport-fit=cover (fara sa fie nevoie
// de rotatie reala) si expunem inaltimea corecta ca variabila CSS.
const setAppHeight = () => {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight
  document.documentElement.style.setProperty('--app-vh', `${h}px`)
}

const forceViewportRecalc = () => {
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  const original = meta.getAttribute('content')
  const stripped = original.replace(/,?\s*viewport-fit=cover/, '')
  meta.setAttribute('content', stripped)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      meta.setAttribute('content', original)
      requestAnimationFrame(() => {
        requestAnimationFrame(setAppHeight)
      })
    })
  })
}

setAppHeight()
forceViewportRecalc()
setTimeout(setAppHeight, 300)
setTimeout(setAppHeight, 1000)
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 300))
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
