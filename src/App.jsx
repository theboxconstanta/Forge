// @ts-nocheck
/* eslint-disable */
import { useState, useEffect, useRef, useMemo, Component } from 'react'
import { supabase } from './supabase'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('App crash:', error, info) }
  render() {
    if (this.state.hasError) return (
      <div className="app-frame" style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px', fontFamily: 'system-ui' }}>
        <div style={{ background: '#fff', borderRadius: '20px', padding: '28px 24px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ fontSize: '16px', fontWeight: '700', color: '#1a1a1a', marginBottom: '6px' }}>Ceva a mers greșit</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '20px' }}>Încearcă să reîmprospătezi pagina.</div>
          <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            Reîmprospătează
          </button>
        </div>
      </div>
    )
    return this.props.children
  }
}

const VAPID_PUBLIC_KEY = 'BOmGoF0pRvdf35liFRcCqT5XJbS9BE5ZDAkIAmgumLCSDkQSA2KKJ0AkZ9ELnI-GJ62PVYmBb4nOvMot7h7eWQ4'
const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

// Data de azi in fusul orar LOCAL, ca string YYYY-MM-DD. NU folosi
// new Date().toISOString().split('T')[0] pentru asta - e ora UTC, care in
// Romania (UTC+2/+3) e in urma cu ora locala intre miezul noptii si ~2-3
// dimineata, ducand la comparatii de data gresite exact in acel interval
// (abonamente/clase tratate ca "de maine" sau "expirate cu o zi in avans").
function todayLocalStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

// Ajusteaza sessions_used printr-un citeste-apoi-scrie cu verificare optimista
// (WHERE sessions_used = valoarea citita) - fara asta, doua booking/anulari
// aproape simultane (ex: acelasi membru pe doua device-uri, sau o rezervare
// care se suprapune cu promovarea din waitlist) pot citi aceeasi valoare
// veche si scrie acelasi rezultat, pierzand un increment/decrement. Daca
// update-ul nu afecteaza niciun rand (altcineva a scris intre timp), reia.
async function adjustSessionsUsedAtomic(subId, delta, { max } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: fresh } = await supabase.from('subscriptions').select('sessions_used').eq('id', subId).maybeSingle()
    if (!fresh) return null
    const current = fresh.sessions_used || 0
    let next = current + delta
    if (next < 0) next = 0
    if (max != null) next = Math.min(next, max)
    const { data: updated } = await supabase.from('subscriptions')
      .update({ sessions_used: next }).eq('id', subId).eq('sessions_used', current).select('sessions_used')
    if (updated && updated.length > 0) return next
  }
  return null
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

async function checkAndBookFromWaitlist(classId) {
  const { data: next } = await supabase
    .from('class_waitlist').select('member_id, member_email')
    .eq('class_id', classId).order('joined_at', { ascending: true }).limit(1).maybeSingle()
  if (!next) return

  const { data: cls } = await supabase.from('classes').select('date, start_time, name').eq('id', classId).maybeSingle()
  if (!cls) return

  const _td = new Date()
  const todayStr = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`
  const { data: abo } = await supabase.from('subscriptions')
    .select('id, sessions_used, sessions_total, end_date')
    .ilike('member_email', next.member_email).eq('is_active', true).gte('end_date', todayStr)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  const aboLipseste = !abo
  const sesiuniEpuizate = abo?.sessions_total != null && Math.max(0, abo.sessions_total - (abo.sessions_used || 0)) <= 0
  if (aboLipseste || sesiuniEpuizate) {
    await supabase.from('class_waitlist').delete().eq('class_id', classId).eq('member_id', next.member_id)
    await checkAndBookFromWaitlist(classId)
    return
  }

  const { error } = await supabase.from('bookings').insert({ class_id: classId, member_id: next.member_id })
  if (error) { console.error('waitlist auto-book error', error); return }

  // Sterge intrarea din waitlist doar dupa ce rezervarea + decontarea sedintei
  // au reusit amandoua - altfel, la un esec al update-ului de sesiuni de mai
  // jos, membrul ar fi scos definitiv de pe waitlist fara sa fi primit
  // efectiv locul (rezervarea e anulata mai jos, dar intrarea din waitlist
  // era deja stearsa, deci membrul pierdea locul in coada fara compensare).
  if (abo.sessions_total != null) {
    const newUsed = await adjustSessionsUsedAtomic(abo.id, +1, { max: abo.sessions_total })
    if (newUsed == null) {
      await supabase.from('bookings').delete().eq('class_id', classId).eq('member_id', next.member_id)
      return
    }
  }

  await supabase.from('class_waitlist').delete().eq('class_id', classId).eq('member_id', next.member_id)

  if (cls?.date && cls?.start_time) {
    const remindAt = new Date(new Date(`${cls.date}T${cls.start_time}`).getTime() - 3600000)
    if (remindAt > new Date())
      supabase.from('class_reminders').upsert({ class_id: classId, member_email: next.member_email, remind_at: remindAt.toISOString(), sent: false }, { onConflict: 'class_id,member_email' })
  }

  const bc = supabase.channel('member-sessions-' + next.member_id)
  bc.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      bc.send({ type: 'broadcast', event: 'refresh', payload: {} })
      setTimeout(() => supabase.removeChannel(bc), 2000)
    }
  })

  const ora = cls?.start_time?.slice(0, 5) || ''
  const className = `${cls?.name || 'Clasă'}${ora ? ` · ${ora}` : ''}`
  sendNotification('waitlist_booked', next.member_email, className, cls?.date || '')
}

async function activateQueuedSubscription(memberEmail) {
  const { data: queued } = await supabase.from('subscriptions')
    .select('*, subscription_plans(duration_months, name)')
    .ilike('member_email', memberEmail)
    .eq('is_active', false)
    .eq('queued', true)
    .order('created_at', { ascending: true })
    .limit(1).maybeSingle()
  if (!queued) return null

  const duration = queued.subscription_plans?.duration_months || 1
  const startDate = new Date()
  const pad = n => String(n).padStart(2, '0')
  const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth()+1)}-${pad(startDate.getDate())}`
  const endDate = new Date(startDate)
  const targetMonth = endDate.getMonth() + duration
  endDate.setMonth(targetMonth)
  if (endDate.getMonth() !== targetMonth % 12) endDate.setDate(0)
  const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`

  // dezactiveaza abonamentul vechi INAINTE de a activa cel nou
  await supabase.from('subscriptions')
    .update({ is_active: false })
    .ilike('member_email', memberEmail)
    .eq('is_active', true)

  const { error } = await supabase.from('subscriptions').update({
    is_active: true, queued: false,
    start_date: startStr, end_date: endStr, sessions_used: 0,
  }).eq('id', queued.id)
  if (error) { console.error('activateQueuedSubscription error:', error); return null }

  return queued.id
}

const CARDIO_MISCARI = ['Row', 'Run', 'Bike Erg', 'Assault Bike', 'Air Bike', 'Ski Erg']
const CARDIO_CU_CALORII = CARDIO_MISCARI.filter(c => c !== 'Run')

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
  ...CARDIO_MISCARI,
  'KB Swing', 'KB Clean', 'KB Snatch', 'KB Goblet Squat', 'Wall Ball',
  // Girls
  'Angie','Annie','Amanda','Barbara','Chelsea','Cindy','Diane','Elizabeth','Eva',
  'Fran','Grace','Helen','Isabel','Jackie','Karen','Kelly','Linda','Lynne','Mary','Nancy','Nicole',
  // Heroes
  'Murph','DT','Randy','Michael','Ryan','Josh','J.T.','Nate','Danny',
  'Adam','Badger','Forrest','Kalsu','Ship','Scott','Griff','Glen','Nutts','Desforges',
]

const HERO_WODS_INFO = {
  // ── The Girls ──────────────────────────────────────────────────────
  'Angie':     'For Time\n100 Pull-ups\n100 Push-ups\n100 Sit-ups\n100 Air Squats',
  'Annie':     'For Time 50-40-30-20-10\nDouble Unders\nSit-ups',
  'Amanda':    'For Time 9-7-5\nMuscle-ups\nSquat Snatches 60/40 kg',
  'Barbara':   '5 rounds for time (3 min rest)\n20 Pull-ups\n30 Push-ups\n40 Sit-ups\n50 Air Squats',
  'Chelsea':   'EMOM 30 min\n5 Pull-ups\n10 Push-ups\n15 Air Squats',
  'Cindy':     'AMRAP 20 min\n5 Pull-ups\n10 Push-ups\n15 Air Squats',
  'Diane':     'For Time 21-15-9\nDeadlift 100/70 kg\nHandstand Push-up',
  'Elizabeth': 'For Time 21-15-9\nClean 60/40 kg\nRing Dip',
  'Eva':       '5 rounds for time\n800m Run\n30 KB Swings 32 kg\n30 Pull-ups',
  'Fran':      'For Time 21-15-9\nThrusters 43/30 kg\nPull-ups',
  'Grace':     'For Time\n30 Clean & Jerk 60/40 kg',
  'Helen':     '3 rounds for time\n400m Run\n21 KB Swings 24/16 kg\n12 Pull-ups',
  'Isabel':    'For Time\n30 Snatches 60/40 kg',
  'Jackie':    'For Time\n1000m Row\n50 Thrusters 20 kg\n30 Pull-ups',
  'Karen':     'For Time\n150 Wall Balls 9/6 kg',
  'Kelly':     '5 rounds for time\n400m Run\n30 Box Jumps 60 cm\n30 Wall Balls 9/6 kg',
  'Linda':     'For Time 10-9-8-7-6-5-4-3-2-1\nDeadlift 1.5×BW\nBench Press 1×BW\nClean 0.75×BW',
  'Lynne':     '5 rounds max reps\nBench Press (greutate corp)\nPull-ups',
  'Mary':      'AMRAP 20 min\n5 Handstand Push-ups\n10 Pistol Squats\n15 Pull-ups',
  'Nancy':     '5 rounds for time\n400m Run\n15 OHS 43/30 kg',
  'Nicole':    'AMRAP 20 min\n400m Run\nMax Pull-ups (score = total pull-ups)',
  // ── Hero WODs ──────────────────────────────────────────────────────
  'Murph':     'For Time (vestă 9/6 kg)\n1 Mile Run (1.6 km)\n100 Pull-ups\n200 Push-ups\n300 Air Squats\n1 Mile Run (1.6 km)',
  'DT':        '5 rounds for time\n12 Deadlifts 70/47 kg\n9 Hang Power Cleans 70/47 kg\n6 Push Jerks 70/47 kg',
  'Randy':     'For Time\n75 Power Snatches 34/23 kg',
  'Michael':   '3 rounds for time\n800m Run\n50 Back Extensions\n50 Sit-ups',
  'Ryan':      '5 rounds for time\n7 Muscle-ups\n21 Burpees',
  'Josh':      'For Time 21-15-9\nOHS 43/30 kg\nLeaning Rest Pull-ups',
  'J.T.':      'For Time 21-15-9\nHandstand Push-ups\nRing Dips\nPush-ups',
  'Nate':      'AMRAP 20 min\n2 Muscle-ups\n4 Handstand Push-ups\n8 KB Swings 32 kg',
  'Danny':     'AMRAP 20 min\n30 Box Jumps 61 cm\n20 Push Press 52 kg\n10 Pull-ups',
  'Adam':      '5 rounds for time\n20 Burpees\n400m Run',
  'Badger':    '3 rounds for time\n30 Squat Cleans 43/30 kg\n30 Pull-ups\n800m Run',
  'Forrest':   'AMRAP 20 min\n35 Burpees\n25 L Pull-ups\n50 Box Jumps 61 cm\n25 L Pull-ups',
  'Kalsu':     'For Time (5 Burpees EMOM la start)\n100 Thrusters 61/43 kg',
  'Ship':      '10 rounds for time\n10 Handstand Push-ups\n15 Box Jumps 61 cm\n20 Knees-to-Elbows',
  'Scott':     '5 rounds for time\n5 Deadlifts 1.5×BW\n10 Burpees\n1 Rope Climb 4.5m',
  'Griff':     '2 rounds for time\n800m Run\n400m Run backwards',
  'Glen':      'For Time\n30 Clean & Jerk 60/40 kg\n1 Mile Run (1.6 km)\n— 10 rounds —\n3 Muscle-ups\n4 HSPU\n5 Hang Power Cleans 61 kg',
  'Nutts':     'For Time\n10 HSPU\n15 Deadlifts 102 kg\n25 Box Jumps 76 cm\n50 C2B Pull-ups\n100 Wall Balls 9 kg\n200 Double Unders\n400m Run',
  'Desforges': '7 rounds for time\n7 Muscle-ups\n100m Sprint',
}

const PR_CATEGORII = {
  WEIGHTLIFTING: [
    'Back Squat','Front Squat','Overhead Squat','Box Squat','Pause Squat',
    'Shoulder Press','Push Press','Push Jerk','Split Jerk','Bench Press','Strict Press',
    'Deadlift','Romanian Deadlift','Sumo Deadlift','Sumo Deadlift High Pull','Stiff Leg Deadlift',
    'Clean & Jerk','Power Clean','Hang Clean','Hang Power Clean','Squat Clean','Clean Pull',
    'Snatch','Power Snatch','Hang Snatch','Hang Power Snatch','Squat Snatch','Snatch Pull','Snatch Balance',
    'Thruster','Farmers Carry','Turkish Get Up','Good Morning','Hip Thrust',
  ],
  GYMNASTICS: [
    'Air Squat',
    'Pull-up','Chest to Bar Pull-up','Muscle-up','Ring Muscle-up','Bar Muscle-up',
    'Toes to Bar','Knees to Elbow','Ring Row','Push-up','Handstand Push-up',
    'Ring Dip','Bar Dip','Handstand Hold','Handstand Walk','L-sit Hold',
    'Box Jump','Broad Jump','Burpee','Double Under','Single Under',
    'KB Swing','KB Clean','KB Snatch','KB Goblet Squat','Wall Ball',
  ],
  CARDIO: CARDIO_MISCARI,
  HERO_WODS: Object.keys(HERO_WODS_INFO),
}


function fmt(s) {
  const m = Math.floor(Math.abs(s) / 60)
  const sec = Math.abs(s) % 60
  return m + ':' + String(sec).padStart(2, '0')
}

function secToTime(sec) {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${m}:${String(ss).padStart(2, '0')}`
}
function timeToSec(str) {
  if (!str) return null
  const parts = String(str).trim().split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parseFloat(str) || null
}
const KG_TO_LBS = 2.20462
function convertWeight(value, fromUnit, toUnit) {
  if (value == null || fromUnit === toUnit) return value
  if (fromUnit === 'kg' && toUnit === 'lbs') return Math.round(value * KG_TO_LBS * 2) / 2
  if (fromUnit === 'lbs' && toUnit === 'kg') return Math.round(value / KG_TO_LBS * 2) / 2
  return value
}
function formatPR(pr, preferredUnit) {
  if (pr.unit === 'timp') {
    if (!pr.value && pr.value !== 0) return '—'
    const v = String(pr.value)
    // valoare veche stocată ca "4:22" sau nouă ca secunde
    if (v.includes(':')) return v
    const sec = parseFloat(v)
    return isNaN(sec) ? v : secToTime(sec)
  }
  const isWeight = pr.unit === 'kg' || pr.unit === 'lbs'
  const unit = isWeight && preferredUnit ? preferredUnit : pr.unit
  const value = isWeight && preferredUnit ? convertWeight(pr.value, pr.unit, preferredUnit) : pr.value
  if (value && (pr.unit === 'm' || pr.unit === 'cal')) return `${value} ${pr.unit}` + (pr.time_result ? ` — ${pr.time_result}` : '')
  if (value && pr.reps) return `${value} ${unit} × ${pr.reps}rep`
  if (value) return `${value} ${unit}`
  if (pr.reps) return `${pr.reps} reps`
  return '—'
}

function getInitiale(name) {
  if (!name) return '??'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function AvatarCircle({ name, avatarUrl, size = 38 }) {
  const culori = ['#f0f0f0', '#f0f0f0', '#FAEEDA', '#E6F1FB', '#FCE8E8']
  const textCulori = ['#1a1a1a', '#1a1a1a', '#633806', '#0C447C', '#791F1F']
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

// TEMPORAR - re-adaugat pt un al doilea diagnostic (gap-ul persista pe device dupa primul fix
// "masurat runtime"). 5 tap-uri pe "v2" activeaza. De scos dupa diagnostic.
let _debugTapCount = 0
let _debugTapTimer = null
function handleDebugLogoTap() {
  _debugTapCount++
  clearTimeout(_debugTapTimer)
  _debugTapTimer = setTimeout(() => { _debugTapCount = 0 }, 2000)
  if (_debugTapCount >= 5) {
    _debugTapCount = 0
    if (localStorage.getItem('navDebug') === '1') localStorage.removeItem('navDebug')
    else localStorage.setItem('navDebug', '1')
    window.location.reload()
  }
}

function NavBarDebug({ navRef, bottomGap }) {
  const [txt, setTxt] = useState('masor...')
  useEffect(() => {
    const measure = () => {
      const r = navRef.current?.getBoundingClientRect()
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
      setTxt(
        `innerH:${window.innerHeight} screenH:${window.screen.height} standalone:${String(isStandalone)} bottomGap:${bottomGap} navBottom:${r ? Math.round(r.bottom) : '?'} navTop:${r ? Math.round(r.top) : '?'} dpr:${window.devicePixelRatio}`
      )
    }
    measure()
    const t = setTimeout(measure, 500)
    window.addEventListener('resize', measure)
    return () => { clearTimeout(t); window.removeEventListener('resize', measure) }
  }, [navRef, bottomGap])
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: '#E8192C', color: '#fff', fontSize: '11px', lineHeight: 1.4, padding: '4px 6px', zIndex: 99999, wordBreak: 'break-all', fontFamily: 'monospace' }}>
      {txt}
    </div>
  )
}

function NavBar({ screen, setScreen, isAdmin, feedUnread }) {
  // innerHeight nu include env(safe-area-inset-bottom) DOAR in standalone/PWA pe iOS -
  // in Safari normal sau intr-un WebView (ex. browser-ul din WhatsApp), bara de jos a
  // browser-ului/WebView-ului ocupa deja acea zona, deci offset-ul negativ nu trebuie aplicat acolo.
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone
  // Masurat pe device real: gap-ul innerHeight vs ecranul fizic in standalone NU e mereu egal
  // cu env(safe-area-inset-bottom) (ex. 62px masurat vs 34px raportat de env()) - masuram
  // diferenta reala runtime (screen.height - innerHeight) in loc sa presupunem o valoare fixa.
  const [bottomGap, setBottomGap] = useState(0)
  const navRef = useRef(null)
  useEffect(() => {
    if (!isStandalone) return
    // La pornire "rece" din icon (nu reload), innerHeight/screen.height nu sunt mereu
    // stabilizate imediat - o singura masuratoare la 300ms poate prinde valori tranzitorii.
    // Masuram repetat in prima secunda + la orice resize/orientationchange ulterior.
    const masoara = () => setBottomGap(Math.min(150, Math.max(0, window.screen.height - window.innerHeight)))
    masoara()
    const timeouts = [100, 300, 600, 1000, 2000].map(ms => setTimeout(masoara, ms))
    window.addEventListener('resize', masoara)
    window.addEventListener('orientationchange', masoara)
    window.visualViewport?.addEventListener('resize', masoara)
    return () => {
      timeouts.forEach(clearTimeout)
      window.removeEventListener('resize', masoara)
      window.removeEventListener('orientationchange', masoara)
      window.visualViewport?.removeEventListener('resize', masoara)
    }
  }, [isStandalone])
  const showDebug = typeof window !== 'undefined' && localStorage.getItem('navDebug') === '1'
  return (
    <>
    {showDebug && <NavBarDebug navRef={navRef} bottomGap={bottomGap} />}
    <div ref={navRef} className="app-frame" style={{ position: 'fixed', bottom: isStandalone ? `-${bottomGap}px` : 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: '430px', background: '#fff', borderTop: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-around', paddingTop: '10px', paddingLeft: 0, paddingRight: 0, paddingBottom: isStandalone ? `max(8px, ${bottomGap}px)` : 'max(8px, env(safe-area-inset-bottom))', zIndex: 100, boxShadow: '0 30px 0 0 #fff' }}>
      {[
        { icon: '🏠', lbl: 'Acasă', sc: 'home' },
        { icon: '✏️', lbl: 'Log', sc: 'log' },
        { icon: '🏆', lbl: 'PR-uri', sc: 'pr' },
        { icon: '🏅', lbl: 'Cls.', sc: 'clasament' },
        { icon: '💬', lbl: 'Feed', sc: 'feed' },
        ...(isAdmin ? [{ icon: '⚙️', lbl: 'Admin', sc: 'admin' }] : []),
      ].map((n, i) => (
        <div key={i} onClick={() => setScreen(n.sc)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', cursor: 'pointer', color: screen === n.sc ? '#1a1a1a' : '#aaa' }}>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '20px', lineHeight: 1 }}>{n.icon}</span>
            {n.sc === 'feed' && feedUnread > 0 && (
              <span style={{
                position: 'absolute',
                top: '-5px',
                right: '-10px',
                background: '#E8192C',
                color: '#fff',
                borderRadius: '999px',
                minWidth: '18px',
                height: '18px',
                fontSize: '11px',
                fontWeight: '800',
                lineHeight: '18px',
                textAlign: 'center',
                padding: '0 5px',
                boxSizing: 'border-box',
                boxShadow: '0 1px 4px rgba(232,25,44,0.5)',
                border: '1.5px solid #fff',
              }}>
                {feedUnread > 99 ? '99+' : feedUnread}
              </span>
            )}
          </div>
          <span style={{ fontSize: '10px', fontWeight: screen === n.sc ? '600' : '400' }}>{n.lbl}</span>
        </div>
      ))}
    </div>
    </>
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
        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: aleasa ? '2px solid #1a1a1a' : '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', outline: 'none' }} />
      {sugestii.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
          {sugestii.map((s, i) => (
            <div key={i} onClick={() => alege(s)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < sugestii.length - 1 ? '1px solid #f5f5f5' : 'none' }}>{s}</div>
          ))}
          <div onClick={() => alege(query)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', color: '#1a1a1a', fontWeight: '500', background: '#f0f0f0' }}>
            + Adaugă "{query}" ca mișcare nouă
          </div>
        </div>
      )}
    </div>
  )
}

// Sugerează mișcări din MISCARI pe măsură ce se scrie ultimul cuvânt dintr-un
// text liber gen "21 Thrusters @ 43kg" (nu doar potriviri de la începutul
// stringului, ca la CautareMiscare, fiindcă aici textul conține și reps/greutate).
function miscareSugestii(text) {
  const cuvant = text.trim().split(/\s+/).pop()
  if (!cuvant || cuvant.length < 2) return []
  return MISCARI.filter(m => m.toLowerCase().includes(cuvant.toLowerCase())).slice(0, 5)
}

function MiscareQuickAdd({ value, onChange, onAdd, placeholder }) {
  const sugestii = miscareSugestii(value)
  const alege = (m) => {
    const parts = value.split(/\s+/)
    parts[parts.length - 1] = m
    onChange(parts.join(' ') + ' ')
  }
  const add = () => { if (value.trim()) onAdd(value.trim()) }
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim()) add() }}
          placeholder={placeholder} style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
        <button onClick={add}
          style={{ padding: '10px 14px', borderRadius: '10px', background: '#C8FF00', color: '#111', border: 'none', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>+</button>
      </div>
      {sugestii.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: '46px', zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
          {sugestii.map((s, i) => (
            <div key={i} onMouseDown={e => e.preventDefault()} onClick={() => alege(s)}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < sugestii.length - 1 ? '1px solid #f5f5f5' : 'none' }}>{s}</div>
          ))}
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
  const culoareRing = gata ? '#1a1a1a' : mod === 'tabata' && tabataFaza === 'odihna' ? '#1D9E75' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#1a1a1a'
  const culoareText = gata ? '#1a1a1a' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#1a1a1a'
  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a' }}>Timer ⏱️</h1>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
        {moduri.map(m => (
          <div key={m.id} onClick={() => setMod(m.id)}
            style={{ width: '72px', height: '72px', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', border: mod === m.id ? '2px solid #1a1a1a' : '1px solid #e0e0e0', background: mod === m.id ? '#f0f0f0' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <div style={{ fontSize: '18px' }}>{m.icon}</div>
            <div style={{ fontSize: '9px', fontWeight: mod === m.id ? '600' : '400', color: mod === m.id ? '#1a1a1a' : '#888' }}>{m.lbl}</div>
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
        <div style={{ background: '#1a1a1a', borderRadius: '20px', padding: '40px 20px', marginBottom: '14px', textAlign: 'center' }}>
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
              <div style={{ display: 'inline-block', padding: '4px 16px', borderRadius: '20px', background: tabataFaza === 'lucru' ? '#FCEBEB' : '#f0f0f0', color: tabataFaza === 'lucru' ? '#791F1F' : '#1a1a1a', fontSize: '12px', fontWeight: '600' }}>
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
              {gata && <div style={{ fontSize: '14px', color: '#1a1a1a', fontWeight: '600', marginTop: '6px' }}>GATA! 💪</div>}
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
              <div style={{ fontSize: '42px', fontWeight: '700', color: '#1a1a1a' }}>{runde}</div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '6px' }}>
                <button onClick={() => setRunde(r => Math.max(0, r - 1))} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '18px', cursor: 'pointer' }}>−</button>
                <button onClick={() => setRunde(r => r + 1)} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #1a1a1a', background: '#f0f0f0', fontSize: '18px', color: '#1a1a1a', fontWeight: '700', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center' }}>
            <button onClick={reset} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f5f5f5', fontSize: '20px', cursor: 'pointer' }}>↺</button>
            <button onClick={toggleTimer} style={{ width: '64px', height: '64px', borderRadius: '50%', border: 'none', background: gata ? '#f0f0f0' : running ? '#BA7517' : '#1a1a1a', color: gata ? '#1a1a1a' : '#fff', fontSize: '24px', cursor: gata ? 'default' : 'pointer', transition: 'background 0.2s' }}>
              {gata ? '✓' : running ? '⏸' : '▶'}
            </button>
            {mod === 'amrap'
              ? <button onClick={() => setRunde(r => r + 1)} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #1a1a1a', background: '#f0f0f0', color: '#1a1a1a', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>+1</button>
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

function Clasament({ logs, loading, wodZiData, onRefresh, selectedDate, onDateChange }) {
  const [genderTab, setGenderTab] = useState('toti')
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const isToday = selectedDate === todayStr
  const goDay = (delta) => {
    const d = new Date(selectedDate + 'T00:00:00'); d.setDate(d.getDate() + delta)
    const s = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    onDateChange(s)
  }

  const parseTime = (str) => {
    if (!str) return Infinity
    const parts = str.trim().split(':').map(Number)
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if (parts.length === 2) return parts[0] * 60 + parts[1]
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
    if (withTime >= withResult && withTime > 0) return deduped.sort((a, b) => parseTime(a.time_result) - parseTime(b.time_result))
    if (withResult > 0) return deduped.sort((a, b) => parseScore(b.result) - parseScore(a.result))
    return deduped.sort((a, b) => new Date(a.logged_at) - new Date(b.logged_at))
  }

  const NIVELE = [
    { id: 'RX', culoare: '#791F1F', bg: '#FCEBEB', emoji: '🔴' },
    { id: 'Intermediate', culoare: '#633806', bg: '#FAEEDA', emoji: '🟡' },
    { id: 'Beginner', culoare: '#1a1a1a', bg: '#f0f0f0', emoji: '🟢' },
    { id: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB', emoji: '🔵' },
  ]

  const getSectionLogs = (nivelId) => {
    const sorted = sortLogs(logs.filter(l => l.variant_level === nivelId))
    if (genderTab === 'masculin') return sorted.filter(l => l.profile?.gender === 'masculin')
    if (genderTab === 'feminin') return sorted.filter(l => l.profile?.gender === 'feminin')
    return sorted
  }

  const totalLogs = NIVELE.reduce((acc, n) => acc + getSectionLogs(n.id).length, 0)

  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1a1a1a' }}>Clasament 🏅</h1>
        <button onClick={onRefresh} style={{ background: '#f0f0f0', border: 'none', borderRadius: '20px', padding: '6px 12px', fontSize: '11px', color: '#1a1a1a', fontWeight: '600', cursor: 'pointer' }}>↻</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', background: '#f5f5f5', borderRadius: '12px', padding: '8px 12px' }}>
        <button onClick={() => goDay(-1)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: '#1a1a1a', color: '#fff', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a' }}>
            {isToday ? 'Azi' : new Date(selectedDate + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          {wodZiData ? <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{wodZiData.type} {formatWodDurata(wodZiData.duration)}</div> : <div style={{ fontSize: '11px', color: '#bbb', marginTop: '1px' }}>Niciun WOD</div>}
        </div>
        <button onClick={() => goDay(+1)} disabled={isToday} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: isToday ? '#e0e0e0' : '#1a1a1a', color: isToday ? '#bbb' : '#fff', fontSize: '16px', cursor: isToday ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[
          { id: 'toti', label: 'Toți', icon: '👥' },
          { id: 'masculin', label: 'Masculin', icon: '♂️' },
          { id: 'feminin', label: 'Feminin', icon: '♀️' },
        ].map(g => (
          <div key={g.id} onClick={() => setGenderTab(g.id)}
            style={{ padding: '7px 16px', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: genderTab === g.id ? '700' : '400', background: genderTab === g.id ? '#1a1a1a' : '#fff', color: genderTab === g.id ? '#fff' : '#888', border: `1px solid ${genderTab === g.id ? '#1a1a1a' : '#e0e0e0'}`, display: 'flex', alignItems: 'center', gap: '4px' }}>
            {g.icon} {g.label}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#aaa', fontSize: '13px' }}>Se încarcă...</div>
      ) : totalLogs === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏁</div>
          <div style={{ fontSize: '14px', fontWeight: '500', color: '#888', marginBottom: '6px' }}>Niciun rezultat încă</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>Fii primul care loghează azi!</div>
        </div>
      ) : (
        <div>
          {NIVELE.map(nivel => {
            const sectionLogs = getSectionLogs(nivel.id)
            if (sectionLogs.length === 0) return null
            const isForTime = sectionLogs.some(l => l.time_result) &&
              sectionLogs.filter(l => l.time_result).length >= sectionLogs.filter(l => l.result).length
            return (
              <div key={nivel.id} style={{ marginBottom: '20px' }}>
                {/* Header secțiune */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ background: nivel.bg, borderRadius: '10px', padding: '4px 12px', fontSize: '12px', fontWeight: '800', color: nivel.culoare, letterSpacing: '0.04em' }}>
                    {nivel.emoji} {nivel.id}
                  </div>
                  <div style={{ fontSize: '11px', color: '#bbb', fontWeight: '500' }}>
                    {sectionLogs.length} {sectionLogs.length === 1 ? (genderTab === 'feminin' ? 'participantă' : 'participant') : (genderTab === 'feminin' ? 'participante' : 'participanți')}
                  </div>
                  {isForTime && (
                    <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#aaa' }}>⏱️ for time</div>
                  )}
                  {!isForTime && sectionLogs.some(l => l.result) && (
                    <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#aaa' }}>🔄 AMRAP</div>
                  )}
                </div>
                {/* Carduri participanți */}
                {sectionLogs.map((log, i) => {
                  const name = log.profile?.full_name || log.profile?.email?.split('@')[0] || 'Anonim'
                  const podium = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null
                  const result = log.time_result || log.result || '—'
                  const borderColor = i === 0 ? nivel.culoare : i === 1 ? '#B0B0B0' : i === 2 ? '#CD7F32' : '#e0e0e0'
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
                          <div style={{ fontSize: '16px', fontWeight: '700', color: nivel.culoare }}>{result}</div>
                          {log.time_result && log.result && (
                            <div style={{ fontSize: '11px', color: '#aaa' }}>{log.result}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Feed({ showToast, user, userProfile }) {
  const [posts, setPosts] = useState([])
  const [reactions, setReactions] = useState({})
  const [comments, setComments] = useState({})
  const [loading, setLoading] = useState(true)
  const [postText, setPostText] = useState('')
  const [posting, setPosting] = useState(false)
  const [comentariuDeschis, setComentariuDeschis] = useState(null)
  const [comentariuText, setComentariuText] = useState('')

  const variantaColor = { 'OnRamp': '#0C447C', 'Beginner': '#1a1a1a', 'Intermediate': '#633806', 'RX': '#791F1F' }
  const variantaBg = { 'OnRamp': '#E6F1FB', 'Beginner': '#f0f0f0', 'Intermediate': '#FAEEDA', 'RX': '#FCEBEB' }

  const relativeTime = (ts) => {
    const diff = Date.now() - new Date(ts).getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return 'acum'
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}z`
  }

  const fetchAll = async (showLoader = false) => {
    if (showLoader) setLoading(true)
    const { data: postsData } = await supabase.from('feed_posts')
      .select('*, profiles(full_name, email, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(50)
    if (postsData) {
      setPosts(postsData)
      const ids = postsData.map(p => p.id)
      if (ids.length > 0) {
        const [{ data: reactData }, { data: commData }] = await Promise.all([
          supabase.from('feed_reactions').select('post_id, emoji, member_id').in('post_id', ids),
          supabase.from('feed_comments').select('*, profiles(full_name, avatar_url)').in('post_id', ids).order('created_at', { ascending: true }),
        ])
        if (reactData) {
          const rMap = {}
          reactData.forEach(r => {
            if (!rMap[r.post_id]) rMap[r.post_id] = {}
            if (!rMap[r.post_id][r.emoji]) rMap[r.post_id][r.emoji] = { count: 0, iMine: false }
            rMap[r.post_id][r.emoji].count++
            if (r.member_id === user.id) rMap[r.post_id][r.emoji].iMine = true
          })
          setReactions(rMap)
        }
        if (commData) {
          const cMap = {}
          commData.forEach(c => {
            if (!cMap[c.post_id]) cMap[c.post_id] = []
            cMap[c.post_id].push(c)
          })
          setComments(cMap)
        }
      }
    }
    if (showLoader) setLoading(false)
  }

  useEffect(() => {
    fetchAll(true)
    const channel = supabase.channel('feed-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_posts' }, () => fetchAll(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_reactions' }, () => fetchAll(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_comments' }, () => fetchAll(false))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const posteaza = async () => {
    if (!postText.trim() || posting) return
    setPosting(true)
    const { error } = await supabase.from('feed_posts').insert({ member_id: user.id, text: postText.trim() })
    if (error) { showToast('❌ Eroare la postare!'); console.error(error) }
    else { setPostText(''); showToast('Postat! 🎉') }
    setPosting(false)
  }

  const toggleReactie = async (postId, emoji) => {
    const iMine = reactions[postId]?.[emoji]?.iMine
    // optimistic update
    setReactions(prev => {
      const cur = prev[postId]?.[emoji] || { count: 0, iMine: false }
      return { ...prev, [postId]: { ...prev[postId], [emoji]: { count: iMine ? cur.count - 1 : cur.count + 1, iMine: !iMine } } }
    })
    const { error } = iMine
      ? await supabase.from('feed_reactions').delete().eq('post_id', postId).eq('member_id', user.id).eq('emoji', emoji)
      : await supabase.from('feed_reactions').insert({ post_id: postId, member_id: user.id, emoji })
    if (error) {
      // esec (ex: dublu-tap -> constraint unic, retea etc) - fara realtime event
      // care sa corecteze automat, revenim manual la starea optimista gresita.
      console.error('toggleReactie error:', error)
      setReactions(prev => {
        const cur = prev[postId]?.[emoji] || { count: 0, iMine: false }
        return { ...prev, [postId]: { ...prev[postId], [emoji]: { count: iMine ? cur.count + 1 : cur.count - 1, iMine } } }
      })
    }
  }

  const adaugaComentariu = async (postId) => {
    if (!comentariuText.trim()) return
    const { error } = await supabase.from('feed_comments').insert({ post_id: postId, member_id: user.id, text: comentariuText.trim() })
    if (error) { showToast('❌ Eroare la comentariu!'); console.error(error) }
    else { setComentariuText(''); setComentariuDeschis(null); showToast('Comentariu adăugat!') }
  }

  const myName = userProfile?.full_name || user?.email?.split('@')[0] || 'Tu'
  const myAvatar = userProfile?.avatar_url

  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#1a1a1a', marginBottom: '14px' }}>Feed 👥</h1>

      {/* Compose */}
      <div style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <AvatarCircle name={myName} avatarUrl={myAvatar} size={36} />
          <textarea value={postText} onChange={e => setPostText(e.target.value)} placeholder="Cum a fost antrenamentul azi?"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', color: '#1a1a1a', background: 'transparent', resize: 'none', minHeight: '60px', fontFamily: 'system-ui' }} />
        </div>
        {postText.trim() && (
          <button onClick={posteaza} disabled={posting}
            style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', opacity: posting ? 0.7 : 1 }}>
            {posting ? 'Se postează...' : 'Postează'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#aaa', fontSize: '13px' }}>Se încarcă...</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>👥</div>
          <div style={{ fontSize: '14px', color: '#888' }}>Nicio postare încă. Fii primul!</div>
        </div>
      ) : posts.map(post => {
        const name = post.profiles?.full_name || post.profiles?.email?.split('@')[0] || 'Membru'
        const avatarUrl = post.profiles?.avatar_url
        const postReactions = reactions[post.id] || {}
        const postComments = comments[post.id] || []
        return (
          <div key={post.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <AvatarCircle name={name} avatarUrl={avatarUrl} size={38} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a' }}>{name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>{relativeTime(post.created_at)}</span>
                  {post.variant_level && (
                    <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '20px', background: variantaBg[post.variant_level] || '#f0f0f0', color: variantaColor[post.variant_level] || '#888', fontWeight: '500' }}>{post.variant_level}</span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: '1.5', marginBottom: '12px' }}>{post.text}</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: postComments.length > 0 ? '10px' : '0', flexWrap: 'wrap' }}>
              {['❤️', '👍', '😂', '😮', '😢', '🙏'].map(emoji => {
                const r = postReactions[emoji] || { count: 0, iMine: false }
                return (
                  <button key={emoji} onClick={() => toggleReactie(post.id, emoji)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '20px', border: r.iMine ? '1.5px solid #1a1a1a' : '1px solid #e0e0e0', background: r.iMine ? '#f0f0f0' : '#f5f5f5', cursor: 'pointer', fontSize: '12px', color: r.iMine ? '#1a1a1a' : '#555', fontWeight: r.iMine ? '600' : '400' }}>
                    {emoji}{r.count > 0 ? ` ${r.count}` : ''}
                  </button>
                )
              })}
              <button onClick={() => { setComentariuDeschis(comentariuDeschis === post.id ? null : post.id); setComentariuText('') }}
                style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: '20px', border: '1px solid #e0e0e0', background: '#f5f5f5', cursor: 'pointer', fontSize: '11px', color: '#888' }}>
                💬{postComments.length > 0 ? ` ${postComments.length}` : ''}
              </button>
            </div>
            {postComments.length > 0 && (
              <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: '8px', marginBottom: '8px' }}>
                {postComments.map((c, i) => {
                  const cName = c.profiles?.full_name || c.profiles?.email?.split('@')[0] || 'Membru'
                  return (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                      <AvatarCircle name={cName} avatarUrl={c.profiles?.avatar_url} size={26} />
                      <div style={{ background: '#f5f5f5', borderRadius: '10px', padding: '6px 10px', flex: 1 }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#1a1a1a', marginBottom: '2px' }}>{cName}</div>
                        <div style={{ fontSize: '12px', color: '#555' }}>{c.text}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {comentariuDeschis === post.id && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input value={comentariuText} onChange={e => setComentariuText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && adaugaComentariu(post.id)}
                  placeholder="Scrie un comentariu..."
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '20px', border: '1px solid #e0e0e0', fontSize: '12px', outline: 'none', background: '#fafafa' }} />
                <button onClick={() => adaugaComentariu(post.id)}
                  style={{ padding: '8px 14px', borderRadius: '20px', background: '#C8FF00', color: '#111', border: 'none', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>Trimite</button>
              </div>
            )}
          </div>
        )
      })}
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
  const [aboExpandat, setAboExpandat] = useState({})
  const [_loadingClase, setLoadingClase] = useState(true)
  const [searchClienti, setSearchClienti] = useState('')
  const [rapoarteData, setRapoarteData] = useState(null)

  const [numeClasa, setNumeClasa] = useState('CrossFit WOD')
  const [dataClasa, setDataClasa] = useState('')
  const [oraInceput, setOraInceput] = useState('07:00')
  const [oraSfarsit, setOraSfarsit] = useState('08:00')
  const [coachClasa, setCoachClasa] = useState('')
  const [locuriClasa, setLocuriClasa] = useState(12)
  const [culoarClasa, setCuloarClasa] = useState(null)
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
  const [dataStartAbonament, setDataStartAbonament] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })
  const [pretPlatit, setPretPlatit] = useState('')
  const [savingAbonament, setSavingAbonament] = useState(false)

  const [numePlan, setNumePlan] = useState('')
  const [sedintePlan, setSedintePlan] = useState('')
  const [pretPlan, setPretPlan] = useState('')
  const [durataPlan, setDurataPlan] = useState(1)
  const [savingPlan, setSavingPlan] = useState(false)

  const [rezervariClasa, setRezervariClasa] = useState({})
  const [clasaDeschisa, setClasaDeschisa] = useState(null)
  const [clientSelectat, setClientSelectat] = useState(null)
  const [sortClienti, setSortClienti] = useState('toti')
  const [memberIdsCuRezervariViitoare, setMemberIdsCuRezervariViitoare] = useState(new Set())
  const [cancelWindowSetting, setCancelWindowSetting] = useState(2)
  const [savingSettings, setSavingSettings] = useState(false)
  const [adaugaMembruSearch, setAdaugaMembruSearch] = useState({})

  useEffect(() => { fetchClase(); fetchWods(); fetchClienti(); fetchPlanuri(); fetchAbonamente(); fetchSettingsAdmin() }, [])
  useEffect(() => { if (adminTab === 'setari') fetchRapoarte() }, [adminTab])

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

  const notifyMember = async (email) => {
    const { data: p } = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle()
    if (!p?.id) return
    const bc = supabase.channel('member-sessions-' + p.id)
    bc.subscribe(s => { if (s === 'SUBSCRIBED') { bc.send({ type: 'broadcast', event: 'refresh', payload: {} }); setTimeout(() => supabase.removeChannel(bc), 2000) } })
  }

  const fetchAbonamente = async () => {
    const { data } = await supabase.from('subscriptions').select('*, subscription_plans(name, sessions, duration_months)')
      .or('is_active.eq.true,queued.eq.true').order('created_at', { ascending: false })
    if (data) setAbonamente(data)
    const azi = new Date(); const aziStr = `${azi.getFullYear()}-${String(azi.getMonth()+1).padStart(2,'0')}-${String(azi.getDate()).padStart(2,'0')}`
    const { data: claseViit } = await supabase.from('classes').select('id').gte('date', aziStr)
    if (claseViit && claseViit.length > 0) {
      const { data: bookings } = await supabase.from('bookings').select('member_id').in('class_id', claseViit.map(c => c.id))
      if (bookings) setMemberIdsCuRezervariViitoare(new Set(bookings.map(b => b.member_id).filter(Boolean)))
    }
  }

  const fetchRezervariClasa = async (classId) => {
    let { data: bookData, error } = await supabase.from('bookings').select('member_id, checked_in').eq('class_id', classId)
    if (error) {
      const { data: fallback } = await supabase.from('bookings').select('member_id').eq('class_id', classId)
      bookData = (fallback || []).map(b => ({ ...b, checked_in: false }))
    }
    const memberIds = (bookData || []).map(b => b.member_id)
    if (memberIds.length === 0) { setRezervariClasa(prev => ({ ...prev, [classId]: [] })); return }
    const { data: profsData } = await supabase.from('profiles').select('id, full_name, email, avatar_url').in('id', memberIds)
    const profsMap = {}
    ;(profsData || []).forEach(p => { profsMap[p.id] = p })
    const checkinMap = {}
    ;(bookData || []).forEach(b => { checkinMap[b.member_id] = b.checked_in })
    const rezultat = memberIds.map(mid => ({
      member_id: mid,
      full_name: profsMap[mid]?.full_name,
      email: profsMap[mid]?.email,
      avatar_url: profsMap[mid]?.avatar_url,
      checked_in: checkinMap[mid] || false,
    }))
    setRezervariClasa(prev => ({ ...prev, [classId]: rezultat }))
  }

  const fetchSettingsAdmin = async () => {
    const { data } = await supabase.from('app_settings').select('key, value')
    if (data) {
      const cwh = data.find(s => s.key === 'cancel_window_hours')
      if (cwh) setCancelWindowSetting(parseFloat(cwh.value) || 0)
    }
  }

  const fetchRapoarte = async () => {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    const azi = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
    const lunaStart = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`
    const lunaEnd = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(new Date(now.getFullYear(), now.getMonth()+1, 0).getDate())}`

    const { data: aboActive } = await supabase.from('subscriptions')
      .select('member_email').eq('is_active', true).eq('queued', false)
      .lte('start_date', azi).gte('end_date', azi)
    const membriActivi = new Set((aboActive || []).map(a => a.member_email?.toLowerCase())).size

    const { count: aboVandute } = await supabase.from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', lunaStart + 'T00:00:00')
      .lte('created_at', lunaEnd + 'T23:59:59')
      .or('is_active.eq.true,queued.eq.true')

    const { data: aboLuna } = await supabase.from('subscriptions')
      .select('notes')
      .gte('created_at', lunaStart + 'T00:00:00')
      .lte('created_at', lunaEnd + 'T23:59:59')
      .or('is_active.eq.true,queued.eq.true')
    const venituriLuna = (aboLuna || []).reduce((sum, a) => {
      const m = (a.notes || '').match(/Plătit:\s*([\d.,]+)\s*RON/)
      return sum + (m ? parseFloat(m[1].replace(',', '.')) : 0)
    }, 0)

    setRapoarteData({ membriActivi, aboVandute: aboVandute || 0, venituriLuna })
  }

  const saveSettings = async () => {
    setSavingSettings(true)
    await supabase.from('app_settings').upsert({ key: 'cancel_window_hours', value: String(cancelWindowSetting), updated_at: new Date().toISOString() })
    showToast('✓ Setări salvate!')
    setSavingSettings(false)
  }

  const adjustMemberSessions = async (memberId, delta) => {
    const member = clienti.find(c => c.id === memberId)
    const email = member?.email?.toLowerCase()
    if (!email) return
    const { data: abo, error } = await supabase.from('subscriptions')
      .select('id, sessions_used, sessions_total')
      .ilike('member_email', email)
      .eq('is_active', true)
      .not('sessions_total', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1).maybeSingle()
    if (error) { console.error('adjustMemberSessions:', error); return }
    if (!abo) return
    const newUsed = Math.max(0, Math.min(abo.sessions_total ?? 9999, (abo.sessions_used || 0) + delta))
    await supabase.from('subscriptions').update({ sessions_used: newUsed }).eq('id', abo.id)
    const bc = supabase.channel('member-sessions-' + memberId)
    bc.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        bc.send({ type: 'broadcast', event: 'refresh', payload: {} })
        setTimeout(() => supabase.removeChannel(bc), 2000)
      }
    })
  }

  const getClassNotifParams = (classId) => {
    const c = clase.find(cl => cl.id === classId)
    if (!c) return { className: 'Clasă', classDate: '' }
    const ora = c.start_time?.slice(0, 5) || ''
    return {
      className: `${c.name}${ora ? ` · ${ora}` : ''}`,
      classDate: c.date || '',
    }
  }

  const adminScoateDinClasa = async (classId, memberId) => {
    await adjustMemberSessions(memberId, -1)
    const { error } = await supabase.from('bookings').delete().eq('class_id', classId).eq('member_id', memberId)
    if (error) {
      await adjustMemberSessions(memberId, +1)
      showToast('❌ Eroare!'); console.error(error); return
    }
    const memberEmail = clienti.find(c => c.id === memberId)?.email?.toLowerCase()
    if (memberEmail) supabase.from('class_reminders').delete().eq('class_id', classId).eq('member_email', memberEmail)
    checkAndBookFromWaitlist(classId)
    showToast('✓ Scos din clasă')
    fetchRezervariClasa(classId)
    fetchClase()
    const member = clienti.find(c => c.id === memberId)
    if (member?.email) {
      const { className, classDate } = getClassNotifParams(classId)
      sendNotification('class_removed', member.email, className, classDate)
    }
  }

  const adminAdaugaInClasa = async (classId, memberId) => {
    const alreadyIn = (rezervariClasa[classId] || []).some(r => r.member_id === memberId)
    if (alreadyIn) { showToast('❌ Deja rezervat!'); return }
    await adjustMemberSessions(memberId, +1)
    const { error } = await supabase.from('bookings').insert({ class_id: classId, member_id: memberId })
    if (error) {
      await adjustMemberSessions(memberId, -1)
      showToast('❌ Eroare!'); console.error(error); return
    }
    showToast('✓ Adăugat la clasă')
    const member = clienti.find(c => c.id === memberId)
    if (member?.email) {
      const memberEmail = member.email.toLowerCase()
      const cls = clase.find(c => c.id === classId)
      if (cls?.date && cls?.start_time) {
        const remindAt = new Date(new Date(`${cls.date}T${cls.start_time}`).getTime() - 3600000)
        if (remindAt > new Date())
          supabase.from('class_reminders').upsert({ class_id: classId, member_email: memberEmail, remind_at: remindAt.toISOString(), sent: false }, { onConflict: 'class_id,member_email' })
      }
      const { className, classDate } = getClassNotifParams(classId)
      sendNotification('class_added', memberEmail, className, classDate)
    }
    setAdaugaMembruSearch(prev => ({ ...prev, [classId]: '' }))
    fetchRezervariClasa(classId)
    fetchClase()
  }

  const adminToggleCheckIn = async (classId, memberId, currentValue) => {
    const { error } = await supabase.from('bookings')
      .update({ checked_in: !currentValue })
      .eq('class_id', classId).eq('member_id', memberId)
    if (error) { showToast('❌ Eroare!'); console.error(error); return }
    setRezervariClasa(prev => ({
      ...prev,
      [classId]: (prev[classId] || []).map(r => r.member_id === memberId ? { ...r, checked_in: !currentValue } : r),
    }))
  }

  const adminAjusteazaSedinte = async (aboId, currentUsed, currentTotal, delta) => {
    const newUsed = Math.max(0, Math.min(currentTotal ?? 9999, (currentUsed || 0) + delta))
    const { error } = await supabase.from('subscriptions').update({ sessions_used: newUsed }).eq('id', aboId)
    if (error) { showToast('❌ Eroare la actualizare!'); return }
    setAbonamente(prev => prev.map(a => a.id === aboId ? { ...a, sessions_used: newUsed } : a))
    showToast(delta > 0 ? '✅ Sesiune adăugată!' : '✅ Sesiune scăzută!')
  }

  const adminActiveazaAboQueued = async (aboQueued, memberEmail) => {
    const pad = n => String(n).padStart(2, '0')
    const startDate = new Date()
    const startStr = `${startDate.getFullYear()}-${pad(startDate.getMonth()+1)}-${pad(startDate.getDate())}`
    const duration = aboQueued.subscription_plans?.duration_months || 1
    const endDate = new Date(startDate)
    const targetMonth = endDate.getMonth() + duration
    endDate.setMonth(targetMonth)
    if (endDate.getMonth() !== targetMonth % 12) endDate.setDate(0)
    const endStr = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`
    await supabase.from('subscriptions').update({ is_active: false }).ilike('member_email', memberEmail).eq('is_active', true).neq('id', aboQueued.id)
    const { error } = await supabase.from('subscriptions').update({
      is_active: true, queued: false, start_date: startStr, end_date: endStr, sessions_used: 0,
    }).eq('id', aboQueued.id)
    if (error) { showToast('❌ Eroare la activare!'); return }
    showToast('✅ Abonament activat!')
    await fetchAbonamente()
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
    const baza = { name: numeClasa, start_time: oraInceput, end_time: oraSfarsit, coach: coachClasa || 'Coach', max_spots: locuriClasa, color: culoarClasa || null }
    const records = repetitiva
      ? genereazaDateRepetare().map(date => ({ ...baza, date }))
      : [{ ...baza, date: dataClasa }]
    if (records.length === 0) { showToast('❌ Nicio dată generată!'); setSavingClasa(false); return }
    const { error } = await supabase.from('classes').insert(records)
    if (error) { showToast('❌ ' + (error.message || 'Eroare!')); console.error(error) }
    else {
      showToast(repetitiva ? `✓ ${records.length} clase create!` : '✓ Clasă creată!')
      await fetchClase(); setDataClasa(''); setCoachClasa(''); setCuloarClasa(null)
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
              .ilike('member_email', email)
              .eq('is_active', true)
              .not('sessions_total', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
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
    // returnăm ședințele doar pentru clase viitoare (nu pentru cele din trecut, deja consumate)
    const { data: cls } = await supabase.from('classes').select('date').eq('id', id).maybeSingle()
    const _azis = new Date()
    const aziStr2 = `${_azis.getFullYear()}-${String(_azis.getMonth()+1).padStart(2,'0')}-${String(_azis.getDate()).padStart(2,'0')}`
    const { data: bks } = await supabase.from('bookings').select('member_id').eq('class_id', id)
    if (bks?.length > 0 && cls?.date >= aziStr2) {
      const memberIds = bks.map(b => b.member_id)
      const { data: profs } = await supabase.from('profiles').select('id, email').in('id', memberIds)
      if (profs?.length > 0) {
        for (const prof of profs) {
          const email = prof.email?.toLowerCase()
          if (!email) continue
          const { data: abo } = await supabase.from('subscriptions')
            .select('id, sessions_used')
            .ilike('member_email', email)
            .eq('is_active', true)
            .not('sessions_total', 'is', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
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
    const emailNorm = emailAbonament.toLowerCase().trim()
    const plan = planuri.find(p => p.id === planSelectat)
    const pad = n => String(n).padStart(2, '0')
    const _az = new Date()
    const azStr = `${_az.getFullYear()}-${pad(_az.getMonth()+1)}-${pad(_az.getDate())}`

    // verifica daca membrul are deja abonament valid (deja inceput, neexpirat, cu sedinte ramase)
    const { data: existingActive } = await supabase.from('subscriptions')
      .select('id, sessions_used, sessions_total, end_date, start_date')
      .ilike('member_email', emailNorm).eq('is_active', true).eq('queued', false)
      .lte('start_date', azStr)
      .gte('end_date', azStr)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    const hasValidActive = existingActive && (
      existingActive.sessions_total == null ||
      Math.max(0, existingActive.sessions_total - (existingActive.sessions_used || 0)) > 0
    )

    if (hasValidActive) {
      // salveaza ca programat — va activa automat cand cel curent se termina
      const { error } = await supabase.from('subscriptions').insert({
        member_email: emailNorm,
        plan_id: planSelectat,
        sessions_total: plan?.sessions || null,
        sessions_used: 0,
        start_date: azStr,
        end_date: azStr,
        is_active: false,
        queued: true,
        notes: pretPlatit ? `Plătit: ${pretPlatit} RON` : null,
      })
      if (error) { showToast('❌ ' + (error.message || 'Eroare necunoscută')); console.error(error) }
      else {
        showToast('✓ Abonament programat! Va activa automat când cel curent se epuizează.')
        await fetchAbonamente()
        setEmailAbonament(''); setNumeAbonament(''); setPretPlatit('')
      }
    } else {
      // nu are abonament valid — activeaza imediat
      await supabase.from('subscriptions').update({ is_active: false }).ilike('member_email', emailNorm).eq('is_active', true)
      const endDate = new Date(dataStartAbonament + 'T00:00:00')
      const targetMonth = endDate.getMonth() + (plan?.duration_months || 1)
      endDate.setMonth(targetMonth)
      if (endDate.getMonth() !== targetMonth % 12) endDate.setDate(0)
      const endDateStr = `${endDate.getFullYear()}-${pad(endDate.getMonth()+1)}-${pad(endDate.getDate())}`
      const { error } = await supabase.from('subscriptions').insert({
        member_email: emailNorm,
        plan_id: planSelectat,
        sessions_total: plan?.sessions || null,
        sessions_used: 0,
        start_date: dataStartAbonament,
        end_date: endDateStr,
        is_active: true,
        queued: false,
        notes: pretPlatit ? `Plătit: ${pretPlatit} RON` : null,
      })
      if (error) { showToast('❌ ' + (error.message || 'Eroare necunoscută')); console.error(error) }
      else {
        showToast('✓ Abonament adăugat!')
        await fetchAbonamente()
        setDataStartAbonament(azStr)
        setEmailAbonament(''); setNumeAbonament(''); setPretPlatit('')
        sendNotification('subscription_added', emailNorm, plan?.name, endDateStr)
        notifyMember(emailNorm)
      }
    }
    setSavingAbonament(false)
  }

  const savePlan = async () => {
    if (!numePlan) { showToast('❌ Introdu numele!'); return }
    setSavingPlan(true)
    const { error } = await supabase.from('subscription_plans').insert({
      name: numePlan, sessions: sedintePlan ? parseInt(sedintePlan) : null, price: pretPlan ? parseFloat(pretPlan) : null, duration_months: durataPlan,
    })
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else { showToast('✓ Plan adăugat!'); await fetchPlanuri(); setNumePlan(''); setSedintePlan(''); setPretPlan(''); setDurataPlan(1) }
    setSavingPlan(false)
  }

  const stergePlan = async (id) => {
    await supabase.from('subscription_plans').update({ is_active: false }).eq('id', id)
    showToast('✓ Plan șters!'); await fetchPlanuri()
  }

  const stergeAbonament = async (id) => {
    const abo = abonamente.find(a => a.id === id)
    if (abo?.queued) {
      await supabase.from('subscriptions').delete().eq('id', id)
      showToast('✓ Abonament programat șters!')
      await fetchAbonamente(); fetchRapoarte()
      return
    }
    const email = (abo?.member_email || '').toLowerCase().trim()
    let memberId = clienti.find(c => c.email?.toLowerCase() === email)?.id
    if (!memberId) {
      const { data: profil } = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle()
      memberId = profil?.id
    }
    if (memberId) {
      const _d = new Date(); const aziStr = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`
      const { data: memberBookings } = await supabase.from('bookings').select('id, class_id').eq('member_id', memberId)
      if (memberBookings?.length > 0) {
        const futureClassIds = new Set(clase.filter(c => c.date >= aziStr).map(c => c.id))
        const futureBookingIds = memberBookings.filter(b => futureClassIds.has(b.class_id)).map(b => b.id)
        if (futureBookingIds.length > 0) {
          const affectedClassIds = memberBookings.filter(b => futureClassIds.has(b.class_id)).map(b => b.class_id)
          await supabase.from('bookings').delete().in('id', futureBookingIds)
          affectedClassIds.forEach(cid => checkAndBookFromWaitlist(cid))
        }
      }
    }
    await supabase.from('subscriptions').update({ is_active: false }).eq('id', id)
    showToast('✓ Abonament anulat și rezervările viitoare șterse!')
    setRezervariClasa({})
    await fetchAbonamente(); fetchRapoarte()
    if (abo?.member_email) {
      const planName = abo.subscription_plans?.name || 'Abonament'
      sendNotification('subscription_cancelled', abo.member_email, planName, abo.end_date)
      notifyMember(abo.member_email)
    }
  }

  const getAbonamentClient = (email) => abonamente.find(a => a.member_email?.toLowerCase() === email?.toLowerCase() && a.is_active && !a.queued)
  const getQueuedAbonamentClient = (email) => abonamente.find(a => a.member_email?.toLowerCase() === email?.toLowerCase() && a.queued)

  const esteClientActiv = (email) => {
    const abo = getAbonamentClient(email)
    if (!abo) return false
    const inceput = new Date(abo.start_date + 'T00:00:00') <= new Date()
    const neexpirat = new Date(abo.end_date + 'T23:59:59') >= new Date()
    const client = clienti.find(c => c.email?.toLowerCase() === email?.toLowerCase())
    const areRezViitoare = client ? memberIdsCuRezervariViitoare.has(client.id) : false
    const sedinteOK = abo.sessions_total == null || Math.max(0, abo.sessions_total - (abo.sessions_used || 0)) > 0 || areRezViitoare
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
        {[{ id: 'clienti', emoji: '👥', lbl: 'Clienți' }, { id: 'abonamente', emoji: '🎟️', lbl: 'Abonamente' }, { id: 'clase', emoji: '📅', lbl: 'Clase' }, { id: 'wod', emoji: '🏋️', lbl: 'WOD' }, { id: 'planuri', emoji: '📋', lbl: 'Planuri' }, { id: 'setari', emoji: '⚙️', lbl: 'Setări' }].map(t => (
          <div key={t.id} onClick={() => setAdminTab(t.id)}
            style={{ flex: adminTab === t.id ? '1 1 auto' : '0 0 auto', padding: '7px 10px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: adminTab === t.id ? '600' : '400', background: adminTab === t.id ? '#1a1a1a' : '#fff', color: adminTab === t.id ? '#fff' : '#888', border: '1px solid #e0e0e0', whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
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
                style={{ padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: sortClienti === s.id ? '600' : '400', background: sortClienti === s.id ? '#1a1a1a' : '#fff', color: sortClienti === s.id ? '#fff' : '#888', border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '5px' }}>
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
            const aboQueued = getQueuedAbonamentClient(c.email)
            const zileRamase = abo ? Math.ceil((new Date(abo.end_date + 'T23:59:59') - new Date()) / (1000 * 60 * 60 * 24)) : null
            const sedinteEpuizate = abo?.sessions_total != null && Math.max(0, abo.sessions_total - (abo.sessions_used || 0)) === 0
            const neInceput = abo ? new Date(abo.start_date + 'T00:00:00') > new Date() : false
            const expirat = (zileRamase !== null && zileRamase < 0) || sedinteEpuizate
            const expiraCurand = !expirat && zileRamase !== null && zileRamase >= 0 && zileRamase <= 5
            const isOpen = clientSelectat === c.id
            return (
              <div key={c.id} onClick={() => setClientSelectat(isOpen ? null : c.id)}
                style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', borderLeft: `4px solid ${expirat ? '#E24B4A' : expiraCurand ? '#BA7517' : neInceput ? '#1a1a1a' : abo ? '#1a1a1a' : '#e0e0e0'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AvatarCircle name={c.full_name || c.email} size={42} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.full_name || 'Fără nume'}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{c.email}</div>
                    {abo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: expirat ? '#FCEBEB' : expiraCurand ? '#FAEEDA' : neInceput ? '#EEEDFB' : '#f0f0f0', color: expirat ? '#791F1F' : expiraCurand ? '#633806' : neInceput ? '#1a1a1a' : '#1a1a1a', fontWeight: '500' }}>
                          {sedinteEpuizate ? '⚠️ Epuizat' : expirat ? '⚠️ Expirat' : neInceput ? `📅 Din ${new Date(abo.start_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}` : expiraCurand ? `⏰ ${new Date(abo.end_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}` : `✓ ${new Date(abo.end_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' })}`}
                        </span>
                        <span style={{ fontSize: '10px', color: '#888' }}>{abo.subscription_plans?.name}</span>
                        {abo.sessions_total && <span style={{ fontSize: '10px', color: '#888' }}>· {(abo.sessions_used || 0)}/{abo.sessions_total} șed.</span>}
                      </div>
                    )}
                    {!abo && !aboQueued && <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>Fără abonament</div>}
                    {!abo && aboQueued && <div style={{ fontSize: '10px', color: '#5B7FCC', marginTop: '2px', fontWeight: '600' }}>📅 Abonament programat</div>}
                  </div>
                </div>
                {isOpen && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                    {/* Profil complet */}
                    <div style={{ background: '#f8f8f8', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '0.5px', marginBottom: '8px' }}>PROFIL</div>
                      {(c.first_name || c.last_name) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>Prenume / Nume</span>
                          <span style={{ fontWeight: '600', color: '#1a1a1a' }}>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</span>
                        </div>
                      )}
                      {c.birth_date && (() => {
                        const varsta = Math.floor((new Date() - new Date(c.birth_date + 'T00:00:00')) / (365.25 * 24 * 3600 * 1000))
                        return (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>Data nașterii</span>
                            <span style={{ fontWeight: '600', color: '#1a1a1a' }}>{new Date(c.birth_date + 'T00:00:00').toLocaleDateString('ro-RO')} ({varsta} ani)</span>
                          </div>
                        )
                      })()}
                      {c.gender && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>Gen</span>
                          <span style={{ fontWeight: '600', color: '#1a1a1a' }}>{c.gender === 'masculin' ? '♂ Masculin' : '♀ Feminin'}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ color: '#888' }}>Waiver</span>
                        {c.waiver_accepted ? (
                          <span style={{ fontWeight: '600', color: '#1a1a1a' }}>✓ Acceptat {c.waiver_accepted_at ? new Date(c.waiver_accepted_at).toLocaleDateString('ro-RO') : ''}</span>
                        ) : (
                          <span style={{ fontWeight: '600', color: '#E24B4A' }}>✗ Neacceptat</span>
                        )}
                      </div>
                    </div>
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
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>Ședințe</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: '600', color: sedinteEpuizate ? '#E24B4A' : '#1a1a1a' }}>{abo.sessions_used || 0} / {abo.sessions_total}</span>
                              <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                                <button onClick={() => adminAjusteazaSedinte(abo.id, abo.sessions_used, abo.sessions_total, +1)}
                                  style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #1a1a1a', background: '#f0f0f0', color: '#1a1a1a', fontWeight: '700', fontSize: '14px', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                <button onClick={() => adminAjusteazaSedinte(abo.id, abo.sessions_used, abo.sessions_total, -1)}
                                  style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #E24B4A', background: '#FCEBEB', color: '#E24B4A', fontWeight: '700', fontSize: '14px', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                              </div>
                            </div>
                          </div>
                        )}
                        {abo.notes && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{abo.notes}</div>}
                      </div>
                    ) : null}
                    {aboQueued && (
                      <div style={{ background: '#F0F4FF', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px', borderLeft: '3px solid #5B7FCC' }}>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: '#5B7FCC', marginBottom: '6px' }}>📅 ABONAMENT PROGRAMAT</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>Plan</span>
                          <span style={{ fontWeight: '600' }}>{aboQueued.subscription_plans?.name || '—'}</span>
                        </div>
                        {aboQueued.sessions_total && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>Ședințe</span>
                            <span style={{ fontWeight: '600' }}>{aboQueued.sessions_total}</span>
                          </div>
                        )}
                        <div style={{ fontSize: '11px', color: '#5B7FCC', marginTop: '4px', marginBottom: '8px' }}>
                          Activare automată la epuizarea abonamentului curent
                        </div>
                        {aboQueued.notes && <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>{aboQueued.notes}</div>}
                        <button onClick={e => { e.stopPropagation(); adminActiveazaAboQueued(aboQueued, c.email) }}
                          style={{ width: '100%', padding: '7px', background: '#5B7FCC', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
                          ⚡ Activează acum
                        </button>
                      </div>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setAdminTab('abonamente'); setEmailAbonament(c.email); setNumeAbonament(c.full_name || '') }}
                      style={{ width: '100%', padding: '8px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                      {abo ? (aboQueued ? '➕ Abonament suplimentar' : '🔄 Reînnoiește abonament') : '+ Adaugă abonament'}
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
              const borderColor = emailVal.length === 0 ? '#e0e0e0' : emailValid ? '#1a1a1a' : '#E24B4A'
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
              if (diff === 0) return <div style={{ fontSize: '11px', color: '#1a1a1a', marginBottom: '10px' }}>✓ Suma corespunde prețului standard</div>
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
          {(() => {
            const fmtData = (d) => new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' })
            const grouped = {}
            abonamente.forEach(a => {
              const key = a.member_email?.toLowerCase()
              if (!grouped[key]) grouped[key] = []
              grouped[key].push(a)
            })
            const emails = Object.keys(grouped)
            return (
              <>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>ABONAMENTE — {emails.length} membri, {abonamente.length} total</div>
                {emails.map(email => {
                  const list = grouped[email]
                  const activ = list.find(a => a.is_active && !a.queued)
                  const queued = list.filter(a => a.queued)
                  const membruNume = clienti.find(c => c.email?.toLowerCase() === email)?.full_name
                  const expanded = !!aboExpandat[email]
                  const zileRamase = activ ? Math.ceil((new Date(activ.end_date + 'T23:59:59') - new Date()) / 86400000) : null
                  const epuizat = activ && activ.sessions_total != null && Math.max(0, activ.sessions_total - (activ.sessions_used || 0)) === 0
                  const neinceput = activ && new Date(activ.start_date + 'T00:00:00') > new Date()
                  const expirat = activ && (zileRamase < 0 || epuizat)
                  const statusColor = !activ ? '#aaa' : expirat ? '#E24B4A' : neinceput ? '#BA7517' : '#1a1a1a'
                  const statusLabel = !activ ? 'Fără abonament' : expirat ? 'Expirat' : neinceput ? 'Neînceput' : 'Activ'
                  return (
                    <div key={email} style={{ background: '#fff', borderRadius: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                      <div onClick={() => setAboExpandat(prev => ({ ...prev, [email]: !prev[email] }))}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer', borderLeft: `4px solid ${statusColor}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{membruNume || email}</div>
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{email}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px', flexShrink: 0 }}>
                          {queued.length > 0 && <span style={{ fontSize: '10px', background: '#E8EEFF', color: '#5B7FCC', borderRadius: '6px', padding: '2px 6px', fontWeight: '600' }}>+{queued.length} programat</span>}
                          <span style={{ fontSize: '11px', fontWeight: '600', color: statusColor }}>{statusLabel}</span>
                          <span style={{ fontSize: '14px', color: '#aaa', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 14px 14px' }}>
                          {activ ? (
                            <div style={{ background: expirat ? '#FFF5F5' : neinceput ? '#FFFBF0' : '#f5f5f5', borderRadius: '10px', padding: '10px 12px', marginBottom: queued.length > 0 ? '8px' : '0', borderLeft: `3px solid ${statusColor}` }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: statusColor, marginBottom: '5px' }}>
                                {expirat ? '⚠️ EXPIRAT' : neinceput ? '📅 NEÎNCEPUT' : '✓ ACTIV'}
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: '600', color: '#1a1a1a' }}>{activ.subscription_plans?.name}</div>
                              <div style={{ fontSize: '11px', color: '#666', marginTop: '3px' }}>{fmtData(activ.start_date)} → {fmtData(activ.end_date)}</div>
                              {activ.sessions_total != null && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                  <span style={{ fontSize: '11px', color: epuizat ? '#E24B4A' : '#888' }}>Ședințe: {activ.sessions_used || 0}/{activ.sessions_total}</span>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <button onClick={e => { e.stopPropagation(); adminAjusteazaSedinte(activ.id, activ.sessions_used, activ.sessions_total, +1) }}
                                      style={{ width: '22px', height: '22px', borderRadius: '5px', border: '1px solid #1a1a1a', background: '#f0f0f0', color: '#1a1a1a', fontWeight: '700', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                    <button onClick={e => { e.stopPropagation(); adminAjusteazaSedinte(activ.id, activ.sessions_used, activ.sessions_total, -1) }}
                                      style={{ width: '22px', height: '22px', borderRadius: '5px', border: '1px solid #E24B4A', background: '#FCEBEB', color: '#E24B4A', fontWeight: '700', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                  </div>
                                </div>
                              )}
                              {activ.notes && <div style={{ fontSize: '11px', color: '#1a1a1a', marginTop: '3px' }}>{activ.notes}</div>}
                              <button onClick={e => { e.stopPropagation(); stergeAbonament(activ.id) }}
                                style={{ marginTop: '8px', padding: '4px 10px', borderRadius: '7px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️ Șterge</button>
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '8px 0' }}>Niciun abonament activ</div>
                          )}
                          {queued.map(q => (
                            <div key={q.id} style={{ background: '#F0F4FF', borderRadius: '10px', padding: '10px 12px', marginTop: '8px', borderLeft: '3px solid #5B7FCC' }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: '#5B7FCC', marginBottom: '5px' }}>📅 PROGRAMAT</div>
                              <div style={{ fontSize: '12px', fontWeight: '600', color: '#1a1a1a' }}>{q.subscription_plans?.name}</div>
                              {q.sessions_total != null && <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>Ședințe: {q.sessions_total}</div>}
                              {q.notes && <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{q.notes}</div>}
                              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                <button onClick={e => { e.stopPropagation(); adminActiveazaAboQueued(q, email) }}
                                  style={{ flex: 1, padding: '6px', background: '#5B7FCC', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}>⚡ Activează acum</button>
                                <button onClick={e => { e.stopPropagation(); stergeAbonament(q.id) }}
                                  style={{ padding: '6px 10px', borderRadius: '7px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )
          })()}
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
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>Culoare clasă</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              {[null, '#FF3B30', '#FF9500', '#FFD60A', '#C8FF00', '#30D158', '#32ADE6', '#BF5AF2', '#1a1a1a'].map(col => (
                <div key={col || 'none'} onClick={() => setCuloarClasa(culoarClasa === col ? null : col)}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', flexShrink: 0, boxSizing: 'border-box',
                    background: col || '#e0e0e0',
                    border: culoarClasa === col ? '3px solid #1a1a1a' : col ? '2px solid transparent' : '2px dashed #bbb',
                    boxShadow: culoarClasa === col ? '0 0 0 2px #fff inset' : 'none' }} />
              ))}
            </div>
            <div onClick={() => { setRepetitiva(!repetitiva); setZileRepetare([]); setLaInfinit(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: repetitiva ? '#f0f0f0' : '#f5f5f5', borderRadius: '10px', marginBottom: '10px', cursor: 'pointer', border: repetitiva ? '1.5px solid #1a1a1a' : '1.5px solid transparent' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#1a1a1a' }}>Repetă săptămânal</div>
                <div style={{ fontSize: '11px', color: '#888' }}>Creează automat pe zilele alese</div>
              </div>
              <div style={{ width: '44px', height: '26px', borderRadius: '13px', background: repetitiva ? '#1a1a1a' : '#ccc', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: '3px', left: repetitiva ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
            {repetitiva && (
              <div style={{ background: '#f0f0f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', color: '#1a1a1a', fontWeight: '600', marginBottom: '8px' }}>ZILELE SĂPTĂMÂNII</div>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '12px' }}>
                  {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((z, i) => (
                    <div key={i} onClick={() => toggleZiRepetare(i)}
                      style={{ flex: 1, height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: zileRepetare.includes(i) ? '#1a1a1a' : '#fff', color: zileRepetare.includes(i) ? '#fff' : '#888', border: zileRepetare.includes(i) ? '2px solid #1a1a1a' : '1px solid #C5C2F5' }}>
                      {z}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {[{ id: false, lbl: 'Nr. săptămâni' }, { id: true, lbl: 'Până opresc eu' }].map(opt => (
                    <div key={String(opt.id)} onClick={() => setLaInfinit(opt.id)}
                      style={{ flex: 1, padding: '7px', textAlign: 'center', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: laInfinit === opt.id ? '600' : '400', background: laInfinit === opt.id ? '#1a1a1a' : '#fff', color: laInfinit === opt.id ? '#fff' : '#888', border: laInfinit === opt.id ? '2px solid #1a1a1a' : '1px solid #C5C2F5' }}>
                      {opt.lbl}
                    </div>
                  ))}
                </div>
                {!laInfinit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <button onClick={() => setSaptamaniRepetare(s => Math.max(1, s - 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '16px', cursor: 'pointer' }}>−</button>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: '#1a1a1a', minWidth: '80px', textAlign: 'center' }}>{saptamaniRepetare} săpt.</span>
                    <button onClick={() => setSaptamaniRepetare(s => Math.min(52, s + 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '16px', cursor: 'pointer' }}>+</button>
                  </div>
                )}
                {laInfinit && (
                  <div style={{ fontSize: '11px', color: '#1a1a1a', marginBottom: '8px' }}>Se generează 1 an de clase (~52 săpt.). Șterge clasele viitoare când vrei să oprești.</div>
                )}
                {dataClasa && zileRepetare.length > 0 && (() => {
                  const dates = genereazaDateRepetare()
                  if (dates.length === 0) return null
                  const last = new Date(dates[dates.length - 1] + 'T00:00:00')
                  return (
                    <div style={{ fontSize: '11px', color: '#1a1a1a', lineHeight: '1.6' }}>
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
            {clase.some(c => c.date < `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`) && (
              <button onClick={stergeClaseleTrecute} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer' }}>🗑️ Șterge trecute</button>
            )}
          </div>
          {(() => {
            const grouped = clase.reduce((acc, c) => { if (!acc[c.date]) acc[c.date] = []; acc[c.date].push(c); return acc }, {})
            const _azd = new Date()
            const azi = `${_azd.getFullYear()}-${String(_azd.getMonth()+1).padStart(2,'0')}-${String(_azd.getDate()).padStart(2,'0')}`
            return Object.entries(grouped).map(([date, claseZi]) => {
              const dateObj = new Date(date + 'T00:00:00')
              const eAzi = date === azi
              const eTrecut = date < azi
              const ziLabel = dateObj.toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'long' })
              return (
                <div key={date} style={{ marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: eAzi ? '#1a1a1a' : eTrecut ? '#f0f0f0' : '#1a1a1a', borderRadius: '20px', padding: '5px 14px' }}>
                      {eAzi && <span style={{ fontSize: '10px', color: '#C8FF00', fontWeight: '800', letterSpacing: '0.08em' }}>AZI</span>}
                      <span style={{ fontSize: '13px', fontWeight: '700', color: eAzi ? '#fff' : eTrecut ? '#aaa' : '#fff', textTransform: 'capitalize' }}>{ziLabel}</span>
                    </div>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                  </div>
                  {claseZi.map(c => (
                    <div key={c.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: '#1a1a1a' }}>{c.name}</div>
                          <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>🕐 {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)} · 👤 {c.coach} · {c.max_spots} locuri</div>
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
                          {(() => {
                            const rez = rezervariClasa[c.id]
                            const nrCheckin = (rez || []).filter(r => r.checked_in).length
                            const nrTotal = rez?.length || 0
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <div style={{ fontSize: '11px', fontWeight: '600', color: '#888' }}>REZERVĂRI ({nrTotal}/{c.max_spots})</div>
                                {nrTotal > 0 && <div style={{ fontSize: '10px', fontWeight: '600', color: nrCheckin > 0 ? '#1a1a1a' : '#aaa', background: nrCheckin > 0 ? '#f0f0f0' : '#f5f5f5', padding: '2px 8px', borderRadius: '20px' }}>✓ {nrCheckin}/{nrTotal} prezenți</div>}
                              </div>
                            )
                          })()}
                          {!rezervariClasa[c.id] ? <div style={{ fontSize: '12px', color: '#aaa' }}>Se încarcă...</div>
                            : rezervariClasa[c.id].length === 0 ? <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>Nicio rezervare</div>
                            : rezervariClasa[c.id].map((r, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: i < rezervariClasa[c.id].length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                              <AvatarCircle name={r.full_name || r.email || r.member_id} avatarUrl={r.avatar_url} size={28} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '12px', fontWeight: '500', color: '#1a1a1a' }}>{r.full_name || 'Utilizator'}</div>
                                <div style={{ fontSize: '10px', color: '#888' }}>{r.email || r.member_id?.slice(0,8) + '...'}</div>
                              </div>
                              {(() => {
                                const clasaInceput = new Date(`${c.date}T${c.start_time}`) <= new Date()
                                return (
                                  <button onClick={() => adminToggleCheckIn(c.id, r.member_id, r.checked_in)}
                                    style={{ padding: '3px 8px', borderRadius: '8px', border: r.checked_in ? '1px solid #1a1a1a' : '1px solid #d0d0d0', background: r.checked_in ? '#f0f0f0' : '#f5f5f5', color: r.checked_in ? '#1a1a1a' : '#aaa', fontSize: '11px', cursor: 'pointer', flexShrink: 0, fontWeight: r.checked_in ? '600' : '400' }}>
                                    {r.checked_in ? '✓ Prezent' : clasaInceput ? '○ Absent' : '○ Marchează'}
                                  </button>
                                )
                              })()}
                              <button onClick={() => adminScoateDinClasa(c.id, r.member_id)}
                                style={{ padding: '3px 8px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#C62828', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                            </div>
                          ))}
                          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #f5f5f5' }}>
                            <div style={{ fontSize: '10px', fontWeight: '700', color: '#aaa', letterSpacing: '0.06em', marginBottom: '6px' }}>ADAUGĂ MANUAL</div>
                            <input value={adaugaMembruSearch[c.id] || ''} onChange={e => setAdaugaMembruSearch(prev => ({ ...prev, [c.id]: e.target.value }))}
                              placeholder="Caută după nume sau email..."
                              style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', outline: 'none', background: '#fafafa', boxSizing: 'border-box' }} />
                            {adaugaMembruSearch[c.id]?.trim() && (() => {
                              const q = adaugaMembruSearch[c.id].toLowerCase()
                              const rezultate = clienti.filter(cl =>
                                (cl.full_name?.toLowerCase().includes(q) || cl.email?.toLowerCase().includes(q)) &&
                                !(rezervariClasa[c.id] || []).some(r => r.member_id === cl.id)
                              ).slice(0, 5)
                              return rezultate.length > 0 ? (
                                <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', marginTop: '4px', overflow: 'hidden' }}>
                                  {rezultate.map(cl => (
                                    <div key={cl.id} onClick={() => adminAdaugaInClasa(c.id, cl.id)}
                                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div>
                                        <div style={{ fontWeight: '500', color: '#1a1a1a' }}>{cl.full_name || cl.email}</div>
                                        <div style={{ fontSize: '10px', color: '#888' }}>{cl.email}</div>
                                      </div>
                                      <span style={{ fontSize: '11px', color: '#1a1a1a', fontWeight: '600' }}>+ Adaugă</span>
                                    </div>
                                  ))}
                                </div>
                              ) : <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px', padding: '4px' }}>Niciun rezultat</div>
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })
          })()}
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
              { key: 'beginner', label: '🟢 Beginner', culoare: '#1a1a1a', bg: '#f0f0f0' },
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
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Valabilitate (luni)</div>
            <input type="number" min="1" value={durataPlan} onChange={e => setDurataPlan(Math.max(1, parseInt(e.target.value) || 1))} placeholder="ex: 1"
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
                    {p.sessions ? `${p.sessions} ședințe` : 'Nelimitat'} · {p.price != null ? `${p.price} RON` : 'Preț nesetat'} · {p.duration_months || 1} {(p.duration_months || 1) === 1 ? 'lună' : 'luni'}
                  </div>
                </div>
                <button onClick={() => stergePlan(p.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* SETĂRI */}
      {adminTab === 'setari' && (
        <>
        <div style={{ background: '#fff', borderRadius: '14px', padding: '16px 20px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a1a1a' }}>📊 Rapoarte</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '11px', color: '#888' }}>{new Date().toLocaleDateString('ro-RO', { month: 'long', year: 'numeric' })}</div>
              <button onClick={fetchRapoarte} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '20px', border: 'none', background: '#f0f0f0', color: '#1a1a1a', fontWeight: '600', cursor: 'pointer' }}>↻</button>
            </div>
          </div>
          {rapoarteData ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              {[
                { label: 'Membri activi', value: rapoarteData.membriActivi, icon: '👥', color: '#5B7FCC', bg: '#EEF2FF' },
                { label: 'Abonamente luna', value: rapoarteData.aboVandute, icon: '🎟️', color: '#1a1a1a', bg: '#f0f0f0' },
                { label: 'Venituri RON', value: rapoarteData.venituriLuna % 1 === 0 ? rapoarteData.venituriLuna : rapoarteData.venituriLuna.toFixed(0), icon: '💰', color: '#B86E00', bg: '#FFF8EC' },
              ].map(({ label, value, icon, color, bg }) => (
                <div key={label} style={{ background: bg, borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', marginBottom: '4px' }}>{icon}</div>
                  <div style={{ fontSize: '22px', fontWeight: '800', color, lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '4px', lineHeight: '1.3' }}>{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: '13px', padding: '20px 0' }}>Se încarcă...</div>
          )}
        </div>
        <div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' }}>Fereastră de anulare clase</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '20px' }}>Membrii nu pot anula cu mai puțin de X ore înainte de start. Admin-ul poate anula oricând.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <button onClick={() => setCancelWindowSetting(prev => Math.max(0, prev - 0.5))}
              style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f9f9f9', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }}>−</button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#1a1a1a', lineHeight: 1 }}>{cancelWindowSetting}</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>ore</div>
            </div>
            <button onClick={() => setCancelWindowSetting(prev => prev + 0.5)}
              style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f9f9f9', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }}>+</button>
          </div>
          {cancelWindowSetting === 0 && (
            <div style={{ fontSize: '11px', color: '#1a1a1a', background: '#f0f0f0', padding: '8px 12px', borderRadius: '8px', marginBottom: '16px' }}>Membrii pot anula oricând (fără restricții).</div>
          )}
          <button onClick={saveSettings} disabled={savingSettings}
            style={{ width: '100%', padding: '13px', background: savingSettings ? '#e0e0e0' : '#C8FF00', color: '#111', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: savingSettings ? 'not-allowed' : 'pointer' }}>
            {savingSettings ? 'Se salvează...' : '✓ Salvează setările'}
          </button>
        </div>
        </>
      )}
    </div>
  )
}

function SortableList({ items, onReorder, onRemove }) {
  const containerRef = useRef(null)
  const drag = useRef({ on: false, idx: null, startY: 0, initialY: 0 })
  const [activeIdx, setActiveIdx] = useState(null)
  const [editIdx, setEditIdx] = useState(null)
  const [editVal, setEditVal] = useState('')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onMove = (e) => {
      if (drag.current.idx === null) return
      const y = e.touches[0].clientY
      const totalDy = y - drag.current.initialY
      if (!drag.current.on) {
        if (Math.abs(totalDy) < 8) return
        drag.current.on = true
      }
      e.preventDefault()
      const dy = y - drag.current.startY
      const STEP = 48
      if (Math.abs(dy) < STEP / 2) return
      const dir = dy > 0 ? 1 : -1
      const from = drag.current.idx
      const to = from + dir
      if (to < 0 || to >= items.length) return
      const next = [...items]
      ;[next[from], next[to]] = [next[to], next[from]]
      onReorder(next)
      drag.current.idx = to
      drag.current.startY = y
      setActiveIdx(to)
    }
    el.addEventListener('touchmove', onMove, { passive: false })
    return () => el.removeEventListener('touchmove', onMove)
  }, [items, onReorder])

  const startDrag = (e, i) => {
    if (editIdx !== null) return
    e.stopPropagation()
    const y = e.touches[0].clientY
    drag.current = { on: false, idx: i, startY: y, initialY: y }
    setActiveIdx(i)
  }

  const endDrag = (i) => {
    if (!drag.current.on && drag.current.idx !== null) {
      setEditIdx(i)
      setEditVal(items[i])
    }
    drag.current = { on: false, idx: null, startY: 0, initialY: 0 }
    setActiveIdx(null)
  }

  const commitEdit = (i) => {
    if (editVal.trim()) {
      const next = [...items]
      next[i] = editVal.trim()
      onReorder(next)
    }
    setEditIdx(null)
    setEditVal('')
  }

  return (
    <div ref={containerRef}>
      {items.map((m, i) => (
        <div key={i}
          onTouchStart={(e) => startDrag(e, i)}
          onTouchEnd={() => endDrag(i)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px', background: activeIdx === i ? '#C8FF00' : '#f0f0f0', borderRadius: '8px', marginBottom: '6px', boxShadow: activeIdx === i ? '0 4px 14px rgba(0,0,0,0.13)' : 'none', transition: 'box-shadow 0.1s, background 0.1s', touchAction: 'none', userSelect: 'none' }}>
          <span style={{ fontSize: '16px', color: '#bbb', padding: '0 6px', flexShrink: 0 }}>☰</span>
          {editIdx === i ? (
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onBlur={() => commitEdit(i)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(i) }}
                style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '13px', color: '#1a1a1a', outline: 'none', padding: '0', touchAction: 'auto', boxSizing: 'border-box' }}
              />
              {miscareSugestii(editVal).length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                  {miscareSugestii(editVal).map((s, si) => (
                    <div key={si} onMouseDown={e => e.preventDefault()}
                      onClick={() => { const parts = editVal.split(/\s+/); parts[parts.length - 1] = s; setEditVal(parts.join(' ') + ' ') }}
                      style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', color: '#1a1a1a' }}>{s}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '13px', color: '#1a1a1a', flex: 1 }}>• {m}</span>
          )}
          {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(i) }} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '16px', cursor: 'pointer', lineHeight: 1, touchAction: 'auto', flexShrink: 0 }}>×</button>}
        </div>
      ))}
    </div>
  )
}

function JurnalList({ logs, onEdit, onDelete }) {
  const [deschis, setDeschis] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  if (logs.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
      <div style={{ fontSize: '36px', marginBottom: '10px' }}>📓</div>
      <div style={{ fontSize: '14px' }}>Niciun antrenament logat încă</div>
    </div>
  )
  const WOD_TYPES = ['AMRAP','For Time','EMOM','Tabata','Chipper','Ladder','Strength','Partner WOD']
  return (
    <>
      {logs.map((w, i) => {
        const parts = (w.notes || '').split('\n---\n')
        const miscariLog = parts.length > 1 ? parts[0] : (parts[0] || null)
        const noteLog = parts.length > 1 ? parts[1] : null
        const data = w.logged_at ? new Date(w.logged_at).toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'
        const logKey = w.id || i
        const isOpen = deschis === logKey
        const linii = miscariLog ? miscariLog.trim().split('\n').filter(Boolean) : []
        const primaEsteHeader = linii.length > 0 && WOD_TYPES.some(t => linii[0].startsWith(t))
        const wodHeader = primaEsteHeader ? linii[0] : null
        const miscariAfisate = linii.slice(primaEsteHeader ? 1 : 0)
        const areDetalii = wodHeader || miscariAfisate.length > 0 || (noteLog && noteLog.trim())
        return (
          <div key={logKey}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#1a1a1a', marginBottom: '6px', marginTop: i > 0 ? '4px' : '0' }}>{data}</div>
          <div onClick={() => { setDeschis(isOpen ? null : logKey); setConfirmDelete(null) }}
            style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #1a1a1a', cursor: 'pointer', position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a' }}>{w.variant_level || 'WOD'}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {onDelete && (
                  confirmDelete === logKey ? (
                    <button onClick={(e) => { e.stopPropagation(); onDelete(w.id); setConfirmDelete(null) }}
                      style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: '#e53935', border: 'none', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}>
                      Șterge?
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(logKey) }}
                      style={{ fontSize: '16px', color: '#ccc', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>
                      ×
                    </button>
                  )
                )}
                <span style={{ fontSize: '14px', color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
              {w.result && <span style={{ fontSize: '12px', background: '#f0f0f0', color: '#1a1a1a', padding: '3px 10px', borderRadius: '20px', fontWeight: '600' }}>{w.result}</span>}
              {w.time_result && <span style={{ fontSize: '12px', background: '#f0f0f0', color: '#1a1a1a', padding: '3px 10px', borderRadius: '20px', fontWeight: '600' }}>⏱ {w.time_result}</span>}
              {!w.result && !w.time_result && <span style={{ fontSize: '12px', color: '#aaa' }}>—</span>}
            </div>
            {isOpen && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                {wodHeader && (
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#1a1a1a', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{wodHeader}</div>
                )}
                {miscariAfisate.length > 0 && (
                  <div style={{ marginBottom: noteLog && noteLog.trim() ? '10px' : '0' }}>
                    {miscariAfisate.map((m, j) => (
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
                {!areDetalii && (
                  <div style={{ fontSize: '12px', color: '#aaa' }}>Nicio detaliere suplimentară.</div>
                )}
                {onEdit && (
                  <button onClick={(e) => { e.stopPropagation(); onEdit(w) }}
                    style={{ marginTop: '12px', padding: '7px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', color: '#555', cursor: 'pointer' }}>
                    ✎ Editează
                  </button>
                )}
              </div>
            )}
          </div>
          </div>
        )
      })}
    </>
  )
}

function App() {
  const [screen, setScreen] = useState('home')
  const [prevScreen, setPrevScreen] = useState('home')
  const [feedUnread, setFeedUnread] = useState(0)
  const screenRef = useRef('home')
  const [wodDeschis, setWodDeschis] = useState(false)
  const [claseHomeDeschis, setClaseHomeDeschis] = useState(false)
  const [variantaAleasa, setVariantaAleasa] = useState(null)
  const [wodZiData, setWodZiData] = useState(null)
  const [dataAcasa, setDataAcasa] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })
  const [prSelectat, setPrSelectat] = useState(null)
  const [catDeschise, setCatDeschise] = useState({})
  const [catSearch, setCatSearch] = useState({})
  const [heroWodsDeschis, setHeroWodsDeschis] = useState(false)
  const [heroWodNouInput, setHeroWodNouInput] = useState('')
  const [prDate, setPrDate] = useState([])
  const [wodLogs, setWodLogs] = useState([])
  const [miscarePR, setMiscarePR] = useState('')
  const [logPentruPR, setLogPentruPR] = useState(null)
  const [claseDB, setClaseDB] = useState([])
  const [claseDBLoaded, setClaseDBLoaded] = useState(false)
  const [refreshZiTrigger, setRefreshZiTrigger] = useState(0)
  const [rezervariIncarcate, setRezervariIncarcate] = useState(false)
  const [cancelWindowHours, setCancelWindowHours] = useState(2)
  const homeCalScrollRef = useRef(null)
  const homeCalTodayRef = useRef(null)
  const [rezervariMele, setRezervariMele] = useState([])
  const [rezervariPerClasa, setRezervariPerClasa] = useState({})
  const [waitlistMea, setWaitlistMea] = useState([])
  const [clasaHomeSelectata, setClasaHomeSelectata] = useState(null)
  const [toast, setToast] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [abonamentReal, setAbonamentReal] = useState(null)
  const [abonamentLoading, setAbonamentLoading] = useState(true)
  const [abonamentInitialized, setAbonamentInitialized] = useState(false)
  const [prValoare, setPrValoare] = useState('')
  const [prReps, setPrReps] = useState('')
  const [prTimp, setPrTimp] = useState('')
  const [prDistanta, setPrDistanta] = useState('')
  const [prCardioUnit, setPrCardioUnit] = useState('m')
  const [prNote, setPrNote] = useState('')
  const [prVarianta, setPrVarianta] = useState('RX')
  const [prSaving, setPrSaving] = useState(false)
  const [customHeroWods, setCustomHeroWods] = useState([])
  const [newHeroWodName, setNewHeroWodName] = useState('')
  const [newHeroWodFormat, setNewHeroWodFormat] = useState('')
  const [newHeroWodMiscari, setNewHeroWodMiscari] = useState([])
  const [newHeroWodMiscareCurenta, setNewHeroWodMiscareCurenta] = useState('')
  const [newHeroWodSaving, setNewHeroWodSaving] = useState(false)
  const [editHeroWodId, setEditHeroWodId] = useState(null)
  const [editPrId, setEditPrId] = useState(null)
  const [wodResult, setWodResult] = useState('')
  const [wodTime, setWodTime] = useState('')
  const [wodNote, setWodNote] = useState('')
  const [wodSaving, setWodSaving] = useState(false)
  const [wodTip, setWodTip] = useState('AMRAP')
  const [wodDurata, setWodDurata] = useState('')
  const [wodMiscari, setWodMiscari] = useState([])
  const [wodMiscareCurenta, setWodMiscareCurenta] = useState('')
  const [editLogId, setEditLogId] = useState(null)
  const [editLogNotesPrefix, setEditLogNotesPrefix] = useState('')
  const [editLogHeader, setEditLogHeader] = useState('')
  const [editLogMiscari, setEditLogMiscari] = useState([])
  const [editLogMiscareCurenta, setEditLogMiscareCurenta] = useState('')
  const [wodMiscariCustom, setWodMiscariCustom] = useState(null)
  const [logTab, setLogTab] = useState('nou')
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authScreen, setAuthScreen] = useState('login')
  const [authEmail, setAuthEmail] = useState(() => localStorage.getItem('forge_remember_email') || '')
  const [authPassword, setAuthPassword] = useState('')
  const [authSubmitting, setAuthSubmitting] = useState(false)
  const [authError, setAuthError] = useState('')
  const [rememberMe, setRememberMe] = useState(!!localStorage.getItem('forge_remember_email'))
  const [resetMode, setResetMode] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installDismissed, setInstallDismissed] = useState(false)
  const [clasamentLogs, setClasamentLogs] = useState([])
  const [clasamentLoading, setClasamentLoading] = useState(false)
  const [clasamentWodData, setClasamentWodData] = useState(null)
  const [clasamentDate, setClasamentDate] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })
  // Citite de handlerele realtime (efect cu deps [user], deci create o
  // singura data la login) - fara refs, acele closures ar ramane cu
  // dataAcasa/clasamentDate de la momentul login-ului, suprascriind cu date
  // vechi ecranul daca userul a navigat between timp la o alta zi.
  const dataAcasaRef = useRef(dataAcasa)
  const clasamentDateRef = useRef(clasamentDate)
  useEffect(() => { dataAcasaRef.current = dataAcasa }, [dataAcasa])
  useEffect(() => { clasamentDateRef.current = clasamentDate }, [clasamentDate])
  const [userProfile, setUserProfile] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showCalPicker, setShowCalPicker] = useState(false)
  const [calPickerYear, setCalPickerYear] = useState(new Date().getFullYear())
  const [calPickerMonth, setCalPickerMonth] = useState(new Date().getMonth())
  const [onboardingStep, setOnboardingStep] = useState(1)
  const [onboardingFirstName, setOnboardingFirstName] = useState('')
  const [onboardingLastName, setOnboardingLastName] = useState('')
  const [onboardingGender, setOnboardingGender] = useState('')
  const [onboardingBirthDate, setOnboardingBirthDate] = useState('')
  const [onboardingWaiverAccepted, setOnboardingWaiverAccepted] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef(null)
  const [profileFirstName, setProfileFirstName] = useState('')
  const [profileLastName, setProfileLastName] = useState('')
  const [profileGender, setProfileGender] = useState('')
  const [profileBirthDate, setProfileBirthDate] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileNewPassword, setProfileNewPassword] = useState('')
  const [profileNewPasswordConfirm, setProfileNewPasswordConfirm] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const heroWodsInfoAll = { ...HERO_WODS_INFO }
  customHeroWods.forEach(w => {
    heroWodsInfoAll[w.name] = [w.format, ...(w.movements ? w.movements.split('\n') : [])].filter(Boolean).join('\n')
  })
  const heroWodsListAll = [...PR_CATEGORII.HERO_WODS, ...customHeroWods.map(w => w.name)]

  const _now = new Date()
  const actualToday = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`

  // Chipurile de zi din "Clase disponibile" (365/366 pe an) - memoizate ca sa
  // nu se recalculeze (data-math + scanari prin claseDB/wodLogs pt fiecare
  // zi) la orice re-render al ecranului home (polling la 8-15s, realtime
  // etc.), ceea ce bloca thread-ul principal si dadea impresia de "ecran
  // inghetat/alb" la tap pe o data.
  const homeCalendarChips = useMemo(() => {
    const rezervateDates = new Set(claseDB.filter(c => rezervariMele.includes(c.id)).map(c => c.date))
    const wodLogDates = new Set(wodLogs.filter(l => l.logged_at).map(l => {
      const ld = new Date(l.logged_at)
      return `${ld.getFullYear()}-${String(ld.getMonth() + 1).padStart(2, '0')}-${String(ld.getDate()).padStart(2, '0')}`
    }))
    const yr = parseInt(actualToday.slice(0, 4))
    const isLeap = yr % 4 === 0 && (yr % 100 !== 0 || yr % 400 === 0)
    const totalDays = isLeap ? 366 : 365
    const yearStart = new Date(`${yr}-01-01T00:00:00`)
    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(yearStart)
      d.setDate(d.getDate() + i)
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return {
        ds,
        dayNum: d.getDate(),
        ziuaLitera: ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S'][d.getDay()],
        luna: ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()],
        eAzi: ds === actualToday,
        areRez: rezervateDates.has(ds),
        areWod: wodLogDates.has(ds),
      }
    })
  }, [actualToday, claseDB, rezervariMele, wodLogs])

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

  const recalcFeedUnreadRef = useRef(null)

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
      const d = new Date()
      const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      setDataAcasa(todayStr)
      saveProfile()
      fetchUserProfile()
      fetchPRuri()
      fetchCustomHeroWods()
      fetchWodLogs()
      fetchRezervari()
      fetchWaitlistMea()
      fetchClaseDB()
      fetchSettings()
      fetchWodZi()
      checkAdmin()
      fetchAbonamentMeu(true)
      fetchClasament()
      registerPushSubscription()
      setTimeout(() => {
        const container = homeCalScrollRef.current
        const chip = homeCalTodayRef.current
        if (container && chip) container.scrollLeft = Math.max(0, chip.offsetLeft - container.offsetWidth / 2 + chip.offsetWidth / 2)
      }, 150)
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

  useEffect(() => {
    screenRef.current = screen
    // body e singurul container de scroll (vezi index.css) - fara reset aici,
    // la schimbarea ecranului ramane cu offset-ul de scroll de pe ecranul
    // anterior, ceea ce face ca NavBar-ul (sticky) sa para ca "sare"/se
    // deplaseaza fata de continutul nou, mai ales intre ecrane cu inaltimi
    // foarte diferite.
    document.body.scrollTop = 0
    if (screen === 'clasament' && user) fetchClasament()
    if (screen === 'home') {
      const d = new Date()
      setDataAcasa(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)
      setTimeout(() => {
        const container = homeCalScrollRef.current
        const chip = homeCalTodayRef.current
        if (container && chip) container.scrollLeft = Math.max(0, chip.offsetLeft - container.offsetWidth / 2 + chip.offsetWidth / 2)
      }, 50)
    }
    if (screen === 'feed' && user) {
      setFeedUnread(0)
      supabase.from('feed_posts').select('id, member_id').order('created_at', { ascending: false }).limit(200)
        .then(({ data: posts }) => {
          const cnt = (posts || []).filter(p => p.member_id !== user.id).length
          localStorage.setItem('feed_seen_count_' + user.id, String(cnt))
        })
    }
  }, [screen]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) fetchWodZi(dataAcasa)
  }, [dataAcasa]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user || claseDB.length === 0) return
    const ids = claseDB.filter(c => c.date === dataAcasa).map(c => c.id)
    if (ids.length > 0) fetchRezervariZi(ids)
  }, [dataAcasa, claseDB]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!refreshZiTrigger || !user || claseDB.length === 0) return
    const ids = claseDB.filter(c => c.date === dataAcasa).map(c => c.id)
    if (ids.length > 0) fetchRezervariZi(ids)
  }, [refreshZiTrigger]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    const recalcFeedUnread = async () => {
      const { data: posts, error } = await supabase.from('feed_posts')
        .select('id, member_id').order('created_at', { ascending: false }).limit(200)
      if (error) { console.error('[Feed] query error:', error); return }
      const othersTotal = (posts || []).filter(p => p.member_id !== user.id).length
      const seenCount = parseInt(localStorage.getItem('feed_seen_count_' + user.id) || '0')
      const unread = Math.max(0, othersTotal - seenCount)
      setFeedUnread(unread)
    }
    recalcFeedUnreadRef.current = recalcFeedUnread
    recalcFeedUnread()
    const feedPoll = setInterval(recalcFeedUnread, 15000)

    const bookingsPoll = setInterval(() => {
      fetchRezervari()
      fetchWaitlistMea()
      setRefreshZiTrigger(t => t + 1)
    }, 8000)

    const channel = supabase.channel('realtime-app')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classes' }, () => {
        fetchClaseDB()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
        fetchRezervari(); fetchClaseDB(); fetchAbonamentMeu(); setRefreshZiTrigger(t => t + 1)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'class_waitlist' }, () => {
        fetchWaitlistMea(); fetchRezervari(); setRefreshZiTrigger(t => t + 1)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, () => {
        fetchAbonamentMeu()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wods' }, () => {
        fetchWodZi(dataAcasaRef.current)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wod_logs' }, () => {
        fetchWodLogs(); fetchClasament(clasamentDateRef.current)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, () => {
        fetchSettings()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feed_posts' }, () => {
        recalcFeedUnreadRef.current?.()
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feed_comments' }, () => {
        recalcFeedUnreadRef.current?.()
      })
      .subscribe()

    const myChannel = supabase.channel('my-bookings-' + user.id)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bookings', filter: `member_id=eq.${user.id}` },
        () => { fetchRezervari(); fetchAbonamentMeu(); setRefreshZiTrigger(t => t + 1) }
      )
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'subscriptions' },
        () => { fetchAbonamentMeu() }
      )
      .subscribe()

    const sessionsChannel = supabase.channel('member-sessions-' + user.id)
      .on('broadcast', { event: 'refresh' }, () => { fetchAbonamentMeu(); fetchRezervari(); fetchWaitlistMea(); setRefreshZiTrigger(t => t + 1) })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(myChannel)
      supabase.removeChannel(sessionsChannel)
      clearInterval(feedPoll)
      clearInterval(bookingsPoll)
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchAbonamentMeu()
        fetchRezervari()
        fetchClaseDB()
        fetchSettings()
        recalcFeedUnreadRef.current?.()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveProfile = async () => {
    const { data: existing } = await supabase.from('profiles').select('id, full_name').eq('id', user.id).maybeSingle()
    await supabase.from('profiles').upsert({
      id: user.id,
      email: user.email,
      full_name: existing?.full_name || user.user_metadata?.full_name || null,
    }, { onConflict: 'id' })
  }

  const fetchUserProfile = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    setUserProfile(data)
    const currentYear = new Date().getFullYear()
    const waiverInLS = localStorage.getItem(`waiver_${user?.id}_${currentYear}`) === '1'
    // Waiver expirat = nu a fost acceptat SAU a trecut mai mult de 1 an de la acceptare
    let waiverExpired = false
    if (data?.waiver_accepted_at) {
      const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      waiverExpired = new Date(data.waiver_accepted_at) < oneYearAgo
    } else {
      waiverExpired = data?.waiver_accepted === false
    }
    const needsOnboarding = !data?.gender || waiverExpired
    if (needsOnboarding && !waiverInLS) {
      setOnboardingFirstName(data?.first_name || '')
      setOnboardingLastName(data?.last_name || '')
      setOnboardingGender(data?.gender || '')
      setOnboardingBirthDate(data?.birth_date || '')
      setOnboardingWaiverAccepted(false)
      // Daca datele exista deja (reinnoire anuala), sare direct la pasul waiver
      const isRenewal = !!(data?.gender && data?.first_name && data?.birth_date && data?.waiver_accepted)
      setOnboardingStep(isRenewal ? 3 : 1)
      setShowOnboarding(true)
    }
  }

  const scrollChipToDate = (ds) => {
    setTimeout(() => {
      const container = homeCalScrollRef.current
      if (!container) return
      const year = new Date().getFullYear()
      const startOfYear = new Date(`${year}-01-01T00:00:00`)
      const totalDays = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365
      const idx = Math.round((new Date(ds + 'T00:00:00') - startOfYear) / 86400000)
      if (idx >= 0 && idx < totalDays) container.scrollLeft = Math.max(0, idx * 70 - container.offsetWidth / 2 + 32)
    }, 50)
  }

  const saveOnboarding = async () => {
    if (!onboardingWaiverAccepted) return
    const firstName = onboardingFirstName.trim()
    const lastName = onboardingLastName.trim()
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null
    // Folosim update (nu upsert) — rândul există deja, partial update garantat
    const { error } = await supabase.from('profiles').update({
      first_name: firstName || null, last_name: lastName || null,
      full_name: fullName, gender: onboardingGender || null,
      birth_date: onboardingBirthDate || null,
      waiver_accepted: true, waiver_accepted_at: new Date().toISOString(),
    }).eq('id', user.id)
    if (error) {
      // Fallback: salvează doar câmpurile de bază (fără coloane noi)
      await supabase.from('profiles').update({
        full_name: fullName, gender: onboardingGender || null,
      }).eq('id', user.id)
    }
    // Marchez acceptarea în localStorage (cheia include anul — se reinnoieste anual)
    localStorage.setItem(`waiver_${user.id}_${new Date().getFullYear()}`, '1')
    localStorage.removeItem(`waiver_${user.id}`) // sterge formatul vechi daca exista
    setUserProfile(prev => ({ ...prev, first_name: firstName, last_name: lastName, full_name: fullName, gender: onboardingGender, birth_date: onboardingBirthDate, waiver_accepted: true }))
    setShowOnboarding(false)
  }

  const saveMyProfile = async () => {
    const firstName = profileFirstName.trim()
    const lastName = profileLastName.trim()
    if (!firstName || !lastName || !profileBirthDate) { showToast('❌ Completează toate câmpurile obligatorii!'); return }
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null
    setProfileSaving(true)
    const { error } = await supabase.from('profiles').update({
      first_name: firstName, last_name: lastName, full_name: fullName,
      gender: profileGender || null, birth_date: profileBirthDate || null,
    }).eq('id', user.id)
    setProfileSaving(false)
    if (error) { showToast('❌ Eroare la salvare!'); console.error(error); return }
    setUserProfile(prev => ({ ...prev, first_name: firstName, last_name: lastName, full_name: fullName, gender: profileGender, birth_date: profileBirthDate }))
    showToast('✓ Profil actualizat!')
    setScreen(prevScreen || 'home')
  }

  const changeWeightUnit = async (unit) => {
    if (unit === userProfile?.weight_unit) return
    setUserProfile(prev => ({ ...prev, weight_unit: unit }))
    const { error } = await supabase.from('profiles').update({ weight_unit: unit }).eq('id', user.id)
    if (error) { showToast('❌ Eroare la salvare!'); console.error(error); return }
    showToast(`✓ Unitate schimbată în ${unit}`)
  }

  const changeMyPassword = async () => {
    if (profileNewPassword.length < 6) { showToast('❌ Parola trebuie să aibă minim 6 caractere!'); return }
    if (profileNewPassword !== profileNewPasswordConfirm) { showToast('❌ Parolele nu coincid!'); return }
    setPasswordSaving(true)
    const { error } = await supabase.auth.updateUser({ password: profileNewPassword })
    setPasswordSaving(false)
    if (error) { showToast('❌ Eroare la schimbarea parolei!'); console.error(error); return }
    setProfileNewPassword(''); setProfileNewPasswordConfirm('')
    showToast('✓ Parolă schimbată!')
  }

  const uploadAvatar = async (file) => {
    if (!file) return
    setAvatarUploading(true)
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg'
    const path = `${user.id}/avatar.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { showToast('❌ Eroare la upload!'); console.error(upErr); setAvatarUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    const urlFinal = `${publicUrl}?t=${Date.now()}`
    await supabase.from('profiles').upsert({ id: user.id, email: user.email, avatar_url: urlFinal }, { onConflict: 'id' })
    setUserProfile(prev => ({ ...prev, avatar_url: urlFinal }))
    showToast('✓ Poză de profil actualizată!')
    setAvatarUploading(false)
  }

  const checkAdmin = async () => {
    const { data } = await supabase.from('admins').select('id').eq('id', user.id)
    setIsAdmin(data && data.length > 0)
  }

  const fetchAbonamentMeu = async (isFirstLoad = false) => {
    if (isFirstLoad) setAbonamentLoading(true)
    const fetchActive = async () => {
      const _td = new Date()
      const todayStr = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`
      const { data, error } = await supabase.from('subscriptions')
        .select('*, subscription_plans(name, sessions)')
        .ilike('member_email', user.email.trim())
        .eq('is_active', true)
        .eq('queued', false)
        .lte('start_date', todayStr)
        .gte('end_date', todayStr)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) console.error('fetchAbonamentMeu error:', error)
      return data?.[0] || null
    }
    let abo = await fetchActive()
    if (abo) {
      const isExpired = new Date(abo.end_date + 'T23:59:59') < new Date()
      const isExhausted = abo.sessions_total != null && (abo.sessions_used || 0) >= abo.sessions_total
      if (isExpired || isExhausted) {
        const activatedId = await activateQueuedSubscription(user.email)
        if (activatedId) abo = await fetchActive()
      }
    } else {
      const activatedId = await activateQueuedSubscription(user.email)
      if (activatedId) abo = await fetchActive()
    }
    setAbonamentReal(abo)
    if (isFirstLoad) { setAbonamentLoading(false); setAbonamentInitialized(true) }
    else setAbonamentInitialized(true)
  }

  const fetchPRuri = async () => {
    const { data } = await supabase.from('personal_records').select('*').eq('member_id', user.id).order('recorded_at', { ascending: false })
    if (data) setPrDate(data)
  }

  const fetchCustomHeroWods = async () => {
    const { data } = await supabase.from('custom_hero_wods').select('*').eq('member_id', user.id).order('created_at', { ascending: true })
    if (data) setCustomHeroWods(data)
  }

  const saveNewHeroWod = async () => {
    const name = newHeroWodName.trim()
    if (!name) { showToast('❌ Dă un nume WOD-ului!'); return }
    if (!newHeroWodFormat.trim() && newHeroWodMiscari.length === 0) { showToast('❌ Adaugă formatul sau cel puțin o mișcare!'); return }
    const nameTaken = editHeroWodId
      ? customHeroWods.some(w => w.id !== editHeroWodId && w.name.toLowerCase() === name.toLowerCase())
      : !!heroWodsInfoAll[name]
    if (nameTaken) { showToast('❌ Există deja un Hero WOD cu acest nume!'); return }
    setNewHeroWodSaving(true)
    const payload = { name, format: newHeroWodFormat.trim() || null, movements: newHeroWodMiscari.join('\n') || null }
    if (editHeroWodId) {
      const { data, error } = await supabase.from('custom_hero_wods').update(payload).eq('id', editHeroWodId).select().single()
      if (error) { showToast('❌ Eroare!'); console.error(error) }
      else {
        setCustomHeroWods(prev => prev.map(w => w.id === editHeroWodId ? data : w))
        showToast('✓ Hero WOD actualizat!')
        setEditHeroWodId(null); setNewHeroWodName(''); setNewHeroWodFormat(''); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta('')
        setScreen('pr')
      }
    } else {
      const { data, error } = await supabase.from('custom_hero_wods').insert({ member_id: user.id, ...payload }).select().single()
      if (error) { showToast('❌ Eroare!'); console.error(error) }
      else {
        setCustomHeroWods(prev => [...prev, data])
        showToast('Hero WOD salvat! 💪')
        setMiscarePR(name); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrVarianta('RX')
        setNewHeroWodName(''); setNewHeroWodFormat(''); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta('')
        setPrevScreen('pr'); setScreen('logPR')
      }
    }
    setNewHeroWodSaving(false)
  }

  const fetchWodLogs = async () => {
    const { data } = await supabase.from('wod_logs').select('*, wods(name, type, duration)').eq('member_id', user.id).order('logged_at', { ascending: false })
    if (data) setWodLogs(data)
  }

  const fetchClaseDB = async () => {
    const year = new Date().getFullYear()
    const { data } = await supabase.from('classes').select('*')
      .gte('date', `${year}-01-01`)
      .lte('date', `${year + 1}-06-30`)
      .order('date', { ascending: true }).order('start_time', { ascending: true })
    setClaseDB(data || [])
    setClaseDBLoaded(true)
  }

  const fetchSettings = async () => {
    const { data } = await supabase.from('app_settings').select('key, value')
    if (data) {
      const cwh = data.find(s => s.key === 'cancel_window_hours')
      if (cwh) setCancelWindowHours(parseFloat(cwh.value) || 0)
    }
  }

  const fetchRezervari = async () => {
    const { data } = await supabase.from('bookings').select('class_id').eq('member_id', user.id)
    if (data) setRezervariMele(data.map(b => b.class_id))
    setRezervariIncarcate(true)
  }

  const fetchWaitlistMea = async () => {
    const { data } = await supabase.from('class_waitlist').select('class_id').eq('member_id', user.id)
    if (data) setWaitlistMea(data.map(w => w.class_id))
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
    setRezervariPerClasa(prev => ({ ...prev, ...result }))
  }

  const fetchClasament = async (dateStr) => {
    setClasamentLoading(true)
    const _td = new Date()
    const todayFallback = `${_td.getFullYear()}-${String(_td.getMonth()+1).padStart(2,'0')}-${String(_td.getDate()).padStart(2,'0')}`
    const targetDate = dateStr || clasamentDate || todayFallback
    const { data: wodZi } = await supabase.from('wods').select('id, type, duration, name').eq('date', targetDate).maybeSingle()
    setClasamentWodData(wodZi || null)
    let q = supabase.from('wod_logs').select('*').in('variant_level', ['OnRamp', 'Beginner', 'Intermediate', 'RX'])
    if (wodZi?.id) {
      q = q.eq('wod_id', wodZi.id)
    } else {
      q = q.gte('logged_at', targetDate + 'T00:00:00').lte('logged_at', targetDate + 'T23:59:59')
    }
    const { data: logs } = await q
    if (logs && logs.length > 0) {
      const ids = [...new Set(logs.map(l => l.member_id))]
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email, gender').in('id', ids)
      const map = {}
      if (profiles) profiles.forEach(p => { map[p.id] = p })
      setClasamentLogs(logs.map(l => ({ ...l, profile: map[l.member_id] })))
    } else {
      setClasamentLogs([])
    }
    setClasamentLoading(false)
  }

  const fetchWodZi = async (data_param) => {
    const _fwd = new Date()
    const data_str = data_param || dataAcasa || `${_fwd.getFullYear()}-${String(_fwd.getMonth()+1).padStart(2,'0')}-${String(_fwd.getDate()).padStart(2,'0')}`
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
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
    if (error) setAuthError(error.message)
    else setAuthError('✓ Verifică emailul pentru confirmare!')
    setAuthSubmitting(false)
  }

  const handleLogout = async () => { await supabase.auth.signOut() }
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const goTimer = () => { setPrevScreen(screen); setScreen('timer') }

  const stergeWodLog = async (id) => {
    const { error } = await supabase.from('wod_logs').delete().eq('id', id)
    if (error) { showToast('❌ Eroare la ștergere!'); console.error(error) }
    else { showToast('✓ Antrenament șters!'); await fetchWodLogs() }
  }

  const saveWodLog = async () => {
    if (editLogId) {
      setWodSaving(true)
      const liniiPrefix = [...(editLogHeader ? [editLogHeader] : []), ...editLogMiscari]
      const newPrefix = liniiPrefix.join('\n')
      const noteFull = [newPrefix || null, wodNote.trim() || null].filter(Boolean).join('\n---\n')
      const { error } = await supabase.from('wod_logs').update({
        result: wodResult.trim() || null,
        time_result: wodTime.trim() || null,
        notes: noteFull || null,
      }).eq('id', editLogId)
      if (error) { showToast('❌ Eroare!'); console.error(error) }
      else {
        showToast('✓ WOD actualizat!')
        await fetchWodLogs(); fetchClasament()
        setScreen('log'); setLogTab('jurnal')
        setEditLogId(null); setEditLogNotesPrefix(''); setEditLogHeader(''); setEditLogMiscari([])
        setWodResult(''); setWodTime(''); setWodNote('')
      }
      setWodSaving(false)
      return
    }
    const areContiut = wodResult.trim() || wodTime.trim() || wodMiscari.length > 0
    if (!areContiut) { showToast('❌ Completează cel puțin rezultatul, timpul sau o mișcare!'); return }
    setWodSaving(true)
    const cheieVarianta = variantaAleasa !== null ? VARIANTE_CONFIG[variantaAleasa].key : null
    const miscariWodZi = (cheieVarianta && wodZiData?.[cheieVarianta]) ? (wodMiscariCustom ?? wodZiData[cheieVarianta]) : []
    const miscariFinale = miscariWodZi.length > 0 ? miscariWodZi : wodMiscari
    const durStr = wodZiData ? formatWodDurata(wodZiData.duration) : ''
    const wodHeaderLine = wodZiData
      ? `${wodZiData.type}${durStr ? ' · ' + durStr : ''}${wodZiData.name ? ' — "' + wodZiData.name + '"' : ''}`
      : (variantaAleasa === null ? `${wodTip}${wodDurata ? ' · ' + wodDurata : ''}` : null)
    const miscariText = [...(wodHeaderLine ? [wodHeaderLine] : []), ...miscariFinale].join('\n')
    const noteFull = [miscariText || null, wodNote || null].filter(Boolean).join('\n---\n')
    const tipSalvat = variantaAleasa !== null ? VARIANTE_CONFIG[variantaAleasa].nivel : `${wodTip}${wodDurata ? ' · ' + wodDurata : ''}`
    const { error } = await supabase.from('wod_logs').insert({
      member_id: user.id, wod_id: wodZiData?.id || null,
      variant_level: tipSalvat,
      result: wodResult || null, time_result: wodTime || null, notes: noteFull || null,
    })
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else {
      showToast('WOD salvat! 🎉'); await fetchWodLogs(); fetchClasament()
      if (prevScreen === 'log') { setScreen('log'); setLogTab('jurnal') }
      else { setScreen('home'); setWodDeschis(false) }
      setVariantaAleasa(null); setWodMiscariCustom(null)
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
    const isBenchmark = miscarePR in heroWodsInfoAll
    const isCardio = CARDIO_MISCARI.includes(miscarePR)
    const isGym = ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump'].includes(miscarePR)
    const isHold = ['Handstand Hold','L-sit Hold'].includes(miscarePR)
    let insertData = { movement: miscarePR, notes: prNote || null }
    if (!editPrId) insertData.member_id = user.id
    if (isBenchmark) { insertData.value = prTimp ? timeToSec(prTimp) : null; insertData.unit = 'timp'; insertData.notes = (prVarianta ? prVarianta + ' | ' : '') + (prNote || '') }
    else if (isCardio) { insertData.value = prDistanta ? parseFloat(prDistanta) : null; insertData.unit = CARDIO_CU_CALORII.includes(miscarePR) ? prCardioUnit : 'm'; insertData.time_result = prTimp.trim() || null }
    else if (isGym) { insertData.reps = prReps ? parseInt(prReps) : null; insertData.unit = 'reps' }
    else if (isHold) { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.unit = 'sec' }
    else { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.reps = prReps ? parseInt(prReps) : null; insertData.unit = userProfile?.weight_unit || 'kg' }
    const { error } = editPrId
      ? await supabase.from('personal_records').update(insertData).eq('id', editPrId)
      : await supabase.from('personal_records').insert(insertData)
    if (error) { showToast('❌ Eroare!'); console.error(error) }
    else {
      showToast(editPrId ? '✓ PR actualizat!' : 'PR salvat! 🏆')
      await fetchPRuri(); setScreen('pr')
      setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrVarianta('RX')
      setEditPrId(null); setLogPentruPR(null)
    }
    setPrSaving(false)
  }

  const startEditPR = (record, movement) => {
    const isBenchmark = movement in heroWodsInfoAll
    const isCardio = CARDIO_MISCARI.includes(movement)
    const isGym = ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump'].includes(movement)
    const isHold = ['Handstand Hold','L-sit Hold'].includes(movement)
    setMiscarePR(movement)
    setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrVarianta('RX')
    if (isBenchmark) {
      setPrTimp(record.value != null ? secToTime(parseFloat(record.value)) : '')
      const varianteValide = ['RX', 'Intermediate', 'Beginner', 'OnRamp']
      const [poss, ...rest] = (record.notes || '').split(' | ')
      if (varianteValide.includes(poss)) { setPrVarianta(poss); setPrNote(rest.join(' | ')) }
      else { setPrNote(record.notes || '') }
    } else if (isCardio) {
      setPrDistanta(record.value != null ? String(record.value) : ''); setPrCardioUnit(record.unit === 'cal' ? 'cal' : 'm')
      setPrTimp(record.time_result || ''); setPrNote(record.notes || '')
    } else if (isGym) {
      setPrReps(record.reps != null ? String(record.reps) : ''); setPrNote(record.notes || '')
    } else if (isHold) {
      setPrValoare(record.value != null ? String(record.value) : ''); setPrNote(record.notes || '')
    } else {
      const val = record.value != null ? convertWeight(parseFloat(record.value), record.unit, userProfile?.weight_unit || 'kg') : null
      setPrValoare(val != null ? String(val) : ''); setPrReps(record.reps != null ? String(record.reps) : ''); setPrNote(record.notes || '')
    }
    setEditPrId(record.id); setLogPentruPR(null)
    setPrevScreen('pr'); setScreen('logPR')
  }

  const toggleWaitlist = async (clasaId) => {
    const peWaitlist = waitlistMea.includes(clasaId)
    if (peWaitlist) {
      await supabase.from('class_waitlist').delete().eq('class_id', clasaId).eq('member_id', user.id)
      setWaitlistMea(prev => prev.filter(id => id !== clasaId))
      showToast('✓ Ai ieșit din lista de așteptare')
    } else {
      const { error } = await supabase.from('class_waitlist').insert({ class_id: clasaId, member_id: user.id, member_email: user.email.toLowerCase() })
      if (error) {
        if (error.code === '23505') { setWaitlistMea(prev => prev.includes(clasaId) ? prev : [...prev, clasaId]); showToast('✓ Ești deja pe lista de așteptare!'); return }
        showToast('❌ ' + (error.message || error.code || 'Eroare')); console.error(error); return
      }
      setWaitlistMea(prev => [...prev, clasaId])
      showToast('✓ Ești pe lista de așteptare!')
    }
  }

  const sedinteLimitate = abonamentReal?.sessions_total != null
  const sedinteRamase = sedinteLimitate ? Math.max(0, (abonamentReal.sessions_total) - (abonamentReal.sessions_used || 0)) : null

  const toggleRezervare = async (clasaId) => {
    const esteRezervat = rezervariMele.includes(clasaId)
    if (!esteRezervat && !isAdmin) {
      const clasaPtRez = claseDB.find(c => c.id === clasaId)
      if (!clasaPtRez || new Date(`${clasaPtRez.date}T${clasaPtRez.start_time}`) <= new Date()) {
        showToast('❌ Clasa a început deja!')
        return
      }
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
        await toggleWaitlist(clasaId)
        return
      }
    }
    if (esteRezervat && !isAdmin) {
      const clasa = claseDB.find(c => c.id === clasaId)
      if (!clasa) {
        showToast('❌ Nu poți anula această clasă!')
        return
      }
      const clasaEnd = new Date(`${clasa.date}T${clasa.end_time}`)
      if (clasaEnd <= new Date()) {
        showToast('❌ Clasa s-a terminat, nu mai poți anula!')
        return
      }
      const clasaStart = new Date(`${clasa.date}T${clasa.start_time}`)
      const hoursUntil = (clasaStart - new Date()) / 3600000
      if (hoursUntil < cancelWindowHours) {
        const h = cancelWindowHours % 1 === 0 ? `${cancelWindowHours}h` : `${cancelWindowHours * 60} minute`
        showToast(`❌ Nu poți anula cu mai puțin de ${h} înainte de clasă!`)
        return
      }
    }
    if (esteRezervat) {
      const { error: delErr } = await supabase.from('bookings').delete().eq('member_id', user.id).eq('class_id', clasaId)
      if (delErr) { showToast('❌ Eroare la anularea rezervării!'); console.error(delErr); return }
      setRezervariMele(prev => prev.filter(id => id !== clasaId))
      if (!isAdmin && sedinteLimitate && abonamentReal?.id) {
        const newUsed = await adjustSessionsUsedAtomic(abonamentReal.id, -1)
        if (newUsed != null) setAbonamentReal(prev => prev ? { ...prev, sessions_used: newUsed } : prev)
      }
      supabase.from('class_reminders').delete().eq('class_id', clasaId).eq('member_email', user.email.toLowerCase())
      checkAndBookFromWaitlist(clasaId)
      showToast('✓ Rezervare anulată')
    } else {
      const { error: insErr } = await supabase.from('bookings').insert({ member_id: user.id, class_id: clasaId })
      if (insErr) { showToast('❌ Eroare la rezervare!'); console.error(insErr); return }
      setRezervariMele(prev => [...prev, clasaId])
      if (!isAdmin && sedinteLimitate && abonamentReal?.id) {
        const newUsed = await adjustSessionsUsedAtomic(abonamentReal.id, +1, { max: abonamentReal.sessions_total })
        if (newUsed != null) setAbonamentReal(prev => prev ? { ...prev, sessions_used: newUsed } : prev)
      }
      const cls = claseDB.find(c => c.id === clasaId)
      if (cls?.date && cls?.start_time) {
        const remindAt = new Date(new Date(`${cls.date}T${cls.start_time}`).getTime() - 3600000)
        if (remindAt > new Date())
          supabase.from('class_reminders').upsert({ class_id: clasaId, member_email: user.email.toLowerCase(), remind_at: remindAt.toISOString(), sent: false }, { onConflict: 'class_id,member_email' })
      }
      showToast('✓ Loc rezervat! Te așteptăm!')
    }
    await fetchClaseDB()
    await fetchAbonamentMeu()
  }

  const _azi = new Date()
  const aziStr = `${_azi.getFullYear()}-${String(_azi.getMonth()+1).padStart(2,'0')}-${String(_azi.getDate()).padStart(2,'0')}`

  const VARIANTE_CONFIG = [
    { nivel: 'RX', culoare: '#C45000', bg: '#FFF3EC', emoji: '🟠', key: 'movements_rx' },
    { nivel: 'Intermediate', culoare: '#633806', bg: '#FAEEDA', emoji: '🟡', key: 'movements_intermediate' },
    { nivel: 'Beginner', culoare: '#1a1a1a', bg: '#f0f0f0', emoji: '🟢', key: 'movements_beginner' },
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

  // Polling 5s doar cand membrul nu are abonament activ (plasat dupa abonamentActiv pentru a evita TDZ)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!user || isAdmin || !abonamentInitialized || abonamentActiv) return
    const interval = setInterval(() => fetchAbonamentMeu(), 5000)
    return () => clearInterval(interval)
  }, [user, isAdmin, abonamentInitialized, abonamentActiv]) // eslint-disable-line react-hooks/exhaustive-deps

  if (resetMode) return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 'max(20px, env(safe-area-inset-top))', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingLeft: '20px', paddingRight: '20px', boxSizing: 'border-box', boxShadow: '0 60px 0 0 #111' }}>
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
    <div className="app-frame" style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100%', background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏋️</div>
        <div style={{ fontSize: '14px', color: '#888' }}>Se încarcă...</div>
      </div>
    </div>
  )

  if (!user) return (
    <div style={{ position: 'fixed', inset: 0, background: '#111', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 'max(20px, env(safe-area-inset-top))', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingLeft: '20px', paddingRight: '20px', boxSizing: 'border-box', overflowY: 'auto', boxShadow: '0 60px 0 0 #111' }}>
      {installDismissed && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', boxShadow: '0 60px 0 0 rgba(0,0,0,0.75)' }} onClick={() => setInstallDismissed(false)}>
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
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{s.icon}</div>
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
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{s.icon}</div>
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
                style={{ width: '16px', height: '16px', accentColor: '#1a1a1a', cursor: 'pointer' }} />
              <span style={{ fontSize: '13px', color: '#aaa' }}>Remember me</span>
            </label>
            <span onClick={handleForgotPassword} style={{ fontSize: '13px', color: '#C8FF00', cursor: 'pointer', fontWeight: '500' }}>
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
          <span onClick={() => { setAuthScreen(authScreen === 'login' ? 'register' : 'login'); setAuthError('') }} style={{ color: '#C8FF00', fontWeight: '600', cursor: 'pointer' }}>
            {authScreen === 'login' ? 'Înregistrează-te' : 'Intră în cont'}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app-frame" style={{ maxWidth: '430px', width: '100%', margin: '0 auto', minHeight: '100%', background: '#f5f5f5', fontFamily: 'system-ui', position: 'relative', boxShadow: 'none', display: 'flex', flexDirection: 'column' }}>

      <div style={{ position: 'sticky', top: 0, zIndex: 90, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 'max(10px, env(safe-area-inset-top))', paddingLeft: '16px', paddingRight: '16px', paddingBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/forge.png" alt="Forge" style={{ height: '32px', width: '32px', borderRadius: '8px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '16px', letterSpacing: '1px' }}>FORGE</span>
          <span onClick={handleDebugLogoTap} style={{ color: '#444', fontSize: '10px', padding: '8px', margin: '-8px' }}>v2</span>
        </div>
        <span style={{ fontSize: '14px', fontWeight: '600' }}>
          <span style={{ color: '#fff' }}>CrossFit </span>
          <span style={{ color: '#C8FF00' }}>C15</span>
        </span>
      </div>

      {!isAdmin && abonamentInitialized && claseDBLoaded && rezervariIncarcate && !abonamentActiv && !showOnboarding && screen !== 'abonament' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxShadow: '0 60px 0 0 rgba(0,0,0,0.65)' }}>
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
            <button onClick={() => fetchAbonamentMeu()} style={{ width: '100%', padding: '13px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }}>
              Reîncarcă
            </button>
            <button onClick={() => setScreen('abonament')} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#555', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', marginBottom: '10px' }}>
              Vezi abonamentul →
            </button>
            <button onClick={handleLogout} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#aaa', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '12px', cursor: 'pointer' }}>
              Deconectează-te
            </button>
          </div>
        </div>
      )}

      {screen === 'home' && (() => {
        const selData = new Date(dataAcasa + 'T00:00:00')
        const claseZi = claseDB.filter(c => c.date === dataAcasa).sort((a,b) => (a.start_time || '').localeCompare(b.start_time || ''))
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
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ textAlign: 'left' }}>
                    <div onClick={() => { setCalPickerYear(selData.getFullYear()); setCalPickerMonth(selData.getMonth()); setShowCalPicker(true) }}
                      style={{ fontSize: '24px', fontWeight: '900', color: '#1a1a1a', letterSpacing: '-0.5px', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {selData.getDate()} {selData.toLocaleDateString('ro-RO', { month: 'long' }).toUpperCase()}
                      <span style={{ fontSize: '14px', color: '#bbb' }}>▾</span>
                    </div>
                    {!esteAzi && (
                      <div onClick={() => { setDataAcasa(actualToday); scrollChipToDate(actualToday) }}
                        style={{ fontSize: '10px', color: '#1a1a1a', fontWeight: '600', cursor: 'pointer', marginTop: '2px' }}>← Înapoi la azi</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: '#1a1a1a', lineHeight: 1 }}>{wodLogs.length}</div>
                    <div style={{ fontSize: '9px', color: '#aaa', fontWeight: '700', letterSpacing: '0.1em', marginTop: '1px' }}>SESIUNI</div>
                  </div>
                  <div onClick={() => {
                    setProfileFirstName(userProfile?.first_name || ''); setProfileLastName(userProfile?.last_name || '')
                    setProfileGender(userProfile?.gender || ''); setProfileBirthDate(userProfile?.birth_date || '')
                    setPrevScreen('home'); setScreen('profile')
                  }}
                    style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
                    {avatarUploading ? (
                      <span style={{ fontSize: '10px', color: '#C8FF00', animation: 'spin 1s linear infinite' }}>⏳</span>
                    ) : userProfile?.avatar_url ? (
                      <img src={userProfile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '13px', fontWeight: '800', color: '#C8FF00', letterSpacing: '-0.5px' }}>{initiale}</span>
                    )}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: '14px', color: '#888', marginBottom: '18px' }}>Hey {prenume}, let's get after it today.</p>

            </div>

            {/* ── Clase disponibile ── */}
            <div style={{ background: '#fff', marginBottom: '10px' }}>
              <div style={{ padding: '14px 20px 10px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#1a1a1a', letterSpacing: '0.06em', marginBottom: '12px' }}>CLASE DISPONIBILE</div>
                {/* Chip scroll: tot anul curent (1 Ian – 31 Dec) */}
                <div ref={homeCalScrollRef} style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
                  {homeCalendarChips.map(({ ds, dayNum, ziuaLitera, luna, eAzi, areRez, areWod }) => {
                    const selectat = ds === dataAcasa
                    return (
                      <div key={ds}
                        ref={eAzi ? homeCalTodayRef : null}
                        onClick={() => setDataAcasa(ds)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '64px', height: '64px', borderRadius: '16px', flexShrink: 0, cursor: 'pointer',
                          background: selectat ? '#1a1a1a' : 'transparent',
                          border: selectat ? 'none' : eAzi ? '2px solid #1a1a1a' : areRez ? '2px solid #1a1a1a' : '1px solid #e8e8e8' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: selectat ? '#C8FF00' : '#bbb', letterSpacing: '0.04em' }}>{ziuaLitera}</span>
                        <span style={{ fontSize: '20px', fontWeight: selectat || eAzi ? '900' : '500', color: selectat ? '#C8FF00' : '#1a1a1a', lineHeight: 1 }}>{dayNum}</span>
                        <span style={{ fontSize: '10px', color: selectat ? '#C8FF00' : '#aaa', fontWeight: '500' }}>{luna}</span>
                        <span style={{ fontSize: '9px', lineHeight: 1, color: '#C8FF00', visibility: (areWod || areRez) ? 'visible' : 'hidden' }}>{areRez ? '✓' : '⚡'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ padding: '0 20px 14px' }}>
                <div onClick={() => setClaseHomeDeschis(v => !v)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', background: '#fafafa' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a' }}>
                    {claseZi.length === 0 ? `Nicio clasă ${esteAzi ? 'azi' : 'în această zi'}` : `${claseZi.length} clas${claseZi.length === 1 ? 'ă' : 'e'} disponibil${claseZi.length === 1 ? 'ă' : 'e'}`}
                  </span>
                  <span style={{ fontSize: '11px', color: '#888', display: 'inline-block', transform: claseHomeDeschis ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                </div>
              </div>
              {claseHomeDeschis && (
              <div style={{ padding: '0 16px 16px' }}>
                {claseZi.length === 0
                  ? <div style={{ padding: '8px 4px', color: '#aaa', fontSize: '13px' }}>Nicio clasă {esteAzi ? 'azi' : 'în această zi'}</div>
                  : claseZi.map(c => {
                      const rezervat = rezervariMele.includes(c.id)
                      const nrRez = rezervariPerClasa[c.id]?.count || 0
                      const plin = !rezervat && nrRez >= c.max_spots
                      const peWaitlist = !rezervat && waitlistMea.includes(c.id)
                      const blocat = !rezervat && !isAdmin && sedinteLimitate && sedinteRamase <= 0
                      const deschis = clasaHomeSelectata === c.id
                      const esteInTrecut = new Date(`${c.date}T${c.start_time}`) <= new Date()
                      return (
                        <div key={c.id}
                          onClick={() => setClasaHomeSelectata(deschis ? null : c.id)}
                          style={{ borderRadius: '14px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer',
                            background: rezervat ? '#f0f0f0' : c.color ? c.color + '33' : deschis ? '#f5f5f5' : '#fafafa',
                            border: rezervat ? '2px solid #1a1a1a' : c.color ? `2px solid ${c.color}` : deschis ? '2px solid #1a1a1a' : '1px solid #ececec' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '17px', fontWeight: '800', color: rezervat ? '#1a1a1a' : '#1a1a1a', letterSpacing: '-0.3px' }}>{c.start_time?.slice(0,5)}</span>
                              <span style={{ fontSize: '12px', color: '#888', marginLeft: '8px' }}>{c.end_time?.slice(0,5)}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              {rezervat
                                ? <span style={{ fontSize: '11px', background: '#C8FF00', color: '#111', padding: '2px 8px', borderRadius: '20px', fontWeight: '700' }}>✓ Rezervat</span>
                                : peWaitlist
                                ? <span style={{ fontSize: '11px', color: '#EF9F27', fontWeight: '600' }}>⏳ Așteptare</span>
                              : plin
                                ? <span style={{ fontSize: '11px', color: '#C62828', fontWeight: '600' }}>🔒 Plin</span>
                                : <span style={{ fontSize: '11px', color: '#888' }}>{nrRez}/{c.max_spots} locuri</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: '12px', color: rezervat ? '#1a1a1a' : '#888', marginTop: '3px' }}>{c.name || 'CrossFit WOD'} · {c.coach}</div>
                          {deschis && (
                            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${rezervat ? '#b8eec0' : '#e0e0e0'}` }}
                              onClick={e => e.stopPropagation()}>
                              {(() => {
                                const membri = rezervariPerClasa[c.id]?.membri || []
                                const cnt = rezervariPerClasa[c.id]?.count ?? nrRez
                                return membri.length > 0 ? (
                                  <div style={{ marginBottom: '10px' }}>
                                    <div style={{ fontSize: '10px', color: '#aaa', fontWeight: '700', letterSpacing: '0.06em', marginBottom: '6px' }}>PARTICIPANȚI ({cnt}/{c.max_spots})</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                      {membri.map((name, mi) => (
                                        <span key={mi} style={{ fontSize: '11px', background: rezervat ? '#f0f0f0' : '#f0f0f0', color: rezervat ? '#1a1a1a' : '#555', padding: '3px 8px', borderRadius: '20px', fontWeight: '500' }}>{name}</span>
                                      ))}
                                    </div>
                                  </div>
                                ) : cnt > 0 ? (
                                  <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '10px' }}>{cnt} participant{cnt !== 1 ? 'ți' : ''}</div>
                                ) : null
                              })()}
                              {!esteInTrecut ? (
                                rezervat ? (
                                  <button onClick={() => { toggleRezervare(c.id); setClasaHomeSelectata(null) }}
                                    style={{ width: '100%', padding: '9px', background: 'transparent', color: '#C62828', border: '1px solid #F7C1C1', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
                                    Anulează rezervarea
                                  </button>
                                ) : peWaitlist ? (
                                  <button onClick={() => toggleWaitlist(c.id)}
                                    style={{ width: '100%', padding: '9px', background: '#FFF8EC', color: '#B86E00', border: '1px solid #FCDFA0', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                                    ⏳ Pe lista de așteptare · Renunță
                                  </button>
                                ) : blocat ? (
                                  <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', padding: '6px' }}>Ședințe epuizate</div>
                                ) : plin ? (
                                  <button onClick={() => toggleWaitlist(c.id)}
                                    style={{ width: '100%', padding: '9px', background: '#f5f5f5', color: '#555', border: '1px solid #e0e0e0', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                                    Intră pe lista de așteptare
                                  </button>
                                ) : (
                                  <button onClick={() => { toggleRezervare(c.id); setClasaHomeSelectata(null) }}
                                    style={{ width: '100%', padding: '9px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                                    Rezervă locul
                                  </button>
                                )
                              ) : (
                                <div style={{ textAlign: 'center', fontSize: '11px', color: '#bbb', padding: '4px' }}>Clasă trecută</div>
                              )}
                            </div>
                          )}
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
                  <div style={{ display: 'inline-block', fontSize: '10px', color: '#C8FF00', fontWeight: '800', letterSpacing: '0.12em', marginBottom: '6px', background: '#1a1a1a', padding: '3px 10px', borderRadius: '6px' }}>WORKOUT OF THE DAY</div>
                  <div style={{ fontSize: '17px', fontWeight: '700', color: '#1a1a1a' }}>
                    {wodZiData ? (wodZiData.name ? `"${wodZiData.name}"` : `${wodZiData.type} ${formatWodDurata(wodZiData.duration)}`) : 'Niciun WOD azi'}
                  </div>
                  {wodZiData?.name && <div style={{ fontSize: '12px', color: '#888', marginTop: '1px' }}>{wodZiData.type} {formatWodDurata(wodZiData.duration)}</div>}
                  {!wodDeschis && wodZiData && (wodZiData.movements_rx || []).length > 0 && (
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{(wodZiData.movements_rx || []).join(' · ')}</div>
                  )}
                </div>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: wodDeschis ? '#1a1a1a' : '#f0f0f0', color: wodDeschis ? '#C8FF00' : '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                  {wodDeschis ? '−' : '+'}
                </div>
              </div>
              {wodDeschis && wodZiData && (
                <div style={{ marginTop: '16px', borderTop: '1px solid #f0f0f0', paddingTop: '16px' }}>
                  {VARIANTE_CONFIG.map((v, i) => {
                    const miscari = wodZiData[v.key] || []
                    return (
                      <div key={i} onClick={() => { setVariantaAleasa(variantaAleasa === i ? null : i); setWodMiscariCustom(null) }}
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
                            <div>
                              {miscari.map((m, mi) => (
                                <div key={mi} style={{ padding: '7px 10px', background: '#f0f0f0', borderRadius: '8px', marginBottom: '6px' }}>
                                  <span style={{ fontSize: '13px', color: '#1a1a1a' }}>• {m}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                  <button onClick={() => { setEditLogId(null); setPrevScreen('home'); setScreen('logWOD') }} disabled={variantaAleasa === null}
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
                    <div style={{ fontSize: '22px', marginTop: '4px' }}>💳</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {sessTotal ? (
                      <div style={{ fontSize: '18px', fontWeight: '800', lineHeight: 1 }}>
                        <span style={{ color: '#1a1a1a' }}>{sessUsed}</span>
                        <span style={{ color: '#ddd', fontWeight: '400', fontSize: '16px' }}> / </span>
                        <span style={{ color: '#1a1a1a' }}>{sessTotal}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: '700' }}>Nelimitat</div>
                    )}
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{zileRamase} zile rămase</div>
                  </div>
                </div>
                {sessTotal && (
                  <div style={{ height: '7px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progres * 100}%`, background: progres >= 1 ? '#E24B4A' : progres > 0.8 ? '#BA7517' : '#1a1a1a', borderRadius: '4px' }} />
                  </div>
                )}
              </div>
            )}

            {/* ── Timer ── */}
            <div style={{ background: '#fff', marginBottom: '10px' }}>
              <button onClick={goTimer} style={{ width: '100%', padding: '14px 20px', background: 'none', border: 'none', fontSize: '14px', fontWeight: '600', color: '#1a1a1a', cursor: 'pointer', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span>⏱️</span> Pornește Timer
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
            <div style={{ background: !abonamentInceput ? '#f0f0f0' : '#FCEBEB', borderRadius: '14px', padding: '20px', marginBottom: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '10px' }}>
                {!abonamentInceput ? '📅' : sedinteLimitate && sedinteRamase === 0 ? '🏁' : '🔒'}
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: !abonamentInceput ? '#1a1a1a' : '#791F1F', marginBottom: '6px' }}>
                {!abonamentInceput ? 'Abonament programat'
                  : sedinteLimitate && sedinteRamase === 0 ? 'Ședințe epuizate'
                  : 'Abonament expirat'}
              </div>
              <div style={{ fontSize: '12px', color: !abonamentInceput ? '#1a1a1a' : '#A32D2D' }}>
                {!abonamentInceput
                  ? `Începe pe ${new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}.`
                  : sedinteLimitate && sedinteRamase === 0
                    ? 'Ai consumat toate ședințele. Contactează coachul pentru un abonament nou.'
                    : 'Contactează coachul pentru reînnoire.'}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #1a1a1a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>Plan activ</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#1a1a1a' }}>{abonamentReal.subscription_plans?.name}</div>
                </div>
                <span style={{ background: '#f0f0f0', color: '#1a1a1a', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>✓ Activ</span>
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
          <div style={{ background: '#f0f0f0', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#1a1a1a' }}>Pentru reînnoire sau întrebări contactează coachul.</div>
          </div>

          {/* Rezervările mele */}
          {(() => {
            const _now = new Date()
            const viitoare = claseDB.filter(c => rezervariMele.includes(c.id) && new Date(`${c.date}T${c.end_time}`) > _now)
              .sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '').localeCompare(b.start_time || ''))
            const trecute = claseDB.filter(c => rezervariMele.includes(c.id) && new Date(`${c.date}T${c.end_time}`) <= _now)
              .sort((a, b) => b.date.localeCompare(a.date) || (b.start_time || '').localeCompare(a.start_time || ''))
              .slice(0, 10)
            if (viitoare.length === 0 && trecute.length === 0) return null
            return (
              <div style={{ marginTop: '20px' }}>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#1a1a1a', letterSpacing: '0.06em', marginBottom: '12px' }}>REZERVĂRILE MELE</div>
                {viitoare.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#1a1a1a', fontWeight: '700', letterSpacing: '0.06em', marginBottom: '8px' }}>URMEAZĂ</div>
                    {viitoare.map(c => (
                      <div key={c.id} style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', borderLeft: '4px solid #1a1a1a' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a' }}>{c.name || 'CrossFit WOD'}</div>
                            <div style={{ fontSize: '11px', color: '#1a1a1a', marginTop: '3px' }}>
                              📅 {new Date(c.date + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' })} · {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#1a1a1a' }}>👤 {c.coach}</div>
                          </div>
                          <button onClick={() => toggleRezervare(c.id)}
                            style={{ background: 'transparent', color: '#C62828', border: '1px solid #F7C1C1', borderRadius: '8px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                            Anulează
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {trecute.length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#aaa', fontWeight: '700', letterSpacing: '0.06em', marginBottom: '8px' }}>ISTORIC</div>
                    {trecute.map(c => (
                      <div key={c.id} style={{ background: '#fafafa', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', borderLeft: '4px solid #e0e0e0' }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#aaa' }}>{c.name || 'CrossFit WOD'}</div>
                        <div style={{ fontSize: '11px', color: '#ccc', marginTop: '3px' }}>
                          {new Date(c.date + 'T00:00:00').toLocaleDateString('ro-RO', { weekday: 'short', day: 'numeric', month: 'short' })} · {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)} · {c.coach}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {screen === 'log' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', textTransform: 'uppercase', letterSpacing: '-0.5px', marginBottom: '16px' }}>Log</h1>
          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: '12px', padding: '3px', marginBottom: '20px' }}>
            {[{ id: 'nou', lbl: '+ Logare nouă' }, { id: 'jurnal', lbl: '📓 Jurnal' }].map(t => (
              <div key={t.id} onClick={() => setLogTab(t.id)}
                style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: '10px', fontSize: '13px', fontWeight: logTab === t.id ? '700' : '400', background: logTab === t.id ? '#fff' : 'transparent', color: logTab === t.id ? '#1a1a1a' : '#888', cursor: 'pointer', boxShadow: logTab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
                {t.lbl}
              </div>
            ))}
          </div>

          {logTab === 'nou' && (
            <>
              <p style={{ fontSize: '13px', color: '#888', marginBottom: '14px' }}>Câte mișcări are antrenamentul tău?</p>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div onClick={() => { setEditPrId(null); setLogPentruPR(null); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrevScreen('log'); setScreen('logPR') }}
                  style={{ flex: 1, background: '#f0f0f0', borderRadius: '16px', padding: '24px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '32px' }}>🏋️</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a', textAlign: 'center' }}>Mișcare Unică</span>
                </div>
                <div onClick={() => { setVariantaAleasa(null); setEditLogId(null); setPrevScreen('log'); setScreen('logWOD') }}
                  style={{ flex: 1, background: '#FFF8E6', borderRadius: '16px', padding: '24px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <span style={{ fontSize: '32px' }}>🔥</span>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#7D5A00', textAlign: 'center' }}>Mișcări Multiple</span>
                </div>
              </div>
            </>
          )}

          {logTab === 'jurnal' && (
            <JurnalList logs={wodLogs} onDelete={stergeWodLog} onEdit={(log) => {
              const WOD_TYPES = ['AMRAP','For Time','EMOM','Tabata','Chipper','Ladder','Strength','Partner WOD']
              const parts = (log.notes || '').split('\n---\n')
              const prefix = parts.length > 1 ? parts[0] : (parts[0] || '')
              const linii = prefix.split('\n').filter(Boolean)
              const primaEsteHeader = linii.length > 0 && WOD_TYPES.some(t => linii[0].startsWith(t))
              setEditLogId(log.id)
              setEditLogHeader(primaEsteHeader ? linii[0] : '')
              setEditLogMiscari(linii.slice(primaEsteHeader ? 1 : 0))
              setEditLogMiscareCurenta('')
              setWodResult(log.result || '')
              setWodTime(log.time_result || '')
              setWodNote(parts.length > 1 ? parts[1] : '')
              setPrevScreen('log')
              setScreen('logWOD')
            }} />
          )}

        </div>
      )}

      {screen === 'logWOD' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => { if (editLogId) { setEditLogId(null); setEditLogNotesPrefix(''); setEditLogHeader(''); setEditLogMiscari([]); setWodResult(''); setWodTime(''); setWodNote('') } setScreen(prevScreen || 'home') }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>{editLogId ? 'Editează WOD' : 'Log WOD'}</h1>
          </div>

          {editLogId ? (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              {editLogHeader ? (
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#1a1a1a', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{editLogHeader}</div>
              ) : null}
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px', fontWeight: '600' }}>MIȘCĂRI <span style={{ fontWeight: '400', fontSize: '10px' }}>(trage ☰ pentru reordonare)</span></div>
              <SortableList
                items={editLogMiscari}
                onReorder={setEditLogMiscari}
                onRemove={(i) => setEditLogMiscari(prev => prev.filter((_, j) => j !== i))}
              />
              <MiscareQuickAdd value={editLogMiscareCurenta} onChange={setEditLogMiscareCurenta}
                onAdd={(v) => { setEditLogMiscari(prev => [...prev, v]); setEditLogMiscareCurenta('') }}
                placeholder={userProfile?.weight_unit === 'lbs' ? 'ex: 21 Thrusters @ 95lbs' : 'ex: 21 Thrusters @ 43kg'} />
            </div>
          ) : (
            <>
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
                        style={{ padding: '6px 12px', borderRadius: '20px', border: wodTip === t ? '2px solid #1a1a1a' : '1px solid #e0e0e0', background: wodTip === t ? '#f0f0f0' : '#fafafa', color: wodTip === t ? '#1a1a1a' : '#555', fontSize: '12px', fontWeight: wodTip === t ? '700' : '400', cursor: 'pointer' }}>
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
                const miscariAfisate = wodMiscariCustom ?? miscariWod
                return (
                  <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px', fontWeight: '600' }}>{dataAcasa === actualToday ? 'ANTRENAMENTUL DE AZI' : `WOD — ${new Date(dataAcasa + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}`}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a', marginBottom: '10px' }}>
                      {wodZiData.type} {formatWodDurata(wodZiData.duration)}
                    </div>
                    {miscariAfisate.length > 0 ? (
                      <SortableList
                        items={miscariAfisate}
                        onReorder={setWodMiscariCustom}
                      />
                    ) : (
                      <div style={{ fontSize: '13px', color: '#aaa' }}>Nicio mișcare definită pentru această variantă.</div>
                    )}
                  </div>
                )
              })() : (
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '600' }}>MIȘCĂRI <span style={{ fontWeight: '400', fontSize: '10px' }}>(trage ☰ pentru reordonare)</span></div>
                  <SortableList
                    items={wodMiscari}
                    onReorder={setWodMiscari}
                    onRemove={(i) => setWodMiscari(prev => prev.filter((_, j) => j !== i))}
                  />
                  <MiscareQuickAdd value={wodMiscareCurenta} onChange={setWodMiscareCurenta}
                    onAdd={(v) => { setWodMiscari(prev => [...prev, v]); setWodMiscareCurenta('') }}
                    placeholder={userProfile?.weight_unit === 'lbs' ? 'ex: 21 Thrusters @ 95lbs' : 'ex: 21 Thrusters @ 43kg'} />
                </div>
              )}
            </>
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
              {wodSaving ? 'Se salvează...' : editLogId ? 'Salvează modificările' : 'Salvează WOD'}
            </button>
          </div>
        </div>
      )}

      {screen === 'newHeroWod' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => { setEditHeroWodId(null); setNewHeroWodName(''); setNewHeroWodFormat(''); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta(''); setScreen(prevScreen || 'pr') }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>{editHeroWodId ? 'Editează Hero WOD' : 'Hero WOD nou'}</h1>
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>NUME WOD</div>
            <input value={newHeroWodName} onChange={e => setNewHeroWodName(e.target.value)} placeholder="ex: Forge WOD, The C15..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>FORMAT</div>
            <input value={newHeroWodFormat} onChange={e => setNewHeroWodFormat(e.target.value)} placeholder="ex: For Time, AMRAP 20 min, 5 rounds..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '600' }}>MIȘCĂRI <span style={{ fontWeight: '400', fontSize: '10px' }}>(trage ☰ pentru reordonare)</span></div>
            <SortableList
              items={newHeroWodMiscari}
              onReorder={setNewHeroWodMiscari}
              onRemove={(i) => setNewHeroWodMiscari(prev => prev.filter((_, j) => j !== i))}
            />
            <MiscareQuickAdd value={newHeroWodMiscareCurenta} onChange={setNewHeroWodMiscareCurenta}
              onAdd={(v) => { setNewHeroWodMiscari(prev => [...prev, v]); setNewHeroWodMiscareCurenta('') }}
              placeholder={userProfile?.weight_unit === 'lbs' ? 'ex: 21 Thrusters @ 95lbs' : 'ex: 21 Thrusters @ 43kg'} />
          </div>
          <button onClick={saveNewHeroWod} disabled={newHeroWodSaving}
            style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: newHeroWodSaving ? 'not-allowed' : 'pointer', opacity: newHeroWodSaving ? 0.7 : 1 }}>
            {newHeroWodSaving ? 'Se salvează...' : editHeroWodId ? 'Salvează modificările' : 'Salvează Hero WOD'}
          </button>
        </div>
      )}

      {screen === 'logPR' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => { setEditPrId(null); setScreen(prevScreen || 'pr') }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>{editPrId ? `Editează — ${miscarePR}` : logPentruPR ? `Log — ${logPentruPR.movement}` : 'Log PR nou'}</h1>
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <CautareMiscare preFill={miscarePR} onAleage={(m) => setMiscarePR(m)} />
            {miscarePR && (
              <>
                {miscarePR in heroWodsInfoAll ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Timp</div>
                    <input value={prTimp} onChange={e => setPrTimp(e.target.value)} placeholder="ex: 4:22" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Variantă</div>
                    <select value={prVarianta} onChange={e => setPrVarianta(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }}>
                      <option>RX</option><option>Intermediate</option><option>Beginner</option><option>OnRamp</option>
                    </select>
                  </>
                ) : CARDIO_MISCARI.includes(miscarePR) ? (
                  <>
                    {CARDIO_CU_CALORII.includes(miscarePR) && (
                      <>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Scor în</div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                          {[{ val: 'm', label: 'Metri' }, { val: 'cal', label: 'Calorii' }].map(o => (
                            <div key={o.val} onClick={() => setPrCardioUnit(o.val)}
                              style={{ flex: 1, padding: '9px', textAlign: 'center', borderRadius: '10px', border: prCardioUnit === o.val ? '2px solid #1a1a1a' : '1px solid #e0e0e0', background: prCardioUnit === o.val ? '#f0f0f0' : '#fafafa', color: prCardioUnit === o.val ? '#1a1a1a' : '#888', fontSize: '13px', fontWeight: prCardioUnit === o.val ? '700' : '400', cursor: 'pointer' }}>
                              {o.label}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{prCardioUnit === 'cal' ? 'Calorii' : 'Distanță (m)'}</div>
                    <input type="number" value={prDistanta} onChange={e => setPrDistanta(e.target.value)} placeholder={prCardioUnit === 'cal' ? 'ex: 50' : 'ex: 1000'} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
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
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Greutate ({userProfile?.weight_unit || 'kg'})</div>
                    <input type="number" value={prValoare} onChange={e => setPrValoare(e.target.value)} placeholder={userProfile?.weight_unit === 'lbs' ? 'ex: 265' : 'ex: 120'} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Repetări</div>
                    <input type="number" value={prReps} onChange={e => setPrReps(e.target.value)} placeholder="ex: 1 (pentru 1RM)" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                )}
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>Note</div>
                <input value={prNote} onChange={e => setPrNote(e.target.value)} placeholder="Belt? Knee sleeves? Cum te-ai simțit?" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
                <button onClick={savePR} disabled={prSaving}
                  style={{ width: '100%', padding: '12px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: prSaving ? 'not-allowed' : 'pointer', opacity: prSaving ? 0.7 : 1 }}>
                  {prSaving ? 'Se salvează...' : editPrId ? 'Salvează modificările' : 'Salvează PR'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {screen === 'pr' && (() => {
        const prGroups = {}
        prDate.forEach(pr => { if (!prGroups[pr.movement]) prGroups[pr.movement] = []; prGroups[pr.movement].push(pr) })
        const parseTimeStr = (s) => {
          if (!s) return Infinity
          const str = String(s).trim()
          if (str.includes(':')) {
            const parts = str.split(':').map(Number)
            if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
            if (parts.length === 2) return parts[0] * 60 + parts[1]
          }
          return parseFloat(str) || Infinity  // deja în secunde
        }
        const bestPR = (records) => {
          if (!records?.length) return null
          if (records[0].unit === 'timp') return records.reduce((b, r) => parseTimeStr(r.value) < parseTimeStr(b.value) ? r : b, records[0])
          const withVal = records.filter(r => r.value != null && parseFloat(r.value) > 0)
          if (withVal.length > 0) return withVal.reduce((b, r) => parseFloat(r.value) > parseFloat(b.value) ? r : b)
          const withReps = records.filter(r => r.reps && r.reps > 0)
          if (withReps.length > 0) return withReps.reduce((b, r) => r.reps > b.reps ? r : b)
          return records[0]
        }
        const PCT_BARA = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95]
        const catConfig = {
          WEIGHTLIFTING: { culoare: '#1a1a1a', label: 'WEIGHTLIFTING' },
          GYMNASTICS:    { culoare: '#1a1a1a', label: 'GYMNASTICS' },
          CARDIO:        { culoare: '#0C447C', label: 'CARDIO' },
          HERO_WODS:     { culoare: '#8B1A1A', label: 'HERO WODs' },
        }
        const toateMiscariCategorii = [...PR_CATEGORII.WEIGHTLIFTING, ...PR_CATEGORII.GYMNASTICS, ...PR_CATEGORII.CARDIO, ...heroWodsListAll]
        const miscariFaraCat = Object.keys(prGroups).filter(m => !toateMiscariCategorii.includes(m))
        const preferredUnit = userProfile?.weight_unit || 'kg'
        const renderMiscare = (movement, idx, total, cat) => {
          const records = prGroups[movement]
          const best = bestPR(records)
          const isOpen = prSelectat === movement
          const isWeightBest = cat === 'WEIGHTLIFTING' && (best?.unit === 'kg' || best?.unit === 'lbs') && best?.value
          const bestKg = isWeightBest ? convertWeight(parseFloat(best.value), best.unit, preferredUnit) : null
          const wodInfo = heroWodsInfoAll[movement]
          return (
            <div key={movement} onClick={() => setPrSelectat(isOpen ? null : movement)}
              style={{ padding: '12px 14px', borderBottom: idx < total - 1 ? '1px solid #f0f0f0' : 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#1a1a1a' }}>{movement}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: best ? '#1a1a1a' : '#ccc' }}>{best ? formatPR(best, preferredUnit) : '—'}</span>
                  <span style={{ fontSize: '11px', color: '#ccc' }}>{isOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {best && !isOpen && (
                <div style={{ fontSize: '10px', color: '#bbb', marginTop: '2px' }}>
                  {new Date(best.recorded_at).toLocaleDateString('ro-RO')}{best.notes ? ' · ' + best.notes : ''}
                </div>
              )}
              {!best && !isOpen && wodInfo && (
                <div style={{ fontSize: '10px', color: '#bbb', marginTop: '2px' }}>{wodInfo.split('\n')[0]}</div>
              )}
              {isOpen && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }} onClick={e => e.stopPropagation()}>
                  {wodInfo && (
                    <div style={{ marginBottom: '14px', background: '#111', borderRadius: '12px', padding: '14px', overflow: 'hidden' }}>
                      {wodInfo.split('\n').map((line, li) => (
                        <div key={li} style={{
                          fontSize: li === 0 ? '11px' : '13px',
                          fontWeight: li === 0 ? '800' : '400',
                          color: li === 0 ? '#C8FF00' : '#e0e0e0',
                          marginBottom: li === 0 ? '8px' : '3px',
                          letterSpacing: li === 0 ? '0.8px' : '0',
                          textTransform: li === 0 ? 'uppercase' : 'none',
                        }}>
                          {li === 0 ? line : `• ${line}`}
                        </div>
                      ))}
                    </div>
                  )}
                  {cat === 'HERO_WODS' && customHeroWods.some(w => w.name === movement) && (
                    <button onClick={() => {
                        const cw = customHeroWods.find(w => w.name === movement)
                        setEditHeroWodId(cw.id); setNewHeroWodName(cw.name); setNewHeroWodFormat(cw.format || ''); setNewHeroWodMiscari(cw.movements ? cw.movements.split('\n') : []); setNewHeroWodMiscareCurenta('')
                        setPrevScreen('pr'); setScreen('newHeroWod')
                      }}
                      style={{ width: '100%', padding: '8px', background: '#f0f0f0', color: '#1a1a1a', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', marginBottom: '14px' }}>
                      ✎ Editează Hero WOD-ul
                    </button>
                  )}
                  {bestKg && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '8px' }}>% DIN 1RM — {bestKg} {preferredUnit}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                        {PCT_BARA.map(pct => {
                          const w = Math.round(bestKg * pct / 100 * 2) / 2
                          return (
                            <div key={pct} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', background: '#f8f8f8', borderRadius: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: '600' }}>{pct}%</span>
                              <span style={{ fontSize: '13px', fontWeight: '700', color: '#1a1a1a' }}>{w} {preferredUnit}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {records && records.length > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '6px' }}>ISTORIC</div>
                      {records.slice(0, 5).map((r, j) => (
                        <div key={j}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', borderBottom: j < Math.min(records.length, 5) - 1 ? '1px solid #f5f5f5' : 'none' }}>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>{new Date(r.recorded_at).toLocaleDateString('ro-RO')}{r.notes ? ' · ' + r.notes : ''}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '12px', fontWeight: '600', color: '#555' }}>{formatPR(r, preferredUnit)}</span>
                            <button onClick={() => startEditPR(r, movement)}
                              style={{ background: '#f0f0f0', border: 'none', borderRadius: '6px', width: '24px', height: '24px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              ✎
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setEditPrId(null); setLogPentruPR(best || null); setMiscarePR(movement); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrVarianta('RX'); setPrevScreen('pr'); setScreen('logPR') }}
                    style={{ width: '100%', padding: '8px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                    + Adaugă rezultat nou
                  </button>
                </div>
              )}
            </div>
          )
        }
        return (
          <div style={{ padding: '20px', paddingBottom: '80px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', textTransform: 'uppercase', letterSpacing: '-0.5px' }}>Recorduri 🏆</h1>
              <button onClick={() => { setEditPrId(null); setLogPentruPR(null); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrevScreen('pr'); setScreen('logPR') }}
                style={{ padding: '8px 14px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>
                + PR nou
              </button>
            </div>
            {prDate.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
                <div style={{ fontSize: '36px', marginBottom: '10px' }}>🏆</div>
                <div style={{ fontSize: '14px' }}>Niciun PR salvat încă</div>
              </div>
            )}
            {['WEIGHTLIFTING', 'GYMNASTICS', 'CARDIO'].map(cat => {
              const miscariCat = PR_CATEGORII[cat].filter(m => prGroups[m])
              if (miscariCat.length === 0) return null
              const cfg = catConfig[cat]
              const esteOpen = !!catDeschise[cat]
              const search = (catSearch[cat] || '').toLowerCase()
              const miscariAfisate = search ? miscariCat.filter(m => m.toLowerCase().includes(search)) : miscariCat
              return (
                <div key={cat} style={{ marginBottom: '20px' }}>
                  <div onClick={() => { setCatDeschise(prev => ({ ...prev, [cat]: !prev[cat] })); setPrSelectat(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: esteOpen ? '8px' : '0', cursor: 'pointer', userSelect: 'none' }}>
                    <div style={{ fontSize: '10px', fontWeight: '800', color: cfg.culoare, letterSpacing: '1.5px' }}>{cfg.label}</div>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                    <div style={{ fontSize: '10px', color: '#bbb', marginRight: '4px' }}>{miscariCat.length} exerciții</div>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: cfg.culoare, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: cfg.culoare === '#1a1a1a' ? '#C8FF00' : '#fff', flexShrink: 0 }}>
                      {esteOpen ? '▲' : '▼'}
                    </div>
                  </div>
                  {esteOpen && (
                    <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }} onClick={e => e.stopPropagation()}>
                        <input
                          value={catSearch[cat] || ''}
                          onChange={e => setCatSearch(prev => ({ ...prev, [cat]: e.target.value }))}
                          placeholder={`Caută în ${cfg.label}...`}
                          style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px', border: '1px solid #e0e0e0', fontSize: '13px', background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") no-repeat 10px center #fafafa`, boxSizing: 'border-box', outline: 'none' }}
                        />
                      </div>
                      {miscariAfisate.length === 0
                        ? <div style={{ padding: '20px', textAlign: 'center', fontSize: '13px', color: '#aaa' }}>Niciun exercițiu găsit</div>
                        : miscariAfisate.map((m, idx) => renderMiscare(m, idx, miscariAfisate.length, cat))
                      }
                    </div>
                  )}
                </div>
              )
            })}
            {/* ── HERO WODs — dropdown collapsibil ── */}
            {(() => {
              const cfg = catConfig['HERO_WODS']
              const toateHero = heroWodsListAll
              const cuPR = toateHero.filter(m => prGroups[m]).length
              return (
                <div style={{ marginBottom: '20px' }}>
                  {/* Header clickabil */}
                  <div onClick={() => { setHeroWodsDeschis(v => !v); setPrSelectat(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: heroWodsDeschis ? '8px' : '0', cursor: 'pointer', userSelect: 'none' }}>
                    <div style={{ fontSize: '10px', fontWeight: '800', color: cfg.culoare, letterSpacing: '1.5px' }}>{cfg.label}</div>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                    <div style={{ fontSize: '10px', color: '#bbb', marginRight: '4px' }}>{cuPR}/{toateHero.length} completate</div>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: cfg.culoare, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', flexShrink: 0 }}>
                      {heroWodsDeschis ? '▲' : '▼'}
                    </div>
                  </div>
                  {heroWodsDeschis && (
                    <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      {toateHero.map((m, idx) => renderMiscare(m, idx, toateHero.length + 1, 'HERO_WODS'))}
                      {/* Linie separator + formular WOD nou */}
                      <div style={{ borderTop: '2px dashed #f0f0f0', padding: '14px' }}>
                        <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '8px' }}>HERO WOD PERSONALIZAT</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            value={heroWodNouInput}
                            onChange={e => setHeroWodNouInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && heroWodNouInput.trim()) { setNewHeroWodName(heroWodNouInput.trim()); setNewHeroWodFormat(''); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta(''); setPrevScreen('pr'); setScreen('newHeroWod'); setHeroWodNouInput('') }}}
                            placeholder="ex: Forge WOD, The C15..."
                            style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }}
                          />
                          <button
                            onClick={() => { if (!heroWodNouInput.trim()) return; setNewHeroWodName(heroWodNouInput.trim()); setNewHeroWodFormat(''); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta(''); setPrevScreen('pr'); setScreen('newHeroWod'); setHeroWodNouInput('') }}
                            style={{ padding: '10px 14px', borderRadius: '10px', background: heroWodNouInput.trim() ? '#C8FF00' : '#f0f0f0', color: heroWodNouInput.trim() ? '#111' : '#bbb', border: 'none', fontSize: '20px', fontWeight: '700', cursor: heroWodNouInput.trim() ? 'pointer' : 'default', lineHeight: 1, flexShrink: 0 }}>
                            →
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
            {miscariFaraCat.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#888', letterSpacing: '1.5px' }}>ALTELE</div>
                  <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                </div>
                <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                  {miscariFaraCat.map((m, idx) => renderMiscare(m, idx, miscariFaraCat.length, null))}
                </div>
              </div>
            )}
          </div>
        )
      })()}


      {screen === 'timer' && <Timer onBack={() => setScreen(prevScreen)} defaultFortime={wodZiData ? parseWodMinute(wodZiData.duration) : null} />}
      {screen === 'clasament' && <Clasament logs={clasamentLogs} loading={clasamentLoading} wodZiData={clasamentWodData} onRefresh={() => fetchClasament(clasamentDate)} selectedDate={clasamentDate} onDateChange={(d) => { setClasamentDate(d); fetchClasament(d) }} />}
      {screen === 'feed' && <Feed showToast={showToast} user={user} userProfile={userProfile} />}
      {screen === 'admin' && isAdmin && <Admin showToast={showToast} user={user} />}

      {screen === 'profile' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
            <button onClick={() => setScreen(prevScreen || 'home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#1a1a1a' }}>Profilul meu</h1>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '28px' }}>
            <div onClick={() => !avatarUploading && avatarInputRef.current?.click()}
              style={{ width: '84px', height: '84px', borderRadius: '50%', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
              {avatarUploading ? (
                <span style={{ fontSize: '20px', color: '#C8FF00', animation: 'spin 1s linear infinite' }}>⏳</span>
              ) : userProfile?.avatar_url ? (
                <img src={userProfile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: '26px', fontWeight: '800', color: '#C8FF00', letterSpacing: '-0.5px' }}>
                  {[profileFirstName, profileLastName].map(w => w[0]).filter(Boolean).join('').toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) uploadAvatar(e.target.files[0]); e.target.value = '' }} />
          </div>

          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Email</div>
              <div style={{ fontSize: '15px', color: '#888' }}>{user?.email}</div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '18px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Prenume *</div>
                <input value={profileFirstName} onChange={e => setProfileFirstName(e.target.value)}
                  placeholder="ex: Andrei"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Nume *</div>
                <input value={profileLastName} onChange={e => setProfileLastName(e.target.value)}
                  placeholder="ex: Popescu"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Data nașterii *</div>
              <input type="date" value={profileBirthDate} onChange={e => setProfileBirthDate(e.target.value)}
                max={todayLocalStr()}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box', background: '#fff' }} />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Gen</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[{ val: 'masculin', label: '♂', sub: 'Masculin' }, { val: 'feminin', label: '♀', sub: 'Feminin' }].map(g => (
                  <div key={g.val} onClick={() => setProfileGender(g.val)}
                    style={{ flex: 1, padding: '16px 14px', borderRadius: '16px', border: `2px solid ${profileGender === g.val ? '#1a1a1a' : '#e0e0e0'}`, background: profileGender === g.val ? '#1a1a1a' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: '22px', marginBottom: '4px', color: profileGender === g.val ? '#C8FF00' : '#888' }}>{g.label}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: profileGender === g.val ? '#C8FF00' : '#888' }}>{g.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={saveMyProfile} disabled={profileSaving}
              style={{ width: '100%', padding: '16px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: profileSaving ? 'default' : 'pointer', opacity: profileSaving ? 0.6 : 1 }}>
              {profileSaving ? 'Se salvează...' : 'Salvează modificările'}
            </button>
          </div>

          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' }}>Unitate de măsură</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>Folosită pentru greutățile din Recorduri.</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {[{ val: 'kg', label: 'Kilograme' }, { val: 'lbs', label: 'Lbs' }].map(u => {
                const active = (userProfile?.weight_unit || 'kg') === u.val
                return (
                  <div key={u.val} onClick={() => changeWeightUnit(u.val)}
                    style={{ flex: 1, padding: '16px 14px', borderRadius: '16px', border: `2px solid ${active ? '#1a1a1a' : '#e0e0e0'}`, background: active ? '#1a1a1a' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: active ? '#C8FF00' : '#888', textTransform: 'uppercase' }}>{u.val}</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: active ? '#C8FF00' : '#888', marginTop: '2px' }}>{u.label}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#1a1a1a', marginBottom: '16px' }}>Schimbă parola</div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Parolă nouă</div>
              <input value={profileNewPassword} onChange={e => setProfileNewPassword(e.target.value)} type="password" placeholder="minimum 6 caractere"
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Confirmă parola</div>
              <input value={profileNewPasswordConfirm} onChange={e => setProfileNewPasswordConfirm(e.target.value)} type="password" placeholder="repetă parola"
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
            </div>
            <button onClick={changeMyPassword} disabled={passwordSaving}
              style={{ width: '100%', padding: '16px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: passwordSaving ? 'default' : 'pointer', opacity: passwordSaving ? 0.6 : 1 }}>
              {passwordSaving ? 'Se salvează...' : 'Schimbă parola'}
            </button>
          </div>

          <button onClick={handleLogout} style={{ width: '100%', padding: '14px', marginTop: '16px', background: 'none', border: 'none', fontSize: '13px', color: '#aaa', cursor: 'pointer', textAlign: 'center' }}>
            Deconectează-te
          </button>
        </div>
      )}

      {showCalPicker && (() => {
        const _now2 = new Date(); const todayStr = `${_now2.getFullYear()}-${String(_now2.getMonth()+1).padStart(2,'0')}-${String(_now2.getDate()).padStart(2,'0')}`
        const luniRo = ['Ianuarie','Februarie','Martie','Aprilie','Mai','Iunie','Iulie','August','Septembrie','Octombrie','Noiembrie','Decembrie']
        const firstDay = new Date(calPickerYear, calPickerMonth, 1)
        const daysInMonth = new Date(calPickerYear, calPickerMonth + 1, 0).getDate()
        const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
        const cells = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => {
          const d = i + 1
          return `${calPickerYear}-${String(calPickerMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        })]
        while (cells.length % 7 !== 0) cells.push(null)
        const prevLuna = () => calPickerMonth === 0 ? (setCalPickerYear(y => y - 1), setCalPickerMonth(11)) : setCalPickerMonth(m => m - 1)
        const nextLuna = () => calPickerMonth === 11 ? (setCalPickerYear(y => y + 1), setCalPickerMonth(0)) : setCalPickerMonth(m => m + 1)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 450, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxShadow: '0 60px 0 0 rgba(0,0,0,0.55)' }}
            onClick={() => setShowCalPicker(false)}>
            <div style={{ background: '#fff', borderRadius: '20px', padding: '20px', width: '100%', maxWidth: '360px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
              onClick={e => e.stopPropagation()}>
              {/* Header luna */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <span onClick={prevLuna} style={{ fontSize: '22px', cursor: 'pointer', color: '#888', padding: '2px 10px', userSelect: 'none' }}>‹</span>
                <span style={{ fontSize: '15px', fontWeight: '800', color: '#1a1a1a', letterSpacing: '0.02em' }}>
                  {luniRo[calPickerMonth].toUpperCase()} {calPickerYear}
                </span>
                <span onClick={nextLuna} style={{ fontSize: '22px', cursor: 'pointer', color: '#888', padding: '2px 10px', userSelect: 'none' }}>›</span>
              </div>
              {/* Zile header */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '6px' }}>
                {['L','Ma','Mi','J','V','S','D'].map(z => (
                  <div key={z} style={{ textAlign: 'center', fontSize: '10px', fontWeight: '700', color: '#bbb', paddingBottom: '4px' }}>{z}</div>
                ))}
              </div>
              {/* Grid zile */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                {cells.map((ds, i) => {
                  if (!ds) return <div key={i} />
                  const d = new Date(ds + 'T00:00:00')
                  const selectat = ds === dataAcasa
                  const esteAzi = ds === todayStr
                  const areWod = wodLogs.some(l => { if (!l.logged_at) return false; const ld = new Date(l.logged_at); return `${ld.getFullYear()}-${String(ld.getMonth()+1).padStart(2,'0')}-${String(ld.getDate()).padStart(2,'0')}` === ds })
                  const areRez = claseDB.some(c => rezervariMele.includes(c.id) && c.date === ds)
                  return (
                    <div key={ds} onClick={() => { setDataAcasa(ds); setShowCalPicker(false); scrollChipToDate(ds) }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', aspectRatio: '1', borderRadius: '10px', cursor: 'pointer',
                        background: selectat ? '#1a1a1a' : 'transparent',
                        border: selectat ? 'none' : esteAzi ? '2px solid #1a1a1a' : 'none' }}>
                      <span style={{ fontSize: '14px', fontWeight: selectat || esteAzi ? '800' : '400', color: selectat ? '#C8FF00' : '#1a1a1a', lineHeight: 1 }}>{d.getDate()}</span>
                      {(areWod || areRez) && <span style={{ fontSize: '7px', color: areRez ? '#1a1a1a' : '#C8FF00', lineHeight: 1, marginTop: '1px' }}>{areRez ? '✓' : '⚡'}</span>}
                    </div>
                  )
                })}
              </div>
              {/* Buton azi */}
              <div onClick={() => { setDataAcasa(todayStr); setShowCalPicker(false); scrollChipToDate(todayStr) }}
                style={{ marginTop: '14px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#1a1a1a', cursor: 'pointer', padding: '8px', background: '#f0f0f0', borderRadius: '10px' }}>
                Mergi la azi
              </div>
            </div>
          </div>
        )
      })()}

      {showOnboarding && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 500, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', boxShadow: '0 60px 0 0 rgba(0,0,0,0.75)' }}>
          <div style={{ background: '#fff', borderRadius: '24px 24px 0 0', padding: '28px 24px 40px', width: '100%', maxWidth: '480px' }}>
            {/* Progress dots */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '24px' }}>
              {[1,2,3].map(s => (
                <div key={s} style={{ width: s === onboardingStep ? '24px' : '8px', height: '8px', borderRadius: '4px', background: s <= onboardingStep ? '#1a1a1a' : '#e0e0e0', transition: 'all 0.2s' }} />
              ))}
            </div>

            {/* PASUL 1 — Date personale */}
            {onboardingStep === 1 && (
              <>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', marginBottom: '4px' }}>Bun venit! 👋</div>
                <div style={{ fontSize: '14px', color: '#888', marginBottom: '24px' }}>Completează datele tale pentru înregistrare.</div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Prenume *</div>
                    <input value={onboardingFirstName} onChange={e => setOnboardingFirstName(e.target.value)}
                      placeholder="ex: Andrei"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Nume *</div>
                    <input value={onboardingLastName} onChange={e => setOnboardingLastName(e.target.value)}
                      placeholder="ex: Popescu"
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Data nașterii *</div>
                  <input type="date" value={onboardingBirthDate} onChange={e => setOnboardingBirthDate(e.target.value)}
                    max={todayLocalStr()}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#1a1a1a', boxSizing: 'border-box', background: '#fff' }} />
                </div>
                <button onClick={() => { if (!onboardingFirstName.trim() || !onboardingLastName.trim() || !onboardingBirthDate) { showToast('❌ Completează toate câmpurile obligatorii!'); return }; setOnboardingStep(2) }}
                  style={{ width: '100%', padding: '16px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: 'pointer' }}>
                  Continuă →
                </button>
              </>
            )}

            {/* PASUL 2 — Gen */}
            {onboardingStep === 2 && (
              <>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#1a1a1a', marginBottom: '4px' }}>Selectează genul</div>
                <div style={{ fontSize: '14px', color: '#888', marginBottom: '28px' }}>Folosit pentru clasamentul pe categorii.</div>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '28px' }}>
                  {[{ val: 'masculin', label: '♂', sub: 'Masculin' }, { val: 'feminin', label: '♀', sub: 'Feminin' }].map(g => (
                    <div key={g.val} onClick={() => setOnboardingGender(g.val)}
                      style={{ flex: 1, padding: '20px 14px', borderRadius: '16px', border: `2px solid ${onboardingGender === g.val ? '#1a1a1a' : '#e0e0e0'}`, background: onboardingGender === g.val ? '#1a1a1a' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: '28px', marginBottom: '6px', color: onboardingGender === g.val ? '#C8FF00' : '#888' }}>{g.label}</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: onboardingGender === g.val ? '#C8FF00' : '#888' }}>{g.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setOnboardingStep(1)}
                    style={{ flex: 1, padding: '14px', background: '#f5f5f5', color: '#888', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>← Înapoi</button>
                  <button onClick={() => { if (!onboardingGender) { showToast('❌ Selectează genul!'); return }; setOnboardingStep(3) }}
                    style={{ flex: 2, padding: '14px', background: '#C8FF00', color: '#111', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '800', cursor: 'pointer' }}>Continuă →</button>
                </div>
              </>
            )}

            {/* PASUL 3 — Waiver */}
            {onboardingStep === 3 && (
              <>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#1a1a1a', marginBottom: '4px' }}>
                  {onboardingFirstName && onboardingGender ? `Reînnoire acord ${new Date().getFullYear()}` : 'Acord de participare'}
                </div>
                <div style={{ fontSize: '13px', color: '#888', marginBottom: '14px' }}>
                  {onboardingFirstName && onboardingGender ? 'Acordul de participare se reînnoiește anual. Citește și acceptă pentru a continua.' : 'Citește și acceptă acordul pentru a continua.'}
                </div>
                <div style={{ background: '#f8f8f8', borderRadius: '14px', padding: '14px 16px', marginBottom: '16px', maxHeight: '220px', overflowY: 'auto', fontSize: '12px', color: '#444', lineHeight: '1.7' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#1a1a1a', letterSpacing: '0.5px', marginBottom: '10px' }}>DECLARAȚIE DE CONSIMȚĂMÂNT — CrossFit C15 / Forge</div>
                  <p style={{ marginBottom: '8px' }}><strong>1. Starea de sănătate</strong><br />Declar că sunt apt/ă din punct de vedere medical pentru activități fizice de intensitate ridicată și nu am contraindicații medicale cunoscute. Am consultat sau mă angajez să consult un medic înainte de începerea programului.</p>
                  <p style={{ marginBottom: '8px' }}><strong>2. Asumarea riscurilor</strong><br />Înțeleg că CrossFit și activitățile sportive implică riscuri inerente de accidentare. Îmi asum în mod voluntar aceste riscuri și participarea este de bună voie.</p>
                  <p style={{ marginBottom: '8px' }}><strong>3. Limitarea răspunderii</strong><br />CrossFit C15, Forge și antrenorii nu sunt responsabili pentru accidentări, prejudicii sau pierderi survenite în timpul antrenamentelor, cu excepția cazurilor de neglijență gravă dovedită.</p>
                  <p style={{ marginBottom: '8px' }}><strong>4. Regulamentul sălii</strong><br />Mă angajez să respect instrucțiunile antrenorilor, regulamentul intern și să utilizez echipamentul în siguranță. Comportamentul neadecvat poate duce la suspendarea accesului.</p>
                  <p><strong>5. Date personale</strong><br />Datele mele personale sunt utilizate exclusiv pentru gestionarea membriei CrossFit C15 și nu vor fi partajate cu terți fără acordul meu explicit.</p>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={onboardingWaiverAccepted} onChange={e => setOnboardingWaiverAccepted(e.target.checked)}
                    style={{ width: '20px', height: '20px', marginTop: '1px', accentColor: '#1a1a1a', flexShrink: 0, cursor: 'pointer' }} />
                  <span style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: '1.5' }}>Am citit, înțeles și sunt de acord cu termenii acordului de mai sus.</span>
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setOnboardingStep(2)}
                    style={{ flex: 1, padding: '14px', background: '#f5f5f5', color: '#888', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>← Înapoi</button>
                  <button onClick={saveOnboarding} disabled={!onboardingWaiverAccepted}
                    style={{ flex: 2, padding: '14px', background: onboardingWaiverAccepted ? '#C8FF00' : '#e0e0e0', color: onboardingWaiverAccepted ? '#111' : '#aaa', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '800', cursor: onboardingWaiverAccepted ? 'pointer' : 'default' }}>
                    Confirm și intru ✓
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: '500', zIndex: 300, maxWidth: '90vw', textAlign: 'center', wordBreak: 'break-word' }}>
          {toast}
        </div>
      )}

      <NavBar screen={screen} setScreen={setScreen} isAdmin={isAdmin} feedUnread={feedUnread} />
    </div>
  )
}

export default function AppWithBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>
}


