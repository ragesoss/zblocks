// Context-aware empty-slot picker. Given a target connection on a
// block, enumerate every registered block (function, literal, or
// arg-ref) whose output check overlaps with the slot's input check
// and let the user pick one. On pick, instantiate the new block and
// connect it to the slot.
//
// The connection-overlap rule follows Blockly's own:
//   two checks match if they share at least one string, OR either
//   is null. "Z1" is in every block's output check in our setup, so
//   Z1-typed slots accept anything by construction.

import { FUNCTIONS, CATEGORIES } from "./functions.js";
import { LITERAL_BLOCKS } from "./literals.js";
import { SHELL, ARG_REF_META } from "./shell.js";
import { typeLabel } from "./type_labels.js";

// ─── Candidate enumeration ─────────────────────────────────────────
// One entry per registered block type, with its output check so the
// filter can do a simple set-overlap.
export function enumerateCandidates() {
  const entries = [];

  for (const fn of FUNCTIONS) {
    entries.push({
      type: `wf_${fn.zid}`,
      label: fn.label,
      zid: fn.zid,
      category: fn.category,
      outputCheck: fn.output === "Z1" ? ["Z1"] : [fn.output, "Z1"],
      outputType: fn.output,
    });
  }

  for (const lit of LITERAL_BLOCKS) {
    entries.push({
      type: lit.type,
      label: lit.tooltip?.split(/ [\u2014\-]/)[0] || lit.type,
      zid: null,
      category: "Literals",
      outputCheck: lit.output,
      outputType: lit.output?.[0] || "?",
    });
  }

  SHELL.args.forEach((arg, i) => {
    const blockType = `wf_arg_${i}`;
    if (!ARG_REF_META[blockType]) return;
    entries.push({
      type: blockType,
      label: `\u27E8 ${arg.label} \u27E9`,
      zid: null,
      category: "Function arguments",
      outputCheck: arg.type === "Z1" ? ["Z1"] : [arg.type, "Z1"],
      outputType: arg.type,
    });
  });

  return entries;
}

export function filterCandidates(slotCheck, entries = enumerateCandidates()) {
  if (!slotCheck) return entries;   // null check = accept anything
  const slotSet = new Set(slotCheck);
  return entries.filter(e => {
    if (!e.outputCheck) return true;  // null output = matches anything
    return e.outputCheck.some(c => slotSet.has(c));
  });
}

// ─── Modal + instantiation ─────────────────────────────────────────
let modalState = null;   // { connection, slotLabel, slotType }

export function openSlotPicker({ connection, slotLabel, slotType }) {
  modalState = { connection, slotLabel, slotType };
  const dialog = document.getElementById("slot-picker-modal");
  const heading = document.getElementById("slot-picker-heading");
  const hint    = document.getElementById("slot-picker-hint");
  const inputEl = document.getElementById("slot-picker-input");
  const resultsEl = document.getElementById("slot-picker-results");

  heading.textContent = `Fill "${slotLabel}"`;
  hint.innerHTML = `Slot expects <code>${escapeHtml(typeLabel(slotType, { withZid: true }))}</code>.
    Compatible blocks below — any output-type match, or the universal <code>Z1</code>.`;
  inputEl.value = "";
  resultsEl.innerHTML = "";

  const candidates = filterCandidates(connection.getCheck());
  renderCandidates(candidates);
  dialog.showModal();
  inputEl.focus();
}

export function closeSlotPicker() {
  document.getElementById("slot-picker-modal").close();
  modalState = null;
}

function renderCandidates(candidates, filterText = "") {
  const resultsEl = document.getElementById("slot-picker-results");
  const q = filterText.toLowerCase();
  const filtered = q
    ? candidates.filter(c => c.label.toLowerCase().includes(q) || (c.zid ?? "").toLowerCase().includes(q))
    : candidates;

  if (filtered.length === 0) {
    resultsEl.innerHTML = `<div class="slot-picker-empty">No compatible blocks${filterText ? " match that query" : ""}.</div>`;
    return;
  }

  // Group by category; preserve CATEGORIES order then Literals / Function arguments.
  const catOrder = [...CATEGORIES.map(c => c.name), "Literals", "Function arguments"];
  const groups = new Map();
  for (const c of filtered) {
    if (!groups.has(c.category)) groups.set(c.category, []);
    groups.get(c.category).push(c);
  }
  const html = catOrder
    .filter(cat => groups.has(cat))
    .map(cat => {
      const items = groups.get(cat).map(c => `
        <button class="slot-picker-item" data-block-type="${escapeHtml(c.type)}"
                title="${escapeHtml(c.zid || c.type)} \u2014 ${escapeHtml(typeLabel(c.outputType, { withZid: true }))}">
          <span class="slot-picker-item-label">${escapeHtml(c.label)}</span>
          <span class="slot-picker-item-meta">${escapeHtml(typeLabel(c.outputType))}</span>
        </button>
      `).join("");
      return `<div class="slot-picker-group"><h3>${escapeHtml(cat)}</h3>${items}</div>`;
    }).join("");
  resultsEl.innerHTML = html;
}

// ─── Instantiation ─────────────────────────────────────────────────
function instantiateAndConnect(blockType) {
  if (!modalState) return;
  const { connection } = modalState;
  const workspace = connection.getSourceBlock().workspace;
  try {
    const newBlock = Blockly.serialization.blocks.append(
      { type: blockType },
      workspace
    );
    if (!newBlock.outputConnection) {
      throw new Error(`${blockType} has no output connection (not a value block).`);
    }
    connection.connect(newBlock.outputConnection);
  } catch (e) {
    alert(`Could not place ${blockType}: ${e.message}`);
    return;
  }
  closeSlotPicker();
}

// ─── Wire the modal DOM once at startup ────────────────────────────
export function initSlotPicker() {
  document.getElementById("slot-picker-close").addEventListener("click", closeSlotPicker);
  document.getElementById("slot-picker-input").addEventListener("input", (e) => {
    const candidates = modalState
      ? filterCandidates(modalState.connection.getCheck())
      : [];
    renderCandidates(candidates, e.target.value);
  });
  document.getElementById("slot-picker-results").addEventListener("click", (e) => {
    const btn = e.target.closest(".slot-picker-item");
    if (!btn) return;
    instantiateAndConnect(btn.dataset.blockType);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
