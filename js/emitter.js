// Walk a Blockly workspace → canonical ZObject JSON.
//
// Block type dispatch:
//   wf_Z<nnn>     — function call. Key list from FUNCTIONS registry.
//   wf_arg_<idx>  — Z18 argument reference. Metadata in ARG_REF_META.
//   wf_string     — {Z1K1: Z6,     Z6K1: value}
//   wf_integer    — Z16683 with sign (Z16660/1/2) + Z13518 digits
//   wf_float      — Z20915 wrapper around Z6 string  (never raw Z20838)
//   wf_boolean    — bare "Z41" / "Z42"
//   wf_item_ref   — {Z1K1: Z6091, Z6091K1: "Qnnn"}
//   wf_property_ref — {Z1K1: Z6092, Z6092K1: "Pnnn"}
//
// Canonical wrapping is a matter of taste — the server normalises
// wrapped Z6/Z9 back to bare strings on save, so the wrapped form is
// always safe. We use it uniformly for clarity.

import { functionByZid } from "./functions.js";
import { ARG_REF_META } from "./shell.js";

const SIGN_POS = "Z16660";
const SIGN_ZERO = "Z16661";
const SIGN_NEG = "Z16662";

export class EmitError extends Error {}

export function emitWorkspace(workspace, opts = {}) {
  const roots = workspace.getTopBlocks(false).filter(b => b.outputConnection);
  if (roots.length === 0) {
    throw new EmitError("No value block at the top level — drag a function or literal block onto the workspace.");
  }
  if (roots.length > 1) {
    throw new EmitError(
      `${roots.length} top-level blocks. Compositions must have exactly one root — ` +
      `delete or nest the extras.`
    );
  }
  return emitBlock(roots[0], opts);
}

// Exported so the runner can walk the same tree with a different
// arg-ref resolver (substituting test values for Z18 references).
// opts.argRefResolver: (block) => ZObject   — called for wf_arg_* blocks
export function emitBlock(block, opts = {}) {
  const t = block.type;

  if (t.startsWith("wf_arg_")) {
    return opts.argRefResolver ? opts.argRefResolver(block) : emitArgRef(block);
  }
  if (t === "wf_string")        return emitString(block);
  if (t === "wf_integer")       return emitInteger(block);
  if (t === "wf_natural")       return emitNatural(block);
  if (t === "wf_float")         return emitFloat(block);
  if (t === "wf_boolean")       return emitBoolean(block);
  if (t === "wf_item_ref")      return emitItemRef(block);
  if (t === "wf_property_ref")  return emitPropertyRef(block);
  if (t.startsWith("wf_Z"))     return emitFunctionCall(block, opts);

  throw new EmitError(`Unknown block type: ${t}`);
}

function emitArgRef(block) {
  const meta = ARG_REF_META[block.type];
  if (!meta) {
    throw new EmitError(
      `argument-reference block ${block.type} has no metadata — ` +
      `re-declare the function shell.`
    );
  }
  return { Z1K1: "Z18", Z18K1: meta.key };
}

function emitString(block) {
  return { Z1K1: "Z6", Z6K1: String(block.getFieldValue("VALUE") ?? "") };
}

function emitInteger(block) {
  const raw = block.getFieldValue("VALUE");
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new EmitError(`Invalid integer literal: ${JSON.stringify(raw)}`);
  }
  const sign = n > 0 ? SIGN_POS : n < 0 ? SIGN_NEG : SIGN_ZERO;
  return {
    Z1K1: "Z16683",
    Z16683K1: { Z1K1: "Z16659", Z16659K1: sign },
    Z16683K2: { Z1K1: "Z13518", Z13518K1: String(Math.abs(n)) },
  };
}

function emitNatural(block) {
  const raw = block.getFieldValue("VALUE");
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new EmitError(`Invalid natural-number literal: ${JSON.stringify(raw)} (must be a non-negative integer)`);
  }
  return { Z1K1: "Z13518", Z13518K1: String(n) };
}

function emitFloat(block) {
  const raw = block.getFieldValue("VALUE");
  const str = String(raw);
  // Never emit Z20838 directly. Wrap via Z20915 "string to float64".
  return {
    Z1K1: "Z7",
    Z7K1: "Z20915",
    Z20915K1: { Z1K1: "Z6", Z6K1: str },
  };
}

function emitBoolean(block) {
  // Value is already the canonical Z-id ("Z41" true / "Z42" false).
  return block.getFieldValue("VALUE");
}

function emitItemRef(block) {
  const qid = String(block.getFieldValue("VALUE") ?? "").trim();
  if (!/^Q\d+$/.test(qid)) {
    throw new EmitError(`Invalid Wikidata item reference: ${JSON.stringify(qid)}`);
  }
  return { Z1K1: "Z6091", Z6091K1: qid };
}

function emitPropertyRef(block) {
  const pid = String(block.getFieldValue("VALUE") ?? "").trim();
  if (!/^P\d+$/.test(pid)) {
    throw new EmitError(`Invalid Wikidata property reference: ${JSON.stringify(pid)}`);
  }
  return { Z1K1: "Z6092", Z6092K1: pid };
}

function emitFunctionCall(block, opts) {
  const zid = block.type.slice(3);  // strip "wf_"
  const fn = functionByZid(zid);
  if (!fn) throw new EmitError(`No registry entry for ${zid} (block type ${block.type})`);

  const result = { Z1K1: "Z7", Z7K1: zid };
  for (const arg of fn.args) {
    const child = block.getInputTargetBlock(arg.key);
    if (!child) {
      throw new EmitError(
        `Missing argument "${arg.label}" (${arg.key}) on ${fn.label} (${zid})`
      );
    }
    result[arg.key] = emitBlock(child, opts);
  }
  return result;
}
