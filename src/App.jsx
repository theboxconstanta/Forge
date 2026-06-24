import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

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

const WOD_ZI = {
  id: 'wod-2026-06-23',
  tip: 'EMOM', durata: '20 minute',
  variante: [
    { nivel: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB', emoji: '🔵', descriere: 'La fiecare minut:', miscari: ['3 Goblet Squats 8kg', '3 Ring Rows', '5 Air Squats'] },
    { nivel: 'Beginner', culoare: '#27500A', bg: '#EAF3DE', emoji: '🟢', descriere: 'La fiecare minut:', miscari: ['5 Thrusters 20kg', '5 Ring Rows', '10 Air Squats'] },
    { nivel: 'Intermediate', culoare: '#633806', bg: '#FAEEDA', emoji: '🟡', descriere: 'La fiecare minut:', miscari: ['7 Thrusters 30kg', '7 Jumping Pull-ups', '10 Air Squats'] },
    { nivel: 'RX', culoare: '#791F1F', bg: '#FCEBEB', emoji: '🔴', descriere: 'La fiecare minut:', miscari: ['10 Thrusters 43kg', '10 Pull-ups', '10 Air Squats'] }
  ]
}

const ZILE_INITIALE = [
  { zi: 'Lun', nr: 16, clase: [
    { id:'c1', nume:'CrossFit WOD', ora:'07:00–08:00', coach:'Andrei M.', locuri:12, ocupate:10 },
    { id:'c2', nume:'Weightlifting', ora:'09:00–10:00', coach:'Elena P.', locuri:8, ocupate:4 },
    { id:'c3', nume:'CrossFit WOD', ora:'18:00–19:00', coach:'Andrei M.', locuri:12, ocupate:11 },
  ]},
  { zi: 'Mar', nr: 17, clase: [
    { id:'c4', nume:'CrossFit WOD', ora:'07:00–08:00', coach:'Andrei M.', locuri:12, ocupate:12 },
    { id:'c5', nume:'Gymnastics', ora:'17:00–18:00', coach:'Mihai C.', locuri:10, ocupate:6 },
    { id:'c6', nume:'CrossFit WOD', ora:'18:00–19:00', coach:'Elena P.', locuri:12, ocupate:8 },
    { id:'c7', nume:'Open Gym', ora:'20:00–21:30', coach:'—', locuri:20, ocupate:3 },
  ]},
  { zi: 'Mie', nr: 18, clase: [
    { id:'c8', nume:'CrossFit WOD', ora:'07:00–08:00', coach:'Elena P.', locuri:12, ocupate:9 },
    { id:'c9', nume:'Powerlifting', ora:'10:00–11:30', coach:'Radu B.', locuri:6, ocupate:2 },
    { id:'c10', nume:'CrossFit WOD', ora:'18:00–19:00', coach:'Mihai C.', locuri:12, ocupate:12 },
  ]},
  { zi: 'Joi', nr: 19, clase: [
    { id:'c11', nume:'CrossFit WOD', ora:'07:00–08:00', coach:'Andrei M.', locuri:12, ocupate:4 },
    { id:'c12', nume:'Weightlifting', ora:'18:00–19:00', coach:'Elena P.', locuri:8, ocupate:6 },
  ]},
  { zi: 'Vin', nr: 20, clase: [
    { id:'c13', nume:'CrossFit WOD', ora:'07:00–08:00', coach:'Mihai C.', locuri:12, ocupate:8 },
    { id:'c14', nume:'CrossFit WOD', ora:'18:00–19:00', coach:'Andrei M.', locuri:12, ocupate:10 },
    { id:'c15', nume:'Party WOD 🎉', ora:'19:00–20:30', coach:'Toți coachii', locuri:30, ocupate:22 },
  ]},
]

const FEED_INITIAL = [
  { id:1, nume:'Mihai D.', avatar:'MD', avatarBg:'#EEEDFE', avatarColor:'#3C3489', text:'Fran în 3:58 🔥 PR nou cu 24 secunde!', timp:'12 min', reactii:{ '🔥':8, '💪':5, '❤️':3 }, comentarii:[], variantaWod:'RX' },
  { id:2, nume:'Ioana A.', avatar:'IA', avatarBg:'#EAF3DE', avatarColor:'#27500A', text:'Back squat 75kg — prima dată! 🎉 Mulțumesc coach!', timp:'1 oră', reactii:{ '🔥':4, '💪':7, '❤️':12 }, comentarii:[{ autor:'Coach Andrei', text:'Bravo Ioana! 💪' }], variantaWod:'Beginner' },
  { id:3, nume:'Radu B.', avatar:'RB', avatarBg:'#FAEEDA', avatarColor:'#633806', text:'EMOM 20 min — am supraviețuit 😅 Varianta Intermediate e serioasă!', timp:'2 ore', reactii:{ '🔥':6, '💪':4, '❤️':2 }, comentarii:[], variantaWod:'Intermediate' },
  { id:4, nume:'Elena A.', avatar:'EA', avatarBg:'#E1F5EE', avatarColor:'#085041', text:'Grace în 4:12 — obiectivul e sub 4 minute până la sfârșit de lună!', timp:'3 ore', reactii:{ '🔥':5, '💪':9, '❤️':6 }, comentarii:[{ autor:'Mihai D.', text:'Hai că poți! 🚀' }], variantaWod:'RX' },
  { id:5, nume:'Călin P.', avatar:'CP', avatarBg:'#E6F1FB', avatarColor:'#0C447C', text:'Prima dată la CrossFit azi — OnRamp completat! Mult mai greu decât mă așteptam 😤', timp:'5 ore', reactii:{ '🔥':10, '💪':8, '❤️':7 }, comentarii:[{ autor:'Coach Andrei', text:'Bine ai venit! 🎉' }, { autor:'Ioana A.', text:'Felicitări! Revii mâine? 😊' }], variantaWod:'OnRamp' },
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

function NavBar({ screen, setScreen }) {
  return (
    <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', background: '#fff', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px', zIndex: 100 }}>
      {[
        { icon: '🏠', lbl: 'Acasă', sc: 'home' },
        { icon: '✏️', lbl: 'Log', sc: 'log' },
        { icon: '🏆', lbl: 'PR-uri', sc: 'pr' },
        { icon: '📅', lbl: 'Clase', sc: 'clase' },
        { icon: '👥', lbl: 'Feed', sc: 'feed' },
      ].map((n, i) => (
        <div key={i} onClick={() => setScreen(n.sc)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', cursor: 'pointer', color: screen === n.sc ? '#3C3489' : '#aaa' }}>
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
  const alege = (m) => { setQuery(m); setAleasa(m); setSugestii([]); onAleage(m) }
  return (
    <div style={{ position: 'relative', marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Exercițiu / Mișcare</div>
      <input value={query} onChange={e => cauta(e.target.value)} placeholder="Scrie pentru a căuta..."
        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: aleasa ? '2px solid #3C3489' : '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', outline: 'none' }} />
      {sugestii.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
          {sugestii.map((s, i) => (
            <div key={i} onClick={() => alege(s)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < sugestii.length - 1 ? '1px solid #f5f5f5' : 'none' }}>{s}</div>
          ))}
          <div onClick={() => alege(query)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', color: '#3C3489', fontWeight: '500', background: '#EEEDFE' }}>
            + Adaugă "{query}" ca mișcare nouă
          </div>
        </div>
      )}
    </div>
  )
}

function Timer({ onBack }) {
  const [mod, setMod] = useState('fortime')
  const [running, setRunning] = useState(false)
  const [secunde, setSecunde] = useState(900)
  const [totalSec, setTotalSec] = useState(900)
  const [runde, setRunde] = useState(0)
  const [minutEmom, setMinutEmom] = useState(1)
  const [tabataRunda, setTabataRunda] = useState(1)
  const [tabataFaza, setTabataFaza] = useState('lucru')
  const [gata, setGata] = useState(false)
  const [countdown, setCountdown] = useState(null)
  const [config, setConfig] = useState({ fortime: 15, amrap: 20, emom: 10, emomInterval: 60, tabataRunde: 8, tabataLucru: 20, tabataOdihna: 10 })
  const intervalRef = useRef(null)
  const countdownRef = useRef(null)
  const moduri = [
    { id: 'fortime', icon: '⏱️', lbl: 'For Time' },
    { id: 'amrap', icon: '🔄', lbl: 'AMRAP' },
    { id: 'emom', icon: '⏲️', lbl: 'EMOM' },
    { id: 'tabata', icon: '🔥', lbl: 'Tabata' },
  ]
  useEffect(() => { reset() }, [mod])
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
  const culoareRing = gata ? '#27500A' : mod === 'tabata' && tabataFaza === 'odihna' ? '#1D9E75' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#534AB7'
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
            style={{ width: '72px', height: '72px', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', border: mod === m.id ? '2px solid #3C3489' : '1px solid #e0e0e0', background: mod === m.id ? '#EEEDFE' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <div style={{ fontSize: '18px' }}>{m.icon}</div>
            <div style={{ fontSize: '9px', fontWeight: mod === m.id ? '600' : '400', color: mod === m.id ? '#3C3489' : '#888' }}>{m.lbl}</div>
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
        <div style={{ background: '#3C3489', borderRadius: '20px', padding: '40px 20px', marginBottom: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#C5C2F5', marginBottom: '8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Pregătește-te!</div>
          <div style={{ fontSize: '80px', fontWeight: '700', color: '#fff', lineHeight: 1 }}>{countdown}</div>
          <div style={{ fontSize: '14px', color: '#C5C2F5', marginTop: '8px' }}>
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
              <div style={{ fontSize: '42px', fontWeight: '700', color: '#3C3489' }}>{runde}</div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '6px' }}>
                <button onClick={() => setRunde(r => Math.max(0, r - 1))} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '18px', cursor: 'pointer' }}>−</button>
                <button onClick={() => setRunde(r => r + 1)} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #3C3489', background: '#EEEDFE', fontSize: '18px', color: '#3C3489', fontWeight: '700', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center' }}>
            <button onClick={reset} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '20px', cursor: 'pointer' }}>↺</button>
            <button onClick={toggleTimer} style={{ width: '64px', height: '64px', borderRadius: '50%', border: 'none', background: gata ? '#EAF3DE' : running ? '#BA7517' : '#3C3489', color: gata ? '#27500A' : '#fff', fontSize: '24px', cursor: gata ? 'default' : 'pointer', transition: 'background 0.2s' }}>
              {gata ? '✓' : running ? '⏸' : '▶'}
            </button>
            {mod === 'amrap'
              ? <button onClick={() => setRunde(r => r + 1)} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #3C3489', background: '#EEEDFE', color: '#3C3489', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>+1</button>
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
    setFeed(prev => [{ id: Date.now(), nume: 'Tu', avatar: 'TU', avatarBg: '#EEEDFE', avatarColor: '#3C3489', text: postText.trim(), timp: 'acum', reactii: { '🔥': 0, '💪': 0, '❤️': 0 }, comentarii: [], variantaWod: 'RX' }, ...prev])
    setPostText(''); showToast('Postat! 🎉')
  }
  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '14px' }}>Feed 👥</h1>
      <div style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#EEEDFE', color: '#3C3489', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '600', flexShrink: 0 }}>TU</div>
          <textarea value={postText} onChange={e => setPostText(e.target.value)} placeholder="Cum a fost antrenamentul azi?"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', color: '#1a1a1a', background: 'transparent', resize: 'none', minHeight: '60px', fontFamily: 'system-ui' }} />
        </div>
        {postText.trim() && <button onClick={posteaza} style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>Postează</button>}
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
              return <button key={emoji} onClick={() => toggleReactie(post.id, emoji)} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '20px', border: activa ? '1.5px solid #3C3489' : '1px solid #e0e0e0', background: activa ? '#EEEDFE' : '#f5f5f5', cursor: 'pointer', fontSize: '12px', color: activa ? '#3C3489' : '#555', fontWeight: activa ? '600' : '400' }}>{emoji} {count}</button>
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
              <button onClick={() => adaugaComentariu(post.id)} style={{ padding: '8px 14px', borderRadius: '20px', background: '#3C3489', color: '#fff', border: 'none', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Trimite</button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState('home')
  const [prevScreen, setPrevScreen] = useState('home')
  const [wodDeschis, setWodDeschis] = useState(false)
  const [variantaAleasa, setVariantaAleasa] = useState(null)
  const [prSelectat, setPrSelectat] = useState(null)
  const [prDate, setPrDate] = useState([])
  const [wodLogs, setWodLogs] = useState([])
  const [miscarePR, setMiscarePR] = useState('')
  const [logPentruPR, setLogPentruPR] = useState(null)
  const [ziSelectata, setZiSelectata] = useState(0)
  const [claseState, setClaseState] = useState(ZILE_INITIALE)
  const [rezervariMele, setRezervariMele] = useState([])
  const [clasaSelectata, setClasaSelectata] = useState(null)
  const [clasaTab, setClasaTab] = useState('ore')
  const [toast, setToast] = useState('')
  const [abonamentActiv, setAbonamentActiv] = useState(true)
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
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authScreen, setAuthScreen] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authNume, setAuthNume] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user) {
      fetchPRuri()
      fetchWodLogs()
      fetchRezervari()
    }
  }, [user])

  const fetchPRuri = async () => {
    const { data, error } = await supabase.from('personal_records').select('*').eq('member_id', user.id).order('recorded_at', { ascending: false })
    if (!error && data) setPrDate(data)
  }

  const fetchWodLogs = async () => {
    const { data, error } = await supabase.from('wod_logs').select('*').eq('member_id', user.id).order('logged_at', { ascending: false })
    if (!error && data) setWodLogs(data)
  }

  const fetchRezervari = async () => {
    const { data, error } = await supabase.from('bookings').select('*').eq('member_id', user.id)
    if (!error && data) {
      const ids = data.map(b => b.class_id)
      setRezervariMele(ids)
      setClaseState(prev => prev.map(zi => ({
        ...zi,
        clase: zi.clase.map(c => ({ ...c, rezervat: ids.includes(c.id) }))
      })))
    }
  }

  const handleLogin = async () => {
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
    if (error) setAuthError(error.message)
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
    if (!variantaAleasa === null) return
    setWodSaving(true)
    const { error } = await supabase.from('wod_logs').insert({
      member_id: user.id,
      wod_id: null,
      variant_level: WOD_ZI.variante[variantaAleasa]?.nivel || null,
      result: wodResult || null,
      time_result: wodTime || null,
      notes: wodNote || null,
    })
    if (error) { showToast('❌ Eroare la salvare!'); console.error(error) }
    else {
      showToast('WOD salvat! 🎉')
      await fetchWodLogs()
      setScreen('home')
      setWodDeschis(false)
      setVariantaAleasa(null)
      setWodResult(''); setWodTime(''); setWodNote('')
    }
    setWodSaving(false)
  }

  const savePR = async () => {
    if (!miscarePR) return
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
    if (error) { showToast('❌ Eroare la salvare!'); console.error(error) }
    else {
      showToast('PR salvat! 🏆')
      await fetchPRuri()
      setScreen('pr')
      setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrNote(''); setPrVarianta('RX')
    }
    setPrSaving(false)
  }

  const toggleRezervare = async (ziIdx, clasaId) => {
    const clasa = claseState[ziIdx].clase.find(c => c.id === clasaId)
    const esteRezervat = rezervariMele.includes(clasaId)

    if (!esteRezervat && clasa.ocupate >= clasa.locuri) { showToast('❌ Clasa e completă!'); return }

    if (esteRezervat) {
      const { error } = await supabase.from('bookings').delete().eq('member_id', user.id).eq('class_id', clasaId)
      if (error) { showToast('❌ Eroare!'); return }
      setRezervariMele(prev => prev.filter(id => id !== clasaId))
      setClaseState(prev => prev.map((zi, i) => i !== ziIdx ? zi : {
        ...zi, clase: zi.clase.map(c => c.id !== clasaId ? c : { ...c, rezervat: false, ocupate: c.ocupate - 1 })
      }))
      showToast('✓ Rezervare anulată')
    } else {
      const { error } = await supabase.from('bookings').insert({ member_id: user.id, class_id: clasaId })
      if (error) { showToast('❌ Eroare!'); return }
      setRezervariMele(prev => [...prev, clasaId])
      setClaseState(prev => prev.map((zi, i) => i !== ziIdx ? zi : {
        ...zi, clase: zi.clase.map(c => c.id !== clasaId ? c : { ...c, rezervat: true, ocupate: c.ocupate + 1 })
      }))
      showToast('✓ Loc rezervat! Te așteptăm!')
    }
    setClasaSelectata(null)
  }

  const rezervarileMeleAfisate = claseState.flatMap((zi, ziIdx) =>
    zi.clase.filter(c => rezervariMele.includes(c.id)).map(c => ({ ...c, zi: zi.zi, nr: zi.nr, ziIdx }))
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
    <div style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', background: '#fff', borderRadius: '20px', padding: '32px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: '40px', marginBottom: '8px' }}>🏋️</div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' }}>WOD Simple</h1>
          <p style={{ fontSize: '13px', color: '#888' }}>{authScreen === 'login' ? 'Bine ai revenit!' : 'Creează cont nou'}</p>
        </div>
        {authScreen === 'register' && (
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Nume complet</div>
            <input value={authNume} onChange={e => setAuthNume(e.target.value)} placeholder="ex: Alex Ionescu" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui' }} />
          </div>
        )}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Email</div>
          <input value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="email@exemplu.com" type="email" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui' }} />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Parolă</div>
          <input value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="minimum 6 caractere" type="password" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui' }} />
        </div>
        {authError && (
          <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', background: authError.startsWith('✓') ? '#EAF3DE' : '#FCEBEB', color: authError.startsWith('✓') ? '#27500A' : '#791F1F', fontSize: '12px' }}>
            {authError}
          </div>
        )}
        <button onClick={authScreen === 'login' ? handleLogin : handleRegister} disabled={authSubmitting}
          style={{ width: '100%', padding: '13px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: authSubmitting ? 'not-allowed' : 'pointer', opacity: authSubmitting ? 0.7 : 1, fontFamily: 'system-ui' }}>
          {authSubmitting ? 'Se încarcă...' : authScreen === 'login' ? 'Intră în cont' : 'Creează cont'}
        </button>
        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#888' }}>
          {authScreen === 'login' ? 'Nu ai cont? ' : 'Ai deja cont? '}
          <span onClick={() => { setAuthScreen(authScreen === 'login' ? 'register' : 'login'); setAuthError('') }} style={{ color: '#3C3489', fontWeight: '600', cursor: 'pointer' }}>
            {authScreen === 'login' ? 'Înregistrează-te' : 'Intră în cont'}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: '430px', width: '100%', margin: '0 auto', minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui', position: 'relative' }}>

      {!abonamentActiv && screen !== 'abonament' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: '#fff', borderRadius: '20px', padding: '32px 24px', textAlign: 'center', maxWidth: '340px' }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>🔒</div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#1a1a1a', marginBottom: '8px' }}>Abonamentul a expirat</div>
            <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6', marginBottom: '22px' }}>Nu mai ai acces la funcțiile aplicației. Reînnoiește abonamentul pentru a continua.</div>
            <button onClick={() => setScreen('abonament')} style={{ width: '100%', padding: '13px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              Vezi abonamentul →
            </button>
          </div>
        </div>
      )}

      {/* ══ HOME ══ */}
      {screen === 'home' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a' }}>Bună, {user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0]} 👋</h1>
              <p style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
            <button onClick={() => setScreen('abonament')} style={{ background: abonamentActiv ? '#EEEDFE' : '#FCEBEB', color: abonamentActiv ? '#3C3489' : '#791F1F', border: 'none', borderRadius: '20px', padding: '6px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', marginTop: '4px', whiteSpace: 'nowrap' }}>
              {abonamentActiv ? '🎟️ Abonament' : '🔒 Expirat'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            {[{ val: wodLogs.length.toString(), lbl: 'WOD-uri' }, { val: prDate.length.toString(), lbl: 'PR-uri' }, { val: `🔥 ${rezervariMele.length}`, lbl: 'Rezervări' }].map((s, i) => (
              <div key={i} style={{ flex: 1, background: '#fff', borderRadius: '12px', padding: '12px 8px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>{s.val}</div>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>{s.lbl}</div>
              </div>
            ))}
          </div>
          <button onClick={goTimer} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: '#fff', border: '2px solid #3C3489', borderRadius: '14px', fontSize: '14px', fontWeight: '600', color: '#3C3489', cursor: 'pointer', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            ⏱️ Pornește Timer
          </button>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div onClick={() => setWodDeschis(!wodDeschis)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px', textTransform: 'uppercase', fontWeight: '500', letterSpacing: '0.05em' }}>WOD-ul zilei</div>
                <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a' }}>{WOD_ZI.tip} · {WOD_ZI.durata}</div>
              </div>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: wodDeschis ? '#3C3489' : '#EEEDFE', color: wodDeschis ? '#fff' : '#3C3489', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                {wodDeschis ? '−' : '+'}
              </div>
            </div>
            {wodDeschis && (
              <div style={{ marginTop: '16px', borderTop: '1px solid #f0f0f0', paddingTop: '16px' }}>
                {WOD_ZI.variante.map((v, i) => (
                  <div key={i} onClick={() => setVariantaAleasa(variantaAleasa === i ? null : i)}
                    style={{ border: variantaAleasa === i ? `2px solid ${v.culoare}` : '1px solid #f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', background: variantaAleasa === i ? v.bg : '#fafafa' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: variantaAleasa === i ? '10px' : '0' }}>
                      <span>{v.emoji}</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: v.culoare }}>{v.nivel}</span>
                      {variantaAleasa === i && <span style={{ marginLeft: 'auto', fontSize: '10px', padding: '2px 8px', background: v.culoare, color: '#fff', borderRadius: '20px' }}>Selectat</span>}
                    </div>
                    {variantaAleasa === i && (
                      <div>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>{v.descriere}</div>
                        {v.miscari.map((m, j) => (
                          <div key={j} style={{ padding: '5px 0', borderBottom: j < v.miscari.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
                            <span style={{ fontSize: '12px', color: '#555' }}>• {m}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={() => setScreen('log')} disabled={variantaAleasa === null}
                  style={{ width: '100%', padding: '12px', background: variantaAleasa !== null ? '#3C3489' : '#ccc', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: variantaAleasa !== null ? 'pointer' : 'not-allowed', marginTop: '8px' }}>
                  {variantaAleasa !== null ? `Loghează — ${WOD_ZI.variante[variantaAleasa].nivel}` : 'Alege o variantă mai întâi'}
                </button>
              </div>
            )}
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>Activitate recentă</div>
            {wodLogs.length === 0 && prDate.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#aaa', fontSize: '13px' }}>Nicio activitate încă</div>
            ) : [...wodLogs.slice(0, 2).map(w => ({ nume: `WOD ${w.variant_level || ''}`, val: w.result || w.time_result || '—', pr: false })),
               ...prDate.slice(0, 1).map(p => ({ nume: p.movement, val: formatPR(p), pr: true }))
              ].slice(0, 3).map((a, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < 2 ? '1px solid #f0f0f0' : 'none' }}>
                <span style={{ fontSize: '13px', color: '#1a1a1a' }}>{a.nume}</span>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '20px', fontWeight: '500', background: a.pr ? '#EAF3DE' : '#f5f5f5', color: a.pr ? '#27500A' : '#666' }}>
                  {a.pr ? '🏆 ' : ''}{a.val}
                </span>
              </div>
            ))}
          </div>
          <button onClick={handleLogout} style={{ width: '100%', marginTop: '14px', padding: '10px', background: 'transparent', color: '#aaa', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '12px', cursor: 'pointer' }}>
            Deconectează-te
          </button>
        </div>
      )}

      {/* ══ ABONAMENT ══ */}
      {screen === 'abonament' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>Abonamentul meu</h1>
          </div>
          {!abonamentActiv ? (
            <div style={{ background: '#FCEBEB', borderRadius: '14px', padding: '20px', marginBottom: '14px', border: '1px solid #F7C1C1', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔒</div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: '#791F1F', marginBottom: '6px' }}>Abonament expirat</div>
              <div style={{ fontSize: '12px', color: '#A32D2D', lineHeight: '1.6' }}>Reînnoiește acum pentru a recăpăta accesul.</div>
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #3C3489' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Plan activ</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a' }}>Lunar Nelimitat</div>
                </div>
                <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>✓ Activ</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>📅 Expiră</span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#1a1a1a' }}>30 iunie 2026</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>⏳ Timp rămas</span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#BA7517' }}>7 zile</span>
              </div>
              <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '6px', marginBottom: '4px' }}>
                <div style={{ width: '77%', height: '6px', borderRadius: '4px', background: '#534AB7' }} />
              </div>
              <div style={{ fontSize: '10px', color: '#aaa', textAlign: 'right' }}>23 din 30 zile folosite</div>
            </div>
          )}
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', marginBottom: '12px' }}>🎟️ Ședințe</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: '#888' }}>Folosite</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#1a1a1a' }}>{wodLogs.length} din 8</span>
            </div>
            <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '6px', marginBottom: '8px' }}>
              <div style={{ width: Math.min(100, (wodLogs.length / 8) * 100) + '%', height: '6px', borderRadius: '4px', background: '#EF9F27' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', color: '#888' }}>Rămase</span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#27500A' }}>{Math.max(0, 8 - wodLogs.length)} ședințe</span>
            </div>
          </div>
          <button onClick={() => { setAbonamentActiv(true); showToast('✓ Abonament reînnoit! 🎉') }}
            style={{ width: '100%', padding: '13px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            {abonamentActiv ? 'Reînnoiește abonamentul' : 'Reactivează abonamentul'}
          </button>
          <button onClick={() => setAbonamentActiv(!abonamentActiv)}
            style={{ width: '100%', marginTop: '8px', padding: '10px', background: 'transparent', color: '#888', border: '1px dashed #ccc', borderRadius: '12px', fontSize: '11px', cursor: 'pointer' }}>
            🧪 [Test] Simulează: {abonamentActiv ? 'Expirare' : 'Activare'} abonament
          </button>
        </div>
      )}

      {/* ══ LOG WOD ══ */}
      {screen === 'log' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>Log WOD</h1>
          </div>
          {variantaAleasa !== null && (
            <div style={{ background: WOD_ZI.variante[variantaAleasa].bg, borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>Varianta aleasă</div>
              <div style={{ fontSize: '14px', fontWeight: '600', color: WOD_ZI.variante[variantaAleasa].culoare }}>
                {WOD_ZI.variante[variantaAleasa].emoji} {WOD_ZI.variante[variantaAleasa].nivel} — {WOD_ZI.tip} {WOD_ZI.durata}
              </div>
            </div>
          )}
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Rezultat / Scor</div>
              <input value={wodResult} onChange={e => setWodResult(e.target.value)} placeholder="ex: 18 runde complete" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Timp</div>
              <input value={wodTime} onChange={e => setWodTime(e.target.value)} placeholder="ex: 4:22" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Note</div>
              <input value={wodNote} onChange={e => setWodNote(e.target.value)} placeholder="Cum te-ai simțit?" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <button onClick={saveWodLog} disabled={wodSaving}
              style={{ width: '100%', padding: '12px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: wodSaving ? 'not-allowed' : 'pointer', opacity: wodSaving ? 0.7 : 1 }}>
              {wodSaving ? 'Se salvează...' : 'Salvează WOD'}
            </button>
          </div>
        </div>
      )}

      {/* ══ LOG PR ══ */}
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
                  style={{ width: '100%', padding: '12px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: prSaving ? 'not-allowed' : 'pointer', opacity: prSaving ? 0.7 : 1 }}>
                  {prSaving ? 'Se salvează...' : 'Salvează PR'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══ PR-URI ══ */}
      {screen === 'pr' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '16px' }}>Recorduri personale 🏆</h1>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '8px 14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            {prDate.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: '#aaa', fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏆</div>
                Niciun PR salvat încă
              </div>
            ) : prDate.map((pr, i) => (
              <div key={i} onClick={() => setPrSelectat(prSelectat === i ? null : i)}
                style={{ padding: '12px 0', borderBottom: i < prDate.length - 1 ? '1px solid #f0f0f0' : 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a1a1a' }}>{pr.movement}</div>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#3C3489' }}>{formatPR(pr)}</span>
                </div>
                <div style={{ fontSize: '10px', color: '#aaa' }}>
                  {new Date(pr.recorded_at).toLocaleDateString('ro-RO')}{pr.notes ? ' · ' + pr.notes : ''}
                </div>
                {prSelectat === i && (
                  <div style={{ marginTop: '10px', background: '#EEEDFE', borderRadius: '10px', padding: '10px 12px' }}>
                    <button onClick={(e) => { e.stopPropagation(); setLogPentruPR(pr); setMiscarePR(pr.movement); setPrValoare(''); setPrReps(''); setPrNote(''); setScreen('logPR') }}
                      style={{ width: '100%', padding: '8px', background: '#3C3489', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                      + Adaugă rezultat nou
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => { setLogPentruPR(null); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrNote(''); setScreen('logPR') }}
            style={{ width: '100%', padding: '12px', background: '#fff', color: '#3C3489', border: '2px solid #3C3489', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            + Adaugă PR nou
          </button>
        </div>
      )}

      {/* ══ CLASE ══ */}
      {screen === 'clase' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '14px' }}>Rezervă o clasă</h1>
          <div style={{ display: 'flex', background: '#e8e8e8', borderRadius: '12px', padding: '3px', marginBottom: '14px' }}>
            {[{ id: 'ore', lbl: 'Ore disponibile' }, { id: 'mele', lbl: 'Rezervările mele' }].map(t => (
              <div key={t.id} onClick={() => setClasaTab(t.id)}
                style={{ flex: 1, padding: '7px', textAlign: 'center', borderRadius: '10px', cursor: 'pointer', fontSize: '12px', fontWeight: clasaTab === t.id ? '600' : '400', background: clasaTab === t.id ? '#fff' : 'transparent', color: clasaTab === t.id ? '#1a1a1a' : '#888', boxShadow: clasaTab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                {t.lbl} {t.id === 'mele' && rezervariMele.length > 0 && <span style={{ background: '#3C3489', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', marginLeft: '4px' }}>{rezervariMele.length}</span>}
              </div>
            ))}
          </div>
          {clasaTab === 'ore' && (
            <>
              <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', marginBottom: '14px', paddingBottom: '4px' }}>
                {claseState.map((z, i) => {
                  const areRez = z.clase.some(c => rezervariMele.includes(c.id))
                  return (
                    <div key={i} onClick={() => { setZiSelectata(i); setClasaSelectata(null) }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 12px', borderRadius: '12px', border: ziSelectata === i ? '2px solid #3C3489' : '1px solid #e0e0e0', background: ziSelectata === i ? '#3C3489' : '#fff', cursor: 'pointer', minWidth: '52px', flexShrink: 0 }}>
                      <span style={{ fontSize: '10px', color: ziSelectata === i ? '#C5C2F5' : '#888' }}>{z.zi}</span>
                      <span style={{ fontSize: '16px', fontWeight: '600', color: ziSelectata === i ? '#fff' : '#1a1a1a' }}>{z.nr}</span>
                      {areRez && <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: ziSelectata === i ? '#C5C2F5' : '#3C3489', marginTop: '2px' }} />}
                    </div>
                  )
                })}
              </div>
              {claseState[ziSelectata].clase.map((c) => {
                const liber = c.locuri - c.ocupate
                const pct = Math.round((c.ocupate / c.locuri) * 100)
                const esteRezervat = rezervariMele.includes(c.id)
                const plin = liber <= 0 && !esteRezervat
                const barColor = plin ? '#E24B4A' : pct > 75 ? '#BA7517' : '#27500A'
                const isOpen = clasaSelectata === c.id
                return (
                  <div key={c.id} onClick={() => setClasaSelectata(isOpen ? null : c.id)}
                    style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', borderLeft: esteRezervat ? '4px solid #3C3489' : '4px solid transparent' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.nume}</div>
                        <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>🕐 {c.ora} · 👤 {c.coach}</div>
                      </div>
                      <div>
                        {esteRezervat ? <span style={{ background: '#EEEDFE', color: '#3C3489', fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: '500' }}>✓ Rezervat</span>
                          : plin ? <span style={{ background: '#FCEBEB', color: '#791F1F', fontSize: '11px', padding: '3px 8px', borderRadius: '20px' }}>Complet</span>
                          : <span style={{ fontSize: '12px', color: '#555' }}>{liber} locuri</span>}
                      </div>
                    </div>
                    <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '4px', margin: '10px 0 4px' }}>
                      <div style={{ width: Math.min(100, pct) + '%', height: '4px', borderRadius: '4px', background: barColor, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: '10px', color: '#aaa' }}>{c.ocupate}/{c.locuri} locuri ocupate</div>
                    {isOpen && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                        <button onClick={(e) => { e.stopPropagation(); toggleRezervare(ziSelectata, c.id) }} disabled={plin}
                          style={{ width: '100%', padding: '10px', background: esteRezervat ? 'transparent' : plin ? '#ccc' : '#3C3489', color: esteRezervat ? '#A32D2D' : '#fff', border: esteRezervat ? '1px solid #F7C1C1' : 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: plin ? 'not-allowed' : 'pointer' }}>
                          {esteRezervat ? 'Anulează rezervarea' : plin ? 'Clasă completă' : 'Rezervă locul'}
                        </button>
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
                <div key={c.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #3C3489' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.nume}</div>
                      <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>📅 {c.zi} {c.nr} iun · 🕐 {c.ora}</div>
                      <div style={{ fontSize: '12px', color: '#888' }}>👤 {c.coach}</div>
                    </div>
                    <span style={{ background: '#EAF3DE', color: '#27500A', fontSize: '11px', padding: '3px 8px', borderRadius: '20px', fontWeight: '500' }}>✓ Confirmat</span>
                  </div>
                  <button onClick={() => toggleRezervare(c.ziIdx, c.id)}
                    style={{ width: '100%', marginTop: '10px', padding: '8px', background: 'transparent', color: '#A32D2D', border: '1px solid #F7C1C1', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}>
                    Anulează rezervarea
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {screen === 'timer' && <Timer onBack={() => setScreen(prevScreen)} />}
      {screen === 'feed' && <Feed showToast={showToast} />}

      {toast && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: '500', zIndex: 300, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      <NavBar screen={screen} setScreen={setScreen} />
    </div>
  )
}

export default App