// Worked examples that pre-populate a full shell + composition.
// Useful for new users who want to see what a finished composition
// looks like before building their own.
//
// Each example is a function (workspace) => void that:
//  1. Calls setShell() to register arg refs for the target function
//  2. Clears the workspace
//  3. Loads a pre-built workspace state matching an existing
//     `.comp.json` spec from ../../wikifunctioneering/zobjects/

import { setShell } from "./shell.js";

export const EXAMPLES = [
  {
    id: "frequency-of-midi-note",
    label: "frequency of MIDI note (Z33682)",
    summary: "ref_freq × 2^((midi − ref_midi) / 12) — mirrors zobjects/frequency_of_midi_note.comp.json",
    load(workspace) {
      // Clear before setShell — unregisterArgRefBlocks leaves any
      // lingering arg-ref instances on the workspace without a type
      // definition.
      workspace.clear();
      setShell({
        zid: "Z33682",
        outputType: "Z20838",
        args: [
          { label: "midi note number", type: "Z16683" },
          { label: "pitch standard",   type: "Z6001"  },
        ],
      });
      const state = {
        blocks: {
          blocks: [
            {
              type: "wf_Z21032",
              x: 40, y: 40,
              inputs: {
                // multiplier: reference frequency of pitch standard
                Z21032K1: { block: {
                  type: "wf_Z33603",
                  inputs: {
                    Z33603K1: { block: { type: "wf_arg_1" } },  // pitch standard
                  },
                }},
                // multiplicand: frequency ratio of semitone distance
                Z21032K2: { block: {
                  type: "wf_Z25232",
                  inputs: {
                    Z25232K1: { block: {
                      type: "wf_Z17111",  // subtract (integer)
                      inputs: {
                        Z17111K1: { block: { type: "wf_arg_0" } },  // midi note number
                        Z17111K2: { block: {
                          type: "wf_Z33606",
                          inputs: {
                            Z33606K1: { block: { type: "wf_arg_1" } },  // pitch standard
                          },
                        }},
                      },
                    }},
                  },
                }},
              },
            },
          ],
        },
      };
      Blockly.serialization.workspaces.load(state, workspace);
    },
  },
];
