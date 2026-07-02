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

// Forțează reîncărcarea când există un build nou pe server. Safari nu
// verifică update-uri de service worker când aplicația e deschisă ca PWA
// instalată de pe ecranul principal (doar cand e deschisă direct in Safari),
// deci telefoanele pot rămâne blocate pe un build vechi/stricat la nesfârșit
// - iar un simplu reload nu ajută, pentru că service workerul tot mai
// servește din cache shell-ul vechi. Aici comparăm scriptul din index.html
// de pe server (fără cache) cu cel încărcat efectiv; dacă diferă, ștergem
// service workerul + toate cache-urile și reîncărcăm ca să luăm build-ul nou.
const currentScriptSrc = document.querySelector('script[type="module"]')?.getAttribute('src') || ''
let checkingForNewBuild = false
const checkForNewBuild = async () => {
  if (checkingForNewBuild) return
  checkingForNewBuild = true
  try {
    const res = await fetch('/index.html', { cache: 'no-store' })
    const html = await res.text()
    const latestScriptSrc = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1] || ''
    if (latestScriptSrc && currentScriptSrc && latestScriptSrc !== currentScriptSrc) {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map(r => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map(k => caches.delete(k)))
      }
      window.location.reload()
    }
  } catch { /* offline sau server indisponibil - ignoră, mai încercăm ulterior */ }
  finally { checkingForNewBuild = false }
}
checkForNewBuild()
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForNewBuild()
})
setInterval(checkForNewBuild, 5 * 60 * 1000)

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
