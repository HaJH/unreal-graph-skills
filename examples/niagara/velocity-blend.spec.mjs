// A scratch pad module that bends particle velocity towards a target direction over its life.
//
// The example that exercises FunctionCall: the pins are the called script's own input names,
// spaces and all, read off /Niagara/Functions/Math/Nlerp_Function — whose output really is
// spelled "Ouput" in the engine.
export default {
  script: "SNM_VelocityBlend",
  title: "Velocity blend",
  summary: "Turns particle velocity towards a target direction, with the turn easing off over life.",
  stage: "Particle Update",
  height: 420,

  nodes: [
    { id: "map", type: "Input" },

    { id: "get", type: "MapGet", in: { Source: "map" }, params: [
      ["Particles.Velocity", "vec3"],
      ["Particles.NormalizedAge", "float"],
      ["Module.TargetDirection", "vec3"],
      ["Module.TurnStrength", "float"],
    ] },

    // Turn hardest at birth and taper off, so the arc settles instead of curving forever.
    { id: "falloff", type: "Op", op: "Numeric::OneMinus", in: { A: "get:Particles.NormalizedAge" } },
    { id: "alpha", type: "Op", op: "Numeric::Mul",
      in: { A: "falloff", B: "get:Module.TurnStrength" } },

    // Normalised lerp keeps the blend on the unit sphere, so speed comes from Scale alone.
    { id: "blend", type: "FunctionCall",
      function: "/Niagara/Functions/Math/Nlerp_Function",
      inputs: [["Vector A", "vec3"], ["Vector B", "vec3"], ["Alpha", "float"], ["Scale", "float"]],
      outputs: [["Ouput", "vec3"]],
      in: {
        "Vector A": "get:Particles.Velocity",
        "Vector B": "get:Module.TargetDirection",
        Alpha: "alpha",
      } },

    { id: "set", type: "MapSet",
      params: [["Particles.Velocity", "vec3"]],
      in: { Source: "map", "Particles.Velocity": "blend" } },
  ],
};
