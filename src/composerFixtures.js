// FORGE WORKOUT COMPOSER - Phase 1 golden fixtures (ticket §31).
//
// Deterministic (fixed ids, no crypto-random) canonical `components[]`
// fixtures for later Builder/logger/leaderboard phases to reuse - plain
// data, no React. These represent patterns the CURRENT legacy model cannot
// fully express (Fixture B/D's "Buy-In then N-round-for-time then Cash-Out"
// has no legacy equivalent - 'Buy-In/Cash-Out' only ever supports a plain
// AMRAP or sequential main work, never repeated rounds, per the Phase 0.2
// forensic finding) - they are authored directly in the canonical shape a
// future Builder will produce, not derived via the legacy adapter.

import { newMovementInstance } from './prescriptionContract'
import { createComponent, normalizeComponentOrder } from './componentContract'

function inst(name) {
  return newMovementInstance({ name })
}

// FIXTURE A - SIMPLE: AMRAP 10 / 10 Pull-Ups / 10 Burpees. A single
// producesScore:true component, no envelope, no Rest - the overwhelming
// common case. Must remain exactly this simple (ticket §8/§16).
export function fixtureA_simpleAmrap() {
  return normalizeComponentOrder([
    createComponent({
      id: 'fixA-amrap', format: 'AMRAP', producesScore: true,
      config: { durationSec: 600 },
      instances: [inst('Pull-Ups'), inst('Burpees')],
    }),
  ])
}

// FIXTURE B - ONE ENVELOPE: Buy-In (1000m Row) -> 5 RFT (10 TTB, 15 Wall
// Balls) -> Cash-Out (800m Run). ONE scoring component (the RFT); Buy-In and
// Cash-Out are producesScore:false and scoreOwnerId-owned by it.
export function fixtureB_oneEnvelope() {
  const rft = createComponent({
    id: 'fixB-rft', format: 'RFT', role: 'main', producesScore: true,
    config: { rounds: 5 },
    instances: [inst('Toes-to-Bar'), inst('Wall Balls')],
  })
  const buyIn = createComponent({
    id: 'fixB-buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: rft.id,
    instances: [inst('1000m Row')],
  })
  const cashOut = createComponent({
    id: 'fixB-cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: rft.id,
    instances: [inst('800m Run')],
  })
  return normalizeComponentOrder([buyIn, rft, cashOut])
}

// FIXTURE C - MULTI SCORE: AMRAP 8 + REST 2:00 + 5 RFT. TWO independent
// producesScore:true components; Rest belongs to neither envelope.
export function fixtureC_multiScore() {
  const amrap = createComponent({
    id: 'fixC-amrap', format: 'AMRAP', producesScore: true,
    config: { durationSec: 480 },
    instances: [inst('DB Snatches'), inst('Burpees')],
  })
  const rest = createComponent({
    id: 'fixC-rest', format: 'Rest', producesScore: false,
    config: { durationSec: 120 },
    instances: [],
  })
  const rft = createComponent({
    id: 'fixC-rft', format: 'RFT', producesScore: true,
    config: { rounds: 5 },
    instances: [inst('DB Snatches'), inst('Box Jumps')],
  })
  return normalizeComponentOrder([amrap, rest, rft])
}

// FIXTURE D - COMPLEX COMPOSER: Buy-In(500m Row) -> 5RFT -> Cash-Out(400m
// Run) [one envelope] -> Rest 2:00 -> AMRAP 6 -> Rest 1:00 -> EMOM 8. Three
// independent scoring components (the envelope's RFT, the AMRAP, the EMOM);
// two Rest components belong to no envelope.
export function fixtureD_complexComposer() {
  const rft = createComponent({
    id: 'fixD-rft', format: 'RFT', role: 'main', producesScore: true,
    config: { rounds: 5 },
    instances: [inst('Toes-to-Bar'), inst('Wall Balls')],
  })
  const buyIn = createComponent({
    id: 'fixD-buyin', format: 'Once', role: 'buy-in', producesScore: false, scoreOwnerId: rft.id,
    instances: [inst('500m Row')],
  })
  const cashOut = createComponent({
    id: 'fixD-cashout', format: 'Once', role: 'cash-out', producesScore: false, scoreOwnerId: rft.id,
    instances: [inst('400m Run')],
  })
  const rest1 = createComponent({ id: 'fixD-rest1', format: 'Rest', producesScore: false, config: { durationSec: 120 }, instances: [] })
  const amrap = createComponent({
    id: 'fixD-amrap', format: 'AMRAP', producesScore: true,
    config: { durationSec: 360 },
    instances: [inst('Clean & Jerks'), inst('Burpees')],
  })
  const rest2 = createComponent({ id: 'fixD-rest2', format: 'Rest', producesScore: false, config: { durationSec: 60 }, instances: [] })
  const emom = createComponent({
    id: 'fixD-emom', format: 'EMOM', producesScore: true,
    config: { totalRounds: 8, intervalSec: 60 },
    instances: [inst('Bike Calories'), inst('Pull-Ups')],
  })
  return normalizeComponentOrder([buyIn, rft, cashOut, rest1, amrap, rest2, emom])
}
