# FCKB References

External, authoritative reference data FCKB depends on but does not itself generate or own — content that requires ongoing maintenance against a real outside authority, not something derived from the research documents one level up.

Examples identified during the research pass (`FCKB_ARCHITECTURE_REVIEW.md` Section 12, `WORKOUT_FORMATS.md` Sections 12-13, `PARSER_EDGE_CASES.md` Section 1):

- HYROX's official 8-station race sequence and division/gender-specific station loads
- Military/tactical PT-test batteries and their official scoring tables (ACFT, APFT, agency-specific standards)
- Named interval-protocol definitions (Norwegian 4x4, Wingate) where the structure isn't restated in the workout text itself
- Standard bumper-plate color-to-weight reference (IWF coloring: blue=20kg, green=15kg, yellow=10kg, red=25kg) needed to resolve plate-math shorthand in parsed text
- CrossFit Open's full historical workout archive (deliberately NOT authored from memory in `OPEN_WORKOUTS.md` — see that document's own honesty disclosure; this is exactly the kind of content that belongs here once sourced from CrossFit's own official archive)

Nothing lives here yet. Content added to this folder should always carry an explicit source citation (official body, URL, retrieval date) since — unlike the research documents one level up — the whole point of this folder is that Forge is not the authority on this content and must not silently drift from whatever body actually is.
