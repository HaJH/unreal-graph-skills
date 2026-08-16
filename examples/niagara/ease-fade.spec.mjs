// A scratch pad module that eases a particle's alpha out over its life.
//
// Shows the two things a maths-only graph cannot: a Custom HLSL node where a few lines say the
// curve plainly, and a colour rebuilt component-wise so only the alpha is touched.
export default {
  script: "SNM_EaseFade",
  title: "Ease fade",
  summary: "Eases alpha to zero over the particle's life, leaving RGB untouched.",
  stage: "Particle Update",
  height: 460,

  nodes: [
    { id: "map", type: "Input" },

    { id: "get", type: "MapGet", in: { Source: "map" }, params: [
      ["Particles.NormalizedAge", "float"],
      ["Particles.Color", "color"],
      ["Module.Sharpness", "float"],
      ["Module.HoldFraction", "float"],
    ] },

    // Hold at full alpha for a while, then ease out. Four maths nodes would say this too, and
    // say it worse.
    { id: "curve", type: "CustomHlsl",
      inputs: [["Age", "float"], ["Hold", "float"], ["Sharpness", "float"]],
      outputs: [["OutAlpha", "float"]],
      code: [
        "float t = saturate((Age - Hold) / max(1.0 - Hold, 0.0001));",
        "OutAlpha = pow(1.0 - t, max(Sharpness, 0.0001));",
      ].join("\n"),
      in: {
        Age: "get:Particles.NormalizedAge",
        Hold: "get:Module.HoldFraction",
        Sharpness: "get:Module.Sharpness",
      } },

    // Multiply the existing colour's alpha rather than replacing the colour outright, so a
    // colour module earlier in the stack still wins on RGB.
    { id: "tint", type: "Op", op: "Numeric::Mul",
      in: { A: "get:Particles.Color", B: "curve:OutAlpha" } },

    { id: "set", type: "MapSet",
      params: [["Particles.Color", "color"]],
      in: { Source: "map", "Particles.Color": "tint" } },
  ],
};
