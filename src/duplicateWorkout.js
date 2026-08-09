// Duplicate/Clone WOD - logica pura (fara Supabase), portata din
// forge-admin-web/duplicateWorkout.ts (Programming Phase 3). Doar "Duplicate
// to..." (o sursa, N date-tinta alese manual) - Copy Week (+7 zile pt toata
// saptamana) NU e portat in acest prim increment, ramane fast-follow daca
// devine cerut - PWA n-avea NICIO functie de duplicare inainte de asta.

export const addDaysToDateStr = (dateStr, days) => {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Adnoteaza fiecare data candidata cu daca are deja un WOD (dintr-un set deja
// incarcat de datele ocupate - apelantul face fetch-ul o singura data, nu
// aici) - folosit ca sa decidem daca "selected" implicit e true sau false.
export const resolveTargetDateOptions = (candidateDates, existingWodDates) =>
  candidateDates.map(date => ({ date, hasExistingWod: existingWodDates.has(date) }))

// Construieste randurile planificate pt "Duplicate to..." - fiecare rand
// incepe selectat DOAR daca tinta lui nu e deja ocupata (fara "suprascriere
// silentioasa" - userul trebuie sa bifeze explicit peste un WOD existent).
export const buildDuplicateRows = (sourceWod, targets) =>
  targets.map(t => ({
    targetDate: t.date,
    targetHasExistingWod: t.hasExistingWod,
    selected: !t.hasExistingWod,
  }))

export const toggleRowSelected = (rows, targetDate) =>
  rows.map(r => (r.targetDate === targetDate ? { ...r, selected: !r.selected } : r))

export const removeRow = (rows, targetDate) =>
  rows.filter(r => r.targetDate !== targetDate)
