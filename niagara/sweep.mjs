// Shared reading of an exported Niagara asset, for the three generators that parse the same
// export directory (functions, modules, enums).
//
// Everything here is text parsing over what niagara/export-functions.py wrote. It is separate
// from the generators only because all three need the same three answers: what encoding the
// file is in, which of the asset's script versions is the live one, and where one exported
// object ends.
import { readFileSync } from "node:fs";

// The exporter writes UTF-16LE whenever the asset holds a character the active codepage cannot
// represent -- a Korean comment in a Custom HLSL node is enough. Reading those as UTF-8 yields
// text that matches nothing, so the asset silently contributes nothing at all. Honour the BOM.
export const readText = (file) => {
  const buf = readFileSync(file);
  if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString("utf8");
  return buf.toString("utf8");
};

// An asset holds one script source per version and every one repeats the whole graph, so the
// right one has to be picked rather than the first one found. `ExposedVersion` names the GUID a
// caller gets; the matching `VersionData(N)` entry points at that version's source object and
// carries the usage bitmask that says which stages the module is allowed in.
//
// Taking the first source instead is not a tidiness question: MultiplyTransforms ships two
// versions whose change description reads "Set correct default value for scale inputs", and the
// older one has Scale A at 0,0,0 where the exposed one has 1,1,1.
// FVersionedNiagaraScriptData's own default for ModuleUsageBitmask: the five particle stages
// (NiagaraScript.cpp). Unreal omits a property equal to its default, so a particle module such
// as V2/ShapeLocation writes no bitmask at all -- reading that as "unknown" would silently drop
// the stage check for 54 of the 244 modules in the sweep.
const DEFAULT_USAGE =
  (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7);

export const exposedVersion = (text) => {
  const exposed = text.match(/^\s*ExposedVersion=([0-9A-F]{32})/m)?.[1];
  const versions = [...text.matchAll(/^\s*VersionData\(\d+\)=\((.*)\)\s*$/gm)].map((m) => ({
    guid: m[1].match(/VersionGuid=([0-9A-F]{32})/)?.[1],
    source: m[1].match(/Source="[^']*'(?:[^']*[.:])?(NiagaraScriptSource_\d+)'"/)?.[1],
    usage: Number(m[1].match(/ModuleUsageBitmask=(-?\d+)/)?.[1] ?? NaN),
  }));
  const hit = exposed ? versions.find((v) => v.guid === exposed) : null;
  // An unversioned asset carries no VersionData at all; fall back to the one source it has.
  const source = hit?.source ?? text.match(/(NiagaraScriptSource_\d+)\.NiagaraGraph_0/)?.[1];
  if (!source) return null;
  return {
    graph: `${source}.NiagaraGraph_0`,
    usage: Number.isFinite(hit?.usage) ? hit.usage : DEFAULT_USAGE,
    // Only a versioned asset pins its stack instances to a version GUID; an unversioned one
    // leaves UNiagaraNodeFunctionCall::SelectedScriptVersion invalid.
    version: /^\s*bVersioningEnabled=True/m.test(text) ? exposed ?? null : null,
  };
};

// The asset's own package path, off the graph's export path.
export const packagePath = (text, file) =>
  (text.match(/ExportPath="\/Script\/NiagaraEditor\.NiagaraGraph'([^:]+):/)?.[1]
    ?? `/${file.replace(/\.T3D$/i, "").split("__").join("/")}`)
    .replace(/\.[^./]+$/, "");

// `Begin Object Name="X" ExportPath="…"` down to the next `Begin Object` or `End Object` at the
// same indent. Cheap and good enough: the properties we want sit directly under the header.
export const blocks = (text, graph) => {
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

// A property written on the graph object itself rather than on one of its nodes -- and therefore
// after all of them, past where `blocks` stops. A versioned asset repeats the property once per
// version, so the right one is found by walking the nesting rather than taking the first match:
// InheritVelocity ships four versions, and reading whichever came first in the file drops three
// real inputs from the exposed one.
export const graphProperty = (text, graph, property) => {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*Begin Object Name="NiagaraGraph_0" ExportPath=/.test(lines[i])) continue;
    if (!lines[i].includes(graph)) continue;
    for (let j = i + 1, depth = 0; j < lines.length; j++) {
      if (/^\s*Begin Object[ =]/.test(lines[j])) depth++;
      else if (/^\s*End Object\s*$/.test(lines[j])) { if (depth-- === 0) break; }
      else if (depth === 0) {
        const hit = lines[j].match(new RegExp(`^\\s*${property}=\\((.*)\\)\\s*$`));
        if (hit) return hit[1];
      }
    }
  }
  return null;
};

// Every pin line in a block, already split into the parts any caller wants.
export const pins = (body) =>
  [...body.matchAll(/^\s*CustomProperties Pin \(PinId=\w+,PinName="([^"]*)".*$/gm)].map((m) => ({
    name: m[1],
    line: m[0],
    out: /Direction="EGPD_Output"/.test(m[0]),
    orphaned: /bOrphanedPin=True/.test(m[0]),
    wrapper: m[0].match(/PinType\.PinSubCategoryObject="([^'"]+)'([^']+)'"/)?.[1] ?? null,
    struct: m[0].match(/PinType\.PinSubCategoryObject="([^'"]+)'([^']+)'"/)?.[2] ?? null,
    def: m[0].match(/,DefaultValue="((?:[^"\\]|\\.)*)"/)?.[1] ?? null,
  }));

// CallSortPriority ascending, then lexicographically -- UNiagaraNodeInput::SortNodes. Ties are
// common (IsVectorParallel gives VectorA and VectorB the same priority), and leaving them to the
// order the export happened to be written in makes the generated table differ run to run.
export const byCallOrder = (a, b) =>
  a.priority - b.priority
  || a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en")
  || a.name.localeCompare(b.name, "en");
