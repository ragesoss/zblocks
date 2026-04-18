// Main entry point.
//  1. Register all function + literal blocks.
//  2. Inject Blockly with the synthesised toolbox.
//  3. Wire shell declaration + export buttons.

import { registerAllBlocks, buildToolbox } from "./blocks.js";
import { initShell } from "./shell.js";
import { emitWorkspace, EmitError } from "./emitter.js";
import { EXAMPLES } from "./examples.js";
import {
  runComposition, runBlock, usedArgs, usedArgsInBlock,
  placeholderForType, RunError,
} from "./runner.js";
import { typeLabel } from "./type_labels.js";
import {
  searchFunctions, fetchSignatureCached, cachedSignature, lookupByZid,
  fetchFunctionTests, argValueToString,
  signatureText, signatureTooltip, CatalogError,
} from "./catalog.js";
import { SHELL } from "./shell.js";
import { importByZid, importFromJson, ImportError, exprToBlockSpec } from "./importer.js";
import { initSlotPicker } from "./slot_picker.js";
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
initSlotPicker();

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
let currentTests = [];  // tests loaded for the current shell function
let runTargetBlock = null;  // set to a block when scope is subtree; null = full workspace

function openRunModal(targetBlock = null) {
  runTargetBlock = targetBlock;
  const args = targetBlock ? usedArgsInBlock(targetBlock) : usedArgs(workspace);
  const inputsDiv = document.getElementById("run-inputs");
  const errEl = document.getElementById("run-error");
  errEl.textContent = "";
  inputsDiv.innerHTML = "";
  maybeLoadTestsForShell(args);
  // Add a scope banner when running a specific block.
  if (targetBlock) {
    const scopeDiv = document.createElement("div");
    scopeDiv.className = "run-scope-banner";
    scopeDiv.innerHTML = `<strong>Running subtree:</strong> ${escapeHtml(targetBlock.toString().slice(0, 80))}`;
    inputsDiv.appendChild(scopeDiv);
  }
  if (args.length === 0) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = targetBlock
      ? "This subtree doesn't reference any shell arguments — running as-is."
      : "No arg references in the workspace — running with no inputs.";
    inputsDiv.appendChild(p);
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
    const result = runTargetBlock
      ? await runBlock(runTargetBlock, inputs)
      : await runComposition(workspace, inputs);
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

// Async populate the "Prefill from test" dropdown using the shell
// function's attached Z20 testers. Hidden if the shell isn't set to a
// real ZID or the function has no tests.
async function maybeLoadTestsForShell(args) {
  const loaderEl = document.getElementById("run-test-loader");
  const selectEl = document.getElementById("run-test-select");
  currentTests = [];
  if (!args.length || !/^Z\d+$/.test(SHELL.zid || "")) {
    loaderEl.hidden = true;
    return;
  }
  loaderEl.hidden = false;
  selectEl.disabled = true;
  selectEl.innerHTML = '<option value="">loading tests\u2026</option>';
  try {
    const tests = await fetchFunctionTests(SHELL.zid);
    if (tests.length === 0) {
      selectEl.innerHTML = '<option value="">(no tests on this function)</option>';
      return;
    }
    currentTests = tests;
    selectEl.innerHTML =
      '<option value="">choose a test\u2026</option>' +
      tests.map((t, i) =>
        `<option value="${i}">${escapeHtml(t.label)} \u2014 ${escapeHtml(t.testZid)}</option>`
      ).join("");
    selectEl.disabled = false;
  } catch (e) {
    selectEl.innerHTML = `<option value="">(test fetch failed: ${escapeHtml(e.message || String(e))})</option>`;
  }
}

document.getElementById("run-test-select").addEventListener("change", (e) => {
  const idx = Number(e.target.value);
  if (!Number.isInteger(idx) || !currentTests[idx]) return;
  const test = currentTests[idx];
  const rows = document.querySelectorAll("#run-inputs input[data-label]");
  rows.forEach(inputEl => {
    const label = inputEl.dataset.label;
    const shellArgIdx = SHELL.args.findIndex(a => a.label === label);
    if (shellArgIdx < 0) return;
    const argKey = `${SHELL.zid}K${shellArgIdx + 1}`;
    const val = test.argValues[argKey];
    if (val === undefined) return;
    const str = argValueToString(val);
    if (str === "") return;
    inputEl.value = str;
    lastInputs[label] = str;
  });
});

document.getElementById("run-btn").addEventListener("click", () => openRunModal(null));
document.addEventListener("zblocks-run-block", (e) => {
  const block = e.detail?.block;
  if (block) openRunModal(block);
});

// ── Fill block slots from test ────────────────────────────────────
let fillSlotsContext = null;  // { block, zid, fn, tests, selectedIdx }

document.addEventListener("zblocks-fill-slots", async (e) => {
  const { block, zid, fn } = e.detail || {};
  if (!block || !zid || !fn) return;
  fillSlotsContext = { block, zid, fn, tests: [], selectedIdx: -1 };

  const dialog = document.getElementById("fill-slots-modal");
  const heading = document.getElementById("fill-slots-heading");
  const hint = document.getElementById("fill-slots-hint");
  const selectEl = document.getElementById("fill-slots-select");
  const previewEl = document.getElementById("fill-slots-preview");
  const errEl = document.getElementById("fill-slots-error");
  const applyBtn = document.getElementById("fill-slots-apply");

  heading.textContent = `Fill slots from test — ${fn.label}`;
  hint.innerHTML = `Tests attached to <code>${escapeHtml(zid)}</code> carry known-good inputs. Pick one to populate the block's empty (or shadow-default) slots.`;
  selectEl.innerHTML = '<option value="">loading\u2026</option>';
  selectEl.disabled = true;
  previewEl.innerHTML = "";
  errEl.textContent = "";
  applyBtn.disabled = true;
  dialog.showModal();

  try {
    const tests = await fetchFunctionTests(zid);
    fillSlotsContext.tests = tests;
    if (tests.length === 0) {
      selectEl.innerHTML = '<option value="">(no tests on this function)</option>';
      return;
    }
    selectEl.innerHTML = '<option value="">choose a test\u2026</option>' +
      tests.map((t, i) => `<option value="${i}">${escapeHtml(t.label)} \u2014 ${escapeHtml(t.testZid)}</option>`).join("");
    selectEl.disabled = false;
  } catch (err) {
    errEl.textContent = `Couldn't load tests: ${err.message || err}`;
  }
});

document.getElementById("fill-slots-select").addEventListener("change", (e) => {
  const idx = Number(e.target.value);
  if (!Number.isInteger(idx) || !fillSlotsContext?.tests[idx]) {
    document.getElementById("fill-slots-preview").innerHTML = "";
    document.getElementById("fill-slots-apply").disabled = true;
    return;
  }
  fillSlotsContext.selectedIdx = idx;
  renderFillSlotsPreview();
});

function renderFillSlotsPreview() {
  const previewEl = document.getElementById("fill-slots-preview");
  const { block, fn, tests, selectedIdx } = fillSlotsContext;
  const test = tests[selectedIdx];
  if (!test) { previewEl.innerHTML = ""; return; }

  const rows = fn.args.map(arg => {
    const input = block.inputList.find(i => i.name === arg.key);
    const current = input?.connection?.targetBlock();
    const isOverridable = !current || current.isShadow();
    const testValue = test.argValues[arg.key];
    const valStr = testValue !== undefined ? argValueToString(testValue) : "(not in test)";
    const fate = !testValue
      ? `<span class="fill-fate skip">skip (no test value)</span>`
      : !isOverridable
        ? `<span class="fill-fate skip">keep current (non-shadow)</span>`
        : `<span class="fill-fate will">will set</span>`;
    return `
      <div class="fill-slots-row">
        <span class="fill-arg-label">${escapeHtml(arg.label)}</span>
        <span class="fill-arg-type"><code>${escapeHtml(arg.type)}</code></span>
        <span class="fill-arg-value">${escapeHtml(valStr)}</span>
        ${fate}
      </div>
    `;
  }).join("");
  previewEl.innerHTML = rows;
  document.getElementById("fill-slots-apply").disabled = false;
}

document.getElementById("fill-slots-cancel").addEventListener("click", () => {
  document.getElementById("fill-slots-modal").close();
});

document.getElementById("fill-slots-apply").addEventListener("click", () => {
  const { block, fn, tests, selectedIdx } = fillSlotsContext || {};
  const test = tests?.[selectedIdx];
  if (!block || !test) return;

  // Save the current block state, splice in test-derived children at
  // empty/shadow slots, dispose the old block, and rebuild from state.
  // This keeps position and preserves real non-shadow children.
  const state = Blockly.serialization.blocks.save(block);
  state.inputs = state.inputs || {};

  const errors = [];
  for (const arg of fn.args) {
    const input = block.inputList.find(i => i.name === arg.key);
    const current = input?.connection?.targetBlock();
    if (current && !current.isShadow()) continue;  // keep real children
    const value = test.argValues[arg.key];
    if (value === undefined) continue;
    const spec = exprToBlockSpec(value);
    if (typeof spec === "string") {
      errors.push(`${arg.label}: ${spec}`);
      continue;
    }
    state.inputs[arg.key] = { block: spec };
  }

  if (errors.length) {
    document.getElementById("fill-slots-error").innerHTML =
      "Some slots couldn't be filled:<br>" + errors.map(escapeHtml).join("<br>");
    return;
  }

  // Replace the block in place.
  const xy = block.getRelativeToSurfaceXY();
  state.x = xy.x;
  state.y = xy.y;
  block.dispose(false);
  Blockly.serialization.blocks.append(state, workspace);
  document.getElementById("fill-slots-modal").close();
});
document.getElementById("run-cancel").addEventListener("click", () => {
  document.getElementById("run-modal").close();
});
document.getElementById("run-submit").addEventListener("click", submitRun);
document.getElementById("result-close").addEventListener("click", () => {
  document.getElementById("result-modal").close();
});
document.getElementById("result-rerun").addEventListener("click", () => {
  document.getElementById("result-modal").close();
  // Preserve the previous scope (block subtree or full workspace).
  openRunModal(runTargetBlock);
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

  // If the query is a bare ZID and there are no filters, short-circuit
  // to a direct fetch — label search doesn't match ZIDs.
  if (/^Z\d+$/.test(query) && !outputType && !inputTypes) {
    return performZidLookup(query);
  }

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

async function performZidLookup(zid) {
  searchStatusEl.textContent = "fetching\u2026";
  try {
    const result = await lookupByZid(zid);
    if (result.kind === "Z8") {
      renderSearchResults([{ zid, label: result.signature.label }]);
      searchStatusEl.textContent = "direct ZID match";
      // Signature cache is warm from lookupByZid, so decorate renders immediately.
      decorateResultsWithSignatures([{ zid }], new AbortController().signal);
    } else if (result.kind === "Z14") {
      const target = result.targetZid;
      const targetLink = target
        ? `<a href="https://www.wikifunctions.org/wiki/${escapeHtml(target)}" target="_blank" rel="noopener">${escapeHtml(target)}</a>`
        : "?";
      // Fetch the parent Z8 so we can show it as a pinnable result below
      // the info message — which is what the user almost certainly wanted.
      let parentSig = null;
      if (target) {
        try {
          const parent = await lookupByZid(target);
          if (parent.kind === "Z8") parentSig = parent.signature;
        } catch { /* fall through — show info-only */ }
      }
      searchResultsEl.innerHTML = `
        <div class="search-info">
          <strong>${escapeHtml(zid)}</strong> is an implementation (Z14) of function ${targetLink}.
          Pin the parent function below, or use <b>Import</b> to load this
          specific implementation into the workspace.
        </div>`;
      if (parentSig) {
        appendResultRow({ zid: target, label: parentSig.label });
        decorateResultsWithSignatures([{ zid: target }], new AbortController().signal);
      }
      searchStatusEl.textContent = parentSig ? "parent function available to pin" : "";
    } else {
      searchResultsEl.innerHTML = `
        <div class="search-info">
          <strong>${escapeHtml(zid)}</strong> is a
          <code>${escapeHtml(result.kind || "?")}</code>, not a function.
          Only Z8 functions can be pinned here.
        </div>`;
      searchStatusEl.textContent = "";
    }
  } catch (e) {
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
  searchResultsEl.innerHTML = results.map(renderResultRowHtml).join("");
}

function renderResultRowHtml(r) {
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
}

function appendResultRow(r) {
  searchResultsEl.insertAdjacentHTML("beforeend", renderResultRowHtml(r));
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
