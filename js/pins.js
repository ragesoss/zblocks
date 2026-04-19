// Pinned functions: the user's growing collection of functions pulled
// in via search. Persists across page loads via localStorage.
//
// Each pinned ZID is re-fetched and re-registered on startup so the
// blocks exist in Blockly before any workspace state tries to use them.

import { fetchSignatureCached, fetchFunctionSignatures, CatalogError } from "./catalog.js";
import { currentLanguage } from "./i18n.js";
import { registerFunctionBlock } from "./blocks.js";
import { rebuildToolbox } from "./shell.js";
import { FUNCTIONS } from "./functions.js";
import { loadPinnedZids, savePinnedZids, PINNED_KEY } from "./storage.js";

export { loadPinnedZids };

// First-run starter kit: functions that together cover the most
// common Wikidata pipelines (fetch item → get statement value →
// cast → format). A user with a Wikidata mental model but no prior
// Wikifunctions experience sees a working palette on landing.
//
// Half of these are already in the hardcoded FUNCTIONS registry and
// just need to be pinned (no fetch). The other half (Z32097, Z28297,
// Z31120, Z33592) are fetched live on first load.
const STARTER_KIT = [
  "Z6821",   // Fetch Wikidata Item
  "Z22220",  // claims from item
  "Z23459",  // statement value with highest rank
  "Z28297",  // value of claim
  "Z32097",  // filter claims by predicate
  "Z21449",  // value of first property claim
  "Z31120",  // string from object
  "Z33592",  // integer from object
  "Z23753",  // label of item reference in language
  "Z802",    // if
  "Z866",    // equals (generic)
  "Z25073",  // integer to string
  "Z20915",  // string to float64
];

// Translate the hardcoded FUNCTIONS registry labels + arg names +
// output types from their English originals into the user's current
// language, by batch-fetching every built-in ZID's Z2K3 once at page
// load. No-op when the user language is English — the hardcoded
// entries are already English.
//
// Called before registerAllBlocks() in app.js so block definitions
// pick up translated labels at registration time.
export async function rehydrateBuiltinLabels() {
  if (currentLanguage() === "en") return { updated: 0, failed: 0 };
  const zids = FUNCTIONS.map(f => f.zid);
  let sigs;
  try { sigs = await fetchFunctionSignatures(zids); }
  catch (e) {
    console.warn("Couldn't fetch built-in function signatures:", e);
    return { updated: 0, failed: zids.length };
  }
  let updated = 0, failed = 0;
  for (const zid of zids) {
    const fetched = sigs[zid];
    const entry = FUNCTIONS.find(f => f.zid === zid);
    if (!entry) { failed++; continue; }
    if (!fetched) { failed++; continue; }
    // Keep the hand-curated category assignment; replace everything
    // the user sees rendered.
    entry.label = fetched.label || entry.label;
    if (Array.isArray(fetched.args) && fetched.args.length) entry.args = fetched.args;
    entry.output = fetched.output || entry.output;
    updated++;
  }
  return { updated, failed };
}

// Seed the pin list on first-ever load (null localStorage entry).
// If the user has intentionally cleared it (empty array), we respect
// that and don't re-seed. Returns true if seeded, false otherwise.
export function seedStarterKitIfFirstRun() {
  if (localStorage.getItem(PINNED_KEY) !== null) return false;
  savePinnedZids(STARTER_KIT);
  return true;
}

export function isPinned(zid) {
  return loadPinnedZids().includes(zid);
}

// Fetch + register + persist. If the ZID is already in the built-in
// FUNCTIONS registry (hardcoded), skips the fetch — the block already
// exists, we just add the ZID to the pin list so it also appears in
// the Pinned sidebar tab.
export async function pinFunction(zid) {
  const existing = FUNCTIONS.find(f => f.zid === zid);
  let fn = existing;
  if (!existing) {
    fn = await fetchSignatureCached(zid);
    registerFunctionBlock(fn);
  }
  const zids = loadPinnedZids();
  if (!zids.includes(zid)) {
    zids.push(zid);
    savePinnedZids(zids);
  }
  rebuildToolbox();
  return fn;
}

export function unpinFunction(zid) {
  const zids = loadPinnedZids().filter(z => z !== zid);
  savePinnedZids(zids);
  // For catalog-fetched functions (category "Pinned"), drop the
  // in-memory FUNCTIONS entry. For hardcoded ones (Math/Logic/etc.),
  // leave it in place — unpinning only removes from the Pinned tab;
  // the function is still findable in its native category.
  const idx = FUNCTIONS.findIndex(f => f.zid === zid);
  if (idx >= 0 && FUNCTIONS[idx].category === "Pinned") FUNCTIONS.splice(idx, 1);
  rebuildToolbox();
}

// Called once at startup. Fetches any pinned ZIDs that aren't
// already in the hardcoded FUNCTIONS registry and registers their
// blocks. Parallel fetches — first load with the starter kit needs
// ~5 requests, finishes in ~300ms on a warm CDN.
//
// Failures (404, network) are logged and the ZID is dropped from
// the pinned list so the next reload doesn't retry indefinitely.
export async function rehydratePinnedFunctions() {
  const zids = loadPinnedZids();
  if (zids.length === 0) return { loaded: 0, failed: [] };
  const toFetch = zids.filter(zid => !FUNCTIONS.some(f => f.zid === zid));
  const settled = await Promise.allSettled(
    toFetch.map(zid => fetchSignatureCached(zid).then(fn => ({ zid, fn })))
  );
  const failed = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      registerFunctionBlock(r.value.fn);
    } else {
      const zid = toFetch[i];
      const reason = r.reason instanceof CatalogError ? r.reason.message : String(r.reason);
      console.warn(`Failed to rehydrate ${zid}: ${reason}`);
      failed.push({ zid, reason });
    }
  }
  if (failed.length) {
    const failedZids = new Set(failed.map(f => f.zid));
    savePinnedZids(zids.filter(z => !failedZids.has(z)));
  }
  rebuildToolbox();
  return { loaded: zids.length - failed.length, failed };
}
