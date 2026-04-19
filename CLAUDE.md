# zblocks — orientation for Claude

This file captures context built up over the long greenfield session
that shaped this codebase. Read this before making changes.

## What zblocks is

A Scratch-style block editor for Wikifunctions compositions.
Static webapp (no build step), Blockly + ES modules, deployed to
GitHub Pages. Users declare a function shell, build the composition
as blocks, and either **Run** it via the live Wikifunctions API or
**Export** the JSON to paste into the [`wikilambda-edit-source.js`]
userscript. It also **imports** existing Z14 implementations and
walks up to their parent Z8 for context.

**Live:** <https://ragesoss.github.io/zblocks/>
**Repo:** <https://github.com/ragesoss/zblocks>
**Upstream reference prototype:** YoshiRulz's
[WikiLambdaBlockly](https://gitlab.com/YoshiRulz/WikiLambdaBlockly)
— the IEEE-754 numeric encoder and the lookup-table import pattern
are ports (Apache-2.0; attributed inline and in commit messages).

[`wikilambda-edit-source.js`]: https://github.com/ragesoss/wikifunctioneering/blob/main/userscripts/wikilambda-edit-source.js

## Quick-start

```bash
node check.mjs                                    # syntax-check all ES modules
python3 -m http.server 8765 --bind 127.0.0.1      # dev server
# visit http://127.0.0.1:8765/
```

Both commands are pre-approved in `.claude/settings.local.json`.
Don't reintroduce the ad-hoc `for f in js/*.js; do node --check "$f"` —
it's not allowlisted; `node check.mjs` is.

Deploy is automatic: push to `main`, GitHub Pages rebuilds (~1 min).
Check build status:

```bash
gh api /repos/ragesoss/zblocks/pages/builds | jq '.[0:3] | .[] | {status, commit}'
```

## Codebase map

```
index.html            — static shell + modal dialogs; all user-visible text
                        uses data-i18n* attributes
css/style.css         — all styling
check.mjs             — node-native syntax checker for every js/*.js
package.json          — declares type: module; one script: "check"

i18n/
  en.json             — source-of-truth message catalog (112 keys)
  qqq.json            — translator documentation (one note per tricky key)

js/
  app.js              — entry point; top-level await for i18n + pin rehydrate;
                        wires every event handler
  blocks.js           — synthesises function blocks from FUNCTIONS; builds
                        the toolbox; attaches the customContextMenu
                        (fill-slot / run-this / fill-from-test items)
  literals.js         — primitive literal blocks (string, int, natural,
                        float, bool, item-ref, property-ref, zid-ref)
                        + SHADOW_FOR_TYPE map (incl. compound Z6001 shadows)
  shell.js            — SHELL singleton; setShell (the only sanctioned
                        mutation); shell-modal handlers; toolbox rebuild
  shell_def.js        — wf_shell_def frame block; field sync from SHELL;
                        ensureShellDefBlock(workspace)
  emitter.js          — walk workspace → ZObject JSON. Unwraps wf_shell_def
                        to BODY. emitBlock is exported for runner.js
  importer.js         — ZID / JSON → workspace state. Lookup-table
                        dispatch in PARSERS map. Wraps imported comps in
                        wf_shell_def when a shell is declared.
  runner.js           — wikilambda_function_call wrapper; Z22 envelope
                        unwrap; error payload formatter; input encoding;
                        used-arg detection for Run-modal + Run-this-block
  catalog.js          — wikilambdasearch_functions; lookupByZid;
                        fetchFunctionTests; fetchErrorTypeInfo (Z50 label
                        + per-key labels); normalizeZid; signature cache
  pins.js             — Pinned category lifecycle + localStorage; starter
                        kit seed on first load; rehydratePinnedFunctions
  storage.js          — tiny localStorage helpers; exists to break a
                        circular import between pins.js and shell.js
  numeric.js          — pure encoders/decoders for Z16683/Z13518/Z20838.
                        Both emitter AND runner import from here so their
                        output matches byte-for-byte.
  type_labels.js      — static ZID→label map + typeLabel(zid, {withZid})
                        helper. Falls through to raw ZID on unknown.
  slot_picker.js      — context-aware empty-slot picker modal
  i18n.js             — minimal banana-compatible runtime (~60 lines);
                        msg() + DOM walker for data-i18n attributes
  examples.js         — the frequency-of-MIDI-note worked example
  wikidata_search.js  — USER-AUTHORED. Used by slot_picker for
                        Wikidata-item slots. Don't casually edit.

zobjects/ (parent repo)  — reference .comp.json / .tester.json specs

docs/
  i18n-plan.md        — phased path to Wikifunctions-hosted translations

zblocks_sess          — user's resume shortcut; not a tracked artifact
```

## Design principles that matter

### Type-check everywhere has `Z1`
Every block's `output` check array includes `"Z1"`, and every slot's
`input_value.check` includes `"Z1"`. That makes `Z1` a bidirectional
wildcard matching the Wikifunctions runtime's behaviour exactly.
**Don't remove this.** If you ever find yourself writing `check: ["Z6"]`,
you want `check: ["Z6", "Z1"]`.

Exception: `wf_zid_ref` output is `["Z9", "Z1"]` (Z9 + Z1); a few
value blocks that literally return Z1 use just `["Z1"]`.

### `typeLabel(zid, {withZid: true})` everywhere a Z-ID surfaces
The user's principle: "ZIDs are necessary but not sufficient." Any
UI that shows a raw ZID without a human label is a bug. The helper
falls through to the raw ZID for unknowns — so it never lies, and
we know what to add to `type_labels.js` when we see naked ZIDs.

### Numeric values never round-trip through bare field serialisation
Integers (Z16683), naturals (Z13518), and especially Float64 (Z20838)
have structured multi-field representations. The encoder/decoder in
`js/numeric.js` is the single source of truth. Reinventing sign/digits
or IEEE-754 bit-packing inline is the fastest way to introduce a
silent correctness bug. Import from `numeric.js`.

Specifically: Float64 is NOT wrapped in a `Z20915("string → float64")`
call anymore (that was the pre-`ae4ac70` behaviour). The emitter
produces a full Z20838 IEEE-754 structure directly. The importer
still recognises legacy Z20915 wrappers for back-compat.

### Canonical vs expanded ZObject form
Wikifunctions' wire format is **canonical** — bare strings for Z6 and
Z9 references in positions where the type is unambiguous. Our emitter
produces the **expanded** form (`{Z1K1: Z6, Z6K1: "foo"}`). The server
normalises on save. Our parsers have to handle both:

```js
const v = typeof x.Z20838K4.Z20825K1 === "string"
  ? x.Z20838K4.Z20825K1
  : x.Z20838K4.Z20825K1?.Z9K1;
```

This `asScalar` idiom appears in multiple places. When adding a new
parser, assume bare strings OR wrapped Z6/Z9 objects.

### Arg references are per-shell runtime-registered blocks
When the user declares a shell with N arguments, we dynamically
register `wf_arg_0` through `wf_arg_{N-1}` as Blockly blocks.
`ARG_REF_META` maps block type → `{key, label, type}`. On shell
change, we unregister old arg-ref blocks and register fresh ones.

**If you find yourself about to mutate `SHELL.args` directly, stop**
and call `setShell()` instead. Direct mutation leaves
`ARG_REF_META` stale and the toolbox wrong.

### The shell-def frame is the visible function definition
`wf_shell_def` is a top-level frame block (no output, no
previous/next) that renders SHELL as a "def / takes / returns / body"
card. Its BODY input holds the composition. The emitter's
`emitWorkspace` unwraps this frame automatically — so emission is
transparent. BODY's check is pinned to `SHELL.outputType`; changing
the shell's output may disconnect an in-progress body.

### Bare ZIDs in canonical JSON use `wf_zid_ref`
`Z14310K1: "Z32534"` in a composition isn't a string, it's a Z9
reference in canonical form. The importer routes any `/^Z\d+$/`
bare string (other than Z41/Z42) through `wf_zid_ref`. Don't
"simplify" this by treating it as a string.

### Labels (including error-type labels) are mostly fetched live
`fetchErrorTypeInfo(zid)` resolves Z50 error types' label +
description + per-key names. `typeLabel` has a small static cache;
anything missing falls through to the raw ZID. Function labels,
arg labels, type labels on search results — all fetched. The only
truly-static chrome is in `i18n/en.json`.

### i18n keys are dot-paths, translators use $1/$2 + {{PLURAL}}
Banana-i18n-compatible so we can drop in the real library (with
CLDR plural rules, gender, grammar) when a non-English language
needs it. The current minimal runtime only implements PLURAL as
`$1 === 1` — good enough for English, not for Russian / Arabic /
Polish. `banana-i18n` swap is noted in `docs/i18n-plan.md`.

When adding new UI chrome text, add a key to `i18n/en.json` + a
note to `qqq.json`, and use `msg("key.path")` in code. Never
inline English in DOM-producing code.

## Workflow conventions

### Commits
- One logical change per commit. The session's history reads well
  as a changelog; keep it that way.
- Commit messages explain **why**, not just what, and mention the
  symptoms when fixing user-reported bugs ("User reported: import
  of Z32582 fails with…").
- Attribution line at the bottom:
  `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- When porting code from WikiLambdaBlockly or other sources, name
  the source + license in the commit body AND inline in the file.

### Don't commit without syntax check
`node check.mjs` before every commit. It's fast and catches broken
imports/syntax before the user sees a white page.

### Don't commit without i18n sweep if you touched UI
Easy to leave an English string inline by accident. `grep` your
diff for likely user-facing words; if you find any, add a key.

### Deploy pipeline
Push → Pages builds → live in ~60s. No CI gates. Gates are
self-discipline: syntax check + round-trip test if you touched
numeric/importer/emitter.

## Fragile areas — things that break silently

### Module import order
`app.js` has a specific initialization sequence at the top:

```js
await initI18n("en");          // 1. must precede DOM-text-using code
registerAllBlocks();            // 2. defines Blockly block types
seedStarterKitIfFirstRun();    // 3. populates pin list on first run
await rehydratePinnedFunctions(); // 4. fetches pinned signatures
const workspace = Blockly.inject(...);  // 5. renders with toolbox
initShell(workspace);          // 6. sets workspace, rebuilds toolbox
initSlotPicker();              // 7. wires picker DOM
// … event handlers
```

Reordering usually breaks something quietly:
- Moving i18n later → static HTML shows raw i18n keys
- Moving register after inject → blocks missing from initial toolbox
- Moving rehydrate after inject → Pinned category empty on first render

### Circular imports
A fragile triangle:
- `shell.js` ←→ `shell_def.js` (shell_def reads SHELL; shell calls refresh)
- `pins.js` ←→ `shell.js` would cycle; `storage.js` exists to break it
- `blocks.js` imports `shell_def.js`; `shell_def.js` imports `shell.js`;
  `shell.js` imports `blocks.js` — works only because each only calls
  the others at function-call time, never at module-load time

**Rule:** new cross-module imports should only call the imported
symbols at function call time, not at module load time. If you need
a value at module load, put it in `storage.js` or a similar
dependency-free leaf.

### setShell vs direct SHELL mutation
`setShell({zid, outputType, args, label?, sourceZid?, sourceLabel?})`
is the ONLY sanctioned mutation. It:
1. Updates SHELL fields
2. Unregisters old `wf_arg_N` block types
3. Registers new ones reflecting new args
4. Rebuilds the toolbox
5. Updates the header status
6. Refreshes any wf_shell_def blocks in the workspace

Direct mutation of `SHELL.args` or similar skips 2-6 and everything
silently goes out of sync.

### Canonical form in new parsers
See "Canonical vs expanded ZObject form" above. Anywhere you read
a Z-scalar from an untrusted payload, unwrap via the `asScalar`
idiom. Forgetting this produces parsers that work against our own
emitter's output but fail on real Wikifunctions data.

### Numeric round-trips
The Float64 IEEE-754 encoder handles ±0, ±Inf, NaN, and subnormals
as distinct cases. Do NOT simplify by folding them into the normal
path — the server rejects malformed special values.

Integers encode sign separately (Z16660 / Z16661 / Z16662 for
pos/zero/neg), then absolute-value digits. The sign for `0` is
Z16661 (not Z16660); decoding a Z16683 that arrives with Z16661
must return exactly `0`, not `-0`.

### Shell-def block is special
- No output, no previous/next → floats at top of workspace
- Undeletable (`setDeletable(false)` in its init extension)
- BODY input check pinned to `SHELL.outputType`
- On SHELL change, `refreshAllShellDefBlocks` re-syncs fields +
  BODY check. If BODY type mismatch, Blockly disconnects.

Moving shell-def logic around is easy to get wrong. The key pieces:
- It must be registered in `registerAllBlocks` BEFORE the toolbox
  renders
- `ensureShellDefBlock(workspace)` is the only code path that
  creates one manually (the import/example flows include it in
  their loaded state JSON)

### wikilambda_fetch batch uses `|` not `,`
Getting this wrong returns `Z549: Invalid reference`. Only
`fetchFunctionTests` currently uses batch fetch; new callers beware.

### Blockly serialization nuances
- Block state keys: `type`, `fields`, `inputs`, `deletable`, `x`, `y`
- Connection target: `inputs.NAME.block` OR `inputs.NAME.shadow`
- `setShadowState` accepts the same nested format → compound
  shadows work: `{type, inputs: {K1: {shadow: {type, fields: {...}}}}}`
- After `workspace.clear()`, block types stay registered but
  instances are gone; rehydrate happens via `workspaces.load`

### Customn context menus must be attached after block definition
`Blockly.Blocks[type].customContextMenu = fn` works only after
`defineBlocksWithJsonArray` has run. `registerAllBlocks` and
`registerFunctionBlock` both call `attachSlotPickerMenu` — if you
bypass them, right-click menu is missing Fill Slot / Run / etc.

### i18n DOM walker runs once
`initI18n()` walks `[data-i18n*]` attributes once. Dynamic HTML
must use `msg()` directly. Adding new modals = adding new i18n
keys + attributes; missing any → English leaks through.

### Canonical error-shape assumptions
`runner.js` unpacks `Z22K2.K1` as a list of `{K1, K2}` pairs.
Sometimes Wikifunctions returns typed-list head markers in that
list (a first entry with `Z1K1: Z7, Z7K1: Z882, ...`). The
extractor filters by `p.K1 === "errors"` which already handles
this. Don't assume index positions when walking it.

## Test plan (not yet implemented)

The areas below are high-value and low-cost-to-test. Most can be
pure-data tests with no Blockly dependency. Recommended runner:
`node --test` (built-in, no new deps).

### Tier 1 — pure-data (trivial to write)
These don't need Blockly or a browser. Start here.

- **`numeric.js` round-trips**
  - `encodeInteger(n) → decodeInteger(obj) === n` for sampled n
    including 0, ±1, ±max-safe-int
  - `encodeFloat64(x) → decodeFloat64(obj) === x` or `Object.is`
    for `0`, `-0`, `+Inf`, `-Inf`, `NaN`, `0.1`, `1e-100`, `1e300`,
    and a handful of subnormals (1e-323)
  - `encodeNatural(n)` rejects negatives, accepts `0`
  - Special-value markers: Z20829/30/31/32/33/34 round-trip to the
    matching JS value

- **`runner.formatErrorPayload`**
  - Z6 / Z9 / Z39 / Z6091 / Z6092 / Z40 unwrap to bare values
  - Z16683 unwraps with correct sign
  - Nested Z5 renders as `<zid> — <msg>`
  - Multi-field Z5K2 renders as one line per K<n>

- **`catalog.normalizeZid`**
  - `"z33605"`, `"  Z33605  "`, `"Z33605"` → `"Z33605"`
  - `"q1"`, `""`, `"Z"` → `null`

- **`runner.encodeInput`**
  - Z6 input → `{Z1K1: Z6, Z6K1: value}`
  - Z6001 QID auto-wraps in Z6821
  - Z40 "true"/"false" → "Z41"/"Z42"
  - Raw JSON passthrough for values starting with `{` or `[`

- **`i18n.msg`**
  - Missing key returns the key
  - `$1` substitution
  - `{{PLURAL:$1|one|many}}` with n=1 vs n=5
  - Multiple params substituted in order

### Tier 2 — importer/emitter data flow (moderate)
These need mock block objects (simple JS objects matching Blockly's
public API surface for getInputTargetBlock / getFieldValue / type).

- **`importer.exprToBlockSpec` round-trip with fake emit**
  - Every literal type produces the right spec
  - Bare ZIDs → `wf_zid_ref`
  - Legacy Z20915 wrapper collapses to `wf_float`
  - Nested Z7 calls recurse correctly
  - Z18 args need a shell in context — use a fixture

- **`emitter.emitBlock` with mock blocks**
  - Each literal block type emits the right shape
  - Function call walks `fn.args` in order
  - Missing arg throws EmitError

- **Fixtures from `zobjects/*.comp.json`**
  - Load a real composition spec
  - Import → workspace state (JSON)
  - Emit the state → ZObject
  - Compare to the original (ignoring key ordering)

### Tier 3 — browser integration (higher cost)
Playwright or similar headless-browser harness. Lower priority
until tier 1+2 exists.

- **Blockly workspace state round-trip**: construct a workspace
  programmatically, emit, import into a fresh workspace, diff.
- **Shell-def BODY type check**: declare shell → wf_shell_def
  appears → change output type → BODY disconnects if types
  mismatch → existing body preserved if compatible.
- **Live API smoke**: run the frequency-of-MIDI-note example →
  expect ~430 Hz (content; may drift with Wikidata edits — use a
  tolerance).
- **i18n load**: initI18n actually populates `[data-i18n]` nodes.

### When tests belong
For most of what we do, committing without tests is fine because
the change is visibly verifiable at `http://127.0.0.1:8765/`. Tests
earn their keep when:
1. A bug was reported that a unit test would have caught (all of
   Tier 1 is populated by session-history bugs — the Z507 payload
   extractor, bare-ZID handling, case-insensitive ZIDs).
2. The change touches numeric encoding, round-trip, or error
   extraction (areas where silent correctness bugs are cheapest
   to cause and most expensive to diagnose).

## Don't-do list

- **Don't edit `js/wikidata_search.js` casually.** User-authored.
- **Don't add the Blockly dependency as a local file.** It's
  intentionally loaded from unpkg; no bundler, no package-lock.
- **Don't use `innerHTML = "user-text"` without `escapeHtml`.**
  Search-result labels, error payloads, arg labels — all flow
  from untrusted external data.
- **Don't hit `wikilambda_fetch` without `origin=*`.** CORS will
  block the response, and you'll see an opaque failure.
- **Don't assume the user's workspace is empty.** Destructive
  operations prompt via `confirm()`.
- **Don't auto-commit.** The user explicitly asks for commits.

## What's in flight / likely next

From the current plan:
- i18n Phase 2: language picker + other-language catalogs +
  parameterise the Wikifunctions label fetches
- i18n block-text localisation: translate the shell-def frame
  labels ("def / takes / returns / body") and function block
  titles (requires block re-registration on language change)
- Errors from `emitter.js` / `importer.js` / `runner.js` still
  English — own pass
- A first non-English language wired up end-to-end as a proof

## The golden path for a fresh session

1. Read this file. Read `docs/i18n-plan.md` if touching i18n.
2. `node check.mjs` to confirm baseline.
3. Start the dev server: `python3 -m http.server 8765 --bind 127.0.0.1`.
4. Reproduce the user's concern in the browser before coding.
5. Make the smallest change that solves it.
6. `node check.mjs` again.
7. If numeric / importer / emitter touched, smoke-test a round-trip.
8. `git status`, stage, descriptive commit, push.
9. Report what landed and what deferred.
