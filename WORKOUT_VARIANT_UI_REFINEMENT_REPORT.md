# Forge UI Refinement — White Card Workout Variant Design

Pure visual/interaction refinement of the RX / Intermediate / Beginner / OnRamp workout variant display. No workout logic, programming data, variant parsing, result logging, or analytics touched.

## Component Inventory (Before Starting)

There is no single shared "variant card" component in either repo — investigated first rather than assumed. The only genuine expand/collapse, single-select accordion matching this mission's description lives in `WOD-SIMPLE/src/App.jsx`'s Home screen (the member's daily WOD view). Five other places touch the same 4-variant concept (Admin's variant *editor* form, the Composer's RX-only preview, the Log-WOD static summary, the Leaderboard's tier grouping, and forge-admin-web's `ScalingVariantsPanel`), each with its own bespoke JSX — and, before this mission, **three separately-maintained, mutually inconsistent color maps** for the same four levels. This report addresses the two screens that actually match the mission's brief: the Home accordion (PWA) and `ScalingVariantsPanel` (Web App). The others (Admin editor form, Composer RX-only preview, Log-WOD summary, Leaderboard grouping) are structurally different UI concepts, not variant-selection accordions, and were left untouched — in scope for a future mission if requested, not this one.

## Two Judgment Calls, Resolved Before Implementing

**Dark mode**: the mission asks to "preserve the existing dark-mode architecture" and "implement colors through theme tokens, not hardcoded values." Investigated first: **no dark-mode architecture exists in either repo** — no `prefers-color-scheme`, no `dark:` Tailwind variants, no theme context, no CSS custom-property light/dark pairs anywhere. Every color in both codebases is a hardcoded hex literal. Introducing a new theme-token system would be new architecture well beyond "pure visual refinement," and there is nothing existing to "preserve." Colors here stay hardcoded hex, consistent with 100% of the surrounding codebase — disclosed rather than silently deviating from the mission's literal (but factually inapplicable) instruction.

**forge-admin-web: accordion or restyle?** The mission says the component is "used in the PWA and Web App," implying parity. But forge-admin-web's `ScalingVariantsPanel` serves a coach reviewing programming — wanting to see all four variants side by side — not a member selecting one to do. Forcing single-expand accordion behavior onto that review context would remove real capability (at-a-glance comparison), not add polish. Resolution: apply the same white-card visual language (colored border, colored dot + title, no gray boxes, consistent spacing/radius) to forge-admin-web's *existing* always-visible grid layout, without adding accordion/select interaction there.

## Color Unification

Before this mission, three different hex sets existed for the same four levels (`NIVEL_DOT_COLORS` in `utils.js` for the dot, `VARIANTE_CONFIG` inline in `App.jsx` for the accordion's own text/border, `VARIANT_LEVELS` in `wodSections.js` for the Admin editor form) — RX alone was `#E8591A`, `#791F1F`, and `#C45000` in three different places. The Admin editor form (`wodSections.js`) is out of this mission's scope (a data-entry form, not a variant-display card) and was left untouched. The other two — the dot and the accordion's own label/border color — are now unified: `VARIANTE_CONFIG.culoare` reads directly from `NIVEL_DOT_COLORS`, so the colored dot and the colored text next to it can never disagree again.

New canonical palette (both repos, identical values):

| Level | Color | Hex |
|---|---|---|
| RX | orange | `#EA580C` |
| Intermediate | amber/yellow | `#D97706` |
| Beginner | green | `#16A34A` |
| OnRamp | blue | `#2563EB` |

Chosen to read clearly as their named hue while staying legible as text on a white card (not just as a small dot) — the earlier maps used much darker, less "true-hue" shades for exactly this reason, at the cost of looking muddy rather than premium.

## Component Changes

### PWA — `App.jsx` Home accordion

- **Card**: white background in both states (was `#fafafa` collapsed / `#fff` selected — now always `#fff`). Collapsed: thin `1px solid #f0f0f0` border, `14px` radius, compact `14px 16px` padding. Expanded: `2px solid` colored border, `18px` radius, `18px` padding.
- **Header**: colored dot (`LevelDot`) + colored title, unchanged position. Black "Selected" pill **removed**, replaced by a small `CheckCircle2` icon in the variant's own color, shown only when selected. `ChevronDown`/`ChevronUp` added on the right, always visible, neutral gray — the requested expand-state indicator.
- **Metadata** ("For Time 20:00", workout title, format description): was a `#f0f0f0` gray background block — now sits directly on the white card, distinguished purely by typography (bold 15px format+duration line, medium 13px title, light 12px description).
- **Movement list**: was one `#f0f0f0` gray rounded box per movement — now a plain vertical list, `14px` text, `1.5` line-height, separated by a `1px solid #f5f5f5` hairline divider between rows (none after the last) instead of individual backgrounds.
- **Coach notes callout**: kept as its own light-amber highlight box (not gray, a deliberate accent distinct from the "gray content box" problem this mission targets) — radius/spacing updated to match the new scale, content unchanged.
- Selection state (`variantaAleasa`), the click handler, and variant order (RX → Intermediate → Beginner → OnRamp, unchanged from `VARIANTE_CONFIG`'s existing order) are byte-identical to before — this is a pure restyle.

### Web App — `WorkoutDayPage.tsx`'s `ScalingVariantsPanel`

- Added `SCALING_LEVEL_COLOR`, the same four hex values as the PWA's `NIVEL_DOT_COLORS` (no shared module exists between the two independently-deployed repos, so this is a deliberate, disclosed duplication of the same values, not an oversight).
- Each variant card: `1.5px` colored border (was plain `border-neutral-200`), `rounded-2xl` (16px, up from `rounded-lg`), `p-4` padding, colored dot + colored title replacing the old plain gray uppercase label.
- Movement list: was already a plain `<ul>` with no gray box (the one part of this component already close to the target) — now has the same hairline-divider spacing as the PWA's list, for visual consistency between the two clients.
- Deliberately **not** turned into an accordion — see judgment call above. All variants remain visible simultaneously, matching the coach-review use case this screen actually serves.

## Spacing

| Element | Value | Meets mission target |
|---|---|---|
| Expanded card padding (PWA) | 18px | 16–20px ✓ |
| Card corner radius, expanded (PWA) | 18px | 16–20px ✓ |
| Card corner radius, collapsed (PWA) | 14px | close to range, intentionally smaller for the compact collapsed state |
| Between-card spacing (PWA) | 12px | 12–16px ✓ |
| Between-section spacing inside card (PWA) | 14–16px | 12–16px ✓ |
| Between-movement-row spacing (PWA + Web App) | 9px (via divider padding) | 8–12px ✓ |
| Web App card radius | 16px (`rounded-2xl`) | 16–20px ✓ |
| Web App card padding | 16px (`p-4`) | 16–20px ✓ |

## Testing

- `components.test.jsx` (19/19) and `utils.test.js` (54/54) pass unmodified — the `LevelDot` color test reads its expected values from `NIVEL_DOT_COLORS` itself, so it automatically validates the new palette rather than needing an update.
- WOD-SIMPLE full suite: 457/457 real JS tests (same baseline as before this mission; the 9 failing Deno Edge-Function test files are the same pre-existing, unrelated gap documented in every prior mission this session).
- forge-admin-web: `WorkoutDayPage.test.tsx` (15/15) passes unmodified — no test in that file asserted on the old markup's classes or structure. Full suite: 703/703.
- ESLint: 0 new errors in either repo (WOD-SIMPLE's pre-existing unused-eslint-disable warnings, unrelated to this change, untouched). TypeScript (`tsc -b`, forge-admin-web): 0 errors. WOD-SIMPLE has no `tsc` build step (plain JS/Vite app) — not applicable there.
- Both production builds clean.

## Mobile / Cross-Surface Verification

Per this session's standing policy against logging in as any user, the Home accordion (member-facing, requires an authenticated session to reach real WOD data) could not be visually rendered and screenshotted end-to-end here. What was verified instead: every spacing/radius/color value listed above was written and re-read directly from the source, matching the mission's explicit numeric targets; both automated test suites pass with the new markup; both production builds succeed with no new warnings. The final "does this look and feel premium on a real iPhone/Android/desktop browser, logged in as a real member" pass is the user's own to confirm — consistent with how every prior PWA UI mission in this session has closed this exact gap, and disclosed here rather than fabricated. "Before/after screenshots" as literally requested in the deliverable were not produced for the same reason; the exact before/after JSX and styling values in this report serve as the verifiable comparison instead.

forge-admin-web's `WorkoutDayPage` was verified structurally via its own passing component tests (15/15, unmodified assertions still hold against the new markup) and a clean TypeScript/build pass, without a live authenticated screenshot for the same standing-policy reason.

## Deployment Verification

Both repos committed, pushed, and auto-deployed via Vercel's GitHub integration:
- WOD-SIMPLE: commit `ae81137`
- forge-admin-web: commit `cd7a295`

**Disclosed tooling gap**: the Vercel API/MCP integration used for deployment-state verification in every prior mission this session returned `404`/`403` errors on this occasion (both `get_project` and `list_deployments`, across both projects) — a permissions/connectivity issue with the tool itself at the time of this mission, unrelated to anything changed here, and not something further retries resolved. In its place, both live production URLs were fetched directly and their JS bundles grepped for the new color values:

- `forge-delta-ivory.vercel.app` (WOD-SIMPLE): all four new hex values (`#EA580C`, `#D97706`, `#16A34A`, `#2563EB`) present in the live bundle; the old RX color (`#C45000`) confirmed absent.
- `forge-admin-web.vercel.app`: all four new hex values present in the live bundle.

This confirms both deployments completed and are serving the new code, though without the READY-state/commit-SHA cross-check the Vercel API normally provides.

## Production Validation

Verifying with a real CrossFit C15 workout containing all four variants, through an authenticated member/coach session, was not performed for the same standing no-login-as-any-user reason disclosed above. The color and markup changes are confirmed live in both production bundles; visually confirming the rendered result against a real four-variant WOD is the user's own next step.

---

**UI REFINEMENT — WORKOUT VARIANT WHITE CARD DESIGN COMPLETE**
