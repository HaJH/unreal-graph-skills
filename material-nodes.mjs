// Node table for the material T3D emitter.
//
// The pin names and output shapes come from ue-material-api.mjs, which is generated straight
// out of an installed engine — see scripts/generate-ue-api.mjs and reference/ENCODING.md.
// Hand-written guesses were how this table carried ten wrong output shapes and a `mask`
// category on every maths node, so nothing derivable is written here by hand.
//
// What is left below is only what the engine headers cannot express:
//   VALUE_PINS  the inline literal fields (a Constant's number is not an FExpressionInput,
//               it is a pin the graph synthesises for the property)
//   TWEAKS      collapsed pins and node-level properties
//   ALIASES     short names to reach for: Lerp, Dot, Cross, MaterialOutput
import { UE_EXPRESSIONS } from "./ue-material-api.mjs";

const fixed = (sub, value) => ({ sub, value, fixed: true });

// A value-carrying node writes its number twice: once as an expression property and once as
// the pin's DefaultValue. Unreal reads the pin when pasting, so if the two disagree the node
// arrives with the wrong value — a constant of -1 pastes in as 0. `pinDefaults` derives the
// pin text from the properties so a spec only ever states the value once.
const num = (v) => {
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return String(v);
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
};
// "(R=0.08,G=0.62,B=1.0,A=1.0)" -> "0.08,0.62,1" for the channels a node actually exposes.
const channels = (struct, count) => {
  const found = [...String(struct).matchAll(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)].map((m) => m[0]);
  return found.slice(0, count).map(num).join(",");
};

// Literal fields the Material Editor draws as a pin. They are not FExpressionInputs, so the
// generated table has no trace of them; they are always bNotConnectable.
const VALUE_PINS = {
  Constant: {
    pins: [["Value", fixed("red", "0.0")]],
    pinDefaults: (p) => ({ Value: num(p.R ?? 0) }),
  },
  Constant2Vector: {
    pins: [["X", fixed("red", "0.0")], ["Y", fixed("red", "0.0")]],
    pinDefaults: (p) => ({ X: num(p.R ?? 0), Y: num(p.G ?? 0) }),
  },
  Constant3Vector: {
    pins: [["Constant", fixed("rgb", "0.0,0.0,0.0")]],
    // The pin drops the struct wrapper for a 3-vector; the 4-vector keeps it.
    pinDefaults: (p) => ({ Constant: channels(p.Constant ?? "", 3) }),
  },
  Constant4Vector: {
    pins: [["Constant", fixed("rgba", "(R=0.000000,G=0.000000,B=0.000000,A=1.000000)")]],
    pinDefaults: (p) => ({ Constant: p.Constant }),
  },
  ScalarParameter: {
    pins: [["Default Value", fixed("red", "0.0")]],
    pinDefaults: (p) => ({ "Default Value": num(p.DefaultValue ?? 0) }),
  },
  VectorParameter: {
    pins: [["Default Value", fixed("rgba", "(R=0.000000,G=0.000000,B=0.000000,A=1.000000)")]],
    pinDefaults: (p) => ({ "Default Value": p.DefaultValue }),
  },
};

const TWEAKS = {
  TextureSample: {
    // The derivative inputs only appear in Derivative mip mode; leaving them on every node
    // would draw three pins the artist never wired.
    drop: ["MipValue", "CoordinatesDX", "CoordinatesDY"],
    rename: { AutomaticViewMipBiasValue: "Apply View MipBias" },
    append: [
      ["MipValueMode", { ...fixed("byte", "None (use computed mip level)"), advanced: true }],
      ["Sampler Source", { ...fixed("byte", "From texture asset"), advanced: true }],
      ["Sampler Type", { ...fixed("byte", "Color"), advanced: true }],
    ],
    pinOpts: { UVs: { sub: "byte", value: "0" } },
    node: { AdvancedPinDisplay: "Shown" },
  },
};

// Names worth typing, where Unreal's class name is not the one anybody uses.
const ALIASES = {
  Lerp: "LinearInterpolate",
  Dot: "DotProduct",
  Cross: "CrossProduct",
  Sine: "Sine",
  Cosine: "Cosine",
};

const build = () => {
  const nodes = {};
  for (const [short, api] of Object.entries(UE_EXPRESSIONS)) {
    const tweak = TWEAKS[short] ?? {};
    const values = VALUE_PINS[short];

    const wired = api.in
      .filter(([label]) => !(tweak.drop ?? []).includes(label))
      .map(([label, prop]) => {
        const name = tweak.rename?.[label] ?? label;
        return [name, { prop: prop ?? label, ...(tweak.pinOpts?.[name] ?? {}) }];
      });

    nodes[short] = {
      expression: `MaterialExpression${short}`,
      in: [...(values?.pins ?? []), ...wired, ...(tweak.append ?? [])],
      // [pinName] is an unmasked output; [pinName, channel] carries PinCategory="mask".
      out: api.out.map(([name, sub]) => (sub === undefined ? [name, "", { plain: true }] : [name, sub])),
      ...(values?.pinDefaults ? { pinDefaults: values.pinDefaults } : {}),
      ...(tweak.node ? { node: tweak.node } : {}),
      ...(api.renames ? { pinNamesVary: true } : {}),
    };
  }
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (nodes[target] && alias !== target) nodes[alias] = nodes[target];
  }
  return nodes;
};

export const NODES = build();

// ---- the material output ----------------------------------------------------------
// Not an expression: MaterialGraphNode_Root is the node the whole graph terminates in, and
// the renderer titles it with the material's name. Including it makes a diagram say which
// output each branch actually drives. Unreal allows only one root per material, so it is
// dropped on paste rather than duplicated — the rest of the nodes come in fine.
NODES.MaterialOutput = {
  root: true,
  in: [
    ["Base Color", {}], ["Metallic", {}], ["Specular", {}], ["Roughness", {}],
    ["Anisotropy", {}], ["Emissive Color", {}], ["Opacity", {}], ["Opacity Mask", {}],
    ["Normal", {}], ["Tangent", {}], ["World Position Offset", {}],
    ["Subsurface Color", {}], ["Ambient Occlusion", {}], ["Refraction", {}],
    ["Pixel Depth Offset", {}],
  ],
};
// A material whose domain is User Interface exposes a much smaller root: colour goes to
// Final Color rather than Emissive, and Opacity Mask only applies to a masked blend mode.
NODES.MaterialOutputUI = {
  root: true,
  in: [["Final Color", {}], ["Opacity", {}], ["Opacity Mask", {}]],
};

// ---- inline HLSL --------------------------------------------------------------------
// The one expression whose pins are not fixed by its class, so the generated entry (a single
// pin called "Input") cannot describe it: a Custom node carries an *array* of named inputs.
// The spec declares them and the pin list follows. They also live in `Inputs(i)` rather than
// in one property each, which is why the wiring is built here instead of by the default pass.
//
//   { id: "sdf", type: "Custom", desc: "RectSDF", outputType: "CMOT_Float4",
//     inputs: ["UV", "Radius"], code: "return 0;", in: { UV: "uv", Radius: "radius" } }
//
// Each name is the HLSL parameter the code sees, so it must be a valid identifier, and the
// declared order is the pin order. `desc` is the caption Unreal draws on the node; the
// renderer still titles it "Custom".
NODES.Custom = {
  expression: "MaterialExpressionCustom",
  pins: (node) => (node.inputs ?? []).map((name) => [name, {}]),
  in: [],
  out: [["Output", "", { plain: true }]],
  buildProps: (node, wiredOf) => [
    `Code="${t3dString(node.code ?? "return 0;")}"`,
    `OutputType=${node.outputType ?? "CMOT_Float1"}`,
    `Description="${node.desc ?? "Custom"}"`,
    ...(node.inputs ?? []).map((name, i) => {
      const source = wiredOf(name);
      return source
        ? `Inputs(${i})=(InputName="${name}",Input=(Expression=/Script/Engine.${source.expression}'"${source.name}"'))`
        : `Inputs(${i})=(InputName="${name}")`;
    }),
  ],
};

// Unreal's string export escapes the backslash first, then the quotes, then the line breaks —
// getting that order wrong turns a multi-line HLSL body into an unterminated property.
function t3dString(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\r\\n");
}
