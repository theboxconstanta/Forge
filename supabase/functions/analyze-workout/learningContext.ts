// P11.4 — DETERMINISTIC pre-model learning-context extractor.
//
// Input: the raw workout text the coach pasted + the gym's own movement names.
// Output: only HIGH-CONFIDENCE structured facts that can be built WITHOUT the
// model — used to form P11.3 retrieval queries BEFORE the single OpenAI call.
//
// HARD RULES (owner decision + §1-§6):
//   - movement: exact canonical / alias / naive-plural match only. NO fuzzy,
//     NO embeddings, NO partial-name collision. Ambiguous span -> dropped.
//   - variant: only an explicit line-leading label (RX: / Intermediate: / ...).
//   - unit / gender-dimension: only explicit `kg|lb` (+ slash notation).
//   - format: only an explicit leading canonical token.
//   - structure: ONLY when the text literally declares `Structure: Sequence` /
//     `Structure: Repeated Rounds`. NEVER inferred from layout / rep pattern /
//     "max reps" / line count / format.
//
// Pure. No I/O. Deno-test friendly.
import { CANONICAL_MOVEMENTS, MOVEMENT_ALIASES, resolveCanonicalMovement } from "./movementCatalog.ts";

export const LEARNING_CONTEXT_VERSION = "p11.4-context-v1";

export type CanonicalVariant = "rx" | "intermediate" | "beginner" | "onramp";
export type GenderDimension = "universal" | "sex_specific";

export interface DetectedMovement {
  movementName: string;        // canonical display name
  movementId: string | null;   // reserved; the EF only has names today
  variant: CanonicalVariant | null;
  unit: "kg" | "lb" | null;
  genderDimension: GenderDimension;
  position: number | null;     // 0-based order within its variant block, when knowable
}

export interface LearningContext {
  contextVersion: string;
  format: string | null;           // canonical format token, when explicit
  formatExplicit: boolean;
  structure: "Sequence" | "Repeated Rounds" | null;  // ONLY when literally declared
  structureExplicit: boolean;
  scalingLabelsPresent: CanonicalVariant[];
  absentScalingTiers: CanonicalVariant[];  // of intermediate/beginner/onramp
  detected: DetectedMovement[];
  diagnostics: string[];           // e.g. "ambiguous_movement:xxx"
}

// ---- format ---------------------------------------------------------------
const FORMAT_TOKENS: Array<[RegExp, string]> = [
  [/^\s*ascending\s+amrap\b/i, "Ascending AMRAP"],
  [/^\s*amrap\s+with\s+buy-?in\b/i, "AMRAP with Buy-In"],
  [/^\s*chained\s+amrap\b/i, "Chained AMRAP"],
  [/^\s*amrap\b/i, "AMRAP"],
  [/^\s*for\s*time\b/i, "For Time"],
  [/^\s*rft\b/i, "RFT"],
  [/^\s*(\d+\s*)?rounds?\s+for\s+time\b/i, "RFT"],
  [/^\s*chipper\b/i, "Chipper"],
  [/^\s*ladder\b/i, "Ladder"],
  [/^\s*e?\d*mom\b/i, "EMOM"],
  [/^\s*every\s+\d+(\s*(min|minute|sec|second)s?)?\b/i, "EMOM"],
  [/^\s*tabata\b/i, "Tabata"],
  [/^\s*intervals?\b/i, "Intervals"],
  [/^\s*death\s+by\s+weight\b/i, "Death By Weight"],
  [/^\s*death\s+by\b/i, "Death By"],
  [/^\s*partner\s+wod\b/i, "Partner WOD"],
  [/^\s*not\s+for\s+time\b/i, "Not For Time"],
];

function detectFormat(text: string): { format: string | null; explicit: boolean } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 3)) {
    for (const [re, canonical] of FORMAT_TOKENS) {
      if (re.test(line)) return { format: canonical, explicit: true };
    }
  }
  return { format: null, explicit: false };
}

// ---- structure (ONLY when literally declared) -----------------------------
function detectStructure(text: string): "Sequence" | "Repeated Rounds" | null {
  const m = text.match(/\bstructure\s*[:=]\s*(sequence|repeated\s+rounds)\b/i);
  if (!m) return null;
  return /sequence/i.test(m[1]) ? "Sequence" : "Repeated Rounds";
}

// ---- variant labels ------------------------------------------------------
const VARIANT_LABEL_RE = /^\s*(rx\+?|r?x'?d?|intermediate|int|beginner|scaled|on[-\s]?ramp|onramp|masters?)\s*[:\-–]/i;

function normVariantLabel(raw: string): CanonicalVariant | null {
  const l = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (l === "rx" || l === "rxd" || l === "rxplus" || l === "x" || l === "xd") return "rx";
  if (l === "intermediate" || l === "int") return "intermediate";
  if (l === "beginner" || l === "scaled") return "beginner";
  if (l === "onramp") return "onramp";
  return null; // masters etc. -> not a canonical P11 variant, ignored
}

// ---- movement scanning --------------------------------------------------
interface NameEntry { key: string; canonical: string; len: number; }

function buildNameIndex(gymMovementNames: string[]): NameEntry[] {
  const out: NameEntry[] = [];
  const add = (key: string, canonical: string) => {
    const k = key.trim();
    if (k.length >= 3) out.push({ key: k.toLowerCase(), canonical, len: k.length });
  };
  for (const m of CANONICAL_MOVEMENTS) add(m, m);
  for (const [abbr, full] of Object.entries(MOVEMENT_ALIASES)) add(abbr, full);
  for (const n of gymMovementNames || []) {
    const c = resolveCanonicalMovement(n) ?? n;
    add(n, c);
  }
  // longest key first so "Chest to Bar Pull-up" wins over "Pull-up"
  return out.sort((a, b) => b.len - a.len);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RawHit { start: number; end: number; canonical: string; }

function scanMovements(text: string, index: NameEntry[]): { hits: RawHit[]; ambiguous: Set<string> } {
  const lower = text.toLowerCase();
  const hits: RawHit[] = [];
  const ambiguous = new Set<string>();
  for (const entry of index) {
    // word-ish boundary: not preceded/followed by a letter (allow plural 's')
    const re = new RegExp(`(?<![a-z])${escapeRe(entry.key)}(?:e?s)?(?![a-z])`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      const overlap = hits.find((h) => start < h.end && end > h.start);
      if (overlap) {
        if (overlap.canonical !== entry.canonical && (end - start) === (overlap.end - overlap.start)) {
          ambiguous.add(entry.canonical);
          ambiguous.add(overlap.canonical);
        }
        continue; // a longer or equal earlier hit already covers this span
      }
      hits.push({ start, end, canonical: entry.canonical });
    }
  }
  return { hits: hits.sort((a, b) => a.start - b.start), ambiguous };
}

// which variant block does offset `pos` fall under?
function variantAt(text: string, pos: number): { variant: CanonicalVariant | null; blockStart: number } {
  const before = text.slice(0, pos).split("\n");
  for (let i = before.length - 1; i >= 0; i--) {
    const lm = before[i].match(VARIANT_LABEL_RE);
    if (lm) {
      const v = normVariantLabel(lm[1]);
      const blockStart = before.slice(0, i + 1).join("\n").length;
      return { variant: v, blockStart };
    }
  }
  return { variant: null, blockStart: 0 };
}

const UNIT_NEAR_RE = /(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*)?(kg|lb|lbs)\b/i;

export function extractLearningContext(workoutText: string, gymMovementNames: string[] = []): LearningContext {
  const text = String(workoutText || "");
  const diagnostics: string[] = [];

  const fmt = detectFormat(text);
  const structure = detectStructure(text);

  // scaling labels present
  const present = new Set<CanonicalVariant>();
  for (const line of text.split("\n")) {
    const lm = line.match(VARIANT_LABEL_RE);
    if (lm) { const v = normVariantLabel(lm[1]); if (v) present.add(v); }
  }
  const scalingLabelsPresent = [...present].sort();
  const absentScalingTiers = (["intermediate", "beginner", "onramp"] as CanonicalVariant[])
    .filter((v) => !present.has(v));

  const index = buildNameIndex(gymMovementNames);
  const { hits, ambiguous } = scanMovements(text, index);
  for (const a of ambiguous) diagnostics.push(`ambiguous_movement:${a}`);

  const detected: DetectedMovement[] = [];
  const seenPerVariant = new Map<string, number>();
  for (const h of hits) {
    if (ambiguous.has(h.canonical)) continue;
    const { variant } = variantAt(text, h.start);
    // unit / gender on the hit's OWN line only: prefer a load AFTER the movement
    // ("Thruster 40kg"), else BEFORE it ("40kg Thruster"). Never spill onto an
    // adjacent line (that is a different movement).
    const lineEnd0 = text.indexOf("\n", h.end);
    const lineEnd = lineEnd0 === -1 ? text.length : lineEnd0;
    const lineStart = text.lastIndexOf("\n", h.start) + 1;
    const um = text.slice(h.end, lineEnd).match(UNIT_NEAR_RE)
      ?? text.slice(lineStart, h.start).match(UNIT_NEAR_RE);
    let unit: "kg" | "lb" | null = null;
    let genderDimension: GenderDimension = "universal";
    if (um) {
      unit = /lb/i.test(um[3]) ? "lb" : "kg";
      if (um[2] != null) genderDimension = "sex_specific";
    }
    const vkey = variant ?? "-";
    const position = seenPerVariant.get(vkey) ?? 0;
    seenPerVariant.set(vkey, position + 1);
    detected.push({ movementName: h.canonical, movementId: null, variant, unit, genderDimension, position });
  }

  return {
    contextVersion: LEARNING_CONTEXT_VERSION,
    format: fmt.format,
    formatExplicit: fmt.explicit,
    structure,
    structureExplicit: structure !== null,
    scalingLabelsPresent,
    absentScalingTiers,
    detected,
    diagnostics,
  };
}
