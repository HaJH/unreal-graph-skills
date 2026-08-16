// Reads an emitter's stack out of an exported Niagara system, as a starting point for a guide.
//
//   1. In the editor, export the system to T3D (see export-functions.py for the task shape)
//   2. node niagara/read-stack.mjs <System.T3D> [EmitterName]
//
// Niagara keeps every stage of an emitter in ONE graph and tells them apart by the ScriptType on
// each Output node. A stage's modules are whatever sits on the parameter-map chain feeding that
// Output, so the order is recovered by walking that chain backwards and reversing it.
//
// This prints the structure, not the input values: those live in the script's
// RapidIterationParameters as raw bytes at named offsets, and reading them back reliably means
// pairing each block's offsets with its own data blob. Take the values off the stack in the
// editor, or leave them out — a guide is mostly about which modules, in what order.
import { readFileSync, readdirSync } from "node:fs";

const readText = (file) => {
  const buf = readFileSync(file);
  // The exporter switches to UTF-16LE as soon as an asset holds a character it cannot otherwise
  // write, and one Korean comment is enough.
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
};

const [file, wanted] = process.argv.slice(2);
if (!file) {
  console.error("usage: node niagara/read-stack.mjs <System.T3D> [EmitterName]");
  process.exit(1);
}

// One export line can hold megabytes of compiled VM data; nothing here needs it.
const lines = readText(file).split(/\r?\n/).filter((l) => l.length < 20000);

// A module script keeps its graph under the same path shape as an emitter, so the candidates
// have to be narrowed to the ones that actually own stage outputs.
const text = lines.join("\n");
const candidates = [...new Set(
  [...text.matchAll(/:(\w+)\.NiagaraScriptSource_0\.NiagaraGraph_0\./g)].map((m) => m[1]),
)];
const emitters = candidates.filter((name) => {
  const owned = text.split(`:${name}.NiagaraScriptSource_0.NiagaraGraph_0.`).length > 1;
  return owned && new RegExp(
    `:${name}\\.NiagaraScriptSource_0[\\s\\S]{0,4000}?ScriptType=(Emitter|Particle)\\w+Script`,
  ).test(text);
});
if (!emitters.length) {
  console.error("no emitter graph found — is this an exported NiagaraSystem?");
  process.exit(1);
}
const emitter = wanted ?? emitters[0];
if (!emitters.includes(emitter)) {
  console.error(`no emitter "${emitter}". Found: ${emitters.join(", ")}`);
  process.exit(1);
}
if (!wanted && emitters.length > 1) {
  console.error(`# several emitters (${emitters.join(", ")}); reading ${emitter}`);
}

const scope = new RegExp(`:${emitter}\\.NiagaraScriptSource_0\\.NiagaraGraph_0\\.`);

const nodes = new Map();
for (let i = 0; i < lines.length; i++) {
  const head = lines[i].match(/Begin Object Name="(\w+)"/);
  if (!head || !scope.test(lines[i])) continue;
  const cls = lines[i].match(/'\/Script\/NiagaraEditor\.(\w+)'/)?.[1] ?? head[1].replace(/_\d+$/, "");
  const node = { name: head[1], cls, pins: [], props: [] };
  for (let j = i + 1; j < lines.length && !/^\s*(Begin|End) Object/.test(lines[j]); j++) {
    const pin = lines[j].match(/CustomProperties Pin \(PinId=(\w+),(.*)\)$/);
    if (pin) {
      node.pins.push({
        out: /Direction="EGPD_Output"/.test(pin[2]),
        map: /NiagaraParameterMap/.test(pin[2]),
        linked: [...pin[2].matchAll(/LinkedTo=\(([^)]*)\)/g)]
          .flatMap((m) => [...m[1].matchAll(/(\w+) (\w+)/g)].map((x) => x[1])),
      });
    } else if (lines[j].trim()) {
      node.props.push(lines[j].trim());
    }
  }
  nodes.set(head[1], node);
}

// A stack row is a module call or a Set Variables node; everything else is plumbing.
const label = (n) => {
  if (n.cls === "NiagaraNodeFunctionCall") {
    return n.props.find((p) => p.startsWith("FunctionDisplayName="))?.match(/"([^"]*)"/)?.[1]
      ?? n.props.find((p) => p.startsWith("FunctionScript="))?.match(/'([^']+)'/)?.[1].split("/").pop()
      ?? n.name;
  }
  if (n.cls === "NiagaraNodeAssignment") {
    const targets = n.props.filter((p) => p.startsWith("AssignmentTargets"))
      .map((p) => p.match(/Name="([^"]*)"/)?.[1]).filter(Boolean);
    return `Set: ${targets.join(", ") || "?"}`;
  }
  return null;
};

const feeder = (node) => {
  const pin = node.pins.find((p) => !p.out && p.map && p.linked.length)
    ?? node.pins.find((p) => !p.out && p.linked.length);
  return pin ? nodes.get(pin.linked[0]) : null;
};

const STAGES = [
  ["EmitterSpawnScript", "Emitter Spawn"],
  ["EmitterUpdateScript", "Emitter Update"],
  ["ParticleSpawnScript", "Particle Spawn"],
  ["ParticleUpdateScript", "Particle Update"],
];

console.log(`// ${emitter} — stack read from ${file.split(/[\\/]/).pop()}`);
console.log("stages: [");
for (const [type, title] of STAGES) {
  const out = [...nodes.values()].find(
    (n) => n.cls === "NiagaraNodeOutput" && n.props.includes(`ScriptType=${type}`));
  if (!out) continue;

  const chain = [];
  const seen = new Set();
  for (let cur = feeder(out); cur && !seen.has(cur.name); cur = feeder(cur)) {
    seen.add(cur.name);
    const text = label(cur);
    if (text) chain.push(text);
  }
  chain.reverse();
  if (!chain.length) continue;

  console.log(`  { stage: ${JSON.stringify(title)}, modules: [`);
  for (const c of chain) {
    console.log(c.startsWith("Set: ")
      ? `    { set: ${JSON.stringify(c.slice(5))} },`
      : `    { module: ${JSON.stringify(c)} },`);
  }
  console.log("  ] },");
}
console.log("],");
