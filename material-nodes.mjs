// Node table for the material T3D emitter.
//
// The encoding was read off real Material Editor copies; reference/ENCODING.md documents it
// in full. The rules that hold across all of them:
//   - input pins  : PinType.PinCategory="optional"; a literal value field is bNotConnectable
//   - output pins : PinType.PinCategory="mask", and the sub-category picks the channel
//                   ("" = whole value, red/green/blue/alpha, rgba = all four)
//   - a scalar-valued expression's single output carries no category at all
//
// Per node: `expression` is the UObject class, `in` lists input pins, `out` names a shape.
// An input pin is [name, options]; options may carry
//   prop        the expression property that holds the wire — needed because the pin label
//               and the property name often differ (UVs -> Coordinates, Exp -> Exponent)
//   sub         pin sub-category, where a real copy shows one
//   value       literal shown in the pin's inline field
//   fixed       true when the pin is a value field only (bNotConnectable)
//   advanced    true when the pin lives in the collapsed section

export const OUTPUT_SHAPES = {
  // A single float: no mask category, matching MaterialExpressionConstant.
  scalar: [["Output", "", { plain: true }]],
  // Whole-value output plus per-channel taps, matching the Constant*Vector family.
  vec2: [["Output", ""], ["Output2", "red"], ["Output3", "green"]],
  vec3: [["Output", ""], ["Output2", "red"], ["Output3", "green"], ["Output4", "blue"]],
  vec4: [
    ["Output", "rgba"], ["Output2", "red"], ["Output3", "green"],
    ["Output4", "blue"], ["Output5", "alpha"],
  ],
  // Texture samplers name their outputs after the channels instead of numbering them.
  texture: [
    ["RGB", ""], ["R", "red"], ["G", "green"], ["B", "blue"], ["A", "alpha"], ["RGBA", "rgba"],
  ],
  // Most maths expressions expose one connectable result.
  value: [["Output", ""]],
};

const fixed = (sub, value) => ({ sub, value, fixed: true });
const wire = (prop) => ({ prop });

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

export const NODES = {
  // ---- constants -----------------------------------------------------------------
  Constant: {
    expression: "MaterialExpressionConstant",
    in: [["Value", fixed("red", "0.0")]], out: "scalar",
    pinDefaults: (p) => ({ Value: num(p.R ?? 0) }),
  },
  Constant2Vector: {
    expression: "MaterialExpressionConstant2Vector",
    in: [["X", fixed("red", "0.0")], ["Y", fixed("red", "0.0")]], out: "vec2",
    pinDefaults: (p) => ({ X: num(p.R ?? 0), Y: num(p.G ?? 0) }),
  },
  Constant3Vector: {
    expression: "MaterialExpressionConstant3Vector",
    in: [["Constant", fixed("rgb", "0.0,0.0,0.0")]], out: "vec3",
    // The pin drops the struct wrapper for a 3-vector; the 4-vector keeps it.
    pinDefaults: (p) => ({ Constant: channels(p.Constant ?? "", 3) }),
  },
  Constant4Vector: {
    expression: "MaterialExpressionConstant4Vector",
    in: [["Constant", fixed("rgba", "(R=0.000000,G=0.000000,B=0.000000,A=1.000000)")]], out: "vec4",
    pinDefaults: (p) => ({ Constant: p.Constant }),
  },

  // ---- parameters ----------------------------------------------------------------
  ScalarParameter: {
    expression: "MaterialExpressionScalarParameter",
    in: [["Default Value", fixed("red", "0.0")]], out: "scalar",
    pinDefaults: (p) => ({ "Default Value": num(p.DefaultValue ?? 0) }),
  },
  VectorParameter: {
    expression: "MaterialExpressionVectorParameter",
    in: [["Default Value", fixed("rgba", "(R=0.000000,G=0.000000,B=0.000000,A=1.000000)")]],
    out: "vec4",
    pinDefaults: (p) => ({ "Default Value": p.DefaultValue }),
  },

  // ---- texturing -----------------------------------------------------------------
  TextureSample: {
    expression: "MaterialExpressionTextureSample",
    in: [
      ["UVs", { prop: "Coordinates", sub: "byte", value: "0" }],
      ["Tex", { prop: "TextureObject" }],
      ["Apply View MipBias", { prop: "AutomaticViewMipBiasValue" }],
      ["MipValueMode", { ...fixed("byte", "None (use computed mip level)"), advanced: true }],
      ["Sampler Source", { ...fixed("byte", "From texture asset"), advanced: true }],
      ["Sampler Type", { ...fixed("byte", "Color"), advanced: true }],
    ],
    out: "texture",
    node: { AdvancedPinDisplay: "Shown" },
  },
  TextureCoordinate: { expression: "MaterialExpressionTextureCoordinate", in: [], out: "vec2" },
  Panner: {
    expression: "MaterialExpressionPanner",
    in: [["Coordinate", wire("Coordinate")], ["Time", wire("Time")], ["Speed", wire("Speed")]],
    out: "vec2",
  },
  Rotator: {
    expression: "MaterialExpressionRotator",
    in: [["Coordinate", wire("Coordinate")], ["Time", wire("Time")]], out: "vec2",
  },
  Time: { expression: "MaterialExpressionTime", in: [], out: "scalar" },

  // ---- arithmetic ----------------------------------------------------------------
  Add: { expression: "MaterialExpressionAdd", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Subtract: { expression: "MaterialExpressionSubtract", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Multiply: { expression: "MaterialExpressionMultiply", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Divide: { expression: "MaterialExpressionDivide", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Power: { expression: "MaterialExpressionPower", in: [["Base", wire("Base")], ["Exp", wire("Exponent")]], out: "value" },
  Fmod: { expression: "MaterialExpressionFmod", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Min: { expression: "MaterialExpressionMin", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Max: { expression: "MaterialExpressionMax", in: [["A", wire("A")], ["B", wire("B")]], out: "value" },
  Dot: { expression: "MaterialExpressionDotProduct", in: [["A", wire("A")], ["B", wire("B")]], out: "scalar" },
  Cross: { expression: "MaterialExpressionCrossProduct", in: [["A", wire("A")], ["B", wire("B")]], out: "vec3" },

  // ---- single-input maths --------------------------------------------------------
  OneMinus: { expression: "MaterialExpressionOneMinus", in: [["Input", wire("Input")]], out: "value" },
  Abs: { expression: "MaterialExpressionAbs", in: [["Input", wire("Input")]], out: "value" },
  Saturate: { expression: "MaterialExpressionSaturate", in: [["Input", wire("Input")]], out: "value" },
  Frac: { expression: "MaterialExpressionFrac", in: [["Input", wire("Input")]], out: "value" },
  Floor: { expression: "MaterialExpressionFloor", in: [["Input", wire("Input")]], out: "value" },
  Ceil: { expression: "MaterialExpressionCeil", in: [["Input", wire("Input")]], out: "value" },
  Sine: { expression: "MaterialExpressionSine", in: [["Input", wire("Input")]], out: "scalar" },
  Cosine: { expression: "MaterialExpressionCosine", in: [["Input", wire("Input")]], out: "scalar" },
  Normalize: { expression: "MaterialExpressionNormalize", in: [["VectorInput", wire("VectorInput")]], out: "value" },
  SquareRoot: { expression: "MaterialExpressionSquareRoot", in: [["Input", wire("Input")]], out: "value" },

  // atan2 of the two inputs, in radians over -PI..PI. The Fast variant is an approximation
  // and is the right default for UI, where the error is far below a pixel.
  Arctangent2: {
    expression: "MaterialExpressionArctangent2",
    in: [["Y", wire("Y")], ["X", wire("X")]], out: "scalar",
  },
  Arctangent2Fast: {
    expression: "MaterialExpressionArctangent2Fast",
    in: [["Y", wire("Y")], ["X", wire("X")]], out: "scalar",
  },

  // ---- blending and channels -----------------------------------------------------
  Lerp: {
    expression: "MaterialExpressionLinearInterpolate",
    in: [["A", wire("A")], ["B", wire("B")], ["Alpha", wire("Alpha")]], out: "value",
  },
  Clamp: {
    expression: "MaterialExpressionClamp",
    in: [["Input", wire("Input")], ["Min", wire("Min")], ["Max", wire("Max")]], out: "value",
  },
  ComponentMask: {
    expression: "MaterialExpressionComponentMask",
    in: [["Input", wire("Input")]], out: "value",
  },
  AppendVector: {
    expression: "MaterialExpressionAppendVector",
    in: [["A", wire("A")], ["B", wire("B")]], out: "value",
  },
  If: {
    expression: "MaterialExpressionIf",
    in: [
      ["A", wire("A")], ["B", wire("B")],
      ["A > B", wire("AGreaterThanB")], ["A == B", wire("AEqualsB")], ["A < B", wire("ALessThanB")],
    ],
    out: "value",
  },

  // ---- surface and scene ---------------------------------------------------------
  Fresnel: {
    expression: "MaterialExpressionFresnel",
    in: [
      ["ExponentIn", wire("ExponentIn")],
      ["BaseReflectFractionIn", wire("BaseReflectFractionIn")],
      ["Normal", wire("Normal")],
    ],
    out: "scalar",
  },
  VertexNormalWS: { expression: "MaterialExpressionVertexNormalWS", in: [], out: "vec3" },
  CameraVectorWS: { expression: "MaterialExpressionCameraVectorWS", in: [], out: "vec3" },
  WorldPosition: { expression: "MaterialExpressionWorldPosition", in: [], out: "vec3" },
  ObjectPositionWS: { expression: "MaterialExpressionObjectPositionWS", in: [], out: "vec3" },
  DepthFade: {
    expression: "MaterialExpressionDepthFade",
    in: [["Opacity", wire("InOpacity")], ["FadeDistance", wire("FadeDistance")]], out: "scalar",
  },

  // ---- the material output ---------------------------------------------------------
  // Not an expression: MaterialGraphNode_Root is the node the whole graph terminates in,
  // and the renderer titles it with the material's name. Including it makes a diagram say
  // which output each branch actually drives. Unreal allows only one root per material, so
  // it is dropped on paste rather than duplicated — the rest of the nodes come in fine.
  MaterialOutput: {
    root: true,
    in: [
      ["Base Color", {}], ["Metallic", {}], ["Specular", {}], ["Roughness", {}],
      ["Anisotropy", {}], ["Emissive Color", {}], ["Opacity", {}], ["Opacity Mask", {}],
      ["Normal", {}], ["Tangent", {}], ["World Position Offset", {}],
      ["Subsurface Color", {}], ["Ambient Occlusion", {}], ["Refraction", {}],
      ["Pixel Depth Offset", {}],
    ],
  },
  // A material whose domain is User Interface exposes a much smaller root: colour goes to
  // Final Color rather than Emissive, and Opacity Mask only applies to a masked blend mode.
  MaterialOutputUI: {
    root: true,
    in: [["Final Color", {}], ["Opacity", {}], ["Opacity Mask", {}]],
  },
};
