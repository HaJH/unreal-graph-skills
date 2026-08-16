// Builds ue-niagara-functions.mjs (and the type-index table) from exported Niagara scripts.
//
//   1. In the editor:  exec(open('<plugin>/niagara/export-functions.py').read())
//   2. Offline:        node niagara/generate-functions.mjs <export dir>
//
// A function call's pins are the called script's own exposed inputs, in CallSortPriority order,
// plus its output node's variables. Unlike operators, that lives in each asset rather than in
// one engine header -- hence the export step. Everything after it is text parsing.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node niagara/generate-functions.mjs <export dir>");
  process.exit(1);
}

// The exporter writes UTF-16LE whenever the asset holds a character that codepage cannot avoid —
// a Korean comment in a Custom HLSL node is enough. Reading those as UTF-8 yields text that
// matches nothing, so the asset silently contributes no functions. Honour the BOM.
const readText = (file) => {
  const buf = readFileSync(file);
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
};

// An asset holds one script source per version; every one repeats the whole graph, so scope to
// the first or every input comes out two or three times over.
const firstGraph = (text) => {
  const marker = /NiagaraScriptSource_(\d+)\.NiagaraGraph_0/;
  const m = text.match(marker);
  return m ? `NiagaraScriptSource_${m[1]}.NiagaraGraph_0` : null;
};

// `Begin Object Name="X" ExportPath="…"` down to the next `Begin Object` or `End Object` at the
// same indent. Cheap and good enough: the properties we want sit directly under the header.
const blocks = (text, graph) => {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^\s*Begin Object Name="([^"]+)" ExportPath="([^"]*)"/);
    if (!head || !head[2].includes(graph)) continue;
    const cls = head[2].match(/^\/Script\/NiagaraEditor\.(\w+)/)?.[1];
    const body = [];
    for (let j = i + 1; j < lines.length && !/^\s*(Begin|End) Object/.test(lines[j]); j++) body.push(lines[j]);
    out.push({ name: head[1], cls, body: body.join("\n") });
  }
  return out;
};

const variable = (s) => {
  const name = s.match(/Name="([^"]*)"/)?.[1];
  const index = Number(s.match(/RegisteredTypeIndex=(-?\d+)/)?.[1] ?? NaN);
  // The variable's own value, as the raw little-endian bytes the editor stores.
  const raw = s.match(/VarData=\(([^)]*)\)/)?.[1];
  const data = raw ? raw.split(",").map(Number).filter((n) => Number.isInteger(n)) : null;
  return name && Number.isFinite(index) ? { name, index, data } : null;
};

// How each type renders its inline value. Unreal has no single format: a float is fixed to six
// places, a Vector2f is struct-style, everything else is comma-separated to three. These are the
// forms observed in real copies -- see reference/ENCODING-NIAGARA.md.
const floats = (b, n) => {
  const view = new DataView(Uint8Array.from(b).buffer);
  return Array.from({ length: n }, (_, i) => view.getFloat32(i * 4, true));
};
const ints = (b, n) => {
  const view = new DataView(Uint8Array.from(b).buffer);
  return Array.from({ length: n }, (_, i) => view.getInt32(i * 4, true));
};
const csv = (n, places = 3) => (b) => floats(b, n).map((v) => v.toFixed(places)).join(",");

const FORMATS = {
  "/Script/Niagara.NiagaraFloat": (b) => floats(b, 1)[0].toFixed(6),
  "/Script/Niagara.NiagaraInt32": (b) => String(ints(b, 1)[0]),
  "/Script/Niagara.NiagaraBool": (b) => (ints(b, 1)[0] === 0 ? "false" : "true"),
  "/Script/Niagara.NiagaraPosition": csv(3),
  "/Script/Niagara.NiagaraID": (b) => ints(b, 2).join(","),
  "/Script/CoreUObject.Vector2f": (b) => {
    const [x, y] = floats(b, 2);
    return `X=${x.toFixed(3)} Y=${y.toFixed(3)}`;
  },
  "/Script/CoreUObject.Vector3f": csv(3),
  "/Script/CoreUObject.Vector4f": csv(4),
  "/Script/CoreUObject.Quat4f": csv(4),
  "/Script/CoreUObject.LinearColor": csv(4),
};

// An enum is an int32 on the wire, whatever its path.
const formatValue = (struct, wrapper, data) => {
  if (!data?.length) return null;
  const format = FORMATS[struct] ?? (wrapper?.endsWith("Enum") ? FORMATS["/Script/Niagara.NiagaraInt32"] : null);
  if (!format) return null;
  try {
    const text = format(data);
    return /NaN|Infinity/.test(text) ? null : text;
  } catch {
    return null;  // a byte count that does not match the type is not worth guessing at
  }
};

// index -> type path, correlated from an Input node's own output pin: the node states the index,
// the pin states the object path, and they describe the same variable.
const typeIndex = new Map();
const typeKind = new Map();

const functions = {};
let scanned = 0;
let skipped = 0;

for (const file of readdirSync(dir).filter((f) => f.toUpperCase().endsWith(".T3D"))) {
  const text = readText(join(dir, file));
  const graph = firstGraph(text);
  if (!graph) { skipped++; continue; }
  scanned++;

  const path = text.match(/ExportPath="\/Script\/NiagaraEditor\.NiagaraGraph'([^:]+):/)?.[1]
    ?? file.replace(/\.T3D$/i, "").split("__").join("/").replace(/^/, "/");
  // "/Niagara/Functions/Rotation/LerpQuaternion.LerpQuaternion" -> package path only.
  const pkg = path.replace(/\.[^./]+$/, "");

  const ins = [];
  const outs = [];
  for (const b of blocks(text, graph)) {
    if (b.cls === "NiagaraNodeInput") {
      const decl = b.body.match(/^\s*Input=\((.*)\)\s*$/m);
      if (!decl) continue;
      const v = variable(decl[1]);
      if (!v) continue;
      // Only exposed inputs become pins on a call node; the rest are internal defaults.
      if (/bExposed=False/.test(b.body)) continue;
      const priority = Number(b.body.match(/CallSortPriority=(-?\d+)/)?.[1] ?? 0);
      ins.push({ ...v, priority });

      // The wrapper is kept whole: a struct reads /Script/CoreUObject.ScriptStruct, a content
      // enum /Script/Engine.UserDefinedEnum, and the pin has to be written back either way.
      const pin = b.body.match(/PinType\.PinSubCategoryObject="([^'"]+)'([^']+)'"/);
      if (pin && !typeIndex.has(v.index)) { typeIndex.set(v.index, pin[2]); typeKind.set(v.index, pin[1]); }
    } else if (b.cls === "NiagaraNodeOutput") {
      for (const m of b.body.matchAll(/^\s*Outputs\(\d+\)=\((.*)\)\s*$/gm)) {
        const v = variable(m[1]);
        if (v) outs.push(v);
      }
    }
  }

  if (!ins.length && !outs.length) continue;
  ins.sort((a, b) => a.priority - b.priority);
  // A duplicate name means two versions leaked in despite the graph filter; keep the first.
  const dedupe = (list) => list.filter((v, i) => list.findIndex((o) => o.name === v.name) === i);
  functions[pkg] = { in: dedupe(ins).map(({ name, index, data }) => ({ name, index, data })), out: dedupe(outs) };
}

const typeName = (index) => typeIndex.get(index) ?? null;
const wrapperOf = (index) => typeKind.get(index) ?? "/Script/CoreUObject.ScriptStruct";

const entry = (pins) =>
  `[${pins.map((p) => {
    const struct = typeName(p.index) ?? `#${p.index}`;
    const wrapper = wrapperOf(p.index);
    const def = formatValue(struct, wrapper, p.data);
    return `{ name: ${JSON.stringify(p.name)}, struct: ${JSON.stringify(struct)}, `
      + `wrapper: ${JSON.stringify(wrapper)}${def === null ? "" : `, def: ${JSON.stringify(def)}`} }`;
  }).join(", ")}]`;

const body = Object.keys(functions).sort()
  .map((k) => `  ${JSON.stringify(k)}: { in: ${entry(functions[k].in)}, out: ${entry(functions[k].out)} },`)
  .join("\n");

writeFileSync(join(here, "ue-niagara-functions.mjs"), `// GENERATED by niagara/generate-functions.mjs -- do not edit.
//
// Source: Niagara script assets exported to T3D by niagara/export-functions.py.
//
// A function call's pins are the called script's exposed inputs in CallSortPriority order, and
// its output node's variables. \`type\` is the pin's UScriptStruct/UClass path; an entry that
// reads "#<n>" is a registry index whose type path this sweep never saw, and needs a wider
// export rather than a guess.
//
// Regenerate after an engine upgrade, or when project scripts change.
export const FUNCTIONS = {
${body}
};
`);

const indexBody = [...typeIndex.entries()].sort((a, b) => a[0] - b[0])
  .map(([i, p]) => `  ${i}: ${JSON.stringify(p)},`).join("\n");

writeFileSync(join(here, "ue-niagara-type-index.mjs"), `// GENERATED by niagara/generate-functions.mjs -- do not edit.
//
// FNiagaraVariable stores its type as a runtime registry index, and T3D carries that index
// verbatim. The mapping is stable for one engine build and differs between versions; it is
// recovered here by correlating each Input node's stated index with its own pin's type path.
export const TYPE_INDEX = {
${indexBody}
};
`);

console.log(`${scanned} assets scanned, ${skipped} without a graph`);
console.log(`${Object.keys(functions).length} functions -> niagara/ue-niagara-functions.mjs`);
console.log(`${typeIndex.size} type indices -> niagara/ue-niagara-type-index.mjs`);
