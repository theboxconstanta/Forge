// Strat de randare React pentru Workout Composer (WORKOUT_COMPOSER_SPEC_v1.md
// §8) - consuma STRICT `ComposedWorkout` (vezi workoutComposer.js), niciodata
// obiecte WorkoutSection brute si niciodata `format`/`formatConfig`. Ramificat
// DOAR pe `block.role` (5 valori posibile azi: buy-in/cash-out/main/stage) si
// `block.weight` (primary/secondary) - un format nou intr-o familie deja
// cunoscuta se randeaza corect fara nicio schimbare aici (exact contractul
// cerut). Fraza reala a etichetelor de tranzitie/scoreNote vine din `t`
// (translations.js) - workoutComposer.js insusi ramane fara limba, poarta
// doar coduri inchise.
//
// Stil vizual DELIBERAT minimal in acest increment - contractul de
// randare (ce se afiseaza, in ce ordine, pe ce ramura) e ce conteaza aici,
// nu tipografia finala de tip whiteboard (poate fi rafinata ulterior fara
// sa schimbe nimic din felul in care componenta citeste ComposedWorkout).

const ROLE_LABEL_KEY = { 'buy-in': 'fmtBuyInSection', 'cash-out': 'fmtCashOutSection' }
const SCORE_NOTE_KEY = {
  'ascending-rounds': 'composerScoreNoteAscendingRounds',
  'death-by-escalating': 'composerScoreNoteDeathByEscalating',
  'chained-total-reps': 'composerScoreNoteChainedTotalReps',
}

const containerStyle = { display: 'flex', flexDirection: 'column', gap: '4px' }
const identityStyle = { fontSize: '13px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em' }
const primaryTextStyle = { fontSize: '22px', fontWeight: '800', color: '#0E0E0E', marginBottom: '6px' }
const transitionStyle = { fontSize: '11px', fontWeight: '700', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '6px 0' }
const roleLabelStyle = { fontSize: '11px', fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }
const schemeStylePrimary = { fontSize: '20px', fontWeight: '800', color: '#0E0E0E', marginBottom: '2px' }
const schemeStyleSecondary = { fontSize: '14px', fontWeight: '700', color: '#555', marginBottom: '2px' }
const movementLineStylePrimary = { fontSize: '16px', color: '#0E0E0E' }
const movementLineStyleSecondary = { fontSize: '13px', color: '#666' }
const primaryBlockStyle = { padding: '4px 0' }
const secondaryBlockStyle = { padding: '4px 0', opacity: 0.85 }
const scoreNoteStyle = { fontSize: '12px', color: '#999', marginTop: '8px', fontStyle: 'italic' }

function TransitionLabel({ block, t }) {
  if (!block.transitionBefore) return null
  const text = block.transitionBefore === 'then' ? t.composerThenLabel
    : block.transitionBefore === 'straight-into' ? t.composerStraightIntoLabel
    : t.composerRestLabel(secToMinSec(block.restSeconds))
  return <div style={transitionStyle}>{text}</div>
}

function secToMinSec(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ContentBlock({ block, index, t }) {
  const isSecondary = block.weight === 'secondary'
  const roleLabelKey = ROLE_LABEL_KEY[block.role]
  const roleLabel = roleLabelKey ? t[roleLabelKey] : (block.role === 'stage' ? t.fmtStageLabel(index + 1) : null)
  return (
    <div style={isSecondary ? secondaryBlockStyle : primaryBlockStyle}>
      {roleLabel && <div style={roleLabelStyle}>{roleLabel}</div>}
      {block.scheme && <div style={isSecondary ? schemeStyleSecondary : schemeStylePrimary}>{block.scheme}</div>}
      {block.movements.map((m, i) => (
        <div key={i} style={isSecondary ? movementLineStyleSecondary : movementLineStylePrimary}>{m}</div>
      ))}
    </div>
  )
}

/** Componenta prezentationala pura - `composed` e un ComposedWorkout (vezi
 * workoutComposer.js), `t` e obiectul de traduceri curent (getT(lang)). */
export function ComposedWorkoutView({ composed, t }) {
  if (!composed || composed.blocks.length === 0) return null
  return (
    <div style={containerStyle}>
      {composed.identity?.name && <div style={identityStyle}>{composed.identity.name}</div>}
      {composed.primary?.text && <div style={primaryTextStyle}>{composed.primary.text}</div>}
      {composed.blocks.map((block, i) => (
        <div key={i}>
          <TransitionLabel block={block} t={t} />
          <ContentBlock block={block} index={i} t={t} />
        </div>
      ))}
      {composed.scoreNote && SCORE_NOTE_KEY[composed.scoreNote] && (
        <div style={scoreNoteStyle}>{t[SCORE_NOTE_KEY[composed.scoreNote]]}</div>
      )}
    </div>
  )
}
