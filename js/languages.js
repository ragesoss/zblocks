// Language registry + detection.
//
// The language list itself lives in js/languages-data.js, auto-generated
// by scripts/build-languages.mjs from the Wikifunctions Z60 catalogue.
// Re-run that script periodically to pick up new languages.
//
// This module holds the small amount of logic that needs to stay
// hand-written: detection chain, localStorage persistence, lookup.

import { LANGUAGES } from "./languages-data.js";

export { LANGUAGES };

const STORAGE_KEY = "zblocks.lang";

// Detection chain: ?lang=xx → localStorage → navigator.language → "en".
// First candidate that's in the supported set wins. Handles regional
// variants like "pt-BR" by stripping to primary subtag.
export function detectLanguage() {
  const urlParam = new URLSearchParams(location.search).get("lang");
  const stored = localStorage.getItem(STORAGE_KEY);
  const nav = navigator.language ? navigator.language.slice(0, 2) : null;
  for (const c of [urlParam, stored, nav]) {
    if (c && LANGUAGES.some(l => l.iso === c)) return c;
  }
  return LANGUAGES[0].iso;
}

export function saveLanguagePreference(iso) {
  if (LANGUAGES.some(l => l.iso === iso)) {
    localStorage.setItem(STORAGE_KEY, iso);
  }
}

export function languageInfo(iso) {
  return LANGUAGES.find(l => l.iso === iso) || LANGUAGES[0];
}

// Check whether a chrome catalog exists for a language. Used by the
// picker to mark "fully translated" vs "Wikifunctions content only".
// Results cached in memory; re-check on a page load.
const CATALOG_AVAILABILITY = new Map();

export async function hasCatalog(iso) {
  if (CATALOG_AVAILABILITY.has(iso)) return CATALOG_AVAILABILITY.get(iso);
  try {
    const resp = await fetch(`./i18n/${iso}.json`, { method: "HEAD" });
    const ok = resp.ok;
    CATALOG_AVAILABILITY.set(iso, ok);
    return ok;
  } catch {
    CATALOG_AVAILABILITY.set(iso, false);
    return false;
  }
}
