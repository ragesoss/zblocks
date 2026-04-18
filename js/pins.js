// Pinned functions: the user's growing collection of functions pulled
// in via search. Persists across page loads via localStorage.
//
// Each pinned ZID is re-fetched and re-registered on startup so the
// blocks exist in Blockly before any workspace state tries to use them.

import { fetchSignatureCached, CatalogError } from "./catalog.js";
import { registerFunctionBlock } from "./blocks.js";
import { rebuildToolbox } from "./shell.js";
import { FUNCTIONS } from "./functions.js";
import { loadPinnedZids, savePinnedZids } from "./storage.js";

export { loadPinnedZids };

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

// Called once at startup. Re-fetches each pinned function and
// registers its block. Failures (404, network) are logged and the
// ZID is dropped from the pinned list so the next reload doesn't
// retry indefinitely.
export async function rehydratePinnedFunctions() {
  const zids = loadPinnedZids();
  if (zids.length === 0) return { loaded: 0, failed: [] };
  const failed = [];
  for (const zid of zids) {
    try {
      const fn = await fetchSignatureCached(zid);
      registerFunctionBlock(fn);
    } catch (e) {
      const reason = e instanceof CatalogError ? e.message : String(e);
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
