# Faza 8 — Workout Logging → Workout Engine V2 — Raport final

Commit: `dc9c9eb`. Migrație nouă `20260716120000_logs_workout_section_link.sql`
aplicată live pe DB-ul de producție. Deploy producție confirmat READY,
aliasat pe `forge-delta-ivory.vercel.app`. 246/246 teste unitare trec.
Validat live atât local (`localhost:5173`) cât și pe producție.

## 1. Rezumat implementare

Logarea antrenamentelor (`wod_logs`, `skill_logs`) primește o coloană nouă,
nullable, `workout_section_id` (FK către `workout_sections.id`,
`on delete set null`). Coloana se populează **doar la loguri noi**, doar
când există deja un rând real Workout Engine V2 pentru WOD-ul zilei:

```js
// saveWodLog (metcon)
const sectionIdV2 = (variantaAleasa !== null && wodZiWorkoutV2)
  ? (primarySectionV?.id || null) : null

// saveSkillLog
const skillSectionIdV2 = wodZiWorkoutV2
  ? (supportingSectionsV.find(s => s.slotKey === (esteSlot2 ? 'skill2' : 'skill'))?.id || null) : null
```

`wod_id` (wod_logs) și `wod_id`+`slot` (skill_logs) rămân coloanele reale de
identitate — neatinse, scrise exact ca înainte. `workout_section_id` e
strict aditiv, o legătură de trasabilitate către modelul nou, nu un
înlocuitor.

Butonul de logare pentru Skill/Skill2 e acum condiționat de
`section.loggingMode !== 'none'` — prop nou `loggable` pe `SkillHomeSection`
(implicit `true`), setat din `skillSection?.loggingMode`/
`skill2Section?.loggingMode` la cele două puncte de randare din App.jsx.
Rezultat vizibil identic azi (skill/skill2 au mereu `loggingMode: 'optional'`
de la fix-ul din Faza 7), dar decizia e acum condusă de modelul de secțiuni,
nu de simpla prezență a secțiunii.

## 2. Arhitectura logării

```
Member alege varianta (RX/Intermediate/...) / deschide Log Skill Work
        │
        ▼
saveWodLog() / saveSkillLog()
        │
        ├─→ wod_logs / skill_logs INSERT|UPSERT
        │     wod_id / slot          (identitate reală, neschimbată)
        │     workout_section_id     (NOU — doar dacă wodZiWorkoutV2 există)
        │
        └─→ (fără nicio schimbare) Jurnal / Clasament / PR detection
              citesc în continuare prin join-ul catre `wods`
```

Sursa pentru `workout_section_id` e `wodZiWorkoutV2` — obiectul V2 real
(nu `workoutForDisplay`, care poate fi fallback-ul legacy sintetizat cu
id-uri text `"legacy:..."`, nu uuid-uri). Verificare explicită: dacă
`wodZiWorkoutV2` e `null` (WOD fără rând V2 încă), `workout_section_id`
rămâne `null` — niciodată nu se încearcă să se scrie un id fals.

## 3. Strategia de migrare

Incrementală, cu un singur pas de scriere adăugat, fără nicio schimbare la
citire:

1. **Schema**: coloană nouă, nullable, cu index parțial (`where ... is not
   null`) — cost zero pentru rândurile existente.
2. **Scriere**: `workout_section_id` se atașează doar la loguri noi, calculat
   din date deja încărcate în pagină (`wodZiWorkoutV2`) — fără interogare
   suplimentară.
3. **Citire**: Jurnal (`fetchWodLogs`/`fetchSkillLogs`), Clasament
   (`fetchClasament`) și editarea unui log existent continuă să rezolve
   formatul/config-ul prin join-ul direct către `wods` — **neatinse**,
   deliberat. Această alegere ține migrarea strict incrementală: pasul de
   scriere (acest raport) e complet independent de pasul viitor de citire
   (dacă/când Jurnalul și Clasamentul vor citi vreodată direct din
   `workout_sections`).
4. **Backfill**: sărit intenționat. Logurile istorice nu au fost logate
   "împotriva" unei secțiuni anume — a inventa retroactiv o legătură ar fi
   o presupunere, nu o migrare de date reale.

## 4. Compatibilitate

- **Editor**: neatins.
- **Leaderboard/Clasament**: neatins — citește `wod_logs` filtrat pe `wod_id`
  direct din `wods`, exact ca înainte. Verificat live (local): rândul nou
  logat apare corect în secțiunea RX, 1 participant.
- **Jurnal**: neatins — join-ul către `wods` rezolvă formatul pentru
  afișare/editare exact ca înainte. Verificat live (local + producție):
  loguri vechi și noi afișate identic, editarea unui log ("Editează") arată
  corect mișcările/formatul prescris.
- **PR detection** (`computeSetsPrCandidates`): **complet neschimbată** —
  era deja independentă de structura WOD-ului (cheiată exclusiv pe nume de
  mișcare + tabela `personal_records`, fără nicio referință la `wod_id`/
  `workout_section_id`). Validat live: log Skill nou (Weightlifting,
  Strict Press, 5 reps @ 45kg) → "PR nou detectat! 🎉" → salvat corect în
  `personal_records`.
- **Istoric**: verificat direct în DB — logurile dinainte de Faza 8 au
  `workout_section_id: null`, neatinse.

## 5. Validare — rezultate

Local (`localhost:5173`), WOD nou creat prin editorul nativ (Warm-up cu
conținut real + Skill "Strict Press" Weightlifting + Metcon AMRAP 20:00):

| Scenariu | Rezultat |
|---|---|
| Metcon logging (AMRAP, RX, 7 runde) | ✅ salvat, `workout_section_id` = id-ul real al secțiunii metcon (`slot_key: metcon`, `logging_mode: required`) |
| Skill logging (Weightlifting, PR-eligible) | ✅ salvat, `workout_section_id` = id-ul real al secțiunii skill (`slot_key: skill`, `logging_mode: optional`) |
| Optional logging (Warm-up, `loggingMode: none`) | ✅ niciun buton de logare afișat — gating funcționează |
| PR detection | ✅ "PR nou detectat!" apărut și salvat corect |
| Jurnal | ✅ loguri noi + istorice afișate identic, editare funcțională |
| Leaderboard | ✅ log nou apare corect în secțiunea RX |
| Loguri istorice | ✅ `workout_section_id: null` confirmat direct în DB, neatinse |

Producție (`forge-delta-ivory.vercel.app`), WOD real ("TO THE SKY",
warmup+skill(Complex, `logging_mode: optional`)+metcon, cu loguri reale
existente dinainte de Faza 8):

| Scenariu | Rezultat |
|---|---|
| Randare Skill cu `loggable` gating | ✅ "Editează Skill Work" apare corect (secțiune deja logată, loggingMode optional) |
| Randare Warm-up (loggingMode none) | ✅ niciun buton de logare |
| Jurnal cu loguri reale | ✅ afișare identică, fără erori |
| Console erori JS | ✅ niciuna |

Date de test (WOD, secțiuni, 2 loguri, 1 PR) create local au fost șterse
imediat după validare, verificat explicit că nu au rămas rânduri orfane —
local și producție folosesc **aceeași bază de date Supabase**, deci orice
date de test create local sunt vizibile imediat și pe producție.

## 6. Performanță

Zero interogări suplimentare la citire (nimic nou nu se citește). La
scriere: `workout_section_id` se calculează din `wodZiWorkoutV2`, deja
încărcat în pagină pentru randare (Faza 7) — cost zero, doar un câmp în
plus în același payload de INSERT/UPSERT.

## 7. Cazuri de margine confirmate

- Logare liberă ("Logare Nouă", fără `wod_id`) → `workout_section_id`
  rămâne `null`, la fel ca `wod_id`.
- WOD fără rând Workout Engine V2 încă (fallback legacy pur) →
  `workout_section_id` rămâne `null` explicit, nu se scrie un id fals de
  tip `"legacy:..."`.
- Ștergerea unei secțiuni (WOD editat, slot_key nu mai apare) →
  `on delete set null` pe FK, log-urile deja existente rămân intacte, doar
  legătura se pierde.
- Descoperire colaterală (nu bug, doar notă operațională): ștergerea directă
  a unui rând `wods` eșuează dacă există deja un rând `workouts` legat prin
  `legacy_wod_id` (FK fără cascade) — trebuie șters întâi `workouts`
  (cascadă la `workout_sections`), apoi `wods`. Fluxul normal de ștergere
  din admin (`deleteWorkoutEngineV2ByLegacyWodId`) respectă deja această
  ordine; a apărut doar la curățarea manuală a datelor de test prin query-uri
  directe.

## 8. Datorie tehnică rămasă

Niciuna nouă. `workout_section_id` e o coloană pur aditivă, fără backfill,
fără nicio dependență introdusă în citire — Jurnalul și Clasamentul rămân
pe join-ul `wods` intenționat, ca pas separat, viitor (dacă va fi nevoie).

## 9. Confirmare comportament neschimbat

Editor, Jurnal, Clasament, PR detection, istoricul de loguri — toate
neatinse. Singura schimbare de comportament observabilă e cea cerută
explicit: gating-ul butonului de logare Skill/Skill2 e acum condus de
`loggingMode`, cu rezultat vizual identic cu starea dinaintea Fazei 8 pentru
toate WOD-urile existente.
