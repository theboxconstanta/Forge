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

// iOS PWA standalone: 100dvh/innerHeight raporteaza o valoare inghetata, mai
// mica decat ecranul real, la cold-start - si nu se corecteaza decat dupa o
// schimbare fizica de geometrie (ex. rotatie). Incercare anterioara de a forta
// recalcularea prin toggle pe meta viewport a REZOLVAT gap-ul dar a stricat
// tap-urile (desincronizare visual/layout viewport pe iOS Safari) - vezi
// [[project-navbar-safe-area]]. window.scrollTo e un truc mult mai vechi si
// mai sigur (nu umbla la meta viewport, doar la pozitia de scroll) folosit
// traditional ca sa forteze Safari sa recalculeze viewport-ul.
const setAppHeight = () => {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight
  // valoare invalida (0/NaN) ar face fallback-ul var(--app-vh, 100dvh) sa nu se
  // mai activeze (fallback-ul se aplica doar cand proprietatea lipseste, nu
  // cand e invalida) - height ar pica pe auto si ar prabusi tot layout-ul.
  if (!Number.isFinite(h) || h <= 0) return
  document.documentElement.style.setProperty('--app-vh', `${h}px`)
}

const forceViewportRecalc = () => {
  const x = window.scrollX, y = window.scrollY
  window.scrollTo(0, 1)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.scrollTo(x, y)
      setAppHeight()
    })
  })
}

setAppHeight()
forceViewportRecalc()
setTimeout(setAppHeight, 300)
setTimeout(setAppHeight, 1000)
// NU ascultam resize pe orice trigger (inclusiv window.resize si
// visualViewport.resize) - pe iOS, deschiderea tastaturii declanseaza si ea
// visualViewport.resize (micsorand height-ul), ceea ce facea #root/NavBar sa
// se micsoreze si sa "sara" deasupra tastaturii, cu un gol gri intre ele
// (masuratoarea nu prindea exact inaltimea tastaturii). Recalculam DOAR la
// schimbari reale de geometrie (rotatie, revenire din fundal) - o tastatura
// deschisa/inchisa nu mai muta NavBar-ul, doar il acopera temporar, ca in
// majoritatea aplicatiilor native.
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 300))
window.addEventListener('pageshow', forceViewportRecalc)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
