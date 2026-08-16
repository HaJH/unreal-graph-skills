// Expands one stage of a stack spec into Niagara emitter-stack clipboard T3D.
//
// The same UNiagaraClipboardContent wrapper the script graph uses, carrying `Functions` instead
// of `ExportedNodes` -- see reference/ENCODING-NIAGARA.md. One payload is one stage's modules,
// because that is what a copy in the editor contains and what a paste expects.
//
// ## Why this validates so hard
//
// Pasting is a replay, not an import. UNiagaraStackScriptHierarchyRoot::SetValuesFromClipboard-
// FunctionInputs walks the stack's own rows and applies a clipboard input only where
//
//     StackFunctionInput->GetInputParameterHandle().GetName() == ClipboardFunctionInput->InputName
//     && StackFunctionInput->GetInputType() == ClipboardFunctionInput->InputType
//
// -- and does nothing at all otherwise. A misspelled input name, or the right name at the wrong
// type, therefore produces a payload that pastes without a murmur and quietly leaves that row at
// its default. Nothing downstream can notice. So every name, type and value here is checked
// against the generated module table first, and a mismatch fails the build with the module's
// real input list rather than emitting something that looks fine.
import { MODULES } from "./ue-niagara-modules.mjs";
import { ENUMS } from "./ue-niagara-enums.mjs";
import { TYPE_INDEX } from "./ue-niagara-type-index.mjs";
import { typeOf, typeDefHandle } from "./types.mjs";

// ENiagaraScriptUsage, as ModuleUsageBitmask indexes it: bit (1 << usage) per stage a module is
// allowed in. The names on the left are the stage titles a spec writes.
export const STAGE_USAGE = {
  "Emitter Spawn": 9,
  "Emitter Update": 10,
  "Particle Spawn": 3,
  "Particle Update": 5,
  "Event Handler": 6,
  "Simulation Stage": 7,
  "System Spawn": 11,
  "System Update": 12,
};

// A type is an enum when the object it points at is one -- /Script/CoreUObject.Enum for a C++
// enum, /Script/Engine.UserDefinedEnum for a content one. Same test the pin category uses in
// niagara/types.mjs, so a switch-typed input and a pin-typed one are read the same way.
export const isEnumType = (type) => Boolean(type?.wrapper?.endsWith("Enum"));

// UnderlyingType on FNiagaraTypeDefinition: 1 a data interface (UClass), 2 a struct, 3 an enum.
const underlyingType = (wrapper) =>
  wrapper.endsWith("Enum") ? 3 : wrapper.endsWith(".Class") ? 1 : 2;

const f32 = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return [...b]; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v | 0); return [...b]; };

// Numbers out of a spec value: 12, "12", "0.5, 0.5", "X=1.0 Y=2.0", [1, 2, 3].
const numbers = (value, want, at) => {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").replace(/[XYZWRGBA]=/g, "").split(/[\s,]+/).filter(Boolean);
  const parsed = list.map(Number);
  if (parsed.length !== want || parsed.some((n) => !Number.isFinite(n))) {
    throw new Error(`${at}: expected ${want} number(s), got ${JSON.stringify(value)}`);
  }
  return parsed;
};

// The inverse of the VarData decoder in generate-functions.mjs: a value goes onto the clipboard
// as the raw little-endian bytes the engine stores, one array element per line.
const ENCODERS = {
  "/Script/Niagara.NiagaraFloat": (v, at) => f32(numbers(v, 1, at)[0]),
  "/Script/Niagara.NiagaraInt32": (v, at) => i32(numbers(v, 1, at)[0]),
  // A Niagara bool is a full int32 and true is every bit set -- a real capture reads
  // 255,255,255,255. Writing 1 would be a value the engine never produces.
  "/Script/Niagara.NiagaraBool": (v, at) => {
    if (v === true || String(v).trim().toLowerCase() === "true") return [255, 255, 255, 255];
    if (v === false || String(v).trim().toLowerCase() === "false") return [0, 0, 0, 0];
    throw new Error(`${at}: expected true or false, got ${JSON.stringify(v)}`);
  },
  "/Script/Niagara.NiagaraPosition": (v, at) => numbers(v, 3, at).flatMap(f32),
  "/Script/Niagara.NiagaraID": (v, at) => numbers(v, 2, at).flatMap(i32),
  "/Script/CoreUObject.Vector2f": (v, at) => numbers(v, 2, at).flatMap(f32),
  "/Script/CoreUObject.Vector3f": (v, at) => numbers(v, 3, at).flatMap(f32),
  "/Script/CoreUObject.Vector4f": (v, at) => numbers(v, 4, at).flatMap(f32),
  "/Script/CoreUObject.Quat4f": (v, at) => numbers(v, 4, at).flatMap(f32),
  "/Script/CoreUObject.LinearColor": (v, at) => numbers(v, 4, at).flatMap(f32),
};

// An enum is an int32 on the wire. A spec may write the ordinal, but the label is what the stack
// shows and what a reader can check, so it is the preferred form -- and the generated table is
// what turns one into the other.
const encodeEnum = (type, value, at) => {
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) return i32(Number(value));
  const labels = ENUMS[type.struct];
  if (!labels) {
    throw new Error(`${at}: "${value}" is a name, and there is no value table for ${type.struct}.\n`
      + "That enum is missing from niagara/ue-niagara-enums.mjs because nothing in the sweep "
      + "switches on it — write the ordinal instead, or widen the export.");
  }
  const index = labels.indexOf(String(value));
  if (index < 0) throw new Error(`${at}: "${value}" is not one of ${labels.join(", ")}`);
  return i32(index);
};

const encode = (type, value, at) => {
  if (isEnumType(type)) return encodeEnum(type, value, at);
  const encoder = ENCODERS[type.struct];
  if (!encoder) {
    throw new Error(`${at}: no encoder for ${type.struct}. A data interface or object input `
      + "cannot be written as a local value — link it instead.");
  }
  return encoder(value, at);
};

// Resolving a module row to an asset. A display name is what a stack shows and what a spec is
// naturally written with ("Spawn Burst Instantaneous"); the asset behind it is
// SpawnBurst_Instantaneous, which is the same string with the separators taken out. Comparing
// them stripped of everything but letters and digits therefore matches without reimplementing
// FName::NameToDisplayString -- and where two modules would answer to one name, the build says
// so rather than picking.
const flatten = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map();
for (const path of Object.keys(MODULES)) {
  const key = flatten(path.split("/").pop());
  BY_NAME.set(key, [...(BY_NAME.get(key) ?? []), path]);
}

export const resolveModule = (row, at) => {
  if (row.script) {
    if (!MODULES[row.script]) {
      throw new Error(`${at}: no module table entry for "${row.script}". `
        + "Regenerate with niagara/generate-modules.mjs, or check the path.");
    }
    return row.script;
  }
  const hits = BY_NAME.get(flatten(row.module ?? "")) ?? [];
  if (hits.length === 1) return hits[0];
  if (!hits.length) {
    throw new Error(`${at}: no module named "${row.module}".\n`
      + "Give it a `script` path, or regenerate the table if it is a project module.");
  }
  throw new Error(`${at}: "${row.module}" matches ${hits.length} modules — ${hits.join(", ")}.\n`
    + "Pick one with a `script` path.");
};

// A linked value is the one place a payload still needs the runtime type registry, because
// FNiagaraVariableBase carries its type as an index rather than a path. A link is only legal
// between matching types, so the index wanted is the input's own.
const linkedHandle = (struct, at) => {
  const hits = Object.entries(TYPE_INDEX).filter(([, p]) => p === struct).map(([i]) => Number(i));
  if (!hits.length) {
    throw new Error(`${at}: linking needs a RegisteredTypeIndex for ${struct}, and the sweep `
      + "never saw one. See reference/ENCODING-NIAGARA.md for how to widen it.");
  }
  return `(RegisteredTypeIndex=${Math.min(...hits)})`;
};

// One shape out of the several a spec may write an input in: `["Name", value]`,
// `["Name", { link }]`, `["Name", value, { children }]`, or the object form directly. A value
// spelled `"-> Particles.X"` is shorthand for a link in any of them. Shared with the renderer so
// the payload and the picture cannot disagree about what a row says.
export const normaliseInput = (input) => {
  const object = Array.isArray(input)
    ? (typeof input[1] === "object" && input[1] !== null
      ? { name: input[0], ...input[1], ...input[2] }
      : { name: input[0], value: input[1], ...input[2] })
    : input;
  const link = object.link
    ?? (typeof object.value === "string" && object.value.startsWith("->")
      ? object.value.slice(2).trim()
      : null);
  return { ...object, link, value: link ? undefined : object.value };
};

const CONTENT = "NiagaraClipboardContent_0";
const OUTER = `/Engine/Transient.${CONTENT}`;
const FUNCTION = "NiagaraClipboardFunction";
const INPUT = "NiagaraClipboardFunctionInput";

// Unreal writes every sub-object twice: an empty declaration pass that establishes the names and
// the nesting, then a pass that reopens each one by name to carry its properties.
const indent = (depth) => "   ".repeat(depth);

const declare = (node, depth) => [
  `${indent(depth)}Begin Object Class=/Script/NiagaraEditor.${node.cls} Name="${node.name}" `
    + `ExportPath="/Script/NiagaraEditor.${node.cls}'${node.path}'"`,
  ...node.kids.flatMap((k) => declare(k, depth + 1)),
  `${indent(depth)}End Object`,
];

const fill = (node, depth) => [
  `${indent(depth)}Begin Object Name="${node.name}" `
    + `ExportPath="/Script/NiagaraEditor.${node.cls}'${node.path}'"`,
  ...node.kids.flatMap((k) => fill(k, depth + 1)),
  ...node.props.map((p) => `${indent(depth + 1)}${p}`),
  // `Inputs` and `ChildrenInputs` reference their objects by bare name, unqualified by the
  // wrapper -- unlike a renderer's RendererProperties, which is qualified by it.
  ...node.kids.map((k, i) =>
    `${indent(depth + 1)}${node.kidsKey}(${i})="/Script/NiagaraEditor.${INPUT}'${k.name}'"`),
  `${indent(depth)}End Object`,
];

export function emitStackT3D(stage) {
  const usage = STAGE_USAGE[stage.stage];
  let seq = 0;
  const functions = [];

  for (const [i, row] of (stage.modules ?? []).entries()) {
    const at = `${stage.stage} · ${row.set ? `Set ${row.set}` : row.module ?? row.script}`;
    const base = { name: `${FUNCTION}_${i}`, cls: FUNCTION, path: `${OUTER}:${FUNCTION}_${i}`, kidsKey: "Inputs" };

    // A Set Variables row writes parameters rather than calling a script, so there is no module
    // and no input table -- but the targets still carry types, and a type here is the one thing
    // that cannot be inferred from the name. It has to be stated.
    if (row.set) {
      const targets = [row.set].flat();
      const types = row.types ?? {};
      for (const t of targets) {
        if (!types[t]) {
          throw new Error(`${at}: a Set Variables row needs the type it writes — `
            + `add \`types: { ${JSON.stringify(t)}: "float" }\` to this row.`);
        }
      }
      functions.push({
        ...base,
        props: [
          `FunctionName="${row.functionName ?? `SetVariables_${i}`}"`,
          "ScriptMode=Assignment",
          ...targets.map((t, n) => `AssignmentTargets(${n})=(Name="${t}",`
            + `TypeDefHandle=${typeDefHandle(typeOf(types[t]), at)})`),
          ...targets.map((_, n) => `AssignmentDefaults(${n})=""`),
        ],
        kids: [],
      });
      continue;
    }

    if (usage === undefined) {
      throw new Error(`${at}: "${stage.stage}" is not a stage a module can run in — expected `
        + `one of ${Object.keys(STAGE_USAGE).join(", ")}.`);
    }

    const path = resolveModule(row, at);
    const module = MODULES[path];

    // ModuleUsageBitmask is the module's own statement of where it may be placed. Checking it
    // here turns "this cannot go there" into a build error; in the editor a wrong stage is
    // simply refused, far from the spec that caused it.
    if (module.usage != null && !(module.usage & (1 << usage))) {
      const allowed = Object.entries(STAGE_USAGE)
        .filter(([, u]) => module.usage & (1 << u)).map(([s]) => s);
      throw new Error(`${at}: this module is not allowed in ${stage.stage} — its `
        + `ModuleUsageBitmask allows ${allowed.join(", ") || "no stack stage"}.`);
    }

    const byInput = new Map(module.inputs.map((p) => [p.name, p]));
    const build = (raw, parentPath) => {
      const input = normaliseInput(raw);
      const type = byInput.get(input.name);
      if (!type) {
        throw new Error(`${at}: no input named "${input.name}".\n`
          + `${path} takes ${module.inputs.map((p) => p.name).join(", ")}.`);
      }
      const spot = `${at} · ${input.name}`;
      const name = `${INPUT}_${seq++}`;
      const self = {
        name, cls: INPUT, path: `${parentPath}.${name}`, kidsKey: "ChildrenInputs",
        props: [
          `InputName="${input.name}"`,
          `InputType=(ClassStructOrEnum="${type.wrapper}'${type.struct}'",`
            + `UnderlyingType=${underlyingType(type.wrapper)})`,
          // ValueMode is absent for Local, which is the enum's zero and so the default.
          ...(input.link
            ? ["ValueMode=Linked",
              `Linked=(Name="${input.link}",TypeDefHandle=${linkedHandle(type.struct, spot)})`]
            : encode(type, input.value, spot).map((b, n) => `Local(${n})=${b}`)),
        ],
        kids: [],
      };
      // A mode input draws its dependent rows underneath it and the clipboard nests them the
      // same way -- UNiagaraStackFunctionInput::ToClipboardFunctionInput adds each child with
      // the parent input as its outer.
      self.kids = (input.children ?? []).map((c) => build(c, self.path));
      return self;
    };

    functions.push({
      ...base,
      props: [
        `FunctionName="${row.functionName ?? path.split("/").pop()}"`,
        `Script="${path}.${path.split("/").pop()}"`,
        ...(module.version ? [`ScriptVersion=${module.version}`] : []),
      ],
      kids: (row.inputs ?? []).map((raw) => build(raw, base.path)),
    });
  }

  if (!functions.length) return null;

  return [
    `Begin Object Class=/Script/NiagaraEditor.NiagaraClipboardContent Name="${CONTENT}" `
      + `ExportPath="/Script/NiagaraEditor.NiagaraClipboardContent'${OUTER}'"`,
    ...functions.flatMap((fn) => declare(fn, 1)),
    ...functions.flatMap((fn) => fill(fn, 1)),
    ...functions.map((fn, i) =>
      `   Functions(${i})="/Script/NiagaraEditor.${FUNCTION}'${fn.name}'"`),
    "End Object",
    "",
  ].join("\n");
}
