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

// ─── Search ─────────────────────────────────────────────────────────
export async function searchFunctions(query, { limit = 15, outputType, inputTypes, signal } = {}) {
  const params = new URLSearchParams({
    action: "query",
    list: "wikilambdasearch_functions",
    wikilambdasearch_functions_search: query,
    wikilambdasearch_functions_language: "en",
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
  const label = extractEnLabel(z2.Z2K3) || zid || "(unlabeled)";
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
      label: extractEnLabel(arg.Z17K3) || key,
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
function extractEnLabel(z12) {
  const entries = z12?.Z12K1;
  if (!Array.isArray(entries)) return null;
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (e?.Z11K1 === "Z1002" && typeof e.Z11K2 === "string") return e.Z11K2;
  }
  // Fall back to the first monolingual entry regardless of language.
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (typeof e?.Z11K2 === "string") return e.Z11K2;
  }
  return null;
}
