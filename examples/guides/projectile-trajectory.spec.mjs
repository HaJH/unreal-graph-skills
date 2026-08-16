// A build guide page: prose, the emitter stack, and the module graph inside it.
//
// Read out of the shipped asset (Content/ArenaAssets/VFX/Trajectory/NS_ProjectileTrajectory)
// rather than transcribed from the written guide, which predates a round of tuning. Where the
// two disagree the asset wins, and the difference is called out below.
export default {
  title: "투사체 궤적 인디케이터",
  summary: "고정 풀 파티클을 배열 데이터로 리본 궤적에 매핑하는 이펙트 — NS_ProjectileTrajectory.",
  eyebrow: "Unreal build guide",

  sections: [
    {
      type: "prose",
      heading: "무엇을 만드는가",
      body: `C++가 궤적 N개를 배열로 밀어 넣으면, 파티클 하나가 궤적의 한 점이 되어 리본으로 이어진다.
파티클은 죽지 않는 **고정 풀**이고, 활성 궤적 수보다 남는 파티클은 폭을 0으로 접어 숨긴다.

- 배열 데이터는 User Parameter의 Array Data Interface 5개로 들어온다
- 파티클마다 \`Particles.ID.Index\`로 자기 몫의 궤적과 구간을 계산한다
- \`Particles.RibbonID\`로 궤적을 분리해 리본이 서로 꼬이지 않게 한다`,
    },

    {
      type: "stack",
      heading: "이미터 스택",
      emitter: "NS_ProjectileTrajectory",
      note: "Ribbon Renderer · CPUSim · Fixed Bounds",
      body: `스테이지 순서와 모듈 순서는 실제 에셋에서 읽었다. \`TrajParams\`가 이 이펙트의 본체인
스크래치 패드 모듈이고, 나머지는 엔진 기본 모듈이다.`,
      stages: [
        {
          stage: "Emitter Update",
          modules: [
            { module: "Emitter State", inputs: [
              ["Life Cycle Mode", "Self"],
              ["Loop Behavior", "Infinite"],
              ["Loop Duration", "1.0"],
            ] },
            { module: "Spawn Burst Instantaneous", note: "고정 풀", inputs: [
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
            { module: "TrajParams", scratch: true, note: "스크래치 패드 — 아래 그래프",
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
      heading: "TrajParams — 스크래치 패드 모듈",
      script: "TrajParams",
      height: 820,
      layout: { laneColumns: 16 },
      body: `파티클 인덱스를 궤적 번호와 구간 비율로 쪼갠 뒤, 배열에서 그 궤적의 파라미터를 읽어
위치와 진행률을 낸다. 실제 모듈은 배열 5개를 같은 방식으로 읽는데, 아래에는 그중 둘만 두었다 —
나머지도 \`Get\` 노드 하나씩 늘어날 뿐 모양은 같다.`,
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
      heading: "M_ProjectileTrajectory — 리본 머티리얼",
      material: "M_ProjectileTrajectory",
      height: 900,
      body: `리본의 UV를 받아 코어 글로우 · 흐르는 하이라이트 · 착탄 임박 플래시를 한 번에 합성한다.
    계산은 Custom 노드 하나에 모여 있고, 그 결과 \`float2\`를 마스크로 갈라 Emissive와 Opacity로 보낸다.
    튜닝 손잡이 7개는 전부 스칼라 파라미터라 MI에서 만진다.`,
      layout: { laneColumns: 12 },

      nodes: [
        // --- 입력 ---
        { id: "uv", type: "TextureCoordinate", block: "Inputs" },
        { id: "dyn", type: "DynamicParameter", block: "Inputs" },
        { id: "fillMask", type: "ComponentMask", block: "Inputs", in: { Input: "dyn.Output" },
          props: { R: "True", G: "False", B: "False", A: "False" } },
        { id: "declFill", type: "NamedRerouteDeclaration", name: "FillProgress", block: "Inputs",
          in: { Input: "fillMask" } },

        // --- MI 손잡이 ---
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

        // --- 합성 ---
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

        // --- 색 ---
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

        // --- 출력 ---
        { id: "useEmOut", type: "NamedRerouteUsage", of: "EmissiveOutput", block: "Output" },
        { id: "useOpOut", type: "NamedRerouteUsage", of: "OpacityOutput", block: "Output" },
        { id: "out", type: "MaterialOutput", block: "Output",
          in: { "Emissive Color": "useEmOut", Opacity: "useOpOut" } },
      ],
    },

    {
      type: "prose",
      heading: "함정",
      body: `- **\`Engine.Emitter.ExecutionIndex\`를 파티클 인덱스로 쓰지 말 것.** 단일 이미터에서는 항상 0이라 전 파티클이 배열[0]만 읽는다. 파티클별 인덱스는 \`Particles.ID.Index\`다
- 리본이 꼬이면 \`Particles.RibbonID\`가 궤적별로 갈리는지부터 본다
- 남는 파티클은 \`Particles.RibbonWidth = 0\`으로 접는다 — 리본에는 Scale 0이 없다`,
    },
  ],
};
