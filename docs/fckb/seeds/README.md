# FCKB Seeds

Versioned seed data derived from the reference documents one level up (`MOVEMENT_CATALOG.md`, `MOVEMENT_ALIASES.md`, `WORKOUT_FORMATS.md`, `REP_PATTERNS.md`, `BENCHMARK_WORKOUTS.md`, `HERO_WORKOUTS.md`, `OPEN_WORKOUTS.md`) — the actual import-ready artifacts (JSON, SQL, or TypeScript constants, depending on the storage-layer decision `FCKB_ARCHITECTURE_REVIEW.md` Section 13 leaves open) that get loaded into whichever storage FCKB ends up using.

Nothing lives here yet. The markdown documents one level up are the source of truth to generate these from; this folder is empty until FCKB actually moves into implementation, per `FCKB_ARCHITECTURE_REVIEW.md`'s verdict ("APPROVED AS FOUNDATION, WITH REQUIRED REVISIONS BEFORE IMPLEMENTATION" — research/critique only so far, not yet built).

When populated, each file here should be traceable back to the specific markdown section it was generated from, so a future correction to a research document has an obvious corresponding seed file to regenerate.
