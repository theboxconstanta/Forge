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
