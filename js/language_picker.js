// Typeahead language picker, vanilla-JS combobox.
//
// UX modelled on WikiEduDashboard's react-select picker, but without
// the React dependency. Substring match on native name, English name,
// or ISO code — users can type in their own script ("日本", "Deutsch")
// or in English.
//
// The 500+ entries in languages-data.js would make a flat <select>
// unusable, so we render a filtered <ul role="listbox">. Translated
// languages (those with a shipped i18n/<iso>.json chrome catalog)
// get a "✓" badge and sort to the top of results; the rest follow
// in their data-file order (pinned first, then alphabetical by
// native name).
//
// Keyboard:
//   ↑/↓     move highlight
//   Enter   pick highlighted
//   Escape  close without change
//   typing  filter

import { LANGUAGES, saveLanguagePreference, languageInfo, hasCatalog } from "./languages.js";
import { currentLanguage } from "./i18n.js";

const MAX_VISIBLE = 50;  // cap the dropdown; further filtering via typing

let translatedSet = new Set();   // populated async on open
let highlightIdx = -1;
let visibleEntries = [];         // entries currently shown in the list

export async function initLanguagePicker() {
  const current = currentLanguage();
  const container = document.getElementById("language-picker-container");
  if (!container) return;

  container.innerHTML = `
    <div class="lang-combobox" role="combobox"
         aria-haspopup="listbox" aria-expanded="false"
         aria-owns="lang-list">
      <input type="text" id="lang-input"
             class="lang-input"
             role="searchbox"
             aria-autocomplete="list"
             aria-controls="lang-list"
             value="${escapeAttr(languageInfo(current).native)}"
             autocomplete="off"
             spellcheck="false">
      <ul id="lang-list" class="lang-list" role="listbox" hidden></ul>
    </div>
  `;

  const input = document.getElementById("lang-input");
  const list = document.getElementById("lang-list");

  // Async-probe which languages have chrome catalogs so they can be
  // marked as "translated" in the list. Fire-and-forget; when it
  // resolves we re-render if the list is open.
  probeTranslatedSet().then(() => {
    if (!list.hidden) renderList(input.value);
  });

  input.addEventListener("focus", () => {
    input.select();
    openList("");
  });
  input.addEventListener("input", () => renderList(input.value));
  input.addEventListener("keydown", onKey);
  input.addEventListener("blur", () => {
    // Delay so click handlers on options fire first.
    setTimeout(() => closeList(), 150);
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-iso]");
    if (!li) return;
    e.preventDefault();
    pick(li.dataset.iso);
  });

  function openList(filter) {
    list.hidden = false;
    container.querySelector(".lang-combobox").setAttribute("aria-expanded", "true");
    highlightIdx = -1;
    renderList(filter);
  }
  function closeList() {
    list.hidden = true;
    container.querySelector(".lang-combobox").setAttribute("aria-expanded", "false");
    // Restore display of current language if input was modified.
    input.value = languageInfo(currentLanguage()).native;
  }
  function onKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlightIdx = Math.min(highlightIdx + 1, visibleEntries.length - 1);
      updateHighlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlightIdx = Math.max(highlightIdx - 1, 0);
      updateHighlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick_ = visibleEntries[highlightIdx] || visibleEntries[0];
      if (pick_) pick(pick_.iso);
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.blur();
    }
  }
  function updateHighlight() {
    [...list.children].forEach((li, i) => {
      li.setAttribute("aria-selected", i === highlightIdx ? "true" : "false");
      if (i === highlightIdx) li.scrollIntoView({ block: "nearest" });
    });
  }
  function renderList(filter) {
    const q = (filter || "").toLowerCase().trim();
    const matches = q === ""
      ? LANGUAGES
      : LANGUAGES.filter(l =>
          l.iso.toLowerCase().includes(q) ||
          l.native.toLowerCase().includes(q) ||
          (l.english && l.english.toLowerCase().includes(q)));

    // Translated languages float to the top within the filtered result.
    const translated = matches.filter(l => translatedSet.has(l.iso));
    const rest = matches.filter(l => !translatedSet.has(l.iso));
    visibleEntries = [...translated, ...rest].slice(0, MAX_VISIBLE);

    if (visibleEntries.length === 0) {
      list.innerHTML = `<li class="lang-empty">No languages match</li>`;
      return;
    }
    list.innerHTML = visibleEntries.map((l, i) => {
      const isTranslated = translatedSet.has(l.iso);
      const badge = isTranslated ? `<span class="lang-badge" title="UI chrome translated">✓</span>` : "";
      const eng = l.english && l.english !== l.native
        ? ` <span class="lang-en">${escapeHtml(l.english)}</span>` : "";
      return `
        <li role="option" data-iso="${escapeAttr(l.iso)}" aria-selected="false"
            id="lang-opt-${i}">
          ${badge}
          <span class="lang-native">${escapeHtml(l.native)}</span>${eng}
          <span class="lang-code">${escapeHtml(l.iso)}</span>
        </li>
      `;
    }).join("");
    highlightIdx = 0;
    updateHighlight();
  }
  function pick(iso) {
    if (iso === currentLanguage()) {
      closeList();
      return;
    }
    saveLanguagePreference(iso);
    location.reload();
  }
}

async function probeTranslatedSet() {
  // Probe each pinned language. Unpinned languages are assumed chrome-
  // less (since we'd pin a language once its chrome ships anyway).
  // Cheap HEAD requests per probe; ~10 requests total.
  const pinnedCount = 12;  // matches scripts/build-languages.mjs PINNED_TOP
  const candidates = LANGUAGES.slice(0, pinnedCount).map(l => l.iso);
  const results = await Promise.all(candidates.map(iso => hasCatalog(iso).then(ok => [iso, ok])));
  translatedSet = new Set(results.filter(([, ok]) => ok).map(([iso]) => iso));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
