// Minimal i18n runtime for zblocks.
//
// Banana-i18n-compatible surface: dot-keyed messages, $1/$2/... param
// substitution, {{PLURAL:$1|one|many}} for the simple English-like
// case. Full banana-i18n (with CLDR plural rules, gender, grammar)
// can slot in later for languages that need it — this shim is the
// ≤60-line version that covers the current string set.
//
// Loading:
//   await initI18n("en");   // fetches i18n/en.json, walks data-i18n
//
// JS use:
//   import { msg } from "./i18n.js";
//   msg("header.buttons.run")                   // "Run"
//   msg("search.status.count", { 1: 3 })        // "3 results"
//
// HTML use:
//   <button data-i18n="header.buttons.run"></button>
//   <input data-i18n-placeholder="search.placeholder">
//   <span data-i18n-title="header.buttons.run_title">Run</span>

import { languageInfo } from "./languages.js";

let messages = {};
let fallbackMessages = {};   // always en, used when a key is missing from `messages`
let language = "en";

// Dogfood mode — URL `?dogfood=1`. In dogfood mode we render the
// Z33668/Z33775-resolved catalog instead of the hand-written one,
// and we DROP the English fallback entirely. Any string the
// Wikidata pipeline can't produce surfaces as its raw i18n key —
// the intentional nag that shows the remaining lexeme/sense gaps.
function isDogfoodMode() {
  try {
    return new URLSearchParams(window.location.search).get("dogfood") === "1";
  } catch { return false; }
}

export async function initI18n(lang) {
  language = lang || "en";
  const dogfood = isDogfoodMode();

  if (dogfood) {
    // Strict pipeline mode: no fallbacks. For English specifically,
    // the pipeline output lives in en.dogfood.json (the build writes
    // there so the hand-written en.json stays intact for normal use).
    try {
      messages = await loadCatalog(language, { dogfood: true });
    } catch (e) {
      console.warn(`i18n: couldn't load ${language} dogfood catalog:`, e);
      messages = {};
    }
    fallbackMessages = {};
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-i18n-dogfood", "1");
    }
    applyDomTranslations(document);
    return;
  }

  // Normal mode: always load hand-written en.json as fallback so
  // partial translations don't show raw keys.
  if (language !== "en") {
    try { fallbackMessages = await loadCatalog("en"); }
    catch (e) { console.warn("i18n: couldn't load en.json fallback:", e); }
  }
  try {
    messages = await loadCatalog(language);
  } catch (e) {
    console.warn(`i18n: couldn't load ${language}.json:`, e);
    messages = {};   // user-selected lang is missing; fallbackMessages carries English through
  }
  applyDomTranslations(document);
}

async function loadCatalog(iso, { dogfood = false } = {}) {
  // English has a separate dogfood artifact (the build writes there).
  // Other languages have only one catalog — their hand-free .json is
  // already the pipeline output.
  const file = dogfood && iso === "en" ? "en.dogfood.json" : `${iso}.json`;
  const resp = await fetch(`./i18n/${file}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

export function currentLanguage() { return language; }
export function currentLanguageZid() { return languageInfo(language).wfZid; }

// Look up a key. Order: current language → English fallback → the key
// itself (so the UI flags untranslated strings but never shows null).
// params is an object like {1: "Z33605", 2: 3}.
export function msg(key, params = {}) {
  const template = messages[key] ?? fallbackMessages[key];
  if (template === undefined) {
    console.warn(`i18n: missing key "${key}"`);
    return key;
  }
  return applyPlaceholders(template, params);
}

function applyPlaceholders(template, params) {
  // Order matters: plurals first (they can contain $N inside branches),
  // then numeric substitution.
  const pluraled = template.replace(
    /\{\{PLURAL:\$(\d+)\|([^|}]*)\|([^}]*)\}\}/g,
    (_, idx, one, many) => Number(params[idx]) === 1 ? one : many
  );
  return pluraled.replace(/\$(\d+)/g, (_, idx) =>
    params[idx] !== undefined ? String(params[idx]) : `$${idx}`
  );
}

// Walk all data-i18n* attributes under `root` and apply the current
// catalog. Called once by initI18n(); call again after dynamically
// adding i18n-tagged DOM fragments.
export function applyDomTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = msg(el.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-html]").forEach(el => {
    el.innerHTML = msg(el.dataset.i18nHtml);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = msg(el.dataset.i18nPlaceholder);
  });
  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = msg(el.dataset.i18nTitle);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    el.setAttribute("aria-label", msg(el.dataset.i18nAriaLabel));
  });
}
