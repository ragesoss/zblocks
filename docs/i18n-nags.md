# i18n chrome nag worklist

> A snapshot of every UI chrome string that doesn't resolve through
> the Z33668 lexeme pipeline yet, categorised by how it gets fixed.
> Generated from the dogfood-English experiment (commit `cc78056`).
> Use this to focus Wikidata lexeme contribution; once fixes land
> on-wiki, re-running `scripts/build-i18n.mjs --all` picks them up
> with no zblocks code change.

**Summary (as of first run):**
- 129 chrome keys total in `i18n/mappings.json`
- 8 resolved in English (6%) → `i18n/en.json`
- 121 nags (94%): raw keys visible on the UI in strict-dogfood mode
- Live site has been reverted to the hand-written English catalog;
  the dogfood build pipeline and generated de/fr catalogs remain
  shipped as infrastructure

## The Wikidata-actionable pile — 26 English verb lexemes

Each of these has an existing English verb lexeme with no
`P5137 → <concept>` sense linkage. Each fix is roughly a 1-minute
Wikidata edit: **open the lexeme, add a sense that points at the
right concept Q-ID via P5137**. Once landed, `node scripts/build-i18n.mjs --all`
immediately resolves the matching chrome keys — without a deploy.

Priority is roughly by how often each word appears in the UI (how
many `mappings.json` keys share the same lemma).

| Lemma | English lexeme | Candidate concept(s) for P5137 | zblocks keys affected |
|---|---|---|---|
| **cancel** | [L13009](https://www.wikidata.org/wiki/Lexeme:L13009) (verb) | [Q22707738](https://www.wikidata.org/wiki/Q22707738) (cancellation) — or find a better UI-action concept. Existing sense points at Q62782177 "deplatforming" (wrong sense) | `shell_modal.cancel`, `import_modal.cancel`, `run_modal.cancel`, `fill_slots.cancel` (×4) |
| **close** | [L1273](https://www.wikidata.org/wiki/Lexeme:L1273) (verb) | Need a concept for "close a window" / "dismiss a dialog". The noun form L22136 links to Q100064047 "termination" which isn't quite right either | `result_modal.close`, `export_modal.close`, `search_modal.close`, `slot_picker.close` (×4) |
| **run** | [L279](https://www.wikidata.org/wiki/Lexeme:L279) (verb) | Execute-a-program concept. [Q1404771](https://www.wikidata.org/wiki/Q1404771) (execution) is close but UI sense isn't quite matched | `header.buttons.run`, `run_modal.submit` (×2); also `run_modal.submit_busy` "Running…" |
| **loading** (gerund) | — | Progress concept. Depends on "load" verb lexeme sense | `run_modal.test_loading`, `fill_slots.loading`, `search_modal.status.searching`, `search_modal.status.fetching`, `import_modal.submit_busy`, `search_modal.result.pin_busy` / `unpin_busy` (×7) |
| **pin** | [L3791](https://www.wikidata.org/wiki/Lexeme:L3791) (verb) | UI-bookmark / favourite-mark concept. Noun L3790 links to Q828074 (fastening pin, wrong sense) | `search_modal.result.pin`, `search_modal.result.unpin` (×2) |
| **remove** | [L6068](https://www.wikidata.org/wiki/Lexeme:L6068) (verb) | Deletion / removal concept | `shell_modal.args.remove_label` (×1) |
| **apply** | [L5501](https://www.wikidata.org/wiki/Lexeme:L5501) (verb) | Apply-a-change concept | `fill_slots.apply` (×1) |
| **take** | [L3041](https://www.wikidata.org/wiki/Lexeme:L3041) (verb) | "accepts as input" concept — tricky, might need a new Q | `search_modal.filter.takes`, `block.shell_def.takes` (×2) |
| **return** | — (noun L41960 exists with senses) | "produces as output" concept; existing senses (Q65088609 "return") are about returning to a place, not returning a value | `search_modal.filter.returns`, `block.shell_def.returns` (×2) |

Note: "return" as a verb in the programming sense is plausibly
distinct enough from "return to a place" that we may want to propose
a new Q-item for "return a value (computing)" rather than trying to
reuse existing senses. Same possibly for "take".

## Lexeme-noun pile — 5 keys

| Key | Word | Notes |
|---|---|---|
| `result_modal.title_ok` | result | Q2995644 resolves but Z33668 returns the string `"Z575"` — looks like a data bug on one side. Try alternate Q-IDs or investigate Z33668 |
| `literal.item_ref.prefix` | item | Lexeme exists; need sense matching to Wikidata-item-in-software-context concept |
| `literal.property_ref.prefix` | property | Same pattern |
| `block.shell_def.body` | body | Ambiguous senses (body of text, body as corpus, body of a function). Programming sense probably needs its own Q |
| `block.shell_def.source` | source | "source code" concept? Q-ID research needed |

## Compound-phrase pile — 21 keys

Multi-word UI phrases. Options per phrase: **decompose** (look up each word separately + concat — fragile across languages with different word order but workable for a first pass), **simplify** (cut the UI down to a single word), or **wait for AW** (compose via renderer).

| Key | English | Suggested approach |
|---|---|---|
| `header.buttons.add_function` | "+ Add function" | Decompose: `+` + msg("add") + msg("function") |
| `header.buttons.declare_shell` | "Declare function shell" | Simplify UI: button labelled "Declare" (verb only) |
| `header.buttons.export` | "Export ZObject" | Decompose OR drop "ZObject" (inferred) |
| `header.status.no_args` | "no arguments declared" | msg("no") + msg("arguments") |
| `header.example_picker_default` | "Load example…" | msg("load") + msg("example") |
| `shell_modal.title` | "Function shell" | Drop "shell", title is redundant with modal content |
| `shell_modal.field.zid` | "Function ZID" | Drop "ZID" (it's visible from the input format) |
| `shell_modal.field.output` | "Output type" | msg("output") + msg("type") |
| `shell_modal.args.add` | "+ Add argument" | Same as `header.buttons.add_function` pattern |
| `shell_modal.args.name_placeholder` | "argument name" | msg("argument") + msg("name") |
| `import_modal.title` | "Import composition" | Decompose |
| `import_modal.zid_label` | "Fetch by ZID:" | Drop "by ZID:", keep "Fetch" only |
| `run_modal.title` | "Run composition" | Decompose |
| `run_modal.scope_banner` | "Running subtree:" | Decompose or simplify |
| `result_modal.raw_details` | "Raw ZObject" | Drop "ZObject" |
| `result_modal.rerun` | "Run again" | msg("run") + msg("again") |
| `export_modal.title` | "Exported ZObject" | Drop "ZObject" |
| `search_modal.status.none` | "no matches" | Decompose |
| `search_modal.status.zid_match` | "direct ZID match" | Drop "ZID" |
| `context_menu.run_block` | "Run this block" | Decompose |
| `error.unknown_title` | "Unknown error" | msg("unknown") + msg("error") — both concepts exist |

## Prose pile — 46 keys

Full sentences / explanatory hints / confirmations. None dogfoodable
via single lexeme lookups; each needs either deletion from the UI or
eventual AW renderer support. Triage candidates (the ones I'd delete
rather than translate):

Hints that describe-the-obvious, candidates for deletion:
- `header.buttons.add_function_title` ("Search Wikifunctions and pin a function to the sidebar") — tooltip on a button whose label says "+ Add function". Redundant.
- `header.buttons.import_title` ("Import an existing Z14 composition into the workspace") — same
- `header.buttons.run_title` ("Execute the composition via the Wikifunctions API") — obvious
- `shell_modal.hint`, `import_modal.hint`, `run_modal.hint`, `export_modal.hint`, `search_modal.hint`, `fill_slots.hint`, `slot_picker.hint` — all primarily for first-time users; consider moving to a separate "Help" panel users can opt into

Confirmations (might simplify the text but hard to dogfood):
- `shell_modal.confirm_clear`, `import_modal.confirm_replace` — standard "are you sure" prompts

Status / placeholder:
- `search_modal.status.parent_available` ("parent function available to pin") — could live as a glyph or icon
- `run_modal.no_args_subtree`, `run_modal.no_args_workspace` — empty-state prose

The full prose list is in `i18n/mappings.json` under `skip: "prose"`.

## Prose-template pile — 17 keys (stuck without AW)

Parameterised strings like `"$1 doesn't look like a ZID"`. These need
AW renderer support to truly dogfood. Listed in mappings.json under
`skip: "prose-template"`.

## App-specific (4 keys)

- `run_modal.test_unchecked` — "(not checked)" status label
- `import_modal.zid_placeholder` — "Z33608 or Z33682" literal ZID example
- `error.no_errors_entry` — internal diagnostic, low user visibility
- `export_modal.copy_success` — "Copied!" interjection

Probably fine to accept as English / simplify / skip from dogfood
entirely.

## Recommended order of attack

1. **Wikidata edits on the verb lexemes** (above) — biggest leverage,
   compounds across every dogfooded tool, no zblocks code change.
2. **Compound-phrase decomposition** — extend `scripts/build-i18n.mjs`
   to recognise a "decompose" entry type in mappings.json that
   concats multiple concepts with a separator. Ship per-language
   word-order fixes as those land.
3. **Prose deletion pass** — aggressive UI audit; tooltip-redundant
   hints and prose that first-time-users need but return-users don't
   should either go to a separate help panel or be cut.
4. **Return-visit** to dogfood English as a deployed default when
   coverage crosses a threshold (maybe 70%?).

## Related docs

- [`i18n-plan.md`](./i18n-plan.md) — the overall strategy
- [`z33668-build-script-plan.md`](./z33668-build-script-plan.md) — build-script design doc
- [`i18n/missing-lexemes.en.md`](../i18n/missing-lexemes.en.md) — machine-generated missing-lexeme list (regenerated by the build)
- [`i18n/mappings.json`](../i18n/mappings.json) — source-of-truth: concept mappings per key
