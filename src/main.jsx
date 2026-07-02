import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// @media (display-mode: standalone) nu e suficient de sigur pe iOS - unele
// versiuni raporteaza matchMedia() gresit pentru un web-app instalat prin
// "Add to Home Screen", dar navigator.standalone (API-ul vechi, specific
// Apple) e corect. Adaugam o clasa pe <html> in JS (verificata cu ambele),
// ca CSS-ul sa se poata baza pe ceva mai de incredere decat media query-ul.
const isStandalonePwa = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
if (isStandalonePwa) {
  document.documentElement.classList.add('pwa-standalone')
}

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
