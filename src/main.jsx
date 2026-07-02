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
// Nu mai umblam la meta viewport (a desincronizat visual viewport-ul de
// layout viewport pe iOS Safari, facand tap-urile sa nu mai nimereasca
// butoanele - vezi [[project-navbar-safe-area]]). In schimb, doar in
// standalone, folosim window.screen.height/width - o valoare constanta a
// device-ului, NEAFECTATA de bug-ul de cold-start (spre deosebire de
// innerHeight/visualViewport/dvh) - drept plafon superior pt inaltime.
const setAppHeight = () => {
  const visualH = window.visualViewport ? window.visualViewport.height : window.innerHeight
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  let h = visualH
  if (isStandalone) {
    const screenH = window.screen.height >= window.screen.width
      ? window.screen.height
      : window.screen.width
    h = Math.max(visualH, screenH)
  }
  document.documentElement.style.setProperty('--app-vh', `${h}px`)
}

setAppHeight()
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
