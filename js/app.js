// Main entry point.
//  1. Register all function + literal blocks.
//  2. Inject Blockly with the synthesised toolbox.
//  3. Wire shell declaration + export buttons.

import { registerAllBlocks, buildToolbox } from "./blocks.js";
import { initShell } from "./shell.js";
import { emitWorkspace, EmitError } from "./emitter.js";
import { EXAMPLES } from "./examples.js";
import {
  runComposition, usedArgs, placeholderForType, RunError,
} from "./runner.js";
import { typeLabel } from "./type_labels.js";
import {
  searchFunctions, fetchSignatureCached, cachedSignature,
  signatureText, signatureTooltip, CatalogError,
} from "./catalog.js";
import { importByZid, importFromJson, ImportError } from "./importer.js";
import {
  pinFunction, unpinFunction, isPinned,
  rehydratePinnedFunctions, seedStarterKitIfFirstRun,
} from "./pins.js";

registerAllBlocks();

// On first-ever load, seed the pin list with a Wikidata-friendly
// starter kit. After that, respect the user's curation (including an
// empty list — we don't re-seed if they've cleared it intentionally).
seedStarterKitIfFirstRun();

// Rehydrate pinned functions from localStorage before injecting Blockly,
// so the Pinned category is populated on first render. Failures (404s
// from deleted functions, network) are dropped from the stored list.
await rehydratePinnedFunctions();

const workspace = Blockly.inject("blocklyDiv", {
  toolbox: buildToolbox(),
  // Zelos is the Scratch-style renderer. Geras (classic) is a solid
  // fallback if Zelos's rounded shapes get in the way of dense
  // compositions — swap here to try it.
  renderer: "zelos",
  grid:   { spacing: 20, length: 3, colour: "#e2e8f0", snap: true },
  zoom:   { controls: true, wheel: true, startScale: 0.9, maxScale: 3, minScale: 0.4 },
  trashcan: true,
  move:   { scrollbars: true, drag: true, wheel: false },
});

initShell(workspace);

// ── Example loader ────────────────────────────────────────────────
const exampleSelect = document.getElementById("load-example-select");
EXAMPLES.forEach(ex => {
  const opt = document.createElement("option");
  opt.value = ex.id;
  opt.textContent = ex.label;
  opt.title = ex.summary;
  exampleSelect.appendChild(opt);
});
exampleSelect.addEventListener("change", () => {
  const id = exampleSelect.value;
  if (!id) return;
  const ex = EXAMPLES.find(e => e.id === id);
  if (!ex) return;
  const isDirty = workspace.getAllBlocks(false).length > 0;
  if (isDirty && !confirm("Load example will replace the current workspace. Continue?")) {
    exampleSelect.value = "";
    return;
  }
  ex.load(workspace);
  // Seed the Run modal with the example's default test inputs so it's
  // click-Run-and-go. Replaces (not merges) any prior values.
  if (ex.defaultInputs) {
    lastInputs = { ...ex.defaultInputs };
  }
  exampleSelect.value = "";  // reset so reselecting reloads
});

// ── Export button ─────────────────────────────────────────────────
document.getElementById("export-btn").addEventListener("click", () => {
  const errEl = document.getElementById("export-error");
  const out = document.getElementById("export-json");
  errEl.textContent = "";
  try {
    const zobj = emitWorkspace(workspace);
    out.value = JSON.stringify(zobj, null, 2);
  } catch (e) {
    out.value = "";
    if (e instanceof EmitError) {
      errEl.textContent = e.message;
    } else {
      errEl.textContent = `Unexpected error: ${e.message}`;
      console.error(e);
    }
  }
  document.getElementById("export-modal").showModal();
});

document.getElementById("export-close").addEventListener("click", () => {
  document.getElementById("export-modal").close();
});

// ── Run flow ──────────────────────────────────────────────────────
let lastInputs = {};  // remember per-arg values between runs

function openRunModal() {
  const args = usedArgs(workspace);
  const inputsDiv = document.getElementById("run-inputs");
  const errEl = document.getElementById("run-error");
  errEl.textContent = "";
  inputsDiv.innerHTML = "";
  if (args.length === 0) {
    inputsDiv.innerHTML = "<p class=\"hint\">No arg references in the workspace — running with no inputs.</p>";
  } else {
    args.forEach(arg => {
      const row = document.createElement("div");
      row.className = "run-input-row";
      row.innerHTML = `
        <label>
          <span class="run-input-label">${escapeHtml(arg.label)} <code title="${escapeHtml(arg.type)}">${escapeHtml(typeLabel(arg.type))}</code></span>
          <input type="text" data-label="${escapeHtml(arg.label)}"
                 placeholder="${escapeHtml(placeholderForType(arg.type))}"
                 value="${escapeHtml(lastInputs[arg.label] ?? "")}">
        </label>
      `;
      inputsDiv.appendChild(row);
    });
  }
  document.getElementById("run-modal").showModal();
  const first = inputsDiv.querySelector("input");
  if (first) first.focus();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

async function submitRun() {
  const errEl = document.getElementById("run-error");
  errEl.textContent = "";
  const inputs = {};
  document.querySelectorAll("#run-inputs input[data-label]").forEach(el => {
    const label = el.dataset.label;
    inputs[label] = el.value;
    lastInputs[label] = el.value;  // persist for next open
  });

  const submit = document.getElementById("run-submit");
  const origText = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Running\u2026";
  try {
    const result = await runComposition(workspace, inputs);
    document.getElementById("run-modal").close();
    showResult(result);
  } catch (e) {
    if (e instanceof RunError || e instanceof EmitError) {
      errEl.textContent = e.message;
    } else {
      errEl.textContent = `Unexpected: ${e.message}`;
      console.error(e);
    }
  } finally {
    submit.disabled = false;
    submit.textContent = origText;
  }
}

function showResult(result) {
  const heading = document.getElementById("result-heading");
  const val = document.getElementById("result-value");
  const raw = document.getElementById("result-raw");
  if (result.ok) {
    heading.textContent = "Result";
    heading.className = "";
    val.innerHTML =
      `<div class="result-formatted">${escapeHtml(result.formatted ?? "")}</div>` +
      renderMetadata(result.metadata);
  } else {
    heading.textContent = "Error";
    heading.className = "error";
    val.innerHTML = renderError(result) + renderMetadata(result.metadata);
  }
  raw.textContent = JSON.stringify(result.raw, null, 2);
  document.getElementById("result-modal").showModal();
}

function zidLink(zid) {
  if (!zid || zid === "unknown") return escapeHtml(zid ?? "?");
  const safe = encodeURIComponent(zid);
  return `<a href="https://www.wikifunctions.org/wiki/${safe}" target="_blank" rel="noopener">${escapeHtml(zid)}</a>`;
}

function renderError(r) {
  const titlePart = r.errorTitle ? `${escapeHtml(r.errorTitle)} ` : "";
  const hintPart  = r.errorHint  ? `<div class="error-hint">${escapeHtml(r.errorHint)}</div>` : "";
  const msgPart   = r.errorMessage ? `<div class="error-message">${escapeHtml(r.errorMessage)}</div>` : "";
  return `
    <div class="result-error">
      <div class="error-title">${titlePart}<span class="error-zid">${zidLink(r.errorType)}</span></div>
      ${msgPart}
      ${hintPart}
    </div>
  `;
}

function renderMetadata(m) {
  if (!m) return "";
  const bits = [];
  if (m.implementationId) {
    const kind = m.implementationKind ? ` (${escapeHtml(m.implementationKind)})` : "";
    const lang = m.programmingLanguage ? `, ${escapeHtml(m.programmingLanguage)}` : "";
    bits.push(`impl ${zidLink(m.implementationId)}${kind}${lang}`);
  }
  const timing = [];
  if (m.orchestrationDuration) timing.push(`orchestration ${escapeHtml(m.orchestrationDuration)}`);
  if (m.evaluationDuration)    timing.push(`eval ${escapeHtml(m.evaluationDuration)}`);
  if (timing.length) bits.push(timing.join(", "));
  return bits.length ? `<div class="result-meta">${bits.join(" \u00b7 ")}</div>` : "";
}

document.getElementById("run-btn").addEventListener("click", openRunModal);
document.getElementById("run-cancel").addEventListener("click", () => {
  document.getElementById("run-modal").close();
});
document.getElementById("run-submit").addEventListener("click", submitRun);
document.getElementById("result-close").addEventListener("click", () => {
  document.getElementById("result-modal").close();
});
document.getElementById("result-rerun").addEventListener("click", () => {
  document.getElementById("result-modal").close();
  openRunModal();
});

// ── Import (round-trip existing Z14) ──────────────────────────────
document.getElementById("import-btn").addEventListener("click", () => {
  document.getElementById("import-zid").value = "";
  document.getElementById("import-json").value = "";
  document.getElementById("import-error").textContent = "";
  document.getElementById("import-modal").showModal();
  document.getElementById("import-zid").focus();
});
document.getElementById("import-cancel").addEventListener("click", () => {
  document.getElementById("import-modal").close();
});
document.getElementById("import-submit").addEventListener("click", async () => {
  const zidRaw = document.getElementById("import-zid").value.trim();
  const jsonRaw = document.getElementById("import-json").value.trim();
  const errEl = document.getElementById("import-error");
  errEl.textContent = "";
  if (!zidRaw && !jsonRaw) {
    errEl.textContent = "Provide a ZID or paste composition JSON.";
    return;
  }
  const isDirty = workspace.getAllBlocks(false).length > 0;
  if (isDirty && !confirm("Import will replace the current workspace. Continue?")) return;

  const btn = document.getElementById("import-submit");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Importing\u2026";
  try {
    const { state } = zidRaw ? await importByZid(zidRaw) : await importFromJson(jsonRaw);
    workspace.clear();
    Blockly.serialization.workspaces.load(state, workspace);
    document.getElementById("import-modal").close();
  } catch (e) {
    if (e instanceof ImportError || e instanceof CatalogError) {
      errEl.textContent = e.message;
    } else {
      errEl.textContent = `Unexpected: ${e.message}`;
      console.error(e);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

// ── Add function (search + pin) ───────────────────────────────────
const searchInputEl = document.getElementById("search-input");
const searchStatusEl = document.getElementById("search-status");
const searchResultsEl = document.getElementById("search-results");
const filterOutputEl = document.getElementById("filter-output");
const filterInputEl  = document.getElementById("filter-input");
let searchAbort = null;
let searchDebounce = null;

// Quick-select types — covers the common plumbing cases.
const COMMON_TYPES = [
  { zid: "Z6",     label: "String"   },
  { zid: "Z16683", label: "Integer"  },
  { zid: "Z20838", label: "Float64"  },
  { zid: "Z40",    label: "Boolean"  },
  { zid: "Z6001",  label: "WD Item"  },
  { zid: "Z6091",  label: "Item Ref" },
  { zid: "Z6092",  label: "Prop Ref" },
  { zid: "Z6007",  label: "Claim"    },
  { zid: "Z881",   label: "List"     },
];

function populateFilterChips() {
  for (const row of document.querySelectorAll(".filter-row")) {
    const chipsEl = row.querySelector(".filter-chips");
    const filterInput = row.querySelector(".filter-input");
    chipsEl.innerHTML = COMMON_TYPES.map(t =>
      `<button type="button" class="filter-chip" data-zid="${t.zid}" title="${escapeHtml(t.label)} (${t.zid})">${escapeHtml(t.zid)}</button>`
    ).join("");
    chipsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-chip");
      if (!btn) return;
      const zid = btn.dataset.zid;
      // Toggle: if already selected, clear; otherwise set (or append for takes).
      if (row.dataset.filter === "input") {
        const current = filterInput.value.split(",").map(s => s.trim()).filter(Boolean);
        if (current.includes(zid)) {
          filterInput.value = current.filter(z => z !== zid).join(", ");
        } else {
          filterInput.value = [...current, zid].join(", ");
        }
      } else {
        filterInput.value = filterInput.value === zid ? "" : zid;
      }
      syncChipState(row);
      triggerSearch();
    });
    filterInput.addEventListener("input", () => {
      syncChipState(row);
      triggerSearch();
    });
  }
}

function syncChipState(row) {
  const current = row.querySelector(".filter-input").value
    .split(",").map(s => s.trim()).filter(Boolean);
  for (const btn of row.querySelectorAll(".filter-chip")) {
    btn.classList.toggle("active", current.includes(btn.dataset.zid));
  }
}

function currentSearchArgs() {
  const query = searchInputEl.value.trim();
  const outRaw = filterOutputEl.value.trim();
  const inRaw  = filterInputEl.value.trim();
  const outputType = /^Z\d+$/.test(outRaw) ? outRaw : undefined;
  const inputZids = inRaw
    ? inRaw.split(",").map(s => s.trim()).filter(z => /^Z\d+$/.test(z))
    : [];
  const inputTypes = inputZids.length ? inputZids.join(",") : undefined;
  return { query, outputType, inputTypes, hasFilters: Boolean(outputType || inputTypes) };
}

populateFilterChips();

document.getElementById("add-function-btn").addEventListener("click", () => {
  searchInputEl.value = "";
  filterOutputEl.value = "";
  filterInputEl.value = "";
  for (const row of document.querySelectorAll(".filter-row")) syncChipState(row);
  searchResultsEl.innerHTML = "";
  searchStatusEl.textContent = "";
  document.getElementById("add-function-modal").showModal();
  searchInputEl.focus();
});

document.getElementById("search-close").addEventListener("click", () => {
  document.getElementById("add-function-modal").close();
});

searchInputEl.addEventListener("input", triggerSearch);

function triggerSearch() {
  clearTimeout(searchDebounce);
  const args = currentSearchArgs();
  if (!args.query && !args.hasFilters) {
    searchResultsEl.innerHTML = "";
    searchStatusEl.textContent = "";
    return;
  }
  searchStatusEl.textContent = "searching\u2026";
  searchDebounce = setTimeout(() => performSearch(args), 200);
}

async function performSearch({ query, outputType, inputTypes }) {
  if (searchAbort) searchAbort.abort();
  searchAbort = new AbortController();
  const { signal } = searchAbort;
  try {
    const results = await searchFunctions(query, {
      signal, limit: 20, outputType, inputTypes,
    });
    renderSearchResults(results);
    searchStatusEl.textContent = results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "no matches";
    decorateResultsWithSignatures(results, signal);
  } catch (e) {
    if (e.name === "AbortError") return;
    searchStatusEl.textContent = "";
    searchResultsEl.innerHTML = `<div class="search-error">${escapeHtml(e.message || String(e))}</div>`;
  }
}

// Parallel-fetch Z8 signatures for each result row and decorate the
// DOM as they arrive. Cached in-memory so repeat searches don't
// re-fetch. Aborts in flight when a new search supersedes this one.
function decorateResultsWithSignatures(results, signal) {
  for (const r of results) {
    const cached = cachedSignature(r.zid);
    if (cached) {
      paintSignature(r.zid, cached);
      continue;
    }
    fetchSignatureCached(r.zid, { signal })
      .then(sig => { if (!signal.aborted) paintSignature(r.zid, sig); })
      .catch(() => { /* ignore: deleted, network, aborted */ });
  }
}

function paintSignature(zid, sig) {
  const row = searchResultsEl.querySelector(`.search-result[data-zid="${CSS.escape(zid)}"]`);
  if (!row) return;
  const slot = row.querySelector(".search-result-signature");
  if (!slot) return;
  slot.textContent = signatureText(sig);
  slot.title = signatureTooltip(sig);
}

function renderSearchResults(results) {
  if (results.length === 0) {
    searchResultsEl.innerHTML = "";
    return;
  }
  searchResultsEl.innerHTML = results.map(r => {
    const pinned = isPinned(r.zid);
    const cached = cachedSignature(r.zid);
    const sigText = cached ? escapeHtml(signatureText(cached)) : "";
    const sigTitle = cached ? ` title="${escapeHtml(signatureTooltip(cached))}"` : "";
    return `
      <div class="search-result" data-zid="${escapeHtml(r.zid)}">
        <div class="search-result-main">
          <span class="search-result-label">${escapeHtml(r.label)}</span>
          <div class="search-result-sub">
            <a class="search-result-zid" href="https://www.wikifunctions.org/wiki/${escapeHtml(r.zid)}" target="_blank" rel="noopener">${escapeHtml(r.zid)}</a>
            <span class="search-result-signature"${sigTitle}>${sigText}</span>
          </div>
        </div>
        <button class="search-result-pin ${pinned ? "pinned" : ""}" data-zid="${escapeHtml(r.zid)}" data-pinned="${pinned}">
          ${pinned ? "Unpin" : "Pin"}
        </button>
      </div>
    `;
  }).join("");
}

searchResultsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".search-result-pin");
  if (!btn) return;
  const zid = btn.dataset.zid;
  const wasPinned = btn.dataset.pinned === "true";
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = wasPinned ? "Unpinning\u2026" : "Pinning\u2026";
  try {
    if (wasPinned) {
      unpinFunction(zid);
      btn.dataset.pinned = "false";
      btn.classList.remove("pinned");
      btn.textContent = "Pin";
    } else {
      await pinFunction(zid);
      btn.dataset.pinned = "true";
      btn.classList.add("pinned");
      btn.textContent = "Unpin";
    }
  } catch (err) {
    btn.textContent = origText;
    alert(`${wasPinned ? "Unpin" : "Pin"} ${zid} failed: ${err.message || err}`);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("export-copy").addEventListener("click", async () => {
  const btn = document.getElementById("export-copy");
  const out = document.getElementById("export-json");
  if (!out.value) return;
  try {
    await navigator.clipboard.writeText(out.value);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (e) {
    alert(`Copy failed: ${e.message}. Select the text manually.`);
  }
});
