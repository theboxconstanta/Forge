// INC-11 - the logger for a Sequence AMRAP (finite ordered pass: buy-in /
// chipper / buy-in + max-reps tail). One stacked card per ordered station -
// mobile-first, no matrix, no horizontal scroll (INC-11 §48). Shared by
// UniversalScoreInput (new programmed log) and FormatLogger (edit / skill).
//
// - FIXED station: "63 / 75" - performed reps out of the prescribed target
//   (0..target, INC-11 §17).
// - OPEN station ("Max reps ..."): a single reps box, no ceiling (INC-11 §17).
// - A station left blank = NOT REACHED (omitted from the result); an explicit
//   "0" = reached and performed zero (owner decision #3 - kept distinct).
// - Recording a later station auto-completes earlier FIXED targets on save
//   (INC-11 §15); the live TOTAL REPS below reflects that.
//
// value contract: `performed` is an index-aligned string array (reuses the
// existing `value.partialReps`); onChange({ partialReps }).

import { autoCompleteSequentialProgress, sequentialAmrapTotalReps } from './sequentialAmrap'
import { COLORS } from './theme'

const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 0', borderTop: `1px solid ${COLORS.divider}` }
const numStyle = { width: '76px', flexShrink: 0, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '15px', fontWeight: '600', background: '#fafafa', boxSizing: 'border-box', textAlign: 'center' }

export default function SequentialAmrapFields({ stations, performed, onChange, t }) {
  const list = Array.isArray(stations) ? stations : []
  const perf = list.map((_, i) => (performed || [])[i] ?? '')
  const autoFilled = autoCompleteSequentialProgress(list, perf)
  const total = sequentialAmrapTotalReps(list, perf)

  const setAt = (i, v) => {
    const next = list.map((_, j) => (performed || [])[j] ?? '')
    next[i] = v
    onChange({ partialReps: next })
  }

  const maxPrefix = t?.logWodMaxRepsStationPrefix || 'Max reps'
  // Presentation only (INC-11 §11): an open station is labelled "Max reps <name>"
  // from its STRUCTURAL role. If a legacy movement line already carries a
  // "Max reps" / "Max." instruction prefix in its text, strip it so the label
  // doesn't read "Max reps Max Reps ...".
  const cleanName = (name) => String(name || '').replace(/^\s*max(?:\.?\s*reps?)?[:.\s]+/i, '').trim() || String(name || '')

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600', lineHeight: 1.2, letterSpacing: '0.05em' }}>
        {t?.logWodSequentialStationsLabel || 'PROGRESUL TĂU'}
      </div>
      <div>
        {list.map((st, i) => {
          const reached = perf[i] !== ''
          const willAutoFill = !reached && autoFilled[i] !== '' && st.role === 'fixed'
          const labelText = st.role === 'open' ? `${maxPrefix} ${cleanName(st.name)}` : st.name
          return (
            <div key={st.index ?? i} style={{ ...rowStyle, borderTop: i === 0 ? 'none' : rowStyle.borderTop }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: '14px', lineHeight: 1.4, color: '#0E0E0E', overflowWrap: 'anywhere' }}>
                {labelText}
                {willAutoFill && (
                  <span style={{ fontSize: '11px', lineHeight: 1.35, color: '#9A9A9A', marginLeft: '8px' }}>
                    {(t?.logWodSequentialAutoDone && t.logWodSequentialAutoDone(st.target)) || `✓ ${st.target}`}
                  </span>
                )}
              </div>
              <input
                type="number" inputMode="numeric" min="0"
                max={st.role === 'fixed' && st.target != null ? st.target : undefined}
                value={perf[i]}
                aria-label={`${labelText} reps`}
                placeholder={st.role === 'open' ? '—' : '0'}
                onChange={(e) => setAt(i, e.target.value)}
                style={numStyle}
              />
              {st.role === 'fixed' && st.target != null && (
                <span style={{ fontSize: '13px', color: '#9A9A9A', flexShrink: 0, minWidth: '34px' }}>/ {st.target}</span>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: '14px', fontSize: '13px', fontWeight: '600', lineHeight: 1.4, color: '#0E0E0E', background: '#F5FBEA', borderRadius: '10px', padding: '10px 12px' }}>
        {(t?.logWodTotalRepsLabel || 'TOTAL REPS')}: {total}
      </div>
    </div>
  )
}
