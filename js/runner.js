// Client-side runner for compositions. Wraps the wikilambda_function_call
// API so you can prototype a composition without saving it to
// Wikifunctions first.
//
// Flow:
//   1. Collect test values for each declared arg referenced in the
//      workspace (via SHELL + ARG_REF_META).
//   2. Walk the block tree with emitBlock(); substitute Z18 refs with
//      the encoded test values in place (argRefResolver callback).
//   3. POST to https://www.wikifunctions.org/w/api.php with
//      origin=* — anonymous CORS is allowed for function_call.
//   4. Unwrap the Z22 envelope, format the Z22K1 value for display,
//      extract Z22K2 error metadata on failure.
//
// Mirrors ../scripts/composition_run.py behaviour.

import { emitWorkspace, emitBlock } from "./emitter.js";
import { SHELL, ARG_REF_META } from "./shell.js";
import { encodeInteger, encodeNatural, encodeFloat64 } from "./numeric.js";

export const WF_API = "https://www.wikifunctions.org/w/api.php";
export const RUN_TIMEOUT_MS = 120_000;

// Plain-English descriptions for the error ZIDs we've seen in practice.
// Kept conservative — only entries I'm confident about based on session
// notes and observed responses. Unknown types fall through to the
// "<zid>:" generic format with a link to the Wikifunctions page.
const ERROR_TYPE_INFO = {
  Z500: { title: "Generic error",
    hint: "The function returned an untyped error. Inspect the raw ZObject for specifics." },
  Z502: { title: "Not wellformed",
    hint: "The ZObject structure is syntactically invalid for its declared type." },
  Z503: { title: "No connected implementation",
    hint: "On the function page, connect an implementation via the Implementations table before running." },
  Z504: { title: "ZID not found",
    hint: "A referenced Z-object doesn't exist (deleted, typo, or not yet saved)." },
  Z507: { title: "Runtime evaluation failed",
    hint: "The code implementation threw. Check the impl's expected input format (case, range, null-handling)." },
  Z510: { title: "Not a function",
    hint: "The ZID referenced by Z7K1 isn't a Z8 function." },
  Z511: { title: "Key not found",
    hint: "Expected ZObject key is missing — often a signature mismatch between the function and a caller." },
  Z512: { title: "Type mismatch",
    hint: "An argument was the wrong type for the function's declared signature." },
  Z516: { title: "Argument value error",
    hint: "An argument had the right type but an invalid value (out of range, unknown enum, etc.)." },
  Z518: { title: "Result validation failed",
    hint: "The function returned a value that didn't validate against its declared output type." },
  Z526: { title: "Function call error",
    hint: "A nested function call failed. The inner error below usually explains why." },
  Z548: { title: "Invalid JSON",
    hint: "The submitted ZObject isn't valid JSON or has a malformed shape." },
  Z549: { title: "Invalid reference",
    hint: "A ZID in the composition couldn't be resolved (typo, deleted, or not yet saved)." },
  Z557: { title: "Permission denied",
    hint: "wikilambda_edit needs a logged-in session; bot passwords / OAuth aren't in $wgGrantPermissions." },
};

// Z14K* key → implementation kind name.
const IMPL_KIND = {
  Z14K2: "composition",
  Z14K3: "code",
  Z14K4: "builtin",
};

export class RunError extends Error {}

// ─── Input collection ──────────────────────────────────────────────
// Returns the subset of SHELL.args that are actually referenced by
// wf_arg_* blocks currently in the workspace. Lets the input modal
// skip fields the user doesn't need to fill.
export function usedArgs(workspace) {
  const used = new Set(
    workspace.getAllBlocks(false)
      .filter(b => b.type.startsWith("wf_arg_"))
      .map(b => ARG_REF_META[b.type]?.label)
      .filter(Boolean)
  );
  return SHELL.args.filter(a => used.has(a.label));
}

// Arg-refs actually referenced inside a specific block's subtree.
// Used for scoping the Run modal when the user triggers "Run this
// block" from the context menu.
export function usedArgsInBlock(block) {
  const labels = new Set();
  walkBlockTree(block, b => {
    if (b.type.startsWith("wf_arg_")) {
      const meta = ARG_REF_META[b.type];
      if (meta) labels.add(meta.label);
    }
  });
  return SHELL.args.filter(a => labels.has(a.label));
}

function walkBlockTree(block, fn) {
  fn(block);
  for (const input of block.inputList) {
    const child = input.connection?.targetBlock();
    if (child) walkBlockTree(child, fn);
  }
}

// Placeholder hint for the input field, based on declared arg type.
export function placeholderForType(type) {
  switch (type) {
    case "Z6":     return "string value (case-sensitive)";
    case "Z16683": return "an integer, e.g. 69";
    case "Z13518": return "a natural number, e.g. 5";
    case "Z20838": return "a float, e.g. 440.0";
    case "Z40":    return "true or false";
    case "Z6091":  return "Wikidata QID, e.g. Q42";
    case "Z6092":  return "Wikidata PID, e.g. P31";
    case "Z6001":  return "QID (auto-fetched), e.g. Q17087764";
    case "Z6002":  return "PID (auto-fetched), e.g. P31";
    case "Z60":    return "language ZID, e.g. Z1002 (English)";
    case "Z1":     return "string | int | QID | PID | raw JSON";
    default:       return "raw JSON ZObject";
  }
}

// ─── Run ────────────────────────────────────────────────────────────
export async function runComposition(workspace, inputs) {
  const call = buildRunnableCall(workspace, inputs);
  const z22 = await callApi(call);
  return await interpretResult(z22);
}

// Run a specific block's subtree. Same argRefResolver + API call
// machinery as runComposition, just scoped to a single block.
export async function runBlock(block, inputs) {
  const call = emitBlock(block, argRefOpts(inputs));
  const z22 = await callApi(call);
  return await interpretResult(z22);
}

export function buildRunnableCall(workspace, inputs) {
  return emitWorkspace(workspace, argRefOpts(inputs));
}

function argRefOpts(inputs) {
  return {
    argRefResolver: (block) => {
      const meta = ARG_REF_META[block.type];
      if (!meta) {
        throw new RunError(`Arg-ref block ${block.type} has no metadata — re-declare the shell.`);
      }
      if (!(meta.label in inputs)) {
        throw new RunError(`No test input provided for "${meta.label}".`);
      }
      return encodeInput(inputs[meta.label], meta.type, meta.label);
    },
  };
}

// ─── Input encoding (user text → ZObject) ──────────────────────────
export function encodeInput(raw, type, label = "?") {
  const s = typeof raw === "string" ? raw.trim() : raw;

  if (typeof s === "string" && s === "") {
    throw new RunError(`Empty test input for "${label}" (${type}).`);
  }

  // Raw JSON passthrough (any input starting with { or [).
  if (typeof s === "string" && (s[0] === "{" || s[0] === "[")) {
    try { return JSON.parse(s); }
    catch (e) { throw new RunError(`Invalid JSON for "${label}": ${e.message}`); }
  }

  switch (type) {
    case "Z6":
      return { Z1K1: "Z6", Z6K1: String(s) };
    case "Z16683":
      try { return encodeInteger(Number(s)); }
      catch (e) { throw new RunError(`Expected integer for "${label}" (Z16683), got ${JSON.stringify(s)}`); }
    case "Z13518":
      try { return encodeNatural(Number(s)); }
      catch (e) { throw new RunError(`Expected non-negative integer for "${label}" (Z13518), got ${JSON.stringify(s)}`); }
    case "Z20838": {
      const n = Number(s);
      if (Number.isNaN(n) && String(s).toLowerCase() !== "nan") {
        throw new RunError(`Expected float for "${label}" (Z20838), got ${JSON.stringify(s)}`);
      }
      return encodeFloat64(n);
    }
    case "Z40": {
      const b = String(s).toLowerCase();
      if (b === "true"  || b === "z41") return "Z41";
      if (b === "false" || b === "z42") return "Z42";
      throw new RunError(`Expected true/false for "${label}" (Z40), got ${JSON.stringify(s)}`);
    }
    case "Z6091":
      if (!/^Q\d+$/.test(s)) throw new RunError(`Expected QID for "${label}" (Z6091), got ${JSON.stringify(s)}`);
      return { Z1K1: "Z6091", Z6091K1: String(s) };
    case "Z6092":
      if (!/^P\d+$/.test(s)) throw new RunError(`Expected PID for "${label}" (Z6092), got ${JSON.stringify(s)}`);
      return { Z1K1: "Z6092", Z6092K1: String(s) };
    case "Z6001":
      if (!/^Q\d+$/.test(s)) {
        throw new RunError(`Expected QID for "${label}" (Z6001, auto-wrapped in Z6821 fetch). Got ${JSON.stringify(s)}. To pass a prebuilt Wikidata item, paste raw JSON.`);
      }
      return { Z1K1: "Z7", Z7K1: "Z6821", Z6821K1: { Z1K1: "Z6091", Z6091K1: String(s) } };
    case "Z6002":
      if (!/^P\d+$/.test(s)) {
        throw new RunError(`Expected PID for "${label}" (Z6002, auto-wrapped in Z6822 fetch). Got ${JSON.stringify(s)}.`);
      }
      return { Z1K1: "Z7", Z7K1: "Z6822", Z6822K1: { Z1K1: "Z6092", Z6092K1: String(s) } };
    case "Z60":
      // Natural language. Usually Z1002 (English), Z1003 (Arabic), etc.
      // Accept a bare ZID.
      if (!/^Z\d+$/.test(s)) throw new RunError(`Expected language ZID for "${label}" (Z60), got ${JSON.stringify(s)}`);
      return String(s);
    case "Z1":
      // Wildcard — best-effort guess.
      if (typeof s === "number") return encodeInteger(s);
      if (/^-?\d+$/.test(s))     return encodeInteger(Number(s));
      if (/^Q\d+$/.test(s))      return { Z1K1: "Z6091", Z6091K1: String(s) };
      if (/^P\d+$/.test(s))      return { Z1K1: "Z6092", Z6092K1: String(s) };
      return { Z1K1: "Z6", Z6K1: String(s) };
    default:
      throw new RunError(`No automatic encoder for type ${type} on "${label}". Paste raw JSON (starting with { or [).`);
  }
}

// ─── API ───────────────────────────────────────────────────────────
export async function callApi(zobject) {
  const body = new URLSearchParams();
  body.set("action", "wikilambda_function_call");
  body.set("format", "json");
  body.set("origin", "*");
  body.set("wikilambda_function_call_zobject", JSON.stringify(zobject));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
  try {
    const resp = await fetch(WF_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new RunError(`HTTP ${resp.status} from Wikifunctions API`);
    const outer = await resp.json();
    if (outer.error) {
      throw new RunError(`${outer.error.code}: ${outer.error.info}`);
    }
    const data = outer?.wikilambda_function_call?.data;
    if (!data) throw new RunError("Unexpected API response (no data field).");
    return JSON.parse(data);  // Z22 envelope
  } catch (e) {
    if (e.name === "AbortError") {
      throw new RunError(`Timed out after ${RUN_TIMEOUT_MS / 1000}s.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Result interpretation ─────────────────────────────────────────
export async function interpretResult(z22) {
  // Z22K1 = result, Z22K2 = metadata envelope (includes errors on failure).
  const metadata = extractMetadata(z22);
  if (z22?.Z22K1 === "Z24") {
    return { ok: false, ...extractError(z22), metadata, raw: z22 };
  }
  const val = z22?.Z22K1;
  const formatted = await formatValue(val);
  return { ok: true, formatted, metadata, raw: val };
}

// Extract the useful bits from the Z22K2 execution envelope. Works on
// both success and failure responses — the envelope is present in both.
function extractMetadata(z22) {
  const pairs = z22?.Z22K2?.K1 ?? [];
  const meta = {};
  for (const p of pairs) {
    if (!p || typeof p !== "object") continue;
    const k = p.K1;
    const v = p.K2;
    if (!k) continue;
    // K2 can be a bare string ("952 ms") or a wrapped Z6 ({Z1K1:Z6, Z6K1:"Z25229"}).
    const unwrapped = (v && typeof v === "object" && v.Z1K1 === "Z6") ? v.Z6K1 : v;
    switch (k) {
      case "implementationId":           meta.implementationId       = String(unwrapped); break;
      case "implementationType":         meta.implementationType     = String(unwrapped); break;
      case "programmingLanguageVersion": meta.programmingLanguage    = String(unwrapped); break;
      case "evaluationDuration":         meta.evaluationDuration     = String(unwrapped); break;
      case "orchestrationDuration":      meta.orchestrationDuration  = String(unwrapped); break;
    }
  }
  if (meta.implementationType && IMPL_KIND[meta.implementationType]) {
    meta.implementationKind = IMPL_KIND[meta.implementationType];
  }
  return meta;
}

async function formatValue(val) {
  if (typeof val === "string") return val;
  if (typeof val !== "object" || val === null) return String(val);

  const t = val.Z1K1;
  if (t === "Z6")    return val.Z6K1 ?? "";
  if (t === "Z40")   return val.Z40K1 === "Z41" ? "true" : "false";
  if (t === "Z6091") return val.Z6091K1 ?? "?";
  if (t === "Z6092") return val.Z6092K1 ?? "?";

  const converter = t === "Z16683" ? "Z25073"
                  : t === "Z20838" ? "Z20844"
                  : null;
  if (converter) {
    try {
      const conv = await callApi({
        Z1K1: "Z7",
        Z7K1: converter,
        [`${converter}K1`]: val,
      });
      const sv = conv?.Z22K1;
      if (typeof sv === "string") return sv;
      if (sv?.Z1K1 === "Z6") return sv.Z6K1;
    } catch (_e) {
      // Fall through to ZID summary.
    }
  }
  return `<${t ?? "unknown"}>`;
}

// Returns {errorType, errorTitle, errorMessage, errorHint}.
// errorType is the Z5K1 ZID (linkable); errorTitle/hint come from the
// glossary if known; errorMessage is the payload value.
function extractError(z22) {
  const pairs = z22?.Z22K2?.K1 ?? [];
  for (const p of pairs) {
    if (p?.K1 === "errors") {
      const err = p.K2;
      if (err && typeof err === "object") {
        const et = err.Z5K1 || "unknown";
        const info = ERROR_TYPE_INFO[et] || {};
        const message = extractErrorMessage(et, err.Z5K2);
        return {
          errorType: et,
          errorTitle: info.title ?? null,
          errorHint: info.hint ?? null,
          errorMessage: message,
        };
      }
    }
  }
  return {
    errorType: "unknown",
    errorTitle: "Unknown error",
    errorHint: null,
    errorMessage: "No Z22K2.errors entry in response.",
  };
}

// Pull the best human-readable message out of a Z5K2 payload. Z5K2
// has Z1K1 = Z885<errorType>, then an errorType-keyed payload
// (e.g. Z507K1, Z516K1). We unwrap common Z-object shapes into bare
// values and walk nested Z5 errors inline, so the message says
// something like
//   Z526 — Function call error: Z511 on key P361
// rather than a blob of raw JSON.
function extractErrorMessage(errorType, z5k2) {
  if (z5k2 === undefined || z5k2 === null) return "";
  const payload = z5k2?.[`${errorType}K1`];

  // Special-case key-reference payloads so the message reads
  // "on key P361" rather than just "P361" in isolation.
  if ((errorType === "Z511" || errorType === "Z516") && payload) {
    const keyName = (typeof payload === "object" && payload.Z39K1) ? payload.Z39K1
                  : (typeof payload === "string" ? payload : null);
    if (keyName) return `on key ${keyName}`;
  }

  // If Z5K2 has multiple <errorType>K<n> fields, render the whole
  // thing so nothing's dropped. Otherwise unwrap the single payload.
  const nonTypeKeys = Object.keys(z5k2).filter(k => k !== "Z1K1");
  if (nonTypeKeys.length > 1) return formatErrorPayload(z5k2);
  if (payload !== undefined) return formatErrorPayload(payload);
  return formatErrorPayload(z5k2);
}

// Recursive pretty-printer for Z5K2 payloads and their nested values.
// - Wrappers (Z6, Z9, Z39, Z6091, Z6092, Z13518, Z16683, Z40)
//   collapse to their bare value.
// - Nested Z5 errors render as "<innerZid>: <inner payload>".
// - Single-field generic objects unwrap transparently.
// - Multi-field objects render one K<n> per line so the shape is
//   obvious without resorting to raw JSON.
function formatErrorPayload(val, depth = 0) {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val !== "object") return String(val);
  if (Array.isArray(val)) {
    // Typed-list head-marker: ["Z6", "foo", "bar"] → [foo, bar]
    const tail = val.slice(1).map(e => formatErrorPayload(e, depth + 1));
    return `[${tail.join(", ")}]`;
  }

  const t = typeof val.Z1K1 === "string" ? val.Z1K1 : val.Z1K1?.Z7K1;

  if (t === "Z6")    return JSON.stringify(val.Z6K1 ?? "");
  if (t === "Z9")    return val.Z9K1 ?? "?";
  if (t === "Z39")   return val.Z39K1 ?? "?";
  if (t === "Z6091") return val.Z6091K1 ?? "?";
  if (t === "Z6092") return val.Z6092K1 ?? "?";
  if (t === "Z13518") return String(val.Z13518K1 ?? "");
  if (t === "Z40") {
    const v = typeof val.Z40K1 === "string" ? val.Z40K1 : val.Z40K1?.Z9K1;
    return v === "Z41" ? "true" : v === "Z42" ? "false" : "?";
  }
  if (t === "Z16683") {
    const sign = typeof val.Z16683K1?.Z16659K1 === "string"
      ? val.Z16683K1.Z16659K1 : val.Z16683K1?.Z16659K1?.Z9K1;
    const digits = typeof val.Z16683K2?.Z13518K1 === "string"
      ? val.Z16683K2.Z13518K1 : val.Z16683K2?.Z13518K1?.Z6K1;
    return (sign === "Z16662" ? "-" : "") + (digits ?? "?");
  }
  if (t === "Z5") {
    const inner = val.Z5K1 ?? "?";
    const innerPayload = val.Z5K2?.[`${inner}K1`];
    const inferred = innerPayload !== undefined
      ? extractErrorMessage(inner, val.Z5K2)
      : formatErrorPayload(val.Z5K2, depth + 1);
    return inferred ? `${inner} \u2014 ${inferred}` : inner;
  }

  // Generic object: iterate non-type fields.
  const entries = Object.entries(val).filter(([k]) => k !== "Z1K1");
  if (entries.length === 0) return "";
  if (entries.length === 1) return formatErrorPayload(entries[0][1], depth);

  const indent = "  ".repeat(depth);
  return entries.map(([k, v]) => {
    const fv = formatErrorPayload(v, depth + 1);
    const indented = fv.includes("\n") ? fv.replace(/\n/g, "\n" + indent + "  ") : fv;
    return `${indent}${k}: ${indented}`;
  }).join("\n");
}
