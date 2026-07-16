# Faza 7 — Member View → Workout Engine V2 — Raport final

Commit principal: `3b2f361` (plus `4e9922b` fix loggingMode, `1c3606b` documentare
datorie typeKey). Deploy producție confirmat READY, aliasat pe
`forge-delta-ivory.vercel.app`. 246/246 teste unitare trec. Validat live atât
local (`localhost:5173`) cât și direct pe producție, cu date reale.

## 1. Rezumat implementare

Member View (cardul WOD de pe ecranul Acasă) nu mai citește direct coloanele
`wods.warmup/skill/skill2/movements_rx/...`. Randarea pornește acum de la
`workoutForDisplay`, un obiect Workout unificat din `workoutEngine.js`:

```js
const workoutForDisplay = wodZiWorkoutV2 || mapLegacyWodToWorkout(wodZiData)
const primarySectionV = workoutForDisplay?.sections?.find(s => s.loggingMode === 'required') || null
const supportingSectionsV = (workoutForDisplay?.sections || []).filter(s => s !== primarySectionV)
```

- `wodZiWorkoutV2` — randul Workout Engine V2 (`workouts` + `workout_sections`),
  încărcat cu `loadFromWorkoutEngineV2(gymId, data)`, dacă există deja pt
  gym+dată.
- Fallback pur, fără interogare suplimentară: `mapLegacyWodToWorkout(wodZiData)`
  sintetizează același model de domeniu direct din `wodZiData`, deja adus
  pentru Logare.
- Secțiunea "primară" (scorată) e cea cu `loggingMode === 'required'`; restul
  (`warmup`/`skill`/`skill2`) sunt "supporting", identificate după `slotKey`.

Titlu, format, formatConfig, listă de mișcări, variante de scalare (RX /
Intermediate / Beginner / OnRamp) și notițe se citesc acum din acest model
unificat, în loc de coloanele legacy individuale.

## 2. Arhitectura randării

```
wods (legacy)  ──┐
                  ├─→ wodZiData (fetch existent, neschimbat) ──→ mapLegacyWodToWorkout() ─┐
workout_sections ─┘                                                                        ├─→ workoutForDisplay
                  └─→ wodZiWorkoutV2 = loadFromWorkoutEngineV2(gymId, data) ───────────────┘
```

`fetchWodZiWorkoutV2` e cablată în exact aceleași 4 puncte ca `fetchWodZi`
existent (schimbare de dată, subscripție realtime pe `wods`, callback-ul
admin `onWodChanged`), deci rămâne mereu sincronizată cu `wodZiData`.

Funcție pură nouă, extrasă în `workoutEngine.js` (nu inline în App.jsx, ca să
rămână testabilă izolat): `metconScalingVariantsForDisplay(section)` —
produce cele 4 variante în ordine canonică RX→Intermediate→Beginner→OnRamp,
citind mișcările/notele din `section.movements`/`section.scalingVersions` și
greutatea din `section.metadata.legacyWeights`. În App.jsx se face doar merge
cu stilizarea din `VARIANTE_CONFIG` (culoare/etichetă), fără logică.

## 3. Strategia de compatibilitate

- **Zero schimbări** la Editor, Logging, API-uri existente, dual-write.
  `wodZiData` continuă să alimenteze Logarea (butoane, `wodWeightLogged`,
  `logZiSkill`/`logZiSkill2`) exact ca înainte.
- Randarea rămâne vizual identică — același layout de card, aceleași
  variante, aceeași ordine.
- Bug real găsit și reparat în cursul migrării: `mapLegacyWodToWorkout`
  seta `loggingMode: 'none'` pt Skill/Skill2 dintotdeauna (de la Faza 4),
  deși Member View avea deja un buton funcțional "Loghează skill work".
  Verificat live: 3 rânduri `workout_sections` din producție aveau
  `logging_mode = 'none'` greșit → corectate printr-un `UPDATE` unic,
  verificat înainte/după.

## 4. Strategia de fallback

Transparentă și fără cost suplimentar de interogare: dacă `wodZiWorkoutV2`
e `null` (WOD creat înainte de Faza 5A/5B, sau row V2 șters), se folosește
direct `mapLegacyWodToWorkout(wodZiData)` — aceeași funcție pură deja
folosită de dual-write, deci comportament identic testat.

Validat live (local): am șters temporar rândurile `workouts`/`workout_sections`
pt un WOD real ("Michael"), confirmat că Member View randează identic prin
mapping legacy pur, apoi restaurat printr-un click real de admin
"Salvează modificările" — dual-write-ul existent a regenerat corect rândurile
V2, conținut neschimbat după restaurare.

## 5. Performanță

Nicio interogare suplimentară netă: `wodZiData` era deja adus pt Logare;
`loadFromWorkoutEngineV2` e un singur query nou (workouts+workout_sections
join), rulat în paralel cu fetch-urile existente, nu în serie. Funcțiile de
mapping (`mapLegacyWodToWorkout`, `metconScalingVariantsForDisplay`) sunt pure
și ieftine (operează pe date deja în memorie, fără I/O).

## 6. Validare — matrice completă

Testat atât local cât și **live pe producție** (`forge-delta-ivory.vercel.app`,
utilizator autentificat, date reale din gym CrossFit C15):

| Scenariu | Rezultat |
|---|---|
| Metcon simplu, fără warm-up/skill ("UNDER FIRE", For Time 15:00) | ✅ randare identică, fără secțiuni fantomă |
| Chained AMRAP cu 3 etape + warm-up ascuns membrilor ("ANCHOR DOWN") | ✅ toate etapele, greutăți per variantă, "Etape: 3 etape" corect |
| Warm-up + Skill (Complex) + Metcon, cu loguri reale existente ("TO THE SKY") | ✅ badge-uri "WORKOUT DONE"/"SKILL WORK DONE", Skill Complex expandabil corect |
| Toate cele 4 variante (RX/Intermediate/Beginner/OnRamp) | ✅ ordine canonică, mișcări + greutăți + notițe corecte per variantă |
| Fallback legacy (fără rând V2) | ✅ randare identică prin `mapLegacyWodToWorkout`, verificat prin ștergere+restaurare live |
| Log flow (buton "Loghează — {variantă}" → ecran Log WOD) | ✅ neschimbat, varianta aleasă se propagă corect |
| Console erori JS pe producție | ✅ nicio eroare de aplicație (doar zgomot cunoscut de extensie Chrome, nelegat de app) |

## 7. Cazuri de margine confirmate

- WOD fără nicio secțiune suplimentară (doar metcon) → nu apar cutii goale de
  Warm-up/Skill.
- WOD cu secțiune Skill ascunsă de membri (`skill_visible = false`) →
  vizibilitatea citește în continuare din `wodZiData`, comportament neschimbat.
- WOD creat înainte de Workout Engine V2 (fără rânduri V2) → fallback legacy
  transparent.
- Notițe per variantă (ex. "Use workout load and pace.") → randate corect din
  `scalingVersions[].notes` / `metadata.legacyWeights`.

## 8. Datorie tehnică rămasă (documentată, neadresată deliberat)

Două excepții explicite, păstrate ca citire directă din `wodZiData` (nu din
V2), discutate cu userul înainte de a începe testarea și acceptate ca atare:

1. **Durata** (`section.duration` e mereu `null` — nu e populată nici de
   legacy mapping, nici de dual-write, din cauza reprezentării incompatibile
   "MM:SS" string vs. minute-întreg). Randarea citește `wodZiData?.duration`
   direct.
2. **Vizibilitatea secțiunilor** (`warmup_visible`/`skill_visible`/
   `skill2_visible`) — nu există deloc coloană echivalentă în schema
   `workout_sections`. Randarea citește vizibilitatea direct din `wodZiData`.

Plus datoria deja acceptată din Faza 6 (`typeKey` pt secțiuni legacy-mapate,
nereconstruit din V2) — neschimbată, tot documentată în `wodSections.js`.

Niciuna din aceste trei excepții n-a creat o problemă de utilizare reală în
timpul validării — comportamentul observat e identic cu cel dinainte de
Faza 7.

## 9. Confirmare comportament neschimbat

Editor, Logging, API-uri, dual-write, tabele legacy — toate neatinse.
Randarea Member View e vizual identică cu starea dinaintea Fazei 7 pentru
toate scenariile testate, cu sursa de adevăr acum în Workout Engine V2 acolo
unde există date, și fallback pur legacy acolo unde nu există încă.
