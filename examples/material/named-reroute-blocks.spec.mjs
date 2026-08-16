// A breathing outline for a UMG widget, written the way a large graph wants to be written:
// every value that crosses a block boundary is named once and picked up by name, and each
// stage sits in its own commented block.
//
// Material Domain User Interface, Blend Mode Translucent. Put it on an Image brush with
// Draw As = Image and Tiling = No Tile, or the UVs will not be 0..1.
export default {
  material: "M_UI_BreathingOutline",
  title: "Breathing Outline",
  summary:
    "Named reroutes carry Pulse and Mask across blocks, so no wire runs the width of the "
    + "graph. Blocks draw their own comment boxes.",
  height: 720,

  nodes: [
    // ---- one sine, named once, read wherever it is wanted ----------------------------
    { id: "time", type: "Time", block: "Pulse" },
    { id: "speed", type: "ScalarParameter", block: "Pulse",
      props: { DefaultValue: "0.600000", ParameterName: '"PulseSpeed"', Group: '"Pulse"' } },
    { id: "phase", type: "ScalarParameter", block: "Pulse",
      props: { DefaultValue: "0.000000", ParameterName: '"PulsePhase"', Group: '"Pulse"' } },
    { id: "scaled", type: "Multiply", block: "Pulse", in: { A: "time", B: "speed" } },
    { id: "shifted", type: "Add", block: "Pulse", in: { A: "scaled", B: "phase" } },
    { id: "wave", type: "Sine", block: "Pulse", in: { Input: "shifted" } },
    { id: "pulseDecl", type: "NamedRerouteDeclaration", block: "Pulse",
      name: "Pulse", in: { Input: "wave" } },

    // ---- the outline itself, in real pixels --------------------------------------------
    { id: "uv", type: "TextureCoordinate", block: "Outline" },
    { id: "radius", type: "ScalarParameter", block: "Outline",
      props: { DefaultValue: "8.000000", ParameterName: '"CornerRadius"', Group: '"Shape"' } },
    { id: "thickness", type: "ScalarParameter", block: "Outline",
      props: { DefaultValue: "2.000000", ParameterName: '"Thickness"', Group: '"Shape"' } },
    {
      id: "sdf", type: "Custom", desc: "RoundedRectStroke", outputType: "CMOT_Float1",
      block: "Outline",
      inputs: ["UV", "Radius", "Thickness"],
      // 1/fwidth(UV) is the widget's pixel size, so every length below is in real pixels and
      // the antialiasing is exactly one of them wide whatever the widget's aspect.
      code: [
        "float2 size = 1.0 / max(fwidth(UV), 1e-8);",
        "float2 h = max(size * 0.5 - 2.0, 0.5);",
        "float2 p = abs((UV - 0.5) * size);",
        "float r = clamp(Radius, 0.0, min(h.x, h.y));",
        "float2 q = p - (h - r);",
        "float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;",
        "return saturate(0.5 - (abs(d) - Thickness * 0.5));",
      ].join("\n"),
      in: { UV: "uv", Radius: "radius", Thickness: "thickness" },
    },
    { id: "maskDecl", type: "NamedRerouteDeclaration", block: "Outline",
      name: "Mask", in: { Input: "sdf" } },

    // ---- compose: both inputs arrive by name, not by wire -------------------------------
    { id: "pulseUse", type: "NamedRerouteUsage", block: "Compose", of: "Pulse" },
    { id: "maskUse", type: "NamedRerouteUsage", block: "Compose", of: "Mask" },
    { id: "amount", type: "ScalarParameter", block: "Compose",
      props: { DefaultValue: "0.400000", ParameterName: '"PulseAmount"', Group: '"Pulse"' } },
    { id: "tint", type: "VectorParameter", block: "Compose",
      props: {
        DefaultValue: "(R=0.400000,G=0.800000,B=1.000000,A=1.000000)",
        ParameterName: '"OutlineColor"', Group: '"Colour"',
      } },
    { id: "one", type: "Constant", block: "Compose", props: { R: "1.000000" } },
    { id: "swing", type: "Multiply", block: "Compose", in: { A: "pulseUse", B: "amount" } },
    { id: "gain", type: "Add", block: "Compose", in: { A: "one", B: "swing" } },
    // .RGB is a masked tap: the wire carries Mask=1,MaskR=1,MaskG=1,MaskB=1 so the alpha is
    // dropped rather than riding along into a three-channel input.
    { id: "colour", type: "Multiply", block: "Compose", in: { A: "tint.RGB", B: "gain" } },
    { id: "alpha", type: "Multiply", block: "Compose", in: { A: "maskUse", B: "gain" } },
    { id: "opacity", type: "Saturate", block: "Compose", in: { Input: "alpha" } },

    { id: "out", type: "MaterialOutputUI", block: "Compose",
      in: { "Final Color": "colour", Opacity: "opacity" } },
  ],
};
