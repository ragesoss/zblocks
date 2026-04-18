# zblocks

A Scratch-style block editor for Wikifunctions compositions.
Outputs canonical ZObject JSON for copy-paste into the
[`wikilambda-edit-source.js`](https://github.com/ragesoss/wikifunctioneering/blob/main/userscripts/wikilambda-edit-source.js)
userscript.

**Status:** Phase 1 — standalone prototype. See [PLAN.md](PLAN.md).

## Run

No build step. Open `index.html` in a browser, or serve the directory:

```bash
python -m http.server 8000
# visit http://localhost:8000
```

Blockly is loaded from unpkg; first load needs network.

## Use

1. **Declare function shell** — enter the target function's ZID
   (e.g., `Z33682`), its output type (e.g., `Z20838`), and its
   ordered arguments. Each argument becomes a draggable reference
   block in the sidebar.
2. **Compose** — drag function blocks and literal blocks from the
   sidebar into the workspace. Type-checked input slots reject
   incompatible blocks.
3. **Export ZObject** — click the Export button. Copy the JSON.
   On Wikifunctions, open an existing implementation and click
   "Edit Raw JSON"; replace the `Z14K2` field value with the
   exported composition, then Save.

## Layout

```
index.html          # entry point
css/style.css       # layout
js/
  functions.js      # registry of known Wikifunctions functions
  literals.js       # literal-block definitions (Z6, Z16683, Z40, ...)
  blocks.js         # Blockly block registration + toolbox builder
  shell.js          # function-shell modal + Z18 arg-ref blocks
  emitter.js        # Blockly workspace → ZObject JSON
  app.js            # main wiring
```
