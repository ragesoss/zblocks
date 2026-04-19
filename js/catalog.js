// Live search + Z8 signature fetch for Wikifunctions.
//
// Anonymous CORS via ?origin=* — same trick the runner uses. All calls
// return plain JSON; no auth needed.
//
// Two endpoints:
//   list=wikilambdasearch_functions  — label/alias search scoped to Z8s.
//                                       Returns page_title (ZID) + label.
//   action=wikilambda_fetch          — fetch one or more full ZObjects.
//                                       Returns stringified JSON per ZID.
//
// Paired with parseZ8ToSignature() to translate a fetched Z2/Z8 into
// the {zid, label, args, output, category} shape the FUNCTIONS registry
// uses.

const WF_API = "https://www.wikifunctions.org/w/api.php";

export class CatalogError extends Error {}

// Normalise any user-supplied ZID: "z33605", "  Z33605 ", "Z33605"
// all return "Z33605". Returns null for anything that isn't a valid
// ZID. Used at UI entry points (import, search) so users don't have
// to worry about casing.
export function normalizeZid(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^z(\d+)$/i);
  return m ? `Z${m[1]}` : null;
}

import { decodeInteger, decodeFloat64 } from "./numeric.js";
import { currentLanguage, currentLanguageZid } from "./i18n.js";

// ─── Search ─────────────────────────────────────────────────────────
export async function searchFunctions(query, { limit = 15, outputType, inputTypes, signal } = {}) {
  const params = new URLSearchParams({
    action: "query",
    list: "wikilambdasearch_functions",
    wikilambdasearch_functions_search: query,
    wikilambdasearch_functions_language: currentLanguage(),
    wikilambdasearch_functions_limit: String(limit),
    format: "json",
    origin: "*",
  });
  if (outputType) params.set("wikilambdasearch_functions_output_type", outputType);
  if (inputTypes) params.set("wikilambdasearch_functions_input_types", inputTypes);
  const resp = await fetch(`${WF_API}?${params.toString()}`, { signal });
  if (!resp.ok) throw new CatalogError(`Search failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new CatalogError(`${data.error.code}: ${data.error.info}`);
  const results = data?.query?.wikilambdasearch_functions || [];
  return results.map(r => ({
    zid: r.page_title,
    label: r.label,
    matchLabel: r.match_label,
    matchRate: r.match_rate,
  }));
}

// ─── Fetch ──────────────────────────────────────────────────────────
// Module-level signature cache. Populated by fetchFunctionSignature
// and fetchSignatureCached; consumed by the search UI's signature
// decoration and by pinFunction (avoids a duplicate fetch on pin).
const SIGNATURE_CACHE = new Map();

export function cachedSignature(zid) {
  return SIGNATURE_CACHE.get(zid);
}

export async function fetchSignatureCached(zid, opts = {}) {
  if (SIGNATURE_CACHE.has(zid)) return SIGNATURE_CACHE.get(zid);
  const sig = await fetchFunctionSignature(zid, opts);
  return sig;  // fetchFunctionSignature populates the cache.
}

// Look up whatever is at a ZID — not just Z8s. Returns a typed
// envelope so callers can handle Z14s (implementations) and other
// non-function Z-objects gracefully instead of getting a "not a
// function" error. Populates the signature cache for Z8s.
// ─── Function tests (Z20 objects attached via Z8K3) ────────────────
// Fetch the testers attached to a function and extract their input
// values per arg key. Useful for seeding the Run modal with known-good
// inputs — tests are literally pre-curated input sets.
//
// Returns [{ testZid, label, argValues: { <argKey>: ZObject, ... } }].
// Each argValues entry keys off the tested function's arg keys
// (e.g., Z33605K1, Z33605K2, …), the same keys SHELL uses.

const TEST_CACHE = new Map();  // zid → resolved tests

export async function fetchFunctionTests(zid) {
  if (TEST_CACHE.has(zid)) return TEST_CACHE.get(zid);
  const fn = await lookupByZid(zid);
  if (fn.kind !== "Z8") throw new CatalogError(`${zid} is not a function`);
  const refs = (fn.object.Z8K3 || []).slice(1);  // skip "Z20" head marker
  const testZids = refs.map(r => typeof r === "string" ? r : r?.Z6K1).filter(Boolean);
  if (testZids.length === 0) {
    TEST_CACHE.set(zid, []);
    return [];
  }
  // Batch fetch — wikilambda_fetch takes pipe-separated zids.
  const params = new URLSearchParams({
    action: "wikilambda_fetch",
    zids: testZids.join("|"),
    format: "json",
    origin: "*",
  });
  const resp = await fetch(`${WF_API}?${params.toString()}`);
  if (!resp.ok) throw new CatalogError(`Test batch fetch failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new CatalogError(`${data.error.code}: ${data.error.info}`);

  const tests = [];
  for (const tzid of testZids) {
    const raw = data?.[tzid]?.wikilambda_fetch;
    if (!raw) continue;
    let z2;
    try { z2 = JSON.parse(raw); } catch { continue; }
    const z20 = z2?.Z1K1 === "Z2" ? z2.Z2K2 : z2;
    if (z20?.Z1K1 !== "Z20") continue;
    const call = z20.Z20K2;
    if (!call || call.Z1K1 !== "Z7") continue;
    const target = typeof call.Z7K1 === "string" ? call.Z7K1 : call.Z7K1?.Z6K1;
    if (target !== zid) continue;   // defensive: tests for other functions slip in occasionally
    const argValues = {};
    for (const key of Object.keys(call)) {
      if (key === "Z7K1" || key === "Z1K1") continue;
      if (key.startsWith(target + "K")) argValues[key] = call[key];
    }
    tests.push({
      testZid: tzid,
      label: extractLabel(z2?.Z2K3) || tzid,
      argValues,
    });
  }
  TEST_CACHE.set(zid, tests);
  return tests;
}

// Decode a ZObject arg value into a human-friendly string suitable
// for the Run modal's text input. Returns "" on failure; unrecognised
// shapes fall back to pretty JSON so the input-side JSON-passthrough
// handler still accepts them.
export function argValueToString(zobj) {
  if (zobj == null) return "";
  if (typeof zobj === "string") return zobj;
  if (typeof zobj !== "object") return String(zobj);
  const t = zobj.Z1K1;
  if (t === "Z6")     return zobj.Z6K1 ?? "";
  if (t === "Z6091")  return zobj.Z6091K1 ?? "";
  if (t === "Z6092")  return zobj.Z6092K1 ?? "";
  if (t === "Z13518") return String(zobj.Z13518K1 ?? "");
  if (t === "Z16683") { try { return String(decodeInteger(zobj)); } catch { return ""; } }
  if (t === "Z20838") { try { return String(decodeFloat64(zobj)); } catch { return ""; } }
  if (t === "Z40") {
    const v = typeof zobj.Z40K1 === "string" ? zobj.Z40K1 : zobj.Z40K1?.Z9K1;
    return v === "Z41" ? "true" : v === "Z42" ? "false" : "";
  }
  if (t === "Z7") {
    // Recognise common fetch/wrapper functions so tests expressed as
    // Z6821(Q…) come through as plain QIDs matching runner.js's
    // auto-wrap convention for Z6001 inputs.
    const target = typeof zobj.Z7K1 === "string" ? zobj.Z7K1 : zobj.Z7K1?.Z6K1;
    if (target === "Z6821")  return argValueToString(zobj.Z6821K1);   // fetch item
    if (target === "Z6822")  return argValueToString(zobj.Z6822K1);   // fetch property
    if (target === "Z20915") return argValueToString(zobj.Z20915K1);  // legacy float
  }
  // Fallback: pretty JSON. runner.js treats any value starting with
  // { or [ as raw JSON passthrough.
  try { return JSON.stringify(zobj); } catch { return ""; }
}

// Fetch an error-type ZID and extract its label, description, and
// per-key labels from its Z50 definition. Used by the result modal
// to resolve any error ZID we haven't hardcoded, and to rename the
// generic "<zid>K<n>" payload keys into human names.
// Returns { label, description, keyLabels } or null on failure.
const ERROR_INFO_CACHE = new Map();

export async function fetchErrorTypeInfo(zid) {
  if (!/^Z\d+$/.test(zid)) return null;
  if (ERROR_INFO_CACHE.has(zid)) return ERROR_INFO_CACHE.get(zid);
  try {
    const params = new URLSearchParams({
      action: "wikilambda_fetch", zids: zid, format: "json", origin: "*",
    });
    const resp = await fetch(`${WF_API}?${params.toString()}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    const rawStr = data?.[zid]?.wikilambda_fetch;
    if (!rawStr) return null;
    const z2 = JSON.parse(rawStr);
    const label = extractLabel(z2?.Z2K3) || null;
    const description = extractLabel(z2?.Z2K5) || null;
    const keyLabels = {};
    const z2k2 = z2?.Z2K2;
    // Error types are Z50s whose Z50K1 is a typed list of Z3 key
    // definitions: each Z3 has Z3K2 = key ZID, Z3K3 = label.
    if (z2k2?.Z1K1 === "Z50" && Array.isArray(z2k2.Z50K1)) {
      for (const k of z2k2.Z50K1.slice(1)) {
        if (k?.Z3K2 && k?.Z3K3) {
          const kLabel = extractLabel(k.Z3K3);
          if (kLabel) keyLabels[k.Z3K2] = kLabel;
        }
      }
    }
    const info = { label, description, keyLabels };
    ERROR_INFO_CACHE.set(zid, info);
    return info;
  } catch {
    return null;
  }
}

export async function lookupByZid(zid) {
  if (!/^Z\d+$/.test(zid)) throw new CatalogError(`Invalid ZID: ${zid}`);
  const params = new URLSearchParams({
    action: "wikilambda_fetch", zids: zid, format: "json", origin: "*",
  });
  const resp = await fetch(`${WF_API}?${params.toString()}`);
  if (!resp.ok) throw new CatalogError(`Fetch ${zid} failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new CatalogError(`${data.error.code}: ${data.error.info}`);
  const rawStr = data?.[zid]?.wikilambda_fetch;
  if (!rawStr) throw new CatalogError(`${zid}: empty wikilambda_fetch payload`);
  const z2 = JSON.parse(rawStr);
  const obj = z2?.Z1K1 === "Z2" ? z2.Z2K2 : z2;
  const result = { zid, kind: obj?.Z1K1, object: obj };
  if (obj?.Z1K1 === "Z8") {
    const sig = parseZ8ToSignature(z2);
    SIGNATURE_CACHE.set(zid, sig);
    result.signature = sig;
  } else if (obj?.Z1K1 === "Z14") {
    result.targetZid = typeof obj.Z14K1 === "string" ? obj.Z14K1 : obj.Z14K1?.Z6K1;
  }
  return result;
}

// Batch version of fetchFunctionSignature. Uses wikilambda_fetch's
// pipe-separated zids parameter to pull many Z8s in one HTTP round
// trip. Cheaper than Promise.all(fetchFunctionSignature × N) when
// translating the entire built-in registry at page load.
export async function fetchFunctionSignatures(zids) {
  if (zids.length === 0) return {};
  const params = new URLSearchParams({
    action: "wikilambda_fetch",
    zids: zids.join("|"),
    format: "json",
    origin: "*",
  });
  const resp = await fetch(`${WF_API}?${params.toString()}`);
  if (!resp.ok) throw new CatalogError(`Batch fetch failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new CatalogError(`${data.error.code}: ${data.error.info}`);
  const out = {};
  for (const zid of zids) {
    const raw = data?.[zid]?.wikilambda_fetch;
    if (!raw) continue;
    try {
      const z2 = JSON.parse(raw);
      const sig = parseZ8ToSignature(z2);
      SIGNATURE_CACHE.set(zid, sig);
      out[zid] = sig;
    } catch (e) {
      // Skip entries that don't parse as a Z8 (deleted, typed changes).
      // The caller falls back to hardcoded data for unmatched ZIDs.
    }
  }
  return out;
}

// Batch-fetch just labels (not full signatures) from Z2K3 in the
// current language, with English fallback. Used by type_labels.js to
// translate the type-name map without the overhead of Z8-parsing.
export async function fetchLabels(zids) {
  if (zids.length === 0) return {};
  const params = new URLSearchParams({
    action: "wikilambda_fetch",
    zids: zids.join("|"),
    format: "json",
    origin: "*",
  });
  const resp = await fetch(`${WF_API}?${params.toString()}`);
  if (!resp.ok) throw new CatalogError(`Label batch failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new CatalogError(`${data.error.code}: ${data.error.info}`);
  const out = {};
  for (const zid of zids) {
    const raw = data?.[zid]?.wikilambda_fetch;
    if (!raw) continue;
    try {
      const z2 = JSON.parse(raw);
      const label = extractLabel(z2?.Z2K3);
      if (label) out[zid] = label;
    } catch { /* skip */ }
  }
  return out;
}

export async function fetchFunctionSignature(zid, { signal } = {}) {
  if (!/^Z\d+$/.test(zid)) throw new CatalogError(`Invalid ZID: ${zid}`);
  const params = new URLSearchParams({
    action: "wikilambda_fetch",
    zids: zid,
    format: "json",
    origin: "*",
  });
  const resp = await fetch(`${WF_API}?${params.toString()}`, { signal });
  if (!resp.ok) throw new CatalogError(`Fetch ${zid} failed: HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new CatalogError(`${data.error.code}: ${data.error.info}`);
  const rawStr = data?.[zid]?.wikilambda_fetch;
  if (!rawStr) throw new CatalogError(`${zid}: no wikilambda_fetch payload in response`);
  let z2;
  try { z2 = JSON.parse(rawStr); }
  catch (e) { throw new CatalogError(`${zid}: invalid JSON from wikilambda_fetch: ${e.message}`); }
  const sig = parseZ8ToSignature(z2);
  SIGNATURE_CACHE.set(zid, sig);
  return sig;
}

// ─── Signature formatting helpers ───────────────────────────────────
import { typeLabel } from "./type_labels.js";

export function signatureText(sig) {
  if (!sig) return "";
  const inputs = sig.args.map(a => typeLabel(a.type)).join(", ");
  return `(${inputs}) → ${typeLabel(sig.output)}`;
}

export function signatureTooltip(sig) {
  if (!sig) return "";
  const inputs = sig.args.map(a =>
    `${a.label}: ${typeLabel(a.type, { withZid: true })}`
  ).join(", ");
  return `(${inputs}) → ${typeLabel(sig.output, { withZid: true })}`;
}

// ─── Parse ──────────────────────────────────────────────────────────
export function parseZ8ToSignature(z2) {
  const z8 = z2?.Z2K2;
  const zid = extractZid(z2?.Z2K1);
  if (!z8 || z8.Z1K1 !== "Z8") {
    throw new CatalogError(`${zid || "(no zid)"} is not a function (Z1K1 = ${z8?.Z1K1 ?? "?"})`);
  }
  const label = extractLabel(z2.Z2K3) || zid || "(unlabeled)";
  const args = parseArgs(z8.Z8K1 || []);
  const output = zidOfType(z8.Z8K2);
  return { zid, label, category: "Pinned", args, output };
}

function parseArgs(argList) {
  const args = [];
  // Z8K1 is a typed list: ["Z17", arg1, arg2, ...]. Skip the head marker.
  for (let i = 1; i < argList.length; i++) {
    const arg = argList[i];
    if (!arg || typeof arg !== "object") continue;
    const key = arg.Z17K2;
    if (!key) continue;
    args.push({
      key,
      label: extractLabel(arg.Z17K3) || key,
      type:  zidOfType(arg.Z17K1),
    });
  }
  return args;
}

// Type slots can be a bare ZID or a Z7 call (for parameterized types
// like "list of strings": {Z1K1:Z7, Z7K1:Z881, Z881K1:Z6}). Phase 2
// flattens to the outer ZID so existing shadow + slot-check logic
// works without modification.
function zidOfType(t) {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    if (t.Z1K1 === "Z7" && t.Z7K1) return t.Z7K1;
    if (typeof t.Z1K1 === "object" && t.Z1K1.Z7K1) return t.Z1K1.Z7K1;
    if (typeof t.Z1K1 === "string") return t.Z1K1;
  }
  return "Z1";
}

function extractZid(z2k1) {
  if (typeof z2k1 === "string") return z2k1;
  if (z2k1 && typeof z2k1 === "object") return z2k1.Z6K1 || null;
  return null;
}

// Z2K3 / Z17K3 are Z12 multilingual strings: {Z1K1:Z12, Z12K1:["Z11", entry, entry, ...]}
// with entries of shape {Z11K1: langZid, Z11K2: "label string"}.
//
// Lookup order: target language → English fallback → any available entry.
// Exported so both catalog.js and importer.js share one implementation.
export function extractLabel(z12, targetZid = null, fallbackZid = "Z1002") {
  const target = targetZid || currentLanguageZid();
  const entries = z12?.Z12K1;
  if (!Array.isArray(entries)) return null;
  // 1. Target language
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e?.Z11K1 === target && typeof e.Z11K2 === "string") return e.Z11K2;
  }
  // 2. Fallback (usually English)
  if (fallbackZid && fallbackZid !== target) {
    for (let i = 1; i < entries.length; i++) {
      const e = entries[i];
      if (e?.Z11K1 === fallbackZid && typeof e.Z11K2 === "string") return e.Z11K2;
    }
  }
  // 3. Anything available — better than returning null when a Z-object
  // has labels only in, say, Italian.
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e?.Z11K2 === "string") return e.Z11K2;
  }
  return null;
}
