// Builds ue-niagara-enums.mjs -- the display name the stack shows for each enumerator value.
//
//   1. In the editor:  exec(open('<plugin>/niagara/export-functions.py').read())
//   2. Offline:        node niagara/generate-enums.mjs <export dir>
//
// A stack input typed as an enum stores an ordinal, so "Position Mode 2" is what a payload
// carries and "Simulation Position" is what the editor draws. Turning one into the other needs
// the enumerator order, and getting it wrong is worse than not having it: the number would
// still paste, silently selecting a different mode.
//
// ## Why the enum asset alone is not enough
//
// A UserDefinedEnum exports its labels as
//
//     DisplayNameMap=(("NewEnumerator0", NSLOCTEXT(…, "Unset")), ("NewEnumerator1", …))
//
// keyed by the internal name, in the map's own order -- which is creation order. Reordering
// entries in the enum editor moves them in the `Names` array without renaming them, and `Names`
// is not a UPROPERTY, so it never reaches the text export. ENiagara_SizeScaleMode is the proof:
// its map reads Unset, Random Uniform, Random Non-Uniform, Uniform, Non-Uniform, while the
// dropdown reads Unset, Uniform, Random Uniform, Non-Uniform, Random Non-Uniform. Reading the
// map in order would have mapped four of five values to the wrong mode.
//
// ## Where the order actually comes from
//
// A static switch or select node on an enum writes one input pin per visible entry, in value
// order, named "<var> if <display name>" -- UNiagaraNodeStaticSwitch::GetOptionValues walks the
// entries by index and GetOptionPinName labels each with GetDisplayNameTextByValue. So the pins
// of one node ARE the ordered label list, read straight off the engine's own code path, and the
// join is inside a single node.
//
// Three things keep that honest, and the generator enforces all of them:
//
//   * a node caches its pin names from when they were last allocated, so a stale node can carry
//     labels the enum no longer uses. A witness is accepted only if its label set matches the
//     asset's current DisplayNameMap -- ENiagaraChannelCorrelation has exactly one such stale
//     witness against six fresh ones.
//   * where several nodes witness the same enum they must agree, or the enum is dropped.
//   * an enum nobody switches on is left out rather than guessed at.
//
// Verified against ground truth where ground truth exists: ENiagaraSimTarget and
// ESplitScreenType are BlueprintType C++ enums, so Unreal's Python API can enumerate them, and
// both come back exactly as witnessed -- including all twelve of ESplitScreenType in order.
import { writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "./sweep.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) {
  console.error("usage: node niagara/generate-enums.mjs <export dir>");
  process.exit(1);
}

// path -> the labels the asset currently declares, unordered. Absent for a C++ enum, which has
// no asset to export.
const declared = new Map();
// path -> Map(JSON label sequence -> how many nodes witnessed it)
const witnessed = new Map();

const addWitness = (path, seq) => {
  const key = JSON.stringify(seq);
  const bucket = witnessed.get(path) ?? new Map();
  bucket.set(key, (bucket.get(key) ?? 0) + 1);
  witnessed.set(path, bucket);
};

for (const file of readdirSync(dir).filter((f) => f.toUpperCase().endsWith(".T3D"))) {
  const text = readText(join(dir, file));

  const asset = text.match(
    /^Begin Object Class=\/Script\/Engine\.UserDefinedEnum Name="[^"]+" ExportPath="[^']+'([^']+)'"/);
  if (asset) {
    const map = text.match(/^\s*DisplayNameMap=\((.*)\)\s*$/m);
    declared.set(asset[1], map
      ? [...map[1].matchAll(/\("\w+",\s*NSLOCTEXT\("[^"]*",\s*"[^"]*",\s*"((?:[^"\\]|\\.)*)"\)\)/g)]
        .map((m) => m[1])
      : []);
    continue;
  }

  for (const m of text.matchAll(
    /Begin Object Name="(?:NiagaraNodeStaticSwitch|NiagaraNodeSelect)_\d+"[\s\S]*?\n(?=\s*(?:Begin|End) Object)/g)) {
    const block = m[0];
    // A switch names its enum on SwitchTypeData, a select on SelectorPinType. Both are object
    // paths, so neither depends on the runtime type registry.
    const path = block.match(/SwitchTypeData=\(SwitchType=Enum,Enum="[^']*'([^']+)'"/)?.[1]
      ?? block.match(/^\s*SelectorPinType=\(ClassStructOrEnum="[^']*Enum'([^']+)'"/m)?.[1];
    if (!path) continue;

    const options = Number(block.match(/^\s*NumOptionsPerVariable=(\d+)/m)?.[1] ?? NaN);
    if (!Number.isFinite(options) || options < 1) continue;

    const labels = [];
    for (const p of block.matchAll(/^\s*CustomProperties Pin \(PinId=\w+,PinName="([^"]*)".*$/gm)) {
      if (/Direction="EGPD_Output"|bOrphanedPin=True/.test(p[0])) continue;
      const suffix = p[1].match(/^.* if (.*)$/);
      if (suffix) labels.push(suffix[1]);
    }
    // A node with several output variables writes one pin per variable per option, option-major,
    // so the run of identical labels has to be folded back down before the list means anything.
    if (!labels.length || labels.length % options !== 0) continue;
    const stride = labels.length / options;
    addWitness(path, Array.from({ length: options }, (_, i) => labels[i * stride]));
  }
}

const sameSet = (a, b) =>
  a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const enums = {};
const gaps = [];
const short = (p) => p.split("/").pop().split(".").pop();

for (const [path, bucket] of [...witnessed].sort((a, b) => a[0].localeCompare(b[0]))) {
  const current = declared.get(path);
  const seqs = [...bucket.keys()].map((k) => JSON.parse(k));
  // Against an asset, only witnesses still spelling the enum's current labels count -- the rest
  // are nodes that have not reallocated their pins since the labels changed.
  const fresh = current ? seqs.filter((s) => sameSet(s, current)) : seqs;

  if (!fresh.length) {
    gaps.push(`${short(path)}: ${seqs.length} witness(es), none matching the asset's current labels`);
    continue;
  }
  if (new Set(fresh.map((s) => JSON.stringify(s))).size > 1) {
    gaps.push(`${short(path)}: witnesses disagree on the order`);
    continue;
  }
  enums[path] = { values: fresh[0], witnesses: [...bucket.values()].reduce((a, b) => a + b, 0), confirmed: Boolean(current) };
}

for (const path of [...declared.keys()].sort()) {
  if (!enums[path] && !witnessed.has(path)) gaps.push(`${short(path)}: nothing switches on it`);
}

// How often the asset's own map order would have been wrong -- the number that makes the case
// for reading the switches instead.
const reordered = Object.entries(enums)
  .filter(([p, e]) => declared.has(p) && JSON.stringify(e.values) !== JSON.stringify(declared.get(p)))
  .length;

const body = Object.keys(enums).sort()
  .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(enums[k].values)},`)
  .join("\n");

writeFileSync(join(here, "ue-niagara-enums.mjs"), `// GENERATED by niagara/generate-enums.mjs -- do not edit.
//
// Source: Niagara assets exported to T3D by niagara/export-functions.py.
//
// Each entry is an enum's labels in VALUE order, so the ordinal a stack payload carries indexes
// straight into it. The order is read off static switch / select option pins, which the engine
// itself builds by walking the enum by value. The enum asset's own DisplayNameMap is in creation
// order and would have given a different answer for ${reordered} of these, so it is used only to
// reject witnesses whose labels have gone stale.
//
// An enum nothing switches on is absent rather than guessed at, and so is one whose witnesses
// disagree: ${gaps.length} are missing for those two reasons. Blank is the intended answer there --
// see the generator's header for why, and its output for the list.
//
// Regenerate after an engine upgrade, or when project enums change.
export const ENUMS = {
${body}
};
`);

const confirmed = Object.values(enums).filter((e) => e.confirmed).length;
console.log(`${Object.keys(enums).length} enums -> niagara/ue-niagara-enums.mjs`
  + ` (${confirmed} checked against an asset, ${Object.keys(enums).length - confirmed} witnessed only)`);
console.log(`${gaps.length} left out:`);
for (const g of gaps) console.log(`  ${g}`);
