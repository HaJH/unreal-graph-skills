// A rounded-rectangle mask for UI, with the corner maths in a Custom HLSL node.
//
// Material Domain User Interface, Blend Mode Translucent.
//
// A signed distance field is the honest tool here: it gives the distance to the shape's edge
// in UV units, so one Divide by the softness turns it into an antialiased mask that stays
// crisp at any widget size. Building the same thing out of Abs/Max/Subtract nodes takes a
// dozen of them and reads like nothing in particular.
export default {
  material: "M_UI_RoundedRect",
  title: "Rounded Rectangle Mask",
  summary:
    "A signed distance field in a Custom node, divided by an edge-softness parameter to give "
    + "an antialiased corner that holds up at any widget size.",
  height: 420,

  nodes: [
    { id: "uv", type: "TextureCoordinate" },
    { id: "radius", type: "ScalarParameter",
      props: { DefaultValue: "0.150000", ParameterName: '"CornerRadius"' } },

    // Inputs are named here, and those names are what the HLSL body sees.
    {
      id: "sdf", type: "Custom",
      desc: "RoundedRectSDF",
      outputType: "CMOT_Float1",
      inputs: ["UV", "Radius"],
      code: [
        "// Centre the UV, then measure to the inset box and add the corner radius back.",
        "float2 p = UV * 2.0 - 1.0;",
        "float2 d = abs(p) - (1.0 - Radius);",
        "return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - Radius;",
      ].join("\n"),
      in: { UV: "uv", Radius: "radius" },
    },

    // Distance -> coverage. Dividing by the softness is what makes the edge antialiased
    // rather than a hard step.
    { id: "softness", type: "ScalarParameter",
      props: { DefaultValue: "0.010000", ParameterName: '"EdgeSoftness"' } },
    { id: "scaled", type: "Divide", in: { A: "sdf", B: "softness" } },
    { id: "clipped", type: "Saturate", in: { Input: "scaled" } },
    { id: "mask", type: "OneMinus", in: { Input: "clipped" } },

    { id: "tint", type: "VectorParameter",
      props: {
        DefaultValue: "(R=0.070000,G=0.090000,B=0.130000,A=1.000000)",
        ParameterName: '"FillColor"',
      } },
    { id: "alpha", type: "ScalarParameter",
      props: { DefaultValue: "0.900000", ParameterName: '"FillOpacity"' } },
    { id: "opacity", type: "Multiply", in: { A: "mask", B: "alpha" } },

    { id: "out", type: "MaterialOutputUI",
      in: { "Final Color": "tint", Opacity: "opacity" } },
  ],
};
