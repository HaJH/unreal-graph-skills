// A scratch pad module that pops a sprite up at birth and settles it to its base size.
//
// The shape this skill exists for: three module inputs and a particle attribute read out of the
// parameter map, a short chain of operators, one attribute written back.
export default {
  script: "SNM_PopFade",
  title: "Pop and fade",
  summary: "Scales a sprite from a birth pop down to its base size over the particle's life.",
  stage: "Particle Update",
  height: 420,

  nodes: [
    { id: "map", type: "Input" },

    { id: "get", type: "MapGet", in: { Source: "map" }, params: [
      ["Particles.NormalizedAge", "float"],
      ["Module.PopScale", "float"],
      ["Module.BaseSize", "vec2"],
    ] },

    // 1 - age, so the pop is strongest at birth and gone by death.
    { id: "falloff", type: "Op", op: "Numeric::OneMinus", in: { A: "get:Particles.NormalizedAge" } },

    // Scale that falloff by how hard the pop should hit, then bias it back to 1 at rest.
    { id: "pop", type: "Op", op: "Numeric::Mul", in: { A: "falloff", B: "get:Module.PopScale" } },
    { id: "one", type: "Op", op: "Numeric::OneMinus", in: { A: "falloff" } },
    { id: "scale", type: "Op", op: "Numeric::Add", in: { A: "one", B: "pop" } },

    { id: "size", type: "Op", op: "Numeric::Mul", in: { A: "get:Module.BaseSize", B: "scale" } },

    { id: "set", type: "MapSet",
      params: [["Particles.SpriteSize", "vec2"]],
      in: { Source: "map", "Particles.SpriteSize": "size" } },
  ],
};
