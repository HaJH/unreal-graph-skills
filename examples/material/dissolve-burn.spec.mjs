// A dissolve that burns at the edge: the surface is clipped away where a noise texture falls
// below a threshold, and the thin band still on the brink glows.
//
// Material Domain Surface, Blend Mode Masked. Drive DissolveAmount 0 -> 1.
//
// The trick is that one subtraction feeds both masks. `ahead` is how far each pixel is from
// being clipped; thresholding it at 0 gives the surface, thresholding it again a little
// further along gives everything except a band, and the difference between the two *is* the
// band. No second noise sample, no distance field.
export default {
  material: "M_VFX_DissolveBurn",
  title: "Dissolve with Burn Edge",
  summary:
    "A noise-driven dissolve whose leading edge glows. One subtraction drives both the clip "
    + "mask and the burn band, so the band tracks the dissolve for free.",
  height: 480,

  nodes: [
    { id: "uv", type: "TextureCoordinate", props: { UTiling: "2.000000", VTiling: "2.000000" } },
    {
      id: "noise", type: "TextureSample", in: { UVs: "uv" },
      props: {
        Texture: `/Script/Engine.Texture2D'"/Engine/EngineResources/DefaultTexture.DefaultTexture"'`,
        SamplerType: "SAMPLERTYPE_LinearColor",
      },
    },

    // ---- how far each pixel is from being clipped ----
    { id: "amount", type: "ScalarParameter",
      props: { DefaultValue: "0.000000", ParameterName: '"DissolveAmount"' } },
    { id: "ahead", type: "Subtract", in: { A: "noise.R", B: "amount" } },

    // ---- the surface that survives ----
    { id: "clipped", type: "Saturate", in: { Input: "ahead" } },
    { id: "mask", type: "Ceil", in: { Input: "clipped" } },

    // ---- the same test again, further along ----
    { id: "width", type: "ScalarParameter",
      props: { DefaultValue: "0.080000", ParameterName: '"EdgeWidth"' } },
    { id: "inner", type: "Subtract", in: { A: "ahead", B: "width" } },
    { id: "innerClipped", type: "Saturate", in: { Input: "inner" } },
    { id: "innerMask", type: "Ceil", in: { Input: "innerClipped" } },

    // Surface minus interior leaves only the rim about to go.
    { id: "edge", type: "Subtract", in: { A: "mask", B: "innerMask" } },

    // ---- the glow ----
    { id: "burn", type: "VectorParameter",
      props: {
        DefaultValue: "(R=1.000000,G=0.350000,B=0.050000,A=1.000000)",
        ParameterName: '"BurnColor"',
      } },
    { id: "tinted", type: "Multiply", in: { A: "burn", B: "edge" } },
    { id: "intensity", type: "ScalarParameter",
      props: { DefaultValue: "12.000000", ParameterName: '"BurnIntensity"' } },
    { id: "emissive", type: "Multiply", in: { A: "tinted", B: "intensity" } },

    { id: "out", type: "MaterialOutput",
      in: { "Opacity Mask": "mask", "Emissive Color": "emissive" } },
  ],
};
