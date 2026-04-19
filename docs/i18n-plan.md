# i18n / translation plan

> **Principle:** every translation in zblocks comes from
> Wikimedia-ecosystem data that Abstract Wikipedia is built on —
> Wikifunctions objects and the Wikidata lexemes AW's NLG pipeline
> consumes. No machine translation, no translatewiki, no parallel
> translation CMS. If a phrase can't be dogfooded today, it stays
> English until the infrastructure to dogfood it exists.

---

## 1. Why this principle, and what it buys us

Abstract Wikipedia's [NLG architecture proposal][aw-nlg] treats a
sentence as:
1. a language-neutral **constructor** (data),
2. a language-specific **renderer** (a Wikifunctions function),
3. which pulls from **Wikidata lexemes** for morphology and
   Wikifunctions Z12 multilingual strings for label data.

If zblocks pipes its own UI through the same substrate — Z12 labels,
Z33668 lexeme lookups, eventually AW renderers for compound
phrases — then every improvement to the pipeline (better German
lexeme coverage, a new renderer for Zulu, a correction to a Z8's
Z12) lands in zblocks automatically, and everything zblocks
contributes lands in every other dogfooded project.

Translatewiki is an excellent human-translation workflow. It is not
this path. It stores translations in its own infrastructure, not in
Wikidata/Wikifunctions, so every improvement is scoped to MediaWiki-
ecosystem *software* translation and doesn't feed back into the
Wikipedia-article rendering pipeline. We explicitly reject it as a
zblocks dependency.

[aw-nlg]: https://meta.wikimedia.org/wiki/Abstract_Wikipedia/Natural_language_generation_system_architecture_proposal

---

## 2. State of the world (what actually localises today)

Everything in this list works right now, today, with no chrome
translation files shipped. Pick French or German in the picker and
these render correctly:

**Wikifunctions-sourced content — localised via `extractLabel`
parameterised on the user's language (falls back through English,
then any available monolingual entry, to the raw ZID):**

- Function labels — every Z8's `Z2K3` label, rendered in the user's
  language on pinned functions, search results, imported
  compositions, built-in categories, and inside block titles.
- Argument labels — every Z17K3 on every Z8, rendered on the
  shell-def frame, inside arg rows on every function block, on Run
  modal input fields, and in fill-slots previews.
- Output type hints — rendered on block titles, in arg type hints
  on function blocks, in search-result signatures.
- Type names — the ~45 entries in TYPE_LABELS are refreshed on
  init from each Z-type's `Z2K3` in the user's language.
- Error-type titles and descriptions — Z50 `Z2K3` / `Z2K5`.
- Error-payload key names — Z50's `Z50K1` list of Z3 key
  declarations, rendered as the LHS of error message lines.
- Test labels in the Run-modal test-prefill dropdown.
- Imported Z14's label (shown as the "editing impl X" breadcrumb
  on the shell-def frame).

**Built-in function registry translated on init.** The ~60
hardcoded functions in `js/functions.js` are rehydrated at page
load via `rehydrateBuiltinLabels()` — one chunked batch of
`wikilambda_fetch` calls, runs before `registerAllBlocks()` so
block definitions pick up translated labels before first render.
No-op when the user is in English.

**Language picker.** Typeahead combobox over ~500 Z60 natural
languages, auto-harvested from the Wikifunctions catalogue by
`scripts/build-languages.mjs`. Detection chain is `?lang=xx` URL
param → localStorage → navigator.language → English. Switching
language writes to localStorage and reloads. Languages with a
shipped chrome catalog get a ✓ badge.

**Runtime scaffolding.** All UI chrome strings are externalised to
`i18n/en.json` (112 keys, banana-i18n-compatible format) + a
`qqq.json` translator-documentation companion. `msg()` plus a DOM
walker for `data-i18n*` attributes handles lookup with graceful
English fallback for missing keys.

## 3. What's still English, and why

Given a user in German (or any non-English language with
well-populated Wikifunctions Z12 data), here's what still reads in
English, in rough order of screen-space:

| Gap | Why it's English | Dogfood path |
|---|---|---|
| **Chrome catalog** — button labels, modal titles, hints, placeholders (~112 keys in en.json) | No `<lang>.json` shipped yet. | Z33668-backed build script — see [`z33668-build-script-plan.md`](./z33668-build-script-plan.md). |
| **Compound phrases in chrome** — "+ Add function", "Prefill from test:", error messages with interpolation | Can't be expressed as a single-concept lexeme lookup. | Wait for AW renderer coverage to grow enough for our cases, OR rewrite to be decomposable. |
| **Prose hints** ("Executes via wikilambda_function_call. Values replace Z18 arg references…") | Not representable as a constructor/renderer in any current Wikimedia data model. | No dogfood path. Stays English. |
| **Internal emitter / importer / runner error strings** | Throw-site English. Not extracted to i18n. | Extract to `i18n/en.json`, then Z33668-build pass on top. Lower priority — most users shouldn't hit these. |
| **Shell-def frame templates** — "def / takes / returns / body / source" | Set in `SHELL_DEF_SPEC.message0/1/2/3/4` at block-registration. | Use `msg()` at registration time — same pattern as the rehydrate-on-init commit. Chrome-catalog commit would cover this too if those keys are added. |
| **RTL layout** — Arabic, Hebrew, Farsi languages filtered out in the build-languages harvest | No CSS logical-property pass yet. | Single-commit CSS audit + unfilter RTL in the build-languages script. Independent of translation. |

## 4. Things we learned during implementation

**The free tier is huge.** We expected to have to translate
everything. The reality is that by the time a user is in the middle
of composing something, ~80–95% of their on-screen content is
Wikifunctions-sourced and already localises via the Z12 fetch
parameterisation — the authoring chrome is the minority surface.
This reordered the priority: parameterise fetches FIRST, translate
chrome LAST.

**`wikilambda_fetch` caps at 50 ZIDs per request.** Getting this
wrong manifests as silent partial translation — the catch-and-warn
error handler in `rehydrateBuiltinLabels` swallows the
`toomanyvalues` response and leaves the built-ins English. All
batch fetches route through `wikilambdaFetchChunked` in
`catalog.js`. Noted in CLAUDE.md.

**Wikifunctions language ZIDs need verification, not intuition.**
My initial guesses for German/Spanish/Arabic/etc. were largely
wrong. The build script probes the live catalogue and writes a
generated data file; we commit the output, not the assumptions.

**`navigator.language` primary only; regional variants collapse.**
`pt-BR` detects as `pt`, `zh-TW` as `zh`. Wikifunctions has
separate Z60s for those variants. Not handling it is a deliberate
non-fix — fine until a user reports it.

**Graceful English fallback is non-negotiable.** Every path — `msg()`
lookup, `extractLabel` Z12 walk, `typeLabel` ZID lookup — falls
through to English before returning raw keys or ZIDs. A user in a
language with 10% coverage sees a bilingual UI, not a broken one.

## 5. Next dogfooded step

The chrome catalog via the Z33668 build script is the natural next
commit. Full design in
[`docs/z33668-build-script-plan.md`](./z33668-build-script-plan.md).
Summary:

- Hand-curated `i18n/mappings.json` maps UI keys to Wikidata
  concept Q-IDs + lexical-category Q-IDs.
- `scripts/build-i18n.mjs <lang>` iterates the map, calls Z33668
  via `wikilambda_function_call` per mapped key, writes
  `i18n/<lang>.json` + `i18n/missing-lexemes.<lang>.md`.
- Expected first-pass German coverage: 25–40% of chrome keys (the
  single-concept subset — short verbs, nouns, common UI
  vocabulary).
- Missing-lexeme report becomes a Wikidata contribution task —
  resolving them benefits every downstream Wikimedia tool, not just
  zblocks.

This is infrastructure, not quick chrome coverage. A native-speaker
hand-translating `i18n/de.json` would ship higher-quality coverage
faster, but violates the dogfood principle unless we use the
speaker as a Wikidata-lexeme contributor instead.

## 6. Constraints that remain open

- **Plural rules.** Our minimal runtime hardcodes
  `{{PLURAL:$1|one|many}}` as `n === 1 ? one : many`. Correct for
  English. Polish, Russian, Arabic, Welsh have 3–6 forms.
  Full `banana-i18n` is an ES-module drop-in when the first
  complex-plural catalog ships.
- **Font coverage.** System fonts cover most scripts on modern OSes;
  subsetted Noto bundles are a Phase-N concern.
- **Wikifunctions rate limits.** Our live fetches happen at page
  load; a visitor-spike against an uncached lang could be a
  problem. Reasonable to build a static `i18n/labels-<lang>.json`
  snapshot via the build script eventually, but premature now.
- **`aria-label`s for icon-only controls.** Icons without adjacent
  text need translatable `aria-label`s. Every iconification commit
  adds keys back. Manageable but a known trade-off.

## 7. The endgame: AW renderers

Today's compound phrases ("Prefill from test: $1", "Editing impl
$1 of $2") can't be assembled from single lexemes — the words
need to agree grammatically with their arguments. That's what AW
renderers are for.

When AW's pipeline is production-fast for the languages we care
about, chrome entries in `i18n/<lang>.json` become **constructor
specs** (`{kind: "run_with_inputs_label"}`) and the renderer call
replaces the flat string lookup. Build-script cache still covers
the common case; live-call falls back for long-tail keys.

At that point zblocks is a pure dogfood consumer: zero translation
infrastructure of its own, every string going through the same
machinery Wikipedia articles use. The whole plan is aimed at that
endgame; every intermediate step stays compatible with it.
