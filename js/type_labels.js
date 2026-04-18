// Human-readable labels for common Wikifunctions type ZIDs.
// Used in block tooltips, search-result signatures, run-modal input
// hints, and the shell declaration form.
//
// Curated from YoshiRulz's prepopulated_label_cache.json in
// WikiLambdaBlockly (Apache-2.0). Shortened where his prefix
// conventions ("/Type", "-- enum member") don't match ours.
//
// Missing ZIDs fall through to the raw ZID — safe default and a
// visible signal that we don't know what it is. A lazy-fetch pass
// (right-click a ZID, pull its label from wikilambda_fetch) is
// planned but not in this cut.

export const TYPE_LABELS = {
  // Core primitives
  Z1:     "Any",
  Z4:     "Type",
  Z6:     "String",
  Z7:     "Function call",
  Z8:     "Function",
  Z9:     "Reference",
  Z11:    "Monolingual text",
  Z12:    "Multilingual text",
  Z14:    "Implementation",
  Z17:    "Argument declaration",
  Z18:    "Argument reference",
  Z21:    "Unit",
  Z22:    "Result envelope",
  Z24:    "Void",
  Z40:    "Boolean",
  Z41:    "true",
  Z42:    "false",
  Z60:    "Language",

  // Numeric
  Z13518: "Natural number",
  Z16659: "Sign",
  Z16660: "positive",
  Z16661: "zero",
  Z16662: "negative",
  Z16683: "Integer",
  Z19677: "Rational",
  Z20825: "Float kind",
  Z20838: "Float64",

  // Collections
  Z881: "List",
  Z882: "Pair",

  // Wikidata entities
  Z6001: "Wikidata Item",
  Z6002: "Wikidata Property",
  Z6003: "Wikidata Statement",
  Z6004: "Wikidata Lexeme Form",
  Z6005: "Wikidata Lexeme",
  Z6006: "Wikidata Lexeme Sense",
  Z6007: "Wikidata Snak",
  Z6008: "Wikidata Reference",
  Z6010: "Wikidata Quantity",
  Z6011: "Wikidata Coordinate",
  Z6020: "Snak kind",
  Z6061: "Wikidata Datetime",

  // Wikidata refs
  Z6091: "Item reference",
  Z6092: "Property reference",
  Z6094: "Lexeme Form reference",
  Z6095: "Lexeme reference",
  Z6096: "Lexeme Sense reference",

  // Error types (glossed separately in runner.js; labels here for
  // consistency in tooltips)
  Z5:   "Error",
  Z503: "No-implementation error",
  Z507: "Evaluation error",
  Z511: "Key-not-found error",
  Z516: "Argument-value error",
};

// Return a display label for a ZID: "Float64" for Z20838,
// "Float64 (Z20838)" if `withZid` is true, raw ZID if unknown.
export function typeLabel(zid, { withZid = false } = {}) {
  if (!zid) return "?";
  const label = TYPE_LABELS[zid];
  if (!label) return zid;
  return withZid ? `${label} (${zid})` : label;
}

// "(String, Integer) → Float64" given a sig with ZID args.
export function signatureLabel(sig) {
  if (!sig) return "";
  const inputs = sig.args.map(a => typeLabel(a.type)).join(", ");
  return `(${inputs}) → ${typeLabel(sig.output)}`;
}
