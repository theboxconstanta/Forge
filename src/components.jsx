// Componente prezentaționale mici, fără dependințe de Supabase - testabile izolat.
import { getInitiale, NIVEL_DOT_COLORS } from './utils'

export function AvatarCircle({ name, avatarUrl, size = 38 }) {
  const culori = ['#f0f0f0', '#f0f0f0', '#FAEEDA', '#E6F1FB', '#FCE8E8']
  const textCulori = ['#0E0E0E', '#0E0E0E', '#633806', '#0C447C', '#791F1F']
  const idx = name ? name.charCodeAt(0) % culori.length : 0
  if (avatarUrl) return (
    <img src={avatarUrl} alt={name || ''} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  )
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: culori[idx], color: textCulori[idx], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: '600', flexShrink: 0 }}>
      {getInitiale(name)}
    </div>
  )
}

export function LevelDot({ nivel, size = 10 }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: NIVEL_DOT_COLORS[nivel] || '#ccc', flexShrink: 0, verticalAlign: 'middle' }} />
}

// Dropdown de sugestii (nume de miscari) pozitionat sub inputul parinte -
// randat identic in App.jsx (MiscareQuickAdd) si FormatConfigEditor.jsx
// (MovementTextField/MovementListField), fiecare reimplementandu-l separat
// pana acum. onMouseDown+preventDefault pastreaza focusul pe input cand dai
// click pe o sugestie, ca onClick sa apuce sa ruleze inainte ca alta
// schimbare de stare sa ascunda dropdown-ul. `rightOffset` lasa loc pentru un
// buton alaturat inputului (ex. "+"), cand exista.
export function MovementSuggestions({ suggestions, onSelect, rightOffset = 0 }) {
  if (!suggestions || suggestions.length === 0) return null
  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, right: rightOffset, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
      {suggestions.map((s, i) => (
        <div key={i} onMouseDown={e => e.preventDefault()} onClick={() => onSelect(s)}
          style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none' }}>{s}</div>
      ))}
    </div>
  )
}
