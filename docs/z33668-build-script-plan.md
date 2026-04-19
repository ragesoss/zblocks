# Z33668 build script — detailed plan

> How the dogfooded translation-build pipeline would work. Assumes the
> reader has read `docs/i18n-plan.md` for the broader Phase-2 context.

Here's the mechanism end-to-end.

## Input: `i18n/mappings.json`

Hand-curated, committed to repo. Each UI key maps to a Wikidata concept
+ a lexical category, or an explicit skip:

```json
{
  "@metadata": {
    "note": "Maps i18n keys to Wikidata concepts. Build script resolves them through Z33668 (word-for-concept) to lemmas per language. Keys absent fall back to English at runtime."
  },
  "shell_modal.cancel": {
    "concept":  "Q22707738",
    "category": "Q24905"
  },
  "shell_modal.save": {
    "concept":  "Q55226559",
    "category": "Q24905"
  },
  "shell_modal.args.legend": {
    "concept":  "Q245676",
    "category": "Q1084"
  },
  "header.buttons.run": {
    "concept":  "Q1404771",
    "category": "Q24905"
  },
  "run_modal.test_label": {
    "concept":  "Q205625",
    "category": "Q1084"
  },
  "error.no_root_block": {
    "skip": true,
    "reason": "app-specific prose, no single-concept lineage"
  }
}
```

Categories we use (≤5 tags cover 99%):
- `Q24905` verb • `Q1084` noun • `Q34698` adjective • `Q380057` adverb

## The build script: `scripts/build-i18n.mjs`

```
node scripts/build-i18n.mjs --lang de
```

Sequence:

1. **Load** `i18n/en.json` (key set), `i18n/mappings.json` (concept mappings).
2. For each mapped key, call `Z33668(concept, langZid, category)` via
   `wikilambda_function_call` (same API path as the Run button):

   ```js
   const call = {
     Z1K1: "Z7", Z7K1: "Z33668",
     Z33668K1: { Z1K1: "Z6091", Z6091K1: mapping.concept },
     Z33668K2: "Z1430",  // target language's WF Z60 ZID
     Z33668K3: { Z1K1: "Z6091", Z6091K1: mapping.category },
   };
   ```

   Parallelized in small batches (say 5 concurrent) — polite to the
   orchestrator and keeps build time ~1 min for a full catalog.

3. **Interpret the response.** Three outcomes per key:
   - `Z22K1` is a `Z6` string → that's the lemma (e.g. "abbrechen").
     Record it.
   - `Z22K1` is `Z24` with error `Z28158` (no statement) → no lexeme
     found with `P5137 → concept` in that language. Record as
     missing-lexeme.
   - Any other error → record as fetch-error with the Z507 message for
     debugging.

4. **Write outputs:**
   - `i18n/de.json` — banana format, only entries that resolved:
     ```json
     {
       "@metadata": { "built": "2026-04-19T…", "source": "Z33668", "coverage": "22/40 mapped" },
       "shell_modal.cancel": "abbrechen",
       "shell_modal.save": "speichern",
       "shell_modal.args.legend": "Argument",
       "header.buttons.run": "ausführen"
     }
     ```
   - `i18n/missing-lexemes.de.md` — markdown report:
     ```
     # Missing German lexemes — 5 keys

     | UI key | English | Concept tried | Category | Notes |
     |---|---|---|---|---|
     | run_modal.test_label | Prefill from test: | Q205625 (test) | Q1084 noun | No L→Q205625 P5137 in German |
     | ... |

     To close these gaps: create the missing lexemes on Wikidata
     (or check whether an existing lexeme's P5137 needs to be
     added), then re-run the build.
     ```

5. **Runtime pickup.** No code change needed on our side. Pages rebuild
   on push; next page load with `lang=de` loads the new `de.json`;
   graceful fallback covers missing keys.

## Worked example (German, single-key)

Mapping:
```json
"shell_modal.save": { "concept": "Q55226559", "category": "Q24905" }
```

Build does:
1. POST `wikilambda_function_call` with `Z33668(Q55226559, Z1430, Q24905)`
2. Z33668 queries Wikidata: "find lexemes where P5137 → Q55226559 AND
   P407 → Z1430's ISO AND lexical category → Q24905, ranked"
3. Finds `L123456` ("speichern", verb, German)
4. Returns lemma `"speichern"`
5. Script writes `"shell_modal.save": "speichern"` to `i18n/de.json`

## Missing-lexeme triage

The interesting insight: **some UI concepts don't have lexemes at all
in a given language, and that's a Wikidata problem, not a zblocks
problem.**

The `missing-lexemes.de.md` report gives you (or a contributor) a tight
list of "add these to Wikidata and every project benefits." Typical
finds will be:

- The lemma exists but `P5137` isn't set (common — easy fix, ~1 min per
  lexeme on Wikidata)
- The lemma exists under a different form (e.g. imperative vs
  infinitive — sometimes needs disambiguation)
- No lemma exists yet (rarer, but requires actually adding the word)

Each resolved item makes every future zblocks (or other
Wikimedia-ecosystem tool) build better. Dogfood compounds.

## Expected coverage, honestly

For German specifically I'd guess 25–40% of the 112 chrome keys resolve
on first build — the short common-verb/short-noun keys most cleanly.
Combined with what's already localized from the rehydrate commit (~80%
of on-screen content at any moment), a German user's UI ends up
something like:

| Tier | Status |
|------|--------|
| Function labels, type labels, error labels, arg labels | **German** (Z12 fetch, already shipping) |
| Single-concept UI chrome (cancel, save, run, etc.) | **German** (Z33668 build, this commit) |
| Compound phrases ("+ Add function", "Prefill from test:") | **English** (no concept, needs AW renderer later) |
| Prose hints + internal errors | **English** (no lineage) |

Maybe 60% of screen-space in German, 40% still English — an improvement
from today's ~20% English everywhere once translation is turned on
(functions and types already German, but all chrome English).

## Trade-off to consider before building it

The build script is a day's work. Expected German coverage: 25–40% of
chrome strings — which is ~30–50 additional UI words/phrases localised.

**Alternative:** a native German speaker sits with `i18n/en.json` and
`i18n/qqq.json` for an afternoon and writes `i18n/de.json` by hand,
looking up unfamiliar terminology as needed. Output: probably 90%+
coverage of chrome, higher quality (idiomatic UI German vs. linguistic-
database lemmas that may or may not be the right register).

**The dogfood case for the build script anyway:**
- The mappings.json we produce is reusable by other Wikimedia tools
- Missing-lexemes.md drives Wikidata contribution
- Zero marginal cost for adding a 3rd, 4th, 10th language
- Auto-improves as Wikidata lexeme coverage grows (no-touch maintenance)

**The case for hand-translation:**
- Higher quality output, faster turnaround
- Doesn't block on Wikidata lexeme gaps
- Ships a complete German UI today
- But: per-language labor, no infrastructure reuse

**Possible hybrid:** build the script + ship a hand-translated
`de.json` + ship the script's output as a `de-auto.json` for comparison.
Over time migrate keys from hand to auto as Wikidata catches up.

## Decision points

1. **Build the script + seed mappings.json**, ship whatever coverage
   it yields?
2. **Skip the script for now**, have a native speaker write
   `i18n/de.json` by hand?
3. **Both** — script for principle, human catalog for quality, diff
   tracked in the repo?

The infrastructure value of option 1 is real but defers the "UI
actually feels German" moment. Option 3 gives both but doubles the
surface area to maintain.
