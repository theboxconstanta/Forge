// Quick Create Date-First Flow - functii pure, extrase din Admin (App.jsx),
// ca invariantele centrale ale fix-ului ("schimbarea datei nu distruge
// draftul curent") sa poata fi testate izolat, fara sa monteze intreaga
// componenta Admin (zeci de efecte/apeluri Supabase la montare, fara niciun
// precedent de testare RTL in acest repo). Restul comportamentului (starea
// reala a formularului in timpul unei sesiuni de autor, prin randari/efecte
// React succesive) e verificat prin click-through live in productie, cerut
// explicit de misiune - aceste doua functii acopera doar partea de decizie
// determinista, pe date simple.

// WOD deja existent pe data aleasa, exclus WOD-ul pe care il editam chiar
// acum (daca e cazul) - folosit DOAR ca sa avertizam antrenorul inainte sa
// apese Salveaza (care oricum face upsert pe (gym_id,date) si l-ar
// suprascrie silentios, comportament deja existent, neschimbat aici), nu
// ca sa incarce automat WOD-ul gasit.
export function findExistingWodOnDate(wods, date, excludeId) {
  return (wods || []).find(w => w.date === date && w.id !== excludeId) || null
}

// Schimbarea datei (sau intrarea in Quick Create prin Analiza/Sablon/Start
// Gol) marcheaza sesiunea curenta ca "antrenament nou" DOAR cand nu editam
// deja un WOD real incarcat (editWodId setat) - editarea unui WOD existent
// isi pastreaza propriul id, iar garda "if (editWodId) return" de la
// sincronizarea pasiva il protejeaza deja, fara sa mai fie nevoie sa atingem
// acest flag. Fara aceasta marcare, o schimbare de data catre o zi cu WOD
// deja existent ar declansa sincronizarea pasiva si ar inlocui silentios
// draftul curent cu WOD-ul existent al noii date.
export function shouldEnterNewWodSession(editWodId) {
  return !editWodId
}
