// Regenerates ue-niagara-ops.mjs from the engine's own op table.
//
//   node niagara/generate-ops.mjs <engine root>
//
// Niagara's operator pins are not UPROPERTYs -- they are built in C++ by FNiagaraOpInfo::Init,
// which is one long, entirely regular function in NiagaraEditorCommon.cpp. Parsing it beats
// hand-copying a hundred signatures, and it is the only file that has to be re-read when the
// engine version moves.
//
// Each pin is declared as
//     Op->Inputs.Add(FNiagaraOpInOutInfo(Name, Type, FriendlyText, TooltipText, Default[, Fmt]))
// and all five parts matter: an op's default is its own, not its type's. Lerp's B defaults to
// 1.0, so dropping the default would paste a Lerp that silently interpolates to zero.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEF_ACCESSORS } from "./types.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const engine = process.argv[2];
if (!engine) {
  console.error("usage: node niagara/generate-ops.mjs <engine root>   e.g. F:/UE_5.8");
  process.exit(1);
}

const source = join(engine, "Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraEditorCommon.cpp");
const src = readFileSync(source, "utf8");

const collect = (re, value = (m) => m[2]) => {
  const out = new Map();
  for (const m of src.matchAll(re)) if (!out.has(m[1])) out.set(m[1], value(m));
  return out;
};

// `static FName A(TEXT("A"));` — the pin names, declared once and reused across every op.
const names = collect(/\bFName\s+(\w+)\s*\(\s*TEXT\("([^"]*)"\)\s*\)/g);
// `FString CategoryName(TEXT("Numeric"));`, and every default-value string beside it.
//
// A matrix default is written across four source lines joined by C++ line continuations:
//
//     FString Default_MatrixOne(TEXT(
//         "1.0,0.0,0.0,0.0,\
//         0.0,1.0,0.0,0.0,\
//         …"));
//
// The compiler drops each backslash-newline and keeps the indentation that follows, so the
// value really does carry those tabs. Reproduce that rather than tidying it, or the pin default
// stops matching what the editor writes.
const strings = collect(/\bFString\s+(\w+)\s*\(\s*TEXT\(\s*"((?:[^"\\]|\\[\s\S])*)"\s*\)\s*\)/g,
  (m) => m[2].replace(/\\\r?\n/g, ""));
// `FNiagaraTypeDefinition NumericType = FNiagaraTypeDefinition::GetGenericNumericDef();`
const typeVars = collect(/\bFNiagaraTypeDefinition\s+(\w+)\s*=\s*FNiagaraTypeDefinition::(\w+)\(\)/g);
// `static FText AText = NSLOCTEXT("NiagaraOpInfo", "First Function Param", "A");`
// T3D keeps the whole NSLOCTEXT for a friendly name, so store the rendering as well as the text.
const texts = new Map();
for (const m of src.matchAll(/\bFText\s+(\w+)\s*=\s*NSLOCTEXT\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
  if (!texts.has(m[1])) texts.set(m[1], { render: `NSLOCTEXT("${m[2]}", "${m[3]}", "${m[4]}")`, text: m[4] });
}
for (const m of src.matchAll(/\bFText\s+(\w+)\s*=\s*FText::FromString\(\s*(?:TEXT\()?"((?:[^"\\]|\\.)*)"\)?\s*\)/g)) {
  if (!texts.has(m[1])) texts.set(m[1], { render: `"${m[2]}"`, text: m[2] });
}

// Split a call's argument list on top-level commas only: a type expression carries parens and a
// literal can carry commas ("1.0,0.0,0.0").
const splitArgs = (s) => {
  const out = [];
  let depth = 0, quoted = false, current = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { current += ch; if (ch === '"' && s[i - 1] !== "\\") quoted = false; continue; }
    if (ch === '"') { quoted = true; current += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

// Pull the balanced body of `FNiagaraOpInOutInfo(...)` starting at an index.
const bodyAt = (s, from) => {
  const open = s.indexOf("(", from);
  let depth = 0, quoted = false;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { if (ch === '"' && s[i - 1] !== "\\") quoted = false; continue; }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return s.slice(open + 1, i);
  }
  return null;
};

const literal = (token) => {
  const m = token.match(/^(?:TEXT\()?"((?:[^"\\]|\\.)*)"\)?$/);
  return m ? m[1] : null;
};
const resolveName = (t) => literal(t) ?? names.get(t) ?? null;
const resolveType = (t) => {
  const direct = t.match(/^FNiagaraTypeDefinition::(\w+)\(\)$/);
  const accessor = direct ? direct[1] : typeVars.get(t);
  return accessor ? DEF_ACCESSORS[accessor] ?? null : null;
};
const resolveDefault = (t) => (t === undefined ? null : literal(t) ?? strings.get(t) ?? null);
const resolveText = (t) => {
  if (t === undefined) return null;
  const lit = literal(t);
  if (lit !== null) return { render: `"${lit}"`, text: lit };
  return texts.get(t) ?? null;
};

// Each op starts at an AddDefaulted() and runs until the next one.
const starts = [...src.matchAll(/OpInfos\.AddDefaulted\(\)/g)].map((m) => m.index);
const blocks = starts.map((at, i) => src.slice(at, starts[i + 1] ?? src.length));

const ops = {};
const skipped = [];
for (const block of blocks) {
  const built = block.match(/Op->BuildName\(\s*TEXT\("([^"]*)"\)\s*,\s*(\w+)\s*\)/);
  if (!built) { skipped.push("a block with no BuildName"); continue; }
  const category = strings.get(built[2]);
  if (!category) { skipped.push(`${built[1]}: unresolved category ${built[2]}`); continue; }
  const opName = `${category}::${built[1]}`;

  const side = (which) => {
    const out = [];
    const marker = `Op->${which}.Add(FNiagaraOpInOutInfo`;
    let at = block.indexOf(marker);
    while (at >= 0) {
      const args = splitArgs(bodyAt(block, at + marker.length - "FNiagaraOpInOutInfo".length) ?? "");
      const name = resolveName(args[0]);
      const type = resolveType(args[1]);
      const friendly = resolveText(args[2]);
      const tip = resolveText(args[3]);
      const def = resolveDefault(args[4]);
      out.push({ name, type, friendly, tip, def });
      at = block.indexOf(marker, at + 1);
    }
    return out;
  };

  const ins = side("Inputs");
  const outs = side("Outputs");
  if ([...ins, ...outs].some((p) => !p.name || !p.type)) {
    skipped.push(`${opName}: unresolved pin name or type`);
    continue;
  }

  ops[opName] = { in: ins, out: outs, variadic: /Op->bSupportsAddedInputs\s*=\s*true/.test(block) };
}

// A pin whose default or texts could not be resolved still emits -- it just falls back to the
// type's default and no label, which is what the node table did before any of this existed.
const pin = (p, isOutput) => {
  const parts = [`name: ${JSON.stringify(p.name)}`, `type: ${JSON.stringify(p.type)}`];
  // An output pin's default is never written by the editor, so do not carry one.
  if (!isOutput && p.def != null) parts.push(`def: ${JSON.stringify(p.def)}`);
  if (p.friendly && p.friendly.text !== p.name) parts.push(`friendly: ${JSON.stringify(p.friendly.render)}`);
  if (p.tip) parts.push(`tip: ${JSON.stringify(p.tip.text)}`);
  return `{ ${parts.join(", ")} }`;
};

const body = Object.entries(ops)
  .map(([name, o]) => {
    const list = (ps, isOut) => `[${ps.map((p) => pin(p, isOut)).join(", ")}]`;
    return `  ${JSON.stringify(name)}: {\n    in: ${list(o.in, false)},\n`
      + `    out: ${list(o.out, true)}${o.variadic ? ",\n    variadic: true" : ""},\n  },`;
  })
  .join("\n");

const omitted = skipped.length
  ? `//\n// Not included (${skipped.length}):\n${[...new Set(skipped)].map((s) => `//   ${s}`).join("\n")}\n`
  : "";

writeFileSync(join(here, "ue-niagara-ops.mjs"), `// GENERATED by niagara/generate-ops.mjs -- do not edit.
//
// Source: Engine/Plugins/FX/Niagara/Source/NiagaraEditor/Private/NiagaraEditorCommon.cpp
//         (FNiagaraOpInfo::Init)
// Engine: ${engine}
//
// Pin names, order, types, per-pin defaults and labels are the engine's own rather than a
// guess. \`def\` is the op's own default -- not the type's -- which is why Lerp's B is 1.0.
// A \`friendly\` entry is written verbatim into PinFriendlyName, NSLOCTEXT and all; it is only
// present when it differs from the pin name.
//
// Regenerate when moving engine version -- op signatures do change.
${omitted}export const OPS = {
${body}
};
`);

console.log(`${Object.keys(ops).length} ops -> niagara/ue-niagara-ops.mjs`);
if (skipped.length) {
  console.log(`skipped ${skipped.length}:`);
  for (const s of [...new Set(skipped)]) console.log(`  ${s}`);
}
