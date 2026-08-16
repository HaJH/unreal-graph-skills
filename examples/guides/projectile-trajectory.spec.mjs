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
      height: 460,
      body: `파티클 인덱스를 궤적 번호와 구간 비율로 쪼갠 뒤, 궤적 파라미터를 받아 위치와 진행률을 낸다.
**아래는 골격이다** — 실제 모듈은 여기에 Array Data Interface 읽기 6회(\`Length\`, \`Get\` ×5)가
붙어 \`Start\`·\`P\`·\`P2\`·\`Tm\`을 채운다. 그 호출은 에셋 스크립트가 아니라 DI 함수라서 아직 스펙으로
표현할 수 없다.`,
      pasteSub: "이 골격은 스크래치 패드에 그대로 붙는다. Array DI 읽기는 붙여넣은 뒤 손으로 잇는다.",
      nodes: [
        { id: "map", type: "Input" },

        { id: "get", type: "MapGet", in: { Source: "map" }, params: [
          ["Particles.ID.Index", "int"],
          ["Engine.Time", "float"],
          ["Module.SegmentsPerTrajectory", "int"],
          ["Module.LineArcRatio", "float"],
        ] },

        // idx / K = 궤적 번호, (idx % K) / (K-1) = 구간 비율
        { id: "traj", type: "Op", op: "Numeric::Div",
          in: { A: "get:Particles.ID.Index", B: "get:Module.SegmentsPerTrajectory" } },

        { id: "curve", type: "CustomHlsl",
          inputs: [["Index", "int"], ["K", "int"], ["EngineTime", "float"], ["LineArcRatio", "float"]],
          outputs: [["Pos", "vec3"], ["Fill", "float"], ["Width", "float"]],
          code: [
            "// Start / P / P2 / Tm 은 Array DI Get 으로 채운다 (골격에서는 생략)",
            "float T = (float)(Index % K) / (float)(K - 1);",
            "float yaw = radians(P.w);",
            "float groundZ = Start.z - P2.x;",
            "float3 endPt = float3(P2.y, P2.z, groundZ);   // C++가 착탄 XY를 TrajParams2.yz로 전달",
            "float3 pos = lerp(Start, endPt, T);",
            "float arcH = (P.x >= 0.5) ? P.z : (P.y * LineArcRatio);  // Line도 미세 아크",
            "pos.z += 4.0 * arcH * T * (1.0 - T);",
            "Pos = pos;",
            "Fill = (EngineTime - Tm.x) / max(Tm.y, 1e-3f);",
            "Width = 8.0;",
          ].join("\n"),
          in: {
            Index: "get:Particles.ID.Index",
            K: "get:Module.SegmentsPerTrajectory",
            EngineTime: "get:Engine.Time",
            LineArcRatio: "get:Module.LineArcRatio",
          } },

        { id: "set", type: "MapSet",
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
      type: "prose",
      heading: "함정",
      body: `- **\`Engine.Emitter.ExecutionIndex\`를 파티클 인덱스로 쓰지 말 것.** 단일 이미터에서는 항상 0이라 전 파티클이 배열[0]만 읽는다. 파티클별 인덱스는 \`Particles.ID.Index\`다
- 리본이 꼬이면 \`Particles.RibbonID\`가 궤적별로 갈리는지부터 본다
- 남는 파티클은 \`Particles.RibbonWidth = 0\`으로 접는다 — 리본에는 Scale 0이 없다`,
    },
  ],
};
