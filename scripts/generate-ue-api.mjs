// Generates ue-material-api.mjs from an installed Unreal Engine.
//
//   node scripts/generate-ue-api.mjs <engine root> [out.mjs]
//   node scripts/generate-ue-api.mjs F:/UE_5.8
//
// Pin names and output shapes are not something to guess at: hand-written guesses render a
// graph that looks right and pastes in wrong. Everything here is read from the engine that
// ships with a binary install:
//
//   Public/Materials/MaterialExpression*.h        FExpressionInput members, in pin order
//   Private/Materials/MaterialExpressions.cpp     constructors -> output pins and mask bits
//   Editor/UnrealEd/Private/MaterialGraphNode.cpp property -> displayed pin name
//
// The rule the editor applies when it builds a pin (MaterialGraphNode.cpp): PinCategory is
// "mask" only when bShowMaskColorsOnPin and the output's Mask bit are both set, and the
// sub-category then names the one lit channel, or rgba when all four are. An expression that
// never touches Outputs keeps the base constructor's single unnamed, unmasked output.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const engine = process.argv[2];
if (!engine) {
  console.error("usage: node scripts/generate-ue-api.mjs <engine root> [out.mjs]");
  process.exit(1);
}
const outFile = resolve(
  process.argv[3] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "ue-material-api.mjs"),
);
const read = (p) => readFileSync(join(engine, "Engine/Source", p), "utf8");

// ---- inputs ----------------------------------------------------------------------
const headerDir = join(engine, "Engine/Source/Runtime/Engine/Public/Materials");
const classes = new Map();
for (const file of readdirSync(headerDir).filter((f) => /^MaterialExpression.*\.h$/.test(f))) {
  const text = readFileSync(join(headerDir, file), "utf8");
  const name = text.match(/class\s+(?:\w+_API\s+)?U(MaterialExpression\w+)\s*:/)?.[1];
  if (!name) continue;
  if (/Abstract/.test(text.match(/UCLASS\([^)]*\)/)?.[0] ?? "")) continue;
  classes.set(name, {
    inputs: [...text.matchAll(/^\s*FExpressionInput\s+(\w+)\s*;/gm)].map((m) => m[1]),
    renamesPins: /GetInputName\s*\(/.test(text),
    outputs: null,
  });
}

// ---- outputs ---------------------------------------------------------------------
const CHANNEL = { "1000": "red", "0100": "green", "0010": "blue", "0001": "alpha", "1111": "rgba" };
const expressions = read("Runtime/Engine/Private/Materials/MaterialExpressions.cpp");
for (const ctor of expressions.matchAll(/U(MaterialExpression\w+)::U\1\s*\(([\s\S]*?)\n\}/g)) {
  const entry = classes.get(ctor[1]);
  if (!entry) continue;
  const shows = !/bShowOutputNameOnPin\s*=\s*false/.test(ctor[2])
    && /bShowOutputNameOnPin\s*=\s*true/.test(ctor[2]);
  const outs = [];
  for (const o of ctor[2].matchAll(/Outputs\.Add\(FExpressionOutput\(TEXT\("([^"]*)"\)((?:\s*,\s*\d+)*)\)\)/g)) {
    const bits = o[2].split(",").map((n) => n.trim()).filter(Boolean);
    const masked = bits.length >= 5 && bits[0] === "1";
    outs.push({
      name: shows ? o[1] : "",
      sub: masked ? (CHANNEL[bits.slice(1, 5).join("")] ?? "") : null,
    });
  }
  if (outs.length) entry.outputs = outs;
}

// ---- displayed pin names ---------------------------------------------------------
const graphNode = read("Editor/UnrealEd/Private/MaterialGraphNode.cpp");
const consts = Object.fromEntries(
  [...graphNode.matchAll(/static const FName (\w+)\(TEXT\("([^"]*)"\)\)/g)].map((m) => [m[1], m[2]]),
);
const remap = {};
for (const branch of graphNode.matchAll(
  /PinName\s*==\s*MaterialPinNames::(\w+)\s*\)\s*\{\s*InputName\s*=\s*MaterialPinNames::(\w+)\s*;/g,
)) {
  const from = consts[branch[1]], to = consts[branch[2]];
  if (from && to && from !== to) remap[from] = to;
}

// ---- what to ship ----------------------------------------------------------------
// Substrate/Strata slabs and the custom-output family are whole subsystems with their own
// wiring rules; a caller reaching for one is not writing the kind of graph this table serves,
// and carrying them would triple its size for nothing.
const skip = (name) =>
  /Substrate|Strata/.test(name)
  || /CustomOutput$/.test(name)
  || /^MaterialExpression(Comment|Composite|PinBase|Reroute|NamedReroute|ExecBegin|ExecEnd|MaterialFunctionCall|FunctionInput|FunctionOutput)$/.test(name);

// Everything that survives the skip list ships, including the pure sources — a node with
// neither inputs nor custom outputs is not a useless one, it is TextureCoordinate.
const shipped = [...classes.entries()]
  .filter(([name]) => !skip(name))
  .sort(([a], [b]) => a.localeCompare(b));

const body = shipped.map(([name, c]) => {
  const inputs = c.inputs.map((prop) => {
    const label = remap[prop] ?? prop;
    return label === prop ? `["${prop}"]` : `["${label}", "${prop}"]`;
  });
  const outputs = (c.outputs ?? [{ name: "", sub: null }]).map((o, i) => {
    const pin = o.name || (i === 0 ? "Output" : `Output${i + 1}`);
    return o.sub === null ? `["${pin}"]` : `["${pin}", "${o.sub}"]`;
  });
  const flag = c.renamesPins ? ", renames: true" : "";
  return `  ${name.replace("MaterialExpression", "")}: {\n`
    + `    in: [${inputs.join(", ")}],\n`
    + `    out: [${outputs.join(", ")}]${flag},\n  },`;
});

writeFileSync(outFile, `// GENERATED by scripts/generate-ue-api.mjs from ${engine} — do not edit by hand.
//
// Per expression: \`in\` is [pinLabel] or [pinLabel, expressionProperty] when the editor shows
// a different name than the property is called; \`out\` is [pinName] for an unmasked output or
// [pinName, channel] for a masked one. \`renames: true\` marks a class whose GetInputName
// override varies with its own settings, so its labels can shift — check those against a real
// copy with reference/survey.mjs before relying on them.
//
// ${shipped.length} expressions.

export const UE_EXPRESSIONS = {
${body.join("\n")}
};

export const PIN_NAME_REMAP = ${JSON.stringify(remap, null, 2)};
`);

console.log(`${shipped.length} expressions -> ${outFile}`);
console.log(`  with inputs   ${shipped.filter(([, c]) => c.inputs.length).length}`);
console.log(`  custom output ${shipped.filter(([, c]) => c.outputs).length}`);
console.log(`  renaming pins ${shipped.filter(([, c]) => c.renamesPins).length}`);
console.log(`  pin remaps    ${Object.keys(remap).length}`);
