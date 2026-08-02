// Single source of truth for the M9 Invite Member public route (Product
// Specification Section 4.2). Split out from main.jsx so it's importable
// without executing that file's top-level bootstrap side effects (Sentry
// init, service worker registration, createRoot/render) - main.jsx uses it
// to decide which component to mount and whether to apply the mobile-scroll
// body class (see index.css); tests use it directly.
export function matchInviteRoute(pathname) {
  return pathname.match(/^\/invite\/([^/]+)/)
}

// M10.3 - Admin Invitation public route (OWNER_DOMAIN_IMPLEMENTATION_
// ARCHITECTURE.md Section 5.5). A distinct path from /invite/<id> above -
// deliberately, since accepting one is a structurally different write
// (Admin role, never a Membership), and the two must never be confused by
// a shared route. `^` anchoring means the two patterns cannot collide:
// /admin-invite/<id> does not start with /invite/, so matchInviteRoute
// never matches it.
export function matchAdminInviteRoute(pathname) {
  return pathname.match(/^\/admin-invite\/([^/]+)/)
}

// M10.4 Platform Plan Catalog & Pricing Page (M10_IMPLEMENTATION_PLAN.md
// Section 5). Public, unauthenticated, no captured id - unlike the two
// routes above, there is nothing to look up by id, just a static page.
// Boolean, not a regex match object, since there is no capture group to
// expose to a caller.
export function matchPricingRoute(pathname) {
  return pathname === '/pricing'
}
