// Literal blocks — primitive values that don't have a ZID on Wikifunctions.
//
// Conventions:
//  - Block type = "wf_<name>". Emitter dispatches on this prefix.
//  - Every output check includes "Z1" so it fits wildcard slots.
//  - Z40 (boolean) stores "Z41" / "Z42" (the canonical ZIDs) in the
//    dropdown value.
//  - Z20838 (float64) is represented in the block as a plain number;
//    the emitter wraps it in a Z20915 "string to float64" call. IEEE-754
//    substructure is never emitted by hand.

export const LITERAL_COLOUR = 160;

export const LITERAL_BLOCKS = [
  {
    type: "wf_string",
    message0: "\u201C%1\u201D",
    args0: [{ type: "field_input", name: "VALUE", text: "" }],
    output: ["Z6", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "String literal (Z6)",
  },
  {
    type: "wf_integer",
    message0: "%1",
    args0: [{ type: "field_number", name: "VALUE", value: 0, precision: 1 }],
    output: ["Z16683", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "Integer literal (Z16683)",
  },
  {
    type: "wf_natural",
    message0: "%1",
    args0: [{ type: "field_number", name: "VALUE", value: 0, precision: 1, min: 0 }],
    output: ["Z13518", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "Natural number literal (Z13518)",
  },
  {
    type: "wf_float",
    message0: "%1",
    args0: [{ type: "field_number", name: "VALUE", value: 0 }],
    output: ["Z20838", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "Float64 literal (Z20838) — emits a full IEEE-754 decomposition",
  },
  {
    type: "wf_boolean",
    message0: "%1",
    args0: [{
      type: "field_dropdown", name: "VALUE",
      options: [["true", "Z41"], ["false", "Z42"]],
    }],
    output: ["Z40", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "Boolean (Z40): Z41 = true, Z42 = false",
  },
  {
    type: "wf_item_ref",
    message0: "item %1",
    args0: [{ type: "field_input", name: "VALUE", text: "Q" }],
    output: ["Z6091", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "Wikidata item reference (Z6091) — e.g. Q17087764",
  },
  {
    type: "wf_property_ref",
    message0: "property %1",
    args0: [{ type: "field_input", name: "VALUE", text: "P" }],
    output: ["Z6092", "Z1"],
    colour: LITERAL_COLOUR,
    tooltip: "Wikidata property reference (Z6092) — e.g. P361",
  },
];

export const LITERAL_TOOLBOX = {
  kind: "category",
  name: "Literals",
  colour: LITERAL_COLOUR,
  contents: LITERAL_BLOCKS.map(b => ({ kind: "block", type: b.type })),
};

// Shadow blocks: the default literal that pre-fills a slot when its
// expected type has an obvious literal form. Keyed by input type
// (the Z-ID that appears in an arg's declared type).
//
// When a function block is instantiated, each of its inputs with a
// type that appears in this map gets the corresponding shadow
// attached — so dragging the function block from the toolbox gives
// you editable defaults in every literal slot (Scratch-style).
export const SHADOW_FOR_TYPE = {
  "Z6":     { type: "wf_string",       fields: { VALUE: "" } },
  "Z16683": { type: "wf_integer",      fields: { VALUE: 0  } },
  "Z13518": { type: "wf_natural",      fields: { VALUE: 0  } },
  "Z20838": { type: "wf_float",        fields: { VALUE: 0  } },
  "Z40":    { type: "wf_boolean",      fields: { VALUE: "Z41" } },
  "Z6091":  { type: "wf_item_ref",     fields: { VALUE: "Q" } },
  "Z6092":  { type: "wf_property_ref", fields: { VALUE: "P" } },
};

