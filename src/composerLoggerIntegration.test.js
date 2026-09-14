// FORGE WORKOUT COMPOSER - PHASE 3, ticket §53: "authoring output must be
// consumable by the Phase 2/2.1 runtime." Integration test (not a live UI/DB
// wiring change - explicitly not required, "at minimum integration-test"):
// author canonical components via the SAME Phase 3 authoring helpers a coach
// would use -> save (legacyPayloadFromSections) -> simulate Postgres JSONB
// storage/retrieval (JSON round-trip, same technique as Phase 2.1) -> reopen
// (sectionsFromLegacyWod) -> feed the reloaded components[] into the REAL
// Phase 1/2.1 domain functions (getAllScoreEnvelopes/composeComponentsLogFields)
// and assert the exact native-scorer counts the ticket requires.

import { describe, it, expect } from 'vitest'
import { createSection, legacyPayloadFromSections, sectionsFromLegacyWod } from './wodSections'
import {
  addComponentToList, setScoreOwner, getAllScoreEnvelopes, composeComponentsLogFields,
} from './componentContract'

function authorAndReload(buildComponents) {
  const primary = createSection('metcon', true)
  primary.variants.rx.components = buildComponents()
  const payload = legacyPayloadFromSections([primary])
  const roundTripped = JSON.parse(JSON.stringify(payload))
  const w = { id: 'w-logger-integration', date: '2026-01-01', ...roundTripped }
  const reopened = sectionsFromLegacyWod(w)
  return reopened.find(s => s.isPrimary).variants.rx.components
}

function addMovement(components, componentId, name) {
  return components.map(c => (c.id === componentId ? { ...c, instances: [...c.instances, { instanceId: `mi_${name}`, name }] } : c))
}

describe('Composer authoring output reaches the Phase 2.1 runtime (ticket §53)', () => {
  it('Buy-In -> RFT -> Cash-Out authored, saved and reloaded -> exactly 1 native result', () => {
    const components = authorAndReload(() => {
      let c = addComponentToList([], 'Once', 'buy-in')
      c = addMovement(c, c[0].id, '1000m Row')
      c = addComponentToList(c, 'RFT')
      c[1].config = { rounds: 5 }
      c = addMovement(c, c[1].id, 'Toes-to-Bar')
      c = addComponentToList(c, 'Once', 'cash-out')
      c = addMovement(c, c[2].id, '800m Run')
      c = setScoreOwner(c, c[0].id, c[1].id).components
      c = setScoreOwner(c, c[2].id, c[1].id).components
      return c
    })

    const envelopes = getAllScoreEnvelopes(components)
    expect(Object.keys(envelopes)).toHaveLength(1) // one scoring envelope

    const scorer = components.find(c => c.producesScore)
    const inputsById = { [scorer.id]: { finishedValue: '12:34', movementLines: ['5 Toes-to-Bar'] } }
    const logFields = composeComponentsLogFields(components, inputsById)
    expect(logFields.log_meta).toBe(null) // legacy single-score equivalence - one native result, no multi-envelope payload
    expect(logFields.time_result).toBe('12:34')
  })

  it('AMRAP + Rest + RFT authored, saved and reloaded -> exactly 2 independent native results', () => {
    const components = authorAndReload(() => {
      let c = addComponentToList([], 'AMRAP')
      c[0].config = { durationSec: 480 }
      c = addMovement(c, c[0].id, 'Pull-Ups')
      c = addComponentToList(c, 'Rest')
      c[1].config = { durationSec: 120 }
      c = addComponentToList(c, 'RFT')
      c[2].config = { rounds: 5 }
      c = addMovement(c, c[2].id, 'Wall Balls')
      return c
    })

    const scorers = components.filter(c => c.producesScore)
    expect(scorers).toHaveLength(2)
    const rest = components.find(c => c.format === 'Rest')
    expect(rest.producesScore).toBe(false)
    expect(rest.scoreOwnerId).toBe(null)

    const inputsById = {
      [scorers[0].id]: { roundsCompleted: '6', partialReps: [], movementLines: ['Pull-Ups'] },
      [scorers[1].id]: { finishedValue: '15:00', movementLines: ['Wall Balls'] },
    }
    const logFields = composeComponentsLogFields(components, inputsById)
    expect(logFields.log_meta.componentResults).toBeDefined()
    expect(Object.keys(logFields.log_meta.componentResults)).toHaveLength(2)
    expect(logFields.result).toBe(null) // no primary component - both scalars stay null
    expect(logFields.time_result).toBe(null)
  })

  it('AMRAP + Rest + RFT + Rest + EMOM authored, saved and reloaded -> exactly 3 independent native results', () => {
    const components = authorAndReload(() => {
      let c = addComponentToList([], 'AMRAP')
      c[0].config = { durationSec: 480 }
      c = addComponentToList(c, 'Rest')
      c = addComponentToList(c, 'RFT')
      c[2].config = { rounds: 5 }
      c = addComponentToList(c, 'Rest')
      c = addComponentToList(c, 'EMOM')
      c[4].config = { totalRounds: 8, intervalSec: 60 }
      return c
    })

    const scorers = components.filter(c => c.producesScore)
    expect(scorers).toHaveLength(3)
    expect(components.filter(c => c.format === 'Rest')).toHaveLength(2)

    const inputsById = Object.fromEntries(scorers.map(s => [s.id, { finishedValue: '10:00' }]))
    const logFields = composeComponentsLogFields(components, inputsById)
    expect(Object.keys(logFields.log_meta.componentResults)).toHaveLength(3)
    // No primary component ever introduced - every scorer's key is present,
    // none overwritten by another (Phase 2.1's contract, re-verified here
    // against Phase 3's OWN authored+reloaded data, not just a hand-built
    // fixture).
    scorers.forEach(s => expect(logFields.log_meta.componentResults[s.id]).toBeDefined())
  })
})
