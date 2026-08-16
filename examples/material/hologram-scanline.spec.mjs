// A hologram: horizontal scanlines drifting up the surface, plus a fresnel rim so the
// silhouette stays readable when the lines fall in a gap.
//
// Material Domain Surface, Blend Mode Translucent, Shading Model Unlit.
//
// The scanlines come from the V coordinate alone — scale it up and take the fractional part
// and you have a sawtooth repeating ScanDensity times down the surface. Adding Time before
// the Frac scrolls it; SmoothStep turns the ramp into a soft band instead of a hard stripe.
export default {
  material: "M_VFX_HologramScanline",
  title: "Hologram Scanlines",
  summary:
    "Scanlines from a scaled, scrolled V coordinate, softened with SmoothStep and lifted at "
    + "the silhouette by a fresnel rim. Nothing is sampled; it is all coordinate maths.",
  height: 520,

  nodes: [
    // ---- the sawtooth ----
    { id: "uv", type: "TextureCoordinate" },
    { id: "v", type: "ComponentMask", in: { Input: "uv" },
      props: { R: "False", G: "True", B: "False", A: "False" } },
    { id: "density", type: "ScalarParameter",
      props: { DefaultValue: "60.000000", ParameterName: '"ScanDensity"' } },
    { id: "scaled", type: "Multiply", in: { A: "v", B: "density" } },

    { id: "time", type: "Time" },
    { id: "speed", type: "ScalarParameter",
      props: { DefaultValue: "-1.500000", ParameterName: '"ScrollSpeed"' } },
    { id: "drift", type: "Multiply", in: { A: "time", B: "speed" } },
    { id: "shifted", type: "Add", in: { A: "scaled", B: "drift" } },
    { id: "sawtooth", type: "Frac", in: { Input: "shifted" } },

    // ---- soften the ramp into a band ----
    { id: "bandStart", type: "Constant", props: { R: "0.400000" } },
    { id: "bandEnd", type: "Constant", props: { R: "0.550000" } },
    { id: "band", type: "SmoothStep",
      in: { Min: "bandStart", Max: "bandEnd", Value: "sawtooth" } },

    // ---- rim, so the shape reads between lines ----
    { id: "rimPower", type: "ScalarParameter",
      props: { DefaultValue: "2.500000", ParameterName: '"RimPower"' } },
    { id: "rim", type: "Fresnel", in: { ExponentIn: "rimPower" } },

    { id: "combined", type: "Add", in: { A: "band", B: "rim" } },
    { id: "clamped", type: "Saturate", in: { Input: "combined" } },

    // ---- colour and strength ----
    { id: "tint", type: "VectorParameter",
      props: {
        DefaultValue: "(R=0.200000,G=0.850000,B=1.000000,A=1.000000)",
        ParameterName: '"HoloColor"',
      } },
    { id: "tinted", type: "Multiply", in: { A: "tint", B: "clamped" } },
    { id: "glow", type: "ScalarParameter",
      props: { DefaultValue: "4.000000", ParameterName: '"Glow"' } },
    { id: "emissive", type: "Multiply", in: { A: "tinted", B: "glow" } },

    { id: "alpha", type: "ScalarParameter",
      props: { DefaultValue: "0.600000", ParameterName: '"HoloOpacity"' } },
    { id: "opacity", type: "Multiply", in: { A: "clamped", B: "alpha" } },

    { id: "out", type: "MaterialOutput",
      in: { "Emissive Color": "emissive", Opacity: "opacity" } },
  ],
};
