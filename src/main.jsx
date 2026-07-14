import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'
import { supabase } from './supabase.js'

// Monitorizare erori (Sentry) - pana acum erorile ajungeau doar in console.error,
// nimeni nu era alertat daca ceva se strica in productie. captureConsoleIntegration
// prinde automat toate apelurile console.error existente din cod (foarte multe,
// n-are rost sa fie inlocuite unul cate unul) fara sa trebuiasca schimbat vreun
// site de apel. supabaseIntegration adauga breadcrumbs cu query-urile Supabase
// esuate - sendOperationData ramane implicit (false), ca sa nu ajunga in Sentry
// filtre/body-uri de query care ar putea contine date personale ale membrilor.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.captureConsoleIntegration({ levels: ['error'] }),
      Sentry.supabaseIntegration({ supabaseClient: supabase }),
    ],
  })
}

const ErrorFallback = () => (
  <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', background: '#fff' }}>
    <div style={{ fontSize: '17px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>Ceva nu a mers bine</div>
    <div style={{ fontSize: '13px', color: '#888', marginBottom: '20px' }}>Am fost notificați automat despre eroare.</div>
    <button onClick={() => window.location.reload()}
      style={{ padding: '12px 24px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
      Reîncarcă
    </button>
  </div>
)

let swRefreshing = false
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return
    swRefreshing = true
    window.location.reload()
  })
}

// Inregistrare manuala (injectRegister:false in vite.config.js) - scriptul
// auto-injectat de vite-plugin-pwa apela navigator.serviceWorker.register()
// fara niciun .catch(), deci un rejection (retea instabila la sala, quota de
// storage etc.) ajungea in Sentry ca unhandled promise rejection generic
// ("Error: Rejected", fara context util). onRegisterError il trece prin
// console.error, care ajunge in Sentry cu stacktrace real prin
// captureConsoleIntegration, in loc sa fie o respingere nesupravegheata.
// import() dinamic, fara await la nivel de modul - nu trebuie sa blocheze
// randarea aplicatiei (createRoot de mai jos) pana se rezolva inregistrarea.
if (import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true, onRegisterError: (error) => console.error('[SW] register error:', error) })
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

// Trace silentios, mereu activ (nu are nevoie de navDebug pornit dinainte),
// pt bug-ul tranzitoriu "NavBar apare in mijlocul ecranului o clipa, la
// prima logare/instalare" - dispare prea repede ca sa-l prinzi cu un
// screenshot cronometrat manual. Salveaza in localStorage un istoric al
// primelor ~4 secunde dupa incarcare (inaltimile #root/.app-frame/nav),
// vizibil ulterior in overlay-ul de debug chiar daca intre timp s-a
// autocorectat - localStorage supravietuieste unui reload (activarea
// debug-ului), desi nu neaparat unei dezinstalari complete a PWA-ului.
const __loadTrace = []
const __traceStart = performance.now()
const __sampleTrace = () => {
  const rootEl = document.getElementById('root')
  const appFrameEl = document.querySelector('.app-frame')
  const navEl = document.querySelector('nav')
  __loadTrace.push({
    t: Math.round(performance.now() - __traceStart),
    innerH: window.innerHeight,
    rootH: rootEl ? Math.round(rootEl.getBoundingClientRect().height) : null,
    appFrameH: appFrameEl ? Math.round(appFrameEl.getBoundingClientRect().height) : null,
    navBottom: navEl ? Math.round(navEl.getBoundingClientRect().bottom) : null,
  })
  try { localStorage.setItem('__loadTrace', JSON.stringify(__loadTrace)) } catch {}
  if (performance.now() - __traceStart < 4000) requestAnimationFrame(__sampleTrace)
}
requestAnimationFrame(__sampleTrace)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
