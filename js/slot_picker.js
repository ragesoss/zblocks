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
import { openWikidataSearch } from "./wikidata_search.js";
import { msg } from "./i18n.js";

// Slot types where a Wikidata search makes sense. Each entry maps the
// picked {Q|P}-number to the block structure the slot should receive.
// The Z6001 / Z6002 entries build the full fetch chain (Z6821/Z6822
// wrapping a ref literal) so the slot gets a complete fetched entity.
const WIKIDATA_SLOT_HANDLERS = {
  Z6091: {
    entityType: "item",
    build: (id) => ({ type: "wf_item_ref", fields: { VALUE: id } }),
  },
  Z6001: {
    entityType: "item",
    build: (id) => ({
      type: "wf_Z6821",
      inputs: { Z6821K1: { block: { type: "wf_item_ref", fields: { VALUE: id } } } },
    }),
  },
  Z6092: {
    entityType: "property",
    build: (id) => ({ type: "wf_property_ref", fields: { VALUE: id } }),
  },
  Z6002: {
    entityType: "property",
    build: (id) => ({
      type: "wf_Z6822",
      inputs: { Z6822K1: { block: { type: "wf_property_ref", fields: { VALUE: id } } } },
    }),
  },
};

function wikidataHandlerForSlot(slotCheck) {
  if (!slotCheck) return null;
  for (const t of slotCheck) {
    if (WIKIDATA_SLOT_HANDLERS[t]) return { ...WIKIDATA_SLOT_HANDLERS[t], slotType: t };
  }
  return null;
}

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

  heading.textContent = msg("slot_picker.title", { 1: slotLabel });
  hint.innerHTML = msg("slot_picker.hint", { 1: escapeHtml(typeLabel(slotType, { withZid: true })) });
  inputEl.value = "";
  resultsEl.innerHTML = "";

  const candidates = filterCandidates(connection.getCheck());
  renderCandidates(candidates);
  dialog.showModal();
  inputEl.focus();
}

// Build the "Search Wikidata…" row that appears at the top of the slot
// picker when the slot accepts a Wikidata item/property type. Returns
// HTML or "" when no handler applies.
function wikidataSearchRowHtml(handler) {
  if (!handler) return "";
  const noun = handler.entityType === "property" ? "property" : "item";
  return `
    <div class="slot-picker-group slot-picker-wikidata">
      <h3>Lookup</h3>
      <button class="slot-picker-item slot-picker-wikidata-btn" data-wikidata="1"
              title="Search wikidata.org for a ${noun} and fill this slot with the result">
        <span class="slot-picker-item-label">\uD83D\uDD0D Search Wikidata \u2014 find a ${noun} by label\u2026</span>
        <span class="slot-picker-item-meta">wikidata.org</span>
      </button>
    </div>
  `;
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

  // Wikidata search affordance appears whenever the slot type accepts
  // a Q/P reference, even when the user is typing a filter — the
  // filter only narrows block candidates, not this lookup action.
  const wdHandler = modalState
    ? wikidataHandlerForSlot(modalState.connection.getCheck())
    : null;
  const wikidataRow = wikidataSearchRowHtml(wdHandler);

  if (filtered.length === 0) {
    resultsEl.innerHTML = wikidataRow +
      `<div class="slot-picker-empty">${escapeHtml(msg(filterText ? "slot_picker.empty_filtered" : "slot_picker.empty"))}</div>`;
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
  resultsEl.innerHTML = wikidataRow + html;
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

// Instantiate a block spec in the given workspace and connect its
// output to `connection`. Used by the Wikidata-search flow since the
// slot picker modal is closed by the time the pick happens — we can't
// rely on slot-picker module state.
function instantiateIntoConnection(connection, spec) {
  const workspace = connection.getSourceBlock().workspace;
  try {
    const newBlock = Blockly.serialization.blocks.append(spec, workspace);
    if (!newBlock.outputConnection) {
      throw new Error(`${spec.type} has no output connection.`);
    }
    connection.connect(newBlock.outputConnection);
  } catch (e) {
    alert(`Could not place ${spec.type}: ${e.message}`);
  }
}

function startWikidataSearch() {
  if (!modalState) return;
  const handler = wikidataHandlerForSlot(modalState.connection.getCheck());
  if (!handler) return;
  // Capture the target connection in closure so the onSelect callback
  // isn't coupled to slot-picker module state — the slot picker modal
  // is closed below (browsers don't love two <dialog>s modal at once)
  // and the user might even reopen the slot picker for a different
  // slot before finishing the Wikidata search.
  const targetConnection = modalState.connection;
  closeSlotPicker();
  openWikidataSearch({
    entityType: handler.entityType,
    onSelect: ({ id }) => {
      instantiateIntoConnection(targetConnection, handler.build(id));
    },
  });
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
    if (btn.dataset.wikidata) {
      startWikidataSearch();
      return;
    }
    instantiateAndConnect(btn.dataset.blockType);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
