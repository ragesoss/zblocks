// Registry of known Wikifunctions functions.
//
// Phase 1 is hardcoded. To add a function:
//   { zid, label, category, args: [{key, label, type}], output }
// where key is the Wikifunctions arg key (e.g. "Z21032K1") and type is
// the ZID of the expected/produced type.
//
// Arg labels here are display-only; emission uses keys. Labels don't
// have to match Wikifunctions' labels exactly, but closer is friendlier.

export const CATEGORIES = [
  { name: "Pinned",           colour: 15  },  // user-added via search
  { name: "Music theory",     colour: 290 },
  { name: "Math (float64)",   colour: 210 },
  { name: "Math (integer)",   colour: 230 },
  { name: "Logic",            colour: 195 },
  { name: "String",           colour: 300 },
  { name: "List",             colour: 30  },
  { name: "Type conversion",  colour: 330 },
  { name: "Wikidata",         colour: 140 },
  { name: "Wikidata helpers", colour: 120 },
];

export const FUNCTIONS = [
  // ─── Math (float64) ─────────────────────────────────────────────
  { zid: "Z20849", label: "add (float64)", category: "Math (float64)",
    args: [
      { key: "Z20849K1", label: "a",       type: "Z20838" },
      { key: "Z20849K2", label: "b",       type: "Z20838" },
    ], output: "Z20838" },
  { zid: "Z21031", label: "subtract (float64)", category: "Math (float64)",
    args: [
      { key: "Z21031K1", label: "minuend",    type: "Z20838" },
      { key: "Z21031K2", label: "subtrahend", type: "Z20838" },
    ], output: "Z20838" },
  { zid: "Z21032", label: "multiply (float64)", category: "Math (float64)",
    args: [
      { key: "Z21032K1", label: "multiplier",   type: "Z20838" },
      { key: "Z21032K2", label: "multiplicand", type: "Z20838" },
    ], output: "Z20838" },
  { zid: "Z21033", label: "divide (float64)", category: "Math (float64)",
    args: [
      { key: "Z21033K1", label: "dividend", type: "Z20838" },
      { key: "Z21033K2", label: "divisor",  type: "Z20838" },
    ], output: "Z20838" },
  { zid: "Z21028", label: "exponentiation (float64)", category: "Math (float64)",
    args: [
      { key: "Z21028K1", label: "base",     type: "Z20838" },
      { key: "Z21028K2", label: "exponent", type: "Z20838" },
    ], output: "Z20838" },
  { zid: "Z20924", label: "equals (float64)", category: "Math (float64)",
    args: [
      { key: "Z20924K1", label: "a", type: "Z20838" },
      { key: "Z20924K2", label: "b", type: "Z20838" },
    ], output: "Z40" },

  // ─── Math (integer) ─────────────────────────────────────────────
  { zid: "Z16693", label: "add (integer)", category: "Math (integer)",
    args: [
      { key: "Z16693K1", label: "a", type: "Z16683" },
      { key: "Z16693K2", label: "b", type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z17111", label: "subtract (integer)", category: "Math (integer)",
    args: [
      { key: "Z17111K1", label: "minuend",    type: "Z16683" },
      { key: "Z17111K2", label: "subtrahend", type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z17120", label: "multiply (integer)", category: "Math (integer)",
    args: [
      { key: "Z17120K1", label: "a", type: "Z16683" },
      { key: "Z17120K2", label: "b", type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z16688", label: "equals (integer)", category: "Math (integer)",
    args: [
      { key: "Z16688K1", label: "a", type: "Z16683" },
      { key: "Z16688K2", label: "b", type: "Z16683" },
    ], output: "Z40" },

  // ─── Logic / conditional ────────────────────────────────────────
  { zid: "Z802", label: "if", category: "Logic",
    args: [
      { key: "Z802K1", label: "condition", type: "Z40" },
      { key: "Z802K2", label: "then",      type: "Z1"  },
      { key: "Z802K3", label: "else",      type: "Z1"  },
    ], output: "Z1" },
  { zid: "Z10174", label: "and", category: "Logic",
    args: [
      { key: "Z10174K1", label: "a", type: "Z40" },
      { key: "Z10174K2", label: "b", type: "Z40" },
    ], output: "Z40" },
  { zid: "Z10184", label: "or", category: "Logic",
    args: [
      { key: "Z10184K1", label: "a", type: "Z40" },
      { key: "Z10184K2", label: "b", type: "Z40" },
    ], output: "Z40" },
  { zid: "Z16676", label: "not", category: "Logic",
    args: [
      { key: "Z16676K1", label: "boolean", type: "Z40" },
    ], output: "Z40" },
  { zid: "Z866", label: "equals (generic)", category: "Logic",
    args: [
      { key: "Z866K1", label: "a", type: "Z1" },
      { key: "Z866K2", label: "b", type: "Z1" },
    ], output: "Z40" },

  // ─── String ─────────────────────────────────────────────────────
  { zid: "Z10000", label: "join strings", category: "String",
    args: [
      { key: "Z10000K1", label: "first",  type: "Z6" },
      { key: "Z10000K2", label: "second", type: "Z6" },
    ], output: "Z6" },
  { zid: "Z15175", label: "join strings (with separator)", category: "String",
    args: [
      { key: "Z15175K1", label: "first",     type: "Z6" },
      { key: "Z15175K2", label: "second",    type: "Z6" },
      { key: "Z15175K3", label: "separator", type: "Z6" },
    ], output: "Z6" },
  { zid: "Z11040", label: "length of string", category: "String",
    args: [
      { key: "Z11040K1", label: "string", type: "Z6" },
    ], output: "Z13518" },
  { zid: "Z10070", label: "substring", category: "String",
    args: [
      { key: "Z10070K1", label: "string", type: "Z6"     },
      { key: "Z10070K2", label: "start",  type: "Z13518" },
      { key: "Z10070K3", label: "end",    type: "Z13518" },
    ], output: "Z6" },
  { zid: "Z10008", label: "is empty string", category: "String",
    args: [
      { key: "Z10008K1", label: "string", type: "Z6" },
    ], output: "Z40" },

  // ─── List (parameterized; Phase 1 treats as flat Z881) ──────────
  { zid: "Z811", label: "head", category: "List",
    args: [
      { key: "Z811K1", label: "list", type: "Z881" },
    ], output: "Z1" },
  { zid: "Z812", label: "tail", category: "List",
    args: [
      { key: "Z812K1", label: "list", type: "Z881" },
    ], output: "Z881" },
  { zid: "Z813", label: "is empty list", category: "List",
    args: [
      { key: "Z813K1", label: "list", type: "Z881" },
    ], output: "Z40" },
  { zid: "Z12681", label: "length (list)", category: "List",
    args: [
      { key: "Z12681K1", label: "list", type: "Z881" },
    ], output: "Z13518" },

  // ─── Type conversion ────────────────────────────────────────────
  { zid: "Z20937", label: "integer to float64", category: "Type conversion",
    args: [
      { key: "Z20937K1", label: "integer", type: "Z16683" },
    ], output: "Z20838" },
  { zid: "Z21534", label: "truncate float64 to integer", category: "Type conversion",
    args: [
      { key: "Z21534K1", label: "float64", type: "Z20838" },
    ], output: "Z16683" },
  { zid: "Z25073", label: "integer to string", category: "Type conversion",
    args: [
      { key: "Z25073K1", label: "integer", type: "Z16683" },
    ], output: "Z6" },
  { zid: "Z17101", label: "integer from natural number", category: "Type conversion",
    args: [
      { key: "Z17101K1", label: "natural number", type: "Z13518" },
    ], output: "Z16683" },
  { zid: "Z20854", label: "rational as float64", category: "Type conversion",
    args: [
      { key: "Z20854K1", label: "rational", type: "Z19677" },
    ], output: "Z20838" },

  // Z20915 is available as a dedicated float-literal wrapper in the
  // emitter, but it's also useful as an explicit block for building
  // floats from computed strings.
  { zid: "Z20915", label: "string to float64", category: "Type conversion",
    args: [
      { key: "Z20915K1", label: "string", type: "Z6" },
    ], output: "Z20838" },

  // ─── Wikidata ───────────────────────────────────────────────────
  { zid: "Z6821", label: "fetch Wikidata item", category: "Wikidata",
    args: [
      { key: "Z6821K1", label: "reference", type: "Z6091" },
    ], output: "Z6001" },
  { zid: "Z6822", label: "fetch Wikidata property", category: "Wikidata",
    args: [
      { key: "Z6822K1", label: "reference", type: "Z6092" },
    ], output: "Z6002" },
  { zid: "Z22220", label: "claims from item", category: "Wikidata",
    args: [
      { key: "Z22220K1", label: "item", type: "Z6001" },
    ], output: "Z881" },
  { zid: "Z23459", label: "statement value (highest rank)", category: "Wikidata",
    args: [
      { key: "Z23459K1", label: "item",     type: "Z6001" },
      { key: "Z23459K2", label: "property", type: "Z6092" },
    ], output: "Z1" },
  { zid: "Z21449", label: "value of first property claim", category: "Wikidata",
    args: [
      { key: "Z21449K1", label: "item",     type: "Z6001" },
      { key: "Z21449K2", label: "property", type: "Z6092" },
    ], output: "Z1" },
  { zid: "Z27299", label: "item has claim?", category: "Wikidata",
    args: [
      { key: "Z27299K1", label: "item",     type: "Z6001" },
      { key: "Z27299K2", label: "property", type: "Z6092" },
    ], output: "Z40" },

  // ─── Wikidata helpers (user-created) ────────────────────────────
  { zid: "Z23753", label: "label of item reference in language", category: "Wikidata helpers",
    args: [
      { key: "Z23753K1", label: "QID",      type: "Z6091" },
      { key: "Z23753K2", label: "language", type: "Z60"   },
    ], output: "Z6" },
  { zid: "Z33573", label: "qualifier value of item property claim", category: "Wikidata helpers",
    args: [
      { key: "Z33573K1", label: "Wikidata item", type: "Z6001" },
      { key: "Z33573K2", label: "property",      type: "Z6092" },
      { key: "Z33573K3", label: "qualifier",     type: "Z6092" },
    ], output: "Z1" },
  { zid: "Z33579", label: "qualifier value of Wikidata statement", category: "Wikidata helpers",
    args: [
      { key: "Z33579K1", label: "Wikidata statement",  type: "Z6003" },
      { key: "Z33579K2", label: "qualifier predicate", type: "Z6092" },
    ], output: "Z1" },
  { zid: "Z33588", label: "first statement with qualifier", category: "Wikidata helpers",
    args: [
      { key: "Z33588K1", label: "item",      type: "Z6001" },
      { key: "Z33588K2", label: "property",  type: "Z6092" },
      { key: "Z33588K3", label: "qualifier", type: "Z6092" },
    ], output: "Z6003" },
  { zid: "Z33592", label: "integer from object", category: "Wikidata helpers",
    args: [
      { key: "Z33592K1", label: "object", type: "Z1" },
    ], output: "Z16683" },
  { zid: "Z33668", label: "word for concept", category: "Wikidata helpers",
    args: [
      { key: "Z33668K1", label: "concept",          type: "Z6091" },
      { key: "Z33668K2", label: "language",         type: "Z60"   },
      { key: "Z33668K3", label: "lexical category", type: "Z6091" },
    ], output: "Z6" },

  // ─── Music theory (user-created) ────────────────────────────────
  { zid: "Z25217", label: "frequency of pitch in A440 equal temperament", category: "Music theory",
    args: [
      { key: "Z25217K1", label: "pitch class", type: "Z6"     },
      { key: "Z25217K2", label: "octave",      type: "Z16683" },
    ], output: "Z20838" },
  { zid: "Z25218", label: "A4 frequency of pitch standard", category: "Music theory",
    args: [
      { key: "Z25218K1", label: "pitch standard", type: "Z6001" },
    ], output: "Z6010" },
  { zid: "Z25219", label: "difference between pitches in semitones", category: "Music theory",
    args: [
      { key: "Z25219K1", label: "first pitch class",   type: "Z6"     },
      { key: "Z25219K2", label: "first pitch octave",  type: "Z16683" },
      { key: "Z25219K3", label: "second pitch class",  type: "Z6"     },
      { key: "Z25219K4", label: "second pitch octave", type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z25220", label: "distance from C in semitones", category: "Music theory",
    args: [
      { key: "Z25220K1", label: "pitch", type: "Z6" },
    ], output: "Z16683" },
  { zid: "Z25224", label: "semitones between pitches within an octave", category: "Music theory",
    args: [
      { key: "Z25224K1", label: "first pitch",  type: "Z6" },
      { key: "Z25224K2", label: "second pitch", type: "Z6" },
    ], output: "Z16683" },
  { zid: "Z25227", label: "semitones between octaves", category: "Music theory",
    args: [
      { key: "Z25227K1", label: "first octave",  type: "Z16683" },
      { key: "Z25227K2", label: "second octave", type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z25230", label: "semitone distance from A4", category: "Music theory",
    args: [
      { key: "Z25230K1", label: "pitch class", type: "Z6"     },
      { key: "Z25230K2", label: "octave",      type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z25232", label: "frequency ratio of semitone distance in 12TET", category: "Music theory",
    args: [
      { key: "Z25232K1", label: "semitone distance", type: "Z16683" },
    ], output: "Z20838" },
  { zid: "Z25407", label: "transpose pitch", category: "Music theory",
    args: [
      { key: "Z25407K1", label: "pitch class", type: "Z6"     },
      { key: "Z25407K2", label: "semitones",   type: "Z16683" },
    ], output: "Z6" },
  { zid: "Z25408", label: "pitch by distance from C in semitones", category: "Music theory",
    args: [
      { key: "Z25408K1", label: "semitone distance", type: "Z16683" },
    ], output: "Z6" },
  { zid: "Z33288", label: "Wikidata pitch item for MIDI note number", category: "Music theory",
    args: [
      { key: "Z33288K1", label: "MIDI note number", type: "Z16683" },
    ], output: "Z6001" },
  { zid: "Z33570", label: "reference note of pitch standard", category: "Music theory",
    args: [
      { key: "Z33570K1", label: "pitch standard", type: "Z6001" },
    ], output: "Z6091" },
  { zid: "Z33590", label: "MIDI number of pitch item", category: "Music theory",
    args: [
      { key: "Z33590K1", label: "note", type: "Z6001" },
    ], output: "Z16683" },
  { zid: "Z33600", label: "MIDI number of pitch", category: "Music theory",
    args: [
      { key: "Z33600K1", label: "pitch class", type: "Z6"     },
      { key: "Z33600K2", label: "octave",      type: "Z16683" },
    ], output: "Z16683" },
  { zid: "Z33603", label: "reference frequency of pitch standard", category: "Music theory",
    args: [
      { key: "Z33603K1", label: "pitch standard", type: "Z6001" },
    ], output: "Z20838" },
  { zid: "Z33605", label: "frequency of pitch in 12-TET standard", category: "Music theory",
    args: [
      { key: "Z33605K1", label: "pitch class",    type: "Z6"     },
      { key: "Z33605K2", label: "octave",         type: "Z16683" },
      { key: "Z33605K3", label: "pitch standard", type: "Z6001"  },
    ], output: "Z20838" },
  { zid: "Z33606", label: "MIDI number of reference note", category: "Music theory",
    args: [
      { key: "Z33606K1", label: "pitch standard", type: "Z6001" },
    ], output: "Z16683" },
  { zid: "Z33682", label: "frequency of MIDI note number", category: "Music theory",
    args: [
      { key: "Z33682K1", label: "midi note number", type: "Z16683" },
      { key: "Z33682K2", label: "pitch standard",   type: "Z6001"  },
    ], output: "Z20838" },
];

export function functionByZid(zid) {
  return FUNCTIONS.find(f => f.zid === zid);
}
