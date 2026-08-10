// Structured Outputs contract for one regenerated scaling variant - much
// narrower than analyze-workout's own schema (openaiSchema.ts there) by
// design: the caller already knows the section/format/RX content, only
// wants ONE tier's movements/weight/note regenerated. No formatConfig
// here - `wods.format_config` is one value shared by all 4 variants (see
// forge-admin-web's VariantTabs.tsx comment), so there is no per-tier
// slot to write an AI-suggested config into.

export const REGENERATE_VARIANT_JSON_SCHEMA = {
  type: "object",
  properties: {
    movements: {
      type: "array",
      items: { type: "string" },
      description: "One line per movement, same order as the RX movements list, each line formatted exactly like the RX input (e.g. '19-14-8 Jumping Pull-ups', '10 Deadlifts @ 82/56kg').",
    },
    weight: {
      type: "object",
      properties: {
        male: { type: "string", description: "Male load for this tier as free text (e.g. '61kg'), or empty string if not applicable." },
        female: { type: "string", description: "Female load for this tier as free text (e.g. '42kg'), or empty string if not applicable." },
      },
      required: ["male", "female"],
      additionalProperties: false,
    },
    note: {
      type: "string",
      description: "A short coaching note for this tier (scaling rationale, cueing), or empty string if none is needed.",
    },
  },
  required: ["movements", "weight", "note"],
  additionalProperties: false,
} as const;
