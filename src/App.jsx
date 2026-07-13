// @ts-nocheck
/* eslint-disable */
import { useState, useEffect, useRef, useMemo, Component } from 'react'
import {
  Home, PenLine, Trophy, Medal, MessageCircle, Settings,
  Flame, Dumbbell, ClipboardList, Ticket, CreditCard, Timer as TimerIcon,
  Calendar, AlertTriangle, Lock, Zap, Info, Flag, Users, Coins, BarChart3,
  RotateCw, Clock, Mars, Venus, User, CheckCircle2, Share2, X,
} from 'lucide-react'
import { supabase } from './supabase'
import {
  todayLocalStr, addMonthsClamped, daysUntil, levenshtein, urlBase64ToUint8Array,
  fmt, secToTime, timeToSec, convertWeight, formatPR, getInitiale, parseWodMinute, formatWodDurata,
  localeFor,
} from './utils'
import { AvatarCircle, LevelDot, MovementSuggestions } from './components'
import { getT } from './translations'
import { CARDIO_MISCARI, CARDIO_CU_CALORII, MISCARI, miscareSugestii, parseMiscareLinePasta } from './movements'
import FormatConfigEditor from './FormatConfigEditor'
import FormatLogger, { PrCandidatesConfirm } from './FormatLogger'
import {
  getFormat, legacyHeaderTypeOf, estimateTotalDurationSec, composeFormatHeader,
  composeAmrapResult, parseAmrapResult, composePartialText, parsePartialText,
  normalizeSetsRows, computeSetsPrCandidates, describeFormatConfig, AUTO_DURATION_FORMAT_IDS,
  formatTypeLabel, isNotRxd, weightKeyForVariant, weightMatches, canonicalWeightKey,
  VARIANTE_WEIGHT_BASE, ALL_WEIGHT_COLUMNS, setsDisplayScore, isSequentialFormat,
} from './workoutFormats'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('App crash:', error, info) }
  render() {
    if (this.state.hasError) {
      // Fara acces la starea App() (crash-ul poate veni din App insusi) -
      // aceeasi sursa ca fallback-ul pre-auth (vezi App(): useState lang).
      const storedLang = localStorage.getItem('forge_lang')
      const lang = (storedLang === 'ro' || storedLang === 'en') ? storedLang : (navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ro')
      const t = getT(lang)
      return (
        <div className="app-frame" style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px', fontFamily: 'system-ui' }}>
          <div style={{ background: '#fff', borderRadius: '20px', padding: '28px 24px', textAlign: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
            <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}><AlertTriangle size={40} color="#E24B4A" strokeWidth={1.75} /></div>
            <div style={{ fontSize: '16px', fontWeight: '700', color: '#0E0E0E', marginBottom: '6px' }}>{t.errorBoundaryTitle}</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '20px' }}>{t.errorBoundarySubtitle}</div>
            <button onClick={() => window.location.reload()} style={{ padding: '12px 24px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
              {t.errorBoundaryButton}
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

const VAPID_PUBLIC_KEY = 'BOmGoF0pRvdf35liFRcCqT5XJbS9BE5ZDAkIAmgumLCSDkQSA2KKJ0AkZ9ELnI-GJ62PVYmBb4nOvMot7h7eWQ4'
const EDGE_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

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
  const startStr = todayLocalStr()
  const endStr = addMonthsClamped(startDate, duration)

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

// MISCARI/CARDIO_MISCARI/CARDIO_CU_CALORII/miscareSugestii mutate in
// movements.js (importate mai jos) - FormatConfigEditor.jsx are nevoie de
// ele si nu poate importa din App.jsx (App.jsx importa FormatConfigEditor,
// ar fi ciclu de dependente).

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
  // ── Hero WODs (lista extinsa, cercetata din arhiva oficiala CrossFit -
  // crossfit.com/heroes, cross-verificata pe 2 surse) - cateva intrari cu
  // structura pe statii/intervale (Dallas 5, DVB, Manuel, Otis, Scooter,
  // Santora) nu se preteaza perfect la formatul "reps + miscare", incercate
  // cat mai fidel posibil; verifica manual daca ai dubii pe o miscare anume. ──
  'Abbate':        'For Time\n1 Mile Run (1.6 km)\n21 Clean & Jerks 70/47 kg\n800m Run\n21 Clean & Jerks 70/47 kg\n1 Mile Run (1.6 km)',
  'AdamBrown':     '2 rounds for time\n24 Deadlifts 134 kg\n24 Box Jumps 61 cm\n24 Wall Balls 9 kg\n24 Bench Press 88 kg\n24 Box Jumps 61 cm\n24 Wall Balls 9 kg\n24 Cleans 66 kg',
  'Adrian':        '7 rounds for time\n3 Forward Rolls\n5 Wall Climbs\n7 Toes-to-Bar\n9 Box Jumps 76 cm',
  'Alexander':     '5 rounds for time\n31 Back Squats 61 kg\n12 Power Cleans 84 kg',
  'Andy':          'For Time (vestă 9 kg)\n25 Thrusters 52 kg\n50 Box Jumps 61 cm\n75 Deadlifts 52 kg\n1.5 Mile Run (2.4 km)\n75 Deadlifts 52 kg\n50 Box Jumps 61 cm\n25 Thrusters 52 kg',
  'Arnie':         'For Time (o kettlebell 32 kg)\n21 Turkish Get-ups (braț drept)\n50 KB Swings 32 kg\n21 Overhead Squats (braț stâng)\n50 KB Swings 32 kg\n21 Overhead Squats (braț drept)\n50 KB Swings 32 kg\n21 Turkish Get-ups (braț stâng)',
  'Artie':         'AMRAP 20 min\n5 Pull-ups\n10 Push-ups\n15 Air Squats\n5 Pull-ups\n10 Thrusters 43 kg',
  'Barraza':       'AMRAP 18 min\n200m Run\n9 Deadlifts 125 kg\n6 Bar Muscle-up Burpees',
  'Bell':          '3 rounds for time\n21 Deadlifts 84 kg\n15 Pull-ups\n9 Front Squats 84 kg',
  'Bert':          'For Time\n50 Burpees\n400m Run\n100 Push-ups\n400m Run\n150 Walking Lunges\n400m Run\n200 Air Squats\n400m Run\n150 Walking Lunges\n400m Run\n100 Push-ups\n400m Run\n50 Burpees',
  'Big Sexy':      '5 rounds for time\n6 Deadlifts 143 kg\n6 Burpees\n5 Cleans 102 kg\n5 Chest-to-Bar Pull-ups\n4 Thrusters 70 kg\n4 Muscle-ups',
  'Blake':         '4 rounds for time\n30m Walking Lunge (disc 20 kg deasupra capului)\n30 Box Jumps 61 cm\n20 Wall Balls 9 kg\n10 Handstand Push-ups',
  'Bowen':         '3 rounds for time\n800m Run\n7 Deadlifts 125 kg\n10 Burpee Pull-ups\n14 Single-Arm KB Thrusters 24 kg (7 fiecare braț)\n20 Box Jumps 61 cm',
  'Bradley':       '10 rounds for time (30 sec pauză între runde)\n100m Sprint\n10 Pull-ups\n100m Sprint\n10 Burpees',
  'Bradshaw':      '10 rounds for time\n3 Handstand Push-ups\n6 Deadlifts 102 kg\n12 Pull-ups\n24 Double-Unders',
  'Brehm':         'For Time\n10 Rope Climbs 4.5m\n20 Back Squats 102 kg\n30 Handstand Push-ups\n40 Cal Row',
  'Brenton':       '5 rounds for time (vestă opțională 9 kg)\n30m Bear Crawl\n30m Broad Jumps (3 Burpees la fiecare 5 sărituri)',
  'Brian':         '3 rounds for time\n5 Rope Climbs 4.5m\n25 Back Squats 84 kg',
  'Bruck':         '4 rounds for time\n400m Run\n24 Back Squats 84 kg\n24 Jerks 61 kg',
  'Bulger':        '10 rounds for time\n150m Run\n7 Chest-to-Bar Pull-ups\n7 Front Squats 61 kg\n7 Handstand Push-ups',
  'Bull':          '2 rounds for time\n200 Double-Unders\n50 Overhead Squats 61 kg\n50 Pull-ups\n1 Mile Run (1.6 km)',
  'Cameron':       'For Time\n50 Walking Lunges\n25 Chest-to-Bar Pull-ups\n50 Box Jumps 61 cm\n25 Triple-Unders\n50 Back Extensions\n25 Ring Dips\n50 Knees-to-Elbows\n25 Wall Balls 9 kg ("2-fer-1s")\n50 Sit-ups\n5 Rope Climbs 4.5m',
  'Capoot':        'For Time\n100 Push-ups\n800m Run\n75 Push-ups\n1200m Run\n50 Push-ups\n1600m Run\n25 Push-ups\n2000m Run',
  'Carse':         'For Time 21-18-15-12-9-6-3 (50m Bear Crawl la inceputul fiecărei runde)\nSquat Cleans 43 kg\nDouble-Unders\nDeadlifts 84 kg\nBox Jumps 61 cm',
  'Clovis':        'For Time\n16 km Run\n150 Burpee Pull-ups',
  'Coe':           '10 rounds for time\n10 Thrusters 43 kg\n10 Ring Push-ups',
  'Coffey':        'For Time\n800m Run\n50 Back Squats 61 kg\n50 Bench Press 61 kg\n800m Run\n35 Back Squats 61 kg\n35 Bench Press 61 kg\n800m Run\n20 Back Squats 61 kg\n20 Bench Press 61 kg\n800m Run\n1 Muscle-up',
  'Coffland':      'Not For Time (atarnat de bară 6 min; de fiecare dată cand cazi)\n800m Run\n30 Push-ups',
  'Collin':        '6 rounds for time\n400m Sandbag Carry 23 kg\n12 Push Press 52 kg\n12 Box Jumps 61 cm\n12 Sumo Deadlift High-Pulls 43 kg',
  'Crain':         '2 rounds for time\n34 Push-ups\n46m Sprint\n34 Deadlifts 61 kg\n46m Sprint\n34 Box Jumps 61 cm\n46m Sprint\n34 Clean & Jerks 43 kg\n46m Sprint\n34 Burpees\n46m Sprint\n34 Wall Balls 9 kg\n46m Sprint\n34 Pull-ups\n46m Sprint',
  'Dae Han':       '3 rounds for time\n800m Run (bara 20 kg)\n3 Rope Climbs 4.5m\n12 Thrusters 61 kg',
  'Dallas 5':      '5 stații a câte 5 min (1 min pauză între stații)\nBurpees\n7 Deadlifts 70 kg + 7 Box Jumps 61 cm\nDB Turkish Get-ups 18 kg\n7 Snatches 34 kg + 7 Push-ups\nCal Row',
  'Daniel':        'For Time\n50 Pull-ups\n400m Run\n21 Thrusters 43 kg\n800m Run\n21 Thrusters 43 kg\n400m Run\n50 Pull-ups',
  'Del':           'For Time\n25 Burpees\n400m Run (minge 9 kg)\n25 Weighted Pull-ups 9 kg\n400m Run (minge 9 kg)\n25 Handstand Push-ups\n400m Run (minge 9 kg)\n25 Chest-to-Bar Pull-ups\n400m Run (minge 9 kg)\n25 Burpees',
  'DG':            'AMRAP 10 min\n8 Toes-to-Bar\n8 DB Thrusters 16 kg\n12 DB Walking Lunges 16 kg',
  'Dobogai':       '7 rounds for time\n8 Muscle-ups\n20m Farmers Carry 23 kg',
  'Donny':         'For Time 21-15-9-9-15-21\nDeadlifts 102 kg\nBurpees',
  'Dork':          '6 rounds for time\n60 Double-Unders\n30 KB Swings 25/16 kg\n15 Burpees',
  'Dragon':        'For Time\n5 km Run\n4 min pt. 4RM Deadlift\n5 km Run\n4 min pt. 4RM Push Jerk',
  'Dunn':          'AMRAP 19 min\n27 Box Jumps 61 cm\n20 Burpees\n11 Squat Cleans 66 kg',
  'DVB':           'For Time\n1.6 km Run (minge 9 kg)\n— 8 runde —\n10 Wall Balls 9 kg\n1 Rope Climb\n800m Run (minge 9 kg)\n— 4 runde —\n10 Wall Balls 9 kg\n1 Rope Climb\n400m Run (minge 9 kg)\n— 2 runde —\n10 Wall Balls 9 kg\n1 Rope Climb',
  'Emily':         '10 rounds for time (2 min pauză între runde)\n30 Double-Unders\n15 Pull-ups\n30 Air Squats\n100m Sprint',
  'Erin':          '5 rounds for time\n15 DB Split Cleans 18 kg\n21 Pull-ups',
  'Falkel':        'AMRAP 25 min\n8 Handstand Push-ups\n8 Box Jumps 76 cm\n1 Rope Climb 4.5m',
  'Feeks':         'For Time (scară crescătoare 2-16)\n100m Shuttle Sprint\nDB Squat Clean Thrusters 30 kg',
  'Foo':           '13 Bench Press 77 kg, apoi AMRAP 20 min\n7 Chest-to-Bar Pull-ups\n77 Double-Unders\n2 Squat Clean Thrusters 77 kg\n28 Sit-ups',
  'Gallant':       'For Time\n1.6 km Run (minge 9 kg)\n60 Burpee Pull-ups\n800m Run (minge 9 kg)\n30 Burpee Pull-ups\n400m Run (minge 9 kg)\n15 Burpee Pull-ups',
  'Garrett':       '3 rounds for time\n75 Air Squats\n25 Ring Handstand Push-ups\n25 L-Pull-ups',
  'Gator':         '8 rounds for time\n5 Front Squats 84 kg\n26 Ring Push-ups',
  'Gaza':          '5 rounds for time\n35 KB Swings 24 kg\n30 Push-ups\n25 Pull-ups\n20 Box Jumps 76 cm\n1 Mile Run (1.6 km)',
  'Hall':          '5 rounds for time (2 min pauză între runde)\n3 Cleans 102 kg\n200m Sprint\n20 KB Snatches 24 kg (10 fiecare braț)',
  'Hamilton':      '3 rounds for time\n1000m Row\n50 Push-ups\n1000m Run\n50 Pull-ups',
  'Hammer':        '5 rounds for time (90 sec pauză între runde)\n5 Power Cleans 61 kg\n10 Front Squats 61 kg\n5 Jerks 61 kg\n20 Pull-ups',
  'Hansen':        '5 rounds for time\n30 KB Swings 32 kg\n30 Burpees\n30 GHD Sit-ups',
  'Harper':        'AMRAP 23 min\n9 Chest-to-Bar Pull-ups\n15 Power Cleans 61 kg\n21 Air Squats\n400m Run (disc 20 kg)',
  'Havana':        'AMRAP 25 min\n150 Double-Unders\n50 Push-ups\n15 Power Cleans 84/57 kg',
  'Hidalgo':       'For Time (vestă opțională 9 kg)\n3.2 km Run\nPauză 2 min\n20 Squat Cleans 61 kg\n20 Box Jumps 61 cm\n20 Walking Lunges (disc 20 kg deasupra capului)\n20 Box Jumps 61 cm\n20 Squat Cleans 61 kg\nPauză 2 min\n3.2 km Run',
  'Hildy':         'For Time (vestă opțională 9 kg)\n100 Cal Row\n75 Thrusters 20 kg\n50 Pull-ups\n75 Wall Balls 9 kg\n100 Cal Row',
  'Holbrook':      '10 rounds for time (1 min pauză între runde)\n5 Thrusters 52 kg\n10 Pull-ups\n100m Sprint',
  'Holleyman':     '30 rounds for time\n5 Wall Balls 9 kg\n3 Handstand Push-ups\n1 Power Clean 102 kg',
  'Hollywood':     'For Time\n2 km Run\n22 Wall Balls 14 kg\n22 Muscle-ups\n22 Wall Balls 14 kg\n22 Power Cleans 84 kg\n22 Wall Balls 14 kg\n2 km Run',
  'Hortman':       'AMRAP 45 min\n800m Run\n80 Air Squats\n8 Muscle-ups',
  'Horton':        '9 rounds for time (cu partener)\n9 Bar Muscle-ups\n11 Clean & Jerks 70 kg\n46m Buddy Carry',
  'Hotshots 19':   '6 rounds for time\n30 Air Squats\n19 Power Cleans 61 kg\n7 Strict Pull-ups\n400m Run',
  'J.J.':          'For Time (piramidă 1-10 / 10-1)\nSquat Cleans 84 kg\nParallette Handstand Push-ups',
  'Jack':          'AMRAP 20 min\n10 Push Press 52 kg\n10 KB Swings 24 kg\n10 Box Jumps 61 cm',
  'Jag 28':        'For Time\n800m Run\n28 KB Swings 32 kg\n28 Strict Pull-ups\n28 KB Clean & Jerks 32 kg (fiecare braț)\n28 Strict Pull-ups\n800m Run',
  'Jared':         '4 rounds for time\n800m Run\n40 Pull-ups\n70 Push-ups',
  'Jason':         'For Time\n100 Air Squats\n5 Muscle-ups\n75 Air Squats\n10 Muscle-ups\n50 Air Squats\n15 Muscle-ups\n25 Air Squats\n20 Muscle-ups',
  'JBo':           'AMRAP 28 min\n9 Overhead Squats 52 kg\n1 Legless Rope Climb 4.5m\n12 Bench Press 52 kg',
  'Jennifer':      'AMRAP 26 min\n10 Pull-ups\n15 KB Swings 24 kg\n20 Box Jumps 61 cm',
  'Jenny':         'AMRAP 20 min\n20 Overhead Squats 20 kg\n20 Back Squats 20 kg\n400m Run',
  'Jerry':         'For Time\n1 Mile Run (1.6 km)\n2 km Row\n1 Mile Run (1.6 km)',
  'Johnson':       'AMRAP 20 min\n9 Deadlifts 111 kg\n8 Muscle-ups\n9 Squat Cleans 70 kg',
  'Jorge':         'For Time\n30 GHD Sit-ups\n15 Squat Cleans 70 kg\n24 GHD Sit-ups\n12 Squat Cleans 70 kg\n18 GHD Sit-ups\n9 Squat Cleans 70 kg\n12 GHD Sit-ups\n6 Squat Cleans 70 kg\n6 GHD Sit-ups\n3 Squat Cleans 70 kg',
  'Joshie':        '3 rounds for time\n21 DB Snatches 18 kg (braț drept)\n21 L-Pull-ups\n21 DB Snatches 18 kg (braț stâng)\n21 L-Pull-ups',
  'Josie':         'For Time (vestă 9 kg)\n1 Mile Run (1.6 km)\n— 3 runde —\n30 Burpees\n4 Power Cleans 70/47 kg\n6 Front Squats 70/47 kg\n1 Mile Run (1.6 km)',
  'Justin':        'For Time 30-20-10\nBack Squats (greutate corp)\nBench Press (greutate corp)\nStrict Pull-ups',
  'Kev':           'AMRAP 26 min (cu partener)\n6 Deadlifts 143 kg (fiecare)\n9 Bar-Facing Burpees (sincron)\n9 Bar Muscle-ups (fiecare)\n17m Partner Barbell Carry 143 kg',
  'Kevin':         '3 rounds for time\n32 Deadlifts 84 kg\n32 Hanging Hip Touches (alternativ)\n800m Running Farmers Carry 7 kg',
  'Klepto':        '4 rounds for time\n27 Box Jumps 61 cm\n20 Burpees\n11 Squat Cleans 66 kg',
  'Kutschbach':    '7 rounds for time\n11 Back Squats 84 kg\n10 Jerks 61 kg',
  'Ledesma':       'AMRAP 20 min\n5 Parallette Handstand Push-ups\n10 Toes Through Rings\n15 Medicine Ball Cleans 9 kg',
  'Lee':           '5 rounds for time\n400m Run\n1 Deadlift 156 kg\n3 Squat Cleans 84 kg\n5 Push Jerks 84 kg\n3 Muscle-ups\n1 Rope Climb 4.5m',
  'Liam':          'For Time\n800m Run (disc 20 kg)\n100 Toes-to-Bar\n50 Front Squats 70 kg\n10 Rope Climbs 4.5m\n800m Run (disc 20 kg)',
  'Loredo':        '6 rounds for time\n24 Air Squats\n24 Push-ups\n24 Walking Lunges\n400m Run',
  'Luce':          '3 rounds for time (vestă 9 kg)\n1 km Run\n10 Muscle-ups\n100 Air Squats',
  'Luke':          'For Time\n400m Run\n15 Clean & Jerks 70 kg\n400m Run\n30 Toes-to-Bar\n400m Run\n45 Wall Balls 9 kg\n400m Run\n45 KB Swings 24 kg\n400m Run\n30 Ring Dips\n400m Run\n15 Weighted Walking Lunges 70 kg\n400m Run',
  'Lumberjack 20': 'For Time\n20 Deadlifts 125 kg\n400m Run\n20 KB Swings 25 kg\n400m Run\n20 Overhead Squats 52 kg\n400m Run\n20 Burpees\n400m Run\n20 Chest-to-Bar Pull-ups\n400m Run\n20 Box Jumps 61 cm\n400m Run\n20 DB Squat Cleans 20 kg (fiecare mână)\n400m Run',
  'Manion':        '7 rounds for time\n400m Run\n29 Back Squats 61 kg',
  'Manuel':        '5 runde a câte 3 min (vestă recomandată; odihnă restul din cele 3 min)\nCățărare pe frânghie (3 min)\nAir Squats (2 min)\nPush-ups (2 min)\n400m Run (in max. 3 min)',
  'Marco':         '3 rounds for time\n21 Pull-ups\n15 Handstand Push-ups\n9 Thrusters 61 kg',
  'Marston':       'AMRAP 20 min\n1 Deadlift 184 kg\n10 Toes-to-Bar\n15 Bar-Facing Burpees',
  'Matt 16':       '3 rounds for time\n16 Deadlifts 125 kg\n16 Hang Power Cleans 84 kg\n16 Push Press 61 kg\n800m Run',
  'Maupin':        '4 rounds for time\n800m Run\n49 Push-ups\n49 Sit-ups\n49 Air Squats',
  'McCluskey':     '3 rounds for time (vestă opțională 9 kg)\n9 Muscle-ups\n15 Burpee Pull-ups\n21 Pull-ups\n800m Run',
  'McGhee':        'AMRAP 30 min\n5 Deadlifts 125 kg\n13 Push-ups\n9 Box Jumps 61 cm',
  'Meadows':       'For Time\n20 Muscle-ups\n25 Ring Inversions\n30 Ring Handstand Push-ups\n35 Ring Rows\n40 Ring Push-ups',
  'Miron':         '5 rounds for time\n800m Run\n23 Back Squats (¾ greutate corp)\n13 Deadlifts (1½ greutate corp)',
  'Monti':         '5 rounds for time\n50 Box Step-ups 51 cm (bara 20 kg)\n15 Cleans 61 kg\n50 Box Step-ups 51 cm (bara 20 kg)\n10 Snatches 61 kg',
  'Moon':          '7 rounds for time\n10 DB Hang Split Snatches 18 kg (braț drept)\n1 Rope Climb 4.5m\n10 DB Hang Split Snatches 18 kg (braț stâng)\n1 Rope Climb 4.5m',
  'Moore':         'AMRAP 20 min\n1 Rope Climb 4.5m\n400m Run\nMax Handstand Push-ups',
  'Morrison':      'For Time 50-40-30-20-10\nWall Balls 9 kg\nBox Jumps 61 cm\nKB Swings 24 kg',
  'Mr. Joshua':    '5 rounds for time\n400m Run\n30 GHD Sit-ups\n15 Deadlifts 113 kg',
  'Nick':          '12 rounds for time\n10 DB Hang Squat Cleans 20 kg\n6 Handstand Push-ups pe gantere',
  'Nickman':       '10 rounds for time (gantere 25 kg si 16 kg)\n200m Farmers Carry\n10 Weighted Pull-ups 16 kg\n20 DB Power Snatches 25 kg (alternativ)',
  'Nukes':         'Time Cap (fără odihnă între segmente)\n8 min: 1 Mile Run (1.6 km) + Max Deadlifts 143 kg\n10 min: 1 Mile Run (1.6 km) + Max Power Cleans 102 kg\n12 min: 1 Mile Run (1.6 km) + Max Overhead Squats 61 kg',
  'Omar':          'For Time\n10 Thrusters 43 kg\n15 Bar-Facing Burpees\n20 Thrusters 43 kg\n25 Bar-Facing Burpees\n30 Thrusters 43 kg\n35 Bar-Facing Burpees',
  'Otis':          'AMRAP 15 min (scară crescătoare 1-2-3...)\nBack Squats (1.5x greutate corp)\nShoulder Press (¾ greutate corp)\nDeadlifts (1.5x greutate corp)',
  'Ozzy':          '7 rounds for time\n11 Deficit Handstand Push-ups\n1000m Run',
  'Pat':           '6 rounds for time (vestă 9 kg)\n25 Pull-ups\n15m Front-Rack Lunge 34 kg\n25 Push-ups\n15m Front-Rack Lunge 34 kg',
  'Paul':          '5 rounds for time\n50 Double-Unders\n35 Knees-to-Elbows\n18m Overhead Walk 84 kg',
  'Paul Pena':     '7 rounds for time (3 min pauză între runde)\n100m Sprint\n19 KB Swings 32 kg\n10 Burpee Box Jumps 61 cm',
  'Pheezy':        '3 rounds for time\n5 Front Squats 75 kg\n18 Pull-ups\n5 Deadlifts 102 kg\n18 Toes-to-Bar\n5 Push Jerks 75 kg\n18 Hand-Release Push-ups',
  'Pike':          '5 rounds for time\n20 Thrusters 34 kg\n10 Strict Ring Dips\n20 Push-ups\n10 Strict Handstand Push-ups\n50m Bear Crawl',
  'PK':            '5 rounds for time (2 min pauză între runde)\n10 Back Squats 102 kg\n10 Deadlifts 125 kg\n400m Sprint',
  'Rahoi':         'AMRAP 12 min\n12 Box Jumps 61 cm\n6 Thrusters 43 kg\n6 Bar-Facing Burpees',
  'Ralph':         '4 rounds for time\n8 Deadlifts 113 kg\n16 Burpees\n3 Rope Climbs 4.5m\n600m Run',
  'Rankel':        'AMRAP 20 min\n6 Deadlifts 102 kg\n7 Burpee Pull-ups\n10 KB Swings 32 kg\n200m Run',
  'René':          '7 rounds for time (vestă opțională 9 kg)\n400m Run\n21 Walking Lunges\n15 Pull-ups\n9 Burpees',
  'Rich':          'For Time\n13 Squat Snatches 70 kg\n— 10 runde —\n10 Pull-ups\n100m Sprint\n13 Squat Cleans 70 kg',
  'Ricky':         'AMRAP 20 min\n10 Pull-ups\n5 DB Deadlifts 34 kg\n8 Push Press 61 kg',
  'Riley':         'For Time (vestă opțională)\n1.5 Mile Run (2.4 km)\n150 Burpees\n1.5 Mile Run (2.4 km)',
  'RJ':            '5 rounds for time\n800m Run\n5 Rope Climbs 4.5m\n50 Push-ups',
  'Robbie':        'AMRAP 25 min\n8 Freestanding Handstand Push-ups\n1 L-Sit Rope Climb 4.5m',
  'Rocket':        'AMRAP 30 min\n46m Swim\n10 Push-ups\n15 Air Squats',
  'Roney':         '4 rounds for time\n200m Run\n11 Thrusters 61 kg\n200m Run\n11 Push Press 61 kg\n200m Run\n11 Bench Press 61 kg',
  'Roy':           '5 rounds for time\n15 Deadlifts 102 kg\n20 Box Jumps 61 cm\n25 Pull-ups',
  'Santiago':      '7 rounds for time\n18 DB Hang Squat Cleans 16 kg\n18 Pull-ups\n10 Power Cleans 61 kg\n10 Handstand Push-ups',
  'Santora':       '3 runde de intervale a câte 1 min (1 min pauză între runde)\nSquat Cleans 70 kg (1 min)\n6m Shuttle Sprint (1 min)\nDeadlifts 111 kg (1 min)\nBurpees (1 min)\nJerks 70 kg (1 min)',
  'Schmalls':      '800m Run, apoi 2 runde\n50 Burpees\n40 Pull-ups\n30 Pistol Squats\n20 KB Swings 24 kg\n10 Handstand Push-ups\n(apoi) 800m Run',
  'Scooter':       'AMRAP 30 min (cu partener), apoi 5 min pt. 1RM Deadlift cu partenerul\n30 Double-Unders\n15 Pull-ups\n15 Push-ups\n100m Sprint',
  'Scotty':        'AMRAP 11 min\n5 Deadlifts 143 kg\n18 Wall Balls 9 kg\n17 Burpees Over the Bar',
  'Sean':          '10 rounds for time\n11 Chest-to-Bar Pull-ups\n22 Front Squats 34 kg',
  'Servais':       'For Time\n2.4 km Run\n— 8 runde —\n19 Pull-ups\n19 Push-ups\n19 Burpees\n400m Sandbag Carry (greu)\n1.6 km Farmers Carry 20 kg',
  'Severin':       'For Time (vestă opțională 9 kg)\n50 Strict Pull-ups\n100 Push-ups (mâinile ridicate jos)\n5 km Run',
  'Sham':          '7 rounds for time\n11 Deadlifts (greutate corp)\n100m Sprint',
  'Shawn':         'For Time (5 mile in intervale de 5 min)\n50 Air Squats\n50 Push-ups\n(după fiecare interval de 5 min)',
  'Sisson':        'AMRAP 20 min (vestă opțională 9 kg)\n1 Rope Climb 4.5m\n5 Burpees\n200m Run',
  'Small':         '3 rounds for time\n1000m Row\n50 Burpees\n50 Box Jumps 61 cm\n800m Run',
  'Smykowski':     'For Time (vestă opțională 14 kg)\n6 km Run\n60 Burpee Pull-ups',
  'Spehar':        'For Time\n100 Thrusters 61 kg\n100 Chest-to-Bar Pull-ups\n9.7 km Run',
  'Stephen':       'For Time 30-25-20-15-10-5\nGHD Sit-ups\nBack Extensions\nKnees-to-Elbows\nStiff-Legged Deadlifts 43 kg',
  'Strange':       '8 rounds for time\n600m Run\n11 Weighted Pull-ups 24 kg\n11 KB Walking Lunges 24 kg\n11 KB Thrusters 24 kg',
  'T':             '5 rounds for time (2 min pauză între runde)\n100m Sprint\n10 Squat Clean Thrusters 52/34 kg\n15 KB Swings 52/34 kg\n100m Sprint',
  'T.J.':          'For Time\n10 Bench Press 84 kg\n10 Strict Pull-ups\nThrusters 61 kg (max set, repetat pana la 100 reps total)',
  'T.U.P.':        'For Time 15-12-9-6-3\nPower Cleans 61 kg\nPull-ups\nFront Squats 61 kg\nPull-ups',
  'Tama':          'For Time\n800m Single-Arm Farmers Carry 20/16 kg\n31 Toes-to-Bar\n31 Push-ups\n31 Front Squats 43/30 kg\n400m Single-Arm Farmers Carry 43/30 kg\n31 Toes-to-Bar\n31 Push-ups\n31 Hang Power Cleans 61/43 kg\n200m Single-Arm Farmers Carry 61/43 kg',
  'Taylor':        '4 rounds for time (vestă opțională 9 kg)\n400m Run\n5 Burpee Muscle-ups',
  'Terry':         'For Time\n1 Mile Run (1.6 km)\n100 Push-ups\n100m Bear Crawl\n1 Mile Run (1.6 km)\n100m Bear Crawl\n100 Push-ups\n1 Mile Run (1.6 km)',
  'The Don':       'For Time\n66 Deadlifts 50 kg\n66 Box Jumps 61 cm\n66 KB Swings 24 kg\n66 Knees-to-Elbows\n66 Sit-ups\n66 Pull-ups\n66 Thrusters 25 kg\n66 Wall Balls 9 kg\n66 Burpees\n66 Double-Unders',
  'The Lyon':      '5 rounds for time (2 min pauză între runde)\n7 Squat Cleans 75 kg\n7 Shoulder-to-Overhead 75 kg\n7 Burpee Chest-to-Bar Pull-ups',
  'The Seven':     '7 rounds for time\n7 Handstand Push-ups\n7 Thrusters 61 kg\n7 Knees-to-Elbows\n7 Deadlifts 111 kg\n7 Burpees\n7 KB Swings 32 kg\n7 Pull-ups',
  'Thompson':      '10 rounds for time (cățărare din poziția șezând)\n1 Rope Climb 4.5m\n29 Back Squats 43 kg\n10m Farmers Carry 61 kg',
  'Tiff':          '25 min (1.5 Mile Run, apoi AMRAP cu timpul rămas)\n1.5 Mile Run (2.4 km)\n11 Chest-to-Bar Pull-ups\n7 Hang Squat Cleans 70 kg\n7 Push Press 70 kg',
  'TK':            'AMRAP 20 min\n8 Strict Pull-ups\n8 Box Jumps 91 cm\n12 KB Swings 32 kg',
  'Tom':           'AMRAP 25 min\n7 Muscle-ups\n11 Thrusters 70 kg\n14 Toes-to-Bar',
  'Tommy V':       'For Time\n21 Thrusters 52 kg\n12 Rope Climbs 4.5m\n15 Thrusters 52 kg\n9 Rope Climbs 4.5m\n9 Thrusters 52 kg\n6 Rope Climbs 4.5m',
  'Tully':         '4 rounds for time\n200m Swim\n23 DB Squat Cleans 18 kg',
  'Tumilson':      '8 rounds for time\n200m Run\n11 DB Burpee Deadlifts 27 kg',
  'Tyler':         '5 rounds for time\n7 Muscle-ups\n21 Sumo Deadlift High-Pulls 43 kg',
  'Viola':         'AMRAP 20 min\n400m Run\n11 Power Snatches 43 kg\n17 Pull-ups\n13 Power Cleans 43 kg',
  'Walsh':         '4 rounds for time\n22 Burpee Pull-ups\n22 Back Squats 84 kg\n200m Run (disc 20 kg deasupra capului)',
  'War Frank':     '3 rounds for time\n25 Muscle-ups\n100 Air Squats\n35 GHD Sit-ups',
  'Weaver':        '4 rounds for time\n10 L-Pull-ups\n15 Push-ups\n15 Chest-to-Bar Pull-ups\n15 Push-ups\n20 Pull-ups\n15 Push-ups',
  'Wes':           'For Time\n800m Run (disc 11 kg)\n— 14 runde —\n5 Strict Pull-ups\n4 Burpee Box Jumps 61 cm\n3 Cleans 84 kg\n800m Run (disc 11 kg)',
  'Weston':        '5 rounds for time\n1000m Row\n200m Farmers Carry 20 kg\n50m Waiter Walk 20 kg (braț drept)\n50m Waiter Walk 20 kg (braț stâng)',
  'White':         '5 rounds for time\n3 Rope Climbs 4.5m\n10 Toes-to-Bar\n21 Walking Lunges (disc 20 kg deasupra capului)\n400m Run',
  'Whitten':       '5 rounds for time\n22 KB Swings 32 kg\n22 Box Jumps 61 cm\n400m Run\n22 Burpees\n22 Wall Balls 9 kg',
  'Willy':         '3 rounds for time\n800m Run\n5 Front Squats 102 kg\n200m Run\n11 Chest-to-Bar Pull-ups\n400m Run\n12 KB Swings 32 kg',
  'Wilmot':        '6 rounds for time\n50 Air Squats\n25 Ring Dips',
  'Wittman':       '7 rounds for time\n15 KB Swings 24 kg\n15 Power Cleans 43 kg\n15 Box Jumps 61 cm',
  'Woehlke':       '3 rounds for time (3 min pauză între runde)\n4 Jerks 84 kg\n5 Front Squats 84 kg\n6 Power Cleans 84 kg\n40 Pull-ups\n50 Push-ups\n60 Sit-ups',
  'Wood':          '5 rounds for time (1 min pauză între runde)\n400m Run\n10 Burpee Box Jumps 61 cm\n10 Sumo Deadlift High-Pulls 43 kg\n10 Thrusters 43 kg',
  'Wyk':           '5 rounds for time\n5 Front Squats 102 kg\n5 Rope Climbs 4.5m\n400m Run (disc 20 kg)',
  'Yeti':          'For Time\n25 Pull-ups\n10 Muscle-ups\n1.5 Mile Run (2.4 km)\n10 Muscle-ups\n25 Pull-ups',
  'Zembiec':       '5 rounds for time\n11 Back Squats 84 kg\n7 Strict Burpee Pull-ups\n400m Run',
  'Zeus':          '3 rounds for time\n30 Wall Balls 9 kg\n30 Sumo Deadlift High-Pulls 34 kg\n30 Box Jumps 51 cm\n30 Push Press 34 kg\n30 Cal Row\n30 Push-ups\n10 Back Squats (greutate corp)',
  'Zimmerman':     'AMRAP 25 min\n11 Chest-to-Bar Pull-ups\n2 Deadlifts 143 kg\n10 Handstand Push-ups',
  // ── Alte benchmark-uri numite (nu fac parte din "The Girls", incluse aici in Hero WODs) ──
  'Filthy Fifty':          'For Time\n50 Box Jumps 61/51 cm\n50 Jumping Pull-ups\n50 KB Swings 16/12 kg\n50 Walking Lunge Steps\n50 Knees-to-Elbows\n50 Push Press 20/15 kg\n50 Back Extensions\n50 Wall Balls 9/6 kg\n50 Burpees\n50 Double-Unders',
  'Fight Gone Bad':        '3 rounds (1 min per stație, 1 min pauză între runde)\nWall Balls 9/6 kg (1 min)\nSumo Deadlift High-Pulls 34/25 kg (1 min)\nBox Jumps 51 cm (1 min)\nPush Press 34/25 kg (1 min)\nCal Row (1 min)',
  'The Chief':             '5 x AMRAP 3 min (1 min pauză între runde)\n3 Power Cleans 61/43 kg\n6 Push-ups\n9 Air Squats',
  'Tabata This':           '5 x Tabata (8 runde de 20 sec lucru / 10 sec pauză, 1 min pauză între exerciții)\nCal Row\nAir Squats\nPull-ups\nPush-ups\nSit-ups',
  'Tabata Something Else': 'AMRAP Tabata (32 intervale de 20 sec lucru / 10 sec pauză, fără pauză între exerciții)\nPull-ups\nPush-ups\nSit-ups\nAir Squats',
}

const PR_CATEGORII = {
  WEIGHTLIFTING: [
    'Back Squat','Front Squat','Overhead Squat','Box Squat','Pause Squat',
    'Shoulder Press','Push Press','Push Jerk','Split Jerk','Bench Press','Strict Press',
    'Deadlift','Romanian Deadlift','Sumo Deadlift','Sumo Deadlift High Pull','Stiff Leg Deadlift',
    'Clean & Jerk','Power Clean','Hang Clean','Hang Power Clean','Squat Clean','Clean Pull',
    'Snatch','Power Snatch','Hang Snatch','Hang Power Snatch','Squat Snatch','Snatch Pull','Snatch Balance',
    'Thruster','Farmers Carry','Turkish Get Up','Good Morning','Hip Thrust',
    'Walking Lunge','Overhead Lunge','Front Rack Lunge',
    // Completare din biblioteca-miscari-crossfit.md - Snatch/Clean/Jerk mai putin comune
    'Clean','Muscle Snatch','Muscle Clean','Snatch from Blocks','Clean from Blocks',
    'Heaving Snatch Balance','Pressing Snatch Balance','Drop Snatch',
    'Snatch High Pull','Clean High Pull','Snatch Deadlift','Clean Deadlift',
    'Snatch-Grip Push Press','Snatch-Grip Behind-the-Neck Press','Sotts Press',
    'Squat Jerk','Power Jerk','Behind-the-Neck Jerk','Jerk Dip','Jerk Drive','Jerk Balance','Tall Jerk',
    'Cluster','Shoulder-to-Overhead','Ground-to-Overhead','Bear Complex','DT Complex',
    // Barbell Strength
    'Tempo Squat','Zercher Squat','Bulgarian Split Squat','Barbell Lunge','Deficit Deadlift','Rack Pull',
    'Close-Grip Bench Press','Incline Bench Press','Decline Bench Press','Floor Press','Z Press','Behind-the-Neck Press',
    'Bent-Over Row','Pendlay Row','Barbell Shrug','Barbell Curl',
    'Landmine Press','Landmine Row','Landmine Rotation','Barbell Rollout',
    // Dumbbell
    'DB Snatch','DB Power Clean','DB Hang Clean','DB Clean & Jerk','DB Push Press','DB Push Jerk',
    'DB Strict Press','DB Thruster','Devil Press','Man Makers',
    'DB Front Squat','DB Overhead Squat','DB Goblet Squat','DB Lunge','DB Overhead Lunge',
    'DB Box Step-up','DB Box Step-over','DB Deadlift','DB Romanian Deadlift','DB Bench Press','DB Floor Press',
    'Single-Arm DB Row','Renegade Row','DB Turkish Get Up','DB Farmers Carry','DB Overhead Carry',
    'DB Front Rack Carry','DB Burpee Deadlift','DB Curl','Lateral Raise','DB Pullover','DB Skull Crusher',
    // Kettlebell
    'KB Dead Clean','KB Clean & Jerk','KB Strict Press','KB Push Press','Bottoms-Up Press','Goblet Squat',
    'Double KB Front Squat','KB Thruster','KB Deadlift','KB Sumo Deadlift','KB Sumo Deadlift High Pull','KB Lunge',
    'KB Windmill','KB Halo','Around the World','KB Row','Gorilla Row','KB Farmers Carry',
    'Suitcase Carry','Rack Carry','Overhead Carry',
    // Strongman / Odd Objects
    'Sandbag Clean','Sandbag to Shoulder','Sandbag Carry','Sandbag Squat','Sandbag Lunge',
    'D-Ball over Shoulder','D-Ball over Bar','Atlas Stone Lift','Yoke Carry','Husafell Carry',
    'Sled Push','Sled Drag','Tire Flip','Sledgehammer Strikes','Log Press',
    'Axle Bar Deadlift','Axle Clean & Press','Keg Carry','Keg Toss',
  ],
  GYMNASTICS: [
    'Air Squat','Pistol Squat',
    'Pull-up','Chest to Bar Pull-up','Muscle-up','Ring Muscle-up','Bar Muscle-up',
    'Toes to Bar','Knees to Elbow','Ring Row','Push-up','Handstand Push-up',
    'Ring Dip','Bar Dip','Handstand Hold','Handstand Walk','L-sit Hold',
    'Box Jump','Broad Jump','Burpee','Double Under','Single Under','Rope Climb',
    'GHD Sit-up','GHD Back Extension',
    'KB Swing','Kettlebell Swing','Russian Kettlebell Swing','American Kettlebell Swing',
    'KB Clean','KB Snatch','KB Goblet Squat','Wall Ball',
    // Completare din biblioteca-miscari-crossfit.md
    'Strict Pull-up','Kipping Pull-up','Butterfly Pull-up','Chin-up','Weighted Pull-up',
    'L Pull-up','Jumping Pull-up','Negative Pull-up','Legless Rope Climb','Peg Board Ascent',
    'Hand-Release Push-up','Deficit Push-up','Ring Push-up','Parallette Push-up','Bench Dip',
    'Strict Handstand Push-up','Deficit Handstand Push-up','Wall-Facing Handstand Push-up',
    'Freestanding Handstand Push-up','Handstand Walk over Obstacle','Handstand Pirouette','Wall Walk','Shoulder Taps',
    'Toes to Ring','Hanging Knee Raise','Skin the Cat','Front Lever','Back Lever',
    'Jumping Squat','Lunge','Jumping Lunge','Step-up','Vertical Jump',
    'Bar-Facing Burpee','Lateral Burpee','Burpee Pull-up','Burpee to Target',
    'Burpee Box Jump','Burpee Box Jump Over','Burpee Broad Jump','Burpee Muscle-up',
    'Bear Crawl','Crab Walk','Duck Walk','Candlestick Roll','Forward Roll',
    'Box Jump Over','Box Step-up','Box Step-over','Seated Box Jump','Lateral Box Jump','Box Dip','Depth Jump',
    'Wall Ball Sit-up','Medicine Ball Clean','Med Ball Slam','Med Ball Toss','Med Ball Run','Rotational Med Ball Throw',
    'GHD Hip Extension','V-up','Tuck-up','Hollow Hold','Hollow Rock','Arch Hold','Superman',
    'Plank','Side Plank','Sit-up','Weighted Sit-up','Russian Twist','Ab Wheel Rollout','Dragon Flag','Reverse Hyper',
  ],
  // Cardio separat de CARDIO_MISCARI (care alimenteaza si detectarea automata
  // metri/cal la logare) - Triple Under/Stair Climb/Ruck sunt cardio dar nu
  // se masoara in metri/calorii, deci n-ar trebui sa primeasca acele casute.
  CARDIO: [...CARDIO_MISCARI, 'Triple Under', 'Double Under Crossover', 'Stair Climb', 'Ruck'],
  HERO_WODS: Object.keys(HERO_WODS_INFO),
}


function NavBarDebug({ navRef }) {
  const [info, setInfo] = useState(null)
  const [loadTrace, setLoadTrace] = useState(null)
  useEffect(() => {
    // trace-ul se scrie progresiv in localStorage timp de 4s dupa incarcare -
    // daca citim o singura data la mount (posibil doar la 25ms din acele 4s),
    // vedem doar un fragment incomplet. Recitim periodic pana se stabilizeaza.
    const readTrace = () => {
      try {
        const raw = localStorage.getItem('__loadTrace')
        if (!raw) return
        const samples = JSON.parse(raw)
        const condensed = []
        let lastT = -999
        for (const s of samples) {
          if (s.t - lastT >= 150 || s === samples[samples.length - 1]) {
            condensed.push(s)
            lastT = s.t
          }
        }
        setLoadTrace(condensed)
      } catch {}
    }
    readTrace()
    const interval = setInterval(readTrace, 500)
    const timeout = setTimeout(() => clearInterval(interval), 5000)
    return () => { clearInterval(interval); clearTimeout(timeout) }
  }, [])
  useEffect(() => {
    const measure = () => {
      const navRect = navRef.current?.getBoundingClientRect()
      const rootEl = document.getElementById('root')
      const rootRect = rootEl?.getBoundingClientRect()
      const appFrameEl = document.querySelector('.app-frame')
      const appFrameRect = appFrameEl?.getBoundingClientRect()
      const probe = document.createElement('div')
      probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden'
      document.body.appendChild(probe)
      const safeAreaPx = getComputedStyle(probe).height
      document.body.removeChild(probe)
      const vv = window.visualViewport
      setInfo({
        t: new Date().toLocaleTimeString('ro-RO', { hour12: false }),
        activeEl: document.activeElement?.tagName + (document.activeElement?.type ? `[${document.activeElement.type}]` : ''),
        innerHeight: window.innerHeight,
        appVhVar: getComputedStyle(document.documentElement).getPropertyValue('--app-vh'),
        vvHeight: vv?.height ?? 'n/a',
        vvOffsetTop: vv?.offsetTop ?? 'n/a',
        vvScale: vv?.scale ?? 'n/a',
        screenHeight: window.screen?.height ?? 'n/a',
        rootTop: rootRect?.top,
        rootBottom: rootRect?.bottom,
        appFrameTop: appFrameRect?.top,
        appFrameBottom: appFrameRect?.bottom,
        navTop: navRect?.top,
        navBottom: navRect?.bottom,
        gapVsInnerHeight: navRect ? (window.innerHeight - navRect.bottom) : 'n/a',
        gapVsVisualViewport: navRect && vv ? ((vv.height + vv.offsetTop) - navRect.bottom) : 'n/a',
        safeAreaPx,
      })
    }
    measure()
    const interval = setInterval(measure, 250)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    return () => {
      clearInterval(interval)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('scroll', measure)
    }
  }, [navRef])
  if (!info) return null
  return (
    <div style={{ position: 'fixed', top: '8px', left: '8px', right: '8px', background: 'rgba(0,0,0,0.92)', color: '#0f0', fontFamily: 'monospace', fontSize: '11px', padding: '12px', borderRadius: '10px', zIndex: 999, lineHeight: 1.5, maxHeight: '70vh', overflowY: 'auto' }}>
      {Object.entries(info).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}
      {loadTrace && (
        <>
          <div style={{ marginTop: '10px', color: '#ff0', fontWeight: 'bold' }}>ISTORIC PRIMELE 4s DUPA INCARCARE:</div>
          <div style={{ color: '#888' }}>t(ms) innerH root frame navBottom</div>
          {loadTrace.map((s, i) => (
            <div key={i}>{String(s.t).padStart(4)}  {String(s.innerH).padStart(4)}  {String(s.rootH).padStart(4)}  {String(s.appFrameH).padStart(4)}  {String(s.navBottom).padStart(4)}</div>
          ))}
        </>
      )}
      <div onClick={() => { localStorage.removeItem('navDebug'); window.location.reload() }} style={{ marginTop: '10px', color: '#f66', cursor: 'pointer' }}>[inchide]</div>
    </div>
  )
}

const NAV_TABS = [
  { id: 'home', labelKey: 'navHome', icon: Home },
  { id: 'log', labelKey: 'navLog', icon: PenLine },
  { id: 'pr', labelKey: 'navPr', icon: Trophy },
  { id: 'clasament', labelKey: 'navLeaderboard', icon: Medal },
  { id: 'feed', labelKey: 'navFeed', icon: MessageCircle },
]

function NavBar({ screen, setScreen, isAdmin, isCoach, feedUnread, t }) {
  // 2026-07-02, noaptea: renuntat definitiv la position:fixed pt NavBar, dupa o
  // seara intreaga de incercari esuate de a masura corect inaltimea ecranului
  // in standalone iOS (vezi [[project-navbar-safe-area]] pt istoricul complet).
  // NavBar e acum un element normal in flow-ul flex al .app-frame (ultimul
  // copil, langa zona de continut care scroleaza) - nu mai depinde deloc de
  // innerHeight/dvh/screen.height, deci nu mai poate "sari"/disparea din cauza
  // vreunei masuratori gresite de viewport.
  const navRef = useRef(null)
  const showDebug = typeof window !== 'undefined' && localStorage.getItem('navDebug') === '1'
  const tabs = (isAdmin || isCoach) ? [...NAV_TABS, { id: 'admin', labelKey: isAdmin ? 'navAdmin' : 'navCoach', icon: Settings }] : NAV_TABS
  return (
    <>
    {showDebug && <NavBarDebug navRef={navRef} />}
    <nav
      ref={navRef}
      className="flex w-full flex-shrink-0 flex-col border-t border-gray-200 bg-white"
    >
      <div className="flex items-center justify-around" style={{ paddingTop: '10px', paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }}>
        {tabs.map(({ id, labelKey, icon: Icon }) => {
          const isActive = screen === id
          const badge = id === 'feed' && feedUnread > 0 ? feedUnread : null
          return (
            <button
              key={id}
              onClick={() => setScreen(id)}
              className="relative flex flex-col items-center gap-1 px-2 py-1"
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} color={isActive ? '#afe607' : '#000000'} />
              <span className="text-[10px]" style={{ color: '#000000', fontWeight: isActive ? 600 : 400, whiteSpace: 'nowrap' }}>
                {t[labelKey]}
              </span>
              {badge != null && (
                <span className="absolute -top-1 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-[1.5px] border-white bg-[#E8192C] px-1 text-[11px] font-bold text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
    </>
  )
}

function CautareMiscare({ onAleage, preFill, t, label }) {
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
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{label || t.cautareMiscareLabel}</div>
      <input value={query} onChange={e => cauta(e.target.value)} placeholder={t.cautareMiscarePlaceholder}
        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: aleasa ? '2px solid #0E0E0E' : '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', outline: 'none' }} />
      {sugestii.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '4px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
          {sugestii.map((s, i) => (
            <div key={i} onClick={() => alege(s)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', borderBottom: i < sugestii.length - 1 ? '1px solid #FFFFFF' : 'none' }}>{s}</div>
          ))}
          <div onClick={() => alege(query)} style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '12px', color: '#0E0E0E', fontWeight: '500', background: '#f0f0f0' }}>
            {t.cautareMiscareAddNew(query)}
          </div>
        </div>
      )}
    </div>
  )
}

// Numele miscarii (cu autocomplete) + reps/greutate ca doua casute separate,
// aparute doar dupa ce ai inceput sa scrii - compunem automat acelasi text
// "21 Thrusters @ 43kg" care se salva si inainte (nimic nu se schimba in
// restul aplicatiei), doar introducerea nu mai cere sa scrii totul manual
// intr-un singur camp.
// hideWeight: doar reps, fara casuta de greutate per miscare - folosit la
// editorul de variante din Admin, unde greutatea WOD-ului se seteaza o
// singura data prin Greutate M/F (per varianta), nu per miscare; celelalte
// utilizari (logare libera, editare log, Hero WOD) n-au un echivalent de
// greutate la nivel de WOD, deci pastreaza campul de greutate per miscare.
function MiscareQuickAdd({ value, onChange, onAdd, placeholder, weightUnit, t, hideWeight }) {
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [metri, setMetri] = useState('')
  const [cal, setCal] = useState('')
  const [justSelected, setJustSelected] = useState(false)
  const repsRef = useRef(null)
  const metriRef = useRef(null)
  // Miscari cardio (Run/Row/Bike/Ski Erg...) - reps+greutate n-au sens acolo,
  // se logheaza in metri si/sau calorii. Detectat pe numele exact (dupa ce a
  // fost ales complet, nu in timp ce se tasteaza partial).
  const isCardio = CARDIO_MISCARI.some(c => c.toLowerCase() === value.trim().toLowerCase())
  // Dupa ce alegi o sugestie, nu o mai arata din nou ca sugestie (altfel
  // ramane vizibila peste casutele de reps/greutate) - dispare de indata ce
  // userul mai scrie ceva in campul de miscare.
  const sugestii = justSelected ? [] : miscareSugestii(value)
  const compose = (movementName) => {
    const parts = []
    if (isCardio) {
      if (metri.trim()) parts.push(`${metri.trim()}m`)
      if (cal.trim()) parts.push(`${cal.trim()} Cal`)
      parts.push(movementName.trim())
      return parts.join(' ')
    }
    if (reps.trim()) parts.push(reps.trim())
    parts.push(movementName.trim())
    let text = parts.join(' ')
    if (!hideWeight && weight.trim()) text += ` @ ${weight.trim()}${weightUnit === 'lbs' ? 'lbs' : 'kg'}`
    return text
  }
  const add = () => {
    if (!value.trim()) return
    onAdd(compose(value))
    onChange(''); setReps(''); setWeight(''); setMetri(''); setCal(''); setJustSelected(false)
  }
  // Click pe o sugestie completeaza doar numele miscarii si muta focusul pe
  // "reps" (sau "metri" la cardio) - nu adauga inca (userul vrea sa
  // completeze imediat dupa ce alege miscarea, nu sa sara direct la
  // urmatoarea). useEffect (nu requestAnimationFrame) ca sa ruleze sigur dupa
  // ce React a randat inputul (care nu exista in DOM pana valoarea nu e
  // completata).
  useEffect(() => {
    if (justSelected) (isCardio ? metriRef : repsRef).current?.focus()
  }, [justSelected, isCardio])
  const alege = (m) => {
    onChange(m)
    setJustSelected(true)
  }
  const onEnterCommit = (e) => { if (e.key === 'Enter') add() }
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <input value={value} onChange={e => { onChange(e.target.value); setJustSelected(false) }}
          onKeyDown={onEnterCommit}
          placeholder={placeholder} style={{ flex: '1 1 140px', minWidth: 0, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
        {value.trim() && (isCardio ? (
          <>
            <input ref={metriRef} type="number" value={metri} onChange={e => setMetri(e.target.value)}
              onKeyDown={onEnterCommit} disabled={!!cal.trim()}
              placeholder="metri"
              style={{ flex: '0 0 64px', minWidth: 0, padding: '10px 8px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: cal.trim() ? '#f0f0f0' : '#fafafa', color: cal.trim() ? '#bbb' : '#0E0E0E', boxSizing: 'border-box' }} />
            <input type="number" value={cal} onChange={e => setCal(e.target.value)}
              onKeyDown={onEnterCommit} disabled={!!metri.trim()}
              placeholder="cal"
              style={{ flex: '0 0 64px', minWidth: 0, padding: '10px 8px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: metri.trim() ? '#f0f0f0' : '#fafafa', color: metri.trim() ? '#bbb' : '#0E0E0E', boxSizing: 'border-box' }} />
          </>
        ) : (
          <>
            <input ref={repsRef} type="number" value={reps} onChange={e => setReps(e.target.value)}
              onKeyDown={onEnterCommit}
              placeholder={t?.skillLogRepsPlaceholder || 'reps'}
              style={{ flex: '0 0 64px', minWidth: 0, padding: '10px 8px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            {!hideWeight && (
              <input type="number" value={weight} onChange={e => setWeight(e.target.value)}
                onKeyDown={onEnterCommit}
                placeholder={weightUnit === 'lbs' ? 'lbs' : 'kg'}
                style={{ flex: '0 0 64px', minWidth: 0, padding: '10px 8px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            )}
          </>
        ))}
        <button onClick={add}
          style={{ padding: '10px 14px', borderRadius: '10px', background: '#ABE73C', color: '#0E0E0E', border: 'none', fontSize: '20px', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>+</button>
      </div>
      <MovementSuggestions suggestions={sugestii} onSelect={alege} rightOffset="46px" />
    </div>
  )
}

function Timer({ onBack, defaultFortime, t }) {
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
    { id: 'fortime', icon: TimerIcon, lbl: 'For Time' },
    { id: 'amrap', icon: RotateCw, lbl: 'AMRAP' },
    { id: 'emom', icon: Clock, lbl: 'EMOM' },
    { id: 'tabata', icon: Flame, lbl: 'Tabata' },
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
  const culoareRing = gata ? '#0E0E0E' : mod === 'tabata' && tabataFaza === 'odihna' ? '#1D9E75' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#0E0E0E'
  const culoareText = gata ? '#0E0E0E' : secunde <= 5 ? '#E24B4A' : secunde <= 15 ? '#BA7517' : '#0E0E0E'
  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
        <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '8px' }}>Timer <TimerIcon size={20} color="#0E0E0E" strokeWidth={2} /></h1>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '16px' }}>
        {moduri.map(m => (
          <div key={m.id} onClick={() => setMod(m.id)}
            style={{ width: '72px', height: '72px', borderRadius: '12px', textAlign: 'center', cursor: 'pointer', border: mod === m.id ? '2px solid #0E0E0E' : '1px solid #e0e0e0', background: mod === m.id ? '#f0f0f0' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <m.icon size={18} color={mod === m.id ? '#0E0E0E' : '#888'} strokeWidth={2} />
            <div style={{ fontSize: '9px', fontWeight: mod === m.id ? '600' : '400', color: mod === m.id ? '#0E0E0E' : '#888' }}>{m.lbl}</div>
          </div>
        ))}
      </div>
      {countdown === null && (
        <div style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          {mod === 'fortime' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Time cap</div><div style={{ fontSize: '11px', color: '#888' }}>{t.timerTimeCapSubtitle}</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button onClick={() => { setConfig(p => ({ ...p, fortime: Math.max(1, p.fortime - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.fortime} min</span>
                <button onClick={() => { setConfig(p => ({ ...p, fortime: Math.min(60, p.fortime + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          {mod === 'amrap' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><div style={{ fontSize: '13px', fontWeight: '500' }}>{t.timerAmrapDurationLabel}</div><div style={{ fontSize: '11px', color: '#888' }}>As Many Rounds As Possible</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button onClick={() => { setConfig(p => ({ ...p, amrap: Math.max(1, p.amrap - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.amrap} min</span>
                <button onClick={() => { setConfig(p => ({ ...p, amrap: Math.min(60, p.amrap + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          {mod === 'emom' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>{t.timerEmomTotalDurationLabel}</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, emom: Math.max(1, p.emom - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.emom} min</span>
                  <button onClick={() => { setConfig(p => ({ ...p, emom: Math.min(30, p.emom + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>{t.timerIntervalLabel}</div><div style={{ fontSize: '11px', color: '#888' }}>{t.timerSecondsPerMinuteSubtitle}</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, emomInterval: Math.max(10, p.emomInterval - 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '50px', textAlign: 'center' }}>{config.emomInterval}s</span>
                  <button onClick={() => { setConfig(p => ({ ...p, emomInterval: Math.min(120, p.emomInterval + 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </>
          )}
          {mod === 'tabata' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>{t.timerRoundsLabel}</div><div style={{ fontSize: '11px', color: '#888' }}>Standard: 8</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataRunde: Math.max(1, p.tabataRunde - 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '30px', textAlign: 'center' }}>{config.tabataRunde}</span>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataRunde: Math.min(20, p.tabataRunde + 1) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>{t.timerWorkIntervalLabel}</div><div style={{ fontSize: '11px', color: '#888' }}>Standard: 20 sec</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataLucru: Math.max(5, p.tabataLucru - 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{config.tabataLucru}s</span>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataLucru: Math.min(60, p.tabataLucru + 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: '13px', fontWeight: '500' }}>{t.timerRestIntervalLabel}</div><div style={{ fontSize: '11px', color: '#888' }}>Standard: 10 sec</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataOdihna: Math.max(5, p.tabataOdihna - 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
                  <span style={{ fontSize: '16px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{config.tabataOdihna}s</span>
                  <button onClick={() => { setConfig(p => ({ ...p, tabataOdihna: Math.min(60, p.tabataOdihna + 5) })); reset() }} style={{ width: '30px', height: '30px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      {countdown !== null && (
        <div style={{ background: '#0E0E0E', borderRadius: '20px', padding: '40px 20px', marginBottom: '14px', textAlign: 'center' }}>
          <div style={{ fontSize: '13px', color: '#ABE73C', marginBottom: '8px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{t.timerGetReady}</div>
          <div style={{ fontSize: '80px', fontWeight: '700', color: '#fff', lineHeight: 1 }}>{countdown}</div>
          <div style={{ fontSize: '14px', color: '#ABE73C', marginTop: '8px' }}>
            {countdown <= 3 ? ['', '🔴', '🟡', '🟢'][countdown] + ' ' : ''}{countdown === 1 ? t.timerCountdownGo : countdown <= 3 ? countdown : t.timerCountdownSeconds}
          </div>
        </div>
      )}
      {countdown === null && (
        <div style={{ background: '#fff', borderRadius: '14px', padding: '20px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          {mod === 'emom' && <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>{t.timerEmomMinuteLabel(minutEmom, config.emom)}</div>}
          {mod === 'tabata' && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '6px' }}>{t.timerTabataRoundLabel(tabataRunda, config.tabataRunde)}</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 16px', borderRadius: '20px', background: tabataFaza === 'lucru' ? '#FCEBEB' : '#f0f0f0', color: tabataFaza === 'lucru' ? '#791F1F' : '#0E0E0E', fontSize: '12px', fontWeight: '600' }}>
                {tabataFaza === 'lucru' ? <Flame size={13} color="#791F1F" /> : <span>😴</span>}
                {tabataFaza === 'lucru' ? t.timerWorkPhase(config.tabataLucru) : t.timerRestPhase(config.tabataOdihna)}
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
              {gata && <div style={{ fontSize: '14px', color: '#0E0E0E', fontWeight: '600', marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>{t.timerDoneLabel} <Dumbbell size={15} color="#0E0E0E" /></div>}
              {!gata && running && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{t.timerInProgress}</div>}
              {!gata && !running && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{secunde === getSec() ? t.timerPressStart : t.timerPaused}</div>}
            </div>
          </div>
          {mod === 'emom' && (
            <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '6px', marginBottom: '12px' }}>
              <div style={{ width: (pct * 100) + '%', height: '6px', borderRadius: '4px', background: culoareRing, transition: 'width 0.9s linear' }} />
            </div>
          )}
          {mod === 'amrap' && (
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.timerRoundsCounterLabel}</div>
              <div style={{ fontSize: '42px', fontWeight: '700', color: '#0E0E0E' }}>{runde}</div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '6px' }}>
                <button onClick={() => setRunde(r => Math.max(0, r - 1))} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '18px', cursor: 'pointer' }}>−</button>
                <button onClick={() => setRunde(r => r + 1)} style={{ width: '34px', height: '34px', borderRadius: '50%', border: '2px solid #0E0E0E', background: '#f0f0f0', fontSize: '18px', color: '#0E0E0E', fontWeight: '700', cursor: 'pointer' }}>+</button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', alignItems: 'center' }}>
            <button onClick={reset} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '20px', cursor: 'pointer' }}>↺</button>
            <button onClick={toggleTimer} style={{ width: '64px', height: '64px', borderRadius: '50%', border: 'none', background: gata ? '#f0f0f0' : running ? '#BA7517' : '#0E0E0E', color: gata ? '#0E0E0E' : '#fff', fontSize: '24px', cursor: gata ? 'default' : 'pointer', transition: 'background 0.2s' }}>
              {gata ? '✓' : running ? '⏸' : '▶'}
            </button>
            {mod === 'amrap'
              ? <button onClick={() => setRunde(r => r + 1)} style={{ width: '48px', height: '48px', borderRadius: '50%', border: '1px solid #0E0E0E', background: '#f0f0f0', color: '#0E0E0E', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>+1</button>
              : <div style={{ width: '48px' }} />
            }
          </div>
        </div>
      )}
      {countdown !== null && (
        <button onClick={reset} style={{ width: '100%', padding: '12px', background: 'transparent', color: '#888', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '13px', cursor: 'pointer' }}>
          {t.timerCancel}
        </button>
      )}
    </div>
  )
}

function Clasament({ logs, loading, wodZiData, onRefresh, selectedDate, onDateChange, t, lang }) {
  const [genderTab, setGenderTab] = useState('toti')
  // Card-ul de participant se extinde la click, aratand exact ce a logat
  // (miscari/rezultat/seturi/nota) - acelasi format ca in Jurnal, dar
  // read-only (fara editare/stergere, e logul altcuiva).
  const [expandedLogId, setExpandedLogId] = useState(null)
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const isToday = selectedDate === todayStr
  // getFormat(undefined) cade tacit pe 'For Time' (fortime_or_amrap +
  // sequentialPartial) - intr-o zi fara WOD programat (wodZiData null), dar cu
  // loguri vechi/orfane inca in intervalul de date, asta ar trata gresit acele
  // loguri ca fiind "neterminate in time cap" (isNotRxd) sau "secventiale"
  // (sortLogs), doar pentru ca formatul necunoscut a cazut pe un fallback
  // arbitrar. Calculat o singura data (nu per nivel/log) - null cand nu stim
  // real formatul zilei, nu un fallback ghicit.
  const wodZiFormat = wodZiData?.type ? getFormat(wodZiData.type) : null
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
    if (!str) return null
    const match = str.match(/(\d+(\.\d+)?)/)
    return match ? parseFloat(match[1]) : null
  }

  // Suma reps-urilor din runda partiala/neterminata ("6 runde + 5 Pull-ups, 3
  // Push-ups" -> 8) - la AMRAP (si la RFT/Ladder neterminate) doua persoane
  // pot avea acelasi numar de runde complete dar cantitati diferite de munca
  // in runda ramasa neterminata; fara asta erau departajate arbitrar (dupa
  // ordinea din raspunsul serverului), nu dupa cine a muncit mai mult.
  // Reps-ul FACUT (nu prescris) din runda partiala, per miscare. Formatul nou
  // "facut/prescris Miscare" (ex. "3/15 Power Snatches", vezi composePartialText
  // in workoutFormats.js) are 2 numere per segment - fara sa luam doar primul,
  // suma insuma gresit si numarul prescris (3+15=18 in loc de 3 facute).
  // La formate secventiale (For Time/Ladder - sequentialPartial), rezultatul
  // compus n-are prefixul "N runde +" (nu exista concept de runda) - tot
  // textul e direct lista de segmente "facut/prescris miscare". La restul
  // formatelor (AMRAP/RFT), segmentele de dupa '+' raman singura sursa.
  const partialRepsOf = (log, isSequential) => {
    const str = log.result || ''
    let segment
    if (isSequential) {
      segment = str
    } else {
      const plusIdx = str.indexOf('+')
      if (plusIdx === -1) return 0
      segment = str.slice(plusIdx + 1)
    }
    return segment.split(',').reduce((sum, seg) => {
      const match = seg.trim().match(/^(\d+(\.\d+)?)/)
      return match ? sum + parseFloat(match[1]) : sum
    }, 0)
  }

  // Clasare: intai cine a facut mai multe runde (cine a terminat tot WOD-ul
  // fara sa noteze runde partiale e egalat cu maximul de runde notat explicit
  // in sectiune - nu poate fi mai mult decat atat), apoi in cadrul aceluiasi
  // numar de runde cine a muncit mai mult in runda neterminata (AMRAP), apoi
  // cine a fost mai rapid. Nu se mai compara direct timpul intre cineva care
  // n-a terminat WOD-ul si cineva care a terminat (bug raportat: cineva cu
  // mai putine runde aparea inaintea celor cu mai multe, doar pentru ca
  // timpul lui brut de oprire era mai mic).
  // Clasare in 2 nivele stricte, nu un singur numar "runde efective" comparat
  // direct intre toata lumea: (1) cine a terminat (are time_result) - mereu
  // inaintea (2) cine n-a terminat (are doar runde+reps partiale), indiferent
  // de valori numerice. Incercarea anterioara de a da finisherilor un numar
  // de "runde efective" (aproximat din ce au notat non-finisherii sau din
  // format_config.rounds) esua exact la formate fara un numar real de runde
  // prescrise (For Time/Ladder/Chipper, unde miscarile sunt o secventa, nu
  // runde repetate) - un non-finisher cu reps partiale mari putea depasi
  // numeric un finisher real. Verificarea stricta pe time_result elimina
  // complet ambiguitatea: a terminat = are timp, punct.
  // Scorul de afisat/clasat pt un log family:'sets' (Weightlifting/Build to
  // Heavy/1RM/Strength Sets/Complex/Superset/Death By Weight/Tabata/Intervals)
  // - vezi setsDisplayScore in workoutFormats.js.
  const setsScoreOf = (log) => setsDisplayScore(wodZiData?.type, wodZiData?.format_config, log.sets)

  const sortLogs = (arr) => {
    // Family 'sets' nu foloseste deloc time_result/result - composeWodLogFields
    // le lasa null pt aceste formate, rezultatul real e in `sets` (structurat
    // pe randuri). Fara ramura asta, TOATE log-urile family:'sets' cadeau pe
    // "neterminat" (finished mereu false, time_result mereu null) si erau
    // departajate doar dupa ordinea de logare, indiferent cat de greu s-a
    // lucrat efectiv (bug raportat: 5 seturi reale, 90->100kg logate, aparea
    // "-" pe Clasament, nesortat dupa performanta). Scorul e calculat o
    // singura data si atasat pe log (_setsScore), reutilizat la afisare in
    // randarea Clasamentului, fara sa recalculam.
    if (wodZiFormat?.family === 'sets') {
      const withScore = arr.map(log => ({ ...log, _setsScore: setsScoreOf(log) }))
      const comparaSets = (a, b) => {
        if (a._setsScore == null && b._setsScore == null) return new Date(a.logged_at) - new Date(b.logged_at)
        if (a._setsScore == null) return 1
        if (b._setsScore == null) return -1
        if (a._setsScore !== b._setsScore) return b._setsScore - a._setsScore
        return new Date(a.logged_at) - new Date(b.logged_at)
      }
      const byMemberSets = {}
      withScore.forEach(log => {
        const id = log.member_id
        if (!byMemberSets[id] || comparaSets(log, byMemberSets[id]) < 0) byMemberSets[id] = log
      })
      return Object.values(byMemberSets).sort(comparaSets)
    }
    const finished = (log) => !!log.time_result
    // La formate secventiale (For Time/Ladder), rezultatul non-finisherilor
    // nu are un numar de "runde" real de comparat (parseScore ar extrage
    // doar numarul primei miscari din text, irelevant) - departajarea se
    // face direct pe total reps facute (partialRepsOf).
    const isSequential = isSequentialFormat(wodZiData?.type, wodZiData?.format_config)
    // Fiecare comparatie numerica poate produce NaN cand ambele loguri au
    // aceeasi valoare "goala" (Infinity - Infinity la timp) - un comparator
    // Array.sort care intoarce NaN nu are comportament garantat de
    // specificatie. Verificam explicit NaN la fiecare pas si cadem pe
    // urmatorul nivel, cu ordinea cronologica drept fallback final.
    const compara = (a, b) => {
      const fa = finished(a), fb = finished(b)
      if (fa !== fb) return fa ? -1 : 1
      if (fa) {
        const diffTime = parseTime(a.time_result) - parseTime(b.time_result)
        if (diffTime !== 0 && !Number.isNaN(diffTime)) return diffTime
        return new Date(a.logged_at) - new Date(b.logged_at)
      }
      if (!isSequential) {
        const diffRunde = (parseScore(b.result) || 0) - (parseScore(a.result) || 0)
        if (diffRunde !== 0) return diffRunde
      }
      const diffPartial = partialRepsOf(b, isSequential) - partialRepsOf(a, isSequential)
      if (diffPartial !== 0) return diffPartial
      return new Date(a.logged_at) - new Date(b.logged_at)
    }
    const byMember = {}
    arr.forEach(log => {
      const id = log.member_id
      if (!byMember[id] || compara(log, byMember[id]) < 0) byMember[id] = log
    })
    return Object.values(byMember).sort(compara)
  }

  const NIVELE = [
    { id: 'RX', culoare: '#791F1F', bg: '#FCEBEB' },
    { id: 'Intermediate', culoare: '#633806', bg: '#FAEEDA' },
    { id: 'Beginner', culoare: '#0E0E0E', bg: '#f0f0f0' },
    { id: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB' },
  ]

  // Un membru poate avea mai multe log-uri pentru acelasi WOD (relogat din
  // greseala, sau a incercat alta varianta) - fara dedup GLOBAL (pe toate
  // nivelele), ar aparea cate o data in fiecare sectiune in care are un log
  // (ex: si la Intermediate, si la RX). Pastram doar cel mai recent log al
  // fiecarui membru pentru acest WOD, indiferent de nivel - nivelul acelui
  // log e cel care decide in ce sectiune apare.
  const dedupLogsGlobal = (arr) => {
    const byMember = {}
    arr.forEach(log => {
      const curr = byMember[log.member_id]
      if (!curr || new Date(log.logged_at) > new Date(curr.logged_at)) byMember[log.member_id] = log
    })
    return Object.values(byMember)
  }
  const logsUnicePerMembru = dedupLogsGlobal(logs)

  const getSectionLogs = (nivelId) => {
    const sorted = sortLogs(logsUnicePerMembru.filter(l => l.variant_level === nivelId))
    if (genderTab === 'masculin') return sorted.filter(l => l.profile?.gender === 'masculin')
    if (genderTab === 'feminin') return sorted.filter(l => l.profile?.gender === 'feminin')
    return sorted
  }

  const totalLogs = NIVELE.reduce((acc, n) => acc + getSectionLogs(n.id).length, 0)

  // Cine scaleaza greutatea nu poate concura corect cu cine face greutatea
  // integrala - fara asta, cineva la 40kg si cineva la 61kg apareau pe
  // aceeasi lista, clasati doar dupa timp/reps, ca si cum ar fi comparabili.
  // Daca varianta n-are greutate prescrisa configurata, comportament identic
  // cu inainte (un singur grup, fara header suplimentar) - compatibil 100%
  // cu WOD-urile vechi. `sectionLogs` e deja sortat de sortLogs() - un filtru
  // pe un array sortat pastreaza ordinea relativa, deci fiecare subgrup
  // ramane corect sortat intern fara sa resortam.
  // Greutatea prescrisa difera pe gen (RX barbati 61kg vs RX femei 43kg) -
  // fiecare log se compara cu prescrisul GENULUI SAU, nu cu o singura valoare
  // per varianta (relevant mai ales pe tab-ul "Toti", unde sectiunea
  // amesteca ambele genuri). Daca genul lui n-are greutate configurata deloc,
  // e considerat RX implicit (identic cu comportamentul dinainte de feature).
  const prescribedWeightFor = (nivelId, log) => wodZiData?.[weightKeyForVariant(nivelId, log.profile?.gender)] || null
  const getWeightGroups = (nivelId, sectionLogs) => {
    // Un singur pas peste sectionLogs (nu 2 filter-e care re-evalueaza isRx
    // per log) - foloseste weightMatches (aceeasi normalizare ca isNotRxd),
    // altfel gruparea putea decide diferit fata de badge-ul "Not RXd" pt
    // acelasi log. Cheia de grupare foloseste canonicalWeightKey (acelasi
    // numeric/text normalizat) - altfel "40kg" si "40KG" (aceeasi greutate,
    // scrisa diferit) ar aparea in 2 sub-grupuri separate in loc sa fie
    // clasati impreuna. Pastram si textul original (primul intalnit) pentru
    // afisare - cheia canonica poate fi doar numarul, fara unitate.
    const rxLogs = []
    const scaledByWeight = {}
    sectionLogs.forEach(log => {
      // prescribedWeight atasat direct pe log (nu doar folosit local) - randarea
      // de mai jos il reutilizeaza la isNotRxd, in loc sa cheme prescribedWeightFor
      // a treia oara pt acelasi log.
      const prescribedWeight = prescribedWeightFor(nivelId, log)
      const logCuGreutate = { ...log, _prescribedWeight: prescribedWeight }
      const isRx = !prescribedWeight || !log.weight_logged?.trim() || weightMatches(log.weight_logged, prescribedWeight)
      if (isRx) { rxLogs.push(logCuGreutate); return }
      const raw = log.weight_logged.trim()
      const key = canonicalWeightKey(raw)
      if (!scaledByWeight[key]) scaledByWeight[key] = { display: raw, logs: [] }
      scaledByWeight[key].logs.push(logCuGreutate)
    })
    const scaledGroups = Object.entries(scaledByWeight)
      .map(([key, { display, logs }]) => ({ weight: key, label: t.clasamentScaledGroupLabel(display), logs }))
      .sort((a, b) => {
        const na = parseFloat(a.weight), nb = parseFloat(b.weight)
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return nb - na
        if (Number.isNaN(na) !== Number.isNaN(nb)) return Number.isNaN(na) ? 1 : -1
        return 0
      })
    // Fara nimeni scalat (sau varianta n-are greutate prescrisa configurata
    // pe niciun gen), un singur grup, fara header suplimentar - identic cu
    // comportamentul dinainte de feature.
    if (scaledGroups.length === 0) return [{ weight: null, label: null, logs: rxLogs }]
    return [{ weight: null, label: null, logs: rxLogs }, ...scaledGroups]
  }

  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '8px' }}>{t.clasamentTitle} <Medal size={20} color="#0E0E0E" strokeWidth={2} /></h1>
        <button onClick={onRefresh} style={{ background: '#f0f0f0', border: 'none', borderRadius: '20px', padding: '6px 12px', fontSize: '11px', color: '#0E0E0E', fontWeight: '600', cursor: 'pointer' }}>↻</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', background: '#FFFFFF', borderRadius: '12px', padding: '8px 12px' }}>
        <button onClick={() => goDay(-1)} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: '#0E0E0E', color: '#fff', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E' }}>
            {isToday ? t.clasamentToday : new Date(selectedDate + 'T00:00:00').toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
          {wodZiData ? <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{wodZiData.type} {formatWodDurata(wodZiData.duration)}</div> : <div style={{ fontSize: '11px', color: '#bbb', marginTop: '1px' }}>{t.clasamentNoWod}</div>}
        </div>
        <button onClick={() => goDay(+1)} disabled={isToday} style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: isToday ? '#e0e0e0' : '#0E0E0E', color: isToday ? '#bbb' : '#fff', fontSize: '16px', cursor: isToday ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[
          { id: 'toti', label: t.clasamentFilterAll, icon: Users },
          { id: 'masculin', label: t.clasamentFilterMale, icon: Mars },
          { id: 'feminin', label: t.clasamentFilterFemale, icon: Venus },
        ].map(g => (
          <div key={g.id} onClick={() => setGenderTab(g.id)}
            style={{ padding: '7px 16px', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: genderTab === g.id ? '700' : '400', background: genderTab === g.id ? '#0E0E0E' : '#fff', color: genderTab === g.id ? '#fff' : '#888', border: `1px solid ${genderTab === g.id ? '#0E0E0E' : '#e0e0e0'}`, display: 'flex', alignItems: 'center', gap: '4px' }}>
            <g.icon size={13} color={genderTab === g.id ? '#fff' : '#888'} /> {g.label}
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#aaa', fontSize: '13px' }}>{t.clasamentLoading}</div>
      ) : totalLogs === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}><Flag size={36} color="#ccc" strokeWidth={1.5} /></div>
          <div style={{ fontSize: '14px', fontWeight: '500', color: '#888', marginBottom: '6px' }}>{t.clasamentEmptyTitle}</div>
          <div style={{ fontSize: '12px', color: '#aaa' }}>{t.clasamentEmptySubtitle}</div>
        </div>
      ) : (
        <div>
          {NIVELE.map(nivel => {
            const sectionLogs = getSectionLogs(nivel.id)
            if (sectionLogs.length === 0) return null
            const isForTime = sectionLogs.some(l => l.time_result) &&
              sectionLogs.filter(l => l.time_result).length >= sectionLogs.filter(l => l.result).length
            const weightGroups = getWeightGroups(nivel.id, sectionLogs).filter(g => g.logs.length > 0)
            return (
              <div key={nivel.id} style={{ marginBottom: '20px' }}>
                {/* Header secțiune */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <div style={{ background: nivel.bg, borderRadius: '10px', padding: '4px 12px', fontSize: '12px', fontWeight: '800', color: nivel.culoare, letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <LevelDot nivel={nivel.id} /> {nivel.id}
                  </div>
                  <div style={{ fontSize: '11px', color: '#bbb', fontWeight: '500' }}>
                    {sectionLogs.length} {t.clasamentParticipantWord(sectionLogs.length, genderTab)}
                  </div>
                  {isForTime && (
                    <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#aaa', display: 'flex', alignItems: 'center', gap: '3px' }}><TimerIcon size={11} color="#aaa" /> for time</div>
                  )}
                  {!isForTime && sectionLogs.some(l => l.result) && (
                    <div style={{ marginLeft: 'auto', fontSize: '10px', color: '#aaa' }}>🔄 AMRAP</div>
                  )}
                </div>
                {/* Sub-grupuri pe greutate (RX intai, fara header suplimentar; apoi
                    fiecare greutate scalata distincta, cu header propriu) - medaliile
                    #1/#2/#3 se reseteaza per sub-grup, nu global pe sectiune. */}
                {weightGroups.map((group, gi) => (
                  <div key={group.weight ?? gi} style={{ marginBottom: gi < weightGroups.length - 1 ? '10px' : '0' }}>
                    {group.label && (
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#aaa', margin: '4px 0 6px' }}>{group.label}</div>
                    )}
                    {group.logs.map((log, i) => {
                      const name = log.profile?.full_name || log.profile?.email?.split('@')[0] || t.clasamentAnonymous
                      const medalColor = i === 0 ? '#D4AF37' : i === 1 ? '#A8A8A8' : i === 2 ? '#CD7F32' : null
                      // Family 'sets' nu are niciodata time_result/result (vezi
                      // setsScoreOf/sortLogs mai sus) - scorul calculat acolo
                      // (_setsScore) e singura sursa de afisat, cu unitatea
                      // preferata a membrului care a logat.
                      const result = wodZiFormat?.family === 'sets'
                        ? (log._setsScore != null ? `${log._setsScore}${(log.profile?.weight_unit || 'kg') === 'lbs' ? 'lbs' : 'kg'}` : '—')
                        : (log.time_result || log.result || '—')
                      const borderColor = i === 0 ? nivel.culoare : i === 1 ? '#B0B0B0' : i === 2 ? '#CD7F32' : '#e0e0e0'
                      const notRxdLog = isNotRxd(log, log._prescribedWeight, wodZiData?.type, wodZiData?.format_config)
                      const cardKey = log.id || i
                      const isExpanded = expandedLogId === cardKey
                      const { miscariAfisate, noteLog, wHasSets, wSetsParti, rezultatBucati: rezultatBucatiRaw, areRezultat, areDetalii } = parseWodLogDetails(log, t)
                      // Family 'sets' fara scoringMode configurat (Complex,
                      // Weightlifting, Build to Heavy/1RM etc.) - result/
                      // time_result/log_meta sunt mereu null la aceasta familie,
                      // deci rezultatBucati brut n-are niciodata altceva in afara
                      // de "X seturi" (fara nicio greutate) - inlocuim complet cu
                      // acelasi scor deja calculat mai sus pt headline (cu unitate
                      // inclusa), nu doar il adaugam langa "X seturi" fara sens.
                      const rezultatBucati = (wodZiFormat?.family === 'sets' && result !== '—') ? [result] : rezultatBucatiRaw
                      return (
                        <div key={cardKey} onClick={() => setExpandedLogId(isExpanded ? null : cardKey)}
                          style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: i === 0 ? '0 2px 10px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.06)', borderLeft: `4px solid ${borderColor}`, cursor: 'pointer' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '30px' }}>
                              {medalColor ? <Medal size={22} color={medalColor} strokeWidth={2} /> : <span style={{ fontSize: '13px', fontWeight: '700', color: '#888' }}>#{i + 1}</span>}
                            </div>
                            <AvatarCircle name={name} avatarUrl={log.profile?.avatar_url} size={36} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {name}
                                {notRxdLog && <NotRxdBadge t={t} compact />}
                              </div>
                              <div style={{ fontSize: '11px', color: '#aaa', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                <Clock size={10} strokeWidth={2} />
                                {new Date(log.logged_at).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '16px', fontWeight: '700', color: nivel.culoare }}>{result}</div>
                              {log.time_result && log.result && (
                                <div style={{ fontSize: '11px', color: '#aaa' }}>{log.result}</div>
                              )}
                            </div>
                            <span style={{ fontSize: '13px', color: '#ccc', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                          </div>
                          {isExpanded && (
                            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                              {miscariAfisate.length > 0 && (
                                <div style={{ marginBottom: (wHasSets || areRezultat || (noteLog && noteLog.trim())) ? '10px' : '0' }}>
                                  {miscariAfisate.map((m, j) => (
                                    <div key={j} style={{ fontSize: '12px', color: '#555', padding: '2px 0' }}>• {wHasSets ? stripWeightSuffix(m) : m}</div>
                                  ))}
                                </div>
                              )}
                              {areRezultat && (
                                <div style={{ marginBottom: (wHasSets || (noteLog && noteLog.trim())) ? '12px' : '0', paddingTop: miscariAfisate.length > 0 ? '10px' : '0', borderTop: miscariAfisate.length > 0 ? '1px solid #f0f0f0' : 'none' }}>
                                  <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{t.jurnalResultLabel}</div>
                                  <div style={{ fontSize: '14px', color: '#0E0E0E', fontWeight: '700' }}>{rezultatBucati.join(' · ')}</div>
                                </div>
                              )}
                              {wHasSets && (
                                <div style={{ marginBottom: noteLog && noteLog.trim() ? '10px' : '0' }}>
                                  {wSetsParti.map((p, j) => (
                                    <div key={j} style={{ marginBottom: '6px' }}>
                                      <div style={{ fontSize: '12px', color: '#0E0E0E', fontWeight: '600' }}>{p.cheie}</div>
                                      <div style={{ fontSize: '11px', color: '#888' }}>{p.seturiTxt}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              {noteLog && noteLog.trim() && (
                                <div>
                                  <div style={{ fontSize: '10px', color: '#888', fontWeight: '600', marginBottom: '4px' }}>{t.jurnalNoteLabel}</div>
                                  <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>{noteLog.trim()}</div>
                                </div>
                              )}
                              {!areDetalii && (
                                <div style={{ fontSize: '12px', color: '#aaa' }}>{t.jurnalNoDetails}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Feed({ showToast, user, userProfile, isAdmin, t, lang }) {
  const [posts, setPosts] = useState([])
  const [reactions, setReactions] = useState({})
  const [comments, setComments] = useState({})
  const [loading, setLoading] = useState(true)
  const [postText, setPostText] = useState('')
  const [posting, setPosting] = useState(false)
  const [comentariuDeschis, setComentariuDeschis] = useState(null)
  const [comentariuText, setComentariuText] = useState('')
  const [confirmDeletePost, setConfirmDeletePost] = useState(null)
  const [confirmDeleteComment, setConfirmDeleteComment] = useState(null)
  const [membriComunitate, setMembriComunitate] = useState([])

  const variantaColor = { 'OnRamp': '#0C447C', 'Beginner': '#0E0E0E', 'Intermediate': '#633806', 'RX': '#791F1F' }
  const variantaBg = { 'OnRamp': '#E6F1FB', 'Beginner': '#f0f0f0', 'Intermediate': '#FAEEDA', 'RX': '#FCEBEB' }

  const relativeTime = (ts) => {
    const diff = Date.now() - new Date(ts).getTime()
    const min = Math.floor(diff / 60000)
    if (min < 1) return t.feedJustNow
    if (min < 60) return `${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h`
    return t.feedDaysAgo(Math.floor(h / 24))
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
    supabase.from('profiles').select('id, full_name, email, avatar_url').order('full_name', { ascending: true })
      .then(({ data }) => { if (data) setMembriComunitate(data) })
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
    if (error) { showToast(t.feedToastPostError); console.error(error) }
    else { setPostText(''); showToast(t.feedToastPostSuccess) }
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

  const stergePost = async (postId) => {
    // .select() dupa .delete() ca sa vedem CE s-a sters efectiv - fara el,
    // o stergere blocata silentios de RLS (0 randuri afectate) nu e tratata
    // ca eroare de Postgres/Supabase, si am arata "succes" fals fara sa
    // stergem nimic (exact bug-ul gasit: politica RLS nu avea exceptie de admin).
    const { data, error } = await supabase.from('feed_posts').delete().eq('id', postId).select()
    if (error) { showToast(t.feedToastDeletePostError); console.error(error); return }
    if (!data || data.length === 0) { showToast(t.feedToastDeletePostRlsError); return }
    setConfirmDeletePost(null)
    showToast(t.feedToastDeletePostSuccess)
  }

  const stergeComentariu = async (commentId) => {
    const { data, error } = await supabase.from('feed_comments').delete().eq('id', commentId).select()
    if (error) { showToast(t.feedToastDeleteCommentError); console.error(error); return }
    if (!data || data.length === 0) { showToast(t.feedToastDeleteCommentRlsError); return }
    setConfirmDeleteComment(null)
    showToast(t.feedToastDeleteCommentSuccess)
  }

  const adaugaComentariu = async (postId) => {
    if (!comentariuText.trim()) return
    const { error } = await supabase.from('feed_comments').insert({ post_id: postId, member_id: user.id, text: comentariuText.trim() })
    if (error) { showToast(t.feedToastCommentError); console.error(error) }
    else { setComentariuText(''); setComentariuDeschis(null); showToast(t.feedToastCommentAdded) }
  }

  const myName = userProfile?.full_name || user?.email?.split('@')[0] || t.feedMyNameFallback
  const myAvatar = userProfile?.avatar_url

  return (
    <div style={{ padding: '20px', paddingBottom: '80px' }}>
      <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#0E0E0E', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>{t.feedTitle} <MessageCircle size={20} color="#0E0E0E" strokeWidth={2} /></h1>

      {/* Membrii comunitatii */}
      {membriComunitate.length > 0 && (
        <div className="hide-scrollbar" style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '16px' }}>
          {membriComunitate.map(m => {
            const mName = m.full_name || m.email?.split('@')[0] || t.feedMemberFallback
            return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '58px', flexShrink: 0 }}>
                <AvatarCircle name={mName} avatarUrl={m.avatar_url} size={50} />
                <span style={{ fontSize: '10px', color: '#555', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{mName}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Compose */}
      <div style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <AvatarCircle name={myName} avatarUrl={myAvatar} size={36} />
          <textarea value={postText} onChange={e => setPostText(e.target.value)} placeholder={t.feedComposePlaceholder}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', color: '#0E0E0E', background: 'transparent', resize: 'none', minHeight: '60px', fontFamily: 'system-ui' }} />
        </div>
        {postText.trim() && (
          <button onClick={posteaza} disabled={posting}
            style={{ width: '100%', marginTop: '10px', padding: '10px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', opacity: posting ? 0.7 : 1 }}>
            {posting ? t.feedPosting : t.feedPostButton}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#aaa', fontSize: '13px' }}>{t.feedLoading}</div>
      ) : posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}><MessageCircle size={36} color="#ccc" strokeWidth={1.5} /></div>
          <div style={{ fontSize: '14px', color: '#888' }}>{t.feedEmpty}</div>
        </div>
      ) : posts.map(post => {
        const name = post.profiles?.full_name || post.profiles?.email?.split('@')[0] || t.feedMemberFallback
        const avatarUrl = post.profiles?.avatar_url
        const postReactions = reactions[post.id] || {}
        const postComments = comments[post.id] || []
        return (
          <div key={post.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <AvatarCircle name={name} avatarUrl={avatarUrl} size={38} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E' }}>{name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                  <span style={{ fontSize: '10px', color: '#aaa' }}>{relativeTime(post.created_at)}</span>
                  {post.variant_level && (
                    <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '20px', background: variantaBg[post.variant_level] || '#f0f0f0', color: variantaColor[post.variant_level] || '#888', fontWeight: '500' }}>{post.variant_level}</span>
                  )}
                </div>
              </div>
              {isAdmin && (
                confirmDeletePost === post.id ? (
                  <button onClick={() => stergePost(post.id)}
                    style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: '#e53935', border: 'none', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}>
                    {t.feedDeletePostConfirm}
                  </button>
                ) : (
                  <button onClick={() => setConfirmDeletePost(post.id)}
                    style={{ fontSize: '16px', color: '#ccc', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>
                    ×
                  </button>
                )
              )}
            </div>
            <div style={{ fontSize: '13px', color: '#0E0E0E', lineHeight: '1.5', marginBottom: '12px' }}>{post.text}</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: postComments.length > 0 ? '10px' : '0', flexWrap: 'wrap' }}>
              {['❤️', '👍', '😂', '😮', '😢', '🙏'].map(emoji => {
                const r = postReactions[emoji] || { count: 0, iMine: false }
                return (
                  <button key={emoji} onClick={() => toggleReactie(post.id, emoji)}
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', borderRadius: '20px', border: r.iMine ? '1.5px solid #0E0E0E' : '1px solid #e0e0e0', background: r.iMine ? '#f0f0f0' : '#FFFFFF', cursor: 'pointer', fontSize: '12px', color: r.iMine ? '#0E0E0E' : '#555', fontWeight: r.iMine ? '600' : '400' }}>
                    {emoji}{r.count > 0 ? ` ${r.count}` : ''}
                  </button>
                )
              })}
              <button onClick={() => { setComentariuDeschis(comentariuDeschis === post.id ? null : post.id); setComentariuText('') }}
                style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: '20px', border: '1px solid #e0e0e0', background: '#FFFFFF', cursor: 'pointer', fontSize: '11px', color: '#888' }}>
                💬{postComments.length > 0 ? ` ${postComments.length}` : ''}
              </button>
            </div>
            {postComments.length > 0 && (
              <div style={{ borderTop: '1px solid #f5f5f5', paddingTop: '8px', marginBottom: '8px' }}>
                {postComments.map((c, i) => {
                  const cName = c.profiles?.full_name || c.profiles?.email?.split('@')[0] || t.feedMemberFallback
                  return (
                    <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                      <AvatarCircle name={cName} avatarUrl={c.profiles?.avatar_url} size={26} />
                      <div style={{ background: '#f5f5f5', borderRadius: '10px', padding: '6px 10px', flex: 1, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: '600', color: '#0E0E0E', marginBottom: '2px' }}>{cName}</div>
                          <div style={{ fontSize: '12px', color: '#555' }}>{c.text}</div>
                        </div>
                        {isAdmin && (
                          confirmDeleteComment === c.id ? (
                            <button onClick={() => stergeComentariu(c.id)}
                              style={{ fontSize: '10px', fontWeight: '700', color: '#fff', background: '#e53935', border: 'none', borderRadius: '6px', padding: '2px 6px', cursor: 'pointer', flexShrink: 0, height: 'fit-content' }}>
                              {t.feedDeleteCommentConfirm}
                            </button>
                          ) : (
                            <button onClick={() => setConfirmDeleteComment(c.id)}
                              style={{ fontSize: '14px', color: '#bbb', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0, height: 'fit-content' }}>
                              ×
                            </button>
                          )
                        )}
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
                  placeholder={t.feedCommentPlaceholder}
                  style={{ flex: 1, padding: '8px 12px', borderRadius: '20px', border: '1px solid #e0e0e0', fontSize: '12px', outline: 'none', background: '#fafafa' }} />
                <button onClick={() => adaugaComentariu(post.id)}
                  style={{ padding: '8px 14px', borderRadius: '20px', background: '#ABE73C', color: '#0E0E0E', border: 'none', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>{t.feedCommentSend}</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Comutator mic reutilizat pentru vizibilitatea WARM-UP/SKILL/SKILL 2 pe
// Acasa - stopPropagation ca sa nu deschida/inchida dropdown-ul parinte cand
// dai click doar pe switch.
function MiniSwitch({ checked, onChange }) {
  return (
    <div onClick={(e) => { e.stopPropagation(); onChange(!checked) }} role="switch" aria-checked={checked}
      style={{ width: '36px', height: '20px', borderRadius: '10px', background: checked ? '#ABE73C' : '#e0e0e0', position: 'relative', cursor: 'pointer', transition: 'background 0.15s', flexShrink: 0 }}>
      <div style={{ width: '14px', height: '14px', borderRadius: '50%', background: '#fff', position: 'absolute', top: '3px', left: checked ? '19px' : '3px', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
    </div>
  )
}

function Admin({ showToast, user, isAdmin, isCoach, onWodChanged, mainScrollRef, t, lang }) {
  const [adminTab, setAdminTab] = useState(isAdmin ? 'clienti' : 'wod')
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
  const [durataWodMin, setDurataWodMin] = useState('20')
  const [durataWodSec, setDurataWodSec] = useState('0')
  const [formatConfigWod, setFormatConfigWod] = useState({})
  const [dataWod, setDataWod] = useState(() => todayLocalStr())
  // La EMOM/Tabata/Intervals durata totala e deja 100% determinata de config
  // (runde x interval) - o durata manuala separata ar putea sa nu se
  // potriveasca, deci o calculam si o sincronizam automat (vezi si JSX-ul
  // care ascunde inputul manual pentru aceste formate).
  useEffect(() => {
    if (!AUTO_DURATION_FORMAT_IDS.includes(tipWod)) return
    const totalSec = estimateTotalDurationSec(tipWod, formatConfigWod)
    if (totalSec == null) return
    setDurataWodMin(String(Math.floor(totalSec / 60)))
    setDurataWodSec(String(totalSec % 60))
  }, [tipWod, formatConfigWod])
  const [numeWod, setNumeWod] = useState('')
  // Notita coach-ului e independenta per varianta (nu comuna la tot WOD-ul) -
  // un "wear a vest" poate fi relevant doar la RX, nu si la OnRamp.
  const golVarianteNote = { onramp: '', beginner: '', intermediate: '', rx: '' }
  const [wodVarianteNote, setWodVarianteNote] = useState(golVarianteNote)
  const [savingWod, setSavingWod] = useState(false)
  // Miscarile fiecarei variante sunt o lista (nu text liber) - editabile prin
  // MiscareQuickAdd (autocomplete + reps/kg sau metri/cal la cardio,
  // reordonare), la fel ca la Logare libera. Ramane si un "paste rapid" -
  // multi coach au deja WOD-ul scris in alta parte si vor sa-l lipeasca
  // dintr-o data, nu sa reintroduca miscare cu miscare.
  const [wodVariante, setWodVariante] = useState({ onramp: [], beginner: [], intermediate: [], rx: [] })
  const [wodVarianteQuickAdd, setWodVarianteQuickAdd] = useState({ onramp: '', beginner: '', intermediate: '', rx: '' })
  const [wodVariantePaste, setWodVariantePaste] = useState({ onramp: '', beginner: '', intermediate: '', rx: '' })
  // Greutate prescrisa per varianta, separata per gen (RX barbati 61kg vs RX
  // femei 43kg - o singura valoare combinata nu se poate compara cu greutatea
  // individuala logata de un membru) - comparata cu wod_logs.weight_logged la
  // salvare, ca sa detectam automat "Not RXd" (vezi isNotRxd in
  // workoutFormats.js).
  const golVarianteWeight = Object.fromEntries(VARIANTE_WEIGHT_BASE.map(v => [v.key, { male: '', female: '' }]))
  const [wodVarianteWeight, setWodVarianteWeight] = useState(golVarianteWeight)
  // Payload-ul de scris (buildWodPayload si butonul de salvare partiala din
  // sectiunea variantelor) si populare de citit (syncWodFormFromRow) pt cele
  // 8 coloane de greutate - un singur loc care itereaza VARIANTE_WEIGHT_BASE,
  // in loc sa fie scrise de mana in 3 locuri diferite (risc de a uita o
  // varianta/gen la o modificare viitoare).
  const buildVarianteWeightPayload = () => Object.fromEntries(
    VARIANTE_WEIGHT_BASE.flatMap(v => [
      [`${v.key}_weight_male`, wodVarianteWeight[v.key].male.trim() || null],
      [`${v.key}_weight_female`, wodVarianteWeight[v.key].female.trim() || null],
    ])
  )
  const parseVarianteWeightFromRow = (w) => Object.fromEntries(
    VARIANTE_WEIGHT_BASE.map(v => [v.key, { male: w[`${v.key}_weight_male`] || '', female: w[`${v.key}_weight_female`] || '' }])
  )
  const [warmupWod, setWarmupWod] = useState('')
  // Switch admin per sectiune: fiecare din WARM-UP/SKILL/SKILL 2 se poate
  // ascunde independent de pe Acasa la membri (nu mai e un singur switch
  // combinat - coach-ul vrea sa aleaga exact ce arata in ziua respectiva).
  const [warmupVisibleWod, setWarmupVisibleWod] = useState(true)
  const [skillWod, setSkillWod] = useState('')
  const [skillNameWod, setSkillNameWod] = useState('')
  const [skillTypeWod, setSkillTypeWod] = useState('Weightlifting')
  const [skillFormatConfigWod, setSkillFormatConfigWod] = useState({})
  const [skillVisibleWod, setSkillVisibleWod] = useState(true)
  // SKILL 2: oglinda completa a SKILL, independent (format/miscari proprii).
  const [skill2Wod, setSkill2Wod] = useState('')
  const [skillName2Wod, setSkillName2Wod] = useState('')
  const [skillType2Wod, setSkillType2Wod] = useState('Weightlifting')
  const [skillFormatConfig2Wod, setSkillFormatConfig2Wod] = useState({})
  const [skill2VisibleWod, setSkill2VisibleWod] = useState(true)
  // WARM-UP/SKILL/SKILL 2/formularul principal sunt dropdown-uri in Admin -
  // implicit inchise, arata doar titlul, ca formularul sa nu fie tot pe un
  // singur scroll lung.
  const [adminWarmupOpen, setAdminWarmupOpen] = useState(false)
  const [adminSkillOpen, setAdminSkillOpen] = useState(false)
  const [adminSkill2Open, setAdminSkill2Open] = useState(false)
  const [adminWodFormOpen, setAdminWodFormOpen] = useState(false)
  const [editWodId, setEditWodId] = useState(null)

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
  const [deleteClientConfirm, setDeleteClientConfirm] = useState(null)
  const [deleteClientEmailInput, setDeleteClientEmailInput] = useState('')
  const [deletingClient, setDeletingClient] = useState(false)
  const [coachesList, setCoachesList] = useState([])
  const [coachSearch, setCoachSearch] = useState('')

  useEffect(() => {
    // fetchClienti ramane si pentru coach (nu doar admin) - desi tab-ul "Clienti" e admin-only,
    // lista in sine (nume/email, profiles_select_all e deja RLS-open oricui) e folosita si de
    // adminAdaugaInClasa/adminScoateDinClasa (cautare membru + notificari) din tab-ul Clase,
    // accesibil coach-ului. Fara asta, "Adauga manual" nu gasea pe nimeni pentru un coach.
    fetchClase(); fetchWods(); fetchClienti()
    if (isAdmin) { fetchPlanuri(); fetchAbonamente(); fetchSettingsAdmin(); fetchCoaches() }
  }, [])
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

  const fetchCoaches = async () => {
    const { data } = await supabase.from('coaches').select('id, email').order('email', { ascending: true })
    if (data) setCoachesList(data)
  }

  const addCoach = async (memberId, email) => {
    const { error } = await supabase.from('coaches').insert({ id: memberId, email })
    if (error) { showToast(t.toastGenericError); console.error(error); return }
    showToast(t.toastCoachAdded)
    setCoachSearch('')
    fetchCoaches()
  }

  const removeCoach = async (memberId) => {
    const { error } = await supabase.from('coaches').delete().eq('id', memberId)
    if (error) { showToast(t.toastGenericError); console.error(error); return }
    showToast(t.toastCoachRemoved)
    fetchCoaches()
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
      // NU .in('class_id', claseViit.map(...)) - cu clase recurente pe un an intreg (~1000 randuri),
      // URL-ul rezultat (sute de UUID-uri concatenate) depaseste limita serverului si pica cu 400
      // Bad Request (gasit in Sentry). bookings are mult mai putine randuri decat classes, deci le
      // luam pe toate si filtram in JS dupa setul de clase viitoare, fara sa mai construim un URL urias.
      const claseViitIds = new Set(claseViit.map(c => c.id))
      const { data: bookings } = await supabase.from('bookings').select('member_id, class_id')
      if (bookings) setMemberIdsCuRezervariViitoare(new Set(bookings.filter(b => claseViitIds.has(b.class_id)).map(b => b.member_id).filter(Boolean)))
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
    showToast(t.toastSettingsSaved)
    setSavingSettings(false)
  }

  const adjustMemberSessions = async (memberId, delta) => {
    const member = clienti.find(c => c.id === memberId)
    const email = member?.email?.toLowerCase()
    if (!email) return
    // RPC restransa (nu update direct pe subscriptions) - permite si coach-ului sa
    // ajusteze doar sessions_used ca efect al adaugarii/scoaterii dintr-o clasa, fara
    // sa-i dea acces RLS larg la restul tabelului subscriptions (pret, plan, is_active).
    const { error } = await supabase.rpc('adjust_session_count', { p_member_email: email, p_delta: delta })
    if (error) { console.error('adjustMemberSessions:', error.message || error); return }
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
      showToast(t.toastGenericError); console.error(error); return
    }
    const memberEmail = clienti.find(c => c.id === memberId)?.email?.toLowerCase()
    if (memberEmail) supabase.from('class_reminders').delete().eq('class_id', classId).eq('member_email', memberEmail)
    checkAndBookFromWaitlist(classId)
    showToast(t.toastRemovedFromClass)
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
    if (alreadyIn) { showToast(t.toastAlreadyBooked); return }
    await adjustMemberSessions(memberId, +1)
    const { error } = await supabase.from('bookings').insert({ class_id: classId, member_id: memberId })
    if (error) {
      await adjustMemberSessions(memberId, -1)
      showToast(t.toastGenericError); console.error(error); return
    }
    showToast(t.toastAddedToClass)
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
    if (error) { showToast(t.toastGenericError); console.error(error); return }
    setRezervariClasa(prev => ({
      ...prev,
      [classId]: (prev[classId] || []).map(r => r.member_id === memberId ? { ...r, checked_in: !currentValue } : r),
    }))
  }

  const adminAjusteazaSedinte = async (aboId, currentUsed, currentTotal, delta) => {
    const newUsed = Math.max(0, Math.min(currentTotal ?? 9999, (currentUsed || 0) + delta))
    const { error } = await supabase.from('subscriptions').update({ sessions_used: newUsed }).eq('id', aboId)
    if (error) { showToast(t.toastUpdateError); return }
    setAbonamente(prev => prev.map(a => a.id === aboId ? { ...a, sessions_used: newUsed } : a))
    showToast(delta > 0 ? t.toastSessionAdded : t.toastSessionRemoved)
  }

  const adminStergeClient = async (client) => {
    if (deleteClientEmailInput.trim().toLowerCase() !== client.email?.toLowerCase()) return
    setDeletingClient(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${EDGE_BASE}/admin-delete-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ client_id: client.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) throw new Error(json.error || t.errorDeletingClient)
      setClienti(prev => prev.filter(c => c.id !== client.id))
      setClientSelectat(null)
      setDeleteClientConfirm(null)
      setDeleteClientEmailInput('')
      showToast(t.toastClientDeleted)
    } catch (e) {
      showToast('❌ ' + e.message)
    }
    setDeletingClient(false)
  }

  const adminActiveazaAboQueued = async (aboQueued, memberEmail) => {
    const startDate = new Date()
    const startStr = todayLocalStr()
    const duration = aboQueued.subscription_plans?.duration_months || 1
    const endStr = addMonthsClamped(startDate, duration)
    await supabase.from('subscriptions').update({ is_active: false }).ilike('member_email', memberEmail).eq('is_active', true).neq('id', aboQueued.id)
    const { error } = await supabase.from('subscriptions').update({
      is_active: true, queued: false, start_date: startStr, end_date: endStr, sessions_used: 0,
    }).eq('id', aboQueued.id)
    if (error) { showToast(t.toastActivateError); return }
    showToast(t.toastSubscriptionActivated)
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
    if (!dataClasa) { showToast(t.toastFillDate); return }
    if (repetitiva && zileRepetare.length === 0) { showToast(t.toastPickAtLeastOneDay); return }
    setSavingClasa(true)
    const baza = { name: numeClasa, start_time: oraInceput, end_time: oraSfarsit, coach: coachClasa || 'Coach', max_spots: locuriClasa, color: culoarClasa || null }
    const records = repetitiva
      ? genereazaDateRepetare().map(date => ({ ...baza, date }))
      : [{ ...baza, date: dataClasa }]
    if (records.length === 0) { showToast(t.toastNoDateGenerated); setSavingClasa(false); return }
    const { error } = await supabase.from('classes').insert(records)
    if (error) { showToast(t.toastGenericErrorWithFallback(error.message || t.errorWordExclaim)); console.error(error) }
    else {
      showToast(repetitiva ? t.toastClassesCreated(records.length) : t.toastClassCreated)
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
    if (error) showToast(t.toastGenericErrorWithFallback(error.message))
    else showToast(t.toastSeriesDeleted)
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
    showToast(t.toastClassDeleted); await fetchClase()
  }

  const parseLiniiWod = (text) => text.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  // Text ramas in caseta "Paste rapid" fara sa se fi apasat explicit "Adauga
  // din text" era pierdut silentios la Salvare - un coach care lipea text la
  // toate cele 4 variante dar uita sa apese butonul individual pentru una
  // din ele pierdea acea varianta fara niciun avertisment (bug raportat: RX
  // salvat corect, celelalte variante goale). Flush-uim orice text ramas
  // chiar inainte de orice salvare (sectiune sau WOD intreg), la fel ca la
  // apasarea butonului - returnam varianta "efectiva" (cu flush-ul inclus)
  // ca s-o foloseasca direct apelantul, fara sa astepte re-render-ul.
  const flushWodVariantePaste = () => {
    let efectiv = wodVariante
    let ramasCeva = false
    for (const key of ['onramp', 'beginner', 'intermediate', 'rx']) {
      const text = wodVariantePaste[key]
      if (!text.trim()) continue
      ramasCeva = true
      const linii = text.split('\n').map(l => l.trim()).filter(Boolean).map(parseMiscareLinePasta)
      efectiv = { ...efectiv, [key]: [...efectiv[key], ...linii] }
    }
    if (ramasCeva) {
      setWodVariante(efectiv)
      setWodVariantePaste({ onramp: '', beginner: '', intermediate: '', rx: '' })
    }
    return efectiv
  }

  // Payload complet, din starea curenta a formularului - folosit atat de
  // saveWod (salveaza tot) cat si de saveWodSection cand inca nu exista un
  // rand in DB (nu ai ce sa actualizezi partial, trebuie creat intreg randul
  // o data, cu valorile implicite pentru sectiunile neatinse inca). `overrides`
  // e pentru cazul in care apelantul are o valoare mai proaspata decat starea
  // React curenta (ex. switch-ul de vizibilitate cheama save chiar in acelasi
  // tick cu setState-ul, inainte ca re-render-ul sa fi actualizat starea).
  const buildWodPayload = (overrides = {}, variante = wodVariante) => {
    const durataWod = `${parseInt(durataWodMin) || 0}:${String(parseInt(durataWodSec) || 0).padStart(2, '0')}`
    return {
      date: dataWod, type: tipWod, duration: durataWod,
      format_config: Object.keys(formatConfigWod).length > 0 ? formatConfigWod : null,
      name: numeWod.trim() || null,
      notes_onramp: wodVarianteNote.onramp.trim() || null,
      notes_beginner: wodVarianteNote.beginner.trim() || null,
      notes_intermediate: wodVarianteNote.intermediate.trim() || null,
      notes_rx: wodVarianteNote.rx.trim() || null,
      warmup: parseLiniiWod(warmupWod),
      warmup_visible: warmupVisibleWod,
      skill: parseLiniiWod(skillWod),
      skill_name: skillNameWod.trim() || null,
      skill_type: skillTypeWod,
      skill_format_config: Object.keys(skillFormatConfigWod).length > 0 ? skillFormatConfigWod : null,
      skill_visible: skillVisibleWod,
      skill2: parseLiniiWod(skill2Wod),
      skill2_name: skillName2Wod.trim() || null,
      skill2_type: skillType2Wod,
      skill2_format_config: Object.keys(skillFormatConfig2Wod).length > 0 ? skillFormatConfig2Wod : null,
      skill2_visible: skill2VisibleWod,
      movements_onramp: variante.onramp,
      movements_beginner: variante.beginner,
      movements_intermediate: variante.intermediate,
      movements_rx: variante.rx,
      ...buildVarianteWeightPayload(),
      ...overrides,
    }
  }

  const saveWod = async () => {
    if (!dataWod) { showToast(t.toastPickDate); return }
    setSavingWod(true)
    const payload = buildWodPayload({}, flushWodVariantePaste())
    // upsert pe conflict de data (nu doar insert) - data implicita e azi, care
    // poate coincide cu un WOD deja existent chiar daca formularul n-a fost
    // deschis explicit prin "editeaza" (editWodId ramane null in cazul asta);
    // fara upsert, insert-ul ar esua cu eroare de duplicat pe wods_date_key.
    const { error } = editWodId
      ? await supabase.from('wods').update(payload).eq('id', editWodId)
      : await supabase.from('wods').upsert(payload, { onConflict: 'date' })
    if (error) { showToast(t.toastGenericError); console.error(error) }
    else {
      showToast(editWodId ? t.toastWodUpdatedAdmin : t.toastWodCreatedAdmin)
      await fetchWods(); onWodChanged?.()
      setEditWodId(null); setDataWod(todayLocalStr())
      resetWodFormFields()
    }
    setSavingWod(false)
  }

  // Salveaza o singura sectiune (WARM-UP/SKILL/SKILL 2/Workout of the Day),
  // fara sa atinga campurile celorlalte sectiuni - daca WOD-ul exista deja,
  // e un update partial (nu suprascrie modificari neterminate din alta
  // sectiune care inca n-a fost salvata). Daca WOD-ul e nou (fara editWodId),
  // nu exista ce sa actualizezi partial - se creeaza randul intreg o data,
  // cu valorile curente din formular, si urmatoarele sectiuni salvate devin
  // update-uri partiale pe acelasi rand.
  const saveWodSection = async (sectionFields, sectionLabel) => {
    if (!dataWod) { showToast(t.toastPickDate); return }
    setSavingWod(true)
    let error
    if (editWodId) {
      ;({ error } = await supabase.from('wods').update(sectionFields).eq('id', editWodId))
    } else {
      // Acelasi upsert pe conflict de data ca la saveWod (nu insert simplu) -
      // data implicita e azi, care poate coincide cu un WOD deja existent
      // chiar daca formularul n-a fost deschis explicit prin "editeaza"
      // (editWodId ramane null in cazul asta). Payload-ul complet e sigur de
      // folosit aici (nu doar sectionFields) pentru ca efectul de sincronizare
      // (syncWodFormFromRow) garanteaza ca restul campurilor formularului
      // oglindesc deja randul real din DB cand data se potriveste.
      const { data, error: upsertErr } = await supabase.from('wods').upsert(buildWodPayload(sectionFields), { onConflict: 'date' }).select().single()
      error = upsertErr
      if (!error && data) setEditWodId(data.id)
    }
    if (error) { showToast(t.toastGenericError); console.error(error) }
    else { showToast(t.toastSectionSaved(sectionLabel)); await fetchWods(); onWodChanged?.() }
    setSavingWod(false)
  }

  // Populeaza toate campurile formularului din randul WOD dat, FARA efecte de
  // navigare (scroll, expand dropdown-uri, schimbare tab) - folosita atat de
  // startEditWod (editare explicita, cu navigare) cat si de sincronizarea
  // silentioasa de mai jos (cand data aleasa coincide cu un WOD deja
  // existent, fara sa fi apasat explicit "editeaza").
  const syncWodFormFromRow = (w) => {
    setEditWodId(w.id)
    setDataWod(w.date)
    setTipWod(w.type || 'AMRAP')
    const [dMin, dSec] = (w.duration || '20:0').split(':')
    setDurataWodMin(dMin || '0'); setDurataWodSec(dSec || '0')
    setFormatConfigWod(w.format_config || {})
    setNumeWod(w.name || '')
    setWodVarianteNote({
      onramp: w.notes_onramp || '', beginner: w.notes_beginner || '',
      intermediate: w.notes_intermediate || '', rx: w.notes_rx || '',
    })
    setWarmupWod((w.warmup || []).join('\n'))
    setWarmupVisibleWod(w.warmup_visible !== false)
    setSkillWod((w.skill || []).join('\n'))
    setSkillNameWod(w.skill_name || '')
    setSkillTypeWod(w.skill_type || 'Weightlifting')
    setSkillFormatConfigWod(w.skill_format_config || {})
    setSkillVisibleWod(w.skill_visible !== false)
    setSkill2Wod((w.skill2 || []).join('\n'))
    setSkillName2Wod(w.skill2_name || '')
    setSkillType2Wod(w.skill2_type || 'Weightlifting')
    setSkillFormatConfig2Wod(w.skill2_format_config || {})
    setSkill2VisibleWod(w.skill2_visible !== false)
    setWodVariante({
      onramp: w.movements_onramp || [],
      beginner: w.movements_beginner || [],
      intermediate: w.movements_intermediate || [],
      rx: w.movements_rx || [],
    })
    setWodVarianteWeight(parseVarianteWeightFromRow(w))
    setWodVarianteQuickAdd({ onramp: '', beginner: '', intermediate: '', rx: '' })
    setWodVariantePaste({ onramp: '', beginner: '', intermediate: '', rx: '' })
  }

  const startEditWod = (w) => {
    syncWodFormFromRow(w)
    // La editare deschidem dropdown-urile automat (altfel adminul nu vede ce
    // e completat deja fara sa dea click pe fiecare titlu pe rand).
    setAdminWarmupOpen(true); setAdminSkillOpen(true); setAdminSkill2Open(true); setAdminWodFormOpen(true)
    setAdminTab('wod')
    // Admin e deja randat doar cand screen === 'admin' (vezi App()), nu are
    // propriul lui setScreen - fara reset explicit aici, editarea unui WOD mai
    // jos in lista lasa formularul de editare (sus) invizibil, in afara
    // ecranului (containerul care scroleaza e mainScrollRef, primit ca prop
    // din App()).
    if (mainScrollRef?.current) mainScrollRef.current.scrollTop = 0
  }

  // Daca data aleasa (implicit azi) coincide cu un WOD deja existent, dar
  // formularul n-a fost deschis explicit prin "editeaza" (ex. la intrarea pe
  // ecranul Admin, sau la revenirea de pe alt ecran), sincronizeaza campurile
  // cu cele reale din DB - altfel switch-urile de vizibilitate (si tot
  // restul) arata valorile implicite (ON), nu cele salvate cu adevarat,
  // desi WOD-ul zilei chiar exista (bug raportat: switch-ul lasat OFF aparea
  // din nou ON la reintrarea in Admin).
  useEffect(() => {
    if (editWodId) return
    const existing = wods.find(w => w.date === dataWod)
    if (existing) syncWodFormFromRow(existing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataWod, wods, editWodId])

  // Reseteaza toate campurile formularului la implicit, FARA sa atinga
  // dataWod si editWodId - folosita de cancelEditWod (care le reseteaza
  // separat) si de schimbarea manuala a datei (care vrea sa pastreze data
  // noua aleasa, nu s-o resetaze la azi).
  const resetWodFormFields = () => {
    setNumeWod(''); setWodVarianteNote(golVarianteNote); setWodVariante({ onramp: [], beginner: [], intermediate: [], rx: [] })
    setWodVarianteWeight(golVarianteWeight)
    setWodVarianteQuickAdd({ onramp: '', beginner: '', intermediate: '', rx: '' }); setWodVariantePaste({ onramp: '', beginner: '', intermediate: '', rx: '' })
    setWarmupWod(''); setWarmupVisibleWod(true); setSkillWod(''); setSkillNameWod(''); setSkillTypeWod('Weightlifting'); setSkillFormatConfigWod({}); setSkillVisibleWod(true)
    setSkill2Wod(''); setSkillName2Wod(''); setSkillType2Wod('Weightlifting'); setSkillFormatConfig2Wod({}); setSkill2VisibleWod(true)
    setTipWod('AMRAP'); setDurataWodMin('20'); setDurataWodSec('0'); setFormatConfigWod({})
    setAdminWarmupOpen(false); setAdminSkillOpen(false); setAdminSkill2Open(false); setAdminWodFormOpen(false)
  }

  const cancelEditWod = () => {
    setEditWodId(null); setDataWod(todayLocalStr())
    resetWodFormFields()
  }

  const stergeWod = async (id) => {
    await supabase.from('wods').delete().eq('id', id)
    if (id === editWodId) cancelEditWod()
    showToast(t.toastWodDeletedAdmin); await fetchWods(); onWodChanged?.()
  }

  const saveAbonament = async () => {
    if (!emailAbonament || !planSelectat) { showToast(t.toastFillEmailAndPlan); return }
    setSavingAbonament(true)
    const emailNorm = emailAbonament.toLowerCase().trim()
    const plan = planuri.find(p => p.id === planSelectat)
    const azStr = todayLocalStr()

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
      if (error) { showToast(t.toastGenericErrorWithFallback(error.message || t.unknownErrorFallback)); console.error(error) }
      else {
        showToast(t.toastSubscriptionQueued)
        await fetchAbonamente()
        setEmailAbonament(''); setNumeAbonament(''); setPretPlatit('')
      }
    } else {
      // nu are abonament valid — activeaza imediat
      await supabase.from('subscriptions').update({ is_active: false }).ilike('member_email', emailNorm).eq('is_active', true)
      const endDateStr = addMonthsClamped(new Date(dataStartAbonament + 'T00:00:00'), plan?.duration_months || 1)
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
      if (error) { showToast(t.toastGenericErrorWithFallback(error.message || t.unknownErrorFallback)); console.error(error) }
      else {
        showToast(t.toastSubscriptionAdded)
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
    if (!numePlan) { showToast(t.toastEnterName); return }
    setSavingPlan(true)
    const { error } = await supabase.from('subscription_plans').insert({
      name: numePlan, sessions: sedintePlan ? parseInt(sedintePlan) : null, price: pretPlan ? parseFloat(pretPlan) : null, duration_months: durataPlan,
    })
    if (error) { showToast(t.toastGenericError); console.error(error) }
    else { showToast(t.toastPlanAdded); await fetchPlanuri(); setNumePlan(''); setSedintePlan(''); setPretPlan(''); setDurataPlan(1) }
    setSavingPlan(false)
  }

  const stergePlan = async (id) => {
    await supabase.from('subscription_plans').update({ is_active: false }).eq('id', id)
    showToast(t.toastPlanDeleted); await fetchPlanuri()
  }

  const stergeAbonament = async (id) => {
    const abo = abonamente.find(a => a.id === id)
    if (abo?.queued) {
      await supabase.from('subscriptions').delete().eq('id', id)
      showToast(t.toastQueuedSubscriptionDeleted)
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
    showToast(t.toastSubscriptionCancelled)
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
        <h1 style={{ fontSize: '22px', fontWeight: '600', color: '#0E0E0E' }}>{t.adminHeaderTitle}</h1>
        <span style={{ background: '#FCEBEB', color: '#791F1F', fontSize: '10px', padding: '2px 8px', borderRadius: '20px', fontWeight: '600' }}>{isAdmin ? t.adminBadgeAdmin : t.adminBadgeCoach}</span>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[{ id: 'clienti', icon: Users, lbl: t.adminTabClienti, adminOnly: true }, { id: 'abonamente', icon: Ticket, lbl: t.adminTabAbonamente, adminOnly: true }, { id: 'clase', icon: Calendar, lbl: t.adminTabClase }, { id: 'wod', icon: Dumbbell, lbl: t.adminTabWod }, { id: 'planuri', icon: ClipboardList, lbl: t.adminTabPlanuri, adminOnly: true }, { id: 'setari', icon: Settings, lbl: t.adminTabSetari, adminOnly: true }].filter(tab => !tab.adminOnly || isAdmin).map(tab => (
          <div key={tab.id} onClick={() => setAdminTab(tab.id)}
            style={{ flex: adminTab === tab.id ? '1 1 auto' : '0 0 auto', padding: '7px 10px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: adminTab === tab.id ? '600' : '400', background: adminTab === tab.id ? '#0E0E0E' : '#fff', color: adminTab === tab.id ? '#fff' : '#888', border: '1px solid #e0e0e0', whiteSpace: 'nowrap', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <tab.icon size={13} color={adminTab === tab.id ? '#fff' : '#888'} />{adminTab === tab.id ? ` ${tab.lbl}` : ''}
          </div>
        ))}
      </div>

      {/* CLIENTI */}
      {adminTab === 'clienti' && isAdmin && (
        <>
          <div style={{ background: '#fff', borderRadius: '12px', padding: '10px 14px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>🔍</span>
            <input value={searchClienti} onChange={e => setSearchClienti(e.target.value)} placeholder={t.adminClientsSearchPlaceholder}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: '13px', background: 'transparent' }} />
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            {[
              { id: 'toti', lbl: t.adminClientsFilterAll, count: clienti.filter(c => !searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase())).length },
              { id: 'activi', lbl: t.adminClientsFilterActive, count: clienti.filter(c => esteClientActiv(c.email) && (!searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase()))).length },
              { id: 'inactivi', lbl: t.adminClientsFilterInactive, count: clienti.filter(c => !esteClientActiv(c.email) && (!searchClienti || c.full_name?.toLowerCase().includes(searchClienti.toLowerCase()) || c.email?.toLowerCase().includes(searchClienti.toLowerCase()))).length },
            ].map(s => (
              <div key={s.id} onClick={() => setSortClienti(s.id)}
                style={{ padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: sortClienti === s.id ? '600' : '400', background: sortClienti === s.id ? '#0E0E0E' : '#fff', color: sortClienti === s.id ? '#fff' : '#888', border: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: '5px' }}>
                {s.id === 'inactivi' && <AlertTriangle size={11} color={sortClienti === s.id ? '#fff' : '#888'} />}
                {s.lbl}
                <span style={{ background: sortClienti === s.id ? 'rgba(255,255,255,0.25)' : '#f0f0f0', color: sortClienti === s.id ? '#fff' : '#888', borderRadius: '10px', padding: '1px 6px', fontSize: '10px', fontWeight: '600' }}>{s.count}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>
            {sortClienti === 'toti' ? t.adminClientsSectionAll : sortClienti === 'activi' ? t.adminClientsSectionActive : t.adminClientsSectionInactive} ({clientiFiltrati.length})
          </div>
          {clientiFiltrati.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#aaa', fontSize: '13px' }}>
              <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}><Users size={32} color="#ccc" strokeWidth={1.5} /></div>
              {clienti.length === 0 ? t.adminClientsEmptyRegistered : t.adminClientsEmptyFiltered}
            </div>
          ) : clientiFiltrati.map(c => {
            const abo = getAbonamentClient(c.email)
            const aboQueued = getQueuedAbonamentClient(c.email)
            const zileRamase = abo ? daysUntil(abo.end_date) : null
            const sedinteEpuizate = abo?.sessions_total != null && Math.max(0, abo.sessions_total - (abo.sessions_used || 0)) === 0
            const neInceput = abo ? new Date(abo.start_date + 'T00:00:00') > new Date() : false
            const expirat = (zileRamase !== null && zileRamase < 0) || sedinteEpuizate
            const expiraCurand = !expirat && zileRamase !== null && zileRamase >= 0 && zileRamase <= 5
            const isOpen = clientSelectat === c.id
            return (
              <div key={c.id} onClick={() => setClientSelectat(isOpen ? null : c.id)}
                style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', borderLeft: `4px solid ${expirat ? '#E24B4A' : expiraCurand ? '#BA7517' : neInceput ? '#0E0E0E' : abo ? '#0E0E0E' : '#e0e0e0'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AvatarCircle name={c.full_name || c.email} avatarUrl={c.avatar_url} size={42} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E' }}>{c.full_name || t.adminClientsNoName}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>{c.email}</div>
                    {abo && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '20px', background: expirat ? '#FCEBEB' : expiraCurand ? '#FAEEDA' : neInceput ? '#EEEDFB' : '#f0f0f0', color: expirat ? '#791F1F' : expiraCurand ? '#633806' : neInceput ? '#0E0E0E' : '#0E0E0E', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          {sedinteEpuizate ? <><AlertTriangle size={10} /> {t.adminClientsExhausted}</> : expirat ? <><AlertTriangle size={10} /> {t.adminClientsExpired}</> : neInceput ? <><Calendar size={10} /> {t.adminClientsFromDate(new Date(abo.start_date + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit' }))}</> : expiraCurand ? `⏰ ${new Date(abo.end_date + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit' })}` : `✓ ${new Date(abo.end_date + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit' })}`}
                        </span>
                        <span style={{ fontSize: '10px', color: '#888' }}>{abo.subscription_plans?.name}</span>
                        {abo.sessions_total && <span style={{ fontSize: '10px', color: '#888' }}>· {(abo.sessions_used || 0)}/{abo.sessions_total} {t.adminClientsSessionsAbbrev}</span>}
                      </div>
                    )}
                    {!abo && !aboQueued && <div style={{ fontSize: '10px', color: '#aaa', marginTop: '2px' }}>{t.adminClientsNoSubscription}</div>}
                    {!abo && aboQueued && <div style={{ fontSize: '10px', color: '#5B7FCC', marginTop: '2px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '3px' }}><Calendar size={10} /> {t.adminClientsQueuedSubscription}</div>}
                  </div>
                </div>
                {isOpen && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                    {/* Profil complet */}
                    <div style={{ background: '#f8f8f8', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '0.5px', marginBottom: '8px' }}>{t.adminClientsProfileLabel}</div>
                      {(c.first_name || c.last_name) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>{t.adminClientsFirstLastName}</span>
                          <span style={{ fontWeight: '600', color: '#0E0E0E' }}>{[c.first_name, c.last_name].filter(Boolean).join(' ')}</span>
                        </div>
                      )}
                      {c.birth_date && (() => {
                        const varsta = Math.floor((new Date() - new Date(c.birth_date + 'T00:00:00')) / (365.25 * 24 * 3600 * 1000))
                        return (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>{t.adminClientsBirthDate}</span>
                            <span style={{ fontWeight: '600', color: '#0E0E0E' }}>{new Date(c.birth_date + 'T00:00:00').toLocaleDateString(localeFor(lang))} ({t.adminClientsAgeYears(varsta)})</span>
                          </div>
                        )
                      })()}
                      {c.gender && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>{t.adminClientsGenderLabel}</span>
                          <span style={{ fontWeight: '600', color: '#0E0E0E' }}>{c.gender === 'masculin' ? t.adminClientsGenderMaleFull : t.adminClientsGenderFemaleFull}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                        <span style={{ color: '#888' }}>{t.adminClientsWaiverLabel}</span>
                        {c.waiver_accepted ? (
                          <span style={{ fontWeight: '600', color: '#0E0E0E' }}>{t.adminClientsWaiverAccepted(c.waiver_accepted_at ? new Date(c.waiver_accepted_at).toLocaleDateString(localeFor(lang)) : '')}</span>
                        ) : (
                          <span style={{ fontWeight: '600', color: '#E24B4A' }}>{t.adminClientsWaiverNotAccepted}</span>
                        )}
                      </div>
                    </div>
                    {abo ? (
                      <div style={{ background: '#FFFFFF', borderRadius: '10px', padding: '10px 12px', marginBottom: '10px' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#888', marginBottom: '6px' }}>
                          {sedinteEpuizate ? t.adminClientsSubExhausted : expirat ? t.adminClientsSubExpired : neInceput ? t.adminClientsSubScheduled : t.adminClientsSubActive}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>{t.adminClientsPlanLabel}</span>
                          <span style={{ fontWeight: '600' }}>{abo.subscription_plans?.name}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>{t.adminClientsExpiresLabel}</span>
                          <span style={{ fontWeight: '600', color: expirat ? '#E24B4A' : expiraCurand ? '#BA7517' : '#0E0E0E' }}>{new Date(abo.end_date + 'T00:00:00').toLocaleDateString(localeFor(lang))}</span>
                        </div>
                        {abo.sessions_total && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>{t.adminClientsSessionsLabel}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: '600', color: sedinteEpuizate ? '#E24B4A' : '#0E0E0E' }}>{abo.sessions_used || 0} / {abo.sessions_total}</span>
                              <div style={{ display: 'flex', gap: '4px' }} onClick={e => e.stopPropagation()}>
                                <button onClick={() => adminAjusteazaSedinte(abo.id, abo.sessions_used, abo.sessions_total, +1)}
                                  style={{ width: '24px', height: '24px', borderRadius: '6px', border: '1px solid #0E0E0E', background: '#f0f0f0', color: '#0E0E0E', fontWeight: '700', fontSize: '14px', cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
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
                        <div style={{ fontSize: '11px', fontWeight: '700', color: '#5B7FCC', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={11} /> {t.adminClientsSubScheduled}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                          <span style={{ color: '#888' }}>{t.adminClientsPlanLabel}</span>
                          <span style={{ fontWeight: '600' }}>{aboQueued.subscription_plans?.name || '—'}</span>
                        </div>
                        {aboQueued.sessions_total && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                            <span style={{ color: '#888' }}>{t.adminClientsSessionsLabel}</span>
                            <span style={{ fontWeight: '600' }}>{aboQueued.sessions_total}</span>
                          </div>
                        )}
                        <div style={{ fontSize: '11px', color: '#5B7FCC', marginTop: '4px', marginBottom: '8px' }}>
                          {t.adminClientsAutoActivateNote}
                        </div>
                        {aboQueued.notes && <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>{aboQueued.notes}</div>}
                        <button onClick={e => { e.stopPropagation(); adminActiveazaAboQueued(aboQueued, c.email) }}
                          style={{ width: '100%', padding: '7px', background: '#5B7FCC', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}>
                          <Zap size={13} /> {t.adminClientsActivateNow}
                        </button>
                      </div>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); setAdminTab('abonamente'); setEmailAbonament(c.email); setNumeAbonament(c.full_name || '') }}
                      style={{ width: '100%', padding: '8px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                      {abo ? (aboQueued ? t.adminClientsAddSupplementary : t.adminClientsRenew) : t.adminClientsAddSubscription}
                    </button>

                    {/* Zonă periculoasă - ștergere definitivă cont */}
                    <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #f0c0c0' }} onClick={e => e.stopPropagation()}>
                      {deleteClientConfirm === c.id ? (
                        <div style={{ background: '#FCEBEB', borderRadius: '10px', padding: '12px' }}>
                          <div style={{ fontSize: '12px', fontWeight: '700', color: '#791F1F', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={12} /> {t.adminClientsDeleteTitle}</div>
                          <div style={{ fontSize: '11px', color: '#791F1F', marginBottom: '8px' }}>
                            {t.adminClientsDeleteWarnPrefix} <strong>{c.full_name || c.email}</strong>{t.adminClientsDeleteWarnSuffix}{' '}
                            {t.adminClientsDeleteConfirmEmailPrompt} <strong>{c.email}</strong>
                          </div>
                          <input value={deleteClientEmailInput} onChange={e => setDeleteClientEmailInput(e.target.value)}
                            placeholder={c.email} autoFocus
                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1.5px solid #E24B4A', fontSize: '12px', background: '#fff', boxSizing: 'border-box', marginBottom: '8px' }} />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => { setDeleteClientConfirm(null); setDeleteClientEmailInput('') }}
                              style={{ flex: 1, padding: '8px', background: '#fff', color: '#0E0E0E', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                              {t.adminClientsCancel}
                            </button>
                            <button disabled={deletingClient || deleteClientEmailInput.trim().toLowerCase() !== c.email?.toLowerCase()}
                              onClick={() => adminStergeClient(c)}
                              style={{ flex: 1, padding: '8px', background: deleteClientEmailInput.trim().toLowerCase() === c.email?.toLowerCase() ? '#E24B4A' : '#f0b8b8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: deleteClientEmailInput.trim().toLowerCase() === c.email?.toLowerCase() ? 'pointer' : 'default' }}>
                              {deletingClient ? t.adminClientsDeleting : t.adminClientsDeletePermanently}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setDeleteClientConfirm(c.id); setDeleteClientEmailInput('') }}
                          style={{ width: '100%', padding: '8px', background: '#fff', color: '#E24B4A', border: '1px solid #f0c0c0', borderRadius: '8px', fontSize: '12px', fontWeight: '500', cursor: 'pointer' }}>
                          {t.adminClientsDeleteButtonFull}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* ABONAMENTE */}
      {adminTab === 'abonamente' && isAdmin && (
        <>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', marginBottom: '12px' }}>{t.adminSubsNewTitle}</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminSubsEmailLabel}</div>
            {(() => {
              const emailVal = emailAbonament.trim()
              const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)
              const borderColor = emailVal.length === 0 ? '#e0e0e0' : emailValid ? '#0E0E0E' : '#E24B4A'
              return (
                <>
                  <input value={emailAbonament} onChange={e => setEmailAbonament(e.target.value)} placeholder={t.adminSubsEmailPlaceholder} type="email"
                    list="clienti-emails-list"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1.5px solid ${borderColor}`, fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '4px' }} />
                  {emailVal.length > 0 && !emailValid && (
                    <div style={{ fontSize: '11px', color: '#E24B4A', marginBottom: '4px' }}>{t.adminSubsEmailInvalid}</div>
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
                <div style={{ fontSize: '11px', color: '#BA7517', background: '#FAEEDA', borderRadius: '8px', padding: '6px 10px', marginBottom: '6px', display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>{t.adminSubsSimilarEmailPrefix} <strong>{similar.email}</strong>{t.adminSubsSimilarEmailSuffix(similar.full_name)}</span>
                </div>
              ) : null
            })()}
            <div style={{ marginBottom: '6px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminSubsPlanLabel}</div>
            <select value={planSelectat} onChange={e => {
              setPlanSelectat(e.target.value)
              const p = planuri.find(p => p.id === e.target.value)
              if (p?.price != null) setPretPlatit(String(p.price))
            }} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }}>
              {planuri.map(p => <option key={p.id} value={p.id}>{p.name}{p.price != null ? ` — ${p.price} RON` : ''}</option>)}
            </select>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminSubsStartDateLabel}</div>
            <input type="date" value={dataStartAbonament} onChange={e => setDataStartAbonament(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminSubsAmountPaidLabel}</div>
            <input type="number" value={pretPlatit} onChange={e => setPretPlatit(e.target.value)}
              placeholder={planuri.find(p => p.id === planSelectat)?.price != null ? t.adminSubsStandardPricePlaceholder(planuri.find(p => p.id === planSelectat).price) : t.adminSubsAmountPlaceholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '4px' }} />
            {(() => {
              const planStd = planuri.find(p => p.id === planSelectat)
              if (!planStd?.price || !pretPlatit) return <div style={{ marginBottom: '10px' }} />
              const diff = parseFloat(pretPlatit) - planStd.price
              if (diff === 0) return <div style={{ fontSize: '11px', color: '#0E0E0E', marginBottom: '10px' }}>{t.adminSubsAmountMatches}</div>
              return (
                <div style={{ fontSize: '11px', color: diff < 0 ? '#E24B4A' : '#BA7517', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {diff < 0 ? <AlertTriangle size={11} /> : <Info size={11} />}
                  {diff < 0 ? t.adminSubsAmountLess(Math.abs(diff), planStd.price) : t.adminSubsAmountMore(diff, planStd.price)}
                </div>
              )
            })()}
            <button onClick={saveAbonament} disabled={savingAbonament} style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingAbonament ? 'not-allowed' : 'pointer', opacity: savingAbonament ? 0.7 : 1 }}>
              {savingAbonament ? t.adminSubsSaving : t.adminSubsAddButton}
            </button>
          </div>
          {(() => {
            const fmtData = (d) => new Date(d + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })
            const grouped = {}
            abonamente.forEach(a => {
              const key = a.member_email?.toLowerCase()
              if (!grouped[key]) grouped[key] = []
              grouped[key].push(a)
            })
            const emails = Object.keys(grouped)
            return (
              <>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>{t.adminSubsListHeader(emails.length, abonamente.length)}</div>
                {emails.map(email => {
                  const list = grouped[email]
                  const activ = list.find(a => a.is_active && !a.queued)
                  const queued = list.filter(a => a.queued)
                  const membruNume = clienti.find(c => c.email?.toLowerCase() === email)?.full_name
                  const expanded = !!aboExpandat[email]
                  const zileRamase = activ ? daysUntil(activ.end_date) : null
                  const epuizat = activ && activ.sessions_total != null && Math.max(0, activ.sessions_total - (activ.sessions_used || 0)) === 0
                  const neinceput = activ && new Date(activ.start_date + 'T00:00:00') > new Date()
                  const expirat = activ && (zileRamase < 0 || epuizat)
                  const statusColor = !activ ? '#aaa' : expirat ? '#E24B4A' : neinceput ? '#BA7517' : '#0E0E0E'
                  const statusLabel = !activ ? t.adminSubsStatusNone : expirat ? t.adminSubsStatusExpired : neinceput ? t.adminSubsStatusNotStarted : t.adminSubsStatusActive
                  return (
                    <div key={email} style={{ background: '#fff', borderRadius: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
                      <div onClick={() => setAboExpandat(prev => ({ ...prev, [email]: !prev[email] }))}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', cursor: 'pointer', borderLeft: `4px solid ${statusColor}` }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{membruNume || email}</div>
                          <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>{email}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '8px', flexShrink: 0 }}>
                          {queued.length > 0 && <span style={{ fontSize: '10px', background: '#E8EEFF', color: '#5B7FCC', borderRadius: '6px', padding: '2px 6px', fontWeight: '600' }}>{t.adminSubsQueuedBadge(queued.length)}</span>}
                          <span style={{ fontSize: '11px', fontWeight: '600', color: statusColor }}>{statusLabel}</span>
                          <span style={{ fontSize: '14px', color: '#aaa', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</span>
                        </div>
                      </div>
                      {expanded && (
                        <div style={{ borderTop: '1px solid #f0f0f0', padding: '10px 14px 14px' }}>
                          {activ ? (
                            <div style={{ background: expirat ? '#FFF5F5' : neinceput ? '#FFFBF0' : '#FFFFFF', borderRadius: '10px', padding: '10px 12px', marginBottom: queued.length > 0 ? '8px' : '0', borderLeft: `3px solid ${statusColor}` }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: statusColor, marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {expirat ? <><AlertTriangle size={11} /> {t.adminSubsExpiredBadge}</> : neinceput ? <><Calendar size={11} /> {t.adminSubsNotStartedBadge}</> : t.adminSubsActiveBadge}
                              </div>
                              <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{activ.subscription_plans?.name}</div>
                              <div style={{ fontSize: '11px', color: '#666', marginTop: '3px' }}>{fmtData(activ.start_date)} → {fmtData(activ.end_date)}</div>
                              {activ.sessions_total != null && (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                  <span style={{ fontSize: '11px', color: epuizat ? '#E24B4A' : '#888' }}>{t.adminSubsSessionsLabel(activ.sessions_used || 0, activ.sessions_total)}</span>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <button onClick={e => { e.stopPropagation(); adminAjusteazaSedinte(activ.id, activ.sessions_used, activ.sessions_total, +1) }}
                                      style={{ width: '22px', height: '22px', borderRadius: '5px', border: '1px solid #0E0E0E', background: '#f0f0f0', color: '#0E0E0E', fontWeight: '700', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                    <button onClick={e => { e.stopPropagation(); adminAjusteazaSedinte(activ.id, activ.sessions_used, activ.sessions_total, -1) }}
                                      style={{ width: '22px', height: '22px', borderRadius: '5px', border: '1px solid #E24B4A', background: '#FCEBEB', color: '#E24B4A', fontWeight: '700', fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                                  </div>
                                </div>
                              )}
                              {activ.notes && <div style={{ fontSize: '11px', color: '#0E0E0E', marginTop: '3px' }}>{activ.notes}</div>}
                              <button onClick={e => { e.stopPropagation(); stergeAbonament(activ.id) }}
                                style={{ marginTop: '8px', padding: '4px 10px', borderRadius: '7px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>{t.adminSubsDeleteButton}</button>
                            </div>
                          ) : (
                            <div style={{ fontSize: '12px', color: '#aaa', textAlign: 'center', padding: '8px 0' }}>{t.adminSubsNoActiveSubscription}</div>
                          )}
                          {queued.map(q => (
                            <div key={q.id} style={{ background: '#F0F4FF', borderRadius: '10px', padding: '10px 12px', marginTop: '8px', borderLeft: '3px solid #5B7FCC' }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: '#5B7FCC', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={11} /> {t.adminSubsScheduledBadge}</div>
                              <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{q.subscription_plans?.name}</div>
                              {q.sessions_total != null && <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{t.adminSubsSessionsTotal(q.sessions_total)}</div>}
                              {q.notes && <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{q.notes}</div>}
                              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                <button onClick={e => { e.stopPropagation(); adminActiveazaAboQueued(q, email) }}
                                  style={{ flex: 1, padding: '6px', background: '#5B7FCC', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}><Zap size={12} /> {t.adminSubsActivateNow}</button>
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
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', marginBottom: '12px' }}>{t.adminClassNewTitle}</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminClassTypeLabel}</div>
            <input list="nume-clase-list" value={numeClasa} onChange={e => setNumeClasa(e.target.value)} placeholder={t.adminClassNamePlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <datalist id="nume-clase-list">
              <option value="CrossFit WOD" /><option value="Weightlifting" /><option value="Gymnastics" />
              <option value="Powerlifting" /><option value="Open Gym" /><option value="Kids CrossFit" /><option value="Foundations" />
            </datalist>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminClassDateLabel}</div>
            <input type="date" value={dataClasa} onChange={e => setDataClasa(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminClassStartTimeLabel}</div>
                <input type="time" value={oraInceput} onChange={e => setOraInceput(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminClassEndTimeLabel}</div>
                <input type="time" value={oraSfarsit} onChange={e => setOraSfarsit(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminClassCoachLabel}</div>
            <input value={coachClasa} onChange={e => setCoachClasa(e.target.value)} placeholder={t.adminClassCoachPlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminClassSpotsLabel}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <button onClick={() => setLocuriClasa(l => Math.max(1, l - 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>−</button>
              <span style={{ fontSize: '18px', fontWeight: '600', minWidth: '40px', textAlign: 'center' }}>{locuriClasa}</span>
              <button onClick={() => setLocuriClasa(l => Math.min(50, l + 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '16px', cursor: 'pointer' }}>+</button>
            </div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px' }}>{t.adminClassColorLabel}</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              {[null, '#0E0E0E', '#2E2E2E', '#5C6B1E', '#8C9B4A', '#ABE73C', '#afe607', '#C9D9A8'].map(col => (
                <div key={col || 'none'} onClick={() => setCuloarClasa(culoarClasa === col ? null : col)}
                  style={{ width: '30px', height: '30px', borderRadius: '50%', cursor: 'pointer', flexShrink: 0, boxSizing: 'border-box',
                    background: col || '#e0e0e0',
                    border: culoarClasa === col ? '3px solid #0E0E0E' : col ? '2px solid transparent' : '2px dashed #bbb',
                    boxShadow: culoarClasa === col ? '0 0 0 2px #fff inset' : 'none' }} />
              ))}
            </div>
            <div onClick={() => { setRepetitiva(!repetitiva); setZileRepetare([]); setLaInfinit(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: repetitiva ? '#f0f0f0' : '#FFFFFF', borderRadius: '10px', marginBottom: '10px', cursor: 'pointer', border: repetitiva ? '1.5px solid #0E0E0E' : '1.5px solid transparent' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '500', color: '#0E0E0E' }}>{t.adminClassRepeatWeeklyLabel}</div>
                <div style={{ fontSize: '11px', color: '#888' }}>{t.adminClassRepeatWeeklySubtitle}</div>
              </div>
              <div style={{ width: '44px', height: '26px', borderRadius: '13px', background: repetitiva ? '#0E0E0E' : '#ccc', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                <div style={{ position: 'absolute', top: '3px', left: repetitiva ? '21px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
            {repetitiva && (
              <div style={{ background: '#f0f0f0', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', color: '#0E0E0E', fontWeight: '600', marginBottom: '8px' }}>{t.adminClassWeekDaysLabel}</div>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '12px' }}>
                  {t.adminClassWeekDayLetters.map((z, i) => (
                    <div key={i} onClick={() => toggleZiRepetare(i)}
                      style={{ flex: 1, height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', fontWeight: '700', background: zileRepetare.includes(i) ? '#0E0E0E' : '#fff', color: zileRepetare.includes(i) ? '#fff' : '#888', border: zileRepetare.includes(i) ? '2px solid #0E0E0E' : '1px solid #C5C2F5' }}>
                      {z}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                  {[{ id: false, lbl: t.adminClassWeeksCountOption }, { id: true, lbl: t.adminClassUntilIStopOption }].map(opt => (
                    <div key={String(opt.id)} onClick={() => setLaInfinit(opt.id)}
                      style={{ flex: 1, padding: '7px', textAlign: 'center', borderRadius: '8px', cursor: 'pointer', fontSize: '11px', fontWeight: laInfinit === opt.id ? '600' : '400', background: laInfinit === opt.id ? '#0E0E0E' : '#fff', color: laInfinit === opt.id ? '#fff' : '#888', border: laInfinit === opt.id ? '2px solid #0E0E0E' : '1px solid #C5C2F5' }}>
                      {opt.lbl}
                    </div>
                  ))}
                </div>
                {!laInfinit && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <button onClick={() => setSaptamaniRepetare(s => Math.max(1, s - 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '16px', cursor: 'pointer' }}>−</button>
                    <span style={{ fontSize: '18px', fontWeight: '700', color: '#0E0E0E', minWidth: '80px', textAlign: 'center' }}>{t.adminClassWeeksAbbrev(saptamaniRepetare)}</span>
                    <button onClick={() => setSaptamaniRepetare(s => Math.min(52, s + 1))} style={{ width: '34px', height: '34px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fff', fontSize: '16px', cursor: 'pointer' }}>+</button>
                  </div>
                )}
                {laInfinit && (
                  <div style={{ fontSize: '11px', color: '#0E0E0E', marginBottom: '8px' }}>{t.adminClassInfiniteNote}</div>
                )}
                {dataClasa && zileRepetare.length > 0 && (() => {
                  const dates = genereazaDateRepetare()
                  if (dates.length === 0) return null
                  const last = new Date(dates[dates.length - 1] + 'T00:00:00')
                  return (
                    <div style={{ fontSize: '11px', color: '#0E0E0E', lineHeight: '1.6' }}>
                      {t.adminClassGeneratedCount(dates.length, last.toLocaleDateString(localeFor(lang)))}
                    </div>
                  )
                })()}
                {zileRepetare.length === 0 && <div style={{ fontSize: '11px', color: '#888' }}>{t.adminClassPickAtLeastOneDay}</div>}
              </div>
            )}
            <button onClick={saveClasa} disabled={savingClasa} style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingClasa ? 'not-allowed' : 'pointer', opacity: savingClasa ? 0.7 : 1 }}>
              {savingClasa ? t.adminClassSaving : repetitiva && zileRepetare.length > 0 && dataClasa ? t.adminClassCreateMultiple(genereazaDateRepetare().length) : t.adminClassCreateSingle}
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', color: '#888' }}>{t.adminClassListHeader(clase.length)}</div>
            {clase.some(c => c.date < `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`) && (
              <button onClick={stergeClaseleTrecute} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', cursor: 'pointer' }}>{t.adminClassDeletePast}</button>
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
              const ziLabel = dateObj.toLocaleDateString(localeFor(lang), { weekday: 'long', day: 'numeric', month: 'long' })
              return (
                <div key={date} style={{ marginBottom: '18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: eAzi ? '#0E0E0E' : eTrecut ? '#f0f0f0' : '#0E0E0E', borderRadius: '20px', padding: '5px 14px' }}>
                      {eAzi && <span style={{ fontSize: '10px', color: '#ABE73C', fontWeight: '800', letterSpacing: '0.08em' }}>{t.adminClassTodayBadge}</span>}
                      <span style={{ fontSize: '13px', fontWeight: '700', color: eAzi ? '#fff' : eTrecut ? '#aaa' : '#fff', textTransform: 'capitalize' }}>{ziLabel}</span>
                    </div>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                  </div>
                  {claseZi.map(c => (
                    <div key={c.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E' }}>{c.name}</div>
                          <div style={{ fontSize: '12px', color: '#888', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            <Clock size={11} /> {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)} · <User size={11} /> {c.coach} · {t.adminClassSpotsCount(c.max_spots)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => { if (clasaDeschisa === c.id) setClasaDeschisa(null); else { setClasaDeschisa(c.id); fetchRezervariClasa(c.id) } }}
                            style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#FFFFFF', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><Users size={13} color="#0E0E0E" /></button>
                          <button onClick={() => stergeClasa(c.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                          <button onClick={() => { if (window.confirm(t.adminClassDeleteSeriesConfirm(c.name, c.start_time?.slice(0,5)))) stergeSeria(c) }} style={{ padding: '4px 8px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{t.adminClassDeleteSeriesButton}</button>
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
                                <div style={{ fontSize: '11px', fontWeight: '600', color: '#888' }}>{t.adminClassBookingsHeader(nrTotal, c.max_spots)}</div>
                                {nrTotal > 0 && <div style={{ fontSize: '10px', fontWeight: '600', color: nrCheckin > 0 ? '#0E0E0E' : '#aaa', background: nrCheckin > 0 ? '#f0f0f0' : '#FFFFFF', padding: '2px 8px', borderRadius: '20px' }}>{t.adminClassPresentCount(nrCheckin, nrTotal)}</div>}
                              </div>
                            )
                          })()}
                          {!rezervariClasa[c.id] ? <div style={{ fontSize: '12px', color: '#aaa' }}>{t.adminClassLoading}</div>
                            : rezervariClasa[c.id].length === 0 ? <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '10px' }}>{t.adminClassNoBooking}</div>
                            : rezervariClasa[c.id].map((r, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: i < rezervariClasa[c.id].length - 1 ? '1px solid #FFFFFF' : 'none' }}>
                              <AvatarCircle name={r.full_name || r.email || r.member_id} avatarUrl={r.avatar_url} size={28} />
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '12px', fontWeight: '500', color: '#0E0E0E' }}>{r.full_name || t.adminClassUserFallback}</div>
                                <div style={{ fontSize: '10px', color: '#888' }}>{r.email || r.member_id?.slice(0,8) + '...'}</div>
                              </div>
                              {(() => {
                                const clasaInceput = new Date(`${c.date}T${c.start_time}`) <= new Date()
                                return (
                                  <button onClick={() => adminToggleCheckIn(c.id, r.member_id, r.checked_in)}
                                    style={{ padding: '3px 8px', borderRadius: '8px', border: r.checked_in ? '1px solid #0E0E0E' : '1px solid #d0d0d0', background: r.checked_in ? '#f0f0f0' : '#FFFFFF', color: r.checked_in ? '#0E0E0E' : '#aaa', fontSize: '11px', cursor: 'pointer', flexShrink: 0, fontWeight: r.checked_in ? '600' : '400' }}>
                                    {r.checked_in ? t.adminClassPresentLabel : clasaInceput ? t.adminClassAbsentLabel : t.adminClassMarkLabel}
                                  </button>
                                )
                              })()}
                              <button onClick={() => adminScoateDinClasa(c.id, r.member_id)}
                                style={{ padding: '3px 8px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#C62828', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                            </div>
                          ))}
                          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #FFFFFF' }}>
                            <div style={{ fontSize: '10px', fontWeight: '700', color: '#aaa', letterSpacing: '0.06em', marginBottom: '6px' }}>{t.adminClassAddManualLabel}</div>
                            <input value={adaugaMembruSearch[c.id] || ''} onChange={e => setAdaugaMembruSearch(prev => ({ ...prev, [c.id]: e.target.value }))}
                              placeholder={t.adminClassSearchMemberPlaceholder}
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
                                      style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <div>
                                        <div style={{ fontWeight: '500', color: '#0E0E0E' }}>{cl.full_name || cl.email}</div>
                                        <div style={{ fontSize: '10px', color: '#888' }}>{cl.email}</div>
                                      </div>
                                      <span style={{ fontSize: '11px', color: '#0E0E0E', fontWeight: '600' }}>{t.adminClassAddButton}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : <div style={{ fontSize: '11px', color: '#aaa', marginTop: '6px', padding: '4px' }}>{t.adminClassNoResult}</div>
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
            {/* Panoul cu data - fix, mereu vizibil, deasupra dropdown-urilor WARM-UP/SKILL/SKILL 2/Workout of the Day, aceeasi incadrare ca ele */}
            <div style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E', marginBottom: '8px' }}>{t.adminWodDateLabel}</div>
              <input type="date" value={dataWod} onChange={e => {
                // Schimbarea manuala a datei paraseste orice editare curenta -
                // fara asta, editWodId ramanea legat de WOD-ul vechi si
                // efectul de sincronizare de mai jos refuza sa incarce WOD-ul
                // zilei noi (garda "if (editWodId) return"), lasand
                // WARM-UP/SKILL/SKILL 2/Workout of the Day neschimbate.
                setEditWodId(null); resetWodFormFields(); setDataWod(e.target.value)
              }} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fff', boxSizing: 'border-box' }} />
            </div>
            <div style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px', marginBottom: '10px' }}>
              <div onClick={() => setAdminWarmupOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{t.adminWodWarmupLabel}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <MiniSwitch checked={warmupVisibleWod} onChange={(v) => { setWarmupVisibleWod(v); saveWodSection({ warmup_visible: v }, t.adminWodWarmupLabel) }} />
                  <span style={{ fontSize: '11px', color: '#888' }}>{adminWarmupOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {adminWarmupOpen && (
                <>
                  <textarea value={warmupWod} onChange={e => setWarmupWod(e.target.value)}
                    placeholder={t.adminWodWarmupPlaceholder} rows={3}
                    style={{ width: '100%', marginTop: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'system-ui', outline: 'none' }} />
                  <button onClick={() => saveWodSection({ warmup: parseLiniiWod(warmupWod), warmup_visible: warmupVisibleWod }, t.adminWodWarmupLabel)}
                    disabled={savingWod}
                    style={{ marginTop: '8px', width: '100%', padding: '8px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: savingWod ? 'not-allowed' : 'pointer', opacity: savingWod ? 0.6 : 1 }}>
                    {t.adminWodSaveSectionButton}
                  </button>
                </>
              )}
            </div>
            <div style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px', marginBottom: '10px' }}>
              <div onClick={() => setAdminSkillOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{t.adminWodSkillLabel}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <MiniSwitch checked={skillVisibleWod} onChange={(v) => { setSkillVisibleWod(v); saveWodSection({ skill_visible: v }, t.adminWodSkillLabel) }} />
                  <span style={{ fontSize: '11px', color: '#888' }}>{adminSkillOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {adminSkillOpen && (
                <div style={{ marginTop: '8px' }}>
                  <FormatConfigEditor formatId={skillTypeWod} onFormatChange={setSkillTypeWod}
                    config={skillFormatConfigWod} onConfigChange={setSkillFormatConfigWod} t={t} />
                  {skillTypeWod === 'Weightlifting' ? (
                    <CautareMiscare key={editWodId || 'new'} preFill={skillNameWod} onAleage={m => setSkillNameWod(m)} t={t} label={t.adminWodSkillMovementLabel} />
                  ) : (
                    <input value={skillNameWod} onChange={e => setSkillNameWod(e.target.value)} placeholder={t.adminWodSkillNamePlaceholder}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fff', boxSizing: 'border-box', marginBottom: '8px' }} />
                  )}
                  <textarea value={skillWod} onChange={e => setSkillWod(e.target.value)}
                    placeholder={t.adminWodSkillPlaceholder} rows={3}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'system-ui', outline: 'none' }} />
                  <button onClick={() => saveWodSection({
                    skill: parseLiniiWod(skillWod), skill_name: skillNameWod.trim() || null, skill_type: skillTypeWod,
                    skill_format_config: Object.keys(skillFormatConfigWod).length > 0 ? skillFormatConfigWod : null, skill_visible: skillVisibleWod,
                  }, t.adminWodSkillLabel)}
                    disabled={savingWod}
                    style={{ marginTop: '8px', width: '100%', padding: '8px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: savingWod ? 'not-allowed' : 'pointer', opacity: savingWod ? 0.6 : 1 }}>
                    {t.adminWodSaveSectionButton}
                  </button>
                </div>
              )}
            </div>
            <div style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px', marginBottom: '14px' }}>
              <div onClick={() => setAdminSkill2Open(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{t.adminWodSkill2Label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <MiniSwitch checked={skill2VisibleWod} onChange={(v) => { setSkill2VisibleWod(v); saveWodSection({ skill2_visible: v }, t.adminWodSkill2Label) }} />
                  <span style={{ fontSize: '11px', color: '#888' }}>{adminSkill2Open ? '▲' : '▼'}</span>
                </div>
              </div>
              {adminSkill2Open && (
                <div style={{ marginTop: '8px' }}>
                  <FormatConfigEditor formatId={skillType2Wod} onFormatChange={setSkillType2Wod}
                    config={skillFormatConfig2Wod} onConfigChange={setSkillFormatConfig2Wod} t={t} />
                  {skillType2Wod === 'Weightlifting' ? (
                    <CautareMiscare key={(editWodId || 'new') + '-skill2'} preFill={skillName2Wod} onAleage={m => setSkillName2Wod(m)} t={t} label={t.adminWodSkillMovementLabel} />
                  ) : (
                    <input value={skillName2Wod} onChange={e => setSkillName2Wod(e.target.value)} placeholder={t.adminWodSkillNamePlaceholder}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fff', boxSizing: 'border-box', marginBottom: '8px' }} />
                  )}
                  <textarea value={skill2Wod} onChange={e => setSkill2Wod(e.target.value)}
                    placeholder={t.adminWodSkillPlaceholder} rows={3}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'system-ui', outline: 'none' }} />
                  <button onClick={() => saveWodSection({
                    skill2: parseLiniiWod(skill2Wod), skill2_name: skillName2Wod.trim() || null, skill2_type: skillType2Wod,
                    skill2_format_config: Object.keys(skillFormatConfig2Wod).length > 0 ? skillFormatConfig2Wod : null, skill2_visible: skill2VisibleWod,
                  }, t.adminWodSkill2Label)}
                    disabled={savingWod}
                    style={{ marginTop: '8px', width: '100%', padding: '8px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: savingWod ? 'not-allowed' : 'pointer', opacity: savingWod ? 0.6 : 1 }}>
                    {t.adminWodSaveSectionButton}
                  </button>
                </div>
              )}
            </div>
            <div style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px', marginBottom: '14px' }}>
              <div onClick={() => setAdminWodFormOpen(v => !v)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{t.adminWodFormTitle}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {editWodId && (
                    <div onClick={(e) => { e.stopPropagation(); cancelEditWod() }} style={{ fontSize: '12px', color: '#888', cursor: 'pointer' }}>{t.adminWodCancel}</div>
                  )}
                  <span style={{ fontSize: '11px', color: '#888' }}>{adminWodFormOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {adminWodFormOpen && (
                <div style={{ marginTop: '12px' }}>
                  <FormatConfigEditor formatId={tipWod} onFormatChange={setTipWod}
                    config={formatConfigWod} onConfigChange={setFormatConfigWod}
                    excludeConfigKeys={['durationSec', 'timeCapSec']} t={t} />
                  {AUTO_DURATION_FORMAT_IDS.includes(tipWod) ? (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminWodDurationLabel}</div>
                      <div style={{ padding: '10px 12px', borderRadius: '10px', background: '#f0f0f0', fontSize: '13px', color: '#555' }}>
                        {estimateTotalDurationSec(tipWod, formatConfigWod) != null
                          ? <>{secToTime(estimateTotalDurationSec(tipWod, formatConfigWod))} <span style={{ color: '#aaa' }}>({t.adminWodDurationAuto})</span></>
                          : t.adminWodDurationPending}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminWodDurationLabel}</div>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <div style={{ flex: 1 }}>
                          <input type="number" min="0" value={durataWodMin} onChange={e => setDurataWodMin(e.target.value)} placeholder="20" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t.adminWodMinutesLabel}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <input type="number" min="0" max="59" value={durataWodSec} onChange={e => setDurataWodSec(e.target.value)} placeholder="0" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t.adminWodSecondsLabel}</div>
                        </div>
                      </div>
                    </>
                  )}
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminWodNameLabel} <span style={{ color: '#bbb' }}>{t.adminWodNameOptional}</span></div>
                  <input value={numeWod} onChange={e => setNumeWod(e.target.value)} placeholder='ex: "Fran", "Helen", "Grace"' style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
                  {[
                    { key: 'onramp', label: 'OnRamp', nivel: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB' },
                    { key: 'beginner', label: 'Beginner', nivel: 'Beginner', culoare: '#0E0E0E', bg: '#f0f0f0' },
                    { key: 'intermediate', label: 'Intermediate', nivel: 'Intermediate', culoare: '#633806', bg: '#FAEEDA' },
                    { key: 'rx', label: 'RX', nivel: 'RX', culoare: '#791F1F', bg: '#FCEBEB' },
                  ].map(v => (
                    <div key={v.key} style={{ background: v.bg, borderRadius: '12px', padding: '12px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '12px', fontWeight: '600', color: v.culoare, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}><LevelDot nivel={v.nivel} /> {v.label}</div>
                      {/* Greutatea prescrisa se compara doar la formatele 'scored'/'mixed'
                          (FormatLogger arata campul de Greutate doar acolo - vezi
                          ScoredFields in FormatLogger.jsx) - la 'sets'/'nft' (EMOM,
                          Weightlifting, Tabata, Strength Sets, Not For Time etc.) membrul
                          nu vede niciodata acel camp, deci orice valoare scrisa aici ar fi
                          complet inerta, fara niciun semnal ca nu face nimic. */}
                      {['scored', 'mixed'].includes(getFormat(tipWod)?.family) ? (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                          <input value={wodVarianteWeight[v.key].male} onChange={e => setWodVarianteWeight(prev => ({ ...prev, [v.key]: { ...prev[v.key], male: e.target.value } }))}
                            placeholder={`${t.adminWodWeightLabel} M (${t.adminWodWeightPlaceholderMale})`}
                            style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box' }} />
                          <input value={wodVarianteWeight[v.key].female} onChange={e => setWodVarianteWeight(prev => ({ ...prev, [v.key]: { ...prev[v.key], female: e.target.value } }))}
                            placeholder={`${t.adminWodWeightLabel} F (${t.adminWodWeightPlaceholderFemale})`}
                            style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box' }} />
                        </div>
                      ) : (
                        <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '8px' }}>{t.adminWodWeightUnavailableHint}</div>
                      )}
                      <SortableList
                        items={wodVariante[v.key]}
                        onReorder={(items) => setWodVariante(prev => ({ ...prev, [v.key]: items }))}
                        onRemove={(i) => setWodVariante(prev => ({ ...prev, [v.key]: prev[v.key].filter((_, j) => j !== i) }))}
                      />
                      <MiscareQuickAdd value={wodVarianteQuickAdd[v.key]} onChange={(val) => setWodVarianteQuickAdd(prev => ({ ...prev, [v.key]: val }))}
                        onAdd={(text) => setWodVariante(prev => ({ ...prev, [v.key]: [...prev[v.key], text] }))}
                        placeholder={t.logWodMovementPlaceholder('kg')} weightUnit="kg" t={t} hideWeight />
                      <textarea value={wodVariantePaste[v.key]} onChange={e => setWodVariantePaste(prev => ({ ...prev, [v.key]: e.target.value }))}
                        placeholder={t.adminWodVariantPastePlaceholder} rows={3}
                        style={{ width: '100%', marginTop: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'system-ui', outline: 'none' }} />
                      {wodVariantePaste[v.key].trim() && (
                        <button onClick={() => {
                          const linii = wodVariantePaste[v.key].split('\n').map(l => l.trim()).filter(Boolean).map(parseMiscareLinePasta)
                          setWodVariante(prev => ({ ...prev, [v.key]: [...prev[v.key], ...linii] }))
                          setWodVariantePaste(prev => ({ ...prev, [v.key]: '' }))
                        }}
                          style={{ marginTop: '6px', padding: '7px 14px', background: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', fontSize: '12px', fontWeight: '600', color: '#555', cursor: 'pointer' }}>
                          {t.adminWodVariantPasteButton}
                        </button>
                      )}
                      <div style={{ fontSize: '11px', color: '#888', marginTop: '10px', marginBottom: '4px' }}>{t.adminWodNotesLabel} <span style={{ color: '#bbb' }}>{t.adminWodNameOptional}</span></div>
                      <input value={wodVarianteNote[v.key]} onChange={e => setWodVarianteNote(prev => ({ ...prev, [v.key]: e.target.value }))}
                        placeholder={t.adminWodNotesPlaceholder}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '12px', background: '#fff', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <button onClick={() => {
                    const variante = flushWodVariantePaste()
                    saveWodSection({
                      type: tipWod, duration: `${parseInt(durataWodMin) || 0}:${String(parseInt(durataWodSec) || 0).padStart(2, '0')}`,
                      format_config: Object.keys(formatConfigWod).length > 0 ? formatConfigWod : null,
                      name: numeWod.trim() || null,
                      notes_onramp: wodVarianteNote.onramp.trim() || null,
                      notes_beginner: wodVarianteNote.beginner.trim() || null,
                      notes_intermediate: wodVarianteNote.intermediate.trim() || null,
                      notes_rx: wodVarianteNote.rx.trim() || null,
                      movements_onramp: variante.onramp, movements_beginner: variante.beginner,
                      movements_intermediate: variante.intermediate, movements_rx: variante.rx,
                      ...buildVarianteWeightPayload(),
                    }, t.adminWodFormTitle)
                  }}
                    disabled={savingWod}
                    style={{ marginTop: '4px', width: '100%', padding: '8px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: savingWod ? 'not-allowed' : 'pointer', opacity: savingWod ? 0.6 : 1 }}>
                    {t.adminWodSaveSectionButton}
                  </button>
                </div>
              )}
            </div>
            <button onClick={saveWod} disabled={savingWod} style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingWod ? 'not-allowed' : 'pointer', opacity: savingWod ? 0.7 : 1 }}>
              {savingWod ? t.adminWodSaving : editWodId ? t.adminWodSaveEdit : t.adminWodCreateButton}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>{t.adminWodListHeader(wods.length)}</div>
          {wods.map(w => (
            <div key={w.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E' }}>{w.name ? `"${w.name}" · ` : ''}{w.type} {formatWodDurata(w.duration)}</div>
                  {describeFormatConfig(w.type, w.format_config, t) && (
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{describeFormatConfig(w.type, w.format_config, t)}</div>
                  )}
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={11} /> {new Date(w.date + 'T00:00:00').toLocaleDateString(localeFor(lang))}</div>
                  {w.movements_rx?.length > 0 && <div style={{ fontSize: '11px', color: '#791F1F', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}><LevelDot nivel="RX" size={8} /> {w.movements_rx.slice(0,2).join(', ')}{w.movements_rx.length > 2 ? '...' : ''}</div>}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  <button onClick={() => startEditWod(w)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #e0e0e0', background: '#fafafa', color: '#0E0E0E', fontSize: '11px', cursor: 'pointer' }}>✎</button>
                  <button onClick={() => stergeWod(w.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      {/* PLANURI */}
      {adminTab === 'planuri' && isAdmin && (
        <>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E', marginBottom: '12px' }}>{t.adminPlansNewTitle}</div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminPlansNameLabel}</div>
            <input value={numePlan} onChange={e => setNumePlan(e.target.value)} placeholder={t.adminPlansNamePlaceholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminPlansSessionsLabel}</div>
            <input type="number" value={sedintePlan} onChange={e => setSedintePlan(e.target.value)} placeholder={t.adminPlansSessionsPlaceholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminPlansPriceLabel}</div>
            <input type="number" value={pretPlan} onChange={e => setPretPlan(e.target.value)} placeholder={t.adminPlansPricePlaceholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '10px' }} />
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminPlansDurationLabel}</div>
            <input type="number" min="1" value={durataPlan} onChange={e => setDurataPlan(Math.max(1, parseInt(e.target.value) || 1))} placeholder={t.adminPlansDurationPlaceholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
            <button onClick={savePlan} disabled={savingPlan} style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: savingPlan ? 'not-allowed' : 'pointer', opacity: savingPlan ? 0.7 : 1 }}>
              {savingPlan ? t.adminPlansSaving : t.adminPlansAddButton}
            </button>
          </div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '10px' }}>{t.adminPlansListHeader(planuri.length)}</div>
          {planuri.map(p => (
            <div key={p.id} style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E' }}>{p.name}</div>
                  <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>
                    {p.sessions ? t.adminPlansSessionsCount(p.sessions) : t.adminPlansUnlimited} · {p.price != null ? t.adminPlansPriceSet(p.price) : t.adminPlansPriceUnset} · {p.duration_months || 1} {(p.duration_months || 1) === 1 ? t.adminPlansMonthSingular : t.adminPlansMonthPlural}
                  </div>
                </div>
                <button onClick={() => stergePlan(p.id)} style={{ padding: '4px 10px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#791F1F', fontSize: '11px', cursor: 'pointer' }}>🗑️</button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* SETĂRI */}
      {adminTab === 'setari' && isAdmin && (
        <>
        <div style={{ background: '#fff', borderRadius: '14px', padding: '16px 20px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '6px' }}><BarChart3 size={15} /> {t.adminSettingsReportsTitle}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '11px', color: '#888' }}>{new Date().toLocaleDateString(localeFor(lang), { month: 'long', year: 'numeric' })}</div>
              <button onClick={fetchRapoarte} style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '20px', border: 'none', background: '#f0f0f0', color: '#0E0E0E', fontWeight: '600', cursor: 'pointer' }}>↻</button>
            </div>
          </div>
          {rapoarteData ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
              {[
                { label: t.adminSettingsActiveMembers, value: rapoarteData.membriActivi, icon: Users, color: '#5B7FCC', bg: '#EEF2FF' },
                { label: t.adminSettingsSubsThisMonth, value: rapoarteData.aboVandute, icon: Ticket, color: '#0E0E0E', bg: '#f0f0f0' },
                { label: t.adminSettingsRevenueRon, value: rapoarteData.venituriLuna % 1 === 0 ? rapoarteData.venituriLuna : rapoarteData.venituriLuna.toFixed(0), icon: Coins, color: '#B86E00', bg: '#FFF8EC' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} style={{ background: bg, borderRadius: '12px', padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ marginBottom: '4px', display: 'flex', justifyContent: 'center' }}><Icon size={20} color={color} strokeWidth={1.75} /></div>
                  <div style={{ fontSize: '22px', fontWeight: '800', color, lineHeight: 1 }}>{value}</div>
                  <div style={{ fontSize: '10px', color: '#888', marginTop: '4px', lineHeight: '1.3' }}>{label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#aaa', fontSize: '13px', padding: '20px 0' }}>{t.adminSettingsLoading}</div>
          )}
        </div>
        <div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#0E0E0E', marginBottom: '4px' }}>{t.adminSettingsCancelWindowTitle}</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '20px' }}>{t.adminSettingsCancelWindowSubtitle}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <button onClick={() => setCancelWindowSetting(prev => Math.max(0, prev - 0.5))}
              style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f9f9f9', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }}>−</button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#0E0E0E', lineHeight: 1 }}>{cancelWindowSetting}</div>
              <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>{t.adminSettingsHoursLabel}</div>
            </div>
            <button onClick={() => setCancelWindowSetting(prev => prev + 0.5)}
              style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid #e0e0e0', background: '#f9f9f9', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }}>+</button>
          </div>
          {cancelWindowSetting === 0 && (
            <div style={{ fontSize: '11px', color: '#0E0E0E', background: '#f0f0f0', padding: '8px 12px', borderRadius: '8px', marginBottom: '16px' }}>{t.adminSettingsNoRestriction}</div>
          )}
          <button onClick={saveSettings} disabled={savingSettings}
            style={{ width: '100%', padding: '13px', background: savingSettings ? '#e0e0e0' : '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: savingSettings ? 'not-allowed' : 'pointer' }}>
            {savingSettings ? t.adminSettingsSaving : t.adminSettingsSaveButton}
          </button>
        </div>
        <div style={{ background: '#fff', borderRadius: '14px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '14px' }}>
          <div style={{ fontSize: '15px', fontWeight: '700', color: '#0E0E0E', marginBottom: '4px' }}>{t.adminSettingsCoachTitle}</div>
          <div style={{ fontSize: '12px', color: '#888', marginBottom: '14px' }}>{t.adminSettingsCoachSubtitle}</div>
          <input value={coachSearch} onChange={e => setCoachSearch(e.target.value)}
            placeholder={t.adminSettingsCoachSearchPlaceholder}
            style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
          {coachesList.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              {coachesList.map(co => (
                <div key={co.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ fontSize: '13px', color: '#0E0E0E' }}>{co.email}</span>
                  <button onClick={() => removeCoach(co.id)}
                    style={{ padding: '3px 8px', borderRadius: '8px', border: '1px solid #F7C1C1', background: '#FCEBEB', color: '#C62828', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                </div>
              ))}
            </div>
          )}
          {coachSearch.trim() && (() => {
            const q = coachSearch.toLowerCase()
            const rezultate = clienti.filter(cl =>
              (cl.full_name?.toLowerCase().includes(q) || cl.email?.toLowerCase().includes(q)) &&
              !coachesList.some(co => co.id === cl.id)
            ).slice(0, 5)
            return rezultate.length > 0 ? (
              <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: '10px', marginTop: '4px', overflow: 'hidden' }}>
                {rezultate.map(cl => (
                  <div key={cl.id} onClick={() => addCoach(cl.id, cl.email)}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid #FFFFFF', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: '500', color: '#0E0E0E' }}>{cl.full_name || cl.email}</div>
                      <div style={{ fontSize: '10px', color: '#888' }}>{cl.email}</div>
                    </div>
                    <span style={{ fontSize: '11px', color: '#0E0E0E', fontWeight: '600' }}>{t.adminSettingsAddCoachButton}</span>
                  </div>
                ))}
              </div>
            ) : <div style={{ fontSize: '12px', color: '#aaa', marginTop: '8px' }}>{t.adminSettingsNoResult}</div>
          })()}
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
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 10px', background: activeIdx === i ? '#ABE73C' : '#f0f0f0', borderRadius: '8px', marginBottom: '6px', boxShadow: activeIdx === i ? '0 4px 14px rgba(0,0,0,0.13)' : 'none', transition: 'box-shadow 0.1s, background 0.1s', touchAction: 'none', userSelect: 'none' }}>
          <span style={{ fontSize: '16px', color: '#bbb', padding: '0 6px', flexShrink: 0 }}>☰</span>
          {editIdx === i ? (
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                autoFocus
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onBlur={() => commitEdit(i)}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(i) }}
                style={{ width: '100%', border: 'none', background: 'transparent', fontSize: '13px', color: '#0E0E0E', outline: 'none', padding: '0', touchAction: 'auto', boxSizing: 'border-box' }}
              />
              {miscareSugestii(editVal).length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#fff', borderRadius: '10px', marginTop: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', overflow: 'hidden', border: '1px solid #e0e0e0' }}>
                  {miscareSugestii(editVal).map((s, si) => (
                    <div key={si} onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        // Click pe sugestie salveaza direct editarea (nu doar completeaza
                        // textul) - acelasi fix ca la MiscareQuickAdd: altfel utilizatorul
                        // credea ca a salvat mutarea, dar ramanea doar scrisa in input pana
                        // la un blur/Enter separat.
                        const parts = editVal.split(/\s+/); parts[parts.length - 1] = s
                        const finalVal = parts.join(' ').trim()
                        if (finalVal) { const next = [...items]; next[i] = finalVal; onReorder(next) }
                        setEditIdx(null); setEditVal('')
                      }}
                      style={{ padding: '10px 14px', cursor: 'pointer', fontSize: '13px', color: '#0E0E0E' }}>{s}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize: '13px', color: '#0E0E0E', flex: 1 }}>• {m}</span>
          )}
          {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(i) }} style={{ background: 'none', border: 'none', color: '#aaa', fontSize: '16px', cursor: 'pointer', lineHeight: 1, touchAction: 'auto', flexShrink: 0 }}>×</button>}
        </div>
      ))}
    </div>
  )
}

// Elimina greutatea de pornire ("@ 50kg") din afisarea unei miscari a unui
// log family:'sets' (Complex, Weightlifting etc.) - e doar greutatea PRIMEI
// runde, statica, nereprezentativa (creste/scade pe parcurs), iar progresia
// reala e deja vizibila mai jos, in defalcarea pe runde si in REZULTAT
// (greutatea maxima) - a o repeta aici static era confuz/redundant langa
// scorul real.
function stripWeightSuffix(movementLine) {
  return movementLine.replace(/\s*@\s*[\d./]+\s*(kg|lbs)\s*$/i, '')
}

// Extrage miscarile/rezultatul/seturile/nota unui wod_log din campurile brute
// (notes/sets/result/time_result/log_meta) - o singura sursa de parsare
// folosita atat de JurnalList (randul propriu, cu editare/stergere) cat si
// de Clasament (dropdown-ul altui participant, doar de vizualizat) - fara
// asta, cele 2 ecrane ar fi trebuit sa parseze aceleasi campuri separat, cu
// risc sa diverga.
function parseWodLogDetails(w, t) {
  const parts = (w.notes || '').split('\n---\n')
  const miscariLog = parts.length > 1 ? parts[0] : (parts[0] || null)
  const noteLog = parts.length > 1 ? parts[1] : null
  const linii = miscariLog ? miscariLog.trim().split('\n').filter(Boolean) : []
  // Formatul detectat din prima linie a header-ului text vechi (ex. "AMRAP
  // 20:00") - null daca nu exista/nu se recunoaste. Folosit atat ca sa stim
  // cate linii sa taiem de la inceputul listei de miscari, cat si ca ultim
  // fallback pt tipul real al logului (vezi isNotRxd la ambele ecrane).
  const headerFormatId = linii.length > 0 ? legacyHeaderTypeOf(linii[0]) : null
  const miscariAfisate = linii.slice(headerFormatId ? 1 : 0)
  const wHasSets = w.sets && Object.keys(w.sets).length > 0
  const wSetsParti = wHasSets ? Object.entries(w.sets).map(([cheie, seturi]) => ({
    cheie, seturiTxt: (seturi || []).map((set, si) => {
      const bucati = []
      if (set.reps) bucati.push(`${set.reps} reps`)
      if (set.weight) bucati.push(`${set.weight}`)
      return `${t.skillLogSetLabel(si + 1)}: ${bucati.join(' @ ')}`
    }).join(' · '),
  })) : []
  const rezultatBucati = [w.result, w.time_result, wHasSets ? t.jurnalSetsCountLabel(wSetsParti.length) : null, w.log_meta?.completed ? t.jurnalCompletedLabel : null].filter(Boolean)
  const areRezultat = rezultatBucati.length > 0
  const areDetalii = miscariAfisate.length > 0 || (noteLog && noteLog.trim()) || wHasSets || areRezultat
  return { miscariAfisate, noteLog, wHasSets, wSetsParti, rezultatBucati, areRezultat, areDetalii, headerFormatId }
}

function JurnalList({ entries, onEditWod, onDeleteWod, onEditSkill, onDeleteSkill, gender, weightUnit, t, lang }) {
  const unitLabel = weightUnit === 'lbs' ? 'lbs' : 'kg'
  const [deschis, setDeschis] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deschisSkill, setDeschisSkill] = useState(null)
  const [confirmDeleteSkill, setConfirmDeleteSkill] = useState(null)
  if (entries.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
      <div style={{ fontSize: '36px', marginBottom: '10px' }}>📓</div>
      <div style={{ fontSize: '14px' }}>{t.jurnalEmpty}</div>
    </div>
  )
  return (
    <>
      {entries.map((entry, i) => {
        const w = entry.wodLog
        const skillLogsArr = entry.skillLogsArr || []
        const dataAfisata = entry.date ? new Date(entry.date).toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'
        return (
          <div key={entry.key}>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#0E0E0E', marginBottom: '6px', marginTop: i > 0 ? '4px' : '0' }}>{dataAfisata}</div>
            {w && (() => {
              const logKey = w.id
              const isOpen = deschis === logKey
              const { miscariAfisate, noteLog, wHasSets, wSetsParti, rezultatBucati: rezultatBucatiRaw, areRezultat, areDetalii, headerFormatId } = parseWodLogDetails(w, t)
              // Titlu: "Nume WOD" | Varianta (daca WOD-ul are nume) - altfel doar
              // varianta, ca inainte. Subtitlu: formatul + durata reale ale WOD-ului
              // legat (ex. "AMRAP 20:00") - la logare libera (fara wod_id) nu exista
              // un WOD legat, iar variant_level e deja formatul insusi, deci n-are
              // sens sa-l repetam pe un rand separat.
              const wodNume = w.wods?.name || null
              const wodSubtitlu = w.wods ? `${formatTypeLabel(w.wods.type, w.wods.format_config)}${w.wods.duration ? ' ' + formatWodDurata(w.wods.duration) : ''}` : null
              const prescribedWeightLog = w.wods?.[weightKeyForVariant(w.variant_level, gender)] || null
              // Incercam toate semnalele posibile pt tipul real (wods legat,
              // format_type, sau header-ul text vechi) - isNotRxd/effectiveScoreMode
              // trateaza deja corect cazul cand niciunul nu exista (formatId absent
              // -> nu presupune "For Time", sare peste verificarea de time cap).
              const formatTipResolvat = w.wods?.type || w.format_type || headerFormatId
              const notRxdLog = isNotRxd(w, prescribedWeightLog, formatTipResolvat, w.wods?.format_config)
              // Family 'sets' fara scoringMode configurat (Complex, Weightlifting,
              // Build to Heavy/1RM etc.) - rezultatBucati brut arata doar "X seturi",
              // fara nicio greutate (bug raportat: un Complex cu greutate maxima
              // 65kg logat separat aratat doar "10 seturi" in Jurnal, nefolositor).
              // Pentru aceasta familie, result/time_result/log_meta sunt mereu
              // null (composeWodLogFields) - rezultatBucatiRaw n-are niciodata
              // altceva in afara de "X seturi", deci inlocuim complet (nu doar
              // adaugam), altfel "65kg" si "10 seturi" ar aparea impreuna, unul
              // util, celalalt fara sens langa greutatea reala.
              const wSetsScore = wHasSets ? setsDisplayScore(formatTipResolvat, w.wods?.format_config, w.sets) : null
              const rezultatBucati = wSetsScore != null ? [`${wSetsScore}${unitLabel}`] : rezultatBucatiRaw
              return (
                <div onClick={() => { setDeschis(isOpen ? null : logKey); setConfirmDelete(null) }}
                  style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #0E0E0E', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {wodNume ? `"${wodNume}" | ${w.variant_level || 'WOD'}` : (w.variant_level || 'WOD')}
                      {notRxdLog && <NotRxdBadge t={t} compact />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {onDeleteWod && (
                        confirmDelete === logKey ? (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteWod(w.id); setConfirmDelete(null) }}
                            style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: '#e53935', border: 'none', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}>
                            {t.jurnalDeleteConfirm}
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
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#aaa', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Calendar size={10} strokeWidth={2} />
                      {new Date(w.logged_at).toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} strokeWidth={2} />
                      {new Date(w.logged_at).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {wodSubtitlu && (
                    <div style={{ marginTop: '2px', fontSize: '12px', color: '#888' }}>{wodSubtitlu}</div>
                  )}
                  {!isOpen && !areRezultat && (
                    <div style={{ marginTop: '6px', fontSize: '12px', color: '#aaa' }}>—</div>
                  )}
                  {isOpen && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                      {miscariAfisate.length > 0 && (
                        <div style={{ marginBottom: (wHasSets || areRezultat || (noteLog && noteLog.trim())) ? '10px' : '0' }}>
                          {miscariAfisate.map((m, j) => (
                            <div key={j} style={{ fontSize: '12px', color: '#555', padding: '2px 0' }}>• {wHasSets ? stripWeightSuffix(m) : m}</div>
                          ))}
                        </div>
                      )}
                      {areRezultat && (
                        <div style={{ marginTop: '4px', marginBottom: (wHasSets || (noteLog && noteLog.trim())) ? '12px' : '0', paddingTop: '10px', borderTop: '1px solid #f0f0f0' }}>
                          <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{t.jurnalResultLabel}</div>
                          <div style={{ fontSize: '14px', color: '#0E0E0E', fontWeight: '700' }}>{rezultatBucati.join(' · ')}</div>
                        </div>
                      )}
                      {wHasSets && (
                        <div style={{ marginBottom: noteLog && noteLog.trim() ? '10px' : '0' }}>
                          {wSetsParti.map((p, j) => (
                            <div key={j} style={{ marginBottom: '6px' }}>
                              <div style={{ fontSize: '12px', color: '#0E0E0E', fontWeight: '600' }}>{p.cheie}</div>
                              <div style={{ fontSize: '11px', color: '#888' }}>{p.seturiTxt}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {noteLog && noteLog.trim() && (
                        <div>
                          <div style={{ fontSize: '10px', color: '#888', fontWeight: '600', marginBottom: '4px' }}>{t.jurnalNoteLabel}</div>
                          <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>{noteLog.trim()}</div>
                        </div>
                      )}
                      {!areDetalii && (
                        <div style={{ fontSize: '12px', color: '#aaa' }}>{t.jurnalNoDetails}</div>
                      )}
                      {onEditWod && (
                        <button onClick={(e) => { e.stopPropagation(); onEditWod(w) }}
                          style={{ marginTop: '12px', padding: '7px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', color: '#555', cursor: 'pointer' }}>
                          {t.jurnalEdit}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
            {skillLogsArr.map(sl => (() => {
              const hasSets = sl.sets && Object.keys(sl.sets).length > 0
              const skillKey = sl.id
              const skillOpen = deschisSkill === skillKey
              const esteSlot2 = sl.slot === 2
              const skillTitleName = esteSlot2 ? sl.wods?.skill2_name : sl.wods?.skill_name
              // Formatele family:'sets' fara scoringMode configurat (Complex,
              // Weightlifting, Strength Sets, Build to Heavy/1RM, Death By
              // Weight, Superset) nu arata NICIUN rezultat rezumat - doar
              // defalcarea pe runde, ingropata in dropdown-ul expandat. Acelasi
              // gol ca la Clasament (reparat cu setsDisplayScore) - membrul
              // trebuia sa citeasca fiecare runda ca sa afle cea mai mare
              // greutate cu care a terminat, in loc s-o vada dintr-o privire.
              const skillFormatId = esteSlot2 ? sl.wods?.skill2_type : sl.wods?.skill_type
              const skillFormatConfigActual = esteSlot2 ? sl.wods?.skill2_format_config : sl.wods?.skill_format_config
              const skillScor = hasSets ? setsDisplayScore(skillFormatId, skillFormatConfigActual, sl.sets) : null
              const parti = []
              if (hasSets) {
                Object.entries(sl.sets).forEach(([miscare, seturi]) => {
                  const seturiTxt = (seturi || []).map((set, si) => {
                    if (typeof set === 'string') return `${t.skillLogSetLabel(si + 1)}: ${set}`
                    const bucati = []
                    if (set.reps) bucati.push(`${set.reps} reps`)
                    if (set.weight) bucati.push(`${set.weight}`)
                    return `${t.skillLogSetLabel(si + 1)}: ${bucati.join(' @ ')}`
                  }).join(' · ')
                  parti.push({ miscare, seturiTxt })
                })
              }
              return (
                <div key={sl.id} onClick={() => { setDeschisSkill(skillOpen ? null : skillKey); setConfirmDeleteSkill(null) }}
                  style={{ background: '#fff', borderRadius: '14px', padding: '14px', marginBottom: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: '4px solid #ABE73C', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E' }}>{esteSlot2 ? t.homeWodSkill2Title : t.jurnalSkillTitle}{skillTitleName ? ` · ${skillTitleName}` : ''}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {onDeleteSkill && (
                        confirmDeleteSkill === skillKey ? (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteSkill(sl.id); setConfirmDeleteSkill(null) }}
                            style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: '#e53935', border: 'none', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer' }}>
                            {t.jurnalDeleteConfirm}
                          </button>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteSkill(skillKey) }}
                            style={{ fontSize: '16px', color: '#ccc', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>
                            ×
                          </button>
                        )
                      )}
                      <span style={{ fontSize: '14px', color: '#aaa' }}>{skillOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#aaa', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Calendar size={10} strokeWidth={2} />
                      {new Date(sl.logged_at).toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <Clock size={10} strokeWidth={2} />
                      {new Date(sl.logged_at).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {skillOpen && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }}>
                      {skillScor != null && (
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{t.jurnalResultLabel}</div>
                          <div style={{ fontSize: '14px', color: '#0E0E0E', fontWeight: '700' }}>{skillScor}{unitLabel}</div>
                        </div>
                      )}
                      {hasSets ? (
                        <div style={{ marginBottom: sl.notes ? '10px' : 0 }}>
                          {parti.map((p, j) => (
                            <div key={j} style={{ marginBottom: '6px' }}>
                              <div style={{ fontSize: '12px', color: '#0E0E0E', fontWeight: '600' }}>{p.miscare}</div>
                              <div style={{ fontSize: '11px', color: '#888' }}>{p.seturiTxt}</div>
                            </div>
                          ))}
                        </div>
                      ) : sl.result ? (
                        <div style={{ fontSize: '13px', color: '#0E0E0E', marginBottom: sl.notes ? '10px' : 0 }}>{sl.result}</div>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#aaa' }}>{t.jurnalSkillNoResult}</div>
                      )}
                      {sl.notes && (
                        <div>
                          <div style={{ fontSize: '10px', color: '#888', fontWeight: '600', marginBottom: '4px' }}>{t.jurnalNoteLabel}</div>
                          <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>{sl.notes}</div>
                        </div>
                      )}
                      {onEditSkill && (
                        <button onClick={(e) => { e.stopPropagation(); onEditSkill(sl) }}
                          style={{ marginTop: '12px', padding: '7px 16px', background: '#f0f0f0', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', color: '#555', cursor: 'pointer' }}>
                          {t.jurnalEdit}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })())}
          </div>
        )
      })}
    </>
  )
}

// Sectiune Skill Work pe Acasa (SKILL sau SKILL 2 - aceeasi randare, doar
// alte date) - extrasa ca sa nu duplicam ~50 de linii JSX identice pentru
// cele 2 sloturi.
function SkillHomeSection({ titleLabel, skillMovements, skillName, skillType, skillFormatConfig, logZiSkill, isOpen, onToggle, onLogClick, userProfile, hiddenFromMembers, t }) {
  const areDate = (skillMovements || []).length > 0 || skillName || skillFormatConfig
  if (!areDate) return null
  return (
    <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '10px' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
        <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '0.06em' }}>
          {titleLabel}
          {hiddenFromMembers && (
            <span style={{ marginLeft: '6px', fontWeight: '600', textTransform: 'none', letterSpacing: 'normal', color: '#c99a3a' }}>({t.homeWodHiddenFromMembers})</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {skillName && <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>{skillName}</div>}
          <span style={{ fontSize: '10px', color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>
        </div>
      </div>
      {isOpen && (
        <>
          {skillType === 'Complex' && skillFormatConfig?.complexMovements?.length > 0 ? (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#0E0E0E' }}>COMPLEX</div>
              {skillFormatConfig.rounds && (
                <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{t.fmtRoundsAttempts}: {skillFormatConfig.rounds}</div>
              )}
              <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>{skillFormatConfig.complexMovements.join(' + ')}</div>
            </div>
          ) : describeFormatConfig(skillType, skillFormatConfig, t) && (
            <div style={{ fontSize: '11px', color: '#888', marginTop: '8px' }}>{skillType} — {describeFormatConfig(skillType, skillFormatConfig, t)}</div>
          )}
          <div style={{ marginTop: '10px' }}>
            {(() => {
              const unitate = userProfile?.weight_unit === 'lbs' ? 'lbs' : 'kg'
              const seturiTextPentru = (rows) => (rows || []).map((set, si) => {
                const { reps, weight } = typeof set === 'string' ? { reps: '', weight: set } : set
                const parti = []
                if (reps) parti.push(`${reps} reps`)
                if (weight) parti.push(`${weight}${unitate}`)
                return `${t.skillLogSetLabel(si + 1)}: ${parti.join(' @ ')}`
              }).join(' · ')
              // Weightlifting/Strength Sets/Superset: seturile sunt cheiate pe numele
              // miscarii (afisate langa fiecare). EMOM/Tabata/Death By/Complex: cheiate
              // pe interval/runda, aratam direct randurile logate (nu au corespondent
              // 1:1 in skillMovements).
              if (getFormat(skillType || 'Weightlifting').rowMode === 'movement' || !logZiSkill?.sets) {
                return (skillMovements || []).map((m, mi) => (
                  <div key={mi} style={{ padding: '3px 0' }}>
                    <div style={{ fontSize: '13px', color: '#0E0E0E' }}>• {m}</div>
                    {(logZiSkill?.sets?.[m] || []).length > 0 && (
                      <div style={{ fontSize: '12px', color: '#888', marginLeft: '12px', marginTop: '2px' }}>
                        {seturiTextPentru(logZiSkill.sets[m])}
                      </div>
                    )}
                  </div>
                ))
              }
              return Object.entries(logZiSkill.sets).map(([cheie, rows]) => (
                <div key={cheie} style={{ padding: '3px 0' }}>
                  <div style={{ fontSize: '13px', color: '#0E0E0E' }}>• {cheie}</div>
                  {rows.length > 0 && (
                    <div style={{ fontSize: '12px', color: '#888', marginLeft: '12px', marginTop: '2px' }}>
                      {seturiTextPentru(rows)}
                    </div>
                  )}
                </div>
              ))
            })()}
          </div>
          <button onClick={onLogClick}
            style={{ marginTop: '10px', width: '100%', padding: '8px', background: logZiSkill ? '#f0f0f0' : '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' }}>
            {logZiSkill ? t.homeEditSkillButton : t.homeLogSkillButton}
          </button>
        </>
      )}
    </div>
  )
}

// Eticheta "Not RX'd" - randata identic in Clasament, JurnalList si
// WorkoutSharePopup (inainte, 3 stiluri inline usor diferite intre ele, fara
// niciun motiv functional). `compact` = varianta mica de pe cardurile de
// Clasament (langa numele participantului).
function NotRxdBadge({ t, compact }) {
  return (
    <span style={{ fontSize: compact ? '9px' : '11px', fontWeight: '700', color: '#888', background: '#f0f0f0', borderRadius: '20px', padding: compact ? '2px 7px' : '4px 10px' }}>
      {t.notRxdBadge}
    </span>
  )
}

// Card de felicitare afisat dupa "Save Workout" - branding sala + antrenamentul
// facut + scorul + variantă + data/ora + un mesaj de felicitare, cu buton de
// distribuire (Web Share API - pe mobil deschide sheet-ul nativ cu WhatsApp/
// social media direct, fara integrare separata per platforma).
function WorkoutSharePopup({ data, onClose, t, lang }) {
  if (!data) return null
  const { wodName, movements, variantLevel, variantColor, variantBg, result, timeResult, loggedAt, notRxd } = data
  const scoreParts = [result, timeResult].filter(Boolean)
  const dataObj = new Date(loggedAt)
  const shareText = [
    'CrossFit C15',
    wodName ? `"${wodName}"` : null,
    (movements && movements.length > 0) ? movements.join(', ') : null,
    scoreParts.length > 0 ? scoreParts.join(' · ') : null,
    variantLevel ? `(${variantLevel})` : null,
    '',
    t.shareCardCongrats,
  ].filter(Boolean).join('\n')
  const handleShare = async () => {
    if (navigator.share) {
      try { await navigator.share({ text: shareText }) } catch { /* userul a anulat share-ul - nimic de facut */ }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareText)
    }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', overflow: 'hidden', maxWidth: '360px', width: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <button onClick={onClose} aria-label={t.shareCardCloseLabel}
          style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 2, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0E0E0E', cursor: 'pointer' }}>
          <X size={16} strokeWidth={2.5} />
        </button>
        <div style={{ background: '#0E0E0E', padding: '20px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <img src="/forge.png" alt="Forge" style={{ height: '30px', width: '30px', borderRadius: '8px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '16px', letterSpacing: '1px' }}>FORGE</span>
          <span style={{ fontSize: '13px', fontWeight: '600' }}>
            <span style={{ color: '#888' }}> · </span><span style={{ color: '#fff' }}>CrossFit </span><span style={{ color: '#ABE73C' }}>C15</span>
          </span>
        </div>
        <div style={{ padding: '26px 24px', textAlign: 'center' }}>
          {wodName && <div style={{ fontSize: '18px', fontWeight: '800', color: '#0E0E0E', marginBottom: '10px' }}>"{wodName}"</div>}
          {variantLevel && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
              <div style={{ padding: '4px 14px', borderRadius: '20px', background: variantBg || '#f0f0f0', color: variantColor || '#0E0E0E', fontSize: '12px', fontWeight: '700' }}>
                {variantLevel}
              </div>
              {notRxd && <NotRxdBadge t={t} />}
            </div>
          )}
          {movements && movements.length > 0 && (
            <div style={{ fontSize: '12px', color: '#666', textAlign: 'left', background: '#fafafa', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px' }}>
              {movements.map((m, i) => <div key={i} style={{ padding: '2px 0' }}>• {m}</div>)}
            </div>
          )}
          <div style={{ fontSize: '30px', fontWeight: '800', color: '#0E0E0E', margin: '6px 0 4px', lineHeight: 1.2 }}>
            {scoreParts.length > 0 ? scoreParts.join(' · ') : '—'}
          </div>
          <div style={{ fontSize: '12px', color: '#aaa', marginBottom: '18px' }}>
            {dataObj.toLocaleDateString(localeFor(lang), { day: '2-digit', month: '2-digit', year: 'numeric' })} · {dataObj.toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#0E0E0E', marginBottom: '22px' }}>{t.shareCardCongrats}</div>
          <button onClick={handleShare}
            style={{ width: '100%', padding: '13px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Share2 size={16} strokeWidth={2.5} /> {t.shareCardButton}
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [screen, setScreen] = useState('home')
  const [prevScreen, setPrevScreen] = useState('home')
  const [feedUnread, setFeedUnread] = useState(0)
  const screenRef = useRef('home')
  const mainScrollRef = useRef(null)
  const debugTapRef = useRef(0)
  const [wodDeschis, setWodDeschis] = useState(false)
  const [skillDeschis, setSkillDeschis] = useState(false)
  const [skillDeschis2, setSkillDeschis2] = useState(false)
  const [claseHomeDeschis, setClaseHomeDeschis] = useState(false)
  const [variantaAleasa, setVariantaAleasa] = useState(null)
  const [wodZiData, setWodZiData] = useState(null)
  const [dataAcasa, setDataAcasa] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })
  const [prSelectat, setPrSelectat] = useState(null)
  const [prConfirmDelete, setPrConfirmDelete] = useState(null)
  const [catDeschise, setCatDeschise] = useState({})
  const [catSearch, setCatSearch] = useState({})
  const [heroWodsDeschis, setHeroWodsDeschis] = useState(false)
  const [heroWodNouInput, setHeroWodNouInput] = useState('')
  const [prDate, setPrDate] = useState([])
  const [wodLogs, setWodLogs] = useState([])
  const [skillLogs, setSkillLogs] = useState([])
  // Care slot de Skill Work e editat pe ecranul logSkill (1 = SKILL, 2 = SKILL 2).
  const [skillLogSlot, setSkillLogSlot] = useState(1)
  const [skillLogNote, setSkillLogNote] = useState('')
  const [skillLogSets, setSkillLogSets] = useState({})
  const [skillLogResult, setSkillLogResult] = useState('')
  const [skillLogTime, setSkillLogTime] = useState('')
  const [skillLogRoundsCompleted, setSkillLogRoundsCompleted] = useState('')
  const [skillLogPartialReps, setSkillLogPartialReps] = useState([])
  const [skillLogCompleted, setSkillLogCompleted] = useState(false)
  const [skillLogSaving, setSkillLogSaving] = useState(false)
  const [skillPrCandidates, setSkillPrCandidates] = useState(null)
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
  const [isCoach, setIsCoach] = useState(false)
  // Inainte de login nu exista userProfile din care sa citim limba - localStorage
  // (aceeasi convenție ca forge_remember_email) tine limba intre sesiuni pe acest
  // device; dupa login, se sincronizeaza cu profiles.language (sursa de adevar
  // pe cont, vezi efectul de mai jos si changeLanguage()).
  const [lang, setLang] = useState(() => {
    const stored = localStorage.getItem('forge_lang')
    if (stored === 'ro' || stored === 'en') return stored
    return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ro'
  })
  const t = getT(lang)
  const [abonamentReal, setAbonamentReal] = useState(null)
  const [abonamentLoading, setAbonamentLoading] = useState(true)
  const [abonamentInitialized, setAbonamentInitialized] = useState(false)
  const [prValoare, setPrValoare] = useState('')
  const [prReps, setPrReps] = useState('')
  const [prTimp, setPrTimp] = useState('')
  const [prRoundsCompleted, setPrRoundsCompleted] = useState('')
  const [prPartialReps, setPrPartialReps] = useState([])
  const [prDistanta, setPrDistanta] = useState('')
  const [prCardioUnit, setPrCardioUnit] = useState('m')
  const [prNote, setPrNote] = useState('')
  const [prVarianta, setPrVarianta] = useState('RX')
  const [prSaving, setPrSaving] = useState(false)
  const [customHeroWods, setCustomHeroWods] = useState([])
  const [newHeroWodName, setNewHeroWodName] = useState('')
  const [newHeroWodTip, setNewHeroWodTip] = useState('AMRAP')
  const [newHeroWodFormatConfig, setNewHeroWodFormatConfig] = useState({})
  const [newHeroWodMiscari, setNewHeroWodMiscari] = useState([])
  const [newHeroWodMiscareCurenta, setNewHeroWodMiscareCurenta] = useState('')
  const [newHeroWodSaving, setNewHeroWodSaving] = useState(false)
  const [editHeroWodId, setEditHeroWodId] = useState(null)
  const [editPrId, setEditPrId] = useState(null)
  const [wodResult, setWodResult] = useState('')
  const [wodRoundsCompleted, setWodRoundsCompleted] = useState('')
  const [wodPartialReps, setWodPartialReps] = useState([])
  // Greutatea efectiv folosita de membru (text liber, ex. "40kg") - comparata
  // cu greutatea prescrisa a variantei alese pentru a detecta "Not RXd" (vezi
  // isNotRxd in workoutFormats.js). Semanata direct cu prescrisul la alegerea
  // variantei (nu fallback la render) - acelasi motiv ca la bug-ul de reps
  // reparat la SequentialPartialFields: fallback-ul la render impiedica
  // editarea libera a campului.
  const [wodWeightLogged, setWodWeightLogged] = useState('')
  const [wodTime, setWodTime] = useState('')
  const [wodNote, setWodNote] = useState('')
  const [wodSaving, setWodSaving] = useState(false)
  const [workoutSharePopup, setWorkoutSharePopup] = useState(null)
  const [wodTip, setWodTip] = useState('AMRAP')
  const [wodFormatConfig, setWodFormatConfig] = useState({})
  const [wodSets, setWodSets] = useState({})
  const [wodCompleted, setWodCompleted] = useState(false)
  // Doua casute (minute/secunde), ca la Admin - nu text liber, evita
  // ambiguitati ("20 minute" vs "20:00") si se compune direct in acelasi
  // format "mm:ss" folosit peste tot in app.
  const [wodDurataMin, setWodDurataMin] = useState('')
  const [wodDurataSec, setWodDurataSec] = useState('')
  const wodDurata = (wodDurataMin || wodDurataSec) ? `${parseInt(wodDurataMin) || 0}:${String(parseInt(wodDurataSec) || 0).padStart(2, '0')}` : ''
  // La EMOM/Tabata/Intervals durata e deja determinata de config (vezi
  // acelasi tratament in Admin) - o sincronizam automat in loc sa cerem
  // membrului sa o scrie manual a doua oara.
  useEffect(() => {
    if (!AUTO_DURATION_FORMAT_IDS.includes(wodTip)) return
    const totalSec = estimateTotalDurationSec(wodTip, wodFormatConfig)
    if (totalSec != null) { setWodDurataMin(String(Math.floor(totalSec / 60))); setWodDurataSec(String(totalSec % 60)) }
  }, [wodTip, wodFormatConfig])
  const [wodMiscari, setWodMiscari] = useState([])
  const [wodMiscareCurenta, setWodMiscareCurenta] = useState('')
  // Ecranul de logare era un singur scroll lung (format+config+durata+miscari
  // apoi scor+note+salveaza) - impartit in 2 pasi ca sa nu mai fie nevoie de
  // scroll: intai "compune" antrenamentul, apoi "LOG SCORE" separat. Doar
  // pentru editLogId (editare log existent) ramane un singur ecran, fara pasi
  // - acolo formatul e deja fixat, nu mai e nimic de "compus".
  const [logWodStep, setLogWodStep] = useState('compose')
  const [editLogId, setEditLogId] = useState(null)
  const [editLogNotesPrefix, setEditLogNotesPrefix] = useState('')
  const [editLogHeader, setEditLogHeader] = useState('')
  const [editLogFormatId, setEditLogFormatId] = useState(null)
  const [editLogFormatConfig, setEditLogFormatConfig] = useState(null)
  const [editLogMiscari, setEditLogMiscari] = useState([])
  // Greutatea prescrisa a variantei logului editat (din wods.<varianta>_weight,
  // via join-ul wods(...) din fetchWodLogs) - folosita ca sa aratam corect
  // "Not RXd" si sa recalculam la editare (vezi isNotRxd in workoutFormats.js).
  const [editLogPrescribedWeight, setEditLogPrescribedWeight] = useState('')
  const [editLogMiscareCurenta, setEditLogMiscareCurenta] = useState('')
  const [wodMiscariCustom, setWodMiscariCustom] = useState(null)
  const [logTab, setLogTab] = useState('jurnal')
  const [freeLogName, setFreeLogName] = useState('')
  const [freeLogText, setFreeLogText] = useState('')
  const [freeLogSaving, setFreeLogSaving] = useState(false)
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
    // Litera unica de zi n-are echivalent Intl (nu exista un "format cu o litera"),
    // scrisa manual pt engleza - coliziuni Duminica/Sambata si Marti/Joi pe aceeasi
    // litera sunt acceptate, comportament comun in calendarele englezesti.
    const ziuaLitere = lang === 'en' ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['D', 'L', 'Ma', 'Mi', 'J', 'V', 'S']
    const monthFmt = new Intl.DateTimeFormat(localeFor(lang), { month: 'short' })
    return Array.from({ length: totalDays }, (_, i) => {
      const d = new Date(yearStart)
      d.setDate(d.getDate() + i)
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return {
        ds,
        dayNum: d.getDate(),
        ziuaLitera: ziuaLitere[d.getDay()],
        luna: monthFmt.format(d),
        eAzi: ds === actualToday,
        areRez: rezervateDates.has(ds),
        areWod: wodLogDates.has(ds),
      }
    })
  }, [actualToday, claseDB, rezervariMele, wodLogs, lang])

  // Jurnalul imbina wod_logs si skill_logs dupa wod_id, ca un Skill Work
  // logat fara WOD in acea zi (sau invers) sa apara oricum, fiecare in
  // cardul lui, sub aceeasi data. skillLogsArr e array (nu un singur log) -
  // cu SKILL 2 pot exista 2 skill_logs pentru acelasi wod_id (slot 1 si 2),
  // care altfel s-ar suprascrie unul pe altul in map.
  // Fiecare wod_logs primeste propriul card, cheie pe id-ul LUI, nu pe
  // wod_id - un membru poate avea mai multe loguri cu ACELASI wod_id (WOD-ul
  // oficial al zilei + o a doua logare libera din "Logare Noua", care
  // primeste tot wod_id-ul zilei cat timp exista un WOD oficial azi). Cheia
  // veche (l.wod_id || ...) colapsa gresit toate logurile cu acelasi wod_id
  // intr-un singur card, iar cel mai vechi castiga (ultimul din bucla, dupa
  // sortarea descrescatoare) - al 2-lea antrenament aparea "nesalvat" desi
  // era in baza de date, doar ascuns de Jurnal (bug confirmat cu date reale,
  // 10 cazuri gasite live). Skill Work se asociaza cu logul WOD-ului
  // OFICIAL al acelei zile (variant_level e unul dintre nivelele reale, nu
  // un tip liber ales la "Logare Noua") - nu cu orice log care intampla sa
  // aiba acelasi wod_id.
  const NIVELE_OFICIALE = ['RX', 'Intermediate', 'Beginner', 'OnRamp']
  const jurnalEntries = useMemo(() => {
    const map = new Map()
    wodLogs.forEach(l => {
      const key = `wodlog-${l.id}`
      map.set(key, { key, date: (l.logged_at || '').slice(0, 10), wodLog: l })
    })
    skillLogs.forEach(l => {
      const wodOficial = wodLogs.find(w => w.wod_id != null && w.wod_id === l.wod_id && NIVELE_OFICIALE.includes(w.variant_level))
      const key = wodOficial ? `wodlog-${wodOficial.id}` : (l.wod_id ? `skilllog-wod-${l.wod_id}` : `skilllog-${l.id}`)
      const existing = map.get(key) || { key, date: (l.logged_at || '').slice(0, 10) }
      map.set(key, { ...existing, skillLogsArr: [...(existing.skillLogsArr || []), l] })
    })
    return Array.from(map.values()).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [wodLogs, skillLogs])

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
      fetchSkillLogs()
      fetchRezervari()
      fetchWaitlistMea()
      fetchClaseDB()
      fetchSettings()
      fetchWodZi()
      checkAdmin()
      checkCoach()
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

  // profiles.language e sursa de adevar odata logat (persista intre device-uri) -
  // sincronizeaza limba din profil peste fallback-ul initial din localStorage,
  // o singura data cand profilul se incarca (nu suprascrie o schimbare facuta
  // chiar acum din changeLanguage, de-aia verificarea de diferenta).
  useEffect(() => {
    if (userProfile?.language && userProfile.language !== lang) {
      setLang(userProfile.language)
      localStorage.setItem('forge_lang', userProfile.language)
    }
  }, [userProfile?.language])

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
    // div-ul flex:1/overflow-y:auto de mai jos (mainScrollRef) e containerul
    // care scroleaza de fapt (nu document.body) - fara reset aici, la
    // schimbarea ecranului ramane cu offset-ul de scroll de pe ecranul
    // anterior, ceea ce face ca NavBar-ul (sticky) sa para ca "sare"/se
    // deplaseaza fata de continutul nou, mai ales intre ecrane cu inaltimi
    // foarte diferite.
    if (mainScrollRef.current) mainScrollRef.current.scrollTop = 0
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
      supabase.from('feed_posts').select('created_at').order('created_at', { ascending: false }).limit(1)
        .then(({ data }) => {
          if (data && data[0]) localStorage.setItem('feed_last_seen_' + user.id, data[0].created_at)
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
        .select('id, member_id, created_at').order('created_at', { ascending: false }).limit(200)
      if (error) { console.error('[Feed] query error:', error); return }
      // comparam dupa timestamp-ul ultimei postari vazute, nu dupa un numar
      // de postari - un numar se poate strica daca se sterg postari intre
      // timp (badge-ul de "necitit" reapare gresit), un timestamp nu.
      const lastSeen = localStorage.getItem('feed_last_seen_' + user.id)
      const unread = (posts || []).filter(p => p.member_id !== user.id && (!lastSeen || p.created_at > lastSeen)).length
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'skill_logs' }, () => {
        fetchSkillLogs()
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
    if (!firstName || !lastName || !profileBirthDate) { showToast(t.toastFillRequiredFields); return }
    const fullName = [firstName, lastName].filter(Boolean).join(' ') || null
    setProfileSaving(true)
    const { error } = await supabase.from('profiles').update({
      first_name: firstName, last_name: lastName, full_name: fullName,
      gender: profileGender || null, birth_date: profileBirthDate || null,
    }).eq('id', user.id)
    setProfileSaving(false)
    if (error) { showToast(t.toastProfileSaveError); console.error(error); return }
    setUserProfile(prev => ({ ...prev, first_name: firstName, last_name: lastName, full_name: fullName, gender: profileGender, birth_date: profileBirthDate }))
    showToast(t.toastProfileUpdated)
    setScreen(prevScreen || 'home')
  }

  const changeWeightUnit = async (unit) => {
    if (unit === userProfile?.weight_unit) return
    setUserProfile(prev => ({ ...prev, weight_unit: unit }))
    const { error } = await supabase.from('profiles').update({ weight_unit: unit }).eq('id', user.id)
    if (error) { showToast(t.toastProfileSaveError); console.error(error); return }
    showToast(t.toastWeightUnitChanged(unit))
  }

  const changeLanguage = async (newLang) => {
    if (newLang === lang) return
    setLang(newLang)
    localStorage.setItem('forge_lang', newLang)
    setUserProfile(prev => prev ? { ...prev, language: newLang } : prev)
    const { error } = await supabase.from('profiles').update({ language: newLang }).eq('id', user.id)
    if (error) { showToast(t.toastLanguageSaveError); console.error(error) }
  }

  const changeMyPassword = async () => {
    if (profileNewPassword.length < 6) { showToast(t.toastPasswordTooShort); return }
    if (profileNewPassword !== profileNewPasswordConfirm) { showToast(t.toastPasswordMismatch); return }
    setPasswordSaving(true)
    const { error } = await supabase.auth.updateUser({ password: profileNewPassword })
    setPasswordSaving(false)
    if (error) { showToast(t.toastPasswordChangeError); console.error(error); return }
    setProfileNewPassword(''); setProfileNewPasswordConfirm('')
    showToast(t.toastPasswordChanged)
  }

  const uploadAvatar = async (file) => {
    if (!file) return
    // Bucket-ul 'avatars' are file_size_limit=5242880 (5MB, vezi migratia
    // 20260628_profiles_avatar_storage.sql) - fara verificare aici, un fisier
    // prea mare esua cu StorageApiError generic ("The object exceeded the
    // maximum allowed size", gasit in Sentry), fara niciun mesaj util pt
    // membru despre CE trebuie sa faca diferit.
    if (file.size > 5 * 1024 * 1024) { showToast(t.toastAvatarTooLarge); return }
    setAvatarUploading(true)
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg'
    const path = `${user.id}/avatar.${ext}`
    const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { showToast(t.toastAvatarUploadError); console.error(upErr); setAvatarUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
    const urlFinal = `${publicUrl}?t=${Date.now()}`
    await supabase.from('profiles').upsert({ id: user.id, email: user.email, avatar_url: urlFinal }, { onConflict: 'id' })
    setUserProfile(prev => ({ ...prev, avatar_url: urlFinal }))
    showToast(t.toastAvatarUpdated)
    setAvatarUploading(false)
  }

  const checkAdmin = async () => {
    const { data } = await supabase.from('admins').select('id').eq('id', user.id)
    setIsAdmin(data && data.length > 0)
  }

  const checkCoach = async () => {
    const { data } = await supabase.from('coaches').select('id').eq('id', user.id)
    setIsCoach(data && data.length > 0)
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

  const resetNewHeroWodForm = () => {
    setNewHeroWodName(''); setNewHeroWodTip('AMRAP'); setNewHeroWodFormatConfig({})
    setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta('')
  }

  const saveNewHeroWod = async () => {
    const name = newHeroWodName.trim()
    if (!name) { showToast(t.toastHeroWodNameRequired); return }
    const nameTaken = editHeroWodId
      ? customHeroWods.some(w => w.id !== editHeroWodId && w.name.toLowerCase() === name.toLowerCase())
      : !!heroWodsInfoAll[name]
    if (nameTaken) { showToast(t.toastHeroWodNameTaken); return }
    setNewHeroWodSaving(true)
    const payload = {
      name, format: composeHeroFormat(), movements: newHeroWodMiscari.join('\n') || null,
      format_type: newHeroWodTip, format_config: Object.keys(newHeroWodFormatConfig).length > 0 ? newHeroWodFormatConfig : null,
    }
    if (editHeroWodId) {
      const { data, error } = await supabase.from('custom_hero_wods').update(payload).eq('id', editHeroWodId).select().single()
      if (error) { showToast(t.toastHeroWodUpdateError); console.error(error) }
      else {
        setCustomHeroWods(prev => prev.map(w => w.id === editHeroWodId ? data : w))
        showToast(t.toastHeroWodUpdated)
        setEditHeroWodId(null); resetNewHeroWodForm()
        setScreen('pr')
      }
    } else {
      const { data, error } = await supabase.from('custom_hero_wods').insert({ member_id: user.id, ...payload }).select().single()
      if (error) { showToast(t.toastHeroWodInsertError); console.error(error) }
      else {
        setCustomHeroWods(prev => [...prev, data])
        showToast(t.toastHeroWodSaved)
        setMiscarePR(name); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrRoundsCompleted(''); setPrPartialReps([]); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrVarianta('RX')
        resetNewHeroWodForm()
        setPrevScreen('pr'); setScreen('logPR')
      }
    }
    setNewHeroWodSaving(false)
  }

  const fetchWodLogs = async () => {
    const { data } = await supabase.from('wod_logs').select(`*, wods(name, type, duration, format_config, ${ALL_WEIGHT_COLUMNS.join(', ')})`).eq('member_id', user.id).order('logged_at', { ascending: false })
    if (data) setWodLogs(data)
  }

  const fetchSkillLogs = async () => {
    const { data } = await supabase.from('skill_logs').select('*, wods(date, skill_name, skill_type, skill, skill_format_config, skill2_name, skill2_type, skill2, skill2_format_config)').eq('member_id', user.id)
    if (data) setSkillLogs(data)
  }

  const confirmSkillPR = async (candidate) => {
    const { error } = await supabase.from('personal_records').insert({
      member_id: user.id, movement: candidate.movement, value: candidate.weight,
      unit: candidate.unit, reps: candidate.reps, notes: t.prFromSkillWorkNote,
    })
    if (error) { showToast(t.toastGenericError); console.error(error); return }
    showToast(t.toastSkillPrSaved)
    await fetchPRuri()
    setSkillPrCandidates(prev => (prev || []).filter(c => !(c.reps === candidate.reps && c.movement === candidate.movement)))
  }

  const saveSkillLog = async () => {
    if (!wodZiData) return
    setSkillLogSaving(true)
    const esteSlot2 = skillLogSlot === 2
    const skillType = (esteSlot2 ? wodZiData.skill2_type : wodZiData.skill_type) || 'Weightlifting'
    const skillMiscari = (esteSlot2 ? wodZiData.skill2 : wodZiData.skill) || []
    const skillNameCurent = esteSlot2 ? wodZiData.skill2_name : wodZiData.skill_name
    const format = getFormat(skillType)
    let setsCurate = null, resultCurat = null, logMeta = null
    if (format.family === 'sets' || format.family === 'mixed') {
      // curatam seturile goale (randuri fara niciun set adaugat, sau intrari nescrise)
      const cleaned = {}
      Object.entries(skillLogSets).forEach(([cheie, seturi]) => {
        const valide = (seturi || []).filter(v => (v.weight || '').toString().trim() !== '' || (v.reps || '').toString().trim() !== '')
        if (valide.length > 0) cleaned[cheie] = valide
      })
      if (Object.keys(cleaned).length > 0) setsCurate = cleaned
    } else if (format.family === 'nft') {
      logMeta = { completed: skillLogCompleted }
    } else {
      // Acelasi motiv ca la composeWodLogFields: la RFT/Partner WOD, membrul
      // poate alege sa completeze runde+reps partiale in loc de rezultat/
      // timp - fara verificarea skillLogRoundsCompleted, acele date se
      // pierdeau silentios (nu intrau niciodata pe ramura AMRAP). La For
      // Time/Ladder (sequentialPartial), semnalul e absenta Timpului.
      const skillFormatConfigCurent = esteSlot2 ? wodZiData.skill2_format_config : wodZiData.skill_format_config
      const isSequentialSkill = isSequentialFormat(skillType, skillFormatConfigCurent)
      const useRepsSkill = isSequentialSkill
        ? !skillLogTime.trim()
        : (format.scoreMode === 'amrap' || (format.scoreMode === 'fortime_or_amrap' && skillLogRoundsCompleted.trim() !== ''))
      if (useRepsSkill && isSequentialSkill) {
        resultCurat = composePartialText(repsEfectiveSecvential(skillLogPartialReps, skillMiscari), skillMiscari)
      } else if (useRepsSkill) {
        resultCurat = composeAmrapResult(skillLogRoundsCompleted, skillLogPartialReps, skillMiscari)
      } else {
        resultCurat = [skillLogResult.trim(), skillLogTime.trim()].filter(Boolean).join(' · ')
      }
      resultCurat = resultCurat.trim() || null
    }
    const { error } = await supabase.from('skill_logs').upsert({
      member_id: user.id, wod_id: wodZiData.id, slot: skillLogSlot,
      notes: skillLogNote.trim() || null,
      sets: setsCurate, result: resultCurat, log_meta: logMeta,
      logged_at: new Date().toISOString(),
    }, { onConflict: 'member_id,wod_id,slot' })
    if (error) { showToast(t.toastGenericError); console.error(error); setSkillLogSaving(false); return }
    showToast(t.toastSkillLogSaved)
    await fetchSkillLogs()
    if (format.prEligible && skillNameCurent && setsCurate) {
      await fetchPRuri()
      const candidates = computeSetsPrCandidates(skillNameCurent, setsCurate, userProfile?.weight_unit || 'kg', prDate, skillType === 'Superset')
      if (candidates.length > 0) { setSkillPrCandidates(candidates); setSkillLogSaving(false); return }
    }
    setSkillPrCandidates(null)
    setScreen(prevScreen || 'home')
    setSkillLogSaving(false)
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
    const { data: wodZi } = await supabase.from('wods').select(`id, type, duration, name, format_config, ${ALL_WEIGHT_COLUMNS.join(', ')}`).eq('date', targetDate).maybeSingle()
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
      const { data: profiles } = await supabase.from('profiles').select('id, full_name, email, gender, avatar_url, weight_unit').in('id', ids)
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
    if (newPassword !== newPasswordConfirm) { setAuthError(t.resetPasswordMismatch); return }
    if (newPassword.length < 6) { setAuthError(t.resetPasswordTooShort); return }
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setAuthError(error.message)
    else { setResetMode(false); setNewPassword(''); setNewPasswordConfirm('') }
    setAuthSubmitting(false)
  }

  const handleForgotPassword = async () => {
    if (!authEmail) { setAuthError(t.authEnterEmailFirst); return }
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, { redirectTo: window.location.origin })
    if (error) setAuthError(error.message)
    else setAuthError(t.authResetEmailSent)
    setAuthSubmitting(false)
  }

  const handleRegister = async () => {
    setAuthSubmitting(true); setAuthError('')
    const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword })
    if (error) setAuthError(error.message)
    else setAuthError(t.authCheckEmailConfirm)
    setAuthSubmitting(false)
  }

  const handleLogout = async () => { await supabase.auth.signOut() }
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const goTimer = () => { setPrevScreen(screen); setScreen('timer') }

  const stergeWodLog = async (id) => {
    const { error } = await supabase.from('wod_logs').delete().eq('id', id)
    if (error) { showToast(t.toastDeleteWorkoutError); console.error(error) }
    else { showToast(t.toastWorkoutDeleted); await fetchWodLogs() }
  }

  const stergeSkillLog = async (id) => {
    const { error } = await supabase.from('skill_logs').delete().eq('id', id)
    if (error) { showToast(t.toastDeleteWorkoutError); console.error(error) }
    else { showToast(t.toastWorkoutDeleted); await fetchSkillLogs() }
  }

  // Compune result/time_result/sets/log_meta pt wod_logs pe baza familiei
  // formatului activ (scored/sets/mixed/nft) - generalizarea vechiului
  // `isAmrapLog ? composeAmrapResult() : wodResult`.
  // Pentru secvente (For Time/Ladder - sequentialPartial in catalog):
  // repetarile efective per miscare, cu fallback la numarul prescris
  // (parsat din text, ex. "15 power snatches" -> 15) cand nu au fost
  // atinse - consecvent cu ce arata SequentialPartialFields (o miscare
  // netouched = presupusa terminata integral).
  const repsEfectiveSecvential = (partialReps, movements) => movements.map((m, i) => {
    const curent = (partialReps || [])[i]
    if (curent != null && curent !== '') return curent
    const prescrisMatch = m.match(/^(\d+)\s+/)
    return prescrisMatch ? prescrisMatch[1] : ''
  })

  const composeWodLogFields = () => {
    const format = getFormat(activeLogFormatId)
    const setsCurate = () => {
      const cleaned = {}
      Object.entries(wodSets).forEach(([cheie, rows]) => {
        const valide = (rows || []).filter(v => (v.weight || '').toString().trim() !== '' || (v.reps || '').toString().trim() !== '')
        if (valide.length > 0) cleaned[cheie] = valide
      })
      return Object.keys(cleaned).length > 0 ? cleaned : null
    }
    if (format.family === 'sets') {
      return { result: null, time_result: null, sets: setsCurate(), log_meta: null }
    }
    if (format.family === 'nft') {
      return { result: null, time_result: null, sets: null, log_meta: { completed: wodCompleted } }
    }
    // La RFT/Partner WOD (scoreMode 'fortime_or_amrap'), FormatLogger arata
    // AMBELE seturi de campuri (timp SI runde+reps partiale) - membrul
    // completeaza doar unul, dupa cum a terminat sau nu in time cap. Fara
    // verificarea wodRoundsCompleted aici, ramura AMRAP nu se activa NICIODATA
    // pentru aceste formate (scoreMode nu e strict 'amrap'), iar runde+reps
    // partiale completate de membru se pierdeau silentios la salvare.
    //
    // La For Time/Ladder (sequentialPartial - secvente, nu runde repetate),
    // nu mai exista camp de "runde complete" separat - semnalul ca membrul
    // n-a terminat e absenta Timpului; in acel caz compunem direct din
    // repetarile per miscare (cu fallback la prescris pt cele netouched).
    const isSequential = isSequentialFormat(activeLogFormatId, activeLogFormatConfig)
    const useReps = isSequential
      ? !wodTime.trim()
      : (format.scoreMode === 'amrap'
        || (format.family === 'mixed' && activeLogFormatConfig?.mainFormat === 'AMRAP')
        || (format.scoreMode === 'fortime_or_amrap' && wodRoundsCompleted.trim() !== ''))
    let rezultatFinal
    if (useReps && isSequential) {
      rezultatFinal = composePartialText(repsEfectiveSecvential(wodPartialReps, miscariPentruLog), miscariPentruLog)
    } else if (useReps) {
      rezultatFinal = composeAmrapResult(wodRoundsCompleted, wodPartialReps, miscariPentruLog)
    } else {
      rezultatFinal = wodResult.trim()
    }
    return {
      result: rezultatFinal || null, time_result: useReps ? null : (wodTime.trim() || null),
      sets: format.family === 'mixed' ? setsCurate() : null, log_meta: null,
      weight_logged: wodWeightLogged.trim() || null,
    }
  }

  const saveWodLog = async () => {
    if (editLogId) {
      setWodSaving(true)
      const liniiPrefix = [...(editLogHeader ? [editLogHeader] : []), ...editLogMiscari]
      const newPrefix = liniiPrefix.join('\n')
      const noteFull = [newPrefix || null, wodNote.trim() || null].filter(Boolean).join('\n---\n')
      const { error } = await supabase.from('wod_logs').update({
        ...composeWodLogFields(),
        notes: noteFull || null,
      }).eq('id', editLogId)
      if (error) { showToast(t.toastLogWodUpdateError); console.error(error) }
      else {
        showToast(t.toastWodUpdated)
        await fetchWodLogs(); fetchClasament()
        setScreen('log'); setLogTab('jurnal')
        setEditLogId(null); setEditLogNotesPrefix(''); setEditLogHeader(''); setEditLogFormatId(null); setEditLogFormatConfig(null); setEditLogMiscari([])
        setWodResult(''); setWodRoundsCompleted(''); setWodPartialReps([]); setWodTime(''); setWodSets({}); setWodCompleted(false); setWodNote(''); setWodWeightLogged(''); setEditLogPrescribedWeight('')
      }
      setWodSaving(false)
      return
    }
    const areContiut = wodResult.trim() || wodRoundsCompleted.trim() || wodTime.trim() || wodMiscari.length > 0
      || Object.keys(wodSets).length > 0 || wodCompleted
    if (!areContiut) { showToast(t.toastFillResultOrTime); return }
    setWodSaving(true)
    const cheieVarianta = variantaAleasa !== null ? VARIANTE_CONFIG[variantaAleasa].key : null
    const miscariWodZi = (cheieVarianta && wodZiData?.[cheieVarianta]) ? (wodMiscariCustom ?? wodZiData[cheieVarianta]) : []
    const miscariFinale = miscariWodZi.length > 0 ? miscariWodZi : wodMiscari
    const durStr = wodZiData ? formatWodDurata(wodZiData.duration) : ''
    // La logare libera (fara wod_id), config-ul prescris de membru (ex. Numar
    // runde la RFT) nu are unde sa fie salvat structurat (wod_logs nu are
    // format_config, doar wods) - fara linia asta, valoarea era pierduta
    // complet la salvare (se vedea in formular, dar disparea dupa "Salveaza").
    const freeLogConfigDesc = variantaAleasa === null ? describeFormatConfig(wodTip, wodFormatConfig, t) : ''
    // wodHeaderLine si wod_id decid dupa variantaAleasa (a ales o varianta
    // oficiala RX/Intermediate/Beginner/OnRamp?), NU dupa simpla existenta a
    // unui WOD oficial azi (wodZiData) - o "Logare Noua" libera facuta in
    // aceeasi zi cu un WOD oficial programat nu are nicio legatura cu acel
    // WOD, chiar daca ambele exista in acceasi zi. Bug raportat: o logare
    // libera "Complex" aparea in Jurnal cu titlul WOD-ului oficial al zilei
    // ("GET UP") si subtitlul lui ("Build to Heavy/1RM 20:00"), pt ca
    // wod_id era setat oricum la wodZiData.id, doar pentru ca exista un WOD
    // oficial azi - indiferent ca userul alesese sa loga separat.
    const wodHeaderLine = variantaAleasa !== null
      ? `${wodZiData.type}${durStr ? ' · ' + durStr : ''}${wodZiData.name ? ' — "' + wodZiData.name + '"' : ''}`
      : `${wodTip}${wodDurata ? ' · ' + wodDurata : ''}${freeLogConfigDesc ? ' · ' + freeLogConfigDesc : ''}`
    const miscariText = [...(wodHeaderLine ? [wodHeaderLine] : []), ...miscariFinale].join('\n')
    const noteFull = [miscariText || null, wodNote || null].filter(Boolean).join('\n---\n')
    const varianta = variantaAleasa !== null ? VARIANTE_CONFIG[variantaAleasa] : null
    const tipSalvat = varianta ? varianta.nivel : `${wodTip}${wodDurata ? ' · ' + wodDurata : ''}`
    const logFields = composeWodLogFields()
    const { error } = await supabase.from('wod_logs').insert({
      member_id: user.id, wod_id: variantaAleasa !== null ? (wodZiData?.id || null) : null,
      variant_level: tipSalvat,
      format_type: variantaAleasa === null ? wodTip : null,
      notes: noteFull || null,
      ...logFields,
    })
    if (error) { showToast(t.toastLogWodInsertError); console.error(error) }
    else {
      showToast(t.toastWodSaved); await fetchWodLogs(); fetchClasament()
      // Pop-up-ul de felicitare (cu numele si scorul WOD-ului oficial al
      // zilei) are sens doar cand membrul chiar a logat acea varianta
      // oficiala (RX/Intermediate/Beginner/OnRamp) - nu si la o logare
      // libera/separata (Logare Noua), chiar daca exista un WOD oficial
      // programat in aceeasi zi (bug raportat: pop-up-ul aparea cu numele
      // WOD-ului zilei - "GET UP" - la o logare libera de tip "Complex"
      // care n-avea nicio legatura cu acel WOD).
      if (variantaAleasa !== null) {
        const prescribedWeight = varianta ? (wodZiData?.[weightKeyForVariant(varianta.nivel, userProfile?.gender)] || null) : null
        setWorkoutSharePopup({
          wodName: wodZiData?.name || null,
          movements: miscariFinale,
          variantLevel: varianta?.nivel || null,
          variantColor: varianta?.culoare || null,
          variantBg: varianta?.bg || null,
          result: logFields.result, timeResult: logFields.time_result,
          loggedAt: new Date().toISOString(),
          notRxd: isNotRxd(logFields, prescribedWeight, activeLogFormatId, activeLogFormatConfig),
        })
      }
      if (prevScreen === 'log') { setScreen('log'); setLogTab('jurnal') }
      else { setScreen('home'); setWodDeschis(false) }
      setVariantaAleasa(null); setWodMiscariCustom(null)
      setWodResult(''); setWodRoundsCompleted(''); setWodPartialReps([]); setWodTime(''); setWodSets({}); setWodCompleted(false); setWodNote(''); setWodWeightLogged('')
      setWodTip('AMRAP'); setWodFormatConfig({}); setWodDurataMin(''); setWodDurataSec(''); setWodMiscari([]); setWodMiscareCurenta('')
    }
    setWodSaving(false)
  }

  // Logare minimala, fara format/miscari/scor structurat - un singur camp de
  // text liber, salvat direct in `notes` (fara separatorul '\n---\n' folosit
  // la logarea structurata), ca sa apara ca "miscari" (linie cu linie, cu
  // line-break-urile pastrate) in Jurnal, nu ca o nota separata de un
  // rezultat gol. Nu se leaga de wod_id (nu concureaza pe Clasament - n-are
  // scor structurat de comparat).
  const saveFreeTextLog = async () => {
    if (!freeLogText.trim()) { showToast(t.toastFillFreeText); return }
    setFreeLogSaving(true)
    const { error } = await supabase.from('wod_logs').insert({
      member_id: user.id, wod_id: null,
      variant_level: freeLogName.trim() || t.logFreeTextEntryLabel,
      notes: freeLogText.trim(),
    })
    if (error) { showToast(t.toastLogWodInsertError); console.error(error) }
    else {
      showToast(t.toastWodSaved)
      await fetchWodLogs()
      setFreeLogName(''); setFreeLogText('')
      setLogTab('jurnal')
    }
    setFreeLogSaving(false)
  }

  const savePR = async () => {
    if (!miscarePR) return
    const areValoare = prValoare.trim() || prReps.trim() || prTimp.trim() || prRoundsCompleted.trim() || prDistanta.trim()
    if (!areValoare) { showToast(t.toastFillPrValue); return }
    setPrSaving(true)
    const isBenchmark = miscarePR in heroWodsInfoAll
    const isCardio = CARDIO_MISCARI.includes(miscarePR)
    const isGym = ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump','Pistol Squat','Rope Climb','GHD Sit-up','GHD Back Extension'].includes(miscarePR)
    const isHold = ['Handstand Hold','L-sit Hold'].includes(miscarePR)
    let insertData = { movement: miscarePR, notes: prNote || null }
    if (!editPrId) insertData.member_id = user.id
    if (isBenchmark && isAmrapHeroPr) {
      const partialStr = composePartialText(prPartialReps, miscariHeroPr)
      insertData.value = prRoundsCompleted ? parseInt(prRoundsCompleted) : null
      insertData.unit = 'runde'
      insertData.notes = [partialStr ? '+ ' + partialStr : null, prVarianta || null, prNote || null].filter(Boolean).join(' | ')
    }
    else if (isBenchmark) { insertData.value = prTimp ? timeToSec(prTimp) : null; insertData.unit = 'timp'; insertData.notes = (prVarianta ? prVarianta + ' | ' : '') + (prNote || '') }
    else if (isCardio) { insertData.value = prDistanta ? parseFloat(prDistanta) : null; insertData.unit = CARDIO_CU_CALORII.includes(miscarePR) ? prCardioUnit : 'm'; insertData.time_result = prTimp.trim() || null }
    else if (isGym) { insertData.reps = prReps ? parseInt(prReps) : null; insertData.unit = 'reps' }
    else if (isHold) { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.unit = 'sec' }
    else { insertData.value = prValoare ? parseFloat(prValoare) : null; insertData.reps = prReps ? parseInt(prReps) : null; insertData.unit = userProfile?.weight_unit || 'kg' }
    const { error } = editPrId
      ? await supabase.from('personal_records').update(insertData).eq('id', editPrId)
      : await supabase.from('personal_records').insert(insertData)
    if (error) { showToast(t.toastPrSaveError); console.error(error) }
    else {
      showToast(editPrId ? t.toastPrUpdated : t.toastPrSaved)
      await fetchPRuri(); setScreen('pr')
      setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrRoundsCompleted(''); setPrPartialReps([]); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrVarianta('RX')
      setEditPrId(null); setLogPentruPR(null)
    }
    setPrSaving(false)
  }

  const startEditPR = (record, movement) => {
    const isBenchmark = movement in heroWodsInfoAll
    const isCardio = CARDIO_MISCARI.includes(movement)
    const isGym = ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump','Pistol Squat','Rope Climb','GHD Sit-up','GHD Back Extension'].includes(movement)
    const isHold = ['Handstand Hold','L-sit Hold'].includes(movement)
    setMiscarePR(movement)
    setPrValoare(''); setPrReps(''); setPrTimp(''); setPrRoundsCompleted(''); setPrPartialReps([]); setPrDistanta(''); setPrCardioUnit('m'); setPrVarianta('RX')
    if (isBenchmark) {
      const heroLinii = (heroWodsInfoAll[movement] || '').split('\n')
      const isAmrapEdit = heroLinii.length > 0 && heroLinii[0].startsWith('AMRAP')
      const heroMisc = heroLinii.slice(1)
      const varianteValide = ['RX', 'Intermediate', 'Beginner', 'OnRamp']
      if (isAmrapEdit) {
        setPrRoundsCompleted(record.value != null ? String(record.value) : '')
        const parts = (record.notes || '').split(' | ')
        let idx = 0
        if (parts[0]?.startsWith('+ ')) { setPrPartialReps(parsePartialText(parts[0].slice(2), heroMisc)); idx = 1 }
        if (varianteValide.includes(parts[idx])) { setPrVarianta(parts[idx]); setPrNote(parts.slice(idx + 1).join(' | ')) }
        else { setPrNote(parts.slice(idx).join(' | ')) }
      } else {
        setPrTimp(record.value != null ? secToTime(parseFloat(record.value)) : '')
        const [poss, ...rest] = (record.notes || '').split(' | ')
        if (varianteValide.includes(poss)) { setPrVarianta(poss); setPrNote(rest.join(' | ')) }
        else { setPrNote(record.notes || '') }
      }
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

  const deleteMiscarePR = async (movement) => {
    const { error } = await supabase.from('personal_records').delete().eq('member_id', user.id).eq('movement', movement)
    if (error) { showToast(t.toastDeleteExerciseError); console.error(error); return }
    setPrDate(prev => prev.filter(r => r.movement !== movement))
    if (prSelectat === movement) setPrSelectat(null)
    showToast(t.toastExerciseDeleted)
  }

  const toggleWaitlist = async (clasaId) => {
    const peWaitlist = waitlistMea.includes(clasaId)
    if (peWaitlist) {
      await supabase.from('class_waitlist').delete().eq('class_id', clasaId).eq('member_id', user.id)
      setWaitlistMea(prev => prev.filter(id => id !== clasaId))
      showToast(t.toastWaitlistLeft)
    } else {
      const { error } = await supabase.from('class_waitlist').insert({ class_id: clasaId, member_id: user.id, member_email: user.email.toLowerCase() })
      if (error) {
        if (error.code === '23505') { setWaitlistMea(prev => prev.includes(clasaId) ? prev : [...prev, clasaId]); showToast(t.toastWaitlistAlready); return }
        showToast(t.toastWaitlistError(error.message || error.code || t.toastErrorFallbackGeneric)); console.error(error); return
      }
      setWaitlistMea(prev => [...prev, clasaId])
      showToast(t.toastWaitlistJoined)
    }
  }

  const sedinteLimitate = abonamentReal?.sessions_total != null
  const sedinteRamase = sedinteLimitate ? Math.max(0, (abonamentReal.sessions_total) - (abonamentReal.sessions_used || 0)) : null

  const toggleRezervare = async (clasaId) => {
    const esteRezervat = rezervariMele.includes(clasaId)
    if (!esteRezervat && !isAdmin) {
      const clasaPtRez = claseDB.find(c => c.id === clasaId)
      if (!clasaPtRez || new Date(`${clasaPtRez.date}T${clasaPtRez.start_time}`) <= new Date()) {
        showToast(t.toastClassAlreadyStarted)
        return
      }
      if (!abonamentReal) {
        showToast(t.toastNoActiveSubscription)
        return
      }
      if (new Date(abonamentReal.start_date + 'T00:00:00') > new Date()) {
        showToast(t.toastSubscriptionStartsOn(new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString(localeFor(lang))))
        return
      }
      if (new Date(abonamentReal.end_date + 'T23:59:59') < new Date()) {
        showToast(t.toastSubscriptionExpired)
        return
      }
      if (sedinteLimitate && sedinteRamase <= 0) {
        showToast(t.toastSessionsExhausted)
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
        showToast(t.toastCannotCancelClass)
        return
      }
      const clasaEnd = new Date(`${clasa.date}T${clasa.end_time}`)
      if (clasaEnd <= new Date()) {
        showToast(t.toastClassEndedCannotCancel)
        return
      }
      const clasaStart = new Date(`${clasa.date}T${clasa.start_time}`)
      const hoursUntil = (clasaStart - new Date()) / 3600000
      if (hoursUntil < cancelWindowHours) {
        const h = cancelWindowHours % 1 === 0 ? `${cancelWindowHours}h` : `${cancelWindowHours * 60} ${t.unitMinutesShort}`
        showToast(t.toastCannotCancelWithin(h))
        return
      }
    }
    if (esteRezervat) {
      const { error: delErr } = await supabase.from('bookings').delete().eq('member_id', user.id).eq('class_id', clasaId)
      if (delErr) { showToast(t.toastCancelBookingError); console.error(delErr); return }
      setRezervariMele(prev => prev.filter(id => id !== clasaId))
      if (!isAdmin && sedinteLimitate && abonamentReal?.id) {
        const newUsed = await adjustSessionsUsedAtomic(abonamentReal.id, -1)
        if (newUsed != null) setAbonamentReal(prev => prev ? { ...prev, sessions_used: newUsed } : prev)
      }
      supabase.from('class_reminders').delete().eq('class_id', clasaId).eq('member_email', user.email.toLowerCase())
      checkAndBookFromWaitlist(clasaId)
      showToast(t.toastBookingCancelled)
    } else {
      const { error: insErr } = await supabase.from('bookings').insert({ member_id: user.id, class_id: clasaId })
      if (insErr) { showToast(t.toastBookingError); console.error(insErr); return }
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
      showToast(t.toastBookingConfirmed)
    }
    await fetchClaseDB()
    await fetchAbonamentMeu()
  }

  const _azi = new Date()
  const aziStr = `${_azi.getFullYear()}-${String(_azi.getMonth()+1).padStart(2,'0')}-${String(_azi.getDate()).padStart(2,'0')}`

  const VARIANTE_CONFIG = [
    { nivel: 'RX', culoare: '#C45000', bg: '#FFF3EC', key: 'movements_rx', notesKey: 'notes_rx' },
    { nivel: 'Intermediate', culoare: '#633806', bg: '#FAEEDA', key: 'movements_intermediate', notesKey: 'notes_intermediate' },
    { nivel: 'Beginner', culoare: '#0E0E0E', bg: '#f0f0f0', key: 'movements_beginner', notesKey: 'notes_beginner' },
    { nivel: 'OnRamp', culoare: '#0C447C', bg: '#E6F1FB', key: 'movements_onramp', notesKey: 'notes_onramp' },
  ]

  // Formatul activ pentru ecranul logWOD (oficial daca exista wodZiData, altfel
  // ales liber de membru) - inlocuieste vechiul isAmrapLog/miscariPentruAmrapLog,
  // acum generalizat prin catalogul din workoutFormats.js (FormatLogger).
  const activeLogFormatId = editLogId
    ? (editLogFormatId || 'For Time')
    : (variantaAleasa !== null ? (wodZiData?.type || 'For Time') : wodTip)
  const activeLogFormatConfig = editLogId
    ? editLogFormatConfig
    : (variantaAleasa !== null ? wodZiData?.format_config : wodFormatConfig)
  const miscariPentruLog = editLogId
    ? editLogMiscari
    : (variantaAleasa !== null && wodZiData ? (wodMiscariCustom ?? wodZiData[VARIANTE_CONFIG[variantaAleasa]?.key] ?? []) : wodMiscari)
  // Greutatea prescrisa a variantei active, pt genul propriu al membrului
  // (logare noua sau editare) - vezi isNotRxd in workoutFormats.js.
  const prescribedWeightPentruLog = editLogId
    ? editLogPrescribedWeight
    : (variantaAleasa !== null ? (wodZiData?.[weightKeyForVariant(VARIANTE_CONFIG[variantaAleasa]?.nivel, userProfile?.gender)] || '') : '')

  // Acelasi tratament AMRAP (runde + repetari partiale) si pentru Hero WOD-uri, la logarea unui PR.
  // FORMAT-ul unui Hero WOD (built-in sau custom) e mereu "TIP restul textului" pe prima linie
  // (vezi HERO_WODS_INFO si compunerea de mai jos) - acelasi tipar folosit peste tot in app pentru
  // a detecta tipul dintr-un header text (WOD_TYPES.some(t => linie.startsWith(t))).
  const HERO_WOD_TIPURI = ['AMRAP','For Time','EMOM','Tabata','Chipper','Ladder','Partner WOD','Strength']
  const heroWodLiniiSel = miscarePR && heroWodsInfoAll[miscarePR] ? heroWodsInfoAll[miscarePR].split('\n') : []
  const isAmrapHeroPr = heroWodLiniiSel.length > 0 && heroWodLiniiSel[0].startsWith('AMRAP')
  const miscariHeroPr = heroWodLiniiSel.slice(1)
  const composeHeroFormat = () => {
    const totalSec = estimateTotalDurationSec(newHeroWodTip, newHeroWodFormatConfig)
    if (!totalSec) return newHeroWodTip
    const [min, sec] = secToTime(totalSec).split(':')
    return composeFormatHeader(newHeroWodTip, min, sec)
  }
  const parseHeroFormat = (formatStr) => {
    // Fallback "For Time" (nu "AMRAP") pentru text vechi, liber, care nu incepe cu un tip
    // cunoscut - editarea+salvarea nu trebuie sa forteze din greseala UI-ul de Runde/Partial
    // peste un Hero WOD care de fapt nu e AMRAP.
    const tip = HERO_WOD_TIPURI.find(t => (formatStr || '').startsWith(t)) || 'For Time'
    const rest = (formatStr || '').slice(tip.length).trim()
    const durMatch = rest.match(/(\d+):(\d+)/)
    return { tip, min: durMatch ? durMatch[1] : '', sec: durMatch ? durMatch[2] : '0' }
  }

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
    <div style={{ position: 'fixed', inset: 0, background: '#0E0E0E', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 'max(20px, env(safe-area-inset-top))', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingLeft: '20px', paddingRight: '20px', boxSizing: 'border-box', boxShadow: '0 60px 0 0 #0E0E0E' }}>
      <img src="/forge.png" alt="Forge" style={{ width: '100px', height: '100px', borderRadius: '22px', marginBottom: '24px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
      <div style={{ width: '100%', background: '#0E0E0E', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>{t.resetTitle}</div>
          <div style={{ fontSize: '13px', color: '#888' }}>{t.resetSubtitle}</div>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>{t.resetNewPasswordLabel}</div>
          <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" placeholder={t.resetNewPasswordPlaceholder}
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>{t.resetConfirmPasswordLabel}</div>
          <input value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} type="password" placeholder={t.resetConfirmPasswordPlaceholder}
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        {authError && (
          <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', background: authError.startsWith('✓') ? '#1a2e0f' : '#2e0f0f', color: authError.startsWith('✓') ? '#7dce4e' : '#ff7070', fontSize: '12px' }}>
            {authError}
          </div>
        )}
        <button onClick={handleSetNewPassword} disabled={authSubmitting}
          style={{ width: '100%', padding: '13px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: authSubmitting ? 'not-allowed' : 'pointer', opacity: authSubmitting ? 0.7 : 1, fontFamily: 'system-ui' }}>
          {authSubmitting ? t.resetSavingButton : t.resetSaveButton}
        </button>
      </div>
    </div>
  )

  if (authLoading) return (
    <div className="app-frame" style={{ maxWidth: '430px', margin: '0 auto', minHeight: '100%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}><Dumbbell size={48} color="#0E0E0E" strokeWidth={1.5} /></div>
        <div style={{ fontSize: '14px', color: '#888' }}>{t.authLoadingText}</div>
      </div>
    </div>
  )

  if (!user) return (
    <div style={{ position: 'fixed', inset: 0, background: '#0E0E0E', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 'max(20px, env(safe-area-inset-top))', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', paddingLeft: '20px', paddingRight: '20px', boxSizing: 'border-box', overflowY: 'auto', boxShadow: '0 60px 0 0 #0E0E0E' }}>
      {installDismissed && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', boxShadow: '0 60px 0 0 rgba(0,0,0,0.75)' }} onClick={() => setInstallDismissed(false)}>
        <div style={{ background: '#1c1c1e', borderRadius: '24px 24px 0 0', padding: '24px 24px 48px', width: '100%', maxWidth: '430px' }} onClick={e => e.stopPropagation()}>
          <div style={{ width: '36px', height: '4px', background: '#444', borderRadius: '2px', margin: '0 auto 24px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
            <img src="/forge.png" alt="Forge" style={{ width: '56px', height: '56px', borderRadius: '12px' }} />
            <div>
              <div style={{ fontSize: '17px', fontWeight: '700', color: '#fff' }}>{t.installTitle}</div>
              <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{t.installSubtitle}</div>
            </div>
          </div>
          {isIOS ? (<>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {[
                { nr: '1', text: t.installIosStep1Text, icon: '⎋', sub: t.installIosStep1Sub },
                { nr: '2', text: t.installIosStep2Text, icon: '＋', sub: t.installIosStep2Sub },
                { nr: '3', text: t.installIosStep3Text, icon: '✓', sub: t.installIosStep3Sub },
              ].map(s => (
                <div key={s.nr} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#2c2c2e', borderRadius: '14px', padding: '14px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: '500' }}>{s.text}</div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background: '#2c2c2e', borderRadius: '14px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <span style={{ fontSize: '20px' }}>💡</span>
              <span style={{ fontSize: '12px', color: '#888', lineHeight: '1.5' }}>{t.installIosHint}</span>
            </div>
          </>) : (<>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              {[
                { icon: '⋮', text: t.installAndroidStep1Text, sub: t.installAndroidStep1Sub },
                { icon: '＋', text: t.installAndroidStep2Text, sub: t.installAndroidStep2Sub },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: '#2c2c2e', borderRadius: '14px', padding: '14px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '14px', color: '#fff', fontWeight: '500' }}>{s.text}</div>
                    <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </>)}
          <button onClick={() => setInstallDismissed(false)} style={{ width: '100%', padding: '14px', background: '#2c2c2e', color: '#fff', border: 'none', borderRadius: '14px', fontSize: '15px', fontWeight: '600', cursor: 'pointer' }}>{t.installGotIt}</button>
        </div>
      </div>}
      <img src="/forge.png" alt="Forge" style={{ width: '140px', height: '140px', borderRadius: '28px', marginBottom: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} />
      {!isStandalone && (
        <div style={{ marginBottom: '20px', textAlign: 'center' }}>
          {installPrompt ? (
            <button onClick={handleInstall} style={{ background: 'none', border: '1px solid #444', borderRadius: '20px', padding: '8px 20px', color: '#aaa', fontSize: '13px', cursor: 'pointer' }}>
              {t.installAddToHomeScreen}
            </button>
          ) : (
            <button onClick={() => setInstallDismissed(true)} style={{ background: 'none', border: '1px solid #444', borderRadius: '20px', padding: '8px 20px', color: '#aaa', fontSize: '13px', cursor: 'pointer' }}>
              {t.installAddToHomeScreen}
            </button>
          )}
        </div>
      )}
      <div style={{ width: '100%', background: '#0E0E0E', borderRadius: '20px', padding: '28px 24px', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>{t.authAppName}</h1>
          <p style={{ fontSize: '13px', color: '#888' }}>{authScreen === 'login' ? t.authWelcomeBack : t.authCreateAccount}</p>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>{t.authEmailLabel}</div>
          <input value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder={t.authEmailPlaceholder} type="email" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        <div style={{ marginBottom: authScreen === 'login' ? '12px' : '20px' }}>
          <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>{t.authPasswordLabel}</div>
          <input value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder={t.authPasswordPlaceholder} type="password" style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #333', fontSize: '14px', boxSizing: 'border-box', outline: 'none', fontFamily: 'system-ui', background: '#222', color: '#fff' }} />
        </div>
        {authScreen === 'login' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#0E0E0E', cursor: 'pointer' }} />
              <span style={{ fontSize: '13px', color: '#aaa' }}>{t.authRememberMe}</span>
            </label>
            <span onClick={handleForgotPassword} style={{ fontSize: '13px', color: '#ABE73C', cursor: 'pointer', fontWeight: '500' }}>
              {t.authForgotPassword}
            </span>
          </div>
        )}
        {authError && (
          <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', background: authError.startsWith('✓') ? '#1a2e0f' : '#2e0f0f', color: authError.startsWith('✓') ? '#7dce4e' : '#ff7070', fontSize: '12px' }}>
            {authError}
          </div>
        )}
        <button onClick={authScreen === 'login' ? handleLogin : handleRegister} disabled={authSubmitting}
          style={{ width: '100%', padding: '13px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: authSubmitting ? 'not-allowed' : 'pointer', opacity: authSubmitting ? 0.7 : 1, fontFamily: 'system-ui' }}>
          {authSubmitting ? t.authLoadingButton : authScreen === 'login' ? t.authLoginButton : t.authRegisterButton}
        </button>
        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#888' }}>
          {authScreen === 'login' ? t.authNoAccount : t.authHasAccount}
          <span onClick={() => { setAuthScreen(authScreen === 'login' ? 'register' : 'login'); setAuthError('') }} style={{ color: '#ABE73C', fontWeight: '600', cursor: 'pointer' }}>
            {authScreen === 'login' ? t.authRegisterLink : t.authLoginLink}
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <div className="app-frame" style={{ maxWidth: '430px', width: '100%', margin: '0 auto', height: '100%', background: '#FFFFFF', fontFamily: 'system-ui', position: 'relative', boxShadow: 'none', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      <div style={{ position: 'sticky', top: 0, zIndex: 90, background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 'max(10px, env(safe-area-inset-top))', paddingLeft: '16px', paddingRight: '16px', paddingBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/forge.png" alt="Forge" style={{ height: '32px', width: '32px', borderRadius: '8px', objectFit: 'cover' }} />
          <span style={{ color: '#fff', fontWeight: '700', fontSize: '16px', letterSpacing: '1px' }}>FORGE</span>
          <span onClick={() => { debugTapRef.current += 1; if (debugTapRef.current >= 5) { localStorage.setItem('navDebug', '1'); window.location.reload() } }} style={{ color: '#444', fontSize: '10px' }}>v2</span>
        </div>
        <span style={{ fontSize: '14px', fontWeight: '600' }}>
          <span style={{ color: '#fff' }}>CrossFit </span>
          <span style={{ color: '#ABE73C' }}>C15</span>
        </span>
      </div>

      <WorkoutSharePopup data={workoutSharePopup} onClose={() => setWorkoutSharePopup(null)} t={t} lang={lang} />

      {!isAdmin && abonamentInitialized && claseDBLoaded && rezervariIncarcate && !abonamentActiv && !showOnboarding && screen !== 'abonament' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', boxShadow: '0 60px 0 0 rgba(0,0,0,0.65)' }}>
          <div style={{ background: '#fff', borderRadius: '20px', padding: '32px 24px', textAlign: 'center', maxWidth: '340px', width: '100%' }}>
            <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'center' }}><Lock size={48} color="#0E0E0E" strokeWidth={1.5} /></div>
            <div style={{ fontSize: '18px', fontWeight: '700', color: '#0E0E0E', marginBottom: '8px' }}>
              {!abonamentReal ? t.paywallNoSubscription
                : !abonamentInceput ? t.subScheduled
                : sedinteLimitate && sedinteRamase === 0 ? t.subSessionsExhausted
                : t.paywallExpired}
            </div>
            <div style={{ fontSize: '13px', color: '#888', lineHeight: '1.6', marginBottom: '22px' }}>
              {!abonamentReal
                ? t.paywallNoSubscriptionText
                : !abonamentInceput
                  ? t.paywallStartsOnText(new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' }))
                  : sedinteLimitate && sedinteRamase === 0
                    ? t.paywallSessionsExhaustedText
                    : t.paywallExpiredText}
            </div>
            <button onClick={() => fetchAbonamentMeu()} style={{ width: '100%', padding: '13px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', marginBottom: '10px' }}>
              {t.paywallReload}
            </button>
            <button onClick={() => setScreen('abonament')} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#555', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '13px', fontWeight: '500', cursor: 'pointer', marginBottom: '10px' }}>
              {t.paywallViewSubscription}
            </button>
            <button onClick={handleLogout} style={{ width: '100%', padding: '10px', background: 'transparent', color: '#aaa', border: '1px solid #e0e0e0', borderRadius: '12px', fontSize: '12px', cursor: 'pointer' }}>
              {t.paywallLogout}
            </button>
          </div>
        </div>
      )}

      <div ref={mainScrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}>

      {screen === 'home' && (() => {
        const selData = new Date(dataAcasa + 'T00:00:00')
        const claseZi = claseDB.filter(c => c.date === dataAcasa).sort((a,b) => (a.start_time || '').localeCompare(b.start_time || ''))
        const zileRamase = abonamentReal ? Math.max(0, daysUntil(abonamentReal.end_date)) : 0
        const sessTotal = abonamentReal?.sessions_total
        const sessUsed = abonamentReal?.sessions_used || 0
        const progres = sessTotal ? Math.min(1, sessUsed / sessTotal) : 0
        const prenume = user?.user_metadata?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'Athlete'
        const numeFull = user?.user_metadata?.full_name || user?.email || ''
        const initiale = numeFull.split(' ').map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'U'
        const esteAzi = dataAcasa === actualToday
        const logZiWod = wodZiData ? wodLogs.find(l => l.wod_id === wodZiData.id) : null
        const logZiSkill = wodZiData ? skillLogs.find(l => l.wod_id === wodZiData.id && (l.slot || 1) === 1) : null
        const logZiSkill2 = wodZiData ? skillLogs.find(l => l.wod_id === wodZiData.id && l.slot === 2) : null
        return (
          <div style={{ paddingBottom: '80px', background: '#FFFFFF' }}>

            {/* ── Card dată + calendar săptămânal ── */}
            <div style={{ background: '#fff', padding: '20px 20px 18px', marginBottom: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                {/* Navigare dată */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ textAlign: 'left' }}>
                    <div onClick={() => { setCalPickerYear(selData.getFullYear()); setCalPickerMonth(selData.getMonth()); setShowCalPicker(true) }}
                      style={{ fontSize: '24px', fontWeight: '900', color: '#0E0E0E', letterSpacing: '-0.5px', lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {selData.getDate()} {selData.toLocaleDateString(localeFor(lang), { month: 'long' }).toUpperCase()}
                      <span style={{ fontSize: '14px', color: '#bbb' }}>▾</span>
                    </div>
                    {!esteAzi && (
                      <div onClick={() => { setDataAcasa(actualToday); scrollChipToDate(actualToday) }}
                        style={{ fontSize: '10px', color: '#0E0E0E', fontWeight: '600', cursor: 'pointer', marginTop: '2px' }}>{t.homeBackToToday}</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '20px', fontWeight: '900', color: '#0E0E0E', lineHeight: 1 }}>{wodLogs.length}</div>
                    <div style={{ fontSize: '9px', color: '#aaa', fontWeight: '700', letterSpacing: '0.1em', marginTop: '1px' }}>{t.homeSessionsLabel}</div>
                  </div>
                  <div onClick={() => {
                    setProfileFirstName(userProfile?.first_name || ''); setProfileLastName(userProfile?.last_name || '')
                    setProfileGender(userProfile?.gender || ''); setProfileBirthDate(userProfile?.birth_date || '')
                    setPrevScreen('home'); setScreen('profile')
                  }}
                    style={{ width: '38px', height: '38px', borderRadius: '50%', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
                    {avatarUploading ? (
                      <span style={{ fontSize: '10px', color: '#ABE73C', animation: 'spin 1s linear infinite' }}>⏳</span>
                    ) : userProfile?.avatar_url ? (
                      <img src={userProfile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '13px', fontWeight: '800', color: '#ABE73C', letterSpacing: '-0.5px' }}>{initiale}</span>
                    )}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: '14px', color: '#888', marginBottom: '18px' }}>{t.homeGreeting(prenume)}</p>

            </div>

            {/* ── Clase disponibile ── */}
            <div style={{ background: '#fff', marginBottom: '10px' }}>
              <div style={{ padding: '14px 20px 10px' }}>
                {/* Chip scroll: tot anul curent (1 Ian – 31 Dec) */}
                <div ref={homeCalScrollRef} className="hide-scrollbar" style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px', scrollbarWidth: 'none' }}>
                  {homeCalendarChips.map(({ ds, dayNum, ziuaLitera, luna, eAzi, areRez, areWod }) => {
                    const selectat = ds === dataAcasa
                    return (
                      <div key={ds}
                        ref={eAzi ? homeCalTodayRef : null}
                        onClick={() => setDataAcasa(ds)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1px', width: '64px', height: '64px', borderRadius: '16px', flexShrink: 0, cursor: 'pointer',
                          background: selectat ? '#ABE73C' : 'transparent',
                          border: selectat ? 'none' : eAzi ? '2px solid #0E0E0E' : '1px solid #e8e8e8',
                          // translateZ(0) forteaza cardul pe propriul layer GPU - fara asta, pe iOS
                          // Safari, schimbarea de background la selectare/deselectare lasa pixeli
                          // "fantoma" din vechea culoare la colturile rotunjite (raportat: linie lime
                          // ramasa pe cardul anterior selectat, permanent, in interiorul randului cu
                          // scroll orizontal).
                          transform: 'translateZ(0)', WebkitTransform: 'translateZ(0)' }}>
                        <span style={{ fontSize: '10px', fontWeight: '700', color: selectat ? '#0E0E0E' : '#bbb', letterSpacing: '0.04em' }}>{ziuaLitera}</span>
                        <span style={{ fontSize: '20px', fontWeight: selectat || eAzi ? '900' : '500', color: '#0E0E0E', lineHeight: 1 }}>{dayNum}</span>
                        <span style={{ fontSize: '10px', color: selectat ? '#0E0E0E' : '#aaa', fontWeight: '500' }}>{luna}</span>
                        <span style={{ fontSize: '9px', lineHeight: 1, color: selectat ? '#0E0E0E' : '#ABE73C', visibility: (areWod || areRez) ? 'visible' : 'hidden' }}>{areRez ? '✓' : '⚡'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ padding: '0 20px 14px' }}>
                <div onClick={() => setClaseHomeDeschis(v => !v)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', padding: '12px 14px', borderRadius: '12px', transition: 'background 0.15s, border-color 0.15s',
                    border: claseHomeDeschis ? '1.5px solid #0E0E0E' : '1.5px solid #e0e0e0',
                    background: claseHomeDeschis ? '#0E0E0E' : '#fafafa' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: claseHomeDeschis ? '#ABE73C' : '#0E0E0E' }}>
                    {claseZi.length === 0 ? t.homeNoClasses(esteAzi) : t.homeClassesAvailable(claseZi.length)}
                  </span>
                  <span style={{ fontSize: '11px', color: claseHomeDeschis ? '#ABE73C' : '#888', display: 'inline-block', transform: claseHomeDeschis ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s, color 0.15s' }}>▼</span>
                </div>
              </div>
              {claseHomeDeschis && (
              <div style={{ padding: '0 16px 16px' }}>
                {claseZi.length === 0
                  ? <div style={{ padding: '8px 4px', color: '#aaa', fontSize: '13px' }}>{t.homeNoClasses(esteAzi)}</div>
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
                            background: rezervat ? '#f0f0f0' : c.color ? c.color + '33' : deschis ? '#FFFFFF' : '#fafafa',
                            border: rezervat ? '2px solid #0E0E0E' : c.color ? `2px solid ${c.color}` : deschis ? '2px solid #0E0E0E' : '1px solid #ececec' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <span style={{ fontSize: '17px', fontWeight: '800', color: rezervat ? '#0E0E0E' : '#0E0E0E', letterSpacing: '-0.3px' }}>{c.start_time?.slice(0,5)}</span>
                              <span style={{ fontSize: '12px', color: '#888', marginLeft: '8px' }}>{c.end_time?.slice(0,5)}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              {rezervat
                                ? <span style={{ fontSize: '11px', background: '#ABE73C', color: '#0E0E0E', padding: '2px 8px', borderRadius: '20px', fontWeight: '700' }}>{t.homeReserved}</span>
                                : peWaitlist
                                ? <span style={{ fontSize: '11px', color: '#EF9F27', fontWeight: '600' }}>{t.homeWaitlisted}</span>
                              : plin
                                ? <span style={{ fontSize: '11px', color: '#C62828', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Lock size={11} /> {t.homeFull}</span>
                                : <span style={{ fontSize: '11px', color: '#888' }}>{t.homeSpotsLeft(nrRez, c.max_spots)}</span>}
                            </div>
                          </div>
                          <div style={{ fontSize: '12px', color: rezervat ? '#0E0E0E' : '#888', marginTop: '3px' }}>{c.name || t.homeDefaultClassName} · {c.coach}</div>
                          {deschis && (
                            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${rezervat ? '#b8eec0' : '#e0e0e0'}` }}
                              onClick={e => e.stopPropagation()}>
                              {(() => {
                                const membri = rezervariPerClasa[c.id]?.membri || []
                                const cnt = rezervariPerClasa[c.id]?.count ?? nrRez
                                return membri.length > 0 ? (
                                  <div style={{ marginBottom: '10px' }}>
                                    <div style={{ fontSize: '10px', color: '#aaa', fontWeight: '700', letterSpacing: '0.06em', marginBottom: '6px' }}>{t.homeParticipantsLabel(cnt, c.max_spots)}</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                      {membri.map((name, mi) => (
                                        <span key={mi} style={{ fontSize: '11px', background: rezervat ? '#f0f0f0' : '#f0f0f0', color: rezervat ? '#0E0E0E' : '#555', padding: '3px 8px', borderRadius: '20px', fontWeight: '500' }}>{name}</span>
                                      ))}
                                    </div>
                                  </div>
                                ) : cnt > 0 ? (
                                  <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '10px' }}>{t.homeParticipantsCount(cnt)}</div>
                                ) : null
                              })()}
                              {!esteInTrecut ? (
                                rezervat ? (
                                  <button onClick={() => { toggleRezervare(c.id); setClasaHomeSelectata(null) }}
                                    style={{ width: '100%', padding: '9px', background: 'transparent', color: '#C62828', border: '1px solid #F7C1C1', borderRadius: '10px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' }}>
                                    {t.homeCancelReservation}
                                  </button>
                                ) : peWaitlist ? (
                                  <button onClick={() => toggleWaitlist(c.id)}
                                    style={{ width: '100%', padding: '9px', background: '#FFF8EC', color: '#B86E00', border: '1px solid #FCDFA0', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                                    {t.homeWaitlistCancel}
                                  </button>
                                ) : blocat ? (
                                  <div style={{ textAlign: 'center', fontSize: '12px', color: '#888', padding: '6px' }}>{t.homeSessionsExhausted}</div>
                                ) : plin ? (
                                  <button onClick={() => toggleWaitlist(c.id)}
                                    style={{ width: '100%', padding: '9px', background: '#FFFFFF', color: '#555', border: '1px solid #e0e0e0', borderRadius: '10px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                                    {t.homeJoinWaitlist}
                                  </button>
                                ) : (
                                  <button onClick={() => { toggleRezervare(c.id); setClasaHomeSelectata(null) }}
                                    style={{ width: '100%', padding: '9px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>
                                    {t.homeBookSpot}
                                  </button>
                                )
                              ) : (
                                <div style={{ textAlign: 'center', fontSize: '11px', color: '#bbb', padding: '4px' }}>{t.homeClassPast}</div>
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
                  <div style={{ fontSize: '10px', color: '#0E0E0E', fontWeight: '800', letterSpacing: '0.12em', marginBottom: '6px' }}>{t.homeWodBadge}</div>
                  <div style={{ fontSize: '17px', fontWeight: '700', color: '#0E0E0E' }}>
                    {wodZiData ? (wodZiData.name ? `"${wodZiData.name}"` : `${wodZiData.type} ${formatWodDurata(wodZiData.duration)}`) : t.homeNoWodToday}
                  </div>
                  {wodZiData?.name && <div style={{ fontSize: '12px', color: '#888', marginTop: '1px' }}>{wodZiData.type} {formatWodDurata(wodZiData.duration)}</div>}
                  {wodZiData && describeFormatConfig(wodZiData.type, wodZiData.format_config, t) && (
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{describeFormatConfig(wodZiData.type, wodZiData.format_config, t)}</div>
                  )}
                  {!wodDeschis && wodZiData && (wodZiData.movements_rx || []).length > 0 && (
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{(wodZiData.movements_rx || []).join(' · ')}</div>
                  )}
                  {logZiWod && (
                    <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '0.06em', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle2 size={14} color="#0E0E0E" strokeWidth={2} fill="#ABE73C" />
                      <span style={{ color: '#0E0E0E' }}>{t.homeWorkoutDone}</span>
                      {logZiWod.variant_level && (
                        <>
                          <span style={{ color: '#ddd', fontWeight: '400' }}>|</span>
                          <span style={{ color: '#0E0E0E' }}>{logZiWod.variant_level}</span>
                        </>
                      )}
                    </div>
                  )}
                  {logZiSkill && (
                    <div style={{ fontSize: '11px', fontWeight: '800', letterSpacing: '0.06em', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <CheckCircle2 size={14} color="#0E0E0E" strokeWidth={2} fill="#ABE73C" />
                      <span style={{ color: '#0E0E0E' }}>{t.homeSkillWorkDone}</span>
                      {wodZiData.skill_name && (
                        <>
                          <span style={{ color: '#ddd', fontWeight: '400' }}>|</span>
                          <span style={{ color: '#0E0E0E' }}>{wodZiData.skill_name}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: wodDeschis ? '#0E0E0E' : '#f0f0f0', color: wodDeschis ? '#ABE73C' : '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>
                  {wodDeschis ? '−' : '+'}
                </div>
              </div>
              {wodDeschis && wodZiData && (
                <div style={{ marginTop: '16px', borderTop: '1px solid #f0f0f0', paddingTop: '16px' }}>
                  {(wodZiData.warmup_visible !== false || isAdmin || isCoach) && (wodZiData.warmup || []).length > 0 && (
                    <div style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '10px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '0.06em', marginBottom: '8px' }}>
                        {t.homeWodWarmupTitle}
                        {wodZiData.warmup_visible === false && (isAdmin || isCoach) && (
                          <span style={{ marginLeft: '6px', fontWeight: '600', textTransform: 'none', letterSpacing: 'normal', color: '#c99a3a' }}>({t.homeWodHiddenFromMembers})</span>
                        )}
                      </div>
                      {wodZiData.warmup.map((m, mi) => (
                        <div key={mi} style={{ fontSize: '13px', color: '#0E0E0E', padding: '3px 0' }}>• {m}</div>
                      ))}
                    </div>
                  )}
                  {(wodZiData.skill_visible !== false || isAdmin || isCoach) && (
                    <SkillHomeSection
                      titleLabel={t.homeWodSkillTitle}
                      skillMovements={wodZiData.skill} skillName={wodZiData.skill_name}
                      skillType={wodZiData.skill_type} skillFormatConfig={wodZiData.skill_format_config}
                      logZiSkill={logZiSkill} isOpen={skillDeschis} onToggle={() => setSkillDeschis(!skillDeschis)}
                      onLogClick={() => { setSkillLogSlot(1); setSkillLogNote(logZiSkill?.notes || ''); setSkillLogSets(normalizeSetsRows(logZiSkill?.sets)); setSkillLogResult(logZiSkill?.result || ''); setSkillLogCompleted(!!logZiSkill?.log_meta?.completed); setSkillLogTime(''); setSkillLogRoundsCompleted(''); setSkillLogPartialReps([]); setSkillPrCandidates(null); setPrevScreen('home'); setScreen('logSkill') }}
                      userProfile={userProfile} hiddenFromMembers={wodZiData.skill_visible === false && (isAdmin || isCoach)} t={t} />
                  )}
                  {(wodZiData.skill2_visible !== false || isAdmin || isCoach) && (
                    <SkillHomeSection
                      titleLabel={t.homeWodSkill2Title}
                      skillMovements={wodZiData.skill2} skillName={wodZiData.skill2_name}
                      skillType={wodZiData.skill2_type} skillFormatConfig={wodZiData.skill2_format_config}
                      logZiSkill={logZiSkill2} isOpen={skillDeschis2} onToggle={() => setSkillDeschis2(!skillDeschis2)}
                      onLogClick={() => { setSkillLogSlot(2); setSkillLogNote(logZiSkill2?.notes || ''); setSkillLogSets(normalizeSetsRows(logZiSkill2?.sets)); setSkillLogResult(logZiSkill2?.result || ''); setSkillLogCompleted(!!logZiSkill2?.log_meta?.completed); setSkillLogTime(''); setSkillLogRoundsCompleted(''); setSkillLogPartialReps([]); setSkillPrCandidates(null); setPrevScreen('home'); setScreen('logSkill') }}
                      userProfile={userProfile} hiddenFromMembers={wodZiData.skill2_visible === false && (isAdmin || isCoach)} t={t} />
                  )}
                  {VARIANTE_CONFIG.map((v, i) => {
                    const miscari = wodZiData[v.key] || []
                    const notaVarianta = wodZiData[v.notesKey] || ''
                    return (
                      <div key={i} onClick={() => {
                        const dejaSelectata = variantaAleasa === i
                        setVariantaAleasa(dejaSelectata ? null : i); setWodMiscariCustom(null)
                        setWodWeightLogged(dejaSelectata ? '' : (wodZiData?.[weightKeyForVariant(v.nivel, userProfile?.gender)] || ''))
                      }}
                        style={{ border: variantaAleasa === i ? `2px solid ${v.culoare}` : '1px solid #f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', cursor: 'pointer', background: variantaAleasa === i ? '#fff' : '#fafafa' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: variantaAleasa === i && miscari.length > 0 ? '10px' : '0' }}>
                          <LevelDot nivel={v.nivel} />
                          <span style={{ fontSize: '13px', fontWeight: '600', color: v.culoare }}>{v.nivel}</span>
                          {variantaAleasa === i && <span style={{ marginLeft: 'auto', fontSize: '10px', padding: '2px 8px', background: '#0E0E0E', color: '#fff', borderRadius: '20px' }}>{t.homeVariantSelected}</span>}
                        </div>
                        {variantaAleasa === i && (miscari.length > 0 || notaVarianta) && (
                          <>
                            <div style={{ background: '#f0f0f0', borderRadius: '8px', padding: '7px 10px', marginBottom: '8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E' }}>{wodZiData.type}</span>
                                <span style={{ fontSize: '12px', color: '#888' }}>{formatWodDurata(wodZiData.duration)}</span>
                              </div>
                              {wodZiData.name && <div style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E', marginTop: '2px' }}>"{wodZiData.name}"</div>}
                              {describeFormatConfig(wodZiData.type, wodZiData.format_config, t) && (
                                <div style={{ fontSize: '11px', color: '#888', marginTop: '2px' }}>{describeFormatConfig(wodZiData.type, wodZiData.format_config, t)}</div>
                              )}
                            </div>
                            {miscari.length > 0 && (
                              <div>
                                {miscari.map((m, mi) => (
                                  <div key={mi} style={{ padding: '7px 10px', background: '#f0f0f0', borderRadius: '8px', marginBottom: '6px' }}>
                                    <span style={{ fontSize: '13px', color: '#0E0E0E' }}>• {m}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {notaVarianta && (
                              <div style={{ padding: '8px 10px', background: '#FFF6DA', border: '1px solid #F3DE9C', borderRadius: '8px', marginTop: '6px' }}>
                                <div style={{ fontSize: '10px', fontWeight: '700', color: '#8A6D1D', letterSpacing: '0.06em', marginBottom: '2px' }}>{t.homeWodNotesLabel.toUpperCase()}</div>
                                <span style={{ fontSize: '13px', color: '#8A6D1D' }}>{notaVarianta}</span>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  <button onClick={() => { setEditLogId(null); setLogWodStep('compose'); setPrevScreen('home'); setScreen('logWOD') }} disabled={variantaAleasa === null}
                    style={{ width: '100%', padding: '12px', background: variantaAleasa !== null ? '#ABE73C' : '#ccc', color: variantaAleasa !== null ? '#0E0E0E' : '#888', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: variantaAleasa !== null ? 'pointer' : 'not-allowed', marginTop: '8px' }}>
                    {variantaAleasa !== null ? t.homeLogWithLevel(VARIANTE_CONFIG[variantaAleasa].nivel) : t.homeChooseVariantFirst}
                  </button>
                </div>
              )}
              {wodDeschis && !wodZiData && (
                <div style={{ marginTop: '12px', borderTop: '1px solid #f0f0f0', paddingTop: '12px', textAlign: 'center', color: '#aaa', fontSize: '13px' }}>
                  {isAdmin ? t.homeWodAdminHint : t.homeWodMemberHint}
                </div>
              )}
            </div>

            {/* ── Card abonament ── */}
            {abonamentReal && (
              <div onClick={() => setScreen('abonament')} style={{ background: '#fff', marginBottom: '10px', padding: '16px 20px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontSize: '15px', fontWeight: '700', color: '#0E0E0E' }}>{abonamentReal.subscription_plans?.name || t.homeDefaultSubscriptionName}</div>
                    <div style={{ marginTop: '4px' }}><CreditCard size={22} color="#0E0E0E" strokeWidth={1.75} /></div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {sessTotal ? (
                      <div style={{ fontSize: '18px', fontWeight: '800', lineHeight: 1 }}>
                        <span style={{ color: '#0E0E0E' }}>{sessUsed}</span>
                        <span style={{ color: '#ddd', fontWeight: '400', fontSize: '16px' }}> / </span>
                        <span style={{ color: '#0E0E0E' }}>{sessTotal}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: '#0E0E0E', fontWeight: '700' }}>{t.homeUnlimited}</div>
                    )}
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '3px' }}>{t.homeDaysLeft(zileRamase)}</div>
                  </div>
                </div>
                {sessTotal && (
                  <div style={{ height: '7px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progres * 100}%`, background: progres >= 1 ? '#E24B4A' : progres > 0.8 ? '#BA7517' : '#0E0E0E', borderRadius: '4px' }} />
                  </div>
                )}
              </div>
            )}

          </div>
        )
      })()}

      {screen === 'abonament' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen('home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#0E0E0E' }}>{t.subMyTitle}</h1>
          </div>
          {!abonamentReal ? (
            <div style={{ background: '#FFFFFF', borderRadius: '14px', padding: '30px', textAlign: 'center', marginBottom: '14px' }}>
              <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}><ClipboardList size={36} color="#0E0E0E" strokeWidth={1.5} /></div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#0E0E0E', marginBottom: '6px' }}>{t.subNoActive}</div>
              <div style={{ fontSize: '12px', color: '#888' }}>{t.subContactCoachAdd}</div>
            </div>
          ) : !abonamentActiv ? (
            <div style={{ background: !abonamentInceput ? '#f0f0f0' : '#FCEBEB', borderRadius: '14px', padding: '20px', marginBottom: '14px', textAlign: 'center' }}>
              <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}>
                {!abonamentInceput ? <Calendar size={36} color="#0E0E0E" strokeWidth={1.5} /> : sedinteLimitate && sedinteRamase === 0 ? <Flag size={36} color="#0E0E0E" strokeWidth={1.5} /> : <Lock size={36} color="#0E0E0E" strokeWidth={1.5} />}
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: !abonamentInceput ? '#0E0E0E' : '#791F1F', marginBottom: '6px' }}>
                {!abonamentInceput ? t.subScheduled
                  : sedinteLimitate && sedinteRamase === 0 ? t.subSessionsExhausted
                  : t.subExpired}
              </div>
              <div style={{ fontSize: '12px', color: !abonamentInceput ? '#0E0E0E' : '#A32D2D' }}>
                {!abonamentInceput
                  ? t.subStartsOn(new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long', year: 'numeric' }))
                  : sedinteLimitate && sedinteRamase === 0
                    ? t.subAllSessionsUsed
                    : t.subContactCoachRenew}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '10px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', borderLeft: '4px solid #0E0E0E' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{t.subActivePlan}</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', color: '#0E0E0E' }}>{abonamentReal.subscription_plans?.name}</div>
                </div>
                <span style={{ background: '#f0f0f0', color: '#0E0E0E', fontSize: '11px', padding: '3px 10px', borderRadius: '20px', fontWeight: '500' }}>{t.subActiveBadge}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#888', display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Calendar size={12} /> {t.subValidLabel}</span>
                <span style={{ fontSize: '12px', fontWeight: '600', color: '#0E0E0E' }}>
                  {new Date(abonamentReal.start_date + 'T00:00:00').toLocaleDateString(localeFor(lang))} – {new Date(abonamentReal.end_date + 'T00:00:00').toLocaleDateString(localeFor(lang))}
                </span>
              </div>
              {abonamentReal.sessions_total && (
                <>
                  <div style={{ background: '#f0f0f0', borderRadius: '4px', height: '6px', marginBottom: '8px' }}>
                    <div style={{ width: Math.min(100, ((abonamentReal.sessions_used || 0) / abonamentReal.sessions_total) * 100) + '%', height: '6px', borderRadius: '4px', background: '#EF9F27' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', color: '#888' }}>{t.subSessionsUsedLabel}</span>
                    <span style={{ fontSize: '12px', fontWeight: '600' }}>{abonamentReal.sessions_used || 0} / {abonamentReal.sessions_total}</span>
                  </div>
                </>
              )}
            </div>
          )}
          <div style={{ background: '#f0f0f0', borderRadius: '14px', padding: '14px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', color: '#0E0E0E' }}>{t.subContactCoachFooter}</div>
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
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#0E0E0E', letterSpacing: '0.06em', marginBottom: '12px' }}>{t.subMyReservations}</div>
                {viitoare.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', color: '#0E0E0E', fontWeight: '700', letterSpacing: '0.06em', marginBottom: '8px' }}>{t.subUpcoming}</div>
                    {viitoare.map(c => (
                      <div key={c.id} style={{ background: '#f0f0f0', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', borderLeft: '4px solid #0E0E0E' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E' }}>{c.name || t.homeDefaultClassName}</div>
                            <div style={{ fontSize: '11px', color: '#0E0E0E', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Calendar size={11} /> {new Date(c.date + 'T00:00:00').toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' })} · {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)}
                            </div>
                            <div style={{ fontSize: '11px', color: '#0E0E0E', display: 'flex', alignItems: 'center', gap: '4px' }}><User size={11} /> {c.coach}</div>
                          </div>
                          <button onClick={() => toggleRezervare(c.id)}
                            style={{ background: 'transparent', color: '#C62828', border: '1px solid #F7C1C1', borderRadius: '8px', padding: '5px 10px', fontSize: '11px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                            {t.subCancel}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {trecute.length > 0 && (
                  <div>
                    <div style={{ fontSize: '10px', color: '#aaa', fontWeight: '700', letterSpacing: '0.06em', marginBottom: '8px' }}>{t.subHistory}</div>
                    {trecute.map(c => (
                      <div key={c.id} style={{ background: '#fafafa', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', borderLeft: '4px solid #e0e0e0' }}>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: '#aaa' }}>{c.name || t.homeDefaultClassName}</div>
                        <div style={{ fontSize: '11px', color: '#ccc', marginTop: '3px' }}>
                          {new Date(c.date + 'T00:00:00').toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' })} · {c.start_time?.slice(0,5)}–{c.end_time?.slice(0,5)} · {c.coach}
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
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0E0E0E', textTransform: 'uppercase', letterSpacing: '-0.5px', marginBottom: '16px' }}>Log</h1>
          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: '12px', padding: '3px', marginBottom: '20px' }}>
            <div onClick={() => { setVariantaAleasa(null); setEditLogId(null); setLogWodStep('compose'); setPrevScreen('log'); setScreen('logWOD') }}
              style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: '10px', fontSize: '13px', fontWeight: '400', background: 'transparent', color: '#888', cursor: 'pointer', transition: 'all 0.15s' }}>
              {t.logNewEntry}
            </div>
            <div onClick={() => setLogTab('liber')}
              style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: '10px', fontSize: '13px', fontWeight: logTab === 'liber' ? '700' : '400', background: logTab === 'liber' ? '#fff' : 'transparent', color: logTab === 'liber' ? '#0E0E0E' : '#888', cursor: 'pointer', boxShadow: logTab === 'liber' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
              {t.logFreeTextTab}
            </div>
            <div onClick={() => setLogTab('jurnal')}
              style={{ flex: 1, textAlign: 'center', padding: '8px', borderRadius: '10px', fontSize: '13px', fontWeight: logTab === 'jurnal' ? '700' : '400', background: logTab === 'jurnal' ? '#fff' : 'transparent', color: logTab === 'jurnal' ? '#0E0E0E' : '#888', cursor: 'pointer', boxShadow: logTab === 'jurnal' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
              {t.logJournalTab}
            </div>
          </div>

          {logTab === 'liber' && (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.adminWodNameLabel} <span style={{ color: '#bbb' }}>{t.adminWodNameOptional}</span></div>
              <input value={freeLogName} onChange={e => setFreeLogName(e.target.value)} placeholder='ex: "Fran", "Helen", "Grace"'
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px', fontWeight: '600' }}>{t.logFreeTextTitle}</div>
              <textarea value={freeLogText} onChange={e => setFreeLogText(e.target.value)}
                placeholder={t.logFreeTextPlaceholder} rows={6}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px', resize: 'vertical', fontFamily: 'inherit' }} />
              <button onClick={saveFreeTextLog} disabled={freeLogSaving}
                style={{ width: '100%', padding: '12px', background: '#0E0E0E', color: '#ABE73C', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: freeLogSaving ? 'default' : 'pointer', opacity: freeLogSaving ? 0.6 : 1 }}>
                {freeLogSaving ? t.logFreeTextSaving : t.logFreeTextSaveButton}
              </button>
            </div>
          )}

          {logTab === 'jurnal' && (
            <JurnalList entries={jurnalEntries} onDeleteWod={stergeWodLog} onDeleteSkill={stergeSkillLog} gender={userProfile?.gender} weightUnit={userProfile?.weight_unit} t={t} lang={lang}
              onEditWod={(log) => {
                const parts = (log.notes || '').split('\n---\n')
                const prefix = parts.length > 1 ? parts[0] : (parts[0] || '')
                const linii = prefix.split('\n').filter(Boolean)
                const headerTip = linii.length > 0 ? legacyHeaderTypeOf(linii[0]) : null
                const movimenteLog = linii.slice(headerTip ? 1 : 0)
                const formatId = log.wods?.type || log.format_type || headerTip || 'For Time'
                const format = getFormat(formatId)
                setEditLogId(log.id)
                setEditLogHeader(headerTip ? linii[0] : '')
                setEditLogFormatId(formatId)
                setEditLogFormatConfig(log.wods?.format_config || null)
                setEditLogMiscari(movimenteLog)
                setEditLogMiscareCurenta('')
                // La RFT/Partner WOD (scoreMode 'fortime_or_amrap'), rezultatul
                // salvat poate fi ori text liber (a terminat, are timp), ori
                // compus ca "N runde + ..." (n-a terminat, a logat runde+reps
                // partiale - vezi composeWodLogFields). Distingem dupa formatul
                // textului, nu doar dupa scoreMode strict 'amrap' - altfel
                // editarea unui log salvat cu runde partiale il arata gresit
                // ca text liber in loc sa repopuleze campurile.
                //
                // La For Time/Ladder (sequentialPartial), stim direct din
                // format ca orice rezultat salvat (non-null) e o compunere de
                // repetari per miscare, fara sa mai ghicim din tiparul textului.
                const areRundeCompuse = /^\d+\s+runde/.test((log.result || '').trim())
                if (isSequentialFormat(formatId, log.wods?.format_config)) {
                  const partialArr = log.result ? parsePartialText(log.result, movimenteLog) : movimenteLog.map(() => '')
                  setWodResult(''); setWodRoundsCompleted(''); setWodPartialReps(partialArr)
                } else if (format.scoreMode === 'amrap' || (format.scoreMode === 'fortime_or_amrap' && areRundeCompuse)) {
                  const { rounds, partialArr } = parseAmrapResult(log.result || '', movimenteLog)
                  setWodResult(''); setWodRoundsCompleted(rounds); setWodPartialReps(partialArr)
                } else {
                  setWodResult(log.result || ''); setWodRoundsCompleted(''); setWodPartialReps([])
                }
                setWodTime(log.time_result || '')
                setWodSets(normalizeSetsRows(log.sets))
                setWodCompleted(!!log.log_meta?.completed)
                setWodNote(parts.length > 1 ? parts[1] : '')
                setWodWeightLogged(log.weight_logged || '')
                setEditLogPrescribedWeight(log.wods?.[weightKeyForVariant(log.variant_level, userProfile?.gender)] || '')
                setPrevScreen('log')
                setScreen('logWOD')
              }}
              onEditSkill={(sl) => {
                setSkillLogSlot(sl.slot === 2 ? 2 : 1)
                // Acelasi motiv ca la onEditWod: la RFT/Ladder/Partner WOD,
                // rezultatul salvat poate fi runde+reps partiale compuse
                // ("N runde + ..."), nu doar text liber - fara sa distingem,
                // editarea unui skill log logat cu runde partiale ar afisa
                // gresit textul brut in loc sa repopuleze campurile.
                const skillTypeEdit = (sl.slot === 2 ? sl.wods?.skill2_type : sl.wods?.skill_type) || 'Weightlifting'
                const formatEdit = getFormat(skillTypeEdit)
                const skillMiscariEdit = (sl.slot === 2 ? sl.wods?.skill2 : sl.wods?.skill) || []
                const areRundeCompuse = /^\d+\s+runde/.test((sl.result || '').trim())
                const skillFormatConfigEdit = sl.slot === 2 ? sl.wods?.skill2_format_config : sl.wods?.skill_format_config
                if (isSequentialFormat(skillTypeEdit, skillFormatConfigEdit)) {
                  const partialArr = sl.result ? parsePartialText(sl.result, skillMiscariEdit) : skillMiscariEdit.map(() => '')
                  setSkillLogResult(''); setSkillLogRoundsCompleted(''); setSkillLogPartialReps(partialArr)
                } else if (formatEdit.scoreMode === 'amrap' || (formatEdit.scoreMode === 'fortime_or_amrap' && areRundeCompuse)) {
                  const { rounds, partialArr } = parseAmrapResult(sl.result || '', skillMiscariEdit)
                  setSkillLogResult(''); setSkillLogRoundsCompleted(rounds); setSkillLogPartialReps(partialArr)
                } else {
                  setSkillLogResult(sl.result || ''); setSkillLogRoundsCompleted(''); setSkillLogPartialReps([])
                }
                setSkillLogNote(sl.notes || ''); setSkillLogSets(normalizeSetsRows(sl.sets)); setSkillLogCompleted(!!sl.log_meta?.completed); setSkillLogTime(''); setSkillPrCandidates(null)
                if (sl.wods?.date) setDataAcasa(sl.wods.date)
                setPrevScreen('log')
                setScreen('logSkill')
              }} />
          )}

        </div>
      )}

      {screen === 'logWOD' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => {
              if (editLogId) { setEditLogId(null); setEditLogNotesPrefix(''); setEditLogHeader(''); setEditLogFormatId(null); setEditLogFormatConfig(null); setEditLogMiscari([]); setWodResult(''); setWodRoundsCompleted(''); setWodPartialReps([]); setWodTime(''); setWodSets({}); setWodCompleted(false); setWodNote(''); setWodWeightLogged(''); setEditLogPrescribedWeight(''); setScreen(prevScreen || 'home') }
              else if (logWodStep === 'score') { setLogWodStep('compose') }
              else { setScreen(prevScreen || 'home') }
            }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#0E0E0E' }}>{editLogId ? t.logWodEditTitle : t.logWodNewTitle}</h1>
          </div>

          {editLogId ? (
            <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              {editLogHeader ? (
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#0E0E0E', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{editLogHeader}</div>
              ) : null}
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px', fontWeight: '600' }}>{t.logWodMovementsLabel} <span style={{ fontWeight: '400', fontSize: '10px' }}>{t.logWodReorderHint}</span></div>
              <SortableList
                items={editLogMiscari}
                onReorder={setEditLogMiscari}
                onRemove={(i) => setEditLogMiscari(prev => prev.filter((_, j) => j !== i))}
              />
              <MiscareQuickAdd value={editLogMiscareCurenta} onChange={setEditLogMiscareCurenta}
                onAdd={(v) => { setEditLogMiscari(prev => [...prev, v]); setEditLogMiscareCurenta('') }}
                placeholder={t.logWodMovementPlaceholder(userProfile?.weight_unit)}
                weightUnit={userProfile?.weight_unit} t={t} />
            </div>
          ) : logWodStep === 'compose' ? (
            <>
              {variantaAleasa !== null && (
                <div style={{ background: VARIANTE_CONFIG[variantaAleasa].bg, borderRadius: '12px', padding: '12px 14px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>{t.logWodVariantChosen}</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: VARIANTE_CONFIG[variantaAleasa].culoare, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <LevelDot nivel={VARIANTE_CONFIG[variantaAleasa].nivel} /> {VARIANTE_CONFIG[variantaAleasa].nivel}
                    {wodZiData ? ` — ${wodZiData.type} ${formatWodDurata(wodZiData.duration)}` : ''}
                  </div>
                </div>
              )}

              {variantaAleasa === null && (
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <FormatConfigEditor formatId={wodTip} onFormatChange={setWodTip}
                    config={wodFormatConfig} onConfigChange={setWodFormatConfig}
                    excludeConfigKeys={['durationSec', 'timeCapSec']} t={t} />
                  {AUTO_DURATION_FORMAT_IDS.includes(wodTip) ? (
                    <div>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>{t.logWodDurationLabel}</div>
                      <div style={{ padding: '10px 12px', borderRadius: '10px', background: '#f0f0f0', fontSize: '13px', color: '#555' }}>
                        {estimateTotalDurationSec(wodTip, wodFormatConfig) != null
                          ? <>{secToTime(estimateTotalDurationSec(wodTip, wodFormatConfig))} <span style={{ color: '#aaa' }}>({t.adminWodDurationAuto})</span></>
                          : t.adminWodDurationPending}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>{t.logWodDurationLabel}</div>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <div style={{ flex: 1 }}>
                          <input type="number" min="0" value={wodDurataMin} onChange={e => setWodDurataMin(e.target.value)} placeholder="20" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t.adminWodMinutesLabel}</div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <input type="number" min="0" max="59" value={wodDurataSec} onChange={e => setWodDurataSec(e.target.value)} placeholder="0" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                          <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t.adminWodSecondsLabel}</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {variantaAleasa !== null && wodZiData ? (() => {
                const cheie = VARIANTE_CONFIG[variantaAleasa].key
                const miscariWod = wodZiData[cheie] || []
                const miscariAfisate = wodMiscariCustom ?? miscariWod
                return (
                  <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '6px', fontWeight: '600' }}>{dataAcasa === actualToday ? t.logWodTodayLabel : t.logWodDateLabel(new Date(dataAcasa + 'T00:00:00').toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'short' }))}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', marginBottom: describeFormatConfig(wodZiData.type, wodZiData.format_config, t) ? '2px' : '10px' }}>
                      {wodZiData.type} {formatWodDurata(wodZiData.duration)}
                    </div>
                    {describeFormatConfig(wodZiData.type, wodZiData.format_config, t) && (
                      <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px' }}>{describeFormatConfig(wodZiData.type, wodZiData.format_config, t)}</div>
                    )}
                    {miscariAfisate.length > 0 ? (
                      <SortableList
                        items={miscariAfisate}
                        onReorder={setWodMiscariCustom}
                      />
                    ) : (
                      <div style={{ fontSize: '13px', color: '#aaa' }}>{t.logWodNoMovementForVariant}</div>
                    )}
                  </div>
                )
              })() : (
                <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '600' }}>{t.logWodMovementsLabel} <span style={{ fontWeight: '400', fontSize: '10px' }}>{t.logWodReorderHint}</span></div>
                  <SortableList
                    items={wodMiscari}
                    onReorder={setWodMiscari}
                    onRemove={(i) => setWodMiscari(prev => prev.filter((_, j) => j !== i))}
                  />
                  <MiscareQuickAdd value={wodMiscareCurenta} onChange={setWodMiscareCurenta}
                    onAdd={(v) => { setWodMiscari(prev => [...prev, v]); setWodMiscareCurenta('') }}
                    placeholder={t.logWodMovementPlaceholder(userProfile?.weight_unit)}
                    weightUnit={userProfile?.weight_unit} t={t} />
                </div>
              )}
              <button onClick={() => setLogWodStep('score')}
                style={{ width: '100%', padding: '12px', background: '#0E0E0E', color: '#ABE73C', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
                {t.logWodContinueToScoreButton}
              </button>
            </>
          ) : null}

          {(editLogId || logWodStep === 'score') && (
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            {!editLogId && (
              <div onClick={() => setLogWodStep('compose')} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#888', cursor: 'pointer', marginBottom: '14px' }}>
                ← {t.logWodBackToComposeLink}
              </div>
            )}
            <FormatLogger
              formatId={activeLogFormatId}
              config={activeLogFormatConfig}
              movements={miscariPentruLog}
              prescribedWeight={prescribedWeightPentruLog}
              value={{
                result: wodResult, time: wodTime, roundsCompleted: wodRoundsCompleted,
                partialReps: wodPartialReps, sets: wodSets, completed: wodCompleted,
                weightLogged: wodWeightLogged,
              }}
              onChange={(patch) => {
                if ('result' in patch) setWodResult(patch.result)
                if ('time' in patch) setWodTime(patch.time)
                if ('roundsCompleted' in patch) setWodRoundsCompleted(patch.roundsCompleted)
                if ('partialReps' in patch) setWodPartialReps(patch.partialReps)
                if ('sets' in patch) setWodSets(patch.sets)
                if ('completed' in patch) setWodCompleted(patch.completed)
                if ('weightLogged' in patch) setWodWeightLogged(patch.weightLogged)
              }}
              weightUnit={userProfile?.weight_unit || 'kg'} t={t} />
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>{t.logWodNoteLabel}</div>
              <input value={wodNote} onChange={e => setWodNote(e.target.value)} placeholder={t.logWodNotePlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <button onClick={saveWodLog} disabled={wodSaving}
              style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: wodSaving ? 'not-allowed' : 'pointer', opacity: wodSaving ? 0.7 : 1 }}>
              {wodSaving ? t.logWodSaving : editLogId ? t.logWodSaveEdit : t.logWodSaveNew}
            </button>
          </div>
          )}
        </div>
      )}

      {screen === 'logSkill' && (() => {
        const esteSlot2 = skillLogSlot === 2
        const skillTypeCurent = (esteSlot2 ? wodZiData?.skill2_type : wodZiData?.skill_type) || 'Weightlifting'
        const skillMiscariCurente = (esteSlot2 ? wodZiData?.skill2 : wodZiData?.skill) || []
        const skillNameCurent = esteSlot2 ? wodZiData?.skill2_name : wodZiData?.skill_name
        const skillFormatConfigCurent = esteSlot2 ? wodZiData?.skill2_format_config : wodZiData?.skill_format_config
        return (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => setScreen(prevScreen || 'home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#0E0E0E' }}>
              {wodZiData && skillLogs.find(l => l.wod_id === wodZiData.id && (l.slot || 1) === skillLogSlot) ? t.skillLogEditTitle : t.skillLogNewTitle}
              {esteSlot2 ? ` · ${t.homeWodSkill2Title}` : ''}
            </h1>
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            {skillNameCurent && (
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E', marginBottom: '10px' }}>{skillNameCurent}</div>
            )}
            {getFormat(skillTypeCurent).family !== 'sets' && skillMiscariCurente.map((m, mi) => (
              <div key={mi} style={{ fontSize: '13px', color: '#0E0E0E', padding: '3px 0' }}>• {m}</div>
            ))}
            <FormatLogger
              formatId={skillTypeCurent}
              config={skillFormatConfigCurent}
              movements={skillMiscariCurente}
              value={{
                sets: skillLogSets, result: skillLogResult, time: skillLogTime,
                roundsCompleted: skillLogRoundsCompleted, partialReps: skillLogPartialReps, completed: skillLogCompleted,
              }}
              onChange={(patch) => {
                if ('sets' in patch) setSkillLogSets(patch.sets)
                if ('result' in patch) setSkillLogResult(patch.result)
                if ('time' in patch) setSkillLogTime(patch.time)
                if ('roundsCompleted' in patch) setSkillLogRoundsCompleted(patch.roundsCompleted)
                if ('partialReps' in patch) setSkillLogPartialReps(patch.partialReps)
                if ('completed' in patch) setSkillLogCompleted(patch.completed)
              }}
              weightUnit={userProfile?.weight_unit || 'kg'} t={t} />
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>{t.skillLogNoteLabel}</div>
              <input value={skillLogNote} onChange={e => setSkillLogNote(e.target.value)} placeholder={t.skillLogNotePlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
            </div>
            <button onClick={saveSkillLog} disabled={skillLogSaving}
              style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: skillLogSaving ? 'not-allowed' : 'pointer', opacity: skillLogSaving ? 0.7 : 1 }}>
              {skillLogSaving ? t.skillLogSaving : t.skillLogSaveButton}
            </button>
          </div>
          <PrCandidatesConfirm candidates={skillPrCandidates}
            onDismiss={c => setSkillPrCandidates(prev => prev.filter(x => !(x.reps === c.reps && x.movement === c.movement)))}
            onConfirm={confirmSkillPR}
            onDone={() => { setSkillPrCandidates(null); setScreen(prevScreen || 'home') }}
            t={t} />
        </div>
        )
      })()}

      {screen === 'newHeroWod' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => { setEditHeroWodId(null); resetNewHeroWodForm(); setScreen(prevScreen || 'pr') }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#0E0E0E' }}>{editHeroWodId ? t.heroWodEditTitle : t.heroWodNewTitle}</h1>
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px', fontWeight: '600' }}>{t.heroWodNameLabel}</div>
            <input value={newHeroWodName} onChange={e => setNewHeroWodName(e.target.value)} placeholder={t.heroWodNamePlaceholder}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
            <FormatConfigEditor formatId={newHeroWodTip} onFormatChange={setNewHeroWodTip}
              config={newHeroWodFormatConfig} onConfigChange={setNewHeroWodFormatConfig} t={t} />
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '12px' }}>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '10px', fontWeight: '600' }}>{t.heroWodMovementsLabel} <span style={{ fontWeight: '400', fontSize: '10px' }}>{t.heroWodReorderHint}</span></div>
            <SortableList
              items={newHeroWodMiscari}
              onReorder={setNewHeroWodMiscari}
              onRemove={(i) => setNewHeroWodMiscari(prev => prev.filter((_, j) => j !== i))}
            />
            <MiscareQuickAdd value={newHeroWodMiscareCurenta} onChange={setNewHeroWodMiscareCurenta}
              onAdd={(v) => { setNewHeroWodMiscari(prev => [...prev, v]); setNewHeroWodMiscareCurenta('') }}
              placeholder={t.heroWodMovementPlaceholder(userProfile?.weight_unit)}
              weightUnit={userProfile?.weight_unit} t={t} />
          </div>
          <button onClick={saveNewHeroWod} disabled={newHeroWodSaving}
            style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: newHeroWodSaving ? 'not-allowed' : 'pointer', opacity: newHeroWodSaving ? 0.7 : 1 }}>
            {newHeroWodSaving ? t.heroWodSaving : editHeroWodId ? t.heroWodSaveEdit : t.heroWodSaveNew}
          </button>
        </div>
      )}

      {screen === 'logPR' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => { setEditPrId(null); setScreen(prevScreen || 'pr') }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#0E0E0E' }}>{editPrId ? t.prLogEditTitle(miscarePR) : logPentruPR ? t.prLogWithMovementTitle(logPentruPR.movement) : t.prLogNewTitle}</h1>
          </div>
          <div style={{ background: '#fff', borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <CautareMiscare preFill={miscarePR} onAleage={(m) => setMiscarePR(m)} t={t} />
            {miscarePR && (
              <>
                {miscarePR in heroWodsInfoAll ? (
                  <>
                    {isAmrapHeroPr ? (
                      <>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prRoundsCompletedLabel}</div>
                        <input type="number" min="0" value={prRoundsCompleted} onChange={e => setPrRoundsCompleted(e.target.value)} placeholder={t.prRoundsPlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                        {miscariHeroPr.length > 0 && (
                          <div style={{ marginBottom: '12px' }}>
                            <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>{t.prPartialRoundLabel} <span style={{ fontWeight: '400', fontSize: '10px' }}>{t.prPartialRoundHint}</span></div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {miscariHeroPr.map((m, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <div style={{ flex: 1, fontSize: '13px', color: '#0E0E0E' }}>{m}</div>
                                  <input type="number" min="0" value={prPartialReps[i] || ''}
                                    onChange={e => { const v = e.target.value; setPrPartialReps(prev => { const next = [...prev]; next[i] = v; return next }) }}
                                    placeholder="0" style={{ width: '70px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', textAlign: 'center' }} />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prTimeLabel}</div>
                        {(() => {
                          const [tMin, tSec] = prTimp.split(':')
                          return (
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                              <div style={{ flex: 1 }}>
                                <input type="number" min="0" value={tMin || ''} onChange={e => setPrTimp(`${e.target.value}:${tSec || '00'}`)} placeholder="4" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                                <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t.prMinutesLabel}</div>
                              </div>
                              <div style={{ flex: 1 }}>
                                <input type="number" min="0" max="59" value={tSec || ''} onChange={e => setPrTimp(`${tMin || '0'}:${e.target.value}`)} placeholder="22" style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }} />
                                <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px', textAlign: 'center' }}>{t.prSecondsLabel}</div>
                              </div>
                            </div>
                          )
                        })()}
                      </>
                    )}
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prVariantLabel}</div>
                    <select value={prVarianta} onChange={e => setPrVarianta(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }}>
                      <option>RX</option><option>Intermediate</option><option>Beginner</option><option>OnRamp</option>
                    </select>
                  </>
                ) : CARDIO_MISCARI.includes(miscarePR) ? (
                  <>
                    {CARDIO_CU_CALORII.includes(miscarePR) && (
                      <>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prScoreInLabel}</div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                          {[{ val: 'm', label: t.prUnitMeters }, { val: 'cal', label: t.prUnitCalories }].map(o => (
                            <div key={o.val} onClick={() => setPrCardioUnit(o.val)}
                              style={{ flex: 1, padding: '9px', textAlign: 'center', borderRadius: '10px', border: prCardioUnit === o.val ? '2px solid #0E0E0E' : '1px solid #e0e0e0', background: prCardioUnit === o.val ? '#f0f0f0' : '#fafafa', color: prCardioUnit === o.val ? '#0E0E0E' : '#888', fontSize: '13px', fontWeight: prCardioUnit === o.val ? '700' : '400', cursor: 'pointer' }}>
                              {o.label}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prDistanceCaloriesLabel(prCardioUnit)}</div>
                    <input type="number" value={prDistanta} onChange={e => setPrDistanta(e.target.value)} placeholder={t.prDistancePlaceholder(prCardioUnit)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prTimeLabel}</div>
                    <input value={prTimp} onChange={e => setPrTimp(e.target.value)} placeholder={t.prTimePlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                ) : ['Pull-up','Chest to Bar Pull-up','Muscle-up','Toes to Bar','Push-up','Handstand Push-up','Double Under','Box Jump','Pistol Squat','Rope Climb','GHD Sit-up','GHD Back Extension'].includes(miscarePR) ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prMaxRepsLabel}</div>
                    <input type="number" value={prReps} onChange={e => setPrReps(e.target.value)} placeholder={t.prRepsPlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                ) : ['Handstand Hold','L-sit Hold'].includes(miscarePR) ? (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prHoldTimeLabel}</div>
                    <input type="number" value={prValoare} onChange={e => setPrValoare(e.target.value)} placeholder={t.prHoldPlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prWeightLabel(userProfile?.weight_unit || 'kg')}</div>
                    <input type="number" value={prValoare} onChange={e => setPrValoare(e.target.value)} placeholder={t.prWeightPlaceholder(userProfile?.weight_unit)} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                    <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prRepsLabel}</div>
                    <input type="number" value={prReps} onChange={e => setPrReps(e.target.value)} placeholder={t.prRepsFor1rmPlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '12px' }} />
                  </>
                )}
                <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{t.prNoteLabel}</div>
                <input value={prNote} onChange={e => setPrNote(e.target.value)} placeholder={t.prNotePlaceholder} style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box', marginBottom: '14px' }} />
                <button onClick={savePR} disabled={prSaving}
                  style={{ width: '100%', padding: '12px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: '500', cursor: prSaving ? 'not-allowed' : 'pointer', opacity: prSaving ? 0.7 : 1 }}>
                  {prSaving ? t.prSaving : editPrId ? t.prSaveEdit : t.prSaveNew}
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
          WEIGHTLIFTING: { culoare: '#0E0E0E', label: 'WEIGHTLIFTING' },
          GYMNASTICS:    { culoare: '#0E0E0E', label: 'GYMNASTICS' },
          CARDIO:        { culoare: '#0C447C', label: 'CARDIO' },
          HERO_WODS:     { culoare: '#8B1A1A', label: 'HERO WODs' },
        }
        const toateMiscariCategorii = [...PR_CATEGORII.WEIGHTLIFTING, ...PR_CATEGORII.GYMNASTICS, ...PR_CATEGORII.CARDIO, ...heroWodsListAll]
        const miscariFaraCat = Object.keys(prGroups).filter(m => !toateMiscariCategorii.includes(m))
        const preferredUnit = userProfile?.weight_unit || 'kg'
        // Pentru WEIGHTLIFTING, PR-urile se tin separat pe fiecare numar de repetari
        // (1RM, 3RM, 5RM, 15RM etc.) - un 15RM greu nu concureaza cu un 1RM, sunt
        // recorduri independente la aceeasi miscare. Randurile vechi fara reps
        // completat sunt tratate ca 1RM (consistent cu hint-ul din formularul PR).
        const repGroupsFor = (records) => {
          const buckets = {}
          ;(records || []).forEach(r => {
            if (r.unit !== 'kg' && r.unit !== 'lbs') return
            if (r.value == null) return
            const reps = r.reps || 1
            const valKg = convertWeight(parseFloat(r.value), r.unit, preferredUnit)
            if (!buckets[reps] || valKg > buckets[reps].valKg) buckets[reps] = { reps, valKg, record: r }
          })
          return Object.values(buckets).sort((a, b) => a.reps - b.reps)
        }
        const renderMiscare = (movement, idx, total, cat) => {
          const records = prGroups[movement]
          const best = bestPR(records)
          const isOpen = prSelectat === movement
          const repRows = cat === 'WEIGHTLIFTING' ? repGroupsFor(records) : null
          const oneRm = repRows?.find(r => r.reps === 1)
          const collapsedRecord = oneRm ? oneRm.record : best
          const isWeightBest = cat === 'WEIGHTLIFTING' && (best?.unit === 'kg' || best?.unit === 'lbs') && best?.value
          const bestKg = oneRm ? oneRm.valKg : (isWeightBest ? convertWeight(parseFloat(best.value), best.unit, preferredUnit) : null)
          const wodInfo = heroWodsInfoAll[movement]
          const isConfirmingDelete = prConfirmDelete === movement
          return (
            <div key={movement} onClick={() => { setPrSelectat(isOpen ? null : movement); setPrConfirmDelete(null) }}
              style={{ padding: '12px 14px', borderBottom: idx < total - 1 ? '1px solid #f0f0f0' : 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E' }}>{movement}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px', fontWeight: '700', color: collapsedRecord ? '#0E0E0E' : '#ccc' }}>{collapsedRecord ? formatPR(collapsedRecord, preferredUnit) : '—'}</span>
                  <span style={{ fontSize: '11px', color: '#ccc' }}>{isOpen ? '▲' : '▼'}</span>
                  {isConfirmingDelete ? (
                    <button onClick={(e) => { e.stopPropagation(); deleteMiscarePR(movement) }}
                      style={{ fontSize: '11px', fontWeight: '700', color: '#fff', background: '#e53935', border: 'none', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', flexShrink: 0 }}>
                      {t.prDeleteConfirm}
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setPrConfirmDelete(movement) }}
                      style={{ fontSize: '16px', color: '#ccc', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>
                      ×
                    </button>
                  )}
                </div>
              </div>
              {collapsedRecord && !isOpen && (
                <div style={{ fontSize: '10px', color: '#bbb', marginTop: '2px' }}>
                  {new Date(collapsedRecord.recorded_at).toLocaleDateString(localeFor(lang))}{collapsedRecord.notes ? ' · ' + collapsedRecord.notes : ''}
                </div>
              )}
              {!collapsedRecord && !isOpen && wodInfo && (
                <div style={{ fontSize: '10px', color: '#bbb', marginTop: '2px' }}>{wodInfo.split('\n')[0]}</div>
              )}
              {isOpen && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #f0f0f0' }} onClick={e => e.stopPropagation()}>
                  {wodInfo && (
                    <div style={{ marginBottom: '14px', background: '#0E0E0E', borderRadius: '12px', padding: '14px', overflow: 'hidden' }}>
                      {wodInfo.split('\n').map((line, li) => (
                        <div key={li} style={{
                          fontSize: li === 0 ? '11px' : '13px',
                          fontWeight: li === 0 ? '800' : '400',
                          color: li === 0 ? '#ABE73C' : '#e0e0e0',
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
                        const tip = cw.format_type || parseHeroFormat(cw.format || '').tip
                        setEditHeroWodId(cw.id); setNewHeroWodName(cw.name); setNewHeroWodTip(tip); setNewHeroWodFormatConfig(cw.format_config || {})
                        setNewHeroWodMiscari(cw.movements ? cw.movements.split('\n') : []); setNewHeroWodMiscareCurenta('')
                        setPrevScreen('pr'); setScreen('newHeroWod')
                      }}
                      style={{ width: '100%', padding: '8px', background: '#f0f0f0', color: '#0E0E0E', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', marginBottom: '14px' }}>
                      {t.prEditHeroWodButton}
                    </button>
                  )}
                  {bestKg && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '8px' }}>{t.prPercentOf1rm(bestKg, preferredUnit)}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 8px' }}>
                        {PCT_BARA.map(pct => {
                          const w = Math.round(bestKg * pct / 100 * 2) / 2
                          return (
                            <div key={pct} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', background: '#f8f8f8', borderRadius: '8px' }}>
                              <span style={{ fontSize: '11px', color: '#aaa', fontWeight: '600' }}>{pct}%</span>
                              <span style={{ fontSize: '13px', fontWeight: '700', color: '#0E0E0E' }}>{w} {preferredUnit}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {cat === 'WEIGHTLIFTING' && repRows && repRows.length > 0 ? (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '6px' }}>{t.prHistoryLabel}</div>
                      {repRows.map(({ reps, record }) => (
                        <div key={reps}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid #FFFFFF' }}>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>{t.prRepCountLabel(reps)} · {new Date(record.recorded_at).toLocaleDateString(localeFor(lang))}{record.notes ? ' · ' + record.notes : ''}</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '12px', fontWeight: '600', color: '#555' }}>{formatPR(record, preferredUnit)}</span>
                            <button onClick={() => startEditPR(record, movement)}
                              style={{ background: '#f0f0f0', border: 'none', borderRadius: '6px', width: '24px', height: '24px', fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              ✎
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : records && records.length > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '6px' }}>{t.prHistoryLabel}</div>
                      {records.slice(0, 5).map((r, j) => (
                        <div key={j}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', borderBottom: j < Math.min(records.length, 5) - 1 ? '1px solid #FFFFFF' : 'none' }}>
                          <span style={{ fontSize: '11px', color: '#aaa' }}>{new Date(r.recorded_at).toLocaleDateString(localeFor(lang))}{r.notes ? ' · ' + r.notes : ''}</span>
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
                    style={{ width: '100%', padding: '8px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                    {t.prAddNewResult}
                  </button>
                </div>
              )}
            </div>
          )
        }
        return (
          <div style={{ padding: '20px', paddingBottom: '80px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0E0E0E', textTransform: 'uppercase', letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>{t.prScreenTitle} <Trophy size={20} color="#0E0E0E" strokeWidth={2} /></h1>
              <button onClick={() => { setEditPrId(null); setLogPentruPR(null); setMiscarePR(''); setPrValoare(''); setPrReps(''); setPrTimp(''); setPrDistanta(''); setPrCardioUnit('m'); setPrNote(''); setPrevScreen('pr'); setScreen('logPR') }}
                style={{ padding: '8px 14px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}>
                {t.prNewButton}
              </button>
            </div>
            {prDate.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa' }}>
                <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'center' }}><Trophy size={36} color="#ccc" strokeWidth={1.5} /></div>
                <div style={{ fontSize: '14px' }}>{t.prEmpty}</div>
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
                    <div style={{ fontSize: '10px', color: '#bbb', marginRight: '4px' }}>{t.prExercisesCount(miscariCat.length)}</div>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: cfg.culoare, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: cfg.culoare === '#0E0E0E' ? '#ABE73C' : '#fff', flexShrink: 0 }}>
                      {esteOpen ? '▲' : '▼'}
                    </div>
                  </div>
                  {esteOpen && (
                    <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }} onClick={e => e.stopPropagation()}>
                        <input
                          value={catSearch[cat] || ''}
                          onChange={e => setCatSearch(prev => ({ ...prev, [cat]: e.target.value }))}
                          placeholder={t.prSearchPlaceholder(cfg.label)}
                          style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px', border: '1px solid #e0e0e0', fontSize: '13px', background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") no-repeat 10px center #fafafa`, boxSizing: 'border-box', outline: 'none' }}
                        />
                      </div>
                      {miscariAfisate.length === 0
                        ? <div style={{ padding: '20px', textAlign: 'center', fontSize: '13px', color: '#aaa' }}>{t.prNoExerciseFound}</div>
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
              // Cautare obligatorie aici (spre deosebire de celelalte categorii,
              // unde e doar convenabila) - lista de Hero WODs are 200+ intrari
              // (lista oficiala extinsa), imposibil de navigat intr-o lista plata
              // fara filtrare. Reutilizeaza acelasi state catSearch/setCatSearch
              // ca WEIGHTLIFTING/GYMNASTICS/CARDIO, doar cheia difera ('HERO_WODS').
              const heroSearch = (catSearch['HERO_WODS'] || '').toLowerCase()
              const heroAfisate = heroSearch ? toateHero.filter(m => m.toLowerCase().includes(heroSearch)) : toateHero
              return (
                <div style={{ marginBottom: '20px' }}>
                  {/* Header clickabil */}
                  <div onClick={() => { setHeroWodsDeschis(v => !v); setPrSelectat(null) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: heroWodsDeschis ? '8px' : '0', cursor: 'pointer', userSelect: 'none' }}>
                    <div style={{ fontSize: '10px', fontWeight: '800', color: cfg.culoare, letterSpacing: '1.5px' }}>{cfg.label}</div>
                    <div style={{ flex: 1, height: '1px', background: '#e8e8e8' }} />
                    <div style={{ fontSize: '10px', color: '#bbb', marginRight: '4px' }}>{t.prHeroCompletedCount(cuPR, toateHero.length)}</div>
                    <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: cfg.culoare, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', flexShrink: 0 }}>
                      {heroWodsDeschis ? '▲' : '▼'}
                    </div>
                  </div>
                  {heroWodsDeschis && (
                    <div style={{ background: '#fff', borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0' }} onClick={e => e.stopPropagation()}>
                        <input
                          value={catSearch['HERO_WODS'] || ''}
                          onChange={e => setCatSearch(prev => ({ ...prev, HERO_WODS: e.target.value }))}
                          placeholder={t.prSearchPlaceholder(cfg.label)}
                          style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: '8px', border: '1px solid #e0e0e0', fontSize: '13px', background: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23aaa' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E") no-repeat 10px center #fafafa`, boxSizing: 'border-box', outline: 'none' }}
                        />
                      </div>
                      {heroAfisate.length === 0
                        ? <div style={{ padding: '20px', textAlign: 'center', fontSize: '13px', color: '#aaa' }}>{t.prNoExerciseFound}</div>
                        : heroAfisate.map((m, idx) => renderMiscare(m, idx, heroAfisate.length + 1, 'HERO_WODS'))
                      }
                      {/* Linie separator + formular WOD nou */}
                      <div style={{ borderTop: '2px dashed #f0f0f0', padding: '14px' }}>
                        <div style={{ fontSize: '10px', color: '#888', fontWeight: '700', letterSpacing: '0.8px', marginBottom: '8px' }}>{t.prHeroCustomLabel}</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input
                            value={heroWodNouInput}
                            onChange={e => setHeroWodNouInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && heroWodNouInput.trim()) { setNewHeroWodName(heroWodNouInput.trim()); setNewHeroWodTip('AMRAP'); setNewHeroWodFormatConfig({}); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta(''); setPrevScreen('pr'); setScreen('newHeroWod'); setHeroWodNouInput('') }}}
                            placeholder={t.prHeroNewPlaceholder}
                            style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: '1px solid #e0e0e0', fontSize: '13px', background: '#fafafa', boxSizing: 'border-box' }}
                          />
                          <button
                            onClick={() => { if (!heroWodNouInput.trim()) return; setNewHeroWodName(heroWodNouInput.trim()); setNewHeroWodTip('AMRAP'); setNewHeroWodFormatConfig({}); setNewHeroWodMiscari([]); setNewHeroWodMiscareCurenta(''); setPrevScreen('pr'); setScreen('newHeroWod'); setHeroWodNouInput('') }}
                            style={{ padding: '10px 14px', borderRadius: '10px', background: heroWodNouInput.trim() ? '#ABE73C' : '#f0f0f0', color: heroWodNouInput.trim() ? '#0E0E0E' : '#bbb', border: 'none', fontSize: '20px', fontWeight: '700', cursor: heroWodNouInput.trim() ? 'pointer' : 'default', lineHeight: 1, flexShrink: 0 }}>
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
                  <div style={{ fontSize: '10px', fontWeight: '800', color: '#888', letterSpacing: '1.5px' }}>{t.prOthersLabel}</div>
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


      {screen === 'timer' && <Timer onBack={() => setScreen(prevScreen)} defaultFortime={wodZiData ? parseWodMinute(wodZiData.duration) : null} t={t} />}
      {screen === 'clasament' && <Clasament logs={clasamentLogs} loading={clasamentLoading} wodZiData={clasamentWodData} onRefresh={() => fetchClasament(clasamentDate)} selectedDate={clasamentDate} onDateChange={(d) => { setClasamentDate(d); fetchClasament(d) }} t={t} lang={lang} />}
      {screen === 'feed' && <Feed showToast={showToast} user={user} userProfile={userProfile} isAdmin={isAdmin} t={t} lang={lang} />}
      {screen === 'admin' && (isAdmin || isCoach) && <Admin showToast={showToast} user={user} isAdmin={isAdmin} isCoach={isCoach} onWodChanged={() => fetchWodZi(dataAcasaRef.current)} mainScrollRef={mainScrollRef} t={t} lang={lang} />}

      {screen === 'profile' && (
        <div style={{ padding: '20px', paddingBottom: '80px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
            <button onClick={() => setScreen(prevScreen || 'home')} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>←</button>
            <h1 style={{ fontSize: '20px', fontWeight: '600', color: '#0E0E0E' }}>{t.profileTitle}</h1>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '28px' }}>
            <div onClick={() => !avatarUploading && avatarInputRef.current?.click()}
              style={{ width: '84px', height: '84px', borderRadius: '50%', background: '#0E0E0E', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', overflow: 'hidden', position: 'relative' }}>
              {avatarUploading ? (
                <span style={{ fontSize: '20px', color: '#ABE73C', animation: 'spin 1s linear infinite' }}>⏳</span>
              ) : userProfile?.avatar_url ? (
                <img src={userProfile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: '26px', fontWeight: '800', color: '#ABE73C', letterSpacing: '-0.5px' }}>
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
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.profileFirstNameLabel}</div>
                <input value={profileFirstName} onChange={e => setProfileFirstName(e.target.value)}
                  placeholder={t.profileFirstNamePlaceholder}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.profileLastNameLabel}</div>
                <input value={profileLastName} onChange={e => setProfileLastName(e.target.value)}
                  placeholder={t.profileLastNamePlaceholder}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.profileBirthDateLabel}</div>
              <input type="date" value={profileBirthDate} onChange={e => setProfileBirthDate(e.target.value)}
                max={todayLocalStr()}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box', background: '#fff' }} />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.profileGenderLabel}</div>
              <div style={{ display: 'flex', gap: '12px' }}>
                {[{ val: 'masculin', label: '♂', sub: t.profileGenderMale }, { val: 'feminin', label: '♀', sub: t.profileGenderFemale }].map(g => (
                  <div key={g.val} onClick={() => setProfileGender(g.val)}
                    style={{ flex: 1, padding: '16px 14px', borderRadius: '16px', border: `2px solid ${profileGender === g.val ? '#0E0E0E' : '#e0e0e0'}`, background: profileGender === g.val ? '#0E0E0E' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: '22px', marginBottom: '4px', color: profileGender === g.val ? '#ABE73C' : '#888' }}>{g.label}</div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: profileGender === g.val ? '#ABE73C' : '#888' }}>{g.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={saveMyProfile} disabled={profileSaving}
              style={{ width: '100%', padding: '16px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: profileSaving ? 'default' : 'pointer', opacity: profileSaving ? 0.6 : 1 }}>
              {profileSaving ? t.profileSaving : t.profileSaveButton}
            </button>
          </div>

          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#0E0E0E', marginBottom: '4px' }}>{t.profileWeightUnitTitle}</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>{t.profileWeightUnitSubtitle}</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {[{ val: 'kg', label: t.profileWeightUnitKg }, { val: 'lbs', label: t.profileWeightUnitLbs }].map(u => {
                const active = (userProfile?.weight_unit || 'kg') === u.val
                return (
                  <div key={u.val} onClick={() => changeWeightUnit(u.val)}
                    style={{ flex: 1, padding: '16px 14px', borderRadius: '16px', border: `2px solid ${active ? '#0E0E0E' : '#e0e0e0'}`, background: active ? '#0E0E0E' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: active ? '#ABE73C' : '#888', textTransform: 'uppercase' }}>{u.val}</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: active ? '#ABE73C' : '#888', marginTop: '2px' }}>{u.label}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#0E0E0E', marginBottom: '4px' }}>{t.profileLanguageTitle}</div>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '16px' }}>{t.profileLanguageSubtitle}</div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {[{ val: 'ro', label: 'Română' }, { val: 'en', label: 'English' }].map(l => {
                const active = lang === l.val
                return (
                  <div key={l.val} onClick={() => changeLanguage(l.val)}
                    style={{ flex: 1, padding: '16px 14px', borderRadius: '16px', border: `2px solid ${active ? '#0E0E0E' : '#e0e0e0'}`, background: active ? '#0E0E0E' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <div style={{ fontSize: '15px', fontWeight: '800', color: active ? '#ABE73C' : '#888', textTransform: 'uppercase' }}>{l.val}</div>
                    <div style={{ fontSize: '12px', fontWeight: '600', color: active ? '#ABE73C' : '#888', marginTop: '2px' }}>{l.label}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <button onClick={goTimer} style={{ width: '100%', padding: '16px', marginTop: '16px', background: '#0E0E0E', color: '#ABE73C', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <TimerIcon size={18} color="#ABE73C" strokeWidth={2} /> Timer
          </button>

          <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginTop: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#0E0E0E', marginBottom: '16px' }}>{t.profileChangePasswordTitle}</div>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.profileNewPasswordLabel}</div>
              <input value={profileNewPassword} onChange={e => setProfileNewPassword(e.target.value)} type="password" placeholder={t.profileNewPasswordPlaceholder}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: '18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.profileConfirmPasswordLabel}</div>
              <input value={profileNewPasswordConfirm} onChange={e => setProfileNewPasswordConfirm(e.target.value)} type="password" placeholder={t.profileConfirmPasswordPlaceholder}
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box' }} />
            </div>
            <button onClick={changeMyPassword} disabled={passwordSaving}
              style={{ width: '100%', padding: '16px', background: '#0E0E0E', color: '#fff', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: passwordSaving ? 'default' : 'pointer', opacity: passwordSaving ? 0.6 : 1 }}>
              {passwordSaving ? t.profileSaving : t.profileChangePasswordButton}
            </button>
          </div>

          <button onClick={handleLogout} style={{ width: '100%', padding: '14px', marginTop: '16px', background: 'none', border: 'none', fontSize: '13px', color: '#aaa', cursor: 'pointer', textAlign: 'center' }}>
            {t.profileLogout}
          </button>
        </div>
      )}

      </div>

      {showCalPicker && (() => {
        const _now2 = new Date(); const todayStr = `${_now2.getFullYear()}-${String(_now2.getMonth()+1).padStart(2,'0')}-${String(_now2.getDate()).padStart(2,'0')}`
        const numeLunaCalendar = new Intl.DateTimeFormat(localeFor(lang), { month: 'long' }).format(new Date(calPickerYear, calPickerMonth, 1))
        const ziuaLitereCalendar = lang === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['L', 'Ma', 'Mi', 'J', 'V', 'S', 'D']
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
                <span style={{ fontSize: '15px', fontWeight: '800', color: '#0E0E0E', letterSpacing: '0.02em' }}>
                  {numeLunaCalendar.toUpperCase()} {calPickerYear}
                </span>
                <span onClick={nextLuna} style={{ fontSize: '22px', cursor: 'pointer', color: '#888', padding: '2px 10px', userSelect: 'none' }}>›</span>
              </div>
              {/* Zile header */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '6px' }}>
                {ziuaLitereCalendar.map((z, zi) => (
                  <div key={zi} style={{ textAlign: 'center', fontSize: '10px', fontWeight: '700', color: '#bbb', paddingBottom: '4px' }}>{z}</div>
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
                        background: selectat ? '#0E0E0E' : 'transparent',
                        border: selectat ? 'none' : esteAzi ? '2px solid #0E0E0E' : 'none' }}>
                      <span style={{ fontSize: '14px', fontWeight: selectat || esteAzi ? '800' : '400', color: selectat ? '#ABE73C' : '#0E0E0E', lineHeight: 1 }}>{d.getDate()}</span>
                      {(areWod || areRez) && <span style={{ fontSize: '7px', color: areRez ? '#0E0E0E' : '#ABE73C', lineHeight: 1, marginTop: '1px' }}>{areRez ? '✓' : '⚡'}</span>}
                    </div>
                  )
                })}
              </div>
              {/* Buton azi */}
              <div onClick={() => { setDataAcasa(todayStr); setShowCalPicker(false); scrollChipToDate(todayStr) }}
                style={{ marginTop: '14px', textAlign: 'center', fontSize: '12px', fontWeight: '600', color: '#0E0E0E', cursor: 'pointer', padding: '8px', background: '#f0f0f0', borderRadius: '10px' }}>
                {t.calPickerGoToToday}
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
                <div key={s} style={{ width: s === onboardingStep ? '24px' : '8px', height: '8px', borderRadius: '4px', background: s <= onboardingStep ? '#0E0E0E' : '#e0e0e0', transition: 'all 0.2s' }} />
              ))}
            </div>

            {/* PASUL 1 — Date personale */}
            {onboardingStep === 1 && (
              <>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0E0E0E', marginBottom: '4px' }}>{t.onboardingWelcome}</div>
                <div style={{ fontSize: '14px', color: '#888', marginBottom: '24px' }}>{t.onboardingStep1Subtitle}</div>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.onboardingFirstNameLabel}</div>
                    <input value={onboardingFirstName} onChange={e => setOnboardingFirstName(e.target.value)}
                      placeholder={t.onboardingFirstNamePlaceholder}
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.onboardingLastNameLabel}</div>
                    <input value={onboardingLastName} onChange={e => setOnboardingLastName(e.target.value)}
                      placeholder={t.onboardingLastNamePlaceholder}
                      style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box' }} />
                  </div>
                </div>
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#888', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>{t.onboardingBirthDateLabel}</div>
                  <input type="date" value={onboardingBirthDate} onChange={e => setOnboardingBirthDate(e.target.value)}
                    max={todayLocalStr()}
                    style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1.5px solid #e0e0e0', fontSize: '15px', outline: 'none', color: '#0E0E0E', boxSizing: 'border-box', background: '#fff' }} />
                </div>
                <button onClick={() => { if (!onboardingFirstName.trim() || !onboardingLastName.trim() || !onboardingBirthDate) { showToast(t.onboardingFillRequired); return }; setOnboardingStep(2) }}
                  style={{ width: '100%', padding: '16px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '16px', fontSize: '16px', fontWeight: '800', cursor: 'pointer' }}>
                  {t.onboardingContinue}
                </button>
              </>
            )}

            {/* PASUL 2 — Gen */}
            {onboardingStep === 2 && (
              <>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0E0E0E', marginBottom: '4px' }}>{t.onboardingGenderTitle}</div>
                <div style={{ fontSize: '14px', color: '#888', marginBottom: '28px' }}>{t.onboardingGenderSubtitle}</div>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '28px' }}>
                  {[{ val: 'masculin', label: '♂', sub: t.onboardingGenderMale }, { val: 'feminin', label: '♀', sub: t.onboardingGenderFemale }].map(g => (
                    <div key={g.val} onClick={() => setOnboardingGender(g.val)}
                      style={{ flex: 1, padding: '20px 14px', borderRadius: '16px', border: `2px solid ${onboardingGender === g.val ? '#0E0E0E' : '#e0e0e0'}`, background: onboardingGender === g.val ? '#0E0E0E' : '#fafafa', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: '28px', marginBottom: '6px', color: onboardingGender === g.val ? '#ABE73C' : '#888' }}>{g.label}</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: onboardingGender === g.val ? '#ABE73C' : '#888' }}>{g.sub}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setOnboardingStep(1)}
                    style={{ flex: 1, padding: '14px', background: '#FFFFFF', color: '#888', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>{t.onboardingBack}</button>
                  <button onClick={() => { if (!onboardingGender) { showToast(t.onboardingSelectGender); return }; setOnboardingStep(3) }}
                    style={{ flex: 2, padding: '14px', background: '#ABE73C', color: '#0E0E0E', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '800', cursor: 'pointer' }}>{t.onboardingContinue}</button>
                </div>
              </>
            )}

            {/* PASUL 3 — Waiver */}
            {onboardingStep === 3 && (
              <>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#0E0E0E', marginBottom: '4px' }}>
                  {onboardingFirstName && onboardingGender ? t.onboardingWaiverRenewalTitle(new Date().getFullYear()) : t.onboardingWaiverTitle}
                </div>
                <div style={{ fontSize: '13px', color: '#888', marginBottom: '14px' }}>
                  {onboardingFirstName && onboardingGender ? t.onboardingWaiverRenewalSubtitle : t.onboardingWaiverSubtitle}
                </div>
                <div style={{ background: '#f8f8f8', borderRadius: '14px', padding: '14px 16px', marginBottom: '16px', maxHeight: '220px', overflowY: 'auto', fontSize: '12px', color: '#444', lineHeight: '1.7' }}>
                  <div style={{ fontSize: '11px', fontWeight: '800', color: '#0E0E0E', letterSpacing: '0.5px', marginBottom: '10px' }}>{t.onboardingWaiverHeading}</div>
                  <p style={{ marginBottom: '8px' }}><strong>{t.onboardingWaiver1Title}</strong><br />{t.onboardingWaiver1Text}</p>
                  <p style={{ marginBottom: '8px' }}><strong>{t.onboardingWaiver2Title}</strong><br />{t.onboardingWaiver2Text}</p>
                  <p style={{ marginBottom: '8px' }}><strong>{t.onboardingWaiver3Title}</strong><br />{t.onboardingWaiver3Text}</p>
                  <p style={{ marginBottom: '8px' }}><strong>{t.onboardingWaiver4Title}</strong><br />{t.onboardingWaiver4Text}</p>
                  <p><strong>{t.onboardingWaiver5Title}</strong><br />{t.onboardingWaiver5Text}</p>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '20px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={onboardingWaiverAccepted} onChange={e => setOnboardingWaiverAccepted(e.target.checked)}
                    style={{ width: '20px', height: '20px', marginTop: '1px', accentColor: '#0E0E0E', flexShrink: 0, cursor: 'pointer' }} />
                  <span style={{ fontSize: '13px', color: '#0E0E0E', lineHeight: '1.5' }}>{t.onboardingWaiverCheckbox}</span>
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setOnboardingStep(2)}
                    style={{ flex: 1, padding: '14px', background: '#FFFFFF', color: '#888', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>{t.onboardingBack}</button>
                  <button onClick={saveOnboarding} disabled={!onboardingWaiverAccepted}
                    style={{ flex: 2, padding: '14px', background: onboardingWaiverAccepted ? '#ABE73C' : '#e0e0e0', color: onboardingWaiverAccepted ? '#0E0E0E' : '#aaa', border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: '800', cursor: onboardingWaiverAccepted ? 'pointer' : 'default' }}>
                    {t.onboardingConfirm}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: '90px', left: '50%', transform: 'translateX(-50%)', background: '#0E0E0E', color: '#fff', padding: '10px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: '500', zIndex: 300, maxWidth: '90vw', textAlign: 'center', wordBreak: 'break-word' }}>
          {toast}
        </div>
      )}

      <NavBar screen={screen} setScreen={setScreen} isAdmin={isAdmin} isCoach={isCoach} feedUnread={feedUnread} t={t} />
    </div>
  )
}

export default function AppWithBoundary() {
  return <ErrorBoundary><App /></ErrorBoundary>
}


