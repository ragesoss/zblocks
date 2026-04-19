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

export async function initI18n(lang) {
  language = lang || "en";
  // Always load English as the fallback pool so partial translations
  // (common during language ramp-up) don't show raw keys in the UI.
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

async function loadCatalog(iso) {
  const resp = await fetch(`./i18n/${iso}.json`);
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
