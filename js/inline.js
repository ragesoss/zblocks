// Inline a function call: replace a wf_Z### block with its own
// composition, substituting the call-site argument blocks in for
// Z18 references to the callee's shell.
//
// The result is semantically identical to the original call (function
// body applied to the same arguments), just rendered one level deeper.
// Users run this iteratively to unfold a composition as far as they
// want to see it.
//
// Limits (MVP): the target must be a wf_Z### function-call block whose
// Z8 has at least one composition-based Z14 implementation and every
// arg slot must be filled (shadow or real block).

import { lookupByZid, fetchFunctionSignature } from "./catalog.js";
import { exprToBlockSpec, collectFunctionZids } from "./importer.js";
import { FUNCTIONS } from "./functions.js";
import { registerFunctionBlock } from "./blocks.js";
import { msg } from "./i18n.js";

export class InlineError extends Error {}

// Main entry point. Awaits because it may need to fetch the callee's
// Z8, its implementation, and the signatures of any functions the
// composition references that we haven't seen before.
export async function inlineFunctionCall(block, workspace) {
  if (!block?.type?.startsWith("wf_Z")) {
    throw new InlineError(msg("inline.err.not_function_block"));
  }
  const fnZid = block.type.slice(3);

  const { kind, object, signature } = await lookupByZid(fnZid);
  if (kind !== "Z8" || !signature) {
    throw new InlineError(msg("inline.err.not_z8", { 1: fnZid }));
  }

  const impl = await findCompositionImpl(object);
  if (!impl) throw new InlineError(msg("inline.err.no_composition", { 1: fnZid }));

  // Gather call-site arg block specs keyed by the callee's arg keys.
  const argSpecs = {};
  for (const arg of signature.args) {
    const input = block.inputList.find(i => i.name === arg.key);
    const target = input?.connection?.targetBlock();
    if (!target) {
      throw new InlineError(msg("inline.err.empty_slot", { 1: arg.label, 2: arg.key }));
    }
    argSpecs[arg.key] = Blockly.serialization.blocks.save(target);
  }

  // Pre-register any function signatures the composition uses that
  // aren't in FUNCTIONS yet — mirrors importer.compositionToState.
  const referenced = new Set();
  collectFunctionZids(impl.composition, referenced);
  const missing = [...referenced].filter(z => !FUNCTIONS.some(f => f.zid === z));
  if (missing.length) {
    const settled = await Promise.allSettled(missing.map(z => fetchFunctionSignature(z)));
    const failed = [];
    settled.forEach((r, i) => {
      if (r.status === "fulfilled") registerFunctionBlock(r.value);
      else failed.push(missing[i]);
    });
    if (failed.length) {
      throw new InlineError(msg("inline.err.signatures_failed", { 1: failed.join(", ") }));
    }
  }

  // Walk the composition, substituting Z18 refs from argSpecs.
  const rootSpec = exprToBlockSpec(impl.composition, {
    argRef: (expr) => {
      const key = typeof expr.Z18K1 === "string" ? expr.Z18K1 : expr.Z18K1?.Z6K1;
      const sub = argSpecs[key];
      if (!sub) {
        // Z18 referring to something outside the callee's own shell —
        // shouldn't happen in a well-formed composition.
        return msg("inline.err.unexpected_argref", { 1: key || "?" });
      }
      return deepClone(sub);
    },
  });
  if (typeof rootSpec === "string") throw new InlineError(rootSpec);

  replaceBlockInWorkspace(workspace, block, rootSpec);
}

// Replace `oldBlock` with a new block built from `spec`. Preserves
// the old block's parent-input connection when it has one; otherwise
// places the new block at the old XY. Group the two operations so
// Blockly's undo stack treats the swap as a single step.
function replaceBlockInWorkspace(workspace, oldBlock, spec) {
  const parentConn = oldBlock.outputConnection?.targetConnection || null;
  const xy = oldBlock.getRelativeToSurfaceXY();

  Blockly.Events.setGroup(true);
  try {
    oldBlock.dispose(false);
    if (!parentConn) {
      spec.x = xy.x;
      spec.y = xy.y;
    }
    const newBlock = Blockly.serialization.blocks.append(spec, workspace);
    if (parentConn && newBlock?.outputConnection) {
      try {
        newBlock.outputConnection.connect(parentConn);
      } catch (e) {
        // Type mismatch shouldn't happen (the composition returns the
        // same output type as the call it replaces), but if Blockly
        // rejects the connection just leave the new block free-floating
        // near the old position so the user can hook it up manually.
        newBlock.moveBy(xy.x, xy.y);
        console.warn("Could not reattach inlined block to parent:", e);
      }
    }
  } finally {
    Blockly.Events.setGroup(false);
  }
}

// Walk Z8K4 for the first Z14 that carries a composition body (Z14K2).
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
    } catch { /* ignore */ }
  }
  return null;
}

function deepClone(spec) {
  return JSON.parse(JSON.stringify(spec));
}
