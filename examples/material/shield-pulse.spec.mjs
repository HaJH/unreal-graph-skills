// A shield material: a fresnel rim, modulated by a panning noise sample, tinted and pushed
// into Emissive. Positions are omitted on purpose — the emitter lays the graph out from the
// wiring, so a spec only has to say what connects to what.
export default {
  material: "M_HB_ShieldPulse",
  title: "Shield Pulse",
  summary: "A fresnel rim modulated by a panning noise sample, tinted and driven into Emissive.",
  nodes: [
    { id: "uv", type: "TextureCoordinate", props: { UTiling: "3.000000", VTiling: "3.000000" } },

    {
      id: "panSpeed", type: "ScalarParameter",
      props: { DefaultValue: "0.150000", ParameterName: '"PanSpeed"' },
      values: { "Default Value": "0.15" },
    },
    { id: "pan", type: "Panner", in: { Coordinate: "uv", Speed: "panSpeed" },
      props: { SpeedX: "1.000000", SpeedY: "0.350000" } },
    {
      id: "noise", type: "TextureSample", in: { UVs: "pan" },
      props: {
        Texture: `/Script/Engine.Texture2D'"/Engine/EngineResources/DefaultTexture.DefaultTexture"'`,
        SamplerType: "SAMPLERTYPE_LinearColor",
      },
    },

    {
      id: "rimPower", type: "ScalarParameter",
      props: { DefaultValue: "4.000000", ParameterName: '"RimPower"' },
      values: { "Default Value": "4.0" },
    },
    { id: "fresnel", type: "Fresnel", in: { ExponentIn: "rimPower" } },

    // Only the red channel of the noise is needed, so tap the R output directly.
    { id: "rimNoise", type: "Multiply", in: { A: "fresnel", B: "noise.R" } },

    {
      id: "rimColor", type: "VectorParameter",
      props: {
        DefaultValue: "(R=0.080000,G=0.620000,B=1.000000,A=1.000000)",
        ParameterName: '"RimColor"',
      },
      values: { "Default Value": "(R=0.080000,G=0.620000,B=1.000000,A=1.000000)" },
    },
    { id: "tinted", type: "Multiply", in: { A: "rimColor", B: "rimNoise" } },

    {
      id: "intensity", type: "ScalarParameter",
      props: { DefaultValue: "8.000000", ParameterName: '"EmissiveIntensity"' },
      values: { "Default Value": "8.0" },
    },
    { id: "emissive", type: "Multiply", in: { A: "tinted", B: "intensity" } },

    { id: "out", type: "MaterialOutput", in: { "Emissive Color": "emissive" } },
  ],
};
