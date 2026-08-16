// A clock-wipe cooldown overlay for a skill icon, in the MOBA idiom: the icon starts fully
// darkened and the dark wedge retreats clockwise from twelve o'clock as the cooldown runs.
//
// It is a pure overlay — no icon texture is sampled. Put this material on a widget stacked
// over the icon in UMG. Material Domain must be User Interface and Blend Mode Translucent.
//
// The mask is built from the polar angle of the UV rather than from a radius, so it covers
// the square's corners exactly as it covers its centre — no bleed, no clipped corners.
export default {
  material: "M_UI_CooldownSweep",
  title: "Cooldown Sweep",
  height: 400,
  summary:
    "A clock wipe for skill icons: the dark overlay retreats clockwise from twelve o'clock "
    + "as Progress runs 0 to 1. Drive Progress from the widget; nothing else is animated.",

  nodes: [
    // ---- centre the UVs so the angle is measured from the middle of the icon ----
    { id: "uv", type: "TextureCoordinate" },
    { id: "half", type: "Constant2Vector", props: { R: "0.500000", G: "0.500000" } },
    { id: "centered", type: "Subtract", in: { A: "uv", B: "half" } },

    // U is right-positive; V is down-positive in UMG, so flipping it gives screen-up.
    { id: "u", type: "ComponentMask", in: { Input: "centered" },
      props: { R: "True", G: "False", B: "False", A: "False" } },
    { id: "v", type: "ComponentMask", in: { Input: "centered" },
      props: { R: "False", G: "True", B: "False", A: "False" } },
    { id: "flip", type: "Constant", props: { R: "-1.000000" } },
    { id: "up", type: "Multiply", in: { A: "v", B: "flip" } },

    // ---- polar angle, normalised to turns ----
    // atan2(right, up) puts 0 at twelve o'clock and increases clockwise: exactly the sweep
    // direction a cooldown reads in. Frac folds the negative half turn back onto 0..1.
    { id: "angle", type: "Arctangent2Fast", in: { Y: "u", X: "up" } },
    { id: "tau", type: "Constant", props: { R: "6.283185" } },
    { id: "turns", type: "Divide", in: { A: "angle", B: "tau" } },
    { id: "angle01", type: "Frac", in: { Input: "turns" } },

    // ---- the wipe test ----
    // Ceil(Saturate(angle - progress)) is 1 wherever the sweep has not yet passed, and 0
    // behind it: a hard edge with no branch and no step node.
    { id: "progress", type: "ScalarParameter",
      props: { DefaultValue: "0.000000", ParameterName: '"Progress"' }, },
    { id: "ahead", type: "Subtract", in: { A: "angle01", B: "progress" } },
    { id: "clipped", type: "Saturate", in: { Input: "ahead" } },
    { id: "mask", type: "Ceil", in: { Input: "clipped" } },

    // ---- tint and strength ----
    { id: "dim", type: "ScalarParameter",
      props: { DefaultValue: "0.700000", ParameterName: '"OverlayOpacity"' }, },
    { id: "opacity", type: "Multiply", in: { A: "mask", B: "dim" } },
    { id: "tint", type: "VectorParameter",
      props: {
        DefaultValue: "(R=0.000000,G=0.000000,B=0.000000,A=1.000000)",
        ParameterName: '"OverlayColor"',
      }, },

    { id: "out", type: "MaterialOutputUI", in: { "Final Color": "tint", Opacity: "opacity" } },
  ],
};
