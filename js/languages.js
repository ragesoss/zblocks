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

// ISO codes of chrome catalogs we actually ship under i18n/. Used by
// the language picker to badge entries as "fully translated". Keep in
// sync when a new <iso>.json lands under i18n/ — we maintain this
// explicitly instead of HEAD-probing the server because probing
// generates a console-visible 404 per unshipped language even when
// the response is caught, which makes the Network tab very noisy.
export const AVAILABLE_CHROME_CATALOGS = new Set(["en", "de", "fr"]);

export function hasCatalog(iso) {
  return AVAILABLE_CHROME_CATALOGS.has(iso);
}
