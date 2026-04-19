// Language registry + detection.
//
// Each entry maps:
//   iso     — ISO-639 code used as filename stem (i18n/<iso>.json) and as
//             the localStorage key + URL ?lang= param
//   native  — the language's own name (used in the picker)
//   wfZid   — Wikifunctions Z60 language ZID. Used when extracting labels
//             from Z12 multilingual fields on fetched Z-objects. ZIDs
//             verified against the live catalog via wikilambdasearch_labels.
//   rtl     — right-to-left
//   apiCode — ISO code the wikilambdasearch_functions_language API parameter
//             accepts. Almost always matches `iso`.
//
// Adding a language is entirely a data change here; no code edits.

export const LANGUAGES = [
  { iso: "en", native: "English",  wfZid: "Z1002", rtl: false },
  { iso: "de", native: "Deutsch",  wfZid: "Z1430", rtl: false },
  { iso: "fr", native: "Français", wfZid: "Z1004", rtl: false },
];

const STORAGE_KEY = "zblocks.lang";

// Detection chain: ?lang=xx → localStorage → navigator.language → "en".
// First candidate that's in the supported set wins.
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
