// A small emitter whose stack is the point of the page, rather than a graph.
//
// `paste: true` on the stack section is what turns it from a picture into something you can put
// back into the editor: every module name, input name, type and value below is checked against
// the generated module table at build time, and one payload comes out per stage.
export default {
  title: "Spark Burst",
  summary: "One-shot spark burst — the whole emitter stack, as three pasteable stages.",

  sections: [
    {
      type: "prose",
      heading: "What this is",
      body: `A single burst of sparks that arc up, slow down and die inside a second. Nothing here
is unusual; it exists so the stack below has something honest to describe.

The interesting part is the stack itself. Each stage carries the T3D Unreal writes when you copy
that stage, so the emitter can be rebuilt by selecting one row per stage and pressing Ctrl+V —
no transcribing input names out of a screenshot.`,
    },

    {
      type: "stack",
      heading: "Emitter stack",
      emitter: "NS_SparkBurst",
      note: "Sprite Renderer · CPUSim",
      paste: true,
      body: `\`Initialize Particle\` and \`Sphere Location\` each name two modules — the original
and the V2 rewrite — so those rows state a \`script\` path outright. The build refuses to pick
for you, and says which two it found.

\`Sphere Distribution\` is written as its raw ordinal to show the other half of the same table:
the value goes into the payload as an int, and the page draws the name the editor draws.`,
      stages: [
        {
          stage: "Emitter Update",
          modules: [
            { module: "Emitter State", inputs: [
              ["Life Cycle Mode", "Self"],
              ["Loop Behavior", "Once"],
              ["Loop Duration", 1.0],
            ] },
            { module: "Spawn Burst Instantaneous", note: "the whole burst, at t=0", inputs: [
              ["Spawn Time", 0.0],
              ["Spawn Count", 48],
            ] },
          ],
        },
        {
          stage: "Particle Spawn",
          modules: [
            { script: "/Niagara/Modules/Spawn/Initialization/V2/InitializeParticle",
              module: "Initialize Particle", inputs: [
              ["Lifetime Mode", "Random"],
              ["Lifetime Min", 0.4],
              ["Lifetime Max", 0.9],
              ["Sprite Size Mode", "Uniform"],
              ["Uniform Sprite Size", 6.0],
              ["Color", "1.0, 0.55, 0.15, 1.0"],
            ] },
            { script: "/Niagara/Modules/Spawn/Location/V2/SphereLocation",
              module: "Sphere Location", note: "V2 — the name alone is ambiguous", inputs: [
                ["Sphere Radius", 12.0],
                ["Surface Only", true],
                ["Sphere Distribution", 2],
              ] },
            { module: "Add Velocity In Cone", inputs: [
              ["Velocity Strength", 300.0],
              ["Cone Angle", 35.0],
              ["Cone Axis", "0.0, 0.0, 1.0"],
              ["Cone Axis Coordinate Space", "World"],
            ] },
          ],
        },
        {
          stage: "Particle Update",
          modules: [
            { module: "Particle State", inputs: [
              ["Kill Particles When Lifetime Has Elapsed", true],
            ] },
            { module: "Gravity Force", inputs: [
              ["Gravity", "0.0, 0.0, -980.0"],
              ["Coordinate Space", "World"],
            ] },
            { module: "Drag", inputs: [
              ["Use Linear Drag", true],
              ["Drag", 1.5],
            ] },
          ],
        },
      ],
    },
  ],
};
