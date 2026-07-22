# Forge — Product Audit Inventory

**Purpose:** complete, code-derived inventory of the application as a foundation for a product audit. No feature descriptions here are inferred from intent or documentation — every entry is backed by a specific code location in `src/App.jsx` (unless otherwise noted). Where something could not be verified, it is marked `[unverified]` rather than guessed.

**Method note:** Forge's frontend does not use a router. A single `screen` state variable (`src/App.jsx:4508`) drives which top-level view renders; `adminTab` drives the sub-view inside Admin. "Routes" below refer to these state values, not URLs — the whole app is one URL.

---

# 1. Navigation

Bottom navigation bar (`NavBar`, `src/App.jsx:618`), rendered for every logged-in, fully-registered user:

| Name (RO / EN) | Route (`screen` value) | Purpose |
|---|---|---|
| Acasă / Home | `home` | Daily landing screen: date carousel, today's classes (book/cancel/waitlist), today's WOD (view + entry point to logging) |
| Log | `log` | Log a workout result — new entry, free-text entry, or journal of past entries |
| PR-uri / PRs | `pr` | Personal-records list, grouped by movement category |
| Leaderboard | `clasament` | Daily leaderboard, ranked by score, filterable by gender |
| Feed | `feed` | Gym-wide social feed (posts, reactions, comments) |
| Admin / Coach | `admin` | Only shown if `isAdmin` or `isCoach`; opens the Admin panel. Coaches see a reduced tab set inside (see §7 Roles) |

Navigation source: `NAV_TABS` constant, `src/App.jsx:610-616`.

Not in the bottom nav, but reachable by drill-down (not primary navigation):
- **Profile** (`profile`) — reached from the avatar circle on Home or from other screens' back-navigation chain.
- **Abonament / Subscription** (`abonament`) — reached from Profile or from the paywall overlay.
- **Timer** (`timer`) — reached from Profile ("Timer" button).

---

# 2. Screens

Every value the `screen` state can take, in the order first encountered in the render tree.

### Auth / pre-login screens
These aren't part of the `screen` state machine — they render before it, gated by `!user`.

| Screen | Route | Parent module | Purpose | Main actions | Dialogs opened | Related screens |
|---|---|---|---|---|---|---|
| Login | `authScreen === 'login'` | Auth | Sign in with email/password | Log in, go to Register, Forgot password | PWA install prompt (overlay, iOS/Android-specific steps) | Register, Reset Password |
| Register — Member | `authScreen === 'register'`, `registerMode === 'member'` | Auth | Join an existing gym | Search gym by name, enter join code, email/password, submit | — | Login |
| Register — Owner | `authScreen === 'register'`, `registerMode === 'owner'` | Auth | Create a new gym (bootstraps a gym + its first admin) | Enter gym name, enter platform-issued gym signup code, email/password, submit | — | Login, Platform Admin (issues the code) |
| Reset Password | `resetMode` (true after Supabase `PASSWORD_RECOVERY` event) | Auth | Set a new password from a recovery link | Enter new password + confirm, save; or exit back to login if link invalid | — | Login |

### Main app screens (`screen` state, post-login)

| Screen | Route | Parent module | Purpose | Main actions | Dialogs opened | Related screens |
|---|---|---|---|---|---|---|
| Home | `home` | Athlete | Daily hub: date navigation, class booking, today's WOD | Pick date, expand classes, book/cancel/join waitlist, expand WOD, select RX/Scaled variant, open skill logging | Calendar picker (`showCalPicker`) | Profile, LogWOD, LogSkill, Abonament (via paywall) |
| Log | `log` | Athlete | Entry point for logging results | Switch to New Entry / Free Text / Journal tabs, browse journal by day, edit/delete a past entry | — | LogWOD, LogSkill (via New Entry / edit) |
| LogWOD | `logWOD` | Athlete | Compose and score a WOD result | Pick format (if no scheduled WOD), reorder/add movements, enter score, save | — | Log, Home (back target depends on entry point) |
| LogSkill | `logSkill` | Athlete | Log the warm-up/skill-work portion of the day (2 independent slots) | Enter score for skill/skill2, save | PR-candidate confirmation (`PrCandidatesConfirm`) | Home, Log |
| NewHeroWod | `newHeroWod` | Athlete | Create or edit a custom benchmark ("Hero") WOD definition | Name it, pick format, add movements, save | — | PR (edit entry point), LogPR |
| LogPR | `logPR` | Athlete | Record a personal record for a movement | Search/pick movement, enter value (weight/time/reps), save | — | PR, NewHeroWod (for Hero-WOD-based PRs) |
| PR | `pr` | Athlete | Browse personal records by category (Weightlifting/Gymnastics/Cardio/Hero WODs) | Expand a movement, view history, see %1RM table, delete a record, edit the underlying Hero WOD | — | LogPR, NewHeroWod |
| Abonament (Subscription) | `abonament` | Athlete | View own subscription status and class reservations | Reload status, view upcoming/past reservations, cancel a reservation | — | Home (paywall entry point) |
| Timer | `timer` | Athlete (utility) | Standalone workout timer | Pick mode (For Time/AMRAP/EMOM/Tabata), configure duration, start/pause/reset | — | Profile |
| Clasament (Leaderboard) | `clasament` | Athlete | See ranked scores for a given day | Change date, filter by gender, expand a participant's full log (read-only) | — | Home |
| Feed | `feed` | Community | Gym-wide social wall | Post text, react with emoji, comment, delete own post/comment (or any, if admin) | Delete-confirmation (inline) | Profile (via avatars) |
| Profile | `profile` | Athlete | Own account settings | Edit name/birth date/gender, upload avatar, change weight unit (kg/lbs), change language (RO/EN), change password, open Timer, log out | — | Abonament, Timer |
| Admin | `admin` | Admin/Coach | Gym operations panel — see §2b for its 7 internal tabs | (see below) | (see below) | — |

### 2b. Admin's internal tabs (`adminTab` state, `src/App.jsx:2090`)

Admin is a single screen with its own internal tab bar (`src/App.jsx:3029`), not separate `screen` values.

| Tab | `adminTab` value | Role gate | Purpose | Main actions | Dialogs opened |
|---|---|---|---|---|---|
| Clients | `clienti` | Admin only | Member directory and profile management | Search/filter (all/active/inactive), view full profile (waiver, birth date, gender), adjust session count, add/renew subscription, **delete client** | Delete-client confirmation (type-to-confirm email, calls `admin-delete-client` Edge Function) |
| Subscriptions | `abonamente` | Admin only | Subscription management, gym-wide | Create new subscription for a member (email/plan/start date/amount), view all subscriptions grouped by member, adjust sessions, activate a queued subscription, delete a subscription | Similar-email typo warning (inline) |
| Classes | `clase` | Admin + Coach | Class schedule management | Create a class (single or recurring), view roster per class, check-in/mark-absent, manually add/remove a member, delete a single occurrence, delete an entire recurring series, bulk-delete past classes | Native `window.confirm()` before deleting a series |
| WOD | `wod` | Admin + Coach | Daily workout programming | Compose WOD sections (via `SectionCard`/`FormatConfigEditor`/`ComposedWorkoutPreview`), save/edit/delete a day's WOD, toggle warmup/skill visibility | — |
| Plans | `planuri` | Admin only | Subscription plan catalog | Create a plan (name, sessions, price, duration in months), delete a plan | — |
| Settings | `setari` | Admin only | Gym-level configuration — see §6 | See §6 | — |
| Platform | `platforma` | Admin **and** `isPlatformAdmin` (super-admin, cross-gym) | Platform-level operations across all gyms | Activate/deactivate a gym, set/clear a gym's `paid_until` date, generate a gym signup code, view signup-code usage | — |

Coach role sees only **Classes** and **WOD** (confirmed at `src/App.jsx:3029` — every other tab is `adminOnly`).

---

# 3. Dialogs / Modals

All overlays found (full-screen or centered), with trigger location and purpose. This codebase builds overlays as inline conditional `position: fixed` blocks rather than a shared Modal component, so each is listed by its controlling state variable.

| Dialog | Opens from | Purpose |
|---|---|---|
| PWA Install Prompt | Login screen, before auth (`installDismissed`/`installPrompt` state) | Guides iOS/Android users to "Add to Home Screen" |
| Calendar Picker | Home, clicking the date header (`showCalPicker`) | Month-grid date picker, jumps Home's selected date |
| Onboarding | First login for a new member (`showOnboarding`) | Bottom-sheet welcome/intro flow |
| Gym Blocked overlay | Global, when `gymBlocked && !isPlatformAdmin` | Blocks all app use if the gym has been deactivated by a platform admin |
| Registration Incomplete overlay | Global, when a user record is incomplete | Forces logout, since the account can't be used yet |
| Paywall / Subscription overlay | Global, member has no valid active subscription | Blocks app use with a specific reason (no subscription / not started yet / sessions exhausted / expired); offers reload, view subscription, or logout |
| WorkoutSharePopup | Triggered from workout-sharing action (`workoutSharePopup` state) | Renders a shareable workout card |
| PrCandidatesConfirm | After logging a skill result that could be a new PR | Lets the athlete confirm/dismiss auto-detected PR candidates |
| Delete-client confirmation | Admin → Clients tab, per-client "delete" | Type-to-confirm (must type the client's email) before calling `admin-delete-client` |
| Delete-series confirmation | Admin → Classes tab, per-class "delete series" | Native `window.confirm()` naming the class and time, before deleting every future occurrence of that recurring class |
| Delete-post / delete-comment confirmation | Feed, per-post/comment | Inline confirm before deleting |
| Toast | Global (`toast` state) | Transient success/error notification, bottom of screen |

---

# 4. User Flows

Traced end-to-end through the screens above; each step names the actual screen/tab involved.

- **Login**: Login screen → email/password → Home.
- **Register as Member**: Login → "Register" → Member mode → search gym → enter join code → email/password → submit → Home (pending admin/subscription setup).
- **Register as Gym Owner (Create Gym)**: Login → "Register" → Owner mode → gym name + platform signup code → email/password → submit → becomes gym's first Admin.
- **Forgot / Reset Password**: Login → "Forgot password" → email sent → recovery link → Reset Password screen → new password → Login.
- **Create Member (as Admin)**: happens implicitly — a member self-registers via join code; Admin's role is to then attach a subscription (Admin → Clients → select/search email → Subscriptions tab pre-filled).
- **Edit Member**: Admin → Clients → expand a client card → view/adjust profile fields (read display) and session count.
- **Delete Member**: Admin → Clients → expand client → Delete → type email to confirm → `admin-delete-client`.
- **Create Workout (WOD)**: Admin → WOD tab → pick date → compose sections (format, movements, variants) → Save.
- **Publish Workout**: There is no separate "publish" step — saving a WOD in Admin → WOD makes it immediately visible to members on Home for that date (no draft state was found).
- **Book a Class (Athlete)**: Home → expand a class → "Book spot" (or "Join waitlist" if full) → confirmed inline.
- **Cancel a Class Booking (Athlete)**: Home (expand class) or Abonament (Reservations list) → "Cancel reservation."
- **Check-in Athlete (Admin/Coach)**: Admin → Classes → open a class's roster → toggle a member's check-in/absent status.
- **Manually Add/Remove a Class Booking (Admin/Coach)**: Admin → Classes → open a class's roster → search a member → Add (adjusts their sessions), or "✕" next to an existing booking to remove (refunds sessions, triggers waitlist promotion).
- **Create a Recurring Class Series**: Admin → Classes → fill form → toggle "Repeat weekly" → pick weekdays + duration (weeks or "until I stop") → Create.
- **Delete a Class**: Admin → Classes → 🗑️ (single occurrence, future sessions refund attendees) or "Delete series" (all future occurrences of that recurring class, confirm prompt) or "Delete past classes" (bulk, no confirm).
- **Record a WOD Score**: Home (today's WOD) or Log → New Entry → LogWOD → pick/confirm format & movements → enter score → Save.
- **Record a Skill Score**: Home (skill section) → LogSkill → enter score → Save → optional PR-candidate confirmation.
- **Record a Personal Record**: PR screen → "+" / movement search → LogPR → enter value → Save.
- **Create/Edit a Custom Hero WOD**: PR screen (Hero WODs category) → NewHeroWod → name, format, movements → Save.
- **Create Subscription Plan**: Admin → Plans → name/sessions/price/duration → Save.
- **Sell/Assign a Subscription**: Admin → Subscriptions (or via Clients shortcut) → email + plan + start date + amount → Save.
- **Adjust Session Count**: Admin → Clients or Subscriptions → +/- buttons on a subscription.
- **Add/Remove a Coach**: Admin → Settings → search member → Add as coach / remove.
- **Activate/Deactivate a Gym (Platform Admin)**: Admin → Platform tab → toggle a gym's active state.
- **Generate Gym Signup Code (Platform Admin)**: Admin → Platform tab → "Generate Code" → shown in list until used.
- **Post to Feed**: Feed → write text → Post → visible gym-wide in real time.
- **React/Comment on a Feed Post**: Feed → emoji reaction or comment box under a post.

---

# 5. Features grouped by module

**Athlete**
- Daily WOD viewing (with warmup/skill/skill2 sub-sections, RX/Scaled/OnRamp variant selection)
- Class booking, cancellation, waitlist
- WOD score logging (structured, per-format) + free-text logging
- Skill-work logging (2 independent daily slots)
- Personal records tracking, with %1RM table for weightlifting
- Custom Hero WOD authoring
- Standalone workout timer (For Time / AMRAP / EMOM / Tabata)
- Own subscription status + reservation history
- Profile management (name, birth date, gender, avatar, weight unit, language, password)

**Community**
- Gym-wide social feed: posts, emoji reactions, comments, realtime updates (Supabase Realtime channel)
- Leaderboard: daily ranking by score, gender filter, read-only peer log inspection

**Admin — Members & Billing**
- Member directory, search/filter by active status
- Subscription plan catalog (CRUD)
- Subscription assignment/renewal, queued (scheduled) subscriptions, session adjustment
- Client deletion (type-to-confirm, server-side via Edge Function)
- Monthly reports: active members, subscriptions sold, revenue

**Admin — Programming**
- Daily WOD composer (multi-section: warmup, skill, skill2, primary metcon; per-section format config)
- Custom Hero WOD library (shared with athlete-facing PR screen)

**Admin — Classes**
- Class creation: single occurrence or recurring (pick weekdays + either a fixed number of weeks or "until I stop"), with name (free text + suggestions), date/time, coach, capacity, and an optional color tag
- Classes list grouped by day, with a "Today" badge and a one-click bulk delete for all past classes
- Per-class roster: view bookings, toggle check-in/absent per member, manually add a member (searches all clients, auto-adjusts their session count), manually remove a member (also refunds their session and cancels any pending class reminder, then tries to auto-promote someone from the waitlist)
- Delete a single class occurrence (refunds sessions only for future, unconsumed classes; notifies affected members)
- Delete an entire recurring series at once (matched by identical name + start/end time + coach, from today forward), with a native confirm prompt
- **No in-place edit** — a class's name/time/coach/capacity cannot be changed after creation; the only corrective actions are delete-and-recreate

**Admin — Gym Settings**
- Class-cancellation window (hours before class where cancellation is blocked)
- Gym display name
- Gym join code (regenerate)
- Coach roster management (add/remove)

**Platform Admin** (cross-gym, `is_platform_admin()`)
- Gym activation/deactivation
- Gym `paid_until` billing-date tracking
- Gym signup code generation/tracking (controls who can create a new gym)

**Notifications** (server-side, not a UI module)
- Push subscriptions (`push_subscriptions` table)
- Class reminders (`class_reminders`, `class_reminder_log`)
- `send-notification` and `check-subscriptions` Edge Functions (see security-hardening history for their current status)

---

# 6. Settings

There is no single unified "Settings" screen — settings are split by scope:

**Member-level (Profile screen)**
- First/last name, birth date, gender
- Avatar upload
- Weight unit: kg / lbs
- Language: RO / EN
- Password change
- Logout

**Gym-level (Admin → Settings tab)**
- Monthly reports dashboard (active members, subscriptions sold, revenue) — informational, not a setting itself, but lives in this tab
- Class-cancellation window (hours)
- Gym display name
- Gym join code (regenerate)
- Coach roster (add/remove)

**Platform-level (Admin → Platform tab, platform admin only)**
- Per-gym activation state
- Per-gym `paid_until` date
- Gym signup code issuance

---

# 7. Roles

Three role flags, each independently determined by a server-side check (`src/App.jsx:5350-5362`) — a user can hold more than one simultaneously:

| Role | Determined by | Screens/tabs accessible |
|---|---|---|
| **Member** (default) | No `admins` or `coaches` row | Home, Log, LogWOD, LogSkill, NewHeroWod, LogPR, PR, Abonament, Timer, Clasament, Feed, Profile. No Admin tab in nav bar. |
| **Coach** | Row exists in `coaches` table for this user | Everything a Member can access, **plus** Admin panel restricted to the **Classes** and **WOD** tabs only (`adminOnly` tabs hidden: Clients, Subscriptions, Plans, Settings, Platform) |
| **Admin** | Row exists in `admins` table for this user | Everything a Member can access, **plus** the full Admin panel: Clients, Subscriptions, Classes, WOD, Plans, Settings (Platform tab still gated separately) |
| **Platform Admin** | `is_platform_admin()` RPC returns true | Everything an Admin can access, **plus** the Platform tab (cross-gym gym activation, billing dates, signup codes). Also bypasses the "Gym Blocked" overlay that would otherwise lock out every other role in a deactivated gym. |

Role flags are independent booleans (`isAdmin`, `isCoach`, `isPlatformAdmin`), not a single enum — a user could in principle hold any combination, though the product's real usage is one role per person in practice.

---

# 8. Data Domains

Derived from every `.from('table')` call in `src/App.jsx` plus table names found in Edge Functions, `workoutEngine.js`/`workoutComposer.js`, and `supabase/migrations/*.sql`. Grouped into business entities; underlying table names in parentheses. Migrations are known to lag behind live DB state (see project memory), so this list favors what the frontend actually queries.

- **Gym** — `gyms`, `gym_signup_codes`, `app_settings` (per-gym config: cancel window, etc.), `platform_admins`
- **Member/User** — `profiles`, `admins`, `coaches`, `avatars` (storage bucket, not a table)
- **Subscription/Billing** — `subscriptions`, `subscription_plans`
- **Class/Attendance** — `classes`, `bookings`, `class_waitlist`, `class_reminders`, `class_reminder_log`
- **Workout (legacy)** — `wods`
- **Workout (Workout Engine V2)** — `workouts`, `workout_sections`, `workout_section_types`, `workout_scaling_levels`
- **Workout logging** — `wod_logs`, `skill_logs`
- **Personal Records** — `personal_records`, `custom_hero_wods`
- **Community/Feed** — `feed_posts`, `feed_reactions`, `feed_comments`
- **Notifications** — `push_subscriptions`
- **App metadata** — `app_version`

---

# 9. Application Tree

```
Forge
├── Auth (pre-login)
│    ├── Login
│    │    └── PWA Install Prompt (overlay)
│    ├── Register
│    │    ├── Member mode (find gym + join code)
│    │    └── Owner mode (new gym + signup code)
│    └── Reset Password (from recovery link)
│
├── Home
│    ├── Date carousel + Calendar Picker (modal)
│    ├── Classes of the day (book / cancel / waitlist)
│    └── WOD of the day
│         ├── Warmup section (view)
│         ├── Skill section → LogSkill
│         ├── Skill2 section → LogSkill (slot 2)
│         └── Variant selection (OnRamp/Beginner/Intermediate/RX) → LogWOD
│
├── Log
│    ├── New Entry → LogWOD
│    ├── Free Text tab (quick unstructured log)
│    └── Journal tab (past entries, by day)
│         ├── Edit WOD entry → LogWOD
│         └── Edit Skill entry → LogSkill
│
├── LogWOD
├── LogSkill
│    └── PR-candidate confirmation (modal)
├── NewHeroWod
├── LogPR
├── PR
│    ├── Weightlifting
│    ├── Gymnastics
│    ├── Cardio
│    └── Hero WODs → NewHeroWod (edit)
│
├── Abonament (Subscription)
│    └── My Reservations (upcoming / history)
│
├── Timer
│    ├── For Time
│    ├── AMRAP
│    ├── EMOM
│    └── Tabata
│
├── Clasament (Leaderboard)
│    └── Gender filter (All / M / F)
│
├── Feed
│    ├── Post
│    ├── React (emoji)
│    └── Comment
│
├── Profile
│    ├── Personal info (name, birth date, gender, avatar)
│    ├── Weight unit (kg/lbs)
│    ├── Language (RO/EN)
│    ├── Change Password
│    ├── → Timer (shortcut)
│    └── Logout
│
└── Admin (Admin + Coach; tabs vary by role — see §7)
     ├── Clients (admin only)
     │    ├── Search / filter (all/active/inactive)
     │    ├── Client profile (expand)
     │    ├── Adjust sessions
     │    ├── Add/renew subscription → Subscriptions tab
     │    └── Delete client (type-to-confirm)
     ├── Subscriptions (admin only)
     │    ├── New subscription form
     │    └── Subscriptions list (grouped by member, queued handling)
     ├── Classes (admin + coach)
     │    └── New class form
     ├── WOD (admin + coach)
     │    └── Section composer (warmup/skill/skill2/primary)
     ├── Plans (admin only)
     │    ├── New plan form
     │    └── Plans list
     ├── Settings (admin only)
     │    ├── Monthly reports
     │    ├── Cancel-window setting
     │    ├── Gym name
     │    ├── Gym join code (regenerate)
     │    └── Coach roster (add/remove)
     └── Platform (admin + platform admin only)
          ├── All-gyms list (activate/deactivate, paid-until)
          └── Signup codes (generate/list)
```

---

# Notes on scope and confidence

- Everything above was verified by direct code inspection of `src/App.jsx` (screen/tab state machine, render blocks, table calls) and `src/translations.js` (canonical labels). No screen, dialog, or flow was invented.
- **Notifications** are server-side (Edge Functions + tables) with no dedicated UI screen for members to manage preferences — included in §5 for completeness, not as a screen.
- No unused screens were found — every `screen` and `adminTab` value found via grep has a corresponding render block and at least one `setScreen`/`setAdminTab` call reaching it.
- `ComposedWorkoutView.jsx`, `FormatConfigEditor.jsx`, and `FormatLogger.jsx` are shared components used inside WOD composition/logging screens, not separate screens themselves.
