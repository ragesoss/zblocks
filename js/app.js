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

registerAllBlocks();

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
          <span class="run-input-label">${escapeHtml(arg.label)} <code>${escapeHtml(arg.type)}</code></span>
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
