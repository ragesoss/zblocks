# i18n / translation plan

> **Goal:** translate the zblocks UI by *using Wikifunctions itself* as
> the translation substrate — dogfooding the exact mechanism Abstract
> Wikipedia uses to render multilingual Wikipedia articles. This is a
> long-horizon target; we also need a pragmatic path that works
> before AW's pipeline is production-ready.

---

## 1. The vision: self-translating via Wikifunctions

Abstract Wikipedia's [NLG architecture proposal][aw-nlg] is the model:

1. Each UI phrase is a **constructor** — a language-neutral data
   object. For a static label: `{kind: "run_button"}`. For a
   pluralised phrase: `{kind: "result_count", n: 3}`.
2. A **renderer** (a Wikifunctions function) takes the constructor +
   a target language and emits the localized text.
3. For simple labels the renderer is just a lookup into a **Z12
   multilingual string** attached to a Wikifunctions page. For
   phrases that require morphology (plurals, grammatical agreement,
   word order), the renderer walks a template and may call into
   Wikidata lexemes + grammar specs per Abstract Wikipedia's stack.

Concretely for a webapp like ours:

- Community members edit translations on Wikifunctions, same way
  they'd edit any other ZObject. Not a parallel translation CMS.
- Each UI message has a corresponding `Z2` page with translations as
  Z11 entries inside a Z12, OR a `Z8` function whose implementation
  is a Z12 lookup (+ pluralisation / parameter substitution for
  non-trivial cases).
- Our client fetches those translations (periodically, cached
  heavily) and applies them to DOM text.
- The moment AW's NLG pipeline is production-fast, we swap static
  Z12 lookups for Z7 calls into renderers — no client code change.

**Why this isn't realistic to do live today (as the user noted):**

- Wikifunctions function_call latency is measured in hundreds of ms
  per call, on a warm cache. One call per UI string per render is a
  non-starter.
- The NLG pipeline is in beta (Abstract Wikipedia launched
  2026-04-13); renderers exist for only a handful of languages;
  "morphology per language" is still an open community effort.
- Wikifunctions has no built-in rate-limiting guarantees for
  anonymous callers; a busy page could blow through its quota.

So the realistic path is **build-time translation fetches with
aggressive client-side caching, built on the same Wikifunctions
substrate** — a migration path to live rendering rather than
committing to it today.

[aw-nlg]: https://meta.wikimedia.org/wiki/Abstract_Wikipedia/Natural_language_generation_system_architecture_proposal

---

## 2. Current state: zblocks is already mostly translated

**External text — already localised via Wikifunctions.** Type labels,
function labels, argument labels, error-type labels, error-payload
key names — all fetched from Wikifunctions at runtime and resolved
to the English `Z1002` entry today, but the same fetch would resolve
to any other language by changing one argument:

- `typeLabel(zid)` — reads from `js/type_labels.js` static map
  (core ~45 types); falls back to ZID for unknowns.
- `fetchErrorTypeInfo(zid)` in `js/catalog.js` — already walks
  `Z2K3.Z12K1` looking for `Z11K1 == Z1002`. Trivial to parameterise.
- `fetchFunctionSignature` — same.
- `extractEnLabel` in `js/importer.js` — same pattern, hardcodes
  `Z1002`.

**Pure UI chrome ("our" text) is a small surface.** A grep of the
codebase finds roughly 100 distinct user-visible strings: button
labels, modal titles, section headings, placeholder text, error
messages we generate (as opposed to formatting), and hints/tooltips.
A rough audit:

| Surface | Strings | Notes |
|---|---:|---|
| Header buttons + status | 8 | very short |
| Shell modal | 12 | including field labels |
| Import modal | 10 | one long hint |
| Run modal | 15 | including test-prefill flow |
| Result modal | 10 | includes "Running…" / "Copied!" |
| Export modal | 8 | |
| Slot picker | 6 | |
| Fill-slots modal | 12 | preview + fates |
| Add-function (search) modal | 18 | chips + hints |
| Our emitted errors | ~25 | mostly in emitter/runner/importer |
| Tooltips on literal blocks | 7 | one per literal type |

Call it ~130. Some are dynamic templates (`"${n} result${plural}"`).
A few dozen compose into the same phrase with different subjects.

**The thing we *don't* translate today but should:** none. Pretty
much everything user-facing is in English. No ISO locale detection.
No RTL. No plural rule handling.

---

## 3. Phased path

### Phase 0 — cut translation surface area (no external dependencies)

Easy wins, probably half a day each:

- **Swap verbose hints for concise tooltips.** "Executes the
  workspace via `wikilambda_function_call`. Values replace Z18 arg
  references in-flight; nothing is written to Wikifunctions." → not
  needed on the modal; move to the Run button's `title`.
- **Iconify buttons where safe.** `+ Add function` → `+`, `Close` →
  `×`, `Pin` / `Unpin` → 📌 toggle (but keep accessible text labels
  for screen readers). Preserves information density while
  shrinking translation load.
- **Consolidate duplicate phrases.** "Loading…" appears in at least
  three places; "No matches" in two. Unify so one translation
  covers them.
- **Delete boilerplate that no longer earns its space.** Some
  explanatory paragraphs were written when a feature was new and
  are redundant now that users can find things.

Expected reduction: ~40% of translatable text. No external
dependency. Makes future i18n work cheaper.

### Phase 1 — extract to a message catalog, English-only

Refactor every string into a message-catalog lookup so there's a
single source of truth. This is the cheapest step that turns
translation from a refactor into a data entry.

**Structure:**

```
i18n/
  en.json        # canonical English, keys → strings
  qqq.json       # translator documentation (standard WMF convention)
```

**Key scheme:** dot-separated, UI-location prefixed:

```json
{
  "header.buttons.add_function": "+ Add function",
  "header.buttons.import": "Import",
  "modal.run.title": "Run composition",
  "modal.run.hint": "Executes via wikilambda_function_call.",
  "modal.run.submit": "Run",
  "search.status.loading": "searching…",
  "search.results.count": "{{PLURAL:$1|$1 result|$1 results}}",
  "error.no_body": "Function-definition frame has no composition body — connect a block to the 'body' slot.",
  ...
}
```

**Library:** [`banana-i18n`][banana] — Wikimedia's own JS i18n
library, uses the "banana" JSON format, handles CLDR plurals and
gender, has [`@wikimedia/banana-i18n`][banana-npm] on npm. ~8 KB
gzipped. No build step required; loadable as an ES module.

**Refactor pattern:**

```js
import { msg } from "./i18n.js";
// before: `<button id="run-btn">Run</button>`
// after:
runBtn.textContent = msg("header.buttons.run");
```

For DOM construction we wrap with a `msg()` helper. Static HTML in
`index.html` gets converted to `data-i18n="key.name"` attributes
that a tiny init walker fills in on load.

**What this buys:**

- Every user-visible string has a key. Easy to audit, easy to diff,
  easy to find duplicates.
- Copy edits touch one file. Engineering and wordsmithing decouple.
- Adding a language is adding `i18n/fr.json` plus a language picker.
- Plurals work correctly in any CLDR language from day one.

[banana]: https://wikimedia.github.io/banana-i18n/
[banana-npm]: https://www.npmjs.com/package/banana-i18n

### Phase 2 — bundled per-language JSON

Add `i18n/<lang>.json` files. Language picker in the header (pulls
from a list of available languages). Browser-language auto-detect
with localStorage override.

**Source of the translations — three options:**

1. **translatewiki.net** (the standard path). Upload `en.json`,
   translators contribute via the TranslateWiki UI, a scheduled job
   pulls the translations back. Well-understood. This is what every
   MediaWiki extension does.
2. **GitHub PRs** against `i18n/*.json` in the repo. Lower barrier
   for developer contributors, higher barrier for translators who
   aren't comfortable with git.
3. **Wikifunctions-hosted translations** (the dogfooded path — see
   Phase 3).

For Phase 2 specifically: start with translatewiki.net or GitHub PRs
as the translation workflow, *even if* we'll migrate the storage in
Phase 3. The client code doesn't care where the JSON came from.

**RTL.** Add `dir="rtl"` handling via CSS logical properties. Most
of our layout is already flex-based; a few hardcoded `margin-left`
rules need to flip. Probably a day of CSS cleanup.

### Phase 3 — Wikifunctions-hosted translations

Each UI message key gets a Wikifunctions page. Community translates
on-wiki, same as any other ZObject.

**Schema options:**

- **Option A (simple):** one `Z2` per UI key, with the translations
  inside a `Z12` multilingual string attached as `Z2K2`. Our
  build-time fetch iterates our known keys, pulls the `Z12` for each,
  produces `i18n/<lang>.json`. Straightforward, uses only existing
  types.
- **Option B (function):** one `Z8` per UI key. Its input is a
  language (`Z60`) and its output is a `Z6` string. Implementations
  are a switch-on-language over Z11 entries. This future-proofs for
  pluralisation / parameters without rewriting consumers — we'd
  just change the function signature and its implementations.
- **Option C (namespace):** a single `Z2` per module (e.g., "Run
  modal") whose content is a map from key → `Z12`. Many fewer page
  creations but uses a custom type we'd have to define.

**Recommendation: start with Option A.** It's the minimum viable
schema that uses only existing types. Upgrade to Option B per key
when a key needs pluralisation or parameters.

**Build pipeline:**

1. A GitHub Action (or a script users run) queries Wikifunctions
   for each registered key.
2. Groups translations by language, writes `i18n/<lang>.json`.
3. Commits and pushes to `main`. Pages rebuilds.

**Cadence:** daily is plenty — translation review on-wiki takes
longer than a day anyway. A webhook from Wikifunctions would be
nicer but isn't supported for anonymous watchers.

**Caching:** the generated JSONs are the cache. Clients don't hit
Wikifunctions directly.

### Phase 4 — live rendering via the AW pipeline

Two triggers for graduating from Phase 3 to Phase 4:

1. **Non-trivial phrases need morphology.** Once we have a phrase
   like "Edit {{impl-label}} of {{function-label}}" where each
   substitution needs grammatical agreement with surrounding text
   in e.g. Russian, plain string substitution breaks. We need a
   renderer that walks an AW-style template.
2. **AW pipeline is production-fast.** Sub-100ms per call for
   common cases. Realistically not this year.

When that happens, the migration is: our "UI message" objects become
**constructors** (not strings), and we call an AW renderer for the
user's language. Build-time cache still covers the common case; we
live-call only for uncommon languages or keys that aren't cached
yet.

The architectural symmetry with AW is the payoff. Our UI phrases go
through the same machinery Wikipedia articles will — and every
improvement to the renderer stack (a better German template, a new
morphology helper for Zulu) benefits zblocks.

---

## 4. Easy wins we can commit this week

Ordered by ROI:

1. **Phase 0 audit commit.** Strip half the UI prose, iconify where
   safe, consolidate duplicates. Still English-only, but prepares
   the ground. Probably a morning.
2. **Phase 1 extraction commit.** Add `js/i18n.js` with `msg()`
   wrapper (thin shim over `banana-i18n` or even simpler — we
   don't need plurals yet). Move every string to `i18n/en.json`
   with dot-keyed names. A day of mechanical refactor.
3. **Language switcher + Spanish as proof.** Add a `lang=es` URL
   param + localStorage override + language-menu dropdown. Hand-
   translate `i18n/es.json` (or MT-plus-review) to prove the
   pipeline. Half a day once #2 is done.
4. **Parameterise the existing Wikifunctions fetches.** Our
   `typeLabel`, `fetchErrorTypeInfo`, `fetchFunctionSignature` all
   hardcode `Z1002` (English). Thread the current language through
   so Z-type names, function labels, and error messages localise
   automatically. Probably an hour once the user's language
   preference is in a singleton.

These four deliver a translatable UI that already fetches external
content in the user's language, using existing Wikifunctions data,
with no new Wikifunctions pages yet.

Phases 2+ are later commits once we have >1 language in production.

---

## 5. Open questions

- **Translation workflow.** Start with translatewiki.net (standard,
  proven, has translator community) or go Wikifunctions-native
  from the start (dogfooding)? Recommendation: translatewiki for
  Phases 1–2, migrate to Wikifunctions in Phase 3. Lower risk.
- **Font coverage.** Serving fonts that cover Arabic, CJK, Devanagari
  etc. is its own project. Short-term rely on system fonts; medium-
  term consider a subsetted Noto bundle.
- **Block labels on-canvas.** The blocks themselves render function
  names ("multiply (float64) · Z21032 → Float64") which come from
  Wikifunctions and will localise once (4) lands — but the block
  definitions (`def.message0`) are set at registration time. Re-
  registration on language change is cheap (a few ms) but we'll
  need to trigger it when the lang selector changes.
- **Accessibility vs. icon-only UI.** Icons without adjacent text
  are hostile to screen readers. Every `aria-label` becomes a
  translated string. That's fine but bumps the UI-chrome string
  count back up.
- **Wikifunctions rate limits.** Live calls for translated error
  messages (Phase 4) will stress Wikifunctions on anonymous read.
  We'll need to negotiate with the WF team or self-host a caching
  proxy.

---

## 6. Recommended first commit

Just Phase 0 + 1, English-only:

- Audit pass: strip/consolidate ~40% of prose.
- Add `js/i18n.js`, `i18n/en.json`, `i18n/qqq.json`.
- Refactor all user-visible strings through `msg("key")`.
- Convert static HTML text to `data-i18n` attributes + init walker.
- Unit-verify no text still lives in code (grep for likely
  user-facing English words).
- No behavioural change. No language picker yet.

This gets us a clean separation of copy from code; everything else
is downstream of that.

---

## 7. Why this path and not gettext / i18next / intl-messageformat?

- **`banana-i18n` is the Wikimedia standard** and already speaks the
  same placeholder / plural / gender conventions our Wikifunctions
  translations will use. Adopting it aligns us with every other
  Wikimedia-ecosystem project.
- **Zero-build** — we already have no build step beyond the
  `check.mjs` syntax script. Banana-i18n loads as ES module.
- **Familiar to translators** who already contribute to Wikimedia.
- **TranslateWiki supports it natively** when we add that workflow.

Alternatives (`i18next`, `intl-messageformat`, `LinguiJS`) are
fine libraries but pull us out of the Wikimedia ecosystem for no
obvious gain. If we're dogfooding AW for translation at the end of
this road, staying on banana-i18n keeps the conventions aligned all
the way down.
