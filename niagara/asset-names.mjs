// Prints the names a Niagara script asset exposes, without opening the editor.
//
//   node niagara/asset-names.mjs <path/to/Script.uasset> [filter]
//
// A FunctionCall's pins are the called script's own input names, and getting one wrong is the
// difference between a graph that wires itself up on paste and one that does not. A .uasset
// stores its FNames as plain text, so the list can be read straight off the file.
//
// It prints more than the pin names -- there is no way to tell a pin name from any other FName
// at this level -- so treat it as a shortlist to recognise, not an authority. The authority is a
// real copy out of the editor.
import { readFileSync } from "node:fs";

const [file, filter] = process.argv.slice(2);
if (!file) {
  console.error("usage: node niagara/asset-names.mjs <Script.uasset> [filter]");
  console.error("  e.g. node niagara/asset-names.mjs \\");
  console.error("       'F:/UE_5.8/Engine/Plugins/FX/Niagara/Content/Functions/Math/Nlerp_Function.uasset'");
  process.exit(1);
}
const want = filter ? new RegExp(filter, "i") : null;

const buf = readFileSync(file);
const found = new Set();
let run = [];
const flush = () => {
  if (run.length >= 3) {
    const s = String.fromCharCode(...run);
    // Names read like identifiers or short phrases: "Quat A", "Module.Sharpness", "Ouput".
    if (/^[A-Za-z][\w .\/:]*$/.test(s) && (!want || want.test(s))) found.add(s);
  }
  run = [];
};
for (const b of buf) {
  if (b >= 0x20 && b < 0x7f) run.push(b);
  else flush();
}
flush();

for (const s of [...found].sort()) console.log(s);
