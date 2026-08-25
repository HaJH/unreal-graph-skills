// A build guide page: prose, the emitter stack, and the module graph inside it.
//
// Read out of the shipped asset (Content/ArenaAssets/VFX/Trajectory/NS_ProjectileTrajectory)
// rather than transcribed from the written guide, which predates a round of tuning. Where the
// two disagree the asset wins, and the difference is called out below.
export default {
  title: "Projectile Trajectory Indicator",
  summary: "A fixed pool of particles mapped onto ribbon trajectories from array data "
    + "— NS_ProjectileTrajectory.",
  eyebrow: "Unreal build guide",

  sections: [
    {
      type: "prose",
      heading: "What this builds",
      body: `C++ pushes N trajectories in as arrays; each particle becomes one point on a
trajectory and the ribbon joins them up. The particles are a **fixed pool** that never dies,
and any left over beyond the active trajectory count are folded to zero width instead.

- The array data arrives as five Array Data Interfaces on User Parameters
- Each particle works out which trajectory and which segment is its own from \`Particles.ID.Index\`
- \`Particles.RibbonID\` keeps the trajectories apart so the ribbons cannot tangle`,
    },

    {
      type: "stack",
      heading: "Emitter stack",
      emitter: "NS_ProjectileTrajectory",
      note: "Ribbon Renderer · CPUSim · Fixed Bounds",
      body: `Stage order and module order were read off the shipped asset. \`TrajParams\` is the
scratch pad module that holds the effect itself; everything else is an engine module.`,
      stages: [
        {
          stage: "Emitter Update",
          modules: [
            { module: "Emitter State", inputs: [
              ["Life Cycle Mode", "Self"],
              ["Loop Behavior", "Infinite"],
              ["Loop Duration", "1.0"],
            ] },
            { module: "Spawn Burst Instantaneous", note: "fixed pool", inputs: [
              ["Spawn Time", "0.0"],
              ["Spawn Count", "MaxTrajectoryCount × SegmentsPerTrajectory"],
            ] },
          ],
        },
        {
          stage: "Particle Spawn",
          modules: [
            { module: "Initialize Particle", inputs: [
              ["Lifetime", "9999999"],
              ["Color", "1, 1, 1, 1"],
            ] },
          ],
        },
        {
          stage: "Particle Update",
          modules: [
            { module: "Particle State", inputs: [
              ["Kill Particles When Lifetime Has Elapsed", "true"],
              ["Lifetime", { link: "Particles.Lifetime" }],
              ["DeltaTime", { link: "Engine.DeltaTime" }],
            ] },
            { module: "TrajParams", scratch: true, note: "scratch pad — graph below",
              inputs: [
                ["LineArcRatio", "0.03"],
                ["ShapeData", { link: "User.TrajParams" }],
                ["Positions", { link: "User.TrajStart" }],
                ["Timing", { link: "User.TrajTiming" }],
                ["Colors", { link: "User.TrajColors" }],
              ] },
          ],
        },
        {
          stage: "Render",
          modules: [
            { module: "Ribbon Renderer", inputs: [
              ["Ribbon Id", { link: "Particles.RibbonID" }],
              ["Link Order", { link: "Particles.RibbonLinkOrder" }],
              ["Width", { link: "Particles.RibbonWidth" }],
              ["Material", "MI_ProjectileTrajectory_Default"],
              ["Facing", "Screen"],
            ] },
          ],
        },
      ],
    },

    {
      type: "niagara",
      heading: "TrajParams — the scratch pad module",
      script: "TrajParams",
      height: 820,
      layout: { laneColumns: 16 },
      body: `Splits the particle index into a trajectory number and a position along it, then
reads that trajectory's parameters out of the arrays to produce a position and a fill ratio. The
real module reads five arrays the same way; only two are drawn below — the rest add one \`Get\`
node each and change nothing about the shape.`,
      nodes: [
        { id: "map", type: "Input", x: 0, y: 0 },

        { id: "get", type: "MapGet", x: 280, y: 0, in: { Source: "map" }, params: [
          ["Particles.ID.Index", "int"],
          ["Engine.Time", "float"],
          ["Module.SegmentsPerTrajectory", "int"],
          ["Module.LineArcRatio", "float"],
          ["Module.Positions", { struct: "/Script/Niagara.NiagaraDataInterfaceArrayFloat3", wrapper: "/Script/CoreUObject.Class" }],
          ["Module.ShapeData", { struct: "/Script/Niagara.NiagaraDataInterfaceArrayFloat4", wrapper: "/Script/CoreUObject.Class" }],
        ] },

        // idx / K = which trajectory this particle belongs to.
        { id: "traj", type: "Op", op: "Numeric::Div", x: 820, y: 0,
          in: { A: "get:Particles.ID.Index", B: "get:Module.SegmentsPerTrajectory" } },

        // The arrays are read through the data interface, one call per value.
        { id: "count", type: "DataInterfaceCall", fn: "Length", x: 820, y: 190,
          di: "/Script/Niagara.NiagaraDataInterfaceArrayFloat3", outputs: [["Num", "int"]],
          in: { "Array interface": "get:Module.Positions" } },

        { id: "start", type: "DataInterfaceCall", fn: "Get", x: 820, y: 330,
          di: "/Script/Niagara.NiagaraDataInterfaceArrayFloat3", inputs: [["Index", "int"]], outputs: [["Value", "vec3"]],
          in: { "Array interface": "get:Module.Positions", Index: "traj" } },

        { id: "shape", type: "DataInterfaceCall", fn: "Get", x: 820, y: 500,
          di: "/Script/Niagara.NiagaraDataInterfaceArrayFloat4", inputs: [["Index", "int"]], outputs: [["Value", "vec4"]],
          in: { "Array interface": "get:Module.ShapeData", Index: "traj" } },

        { id: "curve", type: "CustomHlsl", x: 1400, y: 200,
          inputs: [["Index", "int"], ["K", "int"], ["EngineTime", "float"],
            ["LineArcRatio", "float"], ["Count", "int"], ["Start", "vec3"], ["P", "vec4"]],
          outputs: [["Pos", "vec3"], ["Fill", "float"], ["Width", "float"]],
          code: [
            "float T = (float)(Index % K) / (float)(K - 1);",
            "int traj = Index / K;",
            "if (traj >= Count) { Pos = Start; Fill = 0.0; Width = 0.0; return; }  // collapse the spare",
            "float yaw = radians(P.w);",
            "float3 endPt = float3(P.y, P.z, Start.z);   // C++ passes the impact XY in the array",
            "float3 pos = lerp(Start, endPt, T);",
            "float arcH = (P.x >= 0.5) ? P.z : (P.y * LineArcRatio);  // a Line arcs too, only faintly",
            "pos.z += 4.0 * arcH * T * (1.0 - T);",
            "Pos = pos;",
            "Fill = EngineTime;",
            "Width = 8.0;",
          ].join("\n"),
          in: {
            Index: "get:Particles.ID.Index",
            K: "get:Module.SegmentsPerTrajectory",
            EngineTime: "get:Engine.Time",
            LineArcRatio: "get:Module.LineArcRatio",
            Count: "count:Num",
            Start: "start:Value",
            P: "shape:Value",
          } },

        { id: "set", type: "MapSet", x: 2000, y: 200,
          params: [
            ["Particles.Position", "position"],
            ["Particles.RibbonID", "int"],
            ["Particles.FillProgress", "float"],
            ["Particles.RibbonWidth", "float"],
          ],
          in: {
            Source: "map",
            "Particles.RibbonID": "traj",
            "Particles.FillProgress": "curve:Fill",
            "Particles.RibbonWidth": "curve:Width",
          } },
      ],
    },

    {
      type: "material",
      heading: "M_ProjectileTrajectory — the ribbon material",
      material: "M_ProjectileTrajectory",
      height: 900,
      body: `Takes the ribbon's UV and composites the core glow, the travelling highlight and
    the about-to-land flash in one pass. The maths sits in a single Custom node, and its
    \`float2\` result is split by a mask into Emissive and Opacity. All seven tuning knobs are
    scalar parameters, so they are set on the MI.`,
      layout: { laneColumns: 12 },

      nodes: [
        // --- inputs ---
        { id: "uv", type: "TextureCoordinate", block: "Inputs" },
        { id: "dyn", type: "DynamicParameter", block: "Inputs" },
        { id: "fillMask", type: "ComponentMask", block: "Inputs", in: { Input: "dyn.Output" },
          props: { R: "True", G: "False", B: "False", A: "False" } },
        { id: "declFill", type: "NamedRerouteDeclaration", name: "FillProgress", block: "Inputs",
          in: { Input: "fillMask" } },

        // --- MI knobs ---
        { id: "sweep", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "3.000000", ParameterName: '"SweepCount"' } },
        { id: "baseOp", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "0.250000", ParameterName: '"BaseOpacity"' } },
        { id: "flowW", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "0.150000", ParameterName: '"FlowWidth"' } },
        { id: "core", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "1.500000", ParameterName: '"CoreGlow"' } },
        { id: "impT", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "0.900000", ParameterName: '"ImpactThreshold"' } },
        { id: "impB", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "0.200000", ParameterName: '"ImpactBoost"' } },
        { id: "endFade", type: "ScalarParameter", block: "Tuning",
          props: { DefaultValue: "0.400000", ParameterName: '"EndFadeStart"' } },

        // --- composite ---
        { id: "useFill", type: "NamedRerouteUsage", of: "FillProgress", block: "Composite" },
        { id: "hlsl", type: "Custom", desc: "TrajectoryShape", outputType: "CMOT_Float2",
          block: "Composite",
          inputs: ["UV", "FillProgress", "SweepCount", "BaseOpacity", "FlowWidth",
            "CoreGlow", "ImpactThreshold", "ImpactBoost", "EndFadeStart"],
          code: [
            "float U  = UV.x;                 // along the path: 0 at the socket, 1 at the impact",
            "float V  = UV.y;                 // across the ribbon, 0..1",
            "float pr = saturate(FillProgress);",
            "",
            "// core glow: brightest down the middle, transparent at the edges",
            "float core = pow(1.0 - abs(V - 0.5) * 2.0, 2.0);",
            "",
            "// travelling highlight, accelerating and brightening with FillProgress",
            "float flowPhase = frac(pr * pr * SweepCount);",
            "float d    = frac(U - flowPhase);",
            "float band = smoothstep(FlowWidth, 0.0, min(d, 1.0 - d));",
            "float hi   = band * (0.5 + pr);",
            "",
            "// wash the whole ribbon just before impact",
            "float impact = smoothstep(ImpactThreshold, 1.0, pr);",
            "float reveal = max(hi, impact);",
            "",
            "float emissiveScalar = BaseOpacity + CoreGlow * core + reveal + impact * ImpactBoost;",
            "float opacity = max(BaseOpacity, max(reveal, core * BaseOpacity));",
            "float endFade = saturate((1.0 - U) / max(1.0 - EndFadeStart, 1e-4));",
            "opacity *= endFade;",
            "return float2(emissiveScalar, opacity);",
          ].join("\n"),
          in: {
            UV: "uv", FillProgress: "useFill", SweepCount: "sweep", BaseOpacity: "baseOp",
            FlowWidth: "flowW", CoreGlow: "core", ImpactThreshold: "impT",
            ImpactBoost: "impB", EndFadeStart: "endFade",
          } },

        { id: "emMask", type: "ComponentMask", block: "Composite", in: { Input: "hlsl" },
          props: { R: "True", G: "False", B: "False", A: "False" } },
        { id: "opMask", type: "ComponentMask", block: "Composite", in: { Input: "hlsl" },
          props: { R: "False", G: "True", B: "False", A: "False" } },
        { id: "declEm", type: "NamedRerouteDeclaration", name: "EmissiveScalar", block: "Composite",
          in: { Input: "emMask" } },
        { id: "declOp", type: "NamedRerouteDeclaration", name: "Opacity", block: "Composite",
          in: { Input: "opMask" } },

        // --- colour ---
        { id: "flash", type: "VectorParameter", block: "Colour",
          props: { ParameterName: '"FlashColor"' } },
        { id: "declFlash", type: "NamedRerouteDeclaration", name: "FlashColor", block: "Colour",
          in: { Input: "flash.RGB" } },
        { id: "pcolor", type: "ParticleColor", block: "Colour" },
        { id: "useEm", type: "NamedRerouteUsage", of: "EmissiveScalar", block: "Colour" },
        { id: "tint", type: "Multiply", block: "Colour", in: { A: "pcolor.RGB", B: "useEm" } },
        { id: "declEmOut", type: "NamedRerouteDeclaration", name: "EmissiveOutput", block: "Colour",
          in: { Input: "tint" } },
        { id: "useOp", type: "NamedRerouteUsage", of: "Opacity", block: "Colour" },
        { id: "declOpOut", type: "NamedRerouteDeclaration", name: "OpacityOutput", block: "Colour",
          in: { Input: "useOp" } },

        // --- output ---
        { id: "useEmOut", type: "NamedRerouteUsage", of: "EmissiveOutput", block: "Output" },
        { id: "useOpOut", type: "NamedRerouteUsage", of: "OpacityOutput", block: "Output" },
        { id: "out", type: "MaterialOutput", block: "Output",
          in: { "Emissive Color": "useEmOut", Opacity: "useOpOut" } },
      ],
    },

    {
      type: "prose",
      heading: "Traps",
      body: `- **Do not use \`Engine.Emitter.ExecutionIndex\` as the particle index.** In a single emitter it is always 0, so every particle reads array[0]. The per-particle index is \`Particles.ID.Index\`
- If the ribbons tangle, check first that \`Particles.RibbonID\` differs per trajectory
- Fold the spare particles away with \`Particles.RibbonWidth = 0\` — a ribbon has no Scale 0`,
    },
  ],
};
