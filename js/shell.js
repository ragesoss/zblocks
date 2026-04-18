// Function shell declaration + Z18 argument-reference blocks.
//
// The shell is the Z8 the composition implements: a ZID, an output
// type, and an ordered list of arguments. Arg keys are synthesised as
// `${zid}K${i+1}`. When the shell is saved, we dynamically register
// one `wf_arg_<idx>` block per argument, with its output check pinned
// to the declared type. The emitter uses ARG_REF_META to translate
// these blocks into `{Z1K1: Z18, Z18K1: <argKey>}` nodes.
//
// Phase 1: changing the shell clears the workspace. Reusing existing
// arg-ref instances across a schema change is fiddly and not worth it
// for a prototype.

import { buildToolbox } from "./blocks.js";
import { FUNCTIONS } from "./functions.js";
import { loadPinnedZids } from "./storage.js";

export const SHELL = {
  zid: "",           // empty until declared
  outputType: "Z1",
  args: [],          // [{ label, type }]
};

// Map block type → { key, label, type }. Emitter reads this.
export const ARG_REF_META = {};

let workspace = null;

export function initShell(ws) {
  workspace = ws;
  wireModal();
  // Populate Pinned tab from the rehydrated pin list now that the
  // workspace is available.
  rebuildToolbox();
}

function wireModal() {
  document.getElementById("open-shell-btn").addEventListener("click", openShellModal);
  document.getElementById("shell-add-arg").addEventListener("click", addArgRow);
  document.getElementById("shell-cancel").addEventListener("click", closeModal);
  document.getElementById("shell-save").addEventListener("click", saveShell);
}

function openShellModal() {
  // Pre-fill from current state.
  document.getElementById("shell-zid").value = SHELL.zid;
  document.getElementById("shell-output").value = SHELL.outputType;
  const argsDiv = document.getElementById("shell-args");
  argsDiv.innerHTML = "";
  SHELL.args.forEach(arg => addArgRow(null, arg));
  if (SHELL.args.length === 0) addArgRow();
  document.getElementById("shell-modal").showModal();
}

function closeModal() {
  document.getElementById("shell-modal").close();
}

function addArgRow(_event, preset) {
  const row = document.createElement("div");
  row.className = "shell-arg";
  row.innerHTML = `
    <input type="text" class="shell-arg-label" placeholder="argument name"
           value="${preset?.label ?? ""}">
    <input type="text" class="shell-arg-type" placeholder="type ZID (e.g. Z20838)"
           value="${preset?.type ?? ""}">
    <button type="button" class="shell-arg-remove" aria-label="Remove">\u00D7</button>
  `;
  row.querySelector(".shell-arg-remove").addEventListener("click", () => row.remove());
  document.getElementById("shell-args").appendChild(row);
}

function saveShell() {
  const zid = document.getElementById("shell-zid").value.trim();
  const outputType = document.getElementById("shell-output").value.trim() || "Z1";
  const rows = [...document.querySelectorAll(".shell-arg")];
  const args = rows.map(r => ({
    label: r.querySelector(".shell-arg-label").value.trim(),
    type: r.querySelector(".shell-arg-type").value.trim() || "Z1",
  })).filter(a => a.label);

  if (!/^Z\d+$/.test(zid)) {
    alert(`Function ZID must look like Z123 (got: ${JSON.stringify(zid)})`);
    return;
  }

  const hadArgRefs = workspace.getAllBlocks(false).some(b => b.type.startsWith("wf_arg_"));
  if (hadArgRefs) {
    if (!confirm("Changing the shell will clear the workspace. Continue?")) return;
    workspace.clear();
  }

  setShell({ zid, outputType, args });
  closeModal();
}

// Programmatic shell setter — used by the UI save handler and by
// example loaders. Does NOT prompt or clear the workspace; callers
// are responsible for that.
export function setShell({ zid, outputType, args }) {
  SHELL.zid = zid;
  SHELL.outputType = outputType;
  SHELL.args = args;

  unregisterArgRefBlocks();
  registerArgRefBlocks();
  rebuildToolbox();
  updateShellStatus();
}

function unregisterArgRefBlocks() {
  Object.keys(Blockly.Blocks)
    .filter(t => t.startsWith("wf_arg_"))
    .forEach(t => delete Blockly.Blocks[t]);
  for (const k of Object.keys(ARG_REF_META)) delete ARG_REF_META[k];
}

function registerArgRefBlocks() {
  const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray)
    || Blockly.defineBlocksWithJsonArray;

  const defs = SHELL.args.map((arg, i) => ({
    type: `wf_arg_${i}`,
    message0: `\u27E8 ${arg.label} \u27E9`,
    output: arg.type === "Z1" ? ["Z1"] : [arg.type, "Z1"],
    colour: 60,
    tooltip: `argument #${i + 1}: ${arg.label} (${arg.type})\nemits Z18 reference to ${SHELL.zid}K${i + 1}`,
  }));
  define(defs);

  SHELL.args.forEach((arg, i) => {
    ARG_REF_META[`wf_arg_${i}`] = {
      key: `${SHELL.zid}K${i + 1}`,
      label: arg.label,
      type: arg.type,
    };
  });
}

// Exported so other modules (e.g. catalog pin/unpin flow) can trigger
// a full toolbox refresh that preserves both arg-ref and FUNCTIONS state.
// No-op if called before initShell() — buildToolbox() reads the live
// FUNCTIONS registry so any pre-injection mutations are picked up
// automatically by the initial Blockly.inject toolbox build.
export function rebuildToolbox() {
  if (!workspace) return;
  const toolbox = buildToolbox();

  // Patch "Function arguments" from SHELL.args.
  const argCat = toolbox.contents.find(c => c.name === "Function arguments");
  if (argCat) {
    argCat.contents = SHELL.args.map((_, i) => ({
      kind: "block", type: `wf_arg_${i}`,
    }));
  }

  // Patch "Pinned" from the persisted pin list. Hardcoded functions
  // that the user has pinned (e.g. Z21032) appear here in addition to
  // their native category.
  const pinnedCat = toolbox.contents.find(c => c.name === "Pinned");
  if (pinnedCat) {
    const pinnedZids = loadPinnedZids();
    pinnedCat.contents = pinnedZids
      .filter(zid => FUNCTIONS.some(f => f.zid === zid))
      .map(zid => ({ kind: "block", type: `wf_${zid}` }));
  }

  workspace.updateToolbox(toolbox);
}

function updateShellStatus() {
  const el = document.getElementById("shell-status");
  if (!el) return;
  if (SHELL.args.length === 0) {
    el.textContent = `${SHELL.zid}: no arguments declared`;
  } else {
    const sig = SHELL.args.map(a => `${a.label}: ${a.type}`).join(", ");
    el.textContent = `${SHELL.zid}(${sig}) → ${SHELL.outputType}`;
  }
}
