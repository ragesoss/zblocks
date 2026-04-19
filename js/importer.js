// Round-trip: existing Z14 composition → Blockly workspace state.
//
// Takes a ZID or pasted JSON, fetches/parses, and produces a
// Blockly.serialization.workspaces state object that can be loaded
// into the workspace. Follows the lookup-table-dispatch pattern from
// YoshiRulz's WikiLambdaBlockly (expr_import.ts, Apache-2.0) — each
// known Z-type has its own small parser, registered in a map keyed
// by Z1K1 so adding a new type is ~10 lines.
//
// Flow:
//   importByZid(zid)        — fetch + dispatch + auto-declare shell
//   importFromJson(string)  — same, but start from pasted JSON
//   exprToBlockSpec(expr)   — the core recursive walker

import { fetchFunctionSignature } from "./catalog.js";
import { registerFunctionBlock } from "./blocks.js";
import { FUNCTIONS } from "./functions.js";
import { setShell, ARG_REF_META, SHELL } from "./shell.js";
import { decodeInteger, decodeNatural, decodeFloat64 } from "./numeric.js";

const WF_API = "https://www.wikifunctions.org/w/api.php";

export class ImportError extends Error {}

// ─── Top-level entry points ─────────────────────────────────────────
export async function importByZid(zid) {
  const obj = await fetchUnwrapped(zid);
  return interpretTopLevel(obj);
}

export async function importFromJson(jsonStr) {
  let obj;
  try { obj = JSON.parse(jsonStr); }
  catch (e) { throw new ImportError(`Invalid JSON: ${e.message}`); }
  // Unwrap Z2 if present.
  if (obj?.Z1K1 === "Z2" && obj?.Z2K2) obj = obj.Z2K2;
  return interpretTopLevel(obj);
}

// Returns { shell, state }. state is the Blockly workspace state
// ready to hand to workspace.load(); shell is either null or
// { zid, outputType, args }.
async function interpretTopLevel(obj) {
  if (!obj || typeof obj !== "object") {
    throw new ImportError("Top-level value isn't a Z-object.");
  }
  // Z8: a function definition. Pick its first implementation.
  if (obj.Z1K1 === "Z8") {
    const impls = obj.Z8K4 || [];
    const first = impls[1];  // skip head marker
    const implZid = typeof first === "string" ? first : first?.Z6K1;
    if (!implZid) throw new ImportError(`Z8 ${obj.Z8K5 || ""} has no implementations to import.`);
    return importByZid(implZid);
  }
  // Z14: an implementation. Extract the composition (Z14K2).
  if (obj.Z1K1 === "Z14") {
    const composition = obj.Z14K2;
    if (!composition) throw new ImportError("Z14 has no Z14K2 composition to import.");
    const targetZid = typeof obj.Z14K1 === "string" ? obj.Z14K1 : obj.Z14K1?.Z6K1;
    const shell = targetZid ? await fetchShellFromZ8(targetZid) : null;
    const state = await compositionToState(composition, shell);
    return { shell, state };
  }
  // Bare composition: assume the user already has a shell set, or will declare one.
  const state = await compositionToState(obj, null);
  return { shell: null, state };
}

async function fetchUnwrapped(zid) {
  if (!/^Z\d+$/.test(zid)) throw new ImportError(`Invalid ZID: ${zid}`);
  const params = new URLSearchParams({
    action: "wikilambda_fetch", zids: zid, format: "json", origin: "*",
  });
  const resp = await fetch(`${WF_API}?${params.toString()}`);
  if (!resp.ok) throw new ImportError(`Fetch ${zid} failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new ImportError(`${data.error.code}: ${data.error.info}`);
  const rawStr = data?.[zid]?.wikilambda_fetch;
  if (!rawStr) throw new ImportError(`${zid}: empty wikilambda_fetch payload`);
  const z2 = JSON.parse(rawStr);
  return z2?.Z1K1 === "Z2" ? z2.Z2K2 : z2;
}

async function fetchShellFromZ8(targetZid) {
  const z8 = await fetchUnwrapped(targetZid);
  if (z8.Z1K1 !== "Z8") {
    throw new ImportError(`Target ${targetZid} is ${z8.Z1K1}, not Z8.`);
  }
  const argList = z8.Z8K1 || [];
  const args = [];
  for (let i = 1; i < argList.length; i++) {
    const a = argList[i];
    if (!a) continue;
    args.push({
      label: extractEnLabel(a.Z17K3) || a.Z17K2 || `arg${i}`,
      type: zidOfType(a.Z17K1),
    });
  }
  return {
    zid: targetZid,
    outputType: zidOfType(z8.Z8K2),
    args,
  };
}

function zidOfType(t) {
  if (typeof t === "string") return t;
  if (t?.Z1K1 === "Z7" && t.Z7K1) return t.Z7K1;
  if (t?.Z1K1?.Z7K1) return t.Z1K1.Z7K1;
  return t?.Z1K1 || "Z1";
}

function extractEnLabel(z12) {
  const entries = z12?.Z12K1;
  if (!Array.isArray(entries)) return null;
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e?.Z11K1 === "Z1002" && typeof e.Z11K2 === "string") return e.Z11K2;
  }
  return null;
}

// ─── Composition → workspace state ─────────────────────────────────
async function compositionToState(composition, shell) {
  // If a shell is present, apply it first so arg-ref blocks exist
  // before exprToBlockSpec references them.
  if (shell) setShell(shell);

  // Pre-scan: collect every function ZID referenced so we can fetch
  // missing signatures in one pass before building the block state.
  const referenced = new Set();
  collectFunctionZids(composition, referenced);
  const missing = [...referenced].filter(z => !FUNCTIONS.some(f => f.zid === z));
  if (missing.length) {
    const settled = await Promise.allSettled(missing.map(z => fetchFunctionSignature(z)));
    const failed = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") registerFunctionBlock(r.value);
      else failed.push(missing[i]);
    });
    if (failed.length) {
      throw new ImportError(
        `Could not resolve signatures for ${failed.length} referenced function(s): ${failed.join(", ")}.`
      );
    }
  }

  const rootSpec = exprToBlockSpec(composition);
  if (typeof rootSpec === "string") throw new ImportError(rootSpec);
  // Place the root at a visible spot.
  rootSpec.x = 40;
  rootSpec.y = 40;
  return { blocks: { blocks: [rootSpec] } };
}

function collectFunctionZids(expr, set) {
  if (typeof expr === "string") return;
  if (Array.isArray(expr)) { expr.forEach(e => collectFunctionZids(e, set)); return; }
  if (!expr || typeof expr !== "object") return;
  if (expr.Z1K1 === "Z7") {
    const target = typeof expr.Z7K1 === "string" ? expr.Z7K1 : expr.Z7K1?.Z6K1;
    if (target) set.add(target);
  }
  for (const v of Object.values(expr)) collectFunctionZids(v, set);
}

// ─── The walker ────────────────────────────────────────────────────
// Returns a Blockly block spec (the serialisation format) or a string
// error message. Mirrors YoshiRulz's exprToBlockSpec but produces
// specs for *our* block types (wf_*) rather than his hardcoded library.
export function exprToBlockSpec(expr) {
  if (typeof expr === "string") return parseBareString(expr);
  if (Array.isArray(expr)) return `Unexpected list at this position: ${JSON.stringify(expr).slice(0, 80)}`;
  if (!expr || typeof expr !== "object") return `Unsupported value: ${JSON.stringify(expr)}`;

  const t = expr.Z1K1;
  const zidType = typeof t === "string" ? t : t?.Z7K1;
  if (zidType === "Z7")  return parseFunctionCall(expr);
  if (zidType === "Z18") return parseArgumentRef(expr);
  const parser = PARSERS[zidType];
  if (parser) return parser(expr);
  return `No parser for Z-type ${JSON.stringify(zidType)}`;
}

// Bare strings: canonical form stores Z6 values and Z9 references as
// plain strings. If it looks like a ZID, treat as a Z9 reference —
// booleans (Z41/Z42) get mapped to wf_boolean, others to special
// known values where possible. Otherwise, treat as a string literal.
function parseBareString(s) {
  if (s === "Z41") return { type: "wf_boolean", fields: { VALUE: "Z41" } };
  if (s === "Z42") return { type: "wf_boolean", fields: { VALUE: "Z42" } };
  if (/^Z\d+$/.test(s)) {
    // Canonical JSON stores bare Z-IDs in value positions as a
    // compact form of Z9 reference (to a type, a function, an enum
    // member, etc.). Route through the Z9-reference block so it
    // round-trips back to the same bare string on emit.
    return { type: "wf_zid_ref", fields: { VALUE: s } };
  }
  return { type: "wf_string", fields: { VALUE: s } };
}

function parseString(expr) {
  return { type: "wf_string", fields: { VALUE: String(expr.Z6K1 ?? "") } };
}

function parseBoolean(expr) {
  const v = typeof expr.Z40K1 === "string" ? expr.Z40K1 : expr.Z40K1?.Z9K1;
  return { type: "wf_boolean", fields: { VALUE: v === "Z42" ? "Z42" : "Z41" } };
}

function parseItemRef(expr) {
  return { type: "wf_item_ref", fields: { VALUE: String(expr.Z6091K1 ?? "") } };
}

function parsePropertyRef(expr) {
  return { type: "wf_property_ref", fields: { VALUE: String(expr.Z6092K1 ?? "") } };
}

function parseIntegerLit(expr) {
  try {
    return { type: "wf_integer", fields: { VALUE: decodeInteger(expr) } };
  } catch (e) {
    return `Invalid Z16683: ${e.message}`;
  }
}

function parseNaturalLit(expr) {
  try {
    return { type: "wf_natural", fields: { VALUE: decodeNatural(expr) } };
  } catch (e) {
    return `Invalid Z13518: ${e.message}`;
  }
}

function parseFloatLit(expr) {
  try {
    return { type: "wf_float", fields: { VALUE: decodeFloat64(expr) } };
  } catch (e) {
    return `Invalid Z20838: ${e.message}`;
  }
}

function parseArgumentRef(expr) {
  const targetKey = typeof expr.Z18K1 === "string" ? expr.Z18K1 : expr.Z18K1?.Z6K1;
  if (!targetKey) return "Z18 missing Z18K1 target key";
  // Find the arg-ref block whose stored key matches.
  const entry = Object.entries(ARG_REF_META).find(([, meta]) => meta.key === targetKey);
  if (!entry) {
    return `Z18 references ${targetKey}, but no matching shell argument is declared. Declare the shell first, or import starting from a Z14 (auto-declares).`;
  }
  return { type: entry[0] };
}

function parseFunctionCall(expr) {
  const target = typeof expr.Z7K1 === "string" ? expr.Z7K1 : expr.Z7K1?.Z6K1;
  if (!target) return "Z7 missing Z7K1 target function";
  const fn = FUNCTIONS.find(f => f.zid === target);
  if (!fn) return `Function ${target} not in registry — import could not pre-fetch its signature.`;

  // Special back-compat: if this is a Z20915 "string to float64" call
  // wrapping a plain Z6 string, turn it into a wf_float literal.
  // That's the legacy emit format we just replaced in numeric.js but
  // existing Z14s on-wiki may still look this way.
  if (target === "Z20915") {
    const inner = expr.Z20915K1;
    const str = typeof inner === "string" ? inner : inner?.Z6K1;
    if (typeof str === "string" && !Number.isNaN(Number(str))) {
      return { type: "wf_float", fields: { VALUE: Number(str) } };
    }
  }

  const spec = { type: `wf_${target}`, inputs: {} };
  for (const arg of fn.args) {
    const childExpr = expr[arg.key];
    if (childExpr === undefined) continue;  // leave slot empty → shadow fills
    const child = exprToBlockSpec(childExpr);
    if (typeof child === "string") return child;
    spec.inputs[arg.key] = { block: child };
  }
  return spec;
}

const PARSERS = {
  Z6:     parseString,
  Z40:    parseBoolean,
  Z6091:  parseItemRef,
  Z6092:  parsePropertyRef,
  Z13518: parseNaturalLit,
  Z16683: parseIntegerLit,
  Z20838: parseFloatLit,
};
