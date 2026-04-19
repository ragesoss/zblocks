// Search Wikidata entities via wbsearchentities. Callers pass an
// onSelect callback that receives the picked { id, label, description }.
//
// Anonymous CORS is allowed on wikidata.org/w/api.php with origin=*,
// same pattern as runner.js uses for wikifunctions.org.
//
// Two entry points use this:
//  - slot_picker.js:  "Search Wikidata…" row when the slot accepts a
//                     Wikidata item/property type.
//  - blocks.js:       right-click context menu on wf_item_ref /
//                     wf_property_ref literal blocks, seeded with the
//                     block's current field value.

const WD_API = "https://www.wikidata.org/w/api.php";
const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 20;

let modalState = null;     // { entityType, onSelect }
let debounceTimer = null;
let abortCtrl = null;

export async function searchWikidataEntities(query, type = "item", { signal } = {}) {
  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    uselang: "en",
    format: "json",
    origin: "*",
    type,
    limit: String(RESULT_LIMIT),
  });
  const resp = await fetch(`${WD_API}?${params}`, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
  return data.search || [];
}

export function openWikidataSearch({ entityType = "item", onSelect, initialQuery = "" }) {
  modalState = { entityType, onSelect };

  const dialog = document.getElementById("wikidata-search-modal");
  const heading = document.getElementById("wikidata-search-heading");
  const hint = document.getElementById("wikidata-search-hint");
  const input = document.getElementById("wikidata-search-input");
  const resultsEl = document.getElementById("wikidata-search-results");

  const noun = entityType === "property" ? "property" : "item";
  const prefix = entityType === "property" ? "P" : "Q";
  heading.textContent = `Search Wikidata ${noun}s`;
  hint.innerHTML = `Search <code>wikidata.org</code> for a ${noun} by label. Picking a result uses its <code>${prefix}</code>-number.`;
  input.placeholder = entityType === "property"
    ? "e.g. \u201Csubclass of\u201D"
    : "e.g. \u201CDouglas Adams\u201D";
  input.value = initialQuery;
  resultsEl.innerHTML = "";

  dialog.showModal();
  input.focus();
  input.select();

  if (initialQuery.trim()) runSearch(initialQuery);
}

export function closeWikidataSearch() {
  const dialog = document.getElementById("wikidata-search-modal");
  if (dialog.open) dialog.close();
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
  clearTimeout(debounceTimer);
  modalState = null;
}

async function runSearch(query) {
  if (!modalState) return;
  const { entityType } = modalState;
  const resultsEl = document.getElementById("wikidata-search-results");
  const q = query.trim();
  if (!q) {
    resultsEl.innerHTML = "";
    return;
  }

  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();
  const { signal } = abortCtrl;

  resultsEl.innerHTML = `<div class="wikidata-search-status">searching\u2026</div>`;
  try {
    const hits = await searchWikidataEntities(q, entityType, { signal });
    if (signal.aborted) return;
    renderResults(hits);
  } catch (e) {
    if (e.name === "AbortError") return;
    resultsEl.innerHTML = `<div class="wikidata-search-error">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderResults(hits) {
  const resultsEl = document.getElementById("wikidata-search-results");
  if (!hits.length) {
    resultsEl.innerHTML = `<div class="wikidata-search-empty">No matches.</div>`;
    return;
  }
  resultsEl.innerHTML = hits.map(h => `
    <button class="wikidata-search-item"
            data-id="${escapeHtml(h.id)}"
            data-label="${escapeHtml(h.label || "")}"
            data-description="${escapeHtml(h.description || "")}">
      <div class="wikidata-search-item-main">
        <span class="wikidata-search-item-label">${escapeHtml(h.label || "(unlabeled)")}</span>
        <span class="wikidata-search-item-id">${escapeHtml(h.id)}</span>
      </div>
      ${h.description
        ? `<div class="wikidata-search-item-desc">${escapeHtml(h.description)}</div>`
        : ""}
    </button>
  `).join("");
}

export function initWikidataSearch() {
  const input = document.getElementById("wikidata-search-input");
  const resultsEl = document.getElementById("wikidata-search-results");
  const closeBtn = document.getElementById("wikidata-search-close");

  input.addEventListener("input", (e) => {
    clearTimeout(debounceTimer);
    const q = e.target.value;
    debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
  });

  resultsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".wikidata-search-item");
    if (!btn) return;
    const pick = {
      id: btn.dataset.id,
      label: btn.dataset.label,
      description: btn.dataset.description,
    };
    const cb = modalState?.onSelect;
    closeWikidataSearch();
    if (cb) cb(pick);
  });

  closeBtn.addEventListener("click", closeWikidataSearch);
  // ESC close comes for free from <dialog>.
  document.getElementById("wikidata-search-modal").addEventListener("close", () => {
    // User hit ESC or otherwise closed — clear state.
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }
    modalState = null;
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
