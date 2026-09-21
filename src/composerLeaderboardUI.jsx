// FORGE WORKOUT COMPOSER - MULTI-PART SCORING TICKET, Part 14 (leaderboard
// UI). Renders the dynamic OVERALL/PART A/PART B/... tabs for a section
// whose logs carry `log_meta.componentResults` (2+ scored Composer
// components) - the ONLY new leaderboard surface this ticket adds. Every
// existing single-scorer/legacy leaderboard card (App.jsx's Clasament) is
// completely untouched; this component is an ADDITIVE alternative,
// rendered instead of the old weightGroups block ONLY when the section
// actually is Composer-multi-part-shaped (App.jsx decides that, via
// componentLeaderboard.js's own logHasComponentResults + a 2+-scorer
// componentsSnapshot - ticket's own "exactly 1 scored component -> preserve
// current UI exactly" rule).
//
// Reuses the SAME visual tokens the existing card already uses (LevelDot,
// COLORS.ranking gold/silver/bronze, the profile.full_name/email name
// fallback) - never a redesign, just a new data source (per-component/
// Overall competition ranks) feeding the same visual language.

import { useState } from 'react'
import { COLORS } from './theme'
import { LevelDot } from './components'
import { rankComponentAcrossLogs, computeOverallPlacements, partTabLabel } from './componentLeaderboard'
import LeaderboardSocialSummary from './leaderboardSocialUI'

function nameOf(profile, t) {
  return profile?.full_name || profile?.email?.split('@')[0] || t?.clasamentAnonymous || 'Anonymous'
}

function medalColor(rank) {
  return rank === 1 ? COLORS.ranking.gold : rank === 2 ? COLORS.ranking.silver : rank === 3 ? COLORS.ranking.bronze : '#888'
}

/** One component's own native result -> the SAME text convention its
 * format already uses elsewhere (time_result verbatim, capped/rounds text
 * verbatim, load_result + the poster's own kg/lb suffix - the identical
 * profile.weight_unit-driven convention sectionValueForMember/
 * setsScoreUnitSuffix already rely on, never a new unit source). */
function formatComponentScoreText(entry, weightUnit) {
  if (!entry) return '—'
  if (entry.load_result != null) return `${entry.load_result} ${weightUnit === 'lbs' ? 'lb' : 'kg'}`
  if (entry.time_result) return entry.time_result
  if (entry.result) return entry.result
  return '—'
}

function RankedRow({ rank, name, scoreText, borderColor, logId, social }) {
  return (
    <div id={logId ? `leaderboard-card-${logId}` : undefined}
      style={{ background: '#fff', borderRadius: '10px', borderLeft: `3px solid ${borderColor}`, marginBottom: '6px', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ width: '24px', fontSize: '13px', fontWeight: '700', color: medalColor(rank), textAlign: 'center', flexShrink: 0 }}>{rank}</div>
        <div style={{ flex: 1, fontSize: '13px', fontWeight: '500', color: '#0E0E0E' }}>{name}</div>
        <div style={{ fontSize: '13px', fontWeight: '600', color: '#0E0E0E' }}>{scoreText}</div>
      </div>
      {/* MULTI-PART / LIFECYCLE (owner decision §5) - Overall/Part A/Part B
          all key on the SAME wod_logs.id, so the same interaction set shows
          identically across every tab, not a separate one per tab. LEADERBOARD
          ACTIVITY V1 - deep-link works the same way here as the legacy card
          (id + autoOpen), so a comment notification navigates correctly even
          when the target log is Composer multi-part. */}
      {logId && social && (
        <LeaderboardSocialSummary
          logId={logId}
          summary={social.reactionsByLog?.[logId]}
          reactorRows={social.reactorRowsByLog?.[logId]}
          commentCount={social.commentCountByLog?.[logId] || 0}
          onReactionTap={(emoji) => social.onToggleReaction(logId, emoji)}
          onCommentCountChange={(delta) => social.onCommentCountChange(logId, delta)}
          user={social.user} gymId={social.gymId} isCoachOrAdmin={social.isCoachOrAdmin} showToast={social.showToast} t={social.t}
          autoOpen={social.focusTarget?.kind === 'comment' && social.focusTarget?.logId === logId}
        />
      )}
    </div>
  )
}

function IncompleteRow({ name, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#fafafa', borderRadius: '10px', marginBottom: '6px' }}>
      <div style={{ width: '24px', fontSize: '13px', color: '#ccc', textAlign: 'center', flexShrink: 0 }}>—</div>
      <div style={{ flex: 1, fontSize: '13px', fontWeight: '500', color: '#aaa' }}>{name}</div>
      <div style={{ fontSize: '11px', fontWeight: '600', color: '#ccc', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t?.clasamentIncompleteLabel || 'Incomplete'}</div>
    </div>
  )
}

function TierHeader({ nivel, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
      <div style={{ background: nivel.bg, borderRadius: '10px', padding: '4px 12px', fontSize: '12px', fontWeight: '600', lineHeight: 1.3, color: nivel.culoare, letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <LevelDot nivel={nivel.id} /> {nivel.id}
      </div>
      <div style={{ fontSize: '12px', color: COLORS.text.muted, fontWeight: '500', lineHeight: 1.35 }}>{count}</div>
    </div>
  )
}

/** `scorers` - the section's scored components, canonical order (from a
 * representative log's frozen componentsSnapshot, via
 * getOrderedScoreEnvelopes). `nivele` - the existing NIVELE array (RX/
 * Intermediate/Beginner/OnRamp). `logsUnicePerMembru` - already deduped-
 * latest-per-member logs for this section (the SAME array
 * buildBlocksForPrimary already computes before its own per-tier split) -
 * this component does its OWN per-tier filtering by `variant_level`,
 * mirroring getSectionLogsForTier exactly, so Rx/Scaled/Mixed never mix
 * into one ranking pool (ticket §13). No separate "Mixed Categories" bucket
 * here - Composer multi-part scoring stays whole-log-variant-scoped only
 * (ticket §13 - "no per-scorer prescription schema"), a deliberate,
 * disclosed simplification versus the legacy single-score Mixed bucket. */
export default function ComposerPartLeaderboard({
  scorers, nivele, logsUnicePerMembru, t,
  reactionsByLog, reactorRowsByLog, commentCountByLog, onToggleReaction, onCommentCountChange,
  user, gymId, isCoachOrAdmin, showToast, focusTarget,
}) {
  const [tab, setTab] = useState('overall')
  const tabs = [{ id: 'overall', label: t?.clasamentOverallLabel || 'OVERALL' }, ...(scorers || []).map((s, i) => ({ id: s.id, label: partTabLabel(s, i) }))]
  const activeScorer = tab === 'overall' ? null : (scorers || []).find(s => s.id === tab)
  const social = onToggleReaction ? { reactionsByLog, reactorRowsByLog, commentCountByLog, onToggleReaction, onCommentCountChange, user, gymId, isCoachOrAdmin, showToast, t, focusTarget } : null

  const tierBlocks = (nivele || []).map(nivel => {
    const tierLogs = (logsUnicePerMembru || []).filter(l => l.variant_level === nivel.id)
    if (tierLogs.length === 0) return null
    const logsByMember = tierLogs.map(log => ({ memberId: log.member_id, log, profile: log.profile }))

    if (tab === 'overall') {
      const { ranked, incomplete } = computeOverallPlacements(scorers, logsByMember)
      if (ranked.length === 0 && incomplete.length === 0) return null
      return (
        <div key={nivel.id} style={{ marginBottom: '20px' }}>
          <TierHeader nivel={nivel} count={ranked.length + incomplete.length} t={t} />
          {ranked.map(r => (
            <RankedRow key={r.memberId} rank={r.rank} name={nameOf(r.profile, t)}
              scoreText={t?.clasamentPointsLabel ? t.clasamentPointsLabel(r.points) : `${r.points} pts`} borderColor={nivel.culoare}
              logId={r.logId} social={social} />
          ))}
          {incomplete.map(r => <IncompleteRow key={r.memberId} name={nameOf(r.profile, t)} t={t} />)}
        </div>
      )
    }

    if (!activeScorer) return null
    const ranked = rankComponentAcrossLogs(activeScorer, logsByMember)
    if (ranked.length === 0) return null
    return (
      <div key={nivel.id} style={{ marginBottom: '20px' }}>
        <TierHeader nivel={nivel} count={ranked.length} t={t} />
        {ranked.filter(r => r.rank != null).map(r => (
          <RankedRow key={r.memberId} rank={r.rank} name={nameOf(r.profile, t)}
            scoreText={formatComponentScoreText(r.entry, r.profile?.weight_unit)} borderColor={nivel.culoare}
            logId={r.log?.id} social={social} />
        ))}
        {ranked.filter(r => r.rank == null).map(r => <IncompleteRow key={r.memberId} name={nameOf(r.profile, t)} t={t} />)}
      </div>
    )
  }).filter(Boolean)

  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {tabs.map(tb => (
          <div key={tb.id} onClick={() => setTab(tb.id)} role="tab" aria-selected={tab === tb.id}
            style={{ padding: '6px 14px', borderRadius: '16px', cursor: 'pointer', fontSize: '11px', fontWeight: tab === tb.id ? '700' : '500', background: tab === tb.id ? '#0E0E0E' : '#f0f0f0', color: tab === tb.id ? '#fff' : '#888' }}>
            {tb.label}
          </div>
        ))}
      </div>
      {tierBlocks.length > 0 ? tierBlocks : (
        <div style={{ fontSize: '12px', lineHeight: 1.35, color: '#bbb' }}>{t?.clasamentSectionEmptyLabel || 'No results yet for this section'}</div>
      )}
    </div>
  )
}
