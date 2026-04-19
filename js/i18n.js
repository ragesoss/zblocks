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

let messages = {};
let language = "en";

export async function initI18n(lang) {
  language = lang || "en";
  const resp = await fetch(`./i18n/${language}.json`);
  if (!resp.ok) {
    console.warn(`i18n: can't load ${language}.json (HTTP ${resp.status}); falling back to keys.`);
    return;
  }
  messages = await resp.json();
  applyDomTranslations(document);
}

export function currentLanguage() { return language; }

// Look up a key and substitute parameters. params is an object like
// {1: "Z33605", 2: 3}. Missing key → returns the key itself so it's
// visible in the UI that it's untranslated.
export function msg(key, params = {}) {
  const template = messages[key];
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
