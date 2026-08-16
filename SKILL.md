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
- `block: "Glow"` on a node puts it in a named block. Each block is laid out as its own
  horizontal band, in the order the spec first mentions it, and **gets a comment box drawn
  round it automatically** —
  which is how a large graph reads as stages rather than as one field of nodes. Colour a box
  with `blockColors: { Glow: "(R=..,G=..,B=..,A=0.400000)" }`. Nodes with no `block` share one
  unnamed band and get no box, so existing specs are unaffected. `comments` is still there for
  a box that is not a block, and takes explicit `x`/`y`/`w`/`h`.

## Available node types

**274 expressions, generated from the engine.** `ue-material-api.mjs` is produced by
`scripts/generate-ue-api.mjs` reading an installed Unreal, so every pin name, pin order and
output shape is the engine's own rather than a guess. Use the Unreal class name without the
`MaterialExpression` prefix — `Multiply`, `TextureSample`, `Fresnel`, `Panner`,
`ComponentMask`, `Arctangent2Fast`, `DepthFade`. A few short aliases exist for the names
nobody spells out: `Lerp`, `Dot`, `Cross`.

Grep `ue-material-api.mjs` when unsure — each entry lists its pins verbatim.

Output — `MaterialOutput` for a surface material, `MaterialOutputUI` for one whose domain is
User Interface (Final Color / Opacity / Opacity Mask instead of the full lit set).

`Custom` takes its own shape, because a Custom node's pins are declared per instance rather
than fixed by its class. Name the inputs and the HLSL body sees those names:

```js
{ id: "sdf", type: "Custom", desc: "RoundedRectSDF", outputType: "CMOT_Float1",
  inputs: ["UV", "Radius"], code: "float2 p = UV * 2.0 - 1.0;\n…",
  in: { UV: "uv", Radius: "radius" } }
```

The declared order is the pin order, each name must be a valid HLSL identifier, and
`outputType` is one of `CMOT_Float1` … `CMOT_Float4`. Reach for it when a few lines of HLSL
say the thing plainly and a dozen maths nodes would not — a signed distance field, say. See
`examples/ui-rounded-rect.spec.mjs`.

**Named reroutes** are how a large graph stays readable: a declaration names a value once, and
a usage picks it up anywhere with no wire drawn between them. Both ends derive their Guid from
the name, so the spec only states it.

```js
{ id: "pulseDecl", type: "NamedRerouteDeclaration", name: "Pulse", in: { Input: "sine" } },
{ id: "pulseA",    type: "NamedRerouteUsage",       of: "Pulse" },
{ id: "mul",       type: "Multiply", in: { A: "mask", B: "pulseA" } },
```

Pasting is safe in both directions — a usage looks for its declaration among the pasted
expressions first and falls back to the material, and a declaration only regenerates its Guid
when the target material already has that one, rewriting the pasted usages to match. Give a
declaration `color: "(R=..,G=..,B=..,A=1.000000)"` and every usage of it picks up the colour —
worth setting when it helps you scan, and fine to leave off. A plain `Reroute` (just `Input`)
is there too, for tidying a single wire.

A declaration terminates its chain, so auto-layout parks it in the last column; pin `x`/`y` on
declarations when the drawing matters.

**Material functions** come in two halves. `FunctionInput`/`FunctionOutput` are ordinary
expressions, so a spec emits a function's *body* like any other graph. Calling one needs
`MaterialFunctionCall`, whose pins come from the asset it points at:

```js
{ id: "space", type: "MaterialFunctionCall",
  function: "/Game/UI/MaterialFunctions/MF_UI_RectSpace",
  inputs: [["UV", "8C1D…"], ["Offset", "A430…"]],
  outputs: [["Centre", "77B2…"], ["Half", "0F19…"]],
  in: { UV: "uv", Offset: "offset" } }
```

**Build the function before the caller**, and give the ids only if you have them. Reading the
source says a wire into a call survives only while `FunctionInputs(i).ExpressionInputId`
matches the Id of the matching `FunctionInput` inside the asset — `UpdateFromFunctionResource`
resolves by that Guid alone, with no fall back to the name, and
`UMaterialExpressionFunctionInput::PostEditImport` regenerates the Id whenever a body is
pasted, so the numbers cannot be agreed in advance.

**In practice (UE 5.8) a call pasted with no ids at all kept every one of its input wires** —
naming the function and the inputs was enough. Do not lean on that: it is one engine version,
the mechanism is not the documented one, and the failure mode is a silent mis-wire. Emit the
ids when you can, and check the call's inputs after pasting either way.

The ids are not reachable from Python: `Id` on a `FunctionInput` is a bare `UPROPERTY()` and
so is `FunctionInputs` on the call, neither of which reflection exposes. Copy the function's
nodes in the editor and read the ids out of the T3D, or leave them out and verify. What *is*
scriptable is repair: `set_material_function` plus `connect_material_expressions` lets the
editor fill the ids in itself, and it resolves pins by name — note that an unnamed input pin
answers to the FName `'None'`, not to `'Input'`.

Not included: Substrate/Strata slabs, the custom-output family, and composites with their pin
bases — subgraph plumbing with its own rules.

**Regenerating:** `node scripts/generate-ue-api.mjs <engine root>`. Run it when moving to a
new engine version; pin names do change between versions.

**Hand-written overlay:** `material-nodes.mjs` adds only what the headers cannot express —
the inline literal pins (a Constant's number is not an `FExpressionInput`), TextureSample's
collapsed pins, and `pinDefaults`. A value lives *twice* in T3D, as an expression property
and as the pin's `DefaultValue`, and Unreal reads the pin when pasting, so a node whose two
copies disagree renders correctly but pastes in with the wrong number. `emitT3D` refuses to
emit when they drift.

`reference/ENCODING.md` documents the serialisation format. `node reference/survey.mjs
<file.t3d>` prints the pin encoding of any Material Editor copy — use it to check a node
whose entry is marked `pinNamesVary`, where the label depends on the node's own settings.

## Known limits

- **Node titles follow Unreal's own caption**, via a local patch to the vendored renderer
  (`vendor/PATCHES.md`). A parameter draws as its parameter name, a named reroute declaration
  as its variable, a `Custom` as its `desc`, and anything else falls back to the class name the
  way blueprintue.com does. A `NamedRerouteUsage` carries its variable in `Desc`, because its
  link to the declaration is a Guid the renderer cannot resolve on its own. **Re-vendoring
  drops the patch.**
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
| `ue-material-api.mjs` | generated pin names and output shapes, straight from the engine |
| `scripts/` | `generate-ue-api.mjs` regenerates it; `build-site.mjs` builds the Pages demo |
| `reference/` | `ENCODING.md` — the T3D format; `survey.mjs` — read a shape off a real copy |
| `examples/` | working specs; `docs/preview.png` is a headless-Chrome shot of the first |

Everything is inlined at build time because the Artifact CSP blocks every external host.
`build.mjs` refuses to build if the vendored CSS ever gains a non-`data:` `url()`.
