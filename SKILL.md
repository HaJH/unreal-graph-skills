---
name: material-graph
description: Draw an Unreal material/shader node setup as a real node graph on the web instead of describing it in terminal text. Use whenever explaining a material or shader node network of three or more connected nodes - Fresnel rims, dissolves, panners, UV tricks, masks, blends - or when the user asks to see a material graph, wants a node setup "as a picture", or asks how nodes are wired. Emits Material Editor T3D, so the same output pastes straight into Unreal with Ctrl+V. Not for single-node answers or pure parameter questions.
---

# Material graph on the web

Terminal text is a poor medium for a node network: pin-by-pin prose is slow to read and
easy to get wrong. This skill turns a compact spec into **Material Editor T3D**, renders it
with blueprintue.com's own renderer, and publishes it as an artifact. The same T3D pastes
into Unreal with Ctrl+V, so the reader gets a picture *and* the real nodes.

## When to reach for it

Use it when describing a material/shader node setup of **three or more connected nodes**.
Skip it for a single node, a parameter value question, or a conceptual answer with no wiring.

## Workflow

1. Write a spec (see below) to a `.mjs` file — the scratchpad directory is the right home.
2. `node <skill>/build.mjs <spec.mjs> [out.html]`
3. Publish `out.html` with the Artifact tool and give the user the link.

The build fails loudly on an unknown node type, a wire to a node that does not exist, or a
pin name the node does not have — so a green build means the graph is structurally sound.

## Spec format

```js
export default {
  material: "M_HB_ShieldPulse",     // names the output node; also the T3D transient path
  title: "Shield Pulse",            // page heading  (optional, defaults to `material`)
  summary: "One line on what it does.",  // optional
  height: 400,                      // graph frame height, default 560 — drop it for a
                                    // flat, wide chain so the nodes are not scaled away
  nodes: [
    { id: "uv", type: "TextureCoordinate", props: { UTiling: "3.000000" } },

    { id: "speed", type: "ScalarParameter",
      props: { DefaultValue: "0.150000", ParameterName: '"PanSpeed"' } },

    { id: "pan", type: "Panner", in: { Coordinate: "uv", Speed: "speed" } },

    // "node.PinName" taps a specific output; bare "node" takes the first one.
    { id: "mul", type: "Multiply", in: { A: "fresnel", B: "noise.R" } },

    { id: "out", type: "MaterialOutput", in: { "Emissive Color": "mul" } },
  ],
  comments: [{ text: "Panning noise", x: 0, y: 0, w: 800, h: 300 }],  // optional
};
```

- `in` maps **pin name → source**. Pin names are the ones in `material-nodes.mjs`.
- `props` are written verbatim into the expression object, so quote strings the way Unreal
  does: `ParameterName: '"PanSpeed"'`, floats as `"0.150000"`.
- State a value **once**, in `props`. The pin's inline `DefaultValue` is derived from it, so
  the two halves Unreal reads can never drift apart. `values` overrides a single pin's text
  and is rarely needed — reach for it only when a pin must show something other than the
  property, never to restate the same number.
- Positions are optional. Without them the emitter lays the graph out by dependency depth
  and relaxes rows toward each node's neighbours. Set `x`/`y` on a node to pin it.

## Available node types

Constants and parameters — `Constant`, `Constant2Vector`, `Constant3Vector`,
`Constant4Vector`, `ScalarParameter`, `VectorParameter`.

Texturing and UVs — `TextureSample`, `TextureCoordinate`, `Panner`, `Rotator`, `Time`.

Maths — `Add`, `Subtract`, `Multiply`, `Divide`, `Power`, `Fmod`, `Min`, `Max`, `Dot`,
`Cross`, `OneMinus`, `Abs`, `Saturate`, `Frac`, `Floor`, `Ceil`, `Sine`, `Cosine`,
`Normalize`, `SquareRoot`, `Arctangent2`, `Arctangent2Fast`.

`Arctangent2*` takes `Y` and `X` and returns radians over -PI..PI — the basis for any radial
sweep. Use the `Fast` variant for UI, where the approximation error is well under a pixel.

Blending and channels — `Lerp`, `Clamp`, `ComponentMask`, `AppendVector`, `If`.

Surface and scene — `Fresnel`, `VertexNormalWS`, `CameraVectorWS`, `WorldPosition`,
`ObjectPositionWS`, `DepthFade`.

Output — `MaterialOutput` for a surface material, `MaterialOutputUI` for one whose domain is
User Interface (Final Color / Opacity / Opacity Mask instead of the full lit set).

**Adding one:** append to `NODES` in `material-nodes.mjs`. An input pin needs `prop` — the
expression property that carries the wire — because the pin label and the property name
often differ (`UVs` → `Coordinates`, `Exp` → `Exponent`). Pick an `out` shape from
`OUTPUT_SHAPES`. If the node carries a literal value, give it `pinDefaults` as well: a value
lives *twice* in T3D, as an expression property and as the pin's `DefaultValue`, and Unreal
reads the pin when pasting — so a node whose two copies disagree renders correctly but pastes
in with the wrong number. `emitT3D` refuses to emit when they drift.

`reference/ENCODING.md` documents the serialisation format the table encodes. To read a shape
off a real node, add it in the Material Editor, wire its inputs, copy it, save the clipboard to
a file, and run `node reference/survey.mjs <file.t3d>` — the output is shaped like a `NODES`
entry.

## Known limits

- **Parameter nodes are titled by class, not by parameter name.** A `ScalarParameter` reads
  "ScalarParameter", not "PanSpeed". The renderer titles material nodes from the expression
  class; blueprintue.com behaves the same. Put the name in a `comments` box when it matters.
- **Inline value fields are not drawn.** bue-render disables pin inputs for material nodes,
  so a constant shows its pins but not its numbers.
- **`MaterialOutput` is display-only on paste.** Unreal allows one root per material and
  drops the pasted one; every other node still comes in.
- **One-click copy is impossible in an artifact.** The viewer frames the page cross-origin
  with `sandbox="allow-scripts allow-same-origin allow-forms"` and no `allow` attribute, so
  `clipboard-write` is never delegated and `navigator.clipboard.writeText()` always rejects.
  The button therefore selects the block — which needs no permission — and the reader presses
  Ctrl+C. Do not "fix" it by reaching for the Clipboard API again.
- The renderer's own toolbar offers an export button that does nothing inside an artifact —
  the viewer sandbox blocks downloads. Harmless, but do not point users at it.

## Files

| | |
|---|---|
| `build.mjs` | CLI: spec → self-contained HTML |
| `emit-t3d.mjs` | spec → T3D, including layout, GUIDs and `LinkedTo` wiring |
| `material-nodes.mjs` | the node table |
| `page.template.html` | page shell; graph panel stays in the engine's dark palette |
| `vendor/` | bue-render (MIT, from blueprintue-self-hosted-edition) |
| `reference/` | `ENCODING.md` — the T3D format; `survey.mjs` — read a shape off a real copy |
| `examples/` | working specs; `docs/preview.png` is a headless-Chrome shot of the first |

Everything is inlined at build time because the Artifact CSP blocks every external host.
`build.mjs` refuses to build if the vendored CSS ever gains a non-`data:` `url()`.
