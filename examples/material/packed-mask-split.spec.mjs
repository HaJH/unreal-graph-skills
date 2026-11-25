// One packed mask texture driving four surface inputs: AO, roughness, metallic and an emissive
// mask in R, G, B and A. A Convert breaks the float4 into four scalars, the way the editor's
// "Break Float4" does, and a blue Constant3Vector tints the emissive mask.
//
// Convert's output count is `outputCount`, not the props: the editor rebuilds its outputs from
// the length of ConvertOutputs, so the emitter pads that array to match. Only the mappings that
// differ from the default (input component 0 to output 0) are written, as a real copy does.
const TERMINAL = "(R=1.000000,G=0.150000,B=0.400000,A=1.000000)";

export default {
  material: "M_PackedMaskSplit",
  title: "Packed Mask Split",
  summary:
    "A Convert set up as Break Float4 splits one RGBA mask into four scalars; a Constant3Vector "
    + "whose alpha the pin never shows tints the emissive channel.",
  height: 640,

  nodes: [
    { id: "uv", type: "TextureCoordinate" },
    {
      id: "mask", type: "TextureSample", in: { UVs: "uv" },
      props: {
        Texture: `/Script/Engine.Texture2D'"/Engine/EngineResources/DefaultTexture.DefaultTexture"'`,
      },
    },
    {
      id: "split", type: "Convert", inputTypes: ["Vector4"], outputCount: 4,
      in: { Input: "mask.RGBA" },
      props: {
        "ConvertMappings(1)": "(InputComponentIndex=1,OutputIndex=1)",
        "ConvertMappings(2)": "(InputComponentIndex=2,OutputIndex=2)",
        "ConvertMappings(3)": "(InputComponentIndex=3,OutputIndex=3)",
        NodeName: '"Break Float4"',
      },
    },

    // The alpha is in the property and not on the rgb pin; the emitter compares only what the
    // pin shows.
    { id: "glowTint", type: "Constant3Vector",
      props: { Constant: "(R=0.000000,G=0.000000,B=1.000000,A=0.000000)" } },
    { id: "glow", type: "Multiply", in: { A: "glowTint", B: "split.Output4" } },

    { id: "outAO", type: "NamedRerouteDeclaration", name: "Out_AmbientOcclusion",
      color: TERMINAL, in: { Input: "split" } },
    { id: "outRoughness", type: "NamedRerouteDeclaration", name: "Out_Roughness",
      color: TERMINAL, in: { Input: "split.Output2" } },
    { id: "outMetallic", type: "NamedRerouteDeclaration", name: "Out_Metallic",
      color: TERMINAL, in: { Input: "split.Output3" } },
    { id: "outEmissive", type: "NamedRerouteDeclaration", name: "Out_EmissiveColor",
      color: TERMINAL, in: { Input: "glow" } },
    {
      id: "out", type: "MaterialOutput",
      in: {
        "Ambient Occlusion": "outAO",
        Roughness: "outRoughness",
        Metallic: "outMetallic",
        "Emissive Color": "outEmissive",
      },
    },
  ],
};
