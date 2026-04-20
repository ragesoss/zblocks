// "Peek inside" popover — read-only composition explorer.
//
// Triggered from the right-click menu on wf_Z* (function-call) and
// wf_zid_ref (bare Z9) blocks. Fetches the target function's Z8 +
// first composition-based Z14 and renders the composition as an
// indented tree. Function-call nodes and bare ZID refs inside the
// tree carry their own ▸ toggle so the user can drill into those
// functions' definitions without losing the outer context.
//
// Exploration only: nothing is added to the workspace and the emitter
// is untouched. Dismiss with Escape, the × button, or a click outside.

import { lookupByZid } from "./catalog.js";
import { typeLabel } from "./type_labels.js";
import { decodeInteger, decodeNatural, decodeFloat64 } from "./numeric.js";
import { msg } from "./i18n.js";

let popoverEl = null;
let bodyEl = null;
let openedAt = 0;

export function initPeek() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popoverEl && !popoverEl.hidden) closePeek();
  });
  // Outside-click dismiss. Delayed on open so the triggering click from
  // the Blockly context menu doesn't immediately close the popover.
  document.addEventListener("mousedown", (e) => {
    if (!popoverEl || popoverEl.hidden) return;
    if (Date.now() - openedAt < 200) return;
    if (popoverEl.contains(e.target)) return;
    closePeek();
  }, true);
}

function ensurePopover() {
  if (popoverEl) return;
  popoverEl = document.createElement("div");
  popoverEl.id = "peek-popover";
  popoverEl.hidden = true;
  popoverEl.innerHTML = `
    <button class="peek-close" type="button" title="Close" aria-label="Close">&times;</button>
    <div class="peek-body"></div>
  `;
  popoverEl.querySelector(".peek-close").addEventListener("click", closePeek);
  document.body.appendChild(popoverEl);
  bodyEl = popoverEl.querySelector(".peek-body");
}

export function closePeek() {
  if (!popoverEl) return;
  popoverEl.hidden = true;
  if (bodyEl) bodyEl.innerHTML = "";
}

// Entry point. anchorRect is a DOMRect (or null) used to place the
// popover near the clicked block.
export async function openPeek({ zid, anchorRect }) {
  ensurePopover();
  openedAt = Date.now();
  bodyEl.innerHTML = `<div class="peek-loading">${escapeHtml(msg("peek.loading", { 1: zid }))}</div>`;
  positionPopover(anchorRect);
  popoverEl.hidden = false;

  try {
    const card = await buildFunctionCard(zid);
    bodyEl.innerHTML = "";
    bodyEl.appendChild(card);
  } catch (e) {
    bodyEl.innerHTML = `<div class="peek-error">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function positionPopover(rect) {
  const VW = window.innerWidth, VH = window.innerHeight;
  const MAX_W = Math.min(560, VW - 40);
  const MAX_H = Math.min(VH - 80, 720);
  popoverEl.style.maxWidth = `${MAX_W}px`;
  popoverEl.style.maxHeight = `${MAX_H}px`;

  let left, top;
  if (rect) {
    if (rect.right + MAX_W + 20 <= VW) left = rect.right + 12;
    else if (rect.left - MAX_W - 12 >= 0) left = rect.left - MAX_W - 12;
    else left = Math.max(10, Math.min(VW - MAX_W - 10, rect.left));
    top = Math.max(10, Math.min(VH - MAX_H - 10, rect.top));
  } else {
    left = (VW - MAX_W) / 2;
    top = 80;
  }
  popoverEl.style.left = `${left}px`;
  popoverEl.style.top = `${top}px`;
}

// ─── Card builder ──────────────────────────────────────────────────
// Fetches the function's Z8 + first composition impl and renders the
// composition tree. Reused recursively when the user drills into a
// nested function call.
async function buildFunctionCard(zid) {
  const { kind, object, signature } = await lookupByZid(zid);
  if (kind !== "Z8") {
    const hint = kind === "Z14"
      ? msg("peek.is_z14")
      : msg("peek.not_function", { 1: kind || "?" });
    return noteCard(zid, null, hint);
  }
  const sig = signature;
  const compositionInfo = await findCompositionImpl(object);
  const card = document.createElement("div");
  card.className = "peek-card";
  card.appendChild(buildHeader(zid, sig));

  if (!compositionInfo) {
    const note = document.createElement("div");
    note.className = "peek-note";
    note.textContent = msg("peek.no_composition");
    card.appendChild(note);
    return card;
  }

  const body = document.createElement("div");
  body.className = "peek-comp-body";
  const implRow = document.createElement("div");
  implRow.className = "peek-impl-row";
  const implLink =
    `<a href="https://www.wikifunctions.org/wiki/${encodeURIComponent(compositionInfo.implZid)}" ` +
    `target="_blank" rel="noopener">${escapeHtml(compositionInfo.implZid)}</a>`;
  implRow.innerHTML = msg("peek.impl_label", { 1: implLink });
  body.appendChild(implRow);
  body.appendChild(renderExpr(compositionInfo.composition, sig));
  card.appendChild(body);
  return card;
}

function buildHeader(zid, sig) {
  const header = document.createElement("div");
  header.className = "peek-header";
  const wfLink = `https://www.wikifunctions.org/wiki/${encodeURIComponent(zid)}`;
  const label = sig?.label ? escapeHtml(sig.label) : "";
  header.innerHTML = `
    <div class="peek-title">
      <span class="peek-label">${label}</span>
      <a class="peek-zid" href="${wfLink}" target="_blank" rel="noopener">${escapeHtml(zid)}</a>
    </div>
    ${sig ? `<div class="peek-sig">${escapeHtml(formatSignature(sig))}</div>` : ""}
  `;
  return header;
}

function noteCard(zid, sig, text) {
  const div = document.createElement("div");
  div.className = "peek-card";
  div.appendChild(buildHeader(zid, sig));
  const note = document.createElement("div");
  note.className = "peek-note";
  note.textContent = text;
  div.appendChild(note);
  return div;
}

function formatSignature(sig) {
  const ins = sig.args.map(a => `${a.label}: ${typeLabel(a.type)}`).join(", ");
  return `(${ins}) → ${typeLabel(sig.output)}`;
}

// Scan Z8K4 for the first Z14 that has a composition body (Z14K2).
async function findCompositionImpl(z8) {
  const impls = z8?.Z8K4 || [];
  const implZids = [];
  for (let i = 1; i < impls.length; i++) {
    const r = impls[i];
    const z = typeof r === "string" ? r : r?.Z6K1;
    if (z) implZids.push(z);
  }
  for (const implZid of implZids) {
    try {
      const { kind, object } = await lookupByZid(implZid);
      if (kind !== "Z14") continue;
      if (object?.Z14K2) return { implZid, composition: object.Z14K2 };
    } catch { /* ignore broken refs */ }
  }
  return null;
}

// ─── Expression renderer ───────────────────────────────────────────
// `shell` is the signature of the function whose composition contains
// `expr` — used to resolve Z18 arg refs back to their human label.
function renderExpr(expr, shell) {
  if (expr == null) return textNode("—", "peek-null");
  if (typeof expr === "string") return renderBareString(expr);
  if (Array.isArray(expr)) return renderList(expr, shell);
  if (typeof expr !== "object") return textNode(String(expr));

  const t = expr.Z1K1;
  const zidType = typeof t === "string" ? t : t?.Z7K1;
  // Parameterized-type literal (e.g. {Z1K1:{Z1K1:Z7,Z7K1:Z881,Z881K1:Z8}, K1:...}):
  // treated as a value of that type, not a function call.
  const isParameterizedTypeLit = typeof t === "object" && t?.Z7K1 && t.Z7K1 !== "Z7";
  if (zidType === "Z7" && !isParameterizedTypeLit) return renderFunctionCall(expr, shell);
  if (zidType === "Z18") return renderArgRef(expr, shell);
  if (zidType === "Z6")  return renderLiteral(`"${expr.Z6K1 ?? ""}"`, "Z6");
  if (zidType === "Z9") {
    const v = typeof expr.Z9K1 === "string" ? expr.Z9K1 : "";
    return renderBareString(v);
  }
  if (zidType === "Z40") {
    const v = typeof expr.Z40K1 === "string" ? expr.Z40K1 : expr.Z40K1?.Z9K1;
    return renderLiteral(v === "Z42" ? "false" : "true", "Z40");
  }
  if (zidType === "Z6091") return renderLiteral(`item ${expr.Z6091K1 ?? ""}`, "Z6091");
  if (zidType === "Z6092") return renderLiteral(`property ${expr.Z6092K1 ?? ""}`, "Z6092");
  if (zidType === "Z13518") {
    try { return renderLiteral(String(decodeNatural(expr)), "Z13518"); }
    catch { return renderLiteral("?", "Z13518"); }
  }
  if (zidType === "Z16683") {
    try { return renderLiteral(String(decodeInteger(expr)), "Z16683"); }
    catch { return renderLiteral("?", "Z16683"); }
  }
  if (zidType === "Z20838") {
    try { return renderLiteral(String(decodeFloat64(expr)), "Z20838"); }
    catch { return renderLiteral("?", "Z20838"); }
  }
  // Parameterized-type literal or unknown: recurse over its keys as a
  // record, skipping Z1K1. Lets typed lists / pairs surface their
  // contents without hard-coding every compound type.
  if (isParameterizedTypeLit || typeof t === "object") {
    return renderCompound(expr, shell, t?.Z7K1);
  }
  return renderLiteral(JSON.stringify(expr).slice(0, 80), zidType || "?");
}

function textNode(text, cls = "") {
  const s = document.createElement("span");
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

function renderLiteral(text, typeZid) {
  const s = document.createElement("span");
  s.className = "peek-lit";
  s.title = typeLabel(typeZid, { withZid: true });
  s.textContent = text;
  return s;
}

function renderBareString(s) {
  if (/^Z\d+$/.test(s)) {
    const wrap = document.createElement("span");
    wrap.className = "peek-zidref";
    const link = document.createElement("a");
    link.href = `https://www.wikifunctions.org/wiki/${encodeURIComponent(s)}`;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `→ ${s}`;
    wrap.appendChild(link);
    wrap.appendChild(drillButton(s));
    return wrap;
  }
  return renderLiteral(`"${s}"`, "Z6");
}

function renderArgRef(expr, shell) {
  const key = typeof expr.Z18K1 === "string" ? expr.Z18K1 : expr.Z18K1?.Z6K1;
  let label = key || "?";
  if (shell?.args) {
    const match = shell.args.find(a => a.key === key);
    if (match) label = match.label;
  }
  const s = document.createElement("span");
  s.className = "peek-argref";
  s.textContent = `\u27E8${label}\u27E9`;
  s.title = key || "";
  return s;
}

function renderList(arr, shell) {
  // Canonical typed list: [typeDecl, item1, item2, ...].
  if (arr.length <= 1) {
    return textNode(msg("peek.empty_list"), "peek-list peek-list-empty");
  }
  const wrap = document.createElement("div");
  wrap.className = "peek-list";
  for (let i = 1; i < arr.length; i++) {
    const item = document.createElement("div");
    item.className = "peek-list-item";
    item.appendChild(renderExpr(arr[i], shell));
    wrap.appendChild(item);
  }
  return wrap;
}

// Render a compound (parameterized-type literal / unknown typed record)
// as key: value rows. Mirrors the function-call layout but without a
// drillable target.
function renderCompound(expr, shell, typeZid) {
  const wrap = document.createElement("div");
  wrap.className = "peek-compound";
  const hdr = document.createElement("div");
  hdr.className = "peek-compound-header";
  hdr.textContent = typeLabel(typeZid, { withZid: true });
  wrap.appendChild(hdr);
  const rows = document.createElement("div");
  rows.className = "peek-compound-rows";
  for (const key of Object.keys(expr)) {
    if (key === "Z1K1") continue;
    const row = document.createElement("div");
    row.className = "peek-compound-row";
    const lbl = document.createElement("span");
    lbl.className = "peek-arg-label";
    lbl.textContent = `${key}:`;
    const val = document.createElement("div");
    val.className = "peek-arg-value";
    val.appendChild(renderExpr(expr[key], shell));
    row.appendChild(lbl);
    row.appendChild(val);
    rows.appendChild(row);
  }
  wrap.appendChild(rows);
  return wrap;
}

// Z7 call: header row (label · ZID → output + drill ▸) plus one arg
// row per bound key. Callee label and arg labels hydrate async; the
// drill button fetches and appends a nested card.
function renderFunctionCall(expr, shell) {
  const target = typeof expr.Z7K1 === "string" ? expr.Z7K1 : expr.Z7K1?.Z6K1;

  const wrap = document.createElement("div");
  wrap.className = "peek-call";

  const header = document.createElement("div");
  header.className = "peek-call-header";
  const titleSlot = document.createElement("span");
  titleSlot.className = "peek-call-title";
  titleSlot.textContent = target || "(unknown)";
  header.appendChild(titleSlot);
  header.appendChild(drillButton(target));
  wrap.appendChild(header);

  const argsWrap = document.createElement("div");
  argsWrap.className = "peek-call-args";
  const argRows = [];
  for (const key of Object.keys(expr)) {
    if (key === "Z1K1" || key === "Z7K1") continue;
    const row = document.createElement("div");
    row.className = "peek-call-arg";
    const lbl = document.createElement("span");
    lbl.className = "peek-arg-label";
    lbl.textContent = `${key}:`;
    lbl.dataset.argKey = key;
    const val = document.createElement("div");
    val.className = "peek-arg-value";
    val.appendChild(renderExpr(expr[key], shell));
    row.appendChild(lbl);
    row.appendChild(val);
    argsWrap.appendChild(row);
    argRows.push({ key, lbl });
  }
  wrap.appendChild(argsWrap);

  if (target && /^Z\d+$/.test(target)) {
    hydrateCallHeader(target, titleSlot, argRows).catch(() => { /* silent */ });
  }
  return wrap;
}

async function hydrateCallHeader(zid, titleSlot, argRows) {
  try {
    const { kind, signature } = await lookupByZid(zid);
    if (kind !== "Z8" || !signature) return;
    titleSlot.innerHTML = "";
    const label = document.createElement("span");
    label.className = "peek-label";
    label.textContent = signature.label;
    const zidLink = document.createElement("a");
    zidLink.href = `https://www.wikifunctions.org/wiki/${encodeURIComponent(zid)}`;
    zidLink.target = "_blank";
    zidLink.rel = "noopener";
    zidLink.className = "peek-zid";
    zidLink.textContent = zid;
    const arrow = document.createElement("span");
    arrow.className = "peek-arrow";
    arrow.textContent = `→ ${typeLabel(signature.output)}`;
    titleSlot.appendChild(label);
    titleSlot.appendChild(zidLink);
    titleSlot.appendChild(arrow);
    for (const { key, lbl } of argRows) {
      const argEntry = signature.args.find(a => a.key === key);
      if (argEntry) lbl.textContent = `${argEntry.label} (${typeLabel(argEntry.type)}):`;
    }
  } catch { /* leave defaults on failure */ }
}

// Drill ▸ button: fetches the target Z8's first composition impl and
// appends it as a nested card below the call row. Click again to
// collapse. Recurses indefinitely via buildFunctionCard.
function drillButton(zid) {
  const btn = document.createElement("button");
  btn.className = "peek-drill";
  btn.type = "button";
  btn.textContent = "\u25B8";
  btn.title = msg("peek.drill_title");
  if (!zid || !/^Z\d+$/.test(zid)) {
    btn.disabled = true;
    return btn;
  }
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const host = btn.closest(".peek-call") || btn.closest(".peek-zidref");
    if (!host) return;
    const existing = host.querySelector(":scope > .peek-drill-card");
    if (existing) {
      existing.remove();
      btn.textContent = "\u25B8";
      btn.classList.remove("expanded");
      return;
    }
    btn.textContent = "\u25BE";
    btn.classList.add("expanded");
    const slot = document.createElement("div");
    slot.className = "peek-drill-card";
    slot.innerHTML = `<div class="peek-loading">${escapeHtml(msg("peek.loading", { 1: zid }))}</div>`;
    host.appendChild(slot);
    try {
      const card = await buildFunctionCard(zid);
      slot.innerHTML = "";
      slot.appendChild(card);
    } catch (err) {
      slot.innerHTML = `<div class="peek-error">${escapeHtml(err.message || String(err))}</div>`;
    }
  });
  return btn;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
