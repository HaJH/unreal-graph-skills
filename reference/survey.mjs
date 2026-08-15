// Prints the pin encoding of a Material Editor copy.
//
//   node survey.mjs <file.t3d>
//
// Select nodes in a material, Ctrl+C, save the clipboard to a file, and run this. The output
// is shaped like a `NODES` entry in material-nodes.mjs: one line per pin with its direction,
// category, sub-category and inline default. See ENCODING.md for what the fields mean.
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node survey.mjs <file.t3d>");
  process.exit(1);
}

const field = (line, key) => line.match(new RegExp(`${key}="([^"]*)"`))?.[1] ?? null;

// Unreal writes the clipboard at column zero, but text pasted through an editor or a code
// block often arrives indented, so do not anchor hard to the line start.
const t3d = readFileSync(file, "utf8");
const blocks = t3d.split(/^[ \t]*Begin Object Class=/m).slice(1);
if (!blocks.length) {
  console.error("no 'Begin Object Class=' found — is this a Material Editor copy?");
  process.exit(1);
}

for (const block of blocks) {
  const expr = block.match(/\/Script\/Engine\.(MaterialExpression\w+)/)?.[1]
    ?? block.match(/^\/Script\/\w+\.(\w+)/)?.[1];
  if (!expr) continue;

  // Properties of the expression, minus the bookkeeping every node carries.
  const props = [...block.matchAll(/^\s{6,}(\w+)=/gm)]
    .map((m) => m[1])
    .filter((k) => !/^(MaterialExpressionEditor[XY]|MaterialExpressionGuid|Material)$/.test(k));

  const pins = block.split("\n").filter((l) => l.includes("CustomProperties Pin"));
  // The MaterialGraphNode wrapper splits off with nothing of its own; only the expression
  // block carries the properties and pins, so skip the empty halves.
  if (!props.length && !pins.length) continue;

  console.log(`\n### ${expr}`);
  if (props.length) console.log(`  props: ${[...new Set(props)].join(", ")}`);

  for (const line of pins) {
    const parts = [
      field(line, "Direction") === "EGPD_Output" ? "out" : "in ",
      (field(line, "PinName") ?? "?").padEnd(22),
      `cat=${(field(line, "PinType.PinCategory") ?? "").padEnd(9)}`,
      `sub=${(field(line, "PinType.PinSubCategory") ?? "").padEnd(8)}`,
    ];
    const value = field(line, "DefaultValue");
    if (value !== null) parts.push(`default="${value}"`);
    if (/bNotConnectable=True/.test(line)) parts.push("fixed");
    if (/bAdvancedView=True/.test(line)) parts.push("advanced");
    if (/bHidden=True/.test(line)) parts.push("hidden");
    console.log("  " + parts.join(" "));
  }
}
