# PROJECT_STATE.md — WOD Simple (Forge)

> Ultima actualizare: 25 iunie 2026
> Document de stare pentru dezvoltare. Plasează-l în rădăcina proiectului (`WOD-SIMPLE/`) și fă commit la fiecare sesiune importantă.

---

## 1. Project Overview

**WOD Simple** (deployat sub numele **Forge**) este o aplicație de management pentru săli de CrossFit / functional fitness. Permite atleților să vadă WOD-ul zilei, să își logheze antrenamentele și recordurile personale (PR-uri), să rezerve clase și să își urmărească abonamentul. Coachul (admin) gestionează clienți, abonamente, planuri, clase și WOD-uri dintr-un panou dedicat.

- **Proprietar / dezvoltator:** Lucian (C15, Constanța)
- **Prima sală pilot:** C15 — singura sală de CrossFit din Constanța
- **Obiectiv pe termen lung:** produs SaaS vândut altor săli (target inițial discutat: €29/lună per sală), eventual exit SaaS
- **Model de business actual:** abonamente lunare reînnoite manual de admin (4, 8, 12, 20, 24 ședințe + Open Gym)
- **Tip aplicație:** Single Page Application mobile-first (lățime maximă 430px, optimizată pentru telefon)

---

## 2. Architecture

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  React + Vite   │ ───► │   Supabase (Frankfurt)│ ───► │  PostgreSQL     │
│  (Vercel)       │ ◄─── │   Auth + DB + Edge Fn │ ◄─── │  + RLS dezactiv.│
└─────────────────┘      └──────────────────────┘      └─────────────────┘
        │                          │
        │                          ▼
        │                 ┌──────────────────┐      ┌──────────────┐
        │                 │  Edge Function   │ ───► │  Resend API  │
        │                 │ check-subscript. │      │  (emailuri)  │
        │                 └──────────────────┘      └──────────────┘
        │                          ▲
        │                          │ (pg_cron, zilnic 08:00)
        ▼
┌─────────────────┐
│  Utilizator     │
│  (browser/tel)  │
└─────────────────┘
```

- **Frontend:** aplicație React single-file (`App.jsx`) cu state local (`useState`), fără router — navigarea se face printr-o variabilă `screen`. Stilizare inline (fără CSS extern / Tailwind).
- **Backend:** Supabase gestionează autentificarea, baza de date Postgres și o Edge Function scrisă în Deno/TypeScript.
- **Automatizare:** `pg_cron` apelează zilnic Edge Function-ul care verifică expirările și trimite emailuri prin Resend.
- **Deploy continuu:** push pe GitHub → Vercel redeployează automat în ~1 minut.

---

## 3. Technologies Used

| Strat | Tehnologie | Detalii |
|-------|-----------|---------|
| Frontend framework | React + Vite | SPA, state local, fără router |
| Stilizare | Inline styles (JS objects) | Paletă mov `#3C3489`, fără librărie UI |
| Backend / DB | Supabase | Postgres, regiune Frankfurt, proiect `sdfkvfbvgpuspnnnwqwk` |
| Autentificare | Supabase Auth | email + parolă, confirmare email DEZACTIVATĂ |
| Edge Functions | Deno + TypeScript | `check-subscriptions` |
| Cron | pg_cron | rulare zilnică la 08:00 |
| Email | Resend.com | trimitere din Edge Function (`onboarding@resend.dev`) |
| Hosting | Vercel | deploy automat din GitHub |
| Version control | Git + GitHub | `github.com/theboxconstanta/Forge.git` |

---

## 4. Folder Structure

```
WOD-SIMPLE/
├── .env                          # variabile locale (NU se urcă pe Git)
├── .gitignore
├── package.json
├── vite.config.js
├── index.html
├── public/                       # assets statice
├── src/
│   ├── App.jsx                   # ÎNTREAGA aplicație (componente + logică)
│   ├── supabase.js               # init client Supabase (env vars)
│   └── main.jsx                  # entry point React
└── supabase/
    ├── config.toml
    └── functions/
        └── check-subscriptions/
            ├── index.ts          # Edge Function emailuri expirare
            └── deno.json
```

**Componente în `App.jsx`:**
- `App` — componenta rădăcină (auth, state global, ecrane: home, log, logPR, pr, clase, abonament)
- `NavBar` — bara de navigare de jos
- `Timer` — timer WOD (For Time, AMRAP, EMOM, Tabata)
- `Feed` — feed social (date locale, nepersistate)
- `Admin` — panou admin (Clienți, Abonamente, Clase, WOD, Planuri)
- `CautareMiscare` — autocomplete pentru exerciții
- `AvatarCircle` — avatar generat din inițiale
- Helperi: `fmt`, `formatPR`, `getInitiale`

---

## 5. Completed Features ✅

**Autentificare**
- Înregistrare cont (nume, email, parolă) și login
- Confirmare email dezactivată (workaround pentru rate limit Supabase)
- Profil salvat automat în `profiles` la fiecare login (`saveProfile` + trigger DB)

**Interfață atlet**
- Home: salut cu nume real, dată, statistici reale (WOD-uri, PR-uri, rezervări)
- WOD-ul zilei cu exerciții per variantă (OnRamp / Beginner / Intermediate / RX)
- Log WOD: rezultat, timp, note → salvat în `wod_logs`
- PR-uri: greutate/timp/distanță/reps/hold cu logică per tip de mișcare → `personal_records`
- Clase: vizualizare pe zile, rezervare și anulare → `bookings`
- Timer complet: For Time, AMRAP, EMOM, Tabata cu countdown 10s și inele de progres
- Feed: postări, reacții, comentarii (DOAR local, nepersistat)
- Ecran abonament: plan activ, zile rămase, ședințe folosite (date reale din DB)

**Panou Admin (vizibil doar pentru admin)**
- Clienți: listă din `profiles` cu avatar, căutare, status abonament colorat, detalii la click
- Abonamente: adăugare per email + plan + dată start + sumă plătită; listă cu zile rămase
- Planuri: creare/ștergere tipuri de abonament (nume, ședințe, preț)
- Clase: creare/ștergere clase, vizualizare rezervări cu nume real
- WOD: creare WOD zilnic cu exerciții separate per variantă

**Logică abonament (blocare acces)**
- `abonamentReal === undefined` → se încarcă
- `abonamentReal === null` → FĂRĂ abonament → **BLOCAT** (overlay)
- `abonamentReal = obiect` → verifică data expirării
- Admin → niciodată blocat

**Automatizări**
- Trigger `handle_new_user` → creează automat profilul la înregistrare
- Edge Function `check-subscriptions` deployată
- Cron zilnic 08:00 → emailuri la 3 zile / 1 zi / 0 zile rămase

**Deploy**
- Aplicație live pe Vercel

---

## 6. Features In Progress 🚧

| Feature | Status | Note |
|---------|--------|------|
| Fix blocare „fără abonament" | Cod gata, **de făcut push** | `abonamentReal === null` → blocat; admin exceptat |
| Emailuri automate expirare | Funcțional, **netestat în producție** | Depinde de cron-ul zilnic — de verificat că rulează |

---

## 7. Remaining Features 📋

- **PWA** — aplicație instalabilă pe telefon („Adaugă pe ecranul principal"), fără App Store (rapid, gratuit)
- **Domeniu propriu pentru emailuri** — verificare în Resend pentru a reactiva confirmarea email și a trimite din domeniul propriu (~50 RON/an)
- **Reactivare confirmare email** — după domeniul propriu
- **Plăți online** — Stripe sau Netopia
- **Google OAuth** — login cu Google
- **Persistare Feed** — mutare din state local în tabel Supabase (`feed_posts`, `feed_reactions`, `feed_comments`)
- **Decrementare automată ședințe** — `sessions_used` nu se incrementează încă la logarea unui WOD / rezervare
- **App Store / Google Play** — versiune nativă (React Native), pe termen lung după primii clienți plătitori
- **Multi-tenant SaaS** — separarea datelor per sală pentru vânzare către alte gym-uri

---

## 8. Known Bugs 🐞

1. **Rate limit emailuri (Supabase free):** confirmarea prin email a fost dezactivată pentru că planul gratuit limitează emailurile de confirmare. Reactivarea necesită SMTP cu domeniu verificat.
2. **SMTP custom Resend nu funcționează fără domeniu verificat** — încercarea a returnat eroare `{}`. SMTP custom dezactivat momentan.
3. **Feed nepersistat** — postările, reacțiile și comentariile dispar la refresh (state local).
4. **Ședințe nedecrementate** — `sessions_used` rămâne 0; nu se scade automat la antrenament.
5. **`members` (tabel legacy)** — parțial nefolosit; majoritatea referințelor folosesc acum `auth.users` / `profiles`.
6. **Admin „Membri" vs „Clienți"** — sursa de adevăr pentru clienți este acum `profiles`; orice tab vechi bazat pe `personal_records` e redundant.

---

## 9. Database Schema

> RLS (Row Level Security) este **dezactivat** pe toate tabelele momentan (de reactivat înainte de multi-tenant / producție serioasă).

### `profiles`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| email | text | |
| full_name | text | |
| avatar_url | text | |
| created_at | timestamptz | default now() |

### `subscription_plans`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK, default gen_random_uuid() |
| name | text | NOT NULL |
| sessions | int | NULL = nelimitat (Open Gym) |
| duration_days | int | default 30 |
| price | numeric | RON |
| is_active | boolean | default true (ștergere = soft delete) |
| created_at | timestamptz | default now() |

### `subscriptions`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK |
| member_id | uuid | id-ul adminului care a creat înregistrarea |
| member_email | text | emailul atletului (cheia de legătură cu profilul) |
| plan_id | uuid | FK → `subscription_plans(id)` |
| sessions_total | int | din plan |
| sessions_used | int | default 0 (NU se incrementează încă) |
| start_date | date | default current_date |
| end_date | date | start + 30 zile |
| is_active | boolean | default true |
| notes | text | ex. „Plătit: 250 RON" |
| created_at | timestamptz | |

### `classes`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK |
| name | text | tip clasă (CrossFit WOD, Weightlifting...) |
| date | date | |
| start_time | time | |
| end_time | time | |
| coach | text | |
| max_spots | int | |
| created_at | timestamptz | |

### `bookings`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK |
| member_id | uuid | FK → auth.users |
| class_id | text | (TEXT, nu uuid — decizie din timpul dezvoltării) |
| created_at | timestamptz | |

### `wods`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK |
| date | date | UNIQUE (un singur WOD pe zi) |
| type | text | AMRAP, For Time, EMOM... |
| duration | text | ex. „20 minute" |
| movements_onramp | text[] | |
| movements_beginner | text[] | |
| movements_intermediate | text[] | |
| movements_rx | text[] | |
| created_at | timestamptz | |

### `wod_logs`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK |
| member_id | uuid | FK → auth.users |
| wod_id | uuid | nullable |
| variant_level | text | OnRamp / Beginner / Intermediate / RX |
| result | text | |
| time_result | text | |
| notes | text | |
| logged_at | timestamptz | |

### `personal_records`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK |
| member_id | uuid | FK → auth.users |
| movement | text | numele mișcării |
| value | numeric | greutate / distanță / secunde |
| reps | int | |
| unit | text | kg / m / reps / sec / timp |
| notes | text | |
| recorded_at | timestamptz | |

### `admins`
| Coloană | Tip | Note |
|---------|-----|------|
| id | uuid | PK, FK → auth.users (Lucian) |

### `members` *(legacy, parțial nefolosit)*

### Funcții & Triggere DB
- `handle_new_user()` — `SECURITY DEFINER`; inserează/actualizează în `profiles` la user nou
- Trigger `on_auth_user_created` — `AFTER INSERT ON auth.users` → apelează `handle_new_user()`
- Job pg_cron `check-subscriptions-daily` — `0 8 * * *` → `net.http_post` către Edge Function

---

## 10. API Endpoints

Aplicația nu are un backend REST clasic — comunică direct cu Supabase prin client. Singurul „endpoint" custom:

| Endpoint | Tip | Trigger | Funcție |
|----------|-----|---------|---------|
| `/functions/v1/check-subscriptions` | Supabase Edge Function (Deno) | pg_cron zilnic 08:00 | Verifică abonamentele active, calculează zilele rămase și trimite emailuri prin Resend la 3 / 1 / 0 zile rămase |

**Operațiuni Supabase folosite în client (prin `supabase-js`):**
- `auth.signUp`, `auth.signInWithPassword`, `auth.signOut`, `auth.getSession`, `auth.onAuthStateChange`
- `from('profiles')` — select / upsert
- `from('subscriptions')` — select (cu join `subscription_plans`) / insert / delete
- `from('subscription_plans')` — select / insert / update (soft delete)
- `from('classes')` — select / insert / delete
- `from('bookings')` — select / insert / delete
- `from('wods')` — select / insert / delete
- `from('wod_logs')` — select / insert
- `from('personal_records')` — select / insert
- `from('admins')` — select (verificare rol admin)

---

## 11. Environment Variables

### Local (`.env`, nu se urcă pe Git)
```
VITE_SUPABASE_URL=https://sdfkvfbvgpuspnnnwqwk.supabase.co
VITE_SUPABASE_KEY=<cheia anon din Supabase → Settings → API Keys → Legacy>
```

### Vercel (Environment Variables)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_KEY=...
RESEND_API_KEY=re_xxx... (cheia Resend)
```

### Supabase (Secrets, pentru Edge Function)
```
RESEND_API_KEY=re_xxx...
SUPABASE_URL=... (injectat automat)
SUPABASE_SERVICE_ROLE_KEY=... (injectat automat)
```

> ⚠️ **Securitate:** cheia Resend și service_role key au fost expuse în chat în timpul dezvoltării. Recomandare: **regenerează cheia Resend** și nu pune niciodată service_role key în cod client.

---

## 12. Deployment Status

| Componentă | Status | Locație |
|-----------|--------|---------|
| Frontend | ✅ Live | `https://forge-delta-ivory.vercel.app` |
| Cod sursă | ✅ | `github.com/theboxconstanta/Forge.git` (branch `main`) |
| Database | ✅ Live | Supabase Frankfurt, ref `sdfkvfbvgpuspnnnwqwk` |
| Edge Function | ✅ Deployată | `check-subscriptions` |
| Cron job | ✅ Programat | zilnic 08:00 (de verificat că rulează efectiv) |
| URL redirect Auth | ✅ Configurat | Site URL setat la domeniul Vercel |

**Workflow de deploy:**
```bash
git add .
git commit -m "descriere"
git push          # Vercel redeployează automat în ~1 min
```

**Deploy Edge Function (separat):**
```bash
npx supabase functions deploy check-subscriptions
```

---

## 13. Next Development Priorities

1. **Push fix blocare abonament** — finalizează deploy-ul pentru „fără abonament = blocat".
2. **Verifică emailurile automate în producție** — confirmă că cron-ul rulează și emailurile ajung (testează cu un abonament la 3 zile de expirare).
3. **PWA** — manifest + service worker pentru instalare pe telefon (prioritate înaltă, impact mare, efort mic).
4. **Decrementare ședințe** — incrementează `sessions_used` la logarea WOD-ului sau la rezervare, cu blocare când ședințele se termină.
5. **Domeniu propriu + reactivare confirmare email** — rezolvă definitiv problema rate limit.
6. **Persistare Feed în DB** — mutare din state local în Supabase.
7. **Reactivare RLS + pregătire multi-tenant** — esențial înainte de a vinde produsul altor săli.
8. **Plăți online** — Stripe/Netopia, când modelul cere automatizare.

---

## 14. Note de securitate (de rezolvat înainte de producție serioasă)

- [ ] Reactivează **RLS** pe toate tabelele și scrie politici (atletul vede doar datele proprii; adminul vede sala lui).
- [ ] **Regenerează cheia Resend** (a fost expusă).
- [ ] Asigură-te că **service_role key** nu ajunge niciodată în bundle-ul client.
- [ ] Verifică rolul de admin pe server (Edge Function / RLS), nu doar în client.
- [ ] Înainte de multi-tenant: adaugă o coloană `gym_id` pe tabelele relevante.
