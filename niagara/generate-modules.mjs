// Builds ue-niagara-modules.mjs -- what each module exposes as a stack input.
//
//   1. In the editor:  exec(open('<plugin>/niagara/export-functions.py').read())
//   2. Offline:        node niagara/generate-modules.mjs <export dir>
//
// This is the table an emitter-stack payload is checked against. Pasting a stack is a replay,
// not an import: the editor adds each module for real and applies inputs by name and type,
// silently dropping anything that does not match. A typo therefore produces a payload that
// pastes cleanly and quietly loses a value -- which is why the build validates against this
// table instead of trusting the spec.
//
// ## What counts as a stack input
//
// Two kinds of parameter, both read off the module's own graph:
//
//   * `Module.<X>` parameters, which the stack shows as `<X>` -- SpawnBurst_Instantaneous keeps
//     `Module.Spawn Count`, and a real clipboard capture of it reads `InputName="Spawn Count"`.
//   * static switch parameters, which carry no namespace and appear under their own name.
//
// ## Types, without going near the type registry
//
// A parameter's type has to be an object path, because that is what the payload writes
// (`InputType=(ClassStructOrEnum="…")`). `VariableToScriptVariable` states the type as a
// RegisteredTypeIndex instead, and that index is assigned at runtime -- re-exporting after a
// restart moved two of them -- so it is not used here at all. Instead:
//
//   * a static switch states its own type on its own node (`SwitchTypeData`), which for an enum
//     is the enum's asset path. One node, no ambiguity.
//   * a `Module.<X>` parameter appears as a pin somewhere in the same graph, and a pin carries
//     the path. A parameter has exactly one type within one graph, so matching by name inside a
//     single graph is exact -- unlike a join across the whole sweep, where a name means nothing.
//
// A parameter whose type cannot be resolved that way is left off its module rather than guessed
// at, and counted in the generator's output.
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readText, exposedVersion, packagePath, blocks, pins, graphProperty } from "./sweep.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node niagara/generate-modules.mjs <export dir>");
  process.exit(1);
}

// What kind of script this is, off UNiagaraScript::Usage. ModuleUsageBitmask is not the test:
// it says which stages a module is *allowed* in, and EmitterState sets only the Emitter Update
// bit with no kind bit at all. The three leading spaces pin it to the asset's own properties --
// a NiagaraNodeInput has an unrelated `Usage` of its own, further in.
const isModule = (text) => /^ {3}Usage=Module\s*$/m.test(text);

const BOOL = { wrapper: "/Script/CoreUObject.ScriptStruct", struct: "/Script/Niagara.NiagaraBool" };
const INT = { wrapper: "/Script/CoreUObject.ScriptStruct", struct: "/Script/Niagara.NiagaraInt32" };

const modules = {};
const untyped = [];
let scanned = 0;

for (const file of readdirSync(dir).filter((f) => f.toUpperCase().endsWith(".T3D"))) {
  const text = readText(join(dir, file));
  const version = exposedVersion(text);
  if (!version?.graph) continue;
  // A function or a dynamic input is called from a graph, not placed in a stack.
  if (!isModule(text)) continue;
  scanned++;

  const graph = version.graph;
  const owned = blocks(text, graph);

  // Every pin in the graph, by name -- a parameter's type, stated as a path. A name that turns
  // up with two different types in one graph is dropped: that should not happen, and picking one
  // would be exactly the kind of guess this table exists to avoid.
  const byName = new Map();
  const conflicted = new Set();
  for (const b of owned) {
    for (const p of pins(b.body)) {
      if (!p.struct || p.orphaned) continue;
      const seen = byName.get(p.name);
      if (!seen) byName.set(p.name, { wrapper: p.wrapper, struct: p.struct });
      else if (seen.struct !== p.struct) conflicted.add(p.name);
    }
  }

  // Static switch parameters, each typed by its own node.
  const switches = new Map();
  const switchClash = new Set();
  for (const b of owned) {
    if (b.cls !== "NiagaraNodeStaticSwitch") continue;
    const name = b.body.match(/^\s*InputParameterName="([^"]*)"/m)?.[1];
    if (!name) continue;
    // ENiagaraStaticSwitchType starts at Bool, so a bool switch writes no SwitchType at all --
    // UseLoopCountLimit comes out as `SwitchTypeData=(bAutoRefreshEnabled=True)`, and a plain
    // bool switch may have no SwitchTypeData line whatsoever.
    const data = b.body.match(/^\s*SwitchTypeData=\((.*)\)\s*$/m)?.[1] ?? "";
    // A SwitchConstant means UNiagaraNodeStaticSwitch::IsSetByCompiler -- the value comes from
    // the compile context, not from the stack, so it is not an input and it states no type.
    // GravityForce has three nodes called "Coordinate Space", and only the first is the real
    // enum input; letting the compiler-set ones through retyped it as a bool.
    if (/SwitchConstant=/.test(data)) continue;
    const enumPath = data.match(/Enum="([^'"]+)'([^']+)'"/);
    const type = enumPath
      ? { wrapper: enumPath[1], struct: enumPath[2] }
      : /SwitchType=Integer/.test(data) ? INT : BOOL;
    const seen = switches.get(name);
    if (seen && seen.struct !== type.struct) switchClash.add(name);
    else switches.set(name, type);
  }
  for (const name of switchClash) switches.delete(name);

  // The parameters the graph declares, in the order VariableToScriptVariable lists them -- the
  // order the stack draws them in. It is a property of the NiagaraGraph, so a versioned asset
  // has one per version; reading whichever came first in the file gets the wrong list, and
  // InheritVelocity (four versions) then loses Velocity Scale and two more real inputs.
  const declared = [...(graphProperty(text, graph, "VariableToScriptVariable") ?? "")
    .matchAll(/\(\(Name="([^"]*)",TypeDefHandle=\(RegisteredTypeIndex=-?\d+\)\)/g)]
    .map((m) => m[1]);

  const inputs = [];
  const taken = new Set();
  for (const full of declared) {
    // "Module.Spawn Count" is drawn as "Spawn Count"; a static switch keeps its bare name.
    const namespaced = full.startsWith("Module.");
    const name = namespaced ? full.slice("Module.".length) : full;
    if (!namespaced && !switches.has(full)) continue;
    if (taken.has(name)) continue;

    const type = switches.get(full) ?? (conflicted.has(full) ? null : byName.get(full));
    if (!type) { untyped.push(`${packagePath(text, file)} -> ${full}`); continue; }
    taken.add(name);
    inputs.push({ name, ...type });
  }
  if (!inputs.length) continue;

  modules[packagePath(text, file)] = { usage: version.usage, version: version.version, inputs };
}

const entry = (m) => {
  const inputs = m.inputs.map((p) => `{ name: ${JSON.stringify(p.name)}, `
    + `struct: ${JSON.stringify(p.struct)}, wrapper: ${JSON.stringify(p.wrapper)} }`).join(", ");
  return `{ usage: ${m.usage}, ${m.version ? `version: ${JSON.stringify(m.version)}, ` : ""}inputs: [${inputs}] }`;
};

const body = Object.keys(modules).sort()
  .map((k) => `  ${JSON.stringify(k)}: ${entry(modules[k])},`)
  .join("\n");

writeFileSync(join(here, "ue-niagara-modules.mjs"), `// GENERATED by niagara/generate-modules.mjs -- do not edit.
//
// Source: Niagara module assets exported to T3D by niagara/export-functions.py.
//
// \`inputs\` are the stack rows the module draws, named as the stack names them, each typed by an
// object path so a payload never has to touch the runtime type registry. \`usage\` is the
// ModuleUsageBitmask of the module's exposed version: bit (1 << ENiagaraScriptUsage) per stage
// the module is allowed in, which is what makes "this module cannot go in that stage" a build
// error rather than a paste that silently does nothing. \`version\` is the exposed version GUID,
// present only on a versioned asset, and is what a stack instance pins itself to.
//
// Regenerate after an engine upgrade, or when project modules change.
export const MODULES = {
${body}
};
`);

console.log(`${scanned} modules scanned, ${Object.keys(modules).length} with inputs`
  + ` -> niagara/ue-niagara-modules.mjs`);
if (untyped.length) {
  console.log(`${untyped.length} parameter(s) left off, no type path in their own graph:`);
  for (const u of untyped) console.log(`  ${u}`);
}
