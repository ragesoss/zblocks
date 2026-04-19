// wf_shell_def: the top-level frame block that represents the
// implementation boundary. Not a value block and not a statement
// block — it floats at the top of the workspace and holds the
// composition in its BODY value input.
//
// Fields (LABEL, ZID, ARGS, OUTPUT_TYPE, SOURCE) are populated from
// SHELL state via syncShellDefFields, called on init and whenever
// the shell changes. The BODY input's check is pinned to SHELL's
// declared output type so only compatible compositions can plug in.
//
// The block is deliberately undeletable so users can't accidentally
// discard the shell declaration; programmatic disposal (e.g. on
// shell re-declare or clear) still works.

import { SHELL } from "./shell.js";
import { typeLabel } from "./type_labels.js";
import { msg } from "./i18n.js";

// Spec built at register time so msg() reads the current language's
// catalog; register happens after initI18n in app.js.
function buildShellDefSpec() {
  return {
    type: "wf_shell_def",
    message0: `${msg("block.shell_def.def")} %1  ·  %2`,
    args0: [
      { type: "field_label", name: "LABEL", text: "" },
      { type: "field_label", name: "ZID", text: "" },
    ],
    message1: `${msg("block.shell_def.takes")} %1`,
    args1: [{ type: "field_label", name: "ARGS", text: "" }],
    message2: `${msg("block.shell_def.returns")} %1`,
    args2: [{ type: "field_label", name: "OUTPUT_TYPE", text: "" }],
    message3: `${msg("block.shell_def.source")} %1`,
    args3: [{ type: "field_label", name: "SOURCE", text: "" }],
    message4: `${msg("block.shell_def.body")} %1`,
    args4: [{ type: "input_value", name: "BODY", check: null, align: "RIGHT" }],
    colour: 45,
    tooltip: msg("block.shell_def.tooltip"),
    extensions: ["wf_shell_def_sync"],
  };
}

const SOURCE_ROW_HIDDEN = "";

export function registerShellDefBlock() {
  if (!Blockly.Extensions.isRegistered("wf_shell_def_sync")) {
    Blockly.Extensions.register("wf_shell_def_sync", function () {
      this.setDeletable(false);
      syncShellDefFields(this);
    });
  }
  const define = (Blockly.common && Blockly.common.defineBlocksWithJsonArray)
    || Blockly.defineBlocksWithJsonArray;
  define([buildShellDefSpec()]);
}

// Render SHELL into a block instance's fields + BODY check. Safe to
// call multiple times; pulls live values from SHELL every time.
export function syncShellDefFields(block) {
  set(block, "LABEL", SHELL.label || msg("block.shell_def.unlabeled"));
  set(block, "ZID", SHELL.zid || "Z0");
  set(block, "ARGS", formatArgsLine(SHELL.args));
  set(block, "OUTPUT_TYPE", formatTypeLine(SHELL.outputType));
  set(block, "SOURCE", formatSourceLine(SHELL.sourceZid, SHELL.sourceLabel));

  const bodyInput = block.getInput("BODY");
  if (bodyInput?.connection) {
    const check = !SHELL.outputType || SHELL.outputType === "Z1"
      ? null
      : [SHELL.outputType, "Z1"];
    bodyInput.connection.setCheck(check);
  }
}

function set(block, name, value) {
  const f = block.getField(name);
  if (f) f.setValue(value);
}

function formatArgsLine(args) {
  if (!args || args.length === 0) return msg("block.shell_def.no_args");
  return args.map(a => `${a.label}: ${typeLabel(a.type, { withZid: true })}`).join("   ");
}

function formatTypeLine(type) {
  if (!type) return "?";
  return typeLabel(type, { withZid: true });
}

function formatSourceLine(sourceZid, sourceLabel) {
  if (!sourceZid) return SOURCE_ROW_HIDDEN;
  const lbl = sourceLabel ? `${sourceLabel}  ·  ` : "";
  return `(impl ${lbl}${sourceZid})`;
}

// Find every wf_shell_def block in the workspace and re-sync fields.
// Called from setShell() so in-workspace blocks stay in sync when
// SHELL updates.
export function refreshAllShellDefBlocks(workspace) {
  if (!workspace) return;
  for (const b of workspace.getTopBlocks(false)) {
    if (b.type === "wf_shell_def") syncShellDefFields(b);
  }
}

// Ensure the workspace has exactly one wf_shell_def block when a
// shell is declared. Creates one if missing; removes any stray one
// when the shell is cleared. Returns the block (or null).
export function ensureShellDefBlock(workspace) {
  if (!workspace) return null;
  const existing = workspace.getTopBlocks(false).find(b => b.type === "wf_shell_def");
  if (!SHELL.zid) {
    if (existing) existing.dispose(false);
    return null;
  }
  if (existing) { syncShellDefFields(existing); return existing; }
  const block = Blockly.serialization.blocks.append(
    { type: "wf_shell_def" },
    workspace
  );
  block.moveBy(20, 20);
  return block;
}
