# zblocks — block-based composition UI for Wikifunctions

A Scratch-style visual editor for authoring Wikifunctions compositions
that outputs canonical ZObject JSON. Paste the output into the
[`wikilambda-edit-source.js`](https://github.com/ragesoss/wikifunctioneering/blob/main/userscripts/wikilambda-edit-source.js)
userscript's "Edit Raw JSON" / "Create Raw JSON" widget on Wikifunctions.

## Why

The Wikifunctions Codex composition editor has well-documented friction:
Vue menus that won't commit on synthetic clicks, pre-populated lookups
that resist clearing, slots that silently keep hidden inputs from prior
modes, collapsed-by-default UI. See
`../docs/browser-automation-strategies.md` and
`../docs/session-notes/2026-04-17-*.md` for the gory details.

Compositions are tree-shaped (Z7 call nodes recursively containing Z7 /
Z18 / literal children). That's exactly Blockly's native model:
nested value blocks with typed connection slots. A block UI removes
the entire class of UI-layer bugs the browser-automation toolkit has
been papering over.

## Library choice: Blockly

- Models nested expression trees natively (value blocks with `output` +
  `input_value` slots).
- Typed connections via string-array `check` — maps cleanly onto
  Z-types, with `Z1` as a universally-appended wildcard.
- JSON block definitions + `Blockly.common.defineBlocksWithJsonArray`
  support runtime registration (important for a growing function
  catalog).
- Custom code generators walk the block tree and emit any string —
  ideal for ZObject JSON.
- MIT licensed; active maintenance (moved to the Raspberry Pi
  Foundation in November 2025).

Scratch Blocks is a Blockly fork optimized for C-shape *statement*
blocks with a VM instead of generators — wrong shape for expressions.
Rete.js / React Flow / Drawflow are node-graph editors; compositions
are trees, and graph wires become spaghetti at three levels deep.

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│   static site (eventually hosted anywhere — GitHub Pages etc)│
│                                                               │
│  ┌──────────────────┐    ┌───────────────────────────────┐    │
│  │ sidebar toolbox  │    │ Blockly workspace             │    │
│  │  categories ▸    │───▶│                               │    │
│  │  — math (float)  │    │   ┌──── multiply ────┐        │    │
│  │  — math (int)    │    │   │ × ref_frequency   │       │    │
│  │  — logic         │    │   │ × 2^( ... )       │       │    │
│  │  — string / list │    │   └───────────────────┘       │    │
│  │  — wikidata      │    │                               │    │
│  │  — type conv.    │    │                               │    │
│  │  — literals      │    │   [ Export ZObject JSON ]     │    │
│  │  — ⟨function      │    └───────────────────────────────┘    │
│  │     arguments⟩   │                                          │
│  └──────────────────┘                                          │
└───────────────────────────────────────────────────────────────┘
```

**Data layer.** Phase 1: hardcoded registry of ~30 common functions.
Phase 2: precomputed `functions-index.json` from `../cache/_index.jsonl`,
searched/filtered client-side. Phase 3: fall back to live
`wikilambda_search_labels` API for fresh objects.

**Block types.**
- One per registered Wikifunctions function (synthesized from
  `{zid, label, args, output}`).
- Literals: string (Z6), integer (Z16683 with sign+digits at emit
  time), boolean (Z40 → Z41/Z42), float (Z20838, wrapped via Z20915),
  item ref (Z6091), property ref (Z6092).
- Z18 argument references: one block per declared shell argument,
  registered when the shell is declared/updated.

**Type matching.** Every output check includes `"Z1"`; every input
check includes `"Z1"`. This models Z1 as a bidirectional wildcard
exactly as the runtime treats it. Parameterized generics (Z881&lt;T&gt;)
are flattened to `"Z881"` in Phase 1 — element-type enforcement is
a Phase 3 refinement.

**Emitter.** A recursive walker on the Blockly block tree:
- Function-call block → `{Z1K1: Z7, Z7K1: <zid>, <argKeyN>: emit(child)…}`
- Z18 ref block → `{Z1K1: Z18, Z18K1: <argKey>}`
- Literal block → typed literal (wrapped form for Z6/Z6091/Z6092/Z16683,
  bare-ZID string for Z40 → Z41/Z42, Z20915-wrapped Z6 string for Z20838).

## Paste targets

The userscript accepts two forms:
1. **Edit Raw JSON on an existing Z14** — paste replaces the whole Z14
   body. User is responsible for keeping Z14K1 / Z14K3 / labels intact.
   Simplest approach: paste just the composition into the Z14K2 field
   within the editor before saving.
2. **Create Raw JSON** — paste a full Z2-wrapped Z14 (new
   implementation attached to an existing Z8). Uses `Z2K1 = {Z1K1:Z6,
   Z6K1:"Z0"}` placeholder; the server assigns the real ZID on save.

Phase 1 outputs the bare composition (Z7 tree) — the unit the user
most often iterates on. Phase 2 adds the Z2+Z14 wrapping toggle.

## Roadmap

### Phase 1 — standalone prototype (scope of this cut)
- Static HTML + Blockly UMD + vanilla JS.
- ~30 hardcoded functions covering math, logic, strings, lists, type
  conversion, core Wikidata access.
- Literal blocks for all primitive types actually used in hand-written
  compositions.
- Function-shell declaration form (ZID, output type, ordered args).
- Z18 argument-reference blocks synthesized from the shell.
- Export modal: canonical ZObject JSON, copyable.
- No server, no build step, no dependencies beyond the CDN Blockly.

### Deferred: context-aware empty-slot picker
When a slot's type has no literal shadow (Z6001 Wikidata item, Z6003
statement, Z881 list, Z60 language, etc.), users currently can't
discover what would fit without scanning the full toolbox. Plan:
click an empty slot → popover listing (a) every literal block whose
output includes the slot's type, (b) every function block whose
output includes the slot's type, (c) every currently-declared
argument whose type matches. Pick one → instantiate + connect.
Blockly does not ship this; ~half a day of custom work
(connection click handler, filter toolbox entries by check overlap,
render a popover, instantiate via `workspace.newBlock` +
`setShadowState`). Pairs well with the round-trip parser (Phase 3)
since both need type-overlap logic.

### Phase 2 — full catalog + search
- Build `functions-index.json` from `../cache/_index.jsonl`.
- Sidebar search filters the toolbox live.
- On-demand block registration for arbitrary functions from the index.
- Wikidata QID/PID autocomplete via `wbsearchentities`.
- Z2+Z14 wrapping toggle; label/description fields in the shell form.

### Phase 3 — round-trip + integration
- Parse an existing Z14 back into Blockly blocks (load-by-ZID).
- Client-side composition runner (mirror of `composition_run.py`) for
  pre-paste validation against the Wikifunctions orchestrator.
- Export as `.comp.json` spec for the `wf.rb` toolkit.

### Phase 4 — polish
- localStorage draft persistence (Blockly's workspace serializer).
- Type-generic enforcement (Z881&lt;T&gt; checks).
- Custom Z16683 field (sign dropdown + digits input) matching the
  on-wiki editor.
- Multi-implementation workspaces, dark mode / Wikifunctions theme.

## Key design constraints

- **No secrets in client.** No API tokens, no direct `wikilambda_edit`
  POSTs — that needs session auth (see
  `../docs/session-notes/2026-04-17-raw-json-userscript-route.md`).
  The boundary is copy-paste into the already-authenticated
  userscript editor.
- **Arg keys are `<functionZID>Kn`.** For edits, the function already
  has a ZID; for new-function + new-implementation bundles, use
  `Z0K1`/`Z0K2`/… and rely on the server's ZID assignment. Phase 1
  covers the edit case.
- **Float64 never emitted as a raw literal.** Always wrap a Z6 string
  with a Z20915 call — same convention as
  `../scripts/wf_zobject_emitter.rb` and the tester spec examples.
