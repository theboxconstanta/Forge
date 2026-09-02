// P11.4 — DETERMINISTIC learning-hint SELECTOR + SERIALIZER.
//
// Consumes P11.3 read models (the jsonb `p11_3_retrieve_impl` returns) and
// produces (a) whitelisted machine hint objects for provenance and (b) a
// bounded, factual, non-normative prompt fragment for ACTIVE mode.
//
// SELECTION (owner decision D4 — no exception):
//   strength = supported  AND  distinctRunCount >= 3  AND  conflictState = CONSISTENT
//   AND matchLevel exact-only (strongContextCount = 0 AND broaderContextCount = 0)
//   AND taxonomy in the ACTIVE allowlist.
//   observation_only / weak / MIXED / CONFLICTING / strong / broad / ambiguous
//   are NEVER selected.
//
// ACTIVE allowlist (v1): LOAD, VARIANT_COMPLETION, and STRUCTURE *only when the
// raw input literally declared the canonical structure*. Everything else is
// SHADOW-diagnostic only.
//
// SERIALIZATION: fixed sentence templates with numeric / enum / catalog-name
// slots only. No historical free text, no notes/titles/input_text/UUIDs/raw
// JSON. Movement names are re-sanitised to a bounded catalog-safe token.
//
// Pure. No I/O.

export const LEARNING_SELECTOR_VERSION = "p11.4-selector-v1";
export const LEARNING_HINT_SERIALIZER_VERSION = "p11.4-hint-serializer-v1";

export const ACTIVE_TAXONOMY_ALLOWLIST = ["LOAD", "VARIANT_COMPLETION", "STRUCTURE"] as const;

export const MAX_HINTS = 5;
export const MAX_FRAGMENT_CHARS = 1000;

const FRAGMENT_HEADER =
  "FORGE TENANT-SPECIFIC HISTORICAL COACH EVIDENCE (advisory, not rules)\n" +
  "These are prior coach-edit observations from this gym's comparable workouts. " +
  "They are advisory historical evidence, not mandatory rules — apply one only " +
  "when it fits the current workout. The Forge rules below remain authoritative. " +
  "Do not invent patterns beyond what is listed.";

const VARIANT_LABEL: Record<string, string> = {
  rx: "RX", intermediate: "Intermediate", beginner: "Beginner", onramp: "OnRamp",
};

// deno-lint-ignore no-explicit-any
type Dist = Array<{ value: string | null; count: number }>;

export interface SelectedHint {
  taxonomy: string;
  variant: string | null;
  movement: string | null;
  unit: string | null;
  format: string | null;
  structureNorm: string | null;
  evidenceType: string;
  distinctRunCount: number;
  beforeValue: string | null;
  afterValue: string | null;
  text: string;
}

export interface SerializeResult {
  serializerVersion: string;
  selectorVersion: string;
  candidateHintCount: number;
  selectedHints: SelectedHint[];
  promptFragment: string;      // "" when no eligible hint
  promptFragmentChars: number;
}

function sanitizeMovement(name: unknown): string | null {
  const s = String(name ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^A-Za-z0-9 &/'’.\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // A real movement name is short. Reject anything longer / wordier than the
  // catalog's longest entries ("Snatch-Grip Behind-the-Neck Press") so a
  // non-movement string (however it got here) can never enter the prompt.
  if (s.length < 2 || s.length > 34 || s.split(" ").length > 5) return null;
  return s;
}

function soleValue(d: Dist | undefined | null): string | null {
  if (!Array.isArray(d) || d.length !== 1) return null;
  const v = d[0]?.value;
  return v == null ? null : String(v).replace(/[\r\n]+/g, " ").replace(/[^A-Za-z0-9 .\-]/g, "").trim().slice(0, 32) || null;
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

interface SelInput {
  readModels: unknown[];         // array of p11_3_retrieve_impl results
  allowStructure: boolean;       // only true when the raw input declared structure
}

// deno-lint-ignore no-explicit-any
export function selectAndSerialize(input: SelInput): SerializeResult {
  const candidates: Array<{ p: any; taxonomy: string }> = [];
  for (const rmRaw of input.readModels || []) {
    const rm = rmRaw as any;
    const taxonomy = rm?.queryContext?.taxonomy;
    if (typeof taxonomy !== "string") continue;
    if (!ACTIVE_TAXONOMY_ALLOWLIST.includes(taxonomy as never)) continue;
    if (taxonomy === "STRUCTURE" && !input.allowStructure) continue;
    for (const p of Array.isArray(rm?.patterns) ? rm.patterns : []) {
      candidates.push({ p, taxonomy });
    }
  }

  const candidateHintCount = candidates.length;

  const eligible = candidates.filter(({ p }) =>
    p?.strength === "supported" &&
    p?.conflictState === "CONSISTENT" &&
    num(p?.distinctRunCount) >= 3 &&
    num(p?.strongContextCount) === 0 &&
    num(p?.broaderContextCount) === 0 &&
    num(p?.exactContextCount) >= 1,
  );

  // deterministic order: distinctRunCount desc, latestObservedAt desc, patternKey
  eligible.sort((a, b) => {
    const d = num(b.p.distinctRunCount) - num(a.p.distinctRunCount);
    if (d) return d;
    const t = String(b.p.latestObservedAt ?? "").localeCompare(String(a.p.latestObservedAt ?? ""));
    if (t) return t;
    return String(a.p.patternKey ?? "").localeCompare(String(b.p.patternKey ?? ""));
  });

  const selected: SelectedHint[] = [];
  for (const { p, taxonomy } of eligible) {
    if (selected.length >= MAX_HINTS) break;
    const n = num(p.distinctRunCount);
    const vkey = String(p.variant ?? "");
    const vLabel = VARIANT_LABEL[vkey] ?? null;
    const movement = sanitizeMovement(p.movementName);
    const unit = p.unit ? String(p.unit).replace(/[^a-z]/gi, "").slice(0, 4) : null;
    const after = soleValue(p.afterDistribution as Dist);
    const before = soleValue(p.beforeDistribution as Dist);
    const format = p.formatFamily && p.formatFamily !== "(unknown)" ? String(p.formatFamily).slice(0, 20) : null;

    let text: string | null = null;
    if (taxonomy === "LOAD") {
      if (!vLabel || !movement || !unit || !after) continue;
      text = `In ${n} prior comparable ${vLabel} ${movement} load corrections, AI proposals were changed to ${after} ${unit}.`;
    } else if (taxonomy === "VARIANT_COMPLETION") {
      if (!vLabel) continue;
      text = `In ${n} prior comparable analyses, the coach added the ${vLabel} variant after AI analysis omitted it.`;
    } else if (taxonomy === "STRUCTURE") {
      if (!after) continue;
      const fromTxt = before ? `from ${before} ` : "";
      const fmtTxt = format ? `${format} ` : "";
      text = `In ${n} comparable ${fmtTxt}analyses, the coach changed the structure ${fromTxt}to ${after}.`;
    }
    if (!text) continue;

    selected.push({
      taxonomy, variant: vkey || null, movement, unit, format,
      structureNorm: p.structureNorm ? String(p.structureNorm).slice(0, 20) : null,
      evidenceType: String(p.evidenceType ?? "correction"),
      distinctRunCount: n, beforeValue: before, afterValue: after, text,
    });
  }

  // assemble bounded fragment (truncate by whole hints)
  let fragment = "";
  if (selected.length) {
    const lines: string[] = [];
    let body = FRAGMENT_HEADER;
    for (const h of selected) {
      const next = `${body}\n- ${h.text}`;
      if (next.length > MAX_FRAGMENT_CHARS) break;
      body = next;
      lines.push(h.text);
    }
    // drop any selected hint that did not fit
    selected.length = lines.length;
    fragment = selected.length ? body : "";
  }

  return {
    serializerVersion: LEARNING_HINT_SERIALIZER_VERSION,
    selectorVersion: LEARNING_SELECTOR_VERSION,
    candidateHintCount,
    selectedHints: selected,
    promptFragment: fragment,
    promptFragmentChars: fragment.length,
  };
}
