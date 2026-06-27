// @ts-nocheck
/* eslint-disable */
import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = 'BOmGoF0pRvdf35liFRcCqT5XJbS9BE5ZDAkIAmgumLCSDkQSA2KKJ0AkZ9ELnI-GJ62PVYmBb4nOvMot7h7eWQ4'
const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0))
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

async function sendNotification(type, memberEmail, planName, endDate) {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(`${EDGE_BASE}/send-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
      body: JSON.stringify({ type, member_email: memberEmail, plan_name: planName, end_date: endDate }),
    })
  } catch (e) { console.error('sendNotification error:', e) }
}

const MISCARI = [
  'Air Squat', 'Back Squat', 'Front Squat', 'Overhead Squat', 'Box Squat', 'Pause Squat',
  'Shoulder Press', 'Push Press', 'Push Jerk', 'Split Jerk', 'Bench Press', 'Strict Press',
  'Deadlift', 'Romanian Deadlift', 'Sumo Deadlift', 'Sumo Deadlift High Pull', 'Stiff Leg Deadlift',
  'Clean & Jerk', 'Power Clean', 'Hang Clean', 'Hang Power Clean', 'Squat Clean', 'Clean Pull',
  'Snatch', 'Power Snatch', 'Hang Snatch', 'Hang Power Snatch', 'Squat Snatch', 'Snatch Pull', 'Snatch Balance',
  'Thruster', 'Farmers Carry', 'Turkish Get Up', 'Good Morning', 'Hip Thrust',
  'Pull-up', 'Chest to Bar Pull-up', 'Muscle-up', 'Ring Muscle-up', 'Bar Muscle-up',
  'Toes to Bar', 'Knees to Elbow', 'Ring Row', 'Push-up', 'Handstand Push-up',
  'Ring Dip', 'Bar Dip', 'Handstand Hold', 'Handstand Walk', 'L-sit Hold',
  'Box Jump', 'Broad Jump', 'Burpee', 'Double Under', 'Single Under',
  'Row', 'Run', 'Bike Erg', 'Assault Bike', 'Ski Erg',
  'KB Swing', 'KB Clean', 'KB Snatch', 'KB Goblet Squat', 'Wall Ball',
  'Fran', 'Grace', 'Cindy', 'Helen', 'Diane', 'Annie', 'Barbara', 'Chelsea',
  'Murph', 'DT', 'Jackie', 'Randy', 'Nancy', 'Amanda',
]

const FEED_INITIAL = [
  { id:1, nume:'Mihai D.', avatar:'MD', avatarBg:'#EDFFD4', avatarColor:'#2F6600', text:'Fran în 3:58 🔥 PR nou cu 24 secunde!', timp:'12 min', reactii:{ '🔥':8, '💪':5, '❤️':3 }, comentarii:[], variantaWod:'RX' },
  { id:2, nume:'Ioana A.', avatar:'IA', avatarBg:'#EAF3DE', avatarColor:'#27500A', text:'Back squat 75kg — prima dată! 🎉 Mulțumesc coach!', timp:'1 oră', reactii:{ '🔥':4, '💪':7, '❤️':12 }, comentarii:[{ autor:'Coach Andrei', text:'Bravo Ioana! 💪' }], variantaWod:'Beginner' },
  { id:3, nume:'Radu B.', avatar:'RB', avatarBg:'#FAEEDA', avatarColor:'#633806', text:'EMOM 20 min — am supraviețuit 😅', timp:'2 ore', reactii:{ '🔥':6, '💪':4, '❤️':2 }, comentarii:[], variantaWod:'Intermediate' },
]

function fmt(s) {
  const m = Math.floor(Math.abs(s) / 60)
  const sec = Math.abs(s) % 60
  return m + ':' + String(sec).padStart(2, '0')
}

function formatPR(pr) {
  if (pr.value && pr.reps) return `${pr.value} ${pr.unit} × ${pr.reps}rep`
  if (pr.value) return `${pr.value} ${pr.unit}`
  if (pr.reps) return `${pr.reps} reps`
  return '—'
}

function getInitiale(name) {
  if (!name) return '??'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function AvatarCircle({ name, size = 38 }) {
  const culori = ['#EDFFD4', '#EAF3DE', '#FAEEDA', '#E6F1FB', '#FCE8E8']
  const textCulori = ['#2F6600', '#27500A', '#633806', '#0C447C', '#791F1F']
  const idx = name ? name.charCodeAt(0) % culori.length : 0
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: culori[idx], color: textCulori[idx], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.3, fontWeight: '600', flexShrink: 0 }}>
      {getInitiale(name)}
    </div>
  )
}

function parseWodMinute(durataStr) {
  if (!durataStr) return null
  const match = durataStr.match(/(\d+)/)
  return match ? parseInt(match[1]) : null
}

function formatWodDurata(durataStr) {
  if (!durataStr) return ''
  if (/^\d+:\d+$/.test(durataStr.trim())) return durataStr.trim()
  const mins = parseWodMinute(durataStr)
  return mins != null ? `${mins}:00` : durataStr
}

function NavBar({ screen, setScreen, isAdmin }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', background: '#fff', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px', zIndex: 100 }}>
      {[
        { icon: '🏠', lbl: 'Acasă', sc: 'home' },
        { icon: '✏️', lbl: 'Log', sc: 'log' },
        { icon: '🏆', lbl: 'PR-uri', sc: 'pr' },
        { icon: '📅', lbl: 'Clase', sc: 'clase' },
        { icon: '🏅', lbl: 'Clasament', sc: 'clasament' },
        { icon: '👥', lbl: 'Feed', sc: 'feed' },
        ...(isAdmin ? [{ icon: '⚙️', lbl: 'Admin', sc: 'admin' }] : []),
      ].map((n, i) => (
        <div key={i} onClick={() => setScreen(n.sc)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', cursor: 'pointer', color: screen === n.sc ? '#2F6600' : '#aaa' }}>
          <span style={{ fontSize: '20px' }}>{n.icon}</span>
          <span style={{ fontSize: '10px', fontWeight: screen === n.sc ? '600' : '400' }}>{n.lbl}</span>
        </div>
      ))}
    </div>
  )
}

function CautareMiscare({ onAleage, preFill }) {
  const [query, setQuery] = useState(preFill || '')
  const [sugestii, setSugestii] = useState([])
  const [aleasa, setAleasa] = useState(preFill || '')
  const cauta = (val) => {
    setQuery(val); setAleasa('')
    if (val.length < 1) { setSugestii([]); return }
    setSugestii(MISCARI.filter(m => m.toLowerCase().includes(val.toLowerCase())).slice(0, 6))
  }
  const alege = (m) => {
    const canonic = MISCARI.find(x => x.toLowerCase() === m.toLowerCase().trim())
    const normalized = canonic || m.trim().replace(/\b\w/g, c => c.toUpperCase())
    setQuery(normalized); setAleasa(normalized); setSugestii([]); onAleage(normalized)
  }
  return (
    <div style={{ position: 'relative', marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Exercițiu / Mișcare</div>
      <input value={query} onChange={e => cauta(e.target.value)} placeholder="Scrie pentru a căuta..."
        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: aleasa ? '2px solid #2F6600' : '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', outline: 'none' }} />
      {sugestii.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
          {sugestii.map((s, i) => (
            <div key={i} onClick={() => alege(s)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < sugestii.length - 1 ? '1px solid #f5f5f5' : 'none' }}>{s}</div>
          ))}
          <div onClick={() => alege(query)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', color: '#2F6600', fontWeight: '500', background: '#EDFFD4' }}>
            + Adaugă "{query}" ca mișcare nouă
          </div>
        </div>
      )}
    </div>
  )
}

function Timer({ onBack, defaultFortime }) {
  const [mod, setMod] = useState('fortime')
  const [running, setRunning] = useState(false)
  const [secunde, setSecunde] = useState((defaultFortime || 15) * 60)
  const [totalSec, setTotalSec] = useState((defaultFortime || 15) * 60)
  const [runde, setRunde] = useState(0)
  const [minutEmom, setMinutEmom] = useState(1)
  const [tabataRunda, setTabataRunda] = useState(1)
  const [tabataFaza, setTabataFaza] = useState('lucru')
  const [gata, setGata] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [config, setConfig] = useState({ fortime: defaultFortime || 15, amrap: 20, emom: 10, emomInterval: 60, tabataRunde: 8, tabataLucru: 20, tabataOdihna: 10 })
  const intervalRef = useRef(null)
  const countdownRef = useRef(null)
  const moduri = [
    { id: 'fortime', icon: '⏱️', lbl: 'For Time' },
    { id: 'amrap', icon: '🔄', lbl: 'AMRAP' },
    { id: 'emom', icon: '⏲️', lbl: 'EMOM' },
    { id: 'tabata', icon: '🔥', lbl: 'Tabata' },
  ]
  const getSec = () => {
    if (mod === 'fortime') return config.fortime * 60
    if (mod === 'amrap') return config.amrap * 60
    if (mod === 'emom') return config.emomInterval
    if (mod === 'tabata') return config.tabataLucru
    return 60
  }
  const reset = () => {
    clearInterval(intervalRef.current); clearInterval(countdownRef.current)
    setRunning(false); setGata(false); setCountdown(null)
    setRunde(0); setMinutEmom(1); setTabataRunda(1); setTabataFaza('lucru')
    const s = getSec(); setSecunde(s); setTotalSec(s)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reset() }, [mod])
  const startTimer = () => {
    setRunning(true)
    intervalRef.current = setInterval(() => {
      setSecunde(prev => {
        if (prev <= 1) {
          if (mod === 'tabata') {
            let nextSec = config.tabataLucru
            setTabataFaza(faza => {
              if (faza === 'lucru') { nextSec = config.tabataOdihna; setTotalSec(config.tabataOdihna); return 'odihna' }
              else {
                setTabataRunda(r => {
                  if (r >= config.tabataRunde) { clearInterval(intervalRef.current); setRunning(false); setGata(true); return r }
                  return r + 1
                })
                nextSec = config.tabataLucru; setTotalSec(config.tabataLucru); return 'lucru'
              }
            })
            return nextSec
          }
          if (mod === 'emom') {
            setMinutEmom(m => {
              if (m >= config.emom) { clearInterval(intervalRef.current); setRunning(false); setGata(true); return m }
              return m + 1
            })
            setTotalSec(config.emomInterval)
            return config.emomInterval
          }
          clearInterval(intervalRef.current); setRunning(false); setGata(true); return 0
        }
        return prev - 1
      })
    }, 1000)
  }
  const toggleTimer = () => {
    if (gata) return
    if (running) { clearInterval(intervalRef.current); clearInterval(countdownRef.current); setRunning(false); setCountdown(null); return }
    if (secunde === getSec()) {
      setCountdown(10); let c = 10
      countdownRef.current = setInterval(() => {
        c--
        if (c <= 0) { clearInterval(countdownRef.current); setCountdown(null); startTimer() }
        else setCountdown(c)
      }, 1000)
    } else { startTimer() }
  }
  const pct = Math.max(0, secunde / totalSec)
  const circumferinta = 2 * Math.PI * 80
  const offset = circumferinta * (1 - pct)
  const culoareRing = gata ? '#27500A' : mod === 'tabata' && tabataFaza === 'odihna' ? '#1D9E75' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#2F6600'
  const culoareText = gata ? '#27500A' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#1a1a1a'
  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a' }}>Timer ⏱️</h1>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
        {moduri.map(m => (
          <div key={m.id} onClick={() => setMod(m.id)}
            style={{ width: '72px', height: '72px', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', border: mod === m.id ? '2px solid #2F6600' : '1px solid #e0e0e0', background: mod === m.id ? '#EDFFD4' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <div style={{ fontSize: '18px' }}>{m.icon}</div>
            <div style={{ fontSize: '9px', fontWeight: mod === m.id ? '600' : '400', color: mod === m.id ? '#2F6600' : '#888' }}>{m.lbl}</div>
          </div>
        ))}
      </div>
      {countdown === null && (
        <div style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          {mod === 'fortime' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Time cap</div><div style={{ fontSize: '11px', color: '#888' }}>Timp maxim</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button onClick={() => { setConfig(p => ({ ...p, fortime: Math.max(1, p.fortime - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.fortime} min</span>
                <button onClick={() => { setConfig(p => ({ ...p, fortime: Math.min(60, p.fortime + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          {mod === 'amrap' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Durată AMRAP</div><div style={{ fontSize: '11px', color: '#888' }}>As Many Rounds As Possible</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button onClick={() => { setConfig(p => ({ ...p, amrap: Math.max(1, p.amrap - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.amrap} min</span>
                <button onClick={() => { setConfig(p => ({ ...p, amrap: Math.min(60, p.amrap + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          {mod === 'emom' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Durata totală</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, emom: Math.max(1, p.emom - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.emom} min</span>
                  <button onClick={() => { setConfig(p => ({ ...p, emom: Math.min(30, p.emom + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Interval</div><div style={{ fontSize: '11px', color: '#888' }}>Secunde per minut</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, emomInterval: Math.max(10, p.emomInterval - 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.emomInterval}s</span>
                  <button onClick={() => { setConfig(p => ({ ...p, emomInterval: Math.min(120, p.emomInterval + 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </>
          )}
          {mod === 'tabata' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Runde</div><div style={{ fontSize: '11px', color: '#888' }}>Standard: 8</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataRunde: Math.max(1, p.tabataRunde - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '30px', textAlign: 'center' }}>{config.tabataRunde}</span>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataRunde: Math.min(20, p.tabataRunde + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Interval lucru</div><div style={{ fontSize: '11px', color: '#888' }}>Standard: 20 sec</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataLucru: Math.max(5, p.tabataLucru - 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{config.tabataLucru}s</span>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataLucru: Math.min(60, p.tabataLucru + 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Interval odihnă</div><div style={{ fontSize: '11px', color: '#888' }}>Standard: 10 sec</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataOdihna: Math.max(5, p.tabataOdihna - 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{config.tabataOdihna}s</span>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataOdihna: Math.min(60, p.tabataOdihna + 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {countdown !== null && (
        <div style={{ background: '#2F6600', borderRadius: '20px', padding: '40px 20px', marginBottom: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#C8FF00', marginBottom: '8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Pregătește-te!</div>
          <div style={{ fontSize: '80px', fontWeight: '700', color: '#fff', lineHeight: 1 }}>{countdown}</div>
          <div style={{ fontSize: '14px', color: '#C8FF00', marginTop: '8px' }}>
            {countdown <= 3 ? ['', '🔴', '🟡', '🟢'][countdown] + ' ' : ''}{countdown === 1 ? 'Gata!' : countdown <= 3 ? countdown : 'secunde...'}
          </div>
        </div>
      )}
      {countdown === null && (
        <div style={{ background: '#fff', borderRadius: '14px', padding: '20px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          {mod === 'emom' && <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>Minutul {minutEmom} / {config.emom}</div>}
          {mod === 'tabata' && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>Runda {tabataRunda} / {config.tabataRunde}</div>
              <div style={{ display: 'inline-block', padding: '4px 16px', borderRadius: '20px', background: tabataFaza === 'lucru' ? '#FCEBEB' : '#EAF3DE', color: tabataFaza === 'lucru' ? '#791F1F' : '#27500A', fontSize: '12px', fontWeight: '600' }}>
                {tabataFaza === 'lucru' ? `🔥 LUCRU — ${config.tabataLucru} sec` : `😴 ODIHNĂ — ${config.tabataOdihna} sec`}
              </div>
            </div>
          )}
          <div style={{ position: 'relative', width: '180px', height: '180px', margin: '0 auto 12px' }}>
            <svg width="180" height="180" viewBox="0 0 180 180" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="90" cy="90" r="80" fill="none" stroke="#f0f0f0" strokeWidth="8" />
              <circle cx="90" cy="90" r="80" fill="none" stroke={culoareRing} strokeWidth="8"
                strokeDasharray={circumferinta} strokeDashoffset={offset}
                strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }} />
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
              <div style={{ fontSize: '44px', fontWeight: '700', color: culoareText, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmt(secunde)}</div>
              {gata && <div style={{ fontSize: '14px', color: '#27500A', fontWeight: '600', marginTop: '6px' }}>GATA! 💪</div>}
              {!gata && running && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>în desfășurare</div>}
              {!gata && !running && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{secunde === getSec() ? 'apasă ▶ start' : 'pauză'}</div>}
            </div>
          </div>
          {mod === 'emom' && (
            <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '6px', marginBottom: '12px' }}>
              <div style={{ width: (pct * 100) + '%', height: '6px', borderRadius: '4px', background: culoareRing, transition: 'width 0.9s linear' }} />
            </div>
          )}
          {mod === 'amrap' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>RUNDE</div>
              <div style={{ fontSize: '42px', fontWeight: '700', color: '#2F6600' }}>{runde}</div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '6px' }}>
                <button onClick={() => setRunde(r => Math.max(0, r - 1))} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '18px', cursor: 'pointer' }}>−</button>
                <button onClick={() => setRunde(r => r + 1)} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #2F6600', background: '#EDFFD4', fontSize: '18px', color: '#2F6600', fontWeight: '700', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center' }}>
            <button onClick={reset} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '20px', cursor: 'pointer' }}>↺</button>
            <button onClick={toggleTimer} style={{ width: '64px', height: '64px', borderRadius: '50%', border: 'none', background: gata ? '#EAF3DE' : running ? '#BA7517' : '#2F6600', color: gata ? '#27500A' : '#fff', fontSize: '24px', cursor: gata ? 'default' : 'pointer', transition: 'background 0.2s' }}>
              {gata ? '✓' : running ? '⏸' : '▶'}
            </button>
            {mod === 'amrap'
              ? <button onClick={() => setRunde(r => r + 1)} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #2F6600', background: '#EDFFD4', color: '#2F6600', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>+1</button>
              : <div style={{ width: '48px' }} />
            }
          </div>
        </div>
      )}
      {countdown !== null && (
        <button onClick={reset} style={{ width: '100%', padding: '12px', background: 'transparent', color: '#888', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '13px', cursor: 'pointer' }}>
          Anulează
        </button>
      )}
    </div>
  )
}

function Clasament({ logs, loading, wodZiData, onRefresh }) {
  const [tab, setTab] = useState('RX')

  const parseTime = (str) => {
    if (!str) return Infinity
    const parts = str.trim().split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
    // fara ":" — tratat ca minute (ex: "15" = 15 min = 900 sec)
    return (parseFloat(str) || Infinity) * 60
  }

  const parseScore = (str) => {
    if (!str) return -Infinity
    const match = str.match(/(\d+(\.\d+)?)/)
    return match ? parseFloat(match[1]) : -Infinity
  }

  const deduplicateBest = (arr) => {
    const byMember = {}
    const withTime = arr.filter(l => l.time_result).length >= arr.filter(l => l.result).length && arr.some(l => l.time_result)
    arr.forEach(log => {
      const id = log.member_id
      if (!byMember[id]) { byMember[id] = log; return }
      const curr = byMember[id]
      if (withTime) {
        if (parseTime(log.time_result) < parseTime(curr.time_result)) byMember[id] = log
      } else {
        if (parseScore(log.result) > parseScore(curr.result)) byMember[id] = log
      }
    })
    return Object.values(byMember)
  }

  const sortLogs = (arr) => {
    const deduped = deduplicateBest(arr)
    const withTime = deduped.filter(l => l.time_result).length
    const withResult = deduped.filter(l => l.result).length
    if (withTime >= withResult && withTime > 0) {
      return deduped.sort((a, b) => parseTime(a.time_result) - parseTime(b.time_result))
    }
    if (withResult > 0) {
      return deduped.sort((a, b) => parseScore(b.result) - parseScore(a.result))
    }
    return deduped.sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  }

  const TABS = [
    { id: 'RX', culoare: '#791F1F', bg: '#FCEBEB', emoji: '🔴' },
    { id: 'Intermediate', culoare: '#633806', bg: '#FAEEDA', emoji: '🟡' },
    { id: 'Beginner', culoare: '#27500A', bg: '#EAF3DE', emoji: '🟢' },
    { id: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB', emoji: '🔵' },
  ]

  const currentTab = TABS.find(t => t.id === tab)
  const tabLogs = sortLogs(logs.filter(l => l.variant_level === tab))
  const isForTime = tabLogs.filter(l => l.time_result).length >= tabLogs.filter(l => l.result).length && tabLogs.some(l => l.time_result)

  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a' }}>Clasament 🏅</h1>
        <button onClick={onRefresh} style={{ background: '#EDFFD4', border: 'none', borderRadius: '20px', padding: '6px 12px', fontSize: '11px', color: '#2F6600', fontWeight: '600', cursor: 'pointer' }}>↻ Actualizează</button>
      </div>
      <p style={{ fontSize: '13px', color: '#888', marginBottom: '16px' }}>
        {new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })}
        {wodZiData ? ` · ${wodZiData.type} ${formatWodDurata(wodZiData.duration)}` : ''}
      </p>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', overflowX: 'auto', paddingBottom: '4px' }}>
        {TABS.map(t => {
          const cnt = logs.filter(l => l.variant_level === t.id).length
          return (
            <div key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '7px 14px', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: tab === t.id ? '700' : '400', background: tab === t.id ? t.culoare : '#fff', color: tab === t.id ? '#fff' : '#888', border: `1px solid ${tab === t.id ? t.culoare : '#e0e0e0'}`, whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
              {t.emoji} {t.id}
              {cnt > 0 && <span style={{ background: tab === t.id ? 'rgba(255,255,255,0.3)' : '#f0f0f0', color: tab === t.id ? '#fff' : '#888', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: '700' }}>{cnt}</span>}
            </div>
          )
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#aaa', fontSize: '13px' }}>Se încarcă...</div>
      ) : tabLogs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏁</div>
          <div style={{ fontSize: '14px', fontWeight: '500', color: '#888', marginBottom: '6px' }}>Niciun rezultat încă</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>Fii primul care loghează {tab} azi!</div>
        </div>
      ) : (
        <div>
          {isForTime ? (
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '500', background: '#f5f5f5', borderRadius: '8px', padding: '6px 10px' }}>
              ⏱️ For Time — timp mai mic = loc mai bun
            </div>
          ) : tabLogs.some(l => l.result) ? (
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '500', background: '#f5f5f5', borderRadius: '8px', padding: '6px 10px' }}>
              🔄 AMRAP — scor mai mare = loc mai bun
            </div>
          ) : null}

          {tabLogs.map((log, i) => {
            const name = log.profile?.full_name || log.profile?.email?.split('@')[0] || 'Anonim'
            const podium = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
            const result = log.time_result || log.result || '—'
            const borderColor = i === 0 ? currentTab.culoare : i === 1 ? '#B0B0B0' : i === 2 ? '#CD7F32' : '#e0e0e0'
            return (
              <div key={log.id || i} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: i === 0 ? '0 2px 10px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.06)', borderLeft: `4px solid ${borderColor}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ fontSize: podium ? '22px' : '13px', fontWeight: '700', color: '#888', minWidth: '30px', textAlign: 'center' }}>
                    {podium || `#${i + 1}`}
                  </div>
                  <AvatarCircle name={name} size={36} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{name}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>
                      {new Date(log.logged_at).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: currentTab.culoare }}>{result}</div>
                    {log.time_result && log.result && (
                      <div style={{ fontSize: '11px', color: '#aaa' }}>{log.result}</div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Feed({ showToast }) {
  const [feed, setFeed] = useState(FEED_INITIAL)
  const [postText, setPostText] = useState('')
  const [comentariuDeschis, setComentariuDeschis] = useState(null)
  const [comentariuText, setComentariuText] = useState('')
  const [reactiiMele, setReactiiMele] = useState({})
  const variantaColor = { 'OnRamp': '#0C447C', 'Beginner': '#27500A', 'Intermediate': '#633806', 'RX': '#791F1F' }
  const variantaBg = { 'OnRamp': '#E6F1FB', 'Beginner': '#EAF3DE', 'Intermediate': '#FAEEDA', 'RX': '#FCEBEB' }
  const toggleReactie = (postId, emoji) => {
    const key = postId + '-' + emoji
    const aMea = reactiiMele[key]
    setReactiiMele(prev => ({ ...prev, [key]: !aMea }))
    setFeed(prev => prev.map(p => p.id !== postId ? p : { ...p, reactii: { ...p.reactii, [emoji]: p.reactii[emoji] + (aMea ? -1 : 1) } }))
  }
  const adaugaComentariu = (postId) => {
    if (!comentariuText.trim()) return
    setFeed(prev => prev.map(p => p.id !== postId ? p : { ...p, comentarii: [...p.comentarii, { autor: 'Tu', text: comentariuText.trim() }] }))
    setComentariuText(''); setComentariuDeschis(null)
    showToast('Comentariu adăugat!')
  }
  const posteaza = () => {
    if (!postText.trim()) return
    setFeed(prev => [{ id: Date.now(), nume: 'Tu', avatar: 'TU', avatarBg: '#EDFFD4', avatarcolor: '#2F6600', text: postText.trim(), timp: 'acum', reactii: { '🔥': 0, '💪': 0, '❤️': 0 }, comentarii: [], variantaWod: 'RX' }, ...prev])
    setPostText(''); showToast('Postat! 🎉')
  }
  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '14px' }}>Feed 👥</h1>
      <div style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#EDFFD4', color: '#2F6600', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0 }}>TU</div>
          <textarea value={postText} onChange={e => setPostText(e.target.value)} placeholder="Cum a fost antrenamentul azi?"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', color: '#1a1a1a', background: 'transparent', resize: 'none', minHeight: '60px', fontFamily: 'system-ui' }} />
        </div>
        {postText.trim() && <button onClick={posteaza} style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>Postează</button>}
      </div>
      {feed.map(post => (
        <div key={post.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: post.avatarBg, color: post.avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0 }}>{post.avatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a' }}>{post.nume}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <span style={{ fontSize: '10px', color: '#aaa' }}>{post.timp}</span>
                {post.variantaWod && <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '20px', background: variantaBg[post.variantaWod] || '#f0f0f0', color: variantaColor[post.variantaWod] || '#888', fontWeight: '500' }}>{post.variantaWod}</span>}
              </div>
            </div>
          </div>
          <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: '1.5', marginBottom: '12px' }}>{post.text}</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: post.comentarii.length > 0 ? '10px' : '0' }}>
            {Object.entries(post.reactii).map(([emoji, count]) => {
              const activa = reactiiMele[post.id + '-' + emoji]
              return <button key={emoji} onClick={() => toggleReactie(post.id, emoji)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '20px', border: activa ? '1.5px solid #2F6600' : '1px solid #e0e0e0', background: activa ? '#EDFFD4' : '#f5f5f5', cursor: 'pointer', fontSize: '12px', color: activa ? '#2F6600' : '#555', fontWeight: activa ? '600' : '400' }}>{emoji} {count}</button>
            })}
            <button onClick={() => setComentariuDeschis(comentariuDeschis === post.id ? null : post.id)} style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: '20px', border: '1px solid #e0e0e0', background: '#f5f5f5', cursor: 'pointer', fontSize: '11px', color: '#888' }}>💬 {post.comentarii.length > 0 ? post.comentarii.length : ''}</button>
          </div>
          {post.comentarii.length > 0 && (
            <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: '8px', marginBottom: '8px' }}>
              {post.comentarii.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', fontWeight: '600', color: '#666', flexShrink: 0 }}>{c.autor.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                  <div style={{ background: '#f5f5f5', borderRadius: '10px', padding: '6px 10px', flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '2px' }}>{c.autor}</div>
                    <div style={{ fontSize: '12px', color: '#555' }}>{c.text}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {comentariuDeschis === post.id && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input value={comentariuText} onChange={e => setComentariuText(e.target.value)} onKeyDown={e => e.key === 'Enter' && adaugaComentariu(post.id)} placeholder="Scrie un comentariu..." style={{ flex: 1, padding: '8px 12px', borderRadius: '20px', border: '1px solid #e0e0e0', fontSize: '12px', outline: 'none', background: '#fafafa' }} />
              <button onClick={() => adaugaComentariu(post.id)} style={{ padding: '8px 14px', borderRadius: '20px', background: '#C8FF00', color: '#111', border: 'none', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Trimite</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Admin({ showToast }) {
  const [adminTab, setAdminTab] = useState('clienti')
  const [clase, setClase] = useState([])
  const [wods, setWods] = useState([])
  const [clienti, setClienti] = useState([])
  const [planuri, setPlanuri] = useState([])
  const [abonamente, setAbonamente] = useState([])
  const [_loadingClase, setLoadingClase] = useState(true)
  const [searchClienti, setSearchClienti] = useState('')

  const [numeClasa, setNumeClasa] = useState('CrossFit WOD')
  const [dataClasa, setDataClasa] = useState('')
  const [oraInceput, setOraInceput] = useState('07:00')
  const [oraSfarsit, setOraSfarsit] = useState('08:00')
  const [coachClasa, setCoachClasa] = useState('')
  const [locuriClasa, setLocuriClasa] = useState(12)
  const [repetitiva, setRepetitiva] = useState(false)
  const [saptamaniRepetare, setSaptamaniRepetare] = useState(4)
  const [zileRepetare, setZileRepetare] = useState([])
  const [laInfinit, setLaInfinit] = useState(false)
  const [savingClasa, setSavingClasa] = useState(false)

  const [tipWod, setTipWod] = useState('AMRAP')
  const [durataWod, setDurataWod] = useState('20 minute')
  const [dataWod, setDataWod] = useState('')
  const [numeWod, setNumeWod] = useState('')
  const [savingWod, setSavingWod] = useState(false)
  const [wodVariante, setWodVariante] = useState({ onramp: '', beginner: '', intermediate: '', rx: '' })

  const [emailAbonament, setEmailAbonament] = useState('')
  const [_numeAbonament, setNumeAbonament] = useState('')
  const [planSelectat, setPlanSelectat] = useState('')
  const [dataStartAbonament, setDataStartAbonament] = useState(new Date().toISOString().split('T')[0])
  const [pretPlatit, setPretPlatit] = useState('')
  const [savingAbonament, setSavingAbonament] = useState(false)

  const [numePlan, setNumePlan] = useState('')
  const [sedintePlan, setSedintePlan] = useState('')
  const [pretPlan, setPretPlan] = useState('')
  const [savingPlan, setSavingPlan] = useState(false)

  const [rezervariClasa, setRezervariClasa] = useState({})
  const [clasaDeschisa, setClasaDeschisa] = useState(null)
  const [clientSelectat, setClientSelectat] = useState(null)
  const [sortClienti, setSortClienti] = useState('toti')

  useEffect(() => { fetchClase(); fetchWods(); fetchClienti(); fetchPlanuri(); fetchAbonamente() }, [])

  const fetchClase = async () => {
    setLoadingClase(true)
    const { data } = await supabase.from('classes').select('*').order('date', { ascending: true }).order('start_time', { ascending: true })
    if (data) setClase(data)
    setLoadingClase(false)
  }

  const fetchWods = async () => {
    const { data } = await supabase.from('wods').select('*').order('date', { ascending: false })
    if (data) setWods(data)
  }

  const fetchClienti = async () => {
    const { data } = await supabase.from('profiles').select('*').order('full_name', { ascending: true })
    if (data) setClienti(data)
  }

  const fetchPlanuri = async () => {
    const { data } = await supabase.from('subscription_plans').select('*').eq('is_active', true).order('sessions', { ascending: true })
    if (data) { setPlanuri(data); if (data.length > 0 && !planSelectat) setPlanSelectat(data[0].id) }
  }

  const fetchAbonamente = async () => {
    const { data } = await supabase.from('subscriptions').select('*, subscription_plans(name, sessions)').eq('is_active', true).order('created_at', { ascending: false })
    if (data) setAbonamente(data)
  }

  const fetchRezervariClasa = async (classId) => {
    const { data } = await supabase.from('bookings')
      .select('member_id, profiles(id, full_name, email)')
      .eq('class_id', classId)
    if (data) {
      const rezultat = data.map(b => ({
        member_id: b.member_id,
        id: b.profiles?.id,
        full_name: b.profiles?.full_name,
        email: b.profiles?.email,
      }))
      setRezervariClasa(prev => ({ ...prev, [classId]: rezultat }))
    }
  }

  const toggleZiRepetare = (idx) =>
    setZileRepetare(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort((a, b) => a - b))

  const dateToStr = (d) => {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const z = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${z}`
  }

  const genereazaDateRepetare = () => {
    if (!dataClasa || zileRepetare.length === 0) return []
    const start = new Date(dataClasa + 'T00:00:00')
    const dow = start.getDay()
    const daysToMon = dow === 0 ? -6 : 1 - dow
    const luni = new Date(start)
    luni.setDate(luni.getDate() + daysToMon)
    const saptamani = laInfinit ? 52 : saptamaniRepetare
    const dates = []
    for (let w = 0; w < saptamani; w++) {
      for (const d of zileRepetare) {
        const zi = new Date(luni)
        zi.setDate(zi.getDate() + w * 7 + d)
        if (zi >= start) dates.push(dateToStr(zi))
      }
    }
    return dates
  }

  const saveClasa = async () => {
    if (!dataClasa) { showToast('❌ Completează data!'); return }
    if (repetitiva && zileRepetare.length === 0) { showToast('❌ Alege cel puțin o zi!'); return }
    setSavingClasa(true)
    const baza = { name: numeClasa, start_time: oraInceput, end_time: oraSfarsit, coach: coachClasa || 'Coach', max_spots: locuriClasa }
    const records = repetitiva
      ? genereazaDateRepetare().map(date => ({ ...baza, date }))
      : [{ ...baza, date: dataClasa }]
    if (records.length === 0) { showToast('❌ Nicio dată generată!'); setSavingClasa(false); return }
    const { error } = await supabase.from('classes').insert(records)
    if (error) { showToast('❌ ' + (error.message || 'Eroare!')); console.error(error) }
    else {
      showToast(repetitiva ? `✓ ${records.length} clase create!` : '✓ Clasă creată!')
      await fetchClase(); setDataClasa(''); setCoachClasa('')
    }
    setSavingClasa(false)
  }

  const stergeClaseleTrecute = async () => {
    const azi = new Date()
    const aziS = `${azi.getFullYear()}-${String(azi.getMonth()+1).padStart(2,'0')}-${String(azi.getDate()).padStart(2,'0')}`
    await supabase.from('classes').delete().lt('date', aziS)
    fetchClase()
  }

  const stergeSeria = async (c) => {
    const azi = new Date()
    const aziS = `${azi.getFullYear()}-${String(azi.getMonth()+1).padStart(2,'0')}-${String(azi.getDate()).padStart(2,'0')}`
    const { data: claseSeriei } = await supabase.from('classes').select('id')
      .eq('name', c.name).eq('start_time', c.start_time).eq('end_time', c.end_time).eq('coach', c.coach)
      .gte('date', aziS)
    const serieIds = claseSeriei?.map(cl => cl.id) || []
    if (serieIds.length > 0) {
      const { data: bks } = await supabase.from('bookings').select('member_id').in('class_id', serieIds)
      if (bks?.length > 0) {
        const memberIds = [...new Set(bks.map(b => b.member_id))]
        const { data: profs } = await supabase.from('profiles').select('id, email').in('id', memberIds)
        if (profs?.length > 0) {
          for (const prof of profs) {
            const email = prof.email?.toLowerCase()
            if (!email) continue
            const memberBookings = bks.filter(b => b.member_id === prof.id).length
            const { data: abo } = await supabase.from('subscriptions')
              .select('id, sessions_used')
              .eq('member_email', email)
              .eq('is_active', true)
              .not('sessions_total', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .single()
            if (abo) {
              await supabase.from('subscriptions')
                .update({ sessions_used: Math.max(0, (abo.sessions_used || 0) - memberBookings) })
                .eq('id', abo.id)
            }
          }
        }
      }
    }
    const { error } = await supabase.from('classes').delete()
      .eq('name', c.name).eq('start_time', c.start_time).eq('end_time', c.end_time).eq('coach', c.coach)
      .gte('date', aziS)
    if (error) showToast('❌ ' + error.message)
    else showToast('✓ Seria ștearsă!')
    await fetchClase()
  }

  const stergeClasa = async (id) => {
    // returnăm ședințele membrilor cu abonamente limitate care aveau rezervare
    const { data: bks } = await supabase.from('bookings').select('member_id').eq('class_id', id)
    if (bks?.length > 0) {
      const memberIds = bks.map(b => b.member_id)
      const { data: profs } = await supabase.from('profiles').select('id, email').in('id', memberIds)
      if (profs?.length > 0) {
        for (const prof of profs) {
          const email = prof.email?.toLowerCase()
          if (!email) continue
          const { data: abo } = await supabase.from('subscriptions')
            .select('id, sessions_used')
            .eq('member_email', email)
            .eq('is_active', true)
            .not('sessions_total', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
          if (abo) {
            await supabase.from('subscriptions')
              .update({ sessions_used: Math.max(0, (abo.sessions_used || 0) - 1) })
              .eq('id', abo.id)
          }
        }
      }
    }
    await supabase.from('classes').delete().eq('id', id)
    showToast('✓ Clasă ștearsă!'); await fetchClase()
  }

  const saveWod = async () => {
    if (!dataWod) { showToast('❌ Alege data!'); return }
    setSavingWod(true)
    const parseLinii = (text) => text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    const { error } = await supabase.from('wods').insert({
      date: dataWod, type: tipWod, duration: durataWod,
      name: numeWod.trim() || null,
      movements_onramp: parseLinii(wodVariante.onramp),
      movements_beginner: parseLinii(wodVariante.beginner),
      movements_intermediate: parseLinii(wodVariante.intermediate),
      movements_rx: parseLinii(wodVariante.rx),
    })
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else { showToast('✓ WOD creat!'); await fetchWods(); setDataWod(''); setNumeWod(''); setWodVariante({ onramp: '', beginner: '', intermediate: '', rx: '' }) }
    setSavingWod(false)
  }

  const stergeWod = async (id) => {
    await supabase.from('wods').delete().eq('id', id)
    showToast('✓ WOD șters!'); await fetchWods()
  }

  const saveAbonament = async () => {
    if (!emailAbonament || !planSelectat) { showToast('❌ Completează emailul și planul!'); return }
    setSavingAbonament(true)
    // dezactivam abonamentele vechi active pentru acelasi email
    await supabase.from('subscriptions')
      .update({ is_active: false })
      .eq('member_email', emailAbonament.toLowerCase().trim())
      .eq('is_active', true)
    const plan = planuri.find(p => p.id === planSelectat)
    const endDate = new Date(dataStartAbonament)
    endDate.setDate(endDate.getDate() + 30)
    const { error } = await supabase.from('subscriptions').insert({
      member_email: emailAbonament.toLowerCase().trim(),
      plan_id: planSelectat,
      sessions_total: plan?.sessions || null,
      sessions_used: 0,
      start_date: dataStartAbonament,
      end_date: endDate.toISOString().split('T')[0],
      is_active: true,
      notes: pretPlatit ? `Plătit: ${pretPlatit} RON` : null,
    })
    if (error) { showToast('❌ ' + (error.message || 'Eroare necunoscută')); console.error(error) }
    else {
      showToast('✓ Abonament adăugat!')
      await fetchAbonamente()
      setEmailAbonament(''); setNumeAbonament(''); setPretPlatit(''); setDataStartAbonament(new Date().toISOString().split('T')[0])
      sendNotification('subscription_added', emailAbonament.toLowerCase().trim(), plan?.name, endDate.toISOString().split('T')[0])
    }
    setSavingAbonament(false)
  }

  const savePlan = async () => {
    if (!numePlan) { showToast('❌ Introdu numele!'); return }
    setSavingPlan(true)
    const { error } = await supabase.from('subscription_plans').insert({
      name: numePlan, sessions: sedintePlan ? parseInt(sedintePlan) : null, price: pretPlan ? parseFloat(pretPlan) : null,
    })
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else { showToast('✓ Plan adăugat!'); await fetchPlanuri(); setNumePlan(''); setSedintePlan(''); setPretPlan('') }
    setSavingPlan(false)
  }

  const stergePlan = async (id) => {
    await supabase.from('subscription_plans').update({ is_active: false }).eq('id', id)
    showToast('✓ Plan șters!'); await fetchPlanuri()
  }

  const stergeAbonament = async (id) => {
    const abo = abonamente.find(a => a.id === id)
    if (abo?.member_email) {
      const email = abo.member_email.toLowerCase().trim()
      const { data: profil } = await supabase.from('profiles')
        .select('id').ilike('email', email).maybeSingle()
      if (profil?.id) {
        const aziStr = new Date().toISOString().split('T')[0]
        const { data: futureCls } = await supabase.from('classes').select('id').gte('date', aziStr)
        const futureIds = futureCls?.map(c => c.id) || []
        if (futureIds.length > 0) {
          const { error: delErr } = await supabase.from('bookings')
            .delete().eq('member_id', profil.id).in('class_id', futureIds)
          if (delErr) console.error('Eroare stergere rezervari:', delErr)
        }
      } else {
        console.warn('Profil negasit pentru email:', email)
      }
    }
    await supabase.from('subscriptions').update({ is_active: false }).eq('id', id)
    showToast('✓ Abonament anulat și rezervările viitoare șterse!')
    await fetchAbonamente()
    if (abo?.member_email) {
      const planName = abo.subscription_plans?.name || 'Abonament'
      sendNotification('subscription_cancelled', abo.member_email, planName, abo.end_date)
    }
  }

  const getAbonamentClient = (email) => abonamente.find(a => a.member_email?.toLowerCase() === email?.toLowerCase() && a.is_active)

  const esteClientActiv = (email) => {
    const abo = getAbonamentClient(email)
    if (!abo) return false
    const inceput = new Date(abo.start_date + 'T00:00:00') <= new Date()
    const neexpirat = new Date(abo.end_date + 'T23:59:59') >= new Date()
    const sedinteOK = abo.sessions_total == null || Math.max(0, abo.sessions_total - (abo.sessions_used || 0)) > 0
    return inceput && neexpirat && sedinteOK
  }
  const clientiFiltrati = clienti
    .filter(c => !searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase()))
    .filter(c => {
      if (sortClienti === 'toti') return true
      return sortClienti === 'activi' ? esteClientActiv(c.email) : !esteClientActiv(c.email)
    })

  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a' }}>⚙️ Admin</h1>
        <span style={{ background: '#FCEBEB', color: '#791F1F', fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>COACH</span>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[{ id: 'clienti', emoji: '👥', lbl: 'Clienți' }, { id: 'abonamente', emoji: '🎟️', lbl: 'Abonamente' }, { id: 'clase', emoji: '📅', lbl: 'Clase' }, { id: 'wod', emoji: '🏋️', lbl: 'WOD' }, { id: 'planuri', emoji: '📋', lbl: 'Planuri' }].map(t => (
          <div key={t.id} onClick={() => setAdminTab(t.id)}
            style={{ flex: adminTab === t.id ? '1 1 auto' : '0 0 auto', padding: '7px 10px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: adminTab === t.id ? '600' : '400', background: adminTab === t.id ? '#2F6600' : '#fff', color: adminTab === t.id ? '#fff' : '#888', border: '1px solid #e0e0e0', whiteSpace: 'nowrap', textAlign: 'center' }}>
            {t.emoji}{adminTab === t.id ? ` ${t.lbl}` : ''}
          </div>
        ))}
      </div>

      {/* CLIENTI */}
      {adminTab === 'clienti' && (
        <>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '10px 14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🔍</span>
            <input value={searchClienti} onChange={e => setSearchClienti(e.target.value)} placeholder="Caută după nume sau email..."
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', background: 'transparent' }} />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {[
              { id: 'toti', lbl: 'Toți', count: clienti.filter(c => !searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase())).length },
              { id: 'activi', lbl: '✓ Activi', count: clienti.filter(c => esteClientActiv(c.email) && (!searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase()))).length },
              { id: 'inactivi', lbl: '⚠️ Inactivi', count: clienti.filter(c => !esteClientActiv(c.email) && (!searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase()))).length },
            ].map(s => (
              <div key={s.id} onClick={() => setSortClienti(s.id)}
                style={{ padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: sortClienti === s.id ? '600' : '400', background: sortClienti === s.id ? '#2F6600' : '#fff', color: sortClienti === s.id ? '#fff' : '#888', border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                {s.lbl}
                <span style={{ background: sortClienti === s.id ? 'rgba(255,255,255,0.25)' : '#f0f0f0', color: sortClienti === s.id ? '#fff' : '#888', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: '600' }}>{s.count}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>
            {sortClienti === 'toti' ? 'TOȚI CLIENȚII' : sortClienti === 'activi' ? 'ACTIVI' : 'INACTIVI'} ({clientiFiltrati.length})
          </div>
          {clientiFiltrati.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#aaa', fontSize: '13px' }}>
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>👥</div>
              {clienti.length === 0 ? 'Niciun client înregistrat încă' : 'Niciun rezultat găsit'}
            </div>
          ) : clientiFiltrati.map(c => {
            const abo = getAbonamentClient(c.email)
            const zileRamase = abo ? Math.ceil((new Date(abo.end_date + 'T23:59:59') - new Date()) / (1000 * 60 * 60 * 24)) : null
            const sedinteEpuizate = abo?.sessions_total != null && Math.max(0, abo.sessions_total - (abo.sessions_used || 0)) === 0
            const neInceput = abo ? new Date(abo.start_date + 'T00:00:00') > new Date() : false
            const expirat = (zileRamase !== null && zileRamase < 0) || sedinteEpuizate
            const expiraCurand = !expirat && zileRamase !== null && zileRamase >= 0 && zileRamase <= 5
            const isOpen = clientSelectat === c.id
            return (
              <div key={c.id} onClick={() => setClientSelectat(isOpen ? null : c.id)}
                style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', borderLeft: `4px solid ${expirat ? '#E24B4A' : expiraCurand ? '#BA7517' : neInceput ? '#2F6600' : abo ? '#27500A' : '#e0e0e0'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AvatarCircle name={c.full_name || c.email} size={42} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.full_name || 'Fără nume'}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{c.email}</div>
                    {abo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: expirat ? '#FCEBEB' : expiraCurand ? '#FAEEDA' : neInceput ? '#EEEDFB' : '#EAF3DE', color: expirat ? '#791F1F' : expiraCurand ? '#633806' : neInceput ? '#2F6600' : '#27500A', fontWeight: '500' }}>
                          {sedinteEpuizate ? '⚠️ Epuizat' : expirat ? '⚠️ Expirat' : neInceput ? `📅 Din ${new Date(abo.start_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}` : expiraCurand ? `⏰ ${new Date(abo.end_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}` : `✓ ${new Date(abo.end_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}`}
                        </span>
                        <span style={{ fontSize: '10px', color: '#888' }}>{abo.subscription_plans?.name}</span>
                        {abo.sessions_total && <span style={{ fontSize: '10px', color: '#888' }}>· {(abo.sessions_used || 0)}/{abo.sessions_total} șed.</span>}
                      </div>
                    )}
                    {!abo && <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>Fără abonament</div>}
                  </div>
                </div>
                {isOpen && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                    {abo ? (
                      <div style={{ background: '#f5f5f5', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>
                          {sedinteEpuizate ? 'ABONAMENT EPUIZAT' : expirat ? 'ABONAMENT EXPIRAT' : neInceput ? 'ABONAMENT PROGRAMAT' : 'ABONAMENT ACTIV'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>Plan</span>
                          <span style={{ fontWeight: '600' }}>{abo.subscription_plans?.name}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>Expiră</span>
                          <span style={{ fontWeight: '600', color: expirat ? '#E24B4A' : expiraCurand ? '#BA7517' : '#1a1a1a' }}>{new Date(abo.end_date + 'T00:00:00').toLocaleDateString('ro-RO')}</span>
                        </div>
                        {abo.sessions_total && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>Ședințe</span>
                            <span style={{ fontWeight: '600', color: sedinteEpuizate ? '#E24B4A' : '#1a1a1a' }}>{abo.sessions_used || 0} / {abo.sessions_total}</span>
                          </div>
                        )}
                        {abo.notes && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{abo.notes}</div>}
                      </div>
                    ) : null}
                    <button onClick={(e) => { e.stopPropagation(); setAdminTab('abonamente'); setEmailAbonament(c.email); setNumeAbonament(c.full_name || '') }}
                      style={{ width: '100%', padding: '8px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                      {abo ? '🔄 Reînnoiește abonament' : '+ Adaugă abonament'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* ABONAMENTE */}
      {adminTab === 'abonamente' && (
        <>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>+ Abonament nou</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Email atlet</div>
            {(() => {
              const emailVal = emailAbonament.trim()
              const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)
              const borderColor = emailVal.length === 0 ? '#e0e0e0' : emailValid ? '#27500A' : '#E24B4A'
              return (
                <>
                  <input value={emailAbonament} onChange={e => setEmailAbonament(e.target.value)} placeholder="email@exemplu.com" type="email"
                    list="clienti-emails-list"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1.5px solid ${borderColor}`, fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '4px' }} />
                  {emailVal.length > 0 && !emailValid && (
                    <div style={{ fontSize: '11px', color: '#E24B4A', marginBottom: '4px' }}>Email invalid</div>
                  )}
                </>
              )
            })()}
            <datalist id="clienti-emails-list">
              {clienti.map(c => <option key={c.id} value={c.email}>{c.full_name}</option>)}
            </datalist>
            {(() => {
              const emailTastat = emailAbonament.toLowerCase().trim()
              if (emailTastat.length < 4) return null
              const similar = clienti.find(c => {
                const ce = c.email?.toLowerCase()
                return ce && ce !== emailTastat && levenshtein(ce, emailTastat) <= 3
              })
              return similar ? (
                <div style={{ fontSize: '11px', color: '#BA7517', background: '#FAEEDA', borderRadius: '8px', padding: '6px 10px', marginBottom: '6px' }}>
                  ⚠️ Email similar cu <strong>{similar.email}</strong> ({similar.full_name}). Verifică dacă e corect.
                </div>
              ) : null
            })()}
            <div style={{ marginBottom: '6px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Plan</div>
            <select value={planSelectat} onChange={e => {
              setPlanSelectat(e.target.value)
              const p = planuri.find(p => p.id === e.target.value)
              if (p?.price != null) setPretPlatit(String(p.price))
            }} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }}>
              {planuri.map(p => <option key={p.id} value={p.id}>{p.name}{p.price != null ? ` — ${p.price} RON` : ''}</option>)}
            </select>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Data start</div>
            <input type="date" value={dataStartAbonament} onChange={e => setDataStartAbonament(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Sumă plătită (RON)</div>
            <input type="number" value={pretPlatit} onChange={e => setPretPlatit(e.target.value)}
              placeholder={planuri.find(p => p.id === planSelectat)?.price != null ? `Standard: ${planuri.find(p => p.id === planSelectat).price} RON` : 'ex: 250'}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '4px' }} />
            {(() => {
              const planStd = planuri.find(p => p.id === planSelectat)
              if (!planStd?.price || !pretPlatit) return <div style={{ marginBottom: '10px' }} />
              const diff = parseFloat(pretPlatit) - planStd.price
              if (diff === 0) return <div style={{ fontSize: '11px', color: '#27500A', marginBottom: '10px' }}>✓ Suma corespunde prețului standard</div>
              return (
                <div style={{ fontSize: '11px', color: diff < 0 ? '#E24B4A' : '#BA7517', marginBottom: '10px' }}>
                  {diff < 0 ? `⚠️ Cu ${Math.abs(diff)} RON mai puțin decât prețul standard (${planStd.price} RON)` : `ℹ️ Cu ${diff} RON mai mult decât prețul standard (${planStd.price} RON)`}
                </div>
              )
            })()}
            <button onClick={saveAbonament} disabled={savingAbonament} style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingAbonament ? 'not-allowed' : 'pointer', opacity: savingAbonament ? 0.7 : 1 }}>
              {savingAbonament ? 'Se salvează...' : '+ Adaugă abonament'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>ABONAMENTE ({abonamente.length})</div>
          {abonamente.map(a => {
            const zileRamase = Math.ceil((new Date(a.end_date + 'T23:59:59') - new Date()) / (1000 * 60 * 60 * 24))
            const aSedinteEpuizate = a.sessions_total != null && Math.max(0, a.sessions_total - (a.sessions_used || 0)) === 0
            const aNeInceput = new Date(a.start_date + 'T00:00:00') > new Date()
            const expirat = zileRamase < 0 || aSedinteEpuizate
            const aActiv = !expirat && !aNeInceput
            const culoareData = expirat ? '#E24B4A' : aNeInceput ? '#E24B4A' : '#27500A'
            const membruNume = clienti.find(c => c.email?.toLowerCase() === a.member_email?.toLowerCase())?.full_name
            const fmtData = (d) => new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
            return (
              <div key={a.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: `4px solid ${expirat ? '#E24B4A' : aNeInceput ? '#E24B4A' : '#27500A'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a' }}>{membruNume || a.member_email}</div>
                    {membruNume && <div style={{ fontSize: '11px', color: '#555', marginTop: '1px' }}>{a.member_email}</div>}
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{a.subscription_plans?.name}</div>
                    <div style={{ fontSize: '11px', fontWeight: '500', color: culoareData, marginTop: '2px' }}>
                      {aSedinteEpuizate ? '⚠️ ' : aActiv ? '✓ ' : '📅 '}
                      {fmtData(a.start_date)} → {fmtData(a.end_date)}
                      {aSedinteEpuizate ? ' · epuizat' : ''}
                    </div>
                    {a.sessions_total && <div style={{ fontSize: '11px', color: aSedinteEpuizate ? '#E24B4A' : '#888' }}>Ședințe: {a.sessions_used || 0}/{a.sessions_total}</div>}
                    <div style={{ fontSize: '11px', color: '#2F6600', marginTop: '2px' }}>{a.notes || 'Plătit: 0 RON'}</div>
                  </div>
                  <button onClick={() => stergeAbonament(a.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer', marginLeft: '8px' }}>🗑️</button>
                </div>
              </div>
            )
          })}
        </>
      )}

      {/* CLASE */}
      {adminTab === 'clase' && (
        <>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>+ Clasă nouă</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Tip clasă</div>
            <input list="nume-clase-list" value={numeClasa} onChange={e => setNumeClasa(e.target.value)} placeholder="Nume clasă" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <datalist id="nume-clase-list">
              <option value="CrossFit WOD" /><option value="Weightlifting" /><option value="Gymnastics" />
              <option value="Powerlifting" /><option value="Open Gym" /><option value="Kids CrossFit" /><option value="Foundations" />
            </datalist>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Data</div>
            <input type="date" value={dataClasa} onChange={e => setDataClasa(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Ora început</div>
                <input type="time" value={oraInceput} onChange={e => setOraInceput(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Ora sfârșit</div>
                <input type="time" value={oraSfarsit} onChange={e => setOraSfarsit(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Coach</div>
            <input value={coachClasa} onChange={e => setCoachClasa(e.target.value)} placeholder="ex: Andrei M." style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Locuri</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <button onClick={() => setLocuriClasa(l => Math.max(1, l - 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>−</button>
              <span style={{ fontSize: '18px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{locuriClasa}</span>
              <button onClick={() => setLocuriClasa(l => Math.min(50, l + 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '16px', cursor: 'pointer' }}>+</button>
            </div>
            <div onClick={() => { setRepetitiva(!repetitiva); setZileRepetare([]); setLaInfinit(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: repetitiva ? '#EDFFD4' : '#f5f5f5', borderRadius: '10px', marginBottom: '10px', cursor: 'pointer', border: repetitiva ? '1.5px solid #2F6600' : '1.5px solid transparent' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a1a1a' }}>Repetă săptămânal</div>
                <div style={{ fontSize: '11px', color: '#888' }}>Creează automat pe zilele alese</div>
              </div>
              <div style={{ width: '44px', height: '26px', borderRadius: '13px', background: repetitiva ? '#2F6600' : '#ccc', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: '3px', left: repetitiva ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
            {repetitiva && (
              <div style={{ background: '#EDFFD4', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', color: '#2F6600', fontWeight: '600', marginBottom: '8px' }}>ZILELE SĂPTĂMÂNII</div>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '12px' }}>
                  {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((z, i) => (
                    <div key={i} onClick={() => toggleZiRepetare(i)}
                      style={{ flex: 1, height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: zileRepetare.includes(i) ? '#2F6600' : '#fff', color: zileRepetare.includes(i) ? '#fff' : '#888', border: zileRepetare.includes(i) ? '2px solid #2F6600' : '1px solid #C5C2F5' }}>
                      {z}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {[{ id: false, lbl: 'Nr. săptămâni' }, { id: true, lbl: 'Până opresc eu' }].map(opt => (
                    <div key={String(opt.id)} onClick={() => setLaInfinit(opt.id)}
                      style={{ flex: 1, padding: '7px', textAlign: 'center', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: laInfinit === opt.id ? '600' : '400', background: laInfinit === opt.id ? '#2F6600' : '#fff', color: laInfinit === opt.id ? '#fff' : '#888', border: laInfinit === opt.id ? '2px solid #2F6600' : '1px solid #C5C2F5' }}>
                      {opt.lbl}
                    </div>
                  ))}
                </div>
                {!laInfinit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <button onClick={() => setSaptamaniRepetare(s => Math.max(1, s - 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '16px', cursor: 'pointer' }}>−</button>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: '#2F6600', minWidth: '80px', textAlign: 'center' }}>{saptamaniRepetare} săpt.</span>
                    <button onClick={() => setSaptamaniRepetare(s => Math.min(52, s + 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '16px', cursor: 'pointer' }}>+</button>
                  </div>
                )}
                {laInfinit && (
                  <div style={{ fontSize: '11px', color: '#2F6600', marginBottom: '8px' }}>Se generează 1 an de clase (~52 săpt.). Șterge clasele viitoare când vrei să oprești.</div>
                )}
                {dataClasa && zileRepetare.length > 0 && (() => {
                  const dates = genereazaDateRepetare()
                  if (dates.length === 0) return null
                  const last = new Date(dates[dates.length - 1] + 'T00:00:00')
                  return (
                    <div style={{ fontSize: '11px', color: '#2F6600', lineHeight: '1.6' }}>
                      {dates.length} clase · până în {last.toLocaleDateString('ro-RO')}
                    </div>
                  )
                })()}
                {zileRepetare.length === 0 && <div style={{ fontSize: '11px', color: '#888' }}>Alege cel puțin o zi</div>}
              </div>
            )}
            <button onClick={saveClasa} disabled={savingClasa} style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingClasa ? 'not-allowed' : 'pointer', opacity: savingClasa ? 0.7 : 1 }}>
              {savingClasa ? 'Se salvează...' : repetitiva && zileRepetare.length > 0 && dataClasa ? `+ Creează ${genereazaDateRepetare().length} clase` : '+ Creează clasa'}
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', color: '#888' }}>CLASE ({clase.length})</div>
            {clase.some(c => c.date < new Date().toISOString().split('T')[0]) && (
              <button onClick={stergeClaseleTrecute} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer' }}>🗑️ Șterge trecute</button>
            )}
          </div>
          {clase.map(c => (
            <div key={c.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.name}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>📅 {new Date(c.date + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' })} · 🕐 {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)}</div>
                  <div style={{ fontSize: '12px', color: '#888' }}>👤 {c.coach} · {c.max_spots} locuri</div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => { if (clasaDeschisa === c.id) setClasaDeschisa(null); else { setClasaDeschisa(c.id); fetchRezervariClasa(c.id) } }}
                    style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '11px', cursor: 'pointer' }}>👥</button>
                  <button onClick={() => stergeClasa(c.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                  <button onClick={() => { if (window.confirm(`Ștergi toate clasele viitoare „${c.name}" ${c.start_time?.slice(0,5)}?`)) stergeSeria(c) }} style={{ padding: '4px 8px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>🗑️ serie</button>
                </div>
              </div>
              {clasaDeschisa === c.id && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f0f0f0' }}>
                  <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>REZERVĂRI ({rezervariClasa[c.id]?.length || 0})</div>
                  {!rezervariClasa[c.id] ? <div style={{ fontSize: '12px', color: '#aaa' }}>Se încarcă...</div>
                    : rezervariClasa[c.id].length === 0 ? <div style={{ fontSize: '12px', color: '#aaa' }}>Nicio rezervare</div>
                    : rezervariClasa[c.id].map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: i < rezervariClasa[c.id].length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                      <AvatarCircle name={r.full_name || r.email || r.member_id} size={28} />
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a1a1a' }}>{r.full_name || 'Utilizator'}</div>
                        <div style={{ fontSize: '10px', color: '#888' }}>{r.email || r.member_id?.slice(0,8) + '...'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* WOD */}
      {adminTab === 'wod' && (
        <>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>+ WOD nou</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Data WOD</div>
            <input type="date" value={dataWod} onChange={e => setDataWod(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Tip WOD</div>
            <select value={tipWod} onChange={e => setTipWod(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }}>
              <option>AMRAP</option><option>For Time</option><option>EMOM</option><option>Tabata</option>
              <option>Chipper</option><option>Ladder</option><option>Partner WOD</option>
            </select>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Durată</div>
            <input value={durataWod} onChange={e => setDurataWod(e.target.value)} placeholder="ex: 20 minute" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Nume antrenament <span style={{ color: '#bbb' }}>(opțional)</span></div>
            <input value={numeWod} onChange={e => setNumeWod(e.target.value)} placeholder='ex: "Fran", "Helen", "Grace"' style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
            {[
              { key: 'onramp', label: '🔵 OnRamp', culoare: '#0C447C', bg: '#E6F1FB' },
              { key: 'beginner', label: '🟢 Beginner', culoare: '#27500A', bg: '#EAF3DE' },
              { key: 'intermediate', label: '🟡 Intermediate', culoare: '#633806', bg: '#FAEEDA' },
              { key: 'rx', label: '🔴 RX', culoare: '#791F1F', bg: '#FCEBEB' },
            ].map(v => (
              <div key={v.key} style={{ background: v.bg, borderRadius: '12px', padding: '12px', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: v.culoare, marginBottom: '8px' }}>{v.label}</div>
                <textarea value={wodVariante[v.key]} onChange={e => setWodVariante(prev => ({ ...prev, [v.key]: e.target.value }))}
                  placeholder={'ex:\n10 Pull-ups\n20 Push-ups\n30 Air Squats'} rows={4}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'system-ui', outline: 'none' }} />
              </div>
            ))}
            <button onClick={saveWod} disabled={savingWod} style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingWod ? 'not-allowed' : 'pointer', opacity: savingWod ? 0.7 : 1 }}>
              {savingWod ? 'Se salvează...' : '+ Creează WOD'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>WOD-URI ({wods.length})</div>
          {wods.map(w => (
            <div key={w.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{w.name ? `"${w.name}" · ` : ''}{w.type} {formatWodDurata(w.duration)}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>📅 {new Date(w.date + 'T00:00:00').toLocaleDateString('ro-RO')}</div>
                  {w.movements_rx?.length > 0 && <div style={{ fontSize: '11px', color: '#791F1F', marginTop: '4px' }}>🔴 {w.movements_rx.slice(0,2).join(', ')}{w.movements_rx.length > 2 ? '...' : ''}</div>}
                </div>
                <button onClick={() => stergeWod(w.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* PLANURI */}
      {adminTab === 'planuri' && (
        <>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>+ Plan nou</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Nume plan</div>
            <input value={numePlan} onChange={e => setNumePlan(e.target.value)} placeholder="ex: 12 ședințe"
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Număr ședințe (gol = nelimitat)</div>
            <input type="number" value={sedintePlan} onChange={e => setSedintePlan(e.target.value)} placeholder="ex: 12"
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Preț (RON)</div>
            <input type="number" value={pretPlan} onChange={e => setPretPlan(e.target.value)} placeholder="ex: 250"
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
            <button onClick={savePlan} disabled={savingPlan} style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingPlan ? 'not-allowed' : 'pointer', opacity: savingPlan ? 0.7 : 1 }}>
              {savingPlan ? 'Se salvează...' : '+ Adaugă plan'}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>PLANURI ({planuri.length})</div>
          {planuri.map(p => (
            <div key={p.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{p.name}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    {p.sessions ? `${p.sessions} ședințe` : 'Nelimitat'} · {p.price != null ? `${p.price} RON` : 'Preț nesetat'}
                  </div>
                </div>
                <button onClick={() => stergePlan(p.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function JurnalList({ logs }) {
  const [deschis, setDeschis] = useState(null)
  if (logs.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
      <div style={{ fontSize: '36px', marginBottom: '10px' }}>📓</div>
      <div style={{ fontSize: '14px' }}>Niciun antrenament logat încă</div>
    </div>
  )
  return (
    <>
      {logs.map((w, i) => {
        const parts = (w.notes || '').split('\n---\n')
        const miscariLog = parts.length > 1 ? parts[0] : null
        const noteLog = parts.length > 1 ? parts[1] : (w.notes || null)
        const data = w.logged_at ? new Date(w.logged_at).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'
        const isOpen = deschis === i
        return (
          <div key={i} onClick={() => setDeschis(isOpen ? null : i)}
            style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #2F6600', cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#2F6600' }}>{w.variant_level || 'WOD'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ fontSize: '11px', color: '#aaa' }}>{data}</div>
                <span style={{ fontSize: '14px', color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
              {w.result && <span style={{ fontSize: '12px', background: '#EDFFD4', color: '#2F6600', padding: '3px 10px', borderRadius: '20px', fontWeight: '600' }}>🏅 {w.result}</span>}
              {w.time_result && <span style={{ fontSize: '12px', background: '#EAF3DE', color: '#27500A', padding: '3px 10px', borderRadius: '20px', fontWeight: '600' }}>⏱ {w.time_result}</span>}
              {!w.result && !w.time_result && <span style={{ fontSize: '12px', color: '#aaa' }}>—</span>}
            </div>
            {isOpen && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                {miscariLog && miscariLog.trim() && (
                  <div style={{ marginBottom: '8px' }}>
                    <div style={{ fontSize: '10px', color: '#888', fontWeight: '600', marginBottom: '4px' }}>MIȘCĂRI</div>
                    {miscariLog.trim().split('\n').map((m, j) => (
                      <div key={j} style={{ fontSize: '12px', color: '#555', padding: '2px 0' }}>• {m}</div>
                    ))}
                  </div>
                )}
                {noteLog && noteLog.trim() && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#888', fontWeight: '600', marginBottom: '4px' }}>NOTE</div>
                    <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>{noteLog.trim()}</div>
                  </div>
                )}
                {!miscariLog && !noteLog && (
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Nicio detaliere suplimentară.</div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function App() {
  const [screen, setScreen] = useState('home')
  const [prevScreen, setPrevScreen] = useState('home')
  const [wodDeschis, setWodDeschis] = useState(false)
  const [variantaAleasa, setVariantaAleasa] = useState(null)
  const [wodZiData, setWodZiData] = useState(null)
  const [dataAcasa, setDataAcasa] = useState(new Date().toISOString().split('T')[0])
  const [prSelectat, setPrSelectat] = useState(null)
  const [prDate, setPrDate] = useState([])
  const [wodLogs, setWodLogs] = useState([])
  const [miscarePR, setMiscarePR] = useState('')
  const [logPentruPR, setLogPentruPR] = useState(null)
  const [claseDB, setClaseDB] = useState([])
  const [zileCalendar, setZileCalendar] = useState(() => {
    const azi = new Date()
    const dates = []
    for (let i = 0; i <= 90; i++) {
      const d = new Date(azi)
      d.setDate(d.getDate() + i)
      dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)
    }
    return dates
  })
  const [ziSelectata, setZiSelectata] = useState(0)
  const aziChipRef = useRef(null)
  const chipsScrollRef = useRef(null)
  const scrolledOnce = useRef(false)
  const calSwipeX = useRef(null)
  const [rezervariMele, setRezervariMele] = useState([])
  const [rezervariPerClasa, setRezervariPerClasa] = useState({})
  const [clasaSelectata, setClasaSelectata] = useState(null)
  const [clasaTab, setClasaTab] = useState('ore')
  const [claseAziDeschise, setClaseAziDeschise] = useState(true)
  const [toast, setToast] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [abonamentReal, setAbonamentReal] = useState(null)
  const [abonamentLoading, setAbonamentLoading] = useState(true)
  const [prValoare, setPrValoare] = useState('')
  const [prReps, setPrReps] = useState('')
  const [prTimp, setPrTimp] = useState('')
  const [prDistanta, setPrDistanta] = useState('')
  const [prNote, setPrNote] = useState('')
  const [prVarianta, setPrVarianta] = useState('RX')
  const [prSaving, setPrSaving] = useState(false)
  const [wodResult, setWodResult] = useState('')
  const [wodTime, setWodTime] = useState('')
  const [wodNote, setWodNote] = useState('')
  const [wodSaving, setWodSaving] = useState(false)
  const [wodTip, setWodTip] = useState('AMRAP')
  const [wodDurata, setWodDurata] = useState('')
  const [wodMiscari, setWodMiscari] = useState([])
  const [wodMiscareCurenta, setWodMiscareCurenta] = useState('')
  const [logTab, setLogTab] = useState('nou')
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authScreen, setAuthScreen] = useState('login')
  const [authEmail, setAuthEmail] = useState(() => localStorage.getItem('forge_remember_email') || '')
  const [authPassword, setAuthPassword] = useState('')
  const [authNume, setAuthNume] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [rememberMe, setRememberMe] = useState(!!localStorage.getItem('forge_remember_email'))
  const [resetMode, setResetMode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [authEmailInit] = useState(localStorage.getItem('forge_remember_email') || '')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installDismissed, setInstallDismissed] = useState(false)
  const [clasamentLogs, setClasamentLogs] = useState([])
  const [clasamentLoading, setClasamentLoading] = useState(false)

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  const showInstall = !isStandalone && !installDismissed

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallDismissed(true)
    setInstallPrompt(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null); setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setResetMode(true); return }
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) {
      saveProfile()
      fetchPRuri()
      fetchWodLogs()
      fetchRezervari()
      fetchClaseDB()
      fetchWodZi()
      checkAdmin()
      fetchAbonamentMeu()
      fetchClasament()
      registerPushSubscription()
    }
  }, [user])

  const registerPushSubscription = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') return
      const sw = await navigator.serviceWorker.ready
      let sub = await sw.pushManager.getSubscription()
      if (!sub) {
        sub = await sw.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
      }
      await supabase.from('push_subscriptions').upsert({
        member_email: user.email.toLowerCase(),
        subscription: sub.toJSON(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'member_email' })
    } catch (e) { console.error('Push registration failed:', e) }
  }

  useEffect(() => { // eslint-disable-line react-hooks/exhaustive-deps
    const azi = new Date()
    const az = `${azi.getFullYear()}-${String(azi.getMonth()+1).padStart(2,'0')}-${String(azi.getDate()).padStart(2,'0')}`
    const idx = zileCalendar.indexOf(az)
    if (idx >= 0) setZiSelectata(idx)
    if (!scrolledOnce.current && zileCalendar.length > 0) {
      scrolledOnce.current = true
      setTimeout(() => {
        const container = chipsScrollRef.current
        const chip = aziChipRef.current
        if (container && chip) {
          container.scrollLeft = Math.max(0, chip.offsetLeft - 12)
        }
      }, 150)
    }
  }, [zileCalendar])

  useEffect(() => {
    if (screen === 'clasament' && user) fetchClasament()
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) fetchWodZi(dataAcasa)
  }, [dataAcasa]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    const channel = supabase.channel('realtime-app')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classes' }, () => {
        fetchClaseDB(); fetchClase()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        fetchRezervari(); fetchClaseDB()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => {
        fetchAbonamentMeu(); fetchAbonamente()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wods' }, () => {
        fetchWodZi(); fetchWods()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        fetchClienti()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wod_logs' }, () => {
        fetchWodLogs(); fetchClasament()
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || zileCalendar.length === 0) return
    const date = zileCalendar[ziSelectata]
    if (!date) return
    const ids = claseDB.filter(c => c.date === date).map(c => c.id)
    fetchRezervariZi(ids)
  }, [ziSelectata, claseDB, zileCalendar]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async () => {
    await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      full_name: user.user_metadata?.full_name || null,
    }, { onConflict: 'id' })
  }

  const checkAdmin = async () => {
    const { data } = await supabase.from('admins').select('id').eq('id', user.id)
    setIsAdmin(data && data.length > 0)
  }

  const fetchAbonamentMeu = async () => {
    setAbonamentLoading(true)
    const { data, error } = await supabase.from('subscriptions')
      .select('*, subscription_plans(name, sessions)')
      .eq('member_email', user.email.toLowerCase())
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) console.error('fetchAbonamentMeu error:', error)
    if (data && data.length > 0) setAbonamentReal(data[0])
    else setAbonamentReal(null)
    setAbonamentLoading(false)
  }

  const fetchPRuri = async () => {
    const { data } = await supabase.from('personal_records').select('*').eq('member_id', user.id).order('recorded_at', { ascending: false })
    if (data) setPrDate(data)
  }

  const fetchWodLogs = async () => {
    const { data } = await supabase.from('wod_logs').select('*').eq('member_id', user.id).order('logged_at', { ascending: false })
    if (data) setWodLogs(data)
  }

  const fetchClaseDB = async () => {
    const acum30 = new Date()
    acum30.setDate(acum30.getDate() - 30)
    const de30Str = `${acum30.getFullYear()}-${String(acum30.getMonth()+1).padStart(2,'0')}-${String(acum30.getDate()).padStart(2,'0')}`
    const { data } = await supabase.from('classes').select('*')
      .gte('date', de30Str)
      .order('date', { ascending: true }).order('start_time', { ascending: true })
    const dbData = data || []
    setClaseDB(dbData)
    const azi = new Date()
    const dates = new Set(dbData.map(c => c.date))
    for (let i = 0; i <= 90; i++) {
      const d = new Date(azi)
      d.setDate(d.getDate() + i)
      dates.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)
    }
    setZileCalendar([...dates].sort())
  }

  const fetchRezervari = async () => {
    const { data } = await supabase.from('bookings').select('class_id').eq('member_id', user.id)
    if (data) setRezervariMele(data.map(b => b.class_id))
  }

  const fetchRezervariZi = async (classIds) => {
    if (!classIds || classIds.length === 0) return
    const { data } = await supabase.from('bookings').select('class_id, member_id').in('class_id', classIds)
    if (!data) return
    const grouped = {}
    classIds.forEach(id => { grouped[id] = [] })
    data.forEach(b => { if (grouped[b.class_id] !== undefined) grouped[b.class_id].push(b.member_id) })
    const allIds = [...new Set(data.map(b => b.member_id))]
    let profilesMap = {}
    if (allIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', allIds)
      if (profiles) profiles.forEach(p => { profilesMap[p.id] = p.full_name })
    }
    const result = {}
    classIds.forEach(id => {
      result[id] = { count: grouped[id].length, membri: grouped[id].map(mid => profilesMap[mid] || 'Membru') }
    })
    setRezervariPerClasa(result)
  }

  const fetchClasament = async () => {
    setClasamentLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data: logs } = await supabase
      .from('wod_logs')
      .select('*')
      .gte('logged_at', today + 'T00:00:00')
      .lte('logged_at', today + 'T23:59:59')
      .in('variant_level', ['OnRamp', 'Beginner', 'Intermediate', 'RX'])
    if (logs && logs.length > 0) {
      const ids = [...new Set(logs.map(l => l.member_id))]
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
      const map = {}
      if (profiles) profiles.forEach(p => { map[p.id] = p })
      setClasamentLogs(logs.map(l => ({ ...l, profile: map[l.member_id] })))
    } else {
      setClasamentLogs([])
    }
    setClasamentLoading(false)
  }

  const fetchWodZi = async (data_param) => {
    const data_str = data_param || dataAcasa || new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('wods').select('*').eq('date', data_str).maybeSingle()
    setWodZiData(data || null)
  }

  const handleLogin = async () => {
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) { setAuthError(error.message) }
    else { rememberMe ? localStorage.setItem('forge_remember_email', authEmail) : localStorage.removeItem('forge_remember_email') }
    setAuthSubmitting(false)
  }

  const handleSetNewPassword = async () => {
    if (newPassword !== newPasswordConfirm) { setAuthError('Parolele nu coincid.'); return }
    if (newPassword.length < 6) { setAuthError('Parola trebuie să aibă minim 6 caractere.'); return }
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setAuthError(error.message)
    else { setResetMode(false); setNewPassword(''); setNewPasswordConfirm('') }
    setAuthSubmitting(false)
  }

  const handleForgotPassword = async () => {
    if (!authEmail) { setAuthError('Introdu emailul mai întâi.'); return }
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: window.location.origin })
    if (error) setAuthError(error.message)
    else setAuthError('✓ Email de resetare trimis! Verifică inbox-ul.')
    setAuthSubmitting(false)
  }

  const handleRegister = async () => {
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { full_name: authNume } } })
    if (error) setAuthError(error.message)
    else setAuthError('✓ Verifică emailul pentru confirmare!')
    setAuthSubmitting(false)
  }

  const handleLogout = async () => { await supabase.auth.signOut() }
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const goTimer = () => { setPrevScreen(screen); setScreen('timer') }

  const saveWodLog = async () => {
    const areContiut = wodResult.trim() || wodTime.trim() || wodMiscari.length > 0
    if (!areContiut) { showToast('❌ Completează cel puțin rezultatul, timpul sau o mișcare!'); return }
    setWodSaving(true)
    const miscariText = wodMiscari.length > 0 ? wodMiscari.join('\n') : ''
    const noteFull = [miscariText, wodNote].filter(Boolean).join('\n---\n')
    const tipSalvat = variantaAleasa !== null ? ['OnRamp','Beginner','Intermediate','RX'][variantaAleasa] : `${wodTip}${wodDurata ? ' · ' + wodDurata : ''}`
    const { error } = await supabase.from('wod_logs').insert({
      member_id: user.id, wod_id: null,
      variant_level: tipSalvat,
      result: wodResult || null, time_result: wodTime || null, notes: noteFull || null,
    })
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else {
      showToast('WOD salvat! 🎉'); await fetchWodLogs(); fetchClasament()
      setScreen('home'); setWodDeschis(false); setVariantaAleasa(null)
      setWodResult(''); setWodTime(''); setWodNote('')
      setWodTip('AMRAP'); setWodDurata(''); setWodMiscari([]); setWodMiscareCurenta('')
    }
    setWodSaving(false)
  }

  const savePR = async () => {
    if (!miscarePR) return
    const areValoare = prValoare.trim() || prReps.trim() || prTimp.trim() || prDistanta.trim()
    if (!areValoare) { showToast('❌ Completează cel puțin o valoare (greutate, reps, timp sau distanță)!'); return }
    setPrSaving(true)
    const isBenchmark = ['Fran','Grace','Cindy','Helen','Diane','Annie','Barbara','Murph','DT','Jackie','Nancy','Amanda'].includes(miscarePR)
    const isCardio = ['Row','Run','Bike Erg','Assault Bike','Ski Erg'].includes(miscarePR)
    const isGym = ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump'].includes(miscarePR)
    const isHold = ['Handstand Hold','L-sit Hold'].includes(miscarePR)
    let insertData = { member_id: user.id, movement: miscarePR, notes: prNote || null }
    if (isBenchmark) { insertData.unit = 'timp'; insertData.notes = (prVarianta ? prVarianta + ' | ' : '') + (prNote || '') }
    else if (isCardio) { insertData.value = prDistanta ? parseFloat(prDistanta) : null; insertData.unit = 'm' }
    else if (isGym) { insertData.reps = prReps ? parseInt(prReps) : null; insertData.unit = 'reps' }
    else if (isHold) { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.unit = 'sec' }
    else { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.reps = prReps ? parseInt(prReps) : null; insertData.unit = 'kg' }
    const { error } = await supabase.from('personal_records').insert(insertData)
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else { showToast('PR salvat! 🏆'); await fetchPRuri(); setScreen('pr'); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrNote(''); setPrVarianta('RX') }
    setPrSaving(false)
  }

  const sedinteLimitate = abonamentReal?.sessions_total != null
  const sedinteRamase = sedinteLimitate ? Math.max(0, (abonamentReal.sessions_total) - (abonamentReal.sessions_used || 0)) : null

  const toggleRezervare = async (clasaId) => {
    const esteRezervat = rezervariMele.includes(clasaId)
    if (!esteRezervat && !isAdmin) {
      if (!abonamentReal) {
        showToast('❌ Nu ai un abonament activ!')
        return
      }
      if (new Date(abonamentReal.start_date + 'T00:00:00') > new Date()) {
        showToast(`❌ Abonamentul tău începe pe ${new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString('ro-RO')}!`)
        return
      }
      if (new Date(abonamentReal.end_date + 'T23:59:59') < new Date()) {
        showToast('❌ Abonamentul tău a expirat!')
        return
      }
      if (sedinteLimitate && sedinteRamase <= 0) {
        showToast('❌ Ai epuizat toate ședințele din abonament!')
        return
      }
    }
    if (!esteRezervat) {
      const clasa = claseDB.find(c => c.id === clasaId)
      const ocupate = rezervariPerClasa[clasaId]?.count ?? 0
      if (clasa && ocupate >= clasa.max_spots) {
        showToast('❌ Clasa este plină!')
        return
      }
    }
    if (esteRezervat) {
      await supabase.from('bookings').delete().eq('member_id', user.id).eq('class_id', clasaId)
      setRezervariMele(prev => prev.filter(id => id !== clasaId))
      if (!isAdmin && sedinteLimitate && abonamentReal?.id) {
        const newUsed = Math.max(0, (abonamentReal.sessions_used || 0) - 1)
        await supabase.from('subscriptions').update({ sessions_used: newUsed }).eq('id', abonamentReal.id)
        setAbonamentReal(prev => prev ? { ...prev, sessions_used: newUsed } : prev)
      }
      showToast('✓ Rezervare anulată')
    } else {
      await supabase.from('bookings').insert({ member_id: user.id, class_id: clasaId })
      setRezervariMele(prev => [...prev, clasaId])
      if (!isAdmin && sedinteLimitate && abonamentReal?.id) {
        const newUsed = (abonamentReal.sessions_used || 0) + 1
        await supabase.from('subscriptions').update({ sessions_used: newUsed }).eq('id', abonamentReal.id)
        setAbonamentReal(prev => prev ? { ...prev, sessions_used: newUsed } : prev)
      }
      showToast('✓ Loc rezervat! Te așteptăm!')
    }
    setClasaSelectata(null)
    await fetchClaseDB()
    await fetchAbonamentMeu()
  }

  const _azi = new Date()
  const aziStr = `${_azi.getFullYear()}-${String(_azi.getMonth()+1).padStart(2,'0')}-${String(_azi.getDate()).padStart(2,'0')}`

  const claseGroupate = zileCalendar.map(date => ({
    date,
    zi: new Date(date + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'short' }),
    nr: new Date(date + 'T00:00:00').getDate(),
    luna: new Date(date + 'T00:00:00').toLocaleDateString('ro-RO', { month: 'short' }),
    clase: claseDB.filter(c => c.date === date)
  }))

  const rezervarileMeleAfisate = claseDB.filter(c => rezervariMele.includes(c.id) && new Date(`${c.date}T${c.end_time}`) > new Date())

  const VARIANTE_CONFIG = [
    { nivel: 'RX', culoare: '#C45000', bg: '#FFF3EC', emoji: '🟠', key: 'movements_rx' },
    { nivel: 'Intermediate', culoare: '#633806', bg: '#FAEEDA', emoji: '🟡', key: 'movements_intermediate' },
    { nivel: 'Beginner', culoare: '#27500A', bg: '#EAF3DE', emoji: '🟢', key: 'movements_beginner' },
    { nivel: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB', emoji: '🔵', key: 'movements_onramp' },
  ]

  const abonamentInceput = abonamentReal ? new Date(abonamentReal.start_date + 'T00:00:00') <= new Date() : false

  // Clase rezervate care nu s-au terminat inca (sedinte "in asteptare", nu consumate)
  const sedinteProgramateViitor = sedinteLimitate
    ? claseDB.filter(c => rezervariMele.includes(c.id) && new Date(`${c.date}T${c.end_time}`) > new Date()).length
    : 0

  const abonamentActiv = abonamentReal !== null
    && abonamentInceput
    && new Date(abonamentReal.end_date + 'T23:59:59') >= new Date()
    && (!sedinteLimitate || (sedinteRamase + sedinteProgramateViitor) > 0)
  const zileRamaseAbonament = abonamentReal ? Math.ceil((new Date(abonamentReal.end_date + 'T23:59:59') - new Date()) / (1000 * 60 * 60 * 24)) : null

  if (resetMode) return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box' }}>
      <img src="/forge.png" alt="Forge" style={{ width: '100px', height: '100px', borderRadius: '22px', marginBottom: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
      <div style={{ width: '100%', background: '#1a1a1a', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>Parolă nouă</div>
          <div style={{ fontSize: '13px', color: '#888' }}>Alege o parolă nouă pentru contul tău</div>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>Parolă nouă</div>
          <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" placeholder="minimum 6 caractere"
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>Confirmă parola</div>
          <input value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} type="password" placeholder="repetă parola"
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        {authError && (
          <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', background: authError.startsWith('✓') ? '#1a2e0f' : '#2e0f0f', color: authError.startsWith('✓') ? '#7dce4e' : '#ff7070', fontSize: '12px' }}>
            {authError}
          </div>
        )}
        <button onClick={handleSetNewPassword} disabled={authSubmitting}
          style={{ width: '100%', padding: '13px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: authSubmitting ? 'not-allowed' : 'pointer', opacity: authSubmitting ? 0.7 : 1, fontFamily: 'system-ui' }}>
          {authSubmitting ? 'Se salvează...' : 'Salvează parola'}
        </button>
      </div>
    </div>
  )

  if (authLoading) return (
    <div style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100vh', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏋️</div>
        <div style={{ fontSize: '14px', color: '#888' }}>Se încarcă...</div>
      </div>
    </div>
  )

  if (!user) return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box', overflowY: 'auto' }}>
      {installDismissed && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setInstallDismissed(false)}>
        <div style={{ background: '#1c1c1e', borderRadius: '24px 24px 0 0', padding: '24px 24px 48px', width: '100%', maxWidth: '430px' }} onClick={e => e.stopPropagation()}>
          <div style={{ width: '36px', height: '4px', background: '#444', borderRadius: '2px', margin: '0 auto 24px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
            <img src="/forge.png" alt="Forge" style={{ width: '56px', height: '56px', borderRadius: '12px' }} />
            <div>
              <div style={{ fontSize: '17px', fontWeight: '700', color: '#fff' }}>Instalează Forge</div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>Adaugă pe ecranul principal</div>
            </div>
          </div>
          {isIOS ? (<>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {[
                { nr: '1', text: 'Apasă butonul', icon: '⎋', sub: 'Share — în bara de jos a Safari' },
                { nr: '2', text: 'Derulează și alege', icon: '＋', sub: '"Add to Home Screen"' },
                { nr: '3', text: 'Apasă', icon: '✓', sub: '"Add" în colțul din dreapta sus' },
              ].map(s => (
                <div key={s.nr} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#2c2c2e', borderRadius: '14px', padding: '14px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#2F6600', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: '500' }}>{s.text}</div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: '#2c2c2e', borderRadius: '14px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '20px' }}>💡</span>
              <span style={{ fontSize: '12px', color: '#888', lineHeight: '1.5' }}>Butonul Share (⎋) se află în mijlocul barei de jos din Safari</span>
            </div>
          </>) : (<>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {[
                { icon: '⋮', text: 'Apasă meniul', sub: 'Cele 3 puncte din colțul browserului' },
                { icon: '＋', text: 'Alege opțiunea', sub: '"Adaugă pe ecranul principal"' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#2c2c2e', borderRadius: '14px', padding: '14px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#2F6600', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: '500' }}>{s.text}</div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </>)}
          <button onClick={() => setInstallDismissed(false)} style={{ width: '100%', padding: '14px', background: '#2c2c2e', color: '#fff', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>Am înțeles</button>
        </div>
      </div>}
      <img src="/forge.png" alt="Forge" style={{ width: '140px', height: '140px', borderRadius: '28px', marginBottom: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
      {!isStandalone && (
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          {installPrompt ? (
            <button onClick={handleInstall} style={{ background: 'none', border: '1px solid #444', borderRadius: '20px', padding: '8px 20px', color: '#aaa', fontSize: '13px', cursor: 'pointer' }}>
              + Adaugă pe ecranul principal
            </button>
          ) : (
            <button onClick={() => setInstallDismissed(true)} style={{ background: 'none', border: '1px solid #444', borderRadius: '20px', padding: '8px 20px', color: '#aaa', fontSize: '13px', cursor: 'pointer' }}>
              + Adaugă pe ecranul principal
            </button>
          )}
        </div>
      )}
      <div style={{ width: '100%', background: '#1a1a1a', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>Forge</h1>
          <p style={{ fontSize: '13px', color: '#888' }}>{authScreen === 'login' ? 'Bine ai revenit!' : 'Creează cont nou'}</p>
        </div>
        {authScreen === 'register' && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>Nume complet</div>
            <input value={authNume} onChange={e => setAuthNume(e.target.value)} placeholder="ex: Alex Ionescu" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
          </div>
        )}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>Email</div>
          <input value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="email@exemplu.com" type="email" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        <div style={{ marginBottom: authScreen === 'login' ? '12px' : '20px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>Parolă</div>
          <input value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="minimum 6 caractere" type="password" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        {authScreen === 'login' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                style={{ width: '16px', height: '16px', accentcolor: '#2F6600', cursor: 'pointer' }} />
              <span style={{ fontSize: '13px', color: '#aaa' }}>Remember me</span>
            </label>
            <span onClick={handleForgotPassword} style={{ fontSize: '13px', color: '#2F6600', cursor: 'pointer', fontWeight: '500' }}>
              Forgot password?
            </span>
          </div>
        )}
        {authError && (
          <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', background: authError.startsWith('✓') ? '#1a2e0f' : '#2e0f0f', color: authError.startsWith('✓') ? '#7dce4e' : '#ff7070', fontSize: '12px' }}>
            {authError}
          </div>
        )}
        <button onClick={authScreen === 'login' ? handleLogin : handleRegister} disabled={authSubmitting}
          style={{ width: '100%', padding: '13px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: authSubmitting ? 'not-allowed' : 'pointer', opacity: authSubmitting ? 0.7 : 1, fontFamily: 'system-ui' }}>
          {authSubmitting ? 'Se încarcă...' : authScreen === 'login' ? 'Intră în cont' : 'Creează cont'}
        </button>
        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#888' }}>
          {authScreen === 'login' ? 'Nu ai cont? ' : 'Ai deja cont? '}
          <span onClick={() => { setAuthScreen(authScreen === 'login' ? 'register' : 'login'); setAuthError('') }} style={{ color: '#2F6600', fontWeight: '600', cursor: 'pointer' }}>
            {authScreen === 'login' ? 'Înregistrează-te' : 'Intră în cont'}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: '430px', width: '100%', margin: '0 auto', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui', position: 'relative', boxShadow: 'none' }}>

      <div style={{ position: 'sticky', top: 0, zIndex: 90, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/forge.png" alt="Forge" style={{ height: '32px', width: '32px', borderRadius: '8px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '16px', letterSpacing: '1px' }}>FORGE</span>
        </div>
        <span style={{ fontSize: '14px', fontWeight: '600' }}>
          <span style={{ color: '#fff' }}>CrossFit </span>
          <span style={{ color: '#C8FF00' }}>C15</span>
        </span>
      </div>

      {!isAdmin && !abonamentLoading && !abonamentActiv && screen !== 'abonament' && screen !== 'clase' && screen !== 'clasament' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '20px', padding: '32px 24px', textAlign: 'center', maxWidth: '340px', width: '100%' }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>🔒</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#1a1a1a', marginBottom: '8px' }}>
              {!abonamentReal ? 'Niciun abonament activ'
                : !abonamentInceput ? 'Abonament programat'
                : sedinteLimitate && sedinteRamase === 0 ? 'Ședințe epuizate'
                : 'Abonamentul a expirat'}
            </div>
            <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6', marginBottom: '22px' }}>
              {!abonamentReal
                ? 'Nu ai un abonament activ. Contactează coachul pentru a te înscrie.'
                : !abonamentInceput
                  ? `Abonamentul tău începe pe ${new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}. Revino atunci!`
                  : sedinteLimitate && sedinteRamase === 0
                    ? 'Ai consumat toate ședințele din abonament. Contactează coachul pentru a achiziționa un abonament nou.'
                    : 'Abonamentul tău a expirat. Contactează coachul pentru reînnoire.'}
            </div>
            <button onClick={() => setScreen('abonament')} style={{ width: '100%', padding: '13px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }}>
              Vezi abonamentul →
            </button>
            <button onClick={handleLogout} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#aaa', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '12px', cursor: 'pointer' }}>
              Deconectează-te
            </button>
          </div>
        </div>
      )}

      {screen === 'home' && (() => {
        const actualToday = new Date().toISOString().split('T')[0]
        const selData = new Date(dataAcasa + 'T00:00:00')
        const addZile = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
        const dow = selData.getDay()
        const monday = new Date(selData); monday.setDate(selData.getDate() - (dow === 0 ? 6 : dow - 1))
        const saptamana = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday); d.setDate(monday.getDate() + i)
          const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
          return { d, ds, areWod: wodLogs.some(l => l.logged_at && new Date(l.logged_at).toISOString().split('T')[0] === ds), esteAzi: ds === actualToday, esteSelectat: ds === dataAcasa }
        })
        const zileSapt = ['L','Ma','Mi','J','V','S','D']
        const claseZi = claseDB.filter(c => c.date === dataAcasa).sort((a,b) => a.start_time.localeCompare(b.start_time))
        const zileRamase = abonamentReal ? Math.max(0, Math.ceil((new Date(abonamentReal.end_date + 'T23:59:59') - new Date()) / 86400000)) : 0
        const sessTotal = abonamentReal?.sessions_total
        const sessUsed = abonamentReal?.sessions_used || 0
        const progres = sessTotal ? Math.min(1, sessUsed / sessTotal) : 0
        const prenume = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Athlete'
        const numeFull = user?.user_metadata?.full_name || user?.email || ''
        const initiale = numeFull.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'U'
        const esteAzi = dataAcasa === actualToday
        return (
          <div style={{ paddingBottom: '80px', background: '#f5f5f5' }}>

            {/* ── Card dată + calendar săptămânal ── */}
            <div style={{ background: '#fff', padding: '20px 20px 18px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                {/* Navigare dată */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span onClick={() => setDataAcasa(addZile(dataAcasa, -1))} style={{ fontSize: '22px', color: '#bbb', cursor: 'pointer', padding: '0 4px', userSelect: 'none' }}>‹</span>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: '900', color: '#1a1a1a', letterSpacing: '-0.5px', lineHeight: 1 }}>
                      {selData.getDate()} {selData.toLocaleDateString('ro-RO', { month: 'long' }).toUpperCase()}
                    </div>
                    {!esteAzi && (
                      <div onClick={() => setDataAcasa(actualToday)} style={{ fontSize: '10px', color: '#2F6600', fontWeight: '600', cursor: 'pointer', marginTop: '2px' }}>← Înapoi la azi</div>
                    )}
                  </div>
                  <span onClick={() => setDataAcasa(addZile(dataAcasa, 1))} style={{ fontSize: '22px', color: '#bbb', cursor: 'pointer', padding: '0 4px', userSelect: 'none' }}>›</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: '#2F6600', lineHeight: 1 }}>{wodLogs.length}</div>
                    <div style={{ fontSize: '9px', color: '#aaa', fontWeight: '700', letterSpacing: '0.1em', marginTop: '1px' }}>SESIUNI</div>
                  </div>
                  <div style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: '13px', fontWeight: '800', color: '#C8FF00', letterSpacing: '-0.5px' }}>{initiale}</span>
                  </div>
                </div>
              </div>
              <p style={{ fontSize: '14px', color: '#888', marginBottom: '18px' }}>Hey {prenume}, let's get after it today.</p>

              {/* Calendar săptămânal interactiv + swipe stânga/dreapta = săptămâna anterioară/următoare */}
              <div
                style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', textAlign: 'center', touchAction: 'pan-y' }}
                onTouchStart={e => { calSwipeX.current = e.touches[0].clientX }}
                onTouchEnd={e => {
                  if (calSwipeX.current === null) return
                  const dx = e.changedTouches[0].clientX - calSwipeX.current
                  calSwipeX.current = null
                  if (Math.abs(dx) > 40) setDataAcasa(addZile(dataAcasa, dx < 0 ? 7 : -7))
                }}
              >
                {zileSapt.map((z, i) => (
                  <div key={i} style={{ fontSize: '10px', color: '#bbb', fontWeight: '700', letterSpacing: '0.04em', paddingBottom: '6px' }}>{z}</div>
                ))}
                {saptamana.map(({ d, ds, areWod, esteAzi: eAzi, esteSelectat }, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setDataAcasa(ds)}>
                    <div style={{
                      width: '38px', height: '38px', borderRadius: '10px', cursor: 'pointer',
                      background: esteSelectat ? '#1a1a1a' : 'transparent',
                      border: eAzi && !esteSelectat ? '2px solid #1a1a1a' : 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px'
                    }}>
                      <span style={{ fontSize: '15px', fontWeight: esteSelectat || eAzi ? '900' : '400', color: esteSelectat ? '#C8FF00' : '#1a1a1a', lineHeight: 1 }}>{d.getDate()}</span>
                      {areWod && <span style={{ fontSize: esteSelectat ? '7px' : '9px', lineHeight: 1, color: esteSelectat ? '#C8FF00' : '#C8FF00' }}>⚡</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Clase azi ── */}
            <div style={{ background: '#fff', marginBottom: '10px' }}>
              <div onClick={() => setClaseAziDeschise(!claseAziDeschise)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', cursor: 'pointer' }}>
                <span style={{ fontSize: '12px', fontWeight: '800', color: '#1a1a1a', letterSpacing: '0.06em' }}>CROSSFIT C15</span>
                <span style={{ fontSize: '18px', color: '#888', display: 'inline-block', transform: claseAziDeschise ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>⌄</span>
              </div>
              {claseAziDeschise && (
                <div style={{ padding: '0 16px 16px', display: 'flex', gap: '10px', overflowX: 'auto' }}>
                  {claseZi.length === 0
                    ? <div style={{ padding: '8px 4px', color: '#aaa', fontSize: '13px' }}>Nicio clasă {esteAzi ? 'azi' : 'în această zi'}</div>
                    : claseZi.map(c => {
                        const rezervat = rezervariMele.includes(c.id)
                        const nrRez = rezervariPerClasa[c.id]?.count || 0
                        const plin = nrRez >= c.max_spots
                        const bgCol = rezervat ? '#EDFFD4' : plin ? '#FFEBEE' : '#FFF8E1'
                        const txtCol = rezervat ? '#2F6600' : plin ? '#C62828' : '#8B6914'
                        return (
                          <div key={c.id} onClick={() => { setScreen('clase') }} style={{ background: bgCol, borderRadius: '14px', padding: '12px 14px', minWidth: '120px', flexShrink: 0, cursor: 'pointer' }}>
                            <div style={{ fontSize: '17px', fontWeight: '800', color: txtCol, letterSpacing: '-0.3px' }}>{c.start_time.slice(0,5)}</div>
                            <div style={{ fontSize: '12px', color: txtCol, marginTop: '2px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '110px' }}>{c.name || 'CrossFit WOD'}</div>
                            {rezervat && <div style={{ fontSize: '10px', color: '#2F6600', marginTop: '5px', fontWeight: '700' }}>✓ Rezervat</div>}
                            {!rezervat && plin && <div style={{ fontSize: '10px', color: '#C62828', marginTop: '5px' }}>Complet</div>}
                          </div>
                        )
                      })
                  }
                </div>
              )}
            </div>

            {/* ── WOD ── */}
            <div style={{ background: '#fff', marginBottom: '10px', padding: '16px 20px' }}>
              <div onClick={() => setWodDeschis(!wodDeschis)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontSize: '10px', color: '#bbb', fontWeight: '700', letterSpacing: '0.1em', marginBottom: '3px' }}>WORKOUT OF THE DAY</div>
                  <div style={{ fontSize: '17px', fontWeight: '700', color: '#1a1a1a' }}>
                    {wodZiData ? (wodZiData.name ? `"${wodZiData.name}"` : `${wodZiData.type} ${formatWodDurata(wodZiData.duration)}`) : 'Niciun WOD azi'}
                  </div>
                  {wodZiData?.name && <div style={{ fontSize: '12px', color: '#888', marginTop: '1px' }}>{wodZiData.type} {formatWodDurata(wodZiData.duration)}</div>}
                  {!wodDeschis && wodZiData && (wodZiData.movements_rx || []).length > 0 && (
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{(wodZiData.movements_rx || []).join(' · ')}</div>
                  )}
                </div>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: wodDeschis ? '#1a1a1a' : '#EDFFD4', color: wodDeschis ? '#C8FF00' : '#2F6600', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                  {wodDeschis ? '−' : '+'}
                </div>
              </div>
              {wodDeschis && wodZiData && (
                <div style={{ marginTop: '16px', borderTop: '1px solid #f0f0f0', paddingTop: '16px' }}>
                  {VARIANTE_CONFIG.map((v, i) => {
                    const miscari = wodZiData[v.key] || []
                    return (
                      <div key={i} onClick={() => setVariantaAleasa(variantaAleasa === i ? null : i)}
                        style={{ border: variantaAleasa === i ? `2px solid ${v.culoare}` : '1px solid #f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', background: variantaAleasa === i ? v.bg : '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: variantaAleasa === i && miscari.length > 0 ? '10px' : '0' }}>
                          <span>{v.emoji}</span>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: v.culoare }}>{v.nivel}</span>
                          {variantaAleasa === i && <span style={{ marginLeft: 'auto', fontSize: '10px', padding: '2px 8px', background: v.culoare, color: '#fff', borderRadius: '20px' }}>Selectat</span>}
                        </div>
                        {variantaAleasa === i && miscari.length > 0 && (
                          <>
                            <div style={{ background: v.culoare + '18', borderRadius: '8px', padding: '7px 10px', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: '700', color: v.culoare }}>{wodZiData.type}</span>
                                <span style={{ fontSize: '12px', color: v.culoare, opacity: 0.8 }}>{formatWodDurata(wodZiData.duration)}</span>
                              </div>
                              {wodZiData.name && <div style={{ fontSize: '12px', fontWeight: '600', color: v.culoare, marginTop: '2px' }}>"{wodZiData.name}"</div>}
                            </div>
                            {miscari.map((m, j) => (
                              <div key={j} style={{ padding: '5px 0', borderBottom: j < miscari.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                                <span style={{ fontSize: '12px', color: '#555' }}>• {m}</span>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )
                  })}
                  <button onClick={() => { setPrevScreen('home'); setScreen('logWOD') }} disabled={variantaAleasa === null}
                    style={{ width: '100%', padding: '12px', background: variantaAleasa !== null ? '#C8FF00' : '#ccc', color: variantaAleasa !== null ? '#111' : '#888', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: variantaAleasa !== null ? 'pointer' : 'not-allowed', marginTop: '8px' }}>
                    {variantaAleasa !== null ? `Loghează — ${VARIANTE_CONFIG[variantaAleasa].nivel}` : 'Alege o variantă mai întâi'}
                  </button>
                </div>
              )}
              {wodDeschis && !wodZiData && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #f0f0f0', paddingTop: '12px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
                  {isAdmin ? '⚙️ Admin → WOD pentru a crea WOD-ul de azi' : 'Coachul nu a programat WOD-ul de azi încă'}
                </div>
              )}
            </div>

            {/* ── Card abonament ── */}
            {abonamentReal && (
              <div onClick={() => setScreen('abonament')} style={{ background: '#fff', marginBottom: '10px', padding: '16px 20px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a1a' }}>{abonamentReal.subscription_plans?.name || 'Abonament'}</div>
                    <div style={{ fontSize: '22px', marginTop: '4px' }}>🏅</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {sessTotal ? (
                      <div style={{ fontSize: '18px', fontWeight: '800', lineHeight: 1 }}>
                        <span style={{ color: '#2F6600' }}>{sessUsed}</span>
                        <span style={{ color: '#ddd', fontWeight: '400', fontSize: '16px' }}> / </span>
                        <span style={{ color: '#2F6600' }}>{sessTotal}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: '#2F6600', fontWeight: '700' }}>Nelimitat</div>
                    )}
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{zileRamase} zile rămase</div>
                  </div>
                </div>
                {sessTotal && (
                  <div style={{ height: '7px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progres * 100}%`, background: progres >= 1 ? '#E24B4A' : progres > 0.8 ? '#BA7517' : '#2F6600', borderRadius: '4px' }} />
                  </div>
                )}
              </div>
            )}

            {/* ── Timer + logout ── */}
            <div style={{ background: '#fff', marginBottom: '10px' }}>
              <button onClick={goTimer} style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', borderBottom: '1px solid #f5f5f5', fontSize: '14px', fontWeight: '600', color: '#1a1a1a', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>⏱️</span> Pornește Timer
              </button>
              <button onClick={handleLogout} style={{ width: '100%', padding: '12px 20px', background: 'none', border: 'none', fontSize: '12px', color: '#bbb', cursor: 'pointer', textAlign: 'left' }}>
                Deconectează-te
              </button>
            </div>

          </div>
        )
      })()}

      {screen === 'abonament' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>Abonamentul meu</h1>
          </div>
          {!abonamentReal ? (
            <div style={{ background: '#f5f5f5', borderRadius: '14px', padding: '30px', textAlign: 'center', marginBottom: '14px' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>📋</div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#1a1a1a', marginBottom: '6px' }}>Niciun abonament activ</div>
              <div style={{ fontSize: '12px', color: '#888' }}>Contactează coachul pentru a adăuga un abonament.</div>
            </div>
          ) : !abonamentActiv ? (
            <div style={{ background: !abonamentInceput ? '#EDFFD4' : '#FCEBEB', borderRadius: '14px', padding: '20px', marginBottom: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>
                {!abonamentInceput ? '📅' : sedinteLimitate && sedinteRamase === 0 ? '🏁' : '🔒'}
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: !abonamentInceput ? '#2F6600' : '#791F1F', marginBottom: '6px' }}>
                {!abonamentInceput ? 'Abonament programat'
                  : sedinteLimitate && sedinteRamase === 0 ? 'Ședințe epuizate'
                  : 'Abonament expirat'}
              </div>
              <div style={{ fontSize: '12px', color: !abonamentInceput ? '#2F6600' : '#A32D2D' }}>
                {!abonamentInceput
                  ? `Începe pe ${new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                  : sedinteLimitate && sedinteRamase === 0
                    ? 'Ai consumat toate ședințele. Contactează coachul pentru un abonament nou.'
                    : 'Contactează coachul pentru reînnoire.'}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #2F6600' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Plan activ</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a' }}>{abonamentReal.subscription_plans?.name}</div>
                </div>
                <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>✓ Activ</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>📅 Valabil</span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#1a1a1a' }}>
                  {new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString('ro-RO')} – {new Date(abonamentReal.end_date + 'T00:00:00').toLocaleDateString('ro-RO')}
                </span>
              </div>
              {abonamentReal.sessions_total && (
                <>
                  <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '6px', marginBottom: '8px' }}>
                    <div style={{ width: Math.min(100, ((abonamentReal.sessions_used || 0) / abonamentReal.sessions_total) * 100) + '%', height: '6px', borderRadius: '4px', background: '#EF9F27' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', color: '#888' }}>Ședințe folosite</span>
                    <span style={{ fontSize: '12px', fontWeight: '600' }}>{abonamentReal.sessions_used || 0} / {abonamentReal.sessions_total}</span>
                  </div>
                </>
              )}
            </div>
          )}
          <div style={{ background: '#EDFFD4', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#2F6600' }}>Pentru reînnoire sau întrebări contactează coachul.</div>
          </div>
        </div>
      )}

      {screen === 'log' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', textTransform: 'uppercase', letterSpacing: '-0.5px', marginBottom: '16px' }}>Log</h1>
          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: '12px', padding: '3px', marginBottom: '20px' }}>
            {[{ id: 'nou', lbl: '+ Logare nouă' }, { id: 'jurnal', lbl: '📓 Jurnal' }].map(t => (
              <div key={t.id} onClick={() => setLogTab(t.id)}
                style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: '10px', fontSize: '13px', fontWeight: logTab === t.id ? '700' : '400', background: logTab === t.id ? '#fff' : 'transparent', color: logTab === t.id ? '#2F6600' : '#888', cursor: 'pointer', boxShadow: logTab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
                {t.lbl}
              </div>
            ))}
          </div>

          {logTab === 'nou' && (
            <>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '14px' }}>Câte mișcări are antrenamentul tău?</p>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div onClick={() => { setLogPentruPR(null); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrNote(''); setScreen('logPR') }}
                  style={{ flex: 1, background: '#EDFFD4', borderRadius: '16px', padding: '24px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '32px' }}>🏋️</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#2F6600', textAlign: 'center' }}>Mișcare Unică</span>
                </div>
                <div onClick={() => { setVariantaAleasa(null); setPrevScreen('log'); setScreen('logWOD') }}
                  style={{ flex: 1, background: '#FFF8E6', borderRadius: '16px', padding: '24px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '32px' }}>🔥</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#7D5A00', textAlign: 'center' }}>Mișcări Multiple</span>
                </div>
              </div>
            </>
          )}

          {logTab === 'jurnal' && (
            <JurnalList logs={wodLogs} />
          )}
        </div>
      )}

      {screen === 'logWOD' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen(prevScreen || 'home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>Log WOD</h1>
          </div>
          {variantaAleasa !== null && (
            <div style={{ background: VARIANTE_CONFIG[variantaAleasa].bg, borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Varianta aleasă</div>
              <div style={{ fontSize: '14px', fontWeight: '600', color: VARIANTE_CONFIG[variantaAleasa].culoare }}>
                {VARIANTE_CONFIG[variantaAleasa].emoji} {VARIANTE_CONFIG[variantaAleasa].nivel}
                {wodZiData ? ` — ${wodZiData.type} ${formatWodDurata(wodZiData.duration)}` : ''}
              </div>
            </div>
          )}

          {variantaAleasa === null && (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>TIP ANTRENAMENT</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                {['AMRAP','For Time','EMOM','Tabata','Chipper','Ladder','Partner WOD','Strength'].map(t => (
                  <div key={t} onClick={() => setWodTip(t)}
                    style={{ padding: '6px 12px', borderRadius: '20px', border: wodTip === t ? '2px solid #2F6600' : '1px solid #e0e0e0', background: wodTip === t ? '#EDFFD4' : '#fafafa', color: wodTip === t ? '#2F6600' : '#555', fontSize: '12px', fontWeight: wodTip === t ? '700' : '400', cursor: 'pointer' }}>
                    {t}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>DURATĂ / RUNDE</div>
              <input value={wodDurata} onChange={e => setWodDurata(e.target.value)} placeholder="ex: 20 minute, 5 runde" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
          )}

          {variantaAleasa !== null && wodZiData ? (() => {
            const cheie = VARIANTE_CONFIG[variantaAleasa].key
            const miscariWod = wodZiData[cheie] || []
            return (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '600' }}>ANTRENAMENTUL DE AZI</div>
                <div style={{ background: '#f5fff0', borderRadius: '10px', padding: '12px 14px', marginBottom: '4px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#2F6600', marginBottom: '8px' }}>
                    {wodZiData.type} {formatWodDurata(wodZiData.duration)}
                  </div>
                  {miscariWod.length > 0 ? miscariWod.map((m, i) => (
                    <div key={i} style={{ fontSize: '14px', color: '#1a1a1a', paddingBottom: '4px', borderBottom: i < miscariWod.length - 1 ? '1px solid #d4f0c0' : 'none', marginBottom: i < miscariWod.length - 1 ? '4px' : '0' }}>
                      {m}
                    </div>
                  )) : (
                    <div style={{ fontSize: '13px', color: '#aaa' }}>Nicio mișcare definită pentru această variantă.</div>
                  )}
                </div>
              </div>
            )
          })() : (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '600' }}>MIȘCĂRI</div>
              {wodMiscari.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: '#EDFFD4', borderRadius: '8px', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', color: '#2F6600' }}>• {m}</span>
                  <button onClick={() => setWodMiscari(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '16px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input value={wodMiscareCurenta} onChange={e => setWodMiscareCurenta(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && wodMiscareCurenta.trim()) { setWodMiscari(prev => [...prev, wodMiscareCurenta.trim()]); setWodMiscareCurenta('') }}}
                  placeholder="ex: 21 Thrusters @ 43kg" style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                <button onClick={() => { if (wodMiscareCurenta.trim()) { setWodMiscari(prev => [...prev, wodMiscareCurenta.trim()]); setWodMiscareCurenta('') }}}
                  style={{ padding: '10px 14px', borderRadius: '10px', background: '#C8FF00', color: '#111', border: 'none', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>+</button>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>REZULTAT / SCOR</div>
              <input value={wodResult} onChange={e => setWodResult(e.target.value)} placeholder="ex: 18 runde complete" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>TIMP</div>
              <input value={wodTime} onChange={e => setWodTime(e.target.value)} placeholder="ex: 4:22" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>NOTE</div>
              <input value={wodNote} onChange={e => setWodNote(e.target.value)} placeholder="Cum te-ai simțit?" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <button onClick={saveWodLog} disabled={wodSaving}
              style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: wodSaving ? 'not-allowed' : 'pointer', opacity: wodSaving ? 0.7 : 1 }}>
              {wodSaving ? 'Se salvează...' : 'Salvează WOD'}
            </button>
          </div>
        </div>
      )}

      {screen === 'logPR' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen('pr')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>{logPentruPR ? `Log — ${logPentruPR.movement}` : 'Log PR nou'}</h1>
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <CautareMiscare preFill={miscarePR} onAleage={(m) => setMiscarePR(m)} />
            {miscarePR && (
              <>
                {['Fran','Grace','Cindy','Helen','Diane','Annie','Barbara','Murph','DT','Jackie','Nancy','Amanda'].includes(miscarePR) ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Timp</div>
                    <input value={prTimp} onChange={e => setPrTimp(e.target.value)} placeholder="ex: 4:22" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Variantă</div>
                    <select value={prVarianta} onChange={e => setPrVarianta(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }}>
                      <option>RX</option><option>Intermediate</option><option>Beginner</option><option>OnRamp</option>
                    </select>
                  </>
                ) : ['Row','Run','Bike Erg','Assault Bike','Ski Erg'].includes(miscarePR) ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Distanță (m)</div>
                    <input type="number" value={prDistanta} onChange={e => setPrDistanta(e.target.value)} placeholder="ex: 1000" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Timp</div>
                    <input value={prTimp} onChange={e => setPrTimp(e.target.value)} placeholder="ex: 3:52" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                ) : ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump'].includes(miscarePR) ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Repetări max</div>
                    <input type="number" value={prReps} onChange={e => setPrReps(e.target.value)} placeholder="ex: 22" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                ) : ['Handstand Hold','L-sit Hold'].includes(miscarePR) ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Timp hold (secunde)</div>
                    <input type="number" value={prValoare} onChange={e => setPrValoare(e.target.value)} placeholder="ex: 45" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Greutate (kg)</div>
                    <input type="number" value={prValoare} onChange={e => setPrValoare(e.target.value)} placeholder="ex: 120" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Repetări</div>
                    <input type="number" value={prReps} onChange={e => setPrReps(e.target.value)} placeholder="ex: 1 (pentru 1RM)" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                )}
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Note</div>
                <input value={prNote} onChange={e => setPrNote(e.target.value)} placeholder="Belt? Knee sleeves? Cum te-ai simțit?" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
                <button onClick={savePR} disabled={prSaving}
                  style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: prSaving ? 'not-allowed' : 'pointer', opacity: prSaving ? 0.7 : 1 }}>
                  {prSaving ? 'Se salvează...' : 'Salvează PR'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {screen === 'pr' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '16px' }}>Recorduri personale 🏆</h1>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '8px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            {prDate.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#aaa', fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏆</div>Niciun PR salvat încă
              </div>
            ) : prDate.map((pr, i) => (
              <div key={i} onClick={() => setPrSelectat(prSelectat === i ? null : i)}
                style={{ padding: '12px 0', borderBottom: i < prDate.length - 1 ? '1px solid #f0f0f0' : 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a1a1a' }}>{pr.movement}</div>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#2F6600' }}>{formatPR(pr)}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#aaa' }}>
                  {new Date(pr.recorded_at).toLocaleDateString('ro-RO')}{pr.notes ? ' · ' + pr.notes : ''}
                </div>
                {prSelectat === i && (
                  <div style={{ marginTop: '10px', background: '#EDFFD4', borderRadius: '10px', padding: '10px 12px' }}>
                    <button onClick={(e) => { e.stopPropagation(); setLogPentruPR(pr); setMiscarePR(pr.movement); setPrValoare(''); setPrReps(''); setPrNote(''); setScreen('logPR') }}
                      style={{ width: '100%', padding: '8px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                      + Adaugă rezultat nou
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => { setLogPentruPR(null); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrNote(''); setScreen('logPR') }}
            style={{ width: '100%', padding: '12px', background: '#fff', color: '#2F6600', border: '2px solid #2F6600', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            + Adaugă PR nou
          </button>
        </div>
      )}

      {screen === 'clase' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '14px' }}>Rezervă o clasă</h1>
          <div style={{ display: 'flex', background: '#e8e8e8', borderRadius: '12px', padding: '3px', marginBottom: '14px' }}>
            {[{ id: 'ore', lbl: 'Ore disponibile' }, { id: 'mele', lbl: 'Rezervările mele' }].map(t => (
              <div key={t.id} onClick={() => setClasaTab(t.id)}
                style={{ flex: 1, padding: '7px', textAlign: 'center', borderRadius: '10px', cursor: 'pointer', fontSize: '12px', fontWeight: clasaTab === t.id ? '600' : '400', background: clasaTab === t.id ? '#fff' : 'transparent', color: clasaTab === t.id ? '#1a1a1a' : '#888', boxShadow: clasaTab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                {t.lbl} {t.id === 'mele' && rezervarileMeleAfisate.length > 0 && <span style={{ background: '#C8FF00', color: '#111', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', marginLeft: '4px' }}>{rezervarileMeleAfisate.length}</span>}
              </div>
            ))}
          </div>
          {clasaTab === 'ore' && (
            <>
                  <div ref={chipsScrollRef} style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '14px', paddingBottom: '4px' }}>
                    {claseGroupate.map((z, i) => {
                      const areRez = z.clase.some(c => rezervariMele.includes(c.id))
                      const selectat = ziSelectata === i
                      const esteAzi = z.date === aziStr
                      return (
                        <div key={i} ref={esteAzi ? aziChipRef : null}
                          onClick={() => { setZiSelectata(i); setClasaSelectata(null) }}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 10px', borderRadius: '12px', border: selectat ? '2px solid #2F6600' : areRez ? '2px solid #2F6600' : '1px solid #e0e0e0', background: selectat ? '#2F6600' : areRez ? '#EDFFD4' : '#fff', cursor: 'pointer', minWidth: '48px', flexShrink: 0 }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: selectat ? '#C8FF00' : areRez ? '#2F6600' : esteAzi ? '#2F6600' : '#888' }}>{z.zi}</span>
                          <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: esteAzi && !selectat ? '2px solid #2F6600' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: '16px', fontWeight: '600', color: selectat ? '#fff' : areRez ? '#2F6600' : esteAzi ? '#2F6600' : '#1a1a1a' }}>{z.nr}</span>
                          </div>
                          <span style={{ fontSize: '9px', color: selectat ? '#C8FF00' : areRez ? '#2F6600' : esteAzi ? '#2F6600' : '#aaa', marginTop: '1px' }}>{z.luna}</span>
                          {areRez && <div style={{ fontSize: '9px', color: selectat ? '#C8FF00' : '#2F6600', fontWeight: '700' }}>✓</div>}
                        </div>
                      )
                    })}
                  </div>
                  {sedinteLimitate && !isAdmin && (
                    <div style={{ background: sedinteRamase <= 0 ? '#FCEBEB' : sedinteRamase <= 1 ? '#FAEEDA' : '#EAF3DE', borderRadius: '10px', padding: '8px 12px', marginBottom: '10px', fontSize: '12px', fontWeight: '500', color: sedinteRamase <= 0 ? '#791F1F' : sedinteRamase <= 1 ? '#633806' : '#27500A' }}>
                      {sedinteRamase <= 0 ? '🔒 Ai epuizat toate ședințele' : `🎟️ ${sedinteRamase} ședințe rămase din ${abonamentReal.sessions_total}`}
                    </div>
                  )}
                  {claseGroupate[ziSelectata]?.clase.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '30px 20px', color: '#bbb', fontSize: '13px' }}>
                      <div style={{ fontSize: '28px', marginBottom: '8px' }}>📭</div>
                      Nicio clasă programată în această zi.
                    </div>
                  )}
                  {claseGroupate[ziSelectata]?.clase.map((c) => {
                    const esteRezervat = rezervariMele.includes(c.id)
                    const isOpen = clasaSelectata === c.id
                    const esteInTrecut = c.date < aziStr
                    const esteFulla = !isAdmin && (rezervariPerClasa[c.id]?.count ?? 0) >= c.max_spots
                    const blocat = !esteRezervat && !isAdmin && sedinteLimitate && sedinteRamase <= 0
                    return (
                      <div key={c.id} onClick={() => !esteRezervat && setClasaSelectata(isOpen ? null : c.id)}
                        style={{ background: esteRezervat ? '#EDFFD4' : '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: esteRezervat ? 'default' : 'pointer', borderLeft: esteRezervat ? '4px solid #2F6600' : blocat ? '4px solid #e0e0e0' : '4px solid transparent' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.name}</div>
                            <div style={{ fontSize: '12px', color: esteRezervat ? '#2F6600' : '#888', marginTop: '2px' }}>🕐 {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)} · 👤 {c.coach}</div>
                          </div>
                          {esteRezervat
                            ? <span style={{ background: '#C8FF00', color: '#111', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '600', flexShrink: 0 }}>✓ Rezervat</span>
                            : esteInTrecut
                              ? <span style={{ fontSize: '11px', color: '#aaa', background: '#f0f0f0', padding: '3px 8px', borderRadius: '20px' }}>Trecut</span>
                              : <span style={{ fontSize: '12px', color: esteFulla ? '#e53935' : '#555', fontWeight: '500' }}>
                                  {rezervariPerClasa[c.id]?.count ?? 0}/{c.max_spots} {esteFulla ? '🔒 Plin' : 'locuri'}
                                </span>
                          }
                        </div>
                        {esteRezervat && (
                          <>
                            {rezervariPerClasa[c.id]?.membri?.length > 0 && (
                              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e8e5f7' }}>
                                <div style={{ fontSize: '11px', color: '#888', fontWeight: '600', marginBottom: '5px' }}>
                                  PARTICIPANȚI ({rezervariPerClasa[c.id].count}/{c.max_spots})
                                </div>
                                {rezervariPerClasa[c.id].membri.map((name, i) => (
                                  <div key={i} style={{ fontSize: '12px', color: '#2F6600', padding: '2px 0' }}>👤 {name}</div>
                                ))}
                              </div>
                            )}
                            <button onClick={(e) => { e.stopPropagation(); toggleRezervare(c.id) }}
                              style={{ width: '100%', marginTop: '10px', padding: '9px', background: 'transparent', color: '#A32D2D', border: '1px solid #F7C1C1', borderRadius: '10px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                              Anulează rezervarea
                            </button>
                          </>
                        )}
                        {!esteRezervat && isOpen && (
                          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                            {rezervariPerClasa[c.id]?.membri?.length > 0 && (
                              <div style={{ marginBottom: '10px' }}>
                                <div style={{ fontSize: '11px', color: '#888', fontWeight: '600', marginBottom: '5px' }}>
                                  PARTICIPANȚI ({rezervariPerClasa[c.id].count}/{c.max_spots})
                                </div>
                                {rezervariPerClasa[c.id].membri.map((name, i) => (
                                  <div key={i} style={{ fontSize: '12px', color: '#555', padding: '2px 0' }}>👤 {name}</div>
                                ))}
                              </div>
                            )}
                            {esteInTrecut ? (
                              <div style={{ textAlign: 'center', padding: '8px', fontSize: '12px', color: '#aaa', background: '#f5f5f5', borderRadius: '10px' }}>
                                Clasă trecută — nu se mai poate rezerva
                              </div>
                            ) : (
                              <button onClick={(e) => { e.stopPropagation(); toggleRezervare(c.id) }} disabled={blocat || esteFulla}
                                style={{ width: '100%', padding: '10px', background: blocat || esteFulla ? '#f0f0f0' : '#2F6600', color: blocat || esteFulla ? '#aaa' : '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: blocat || esteFulla ? 'not-allowed' : 'pointer' }}>
                                {blocat ? 'Ședințe epuizate' : esteFulla ? 'Clasă plină' : 'Rezervă locul'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
            </>
          )}
          {clasaTab === 'mele' && (
            <>
              {rezervarileMeleAfisate.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
                  <div style={{ fontSize: '32px', marginBottom: '10px' }}>📅</div>
                  <div style={{ fontSize: '14px' }}>Nu ai nicio rezervare</div>
                </div>
              ) : rezervarileMeleAfisate.map((c) => (
                <div key={c.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #2F6600' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.name}</div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>📅 {new Date(c.date + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'short' })} · 🕐 {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)}</div>
                      <div style={{ fontSize: '12px', color: '#888' }}>👤 {c.coach}</div>
                    </div>
                    <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: '500' }}>✓ Confirmat</span>
                  </div>
                  <button onClick={() => toggleRezervare(c.id)}
                    style={{ width: '100%', marginTop: '10px', padding: '8px', background: 'transparent', color: '#A32D2D', border: '1px solid #F7C1C1', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                    Anulează rezervarea
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {screen === 'timer' && <Timer onBack={() => setScreen(prevScreen)} defaultFortime={wodZiData ? parseWodMinute(wodZiData.duration) : null} />}
      {screen === 'clasament' && <Clasament logs={clasamentLogs} loading={clasamentLoading} wodZiData={wodZiData} onRefresh={fetchClasament} />}
      {screen === 'feed' && <Feed showToast={showToast} />}
      {screen === 'admin' && isAdmin && <Admin showToast={showToast} user={user} />}

      {toast && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: '500', zIndex: 300, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <NavBar screen={screen} setScreen={setScreen} isAdmin={isAdmin} />
    </div>
  )
}

export default App


