// Single source of truth for the M9 Invite Member public route (Product
// Specification Section 4.2). Split out from main.jsx so it's importable
// without executing that file's top-level bootstrap side effects (Sentry
// init, service worker registration, createRoot/render) - main.jsx uses it
// to decide which component to mount and whether to apply the mobile-scroll
// body class (see index.css); tests use it directly.
export function matchInviteRoute(pathname) {
  return pathname.match(/^\/invite\/([^/]+)/)
}
