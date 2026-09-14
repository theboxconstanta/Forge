// FORGE WORKOUT COMPOSER - PHASE 3.2 (member WOD display).
//
// Renders a Composer-authored variant's canonical components[] for the
// MEMBER-facing Home WOD card - a read-only prescription view, never an
// editor (composerAuthoring.jsx is the Builder-side authoring UI; this file
// has no dependency on it and no editing affordances at all).
//
// CORE INVARIANT (ticket §1) - member prescription display != scoring
// component display. Every canonical component renders, in canonical
// order, regardless of producesScore/scoreOwnerId - those fields govern
// RESULT semantics (Phase 2/2.1), never prescription visibility. This file
// never filters, reorders, or selects a "primary" component.
//
// Reuses previewBlocksFromComponents (componentContract.js) - the SAME
// pure projection the Builder Preview calls - so the member's component
// order/content can never diverge from what the coach sees while authoring
// (ticket §20). Only the `gender` passed to it differs (the athlete's own
// gender here, vs gender-neutral in the Builder).

import { previewBlocksFromComponents } from './componentContract'

/** `components`: the variant's canonical components[] (2+ entries - the
 * caller only renders this for a genuine multi-component graph; a single-
 * component/legacy workout keeps using the existing WorkoutFormatHeader
 * path unchanged, ticket §19). `gender`: 'male'|'female'|null
 * (memberGenderKey/activeAthleteGenderKey, App.jsx - never re-derived
 * here). `t`: translation table, for componentSecondaryTiming's "Time cap"
 * label. */
export default function MemberComposerPrescription({ components, gender, t }) {
  const blocks = previewBlocksFromComponents(components, { gender, t })
  if (blocks.length === 0) return null
  return (
    <div>
      {blocks.map((b, i) => (
        <div key={b.id} style={{ marginTop: i === 0 ? 0 : '16px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: '12px', rowGap: '2px' }}>
            <span style={{ fontSize: '15px', fontWeight: '600', lineHeight: 1.4, color: '#0E0E0E' }}>{b.header}</span>
            {b.secondary && (
              <span style={{ fontSize: '14px', fontWeight: '600', lineHeight: 1.4, color: '#EF4444', flexShrink: 0 }}>
                {b.secondary.label ? `${b.secondary.label} ${b.secondary.value}` : b.secondary.value}
              </span>
            )}
          </div>
          {b.movementLines.length > 0 && (
            <div style={{ marginTop: '6px' }}>
              {b.movementLines.map((line, li) => (
                <div key={li} style={{ paddingTop: '4px', paddingBottom: li < b.movementLines.length - 1 ? '8px' : '4px', fontSize: '15px', color: '#0E0E0E', lineHeight: '1.6' }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
