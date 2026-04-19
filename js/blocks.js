// Synthesize Blockly block definitions from the function registry and
// register them. Also builds the initial toolbox.
//
// Design notes:
//  - Type matching: every input check and output check includes "Z1".
//    This models Z1 as a bidirectional wildcard — the runtime treats
//    Z1 inputs/outputs as accepting anything; Blockly's overlap-check
//    rule ("connections match if they share any string, or either is
//    null") gives us the same behaviour.
//  - Layout: one label row for the function title, then one row per
//    argument with its label and an external value input. This scales
//    cleanly to N args and makes arg order unambiguous at a glance.
//    Tradeoff vs inline Scratch-style: more vertical space, less
//    ambiguity — worth it for compositions that can be 5 levels deep.

import { FUNCTIONS, CATEGORIES } from "./functions.js";
import { LITERAL_BLOCKS, LITERAL_TOOLBOX, SHADOW_FOR_TYPE } from "./literals.js";
import { typeLabel } from "./type_labels.js";
import { openSlotPicker } from "./slot_picker.js";
import { registerShellDefBlock } from "./shell_def.js";
import { openWikidataSearch } from "./wikidata_search.js";

const SHADOW_EXTENSION = "wf_attach_shadows";

// Registered once; attaches a shadow literal to every input whose
// declared type matches SHADOW_FOR_TYPE. Runs on each block instance
// after jsonInit, so it fires both when dragged from the toolbox and
// when deserialized from workspace state.
function registerShadowExtension() {
  if (Blockly.Extensions.isRegistered(SHADOW_EXTENSION)) return;
  Blockly.Extensions.register(SHADOW_EXTENSION, function () {
    // `this` is the freshly-initialised block.
    for (const input of this.inputList) {
      if (!input.connection) continue;
      const check = input.connection.getCheck();
      if (!check) continue;
      const primaryType = check[0];
      const shadow = SHADOW_FOR_TYPE[primaryType];
      if (!shadow) continue;
      try {
        input.connection.setShadowState(shadow);
      } catch (e) {
        // Shadow state rejected (e.g. block type not yet registered).
        // Non-fatal — the slot just stays empty.
        console.warn(`Could not attach shadow to ${this.type}.${input.name}:`, e);
      }
    }
  });
}

function outputCheck(type) {
  // "Z1" means accept-anywhere; declare the bare type + Z1 so slots
  // typed for this specific type also match.
  return type === "Z1" ? ["Z1"] : [type, "Z1"];
}

function inputCheck(type) {
  return type === "Z1" ? null : [type, "Z1"];
}

function functionBlockDef(fn, colour) {
  const argList = fn.args.map(a =>
    `${a.label}: ${typeLabel(a.type, { withZid: true })}`
  ).join(", ");
  const outputLabel = typeLabel(fn.output, { withZid: true });
  const def = {
    type: `wf_${fn.zid}`,
    colour,
    output: outputCheck(fn.output),
    inputsInline: false,
    extensions: [SHADOW_EXTENSION],
    tooltip: `${fn.label} — ${fn.zid}\n(${argList}) → ${outputLabel}`,
    helpUrl: `https://www.wikifunctions.org/wiki/${fn.zid}`,
  };

  // Row 0: label · ZID → output. The ZID is explicit so you can
  // cross-reference the Wikifunctions page or paste into search.
  def.message0 = `${fn.label} \u00B7 ${fn.zid} → ${typeLabel(fn.output)}`;

  // Rows 1..N: one per arg, labelled with a human-readable type hint.
  fn.args.forEach((arg, i) => {
    const n = i + 1;
    def[`message${n}`] = `${arg.label} (${typeLabel(arg.type)}) %1`;
    def[`args${n}`] = [{
      type: "input_value",
      name: arg.key,
      check: inputCheck(arg.type),
      align: "RIGHT",
    }];
  });

  return def;
}

export function registerAllBlocks() {
  const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray)
    || Blockly.defineBlocksWithJsonArray;

  // Shadow extension must be registered before any block that uses it
  // is defined.
  registerShadowExtension();

  // Shell-def frame block: top-level implementation boundary.
  registerShellDefBlock();

  // Literals first (so shadow attachments can reference them by type).
  define(LITERAL_BLOCKS);
  // Wikidata-ref literals get a "Search Wikidata…" context action so
  // users can look up a Q/P number by label instead of typing it.
  attachWikidataSearchMenu("wf_item_ref", "item");
  attachWikidataSearchMenu("wf_property_ref", "property");

  // Function blocks, coloured by category.
  const defs = FUNCTIONS.map(fn => {
    const cat = CATEGORIES.find(c => c.name === fn.category);
    const colour = cat ? cat.colour : 0;
    return functionBlockDef(fn, colour);
  });
  define(defs);
  // Attach the slot-picker context menu after defs are registered so
  // Blockly.Blocks[type] exists for each.
  for (const def of defs) attachSlotPickerMenu(def.type);
}

// Register a single function block at runtime. Used by the catalog
// search flow when a user pins a new function from Wikifunctions.
// Safe to call multiple times for the same ZID — the second registration
// just overwrites the first block definition.
export function registerFunctionBlock(fn) {
  if (!FUNCTIONS.some(f => f.zid === fn.zid)) {
    FUNCTIONS.push(fn);
  } else {
    // Update the existing registry entry (e.g. after a signature change).
    const idx = FUNCTIONS.findIndex(f => f.zid === fn.zid);
    FUNCTIONS[idx] = fn;
  }
  const cat = CATEGORIES.find(c => c.name === fn.category);
  const colour = cat ? cat.colour : 180;
  const def = functionBlockDef(fn, colour);
  const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray)
    || Blockly.defineBlocksWithJsonArray;
  define([def]);
  attachSlotPickerMenu(def.type);
}

// Attach a right-click context-menu contribution to a block type.
// Contributes two kinds of items:
//   - "Fill '<arg>'…" once per empty value input, opens the slot
//     picker for that connection.
//   - "Run this block" at the bottom, dispatches a DOM event that
//     app.js picks up to open the Run modal scoped to this subtree.
// Safe to re-run for the same type (overwrites).
function attachSlotPickerMenu(blockType) {
  const blockDef = Blockly.Blocks[blockType];
  if (!blockDef) return;
  blockDef.customContextMenu = function (options) {
    const zid = this.type.startsWith("wf_Z") ? this.type.slice(3) : null;
    const fn = zid ? FUNCTIONS.find(f => f.zid === zid) : null;
    for (const input of this.inputList) {
      if (!input.connection) continue;
      if (input.connection.isConnected()) continue;
      const argEntry = fn?.args.find(a => a.key === input.name);
      const slotLabel = argEntry?.label || input.name;
      const slotType  = argEntry?.type  || (input.connection.getCheck()?.[0]) || "Z1";
      options.push({
        text: `Fill "${slotLabel}"\u2026`,
        enabled: true,
        callback: () => openSlotPicker({
          connection: input.connection,
          slotLabel,
          slotType,
        }),
      });
    }
    // For function-call blocks, offer a "Fill slots from test" entry
    // so the user can grab known-good inputs (QIDs, integers, etc.)
    // from the function's own Z20 testers without hunting them down
    // manually.
    if (zid && fn && fn.args.length > 0) {
      const block = this;
      options.push({
        text: `Fill slots from test\u2026`,
        enabled: true,
        callback: () => {
          document.dispatchEvent(new CustomEvent("zblocks-fill-slots", {
            detail: { block, zid, fn },
          }));
        },
      });
    }
    // Only offer Run for value blocks (which all wf_* blocks are).
    if (this.outputConnection) {
      const block = this;
      options.push({
        text: "Run this block",
        enabled: true,
        callback: () => {
          document.dispatchEvent(new CustomEvent("zblocks-run-block", {
            detail: { block },
          }));
        },
      });
    }
  };
}

// Context-menu "Search Wikidata…" for the wf_item_ref / wf_property_ref
// literal blocks. Seeds the search from the block's current field value
// (unless it's the default "Q" / "P" placeholder); on pick, sets the
// field to the chosen entity ID.
function attachWikidataSearchMenu(blockType, entityType) {
  const blockDef = Blockly.Blocks[blockType];
  if (!blockDef) return;
  blockDef.customContextMenu = function (options) {
    const block = this;
    options.push({
      text: "Search Wikidata\u2026",
      enabled: true,
      callback: () => {
        const current = block.getFieldValue("VALUE") || "";
        const seed = (current === "Q" || current === "P") ? "" : current;
        openWikidataSearch({
          entityType,
          initialQuery: seed,
          onSelect: ({ id }) => block.setFieldValue(id, "VALUE"),
        });
      },
    });
  };
}

export function buildToolbox() {
  const categories = CATEGORIES.map(cat => ({
    kind: "category",
    name: cat.name,
    colour: cat.colour,
    // Pinned is driven by the pin list (localStorage), patched in by
    // rebuildToolbox. Leave it empty here to avoid double-entry for
    // catalog-fetched functions (which carry category === "Pinned").
    contents: cat.name === "Pinned" ? [] : FUNCTIONS
      .filter(fn => fn.category === cat.name)
      .map(fn => ({ kind: "block", type: `wf_${fn.zid}` })),
  }));

  // Literals as their own category.
  categories.push(LITERAL_TOOLBOX);

  // Arguments category — populated dynamically by shell.js when the
  // user declares their function shell. Start empty; shell.js calls
  // workspace.updateToolbox with the filled-in version.
  categories.push({
    kind: "category",
    name: "Function arguments",
    colour: 60,
    contents: [],
  });

  return {
    kind: "categoryToolbox",
    contents: categories,
  };
}
