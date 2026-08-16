---
name: niagara-graph
description: Draw an Unreal Niagara script graph as a real node graph on the web instead of describing it in terminal text. Use whenever explaining a Niagara scratch pad, module script, dynamic input or function script of three or more connected nodes - Map Get/Map Set chains, operator maths on particle attributes, Custom HLSL - or when the user asks to see a Niagara graph, wants a node setup "as a picture", or asks which pins to add to a Map Get. Emits Niagara clipboard T3D, so the same output pastes straight into a script graph with Ctrl+V. Not for emitter stack or module-ordering questions, which are a list rather than a graph, and not for single-node answers.
---

# Niagara graph on the web

Terminal text is a poor medium for a node network, and Niagara suffers worse than most: prose
about a scratch pad ends up inventing a pseudo-HLSL syntax that does not exist
(`Particles.Age.Get(Age)`), when the real thing is a Map Get with a pin added. This skill turns
a compact spec into **Niagara clipboard T3D**, renders it with blueprintue.com's own renderer,
and publishes it as an artifact. The same T3D pastes into a script graph with Ctrl+V, so the
reader gets a picture *and* the real nodes — and never has to be told which pins to add.

## When to reach for it

Use it when describing a Niagara **script graph** of three or more connected nodes — scratch
pad modules, module scripts, dynamic inputs, function scripts.

Do **not** use it for:
- the emitter **stack** (which modules run in which stage, and their input values). That is a
  list, not a graph — a markdown tree says it better, and the renderer cannot draw it. Set
  `stage` on a spec to show where a module plugs in; that is as far as this skill goes.
- design questions — which emitters to split, when to use a data interface, performance. That
  is `vfx-material-advisor`.
- material graphs — that is the sibling skill, `material-graph`.

## Workflow

1. Write a spec (see below) to a `.mjs` file — the scratchpad directory is the right home.
2. `node <plugin>/build.mjs <spec.mjs> [out.html]` — the plugin root is two levels up from this
   file. `build.mjs` picks the domain off the spec's `script` key.
3. Publish `out.html` with the Artifact tool and give the user the link.

The build fails loudly on an unknown node type or op, a wire to a node that does not exist, and
a pin name the node does not have — so a green build means the graph is structurally sound.

## Spec format

```js
export default {
  script: "SNM_PopFade",            // names the T3D transient path; shown if there is no title
  title: "Pop and fade",            // page heading (optional)
  summary: "One line on what it does.",   // optional
  stage: "Particle Update",         // optional — draws the stage row above the graph
  height: 420,                      // graph frame height, default 560

  nodes: [
    { id: "map", type: "Input" },   // the parameter map every module graph starts from

    { id: "get", type: "MapGet", in: { Source: "map" }, params: [
      ["Particles.NormalizedAge", "float"],
      ["Module.PopScale", "float"],
      ["Module.BaseSize", "vec2"],
    ] },

    // "node:PinName" taps a named output; bare "node" takes the first one.
    { id: "falloff", type: "Op", op: "Numeric::OneMinus",
      in: { A: "get:Particles.NormalizedAge" } },

    { id: "set", type: "MapSet",
      params: [["Particles.SpriteSize", "vec2"]],
      in: { Source: "map", "Particles.SpriteSize": "falloff" } },
  ],
};
```

- `in` maps **pin name → source**. The source separator is a **colon**, not a dot, because
  Niagara pin names are themselves dotted: `"get:Particles.NormalizedAge"`.
- `params` declares a Map Get's or Map Set's parameter pins as `[name, type]`; a bare string
  means `float`. A Map Get's pins **are** its parameters — that is the whole point, and it is
  why the spec has to state them.
- Positions are optional; the graph is laid out by dependency depth. Set `x`/`y` to pin a node,
  `block: "Name"` to group nodes into a stage with a comment box round it.
- `stage` draws the simulation stage row. The default list is Emitter Spawn, Emitter Update,
  Particle Spawn, Particle Update, Render; naming a stage outside it (a simulation stage, an
  event handler) appends it rather than failing. Override the whole list with `stages: [...]`.

Unlike a material spec there is **no `props` and no value-drift trap** — a Niagara value lives
only on its pin, so there is nothing to keep in agreement.

## Node types

| Type | Notes |
|---|---|
| `Input` | The parameter map source. `name` defaults to `"InputMap"`. |
| `MapGet` | `Source` in; one output pin per `params` entry, each with its own default pin. |
| `MapSet` | `Source` in, `Dest` out, one input pin per `params` entry. |
| `Op` | An engine operator. `op: "Numeric::Mul"`. Pins come from the generated table. |
| `FunctionCall` | Calls a module / dynamic input / function script asset. |
| `CustomHlsl` | Inline HLSL with declared `inputs` / `outputs`. |
| `Reroute` | Tidies a single wire. `type:` sets what flows through it. |

Types are named by the short keys in `niagara/types.mjs`: `float`, `int`, `bool`, `vec2`,
`vec3`, `vec4`, `color`, `position`, `id`, `map`, `numeric`, `matrix`, `quat`.

**99 operators, generated from the engine.** `niagara/ue-niagara-ops.mjs` is produced by
`niagara/generate-ops.mjs` parsing `FNiagaraOpInfo::Init`, so pin names, order and types are the
engine's own. Grep it when unsure — each entry lists its pins verbatim. Names are the engine's:
`Numeric::Add`, `Numeric::Mul`, `Numeric::Lerp`, `Numeric::Clamp`, `Boolean::LogicAnd`,
`Vector3::Cross`. A variadic op takes `extraInputs: ["C", "D"]`.

```js
{ id: "sum", type: "Op", op: "Numeric::Add", extraInputs: ["C"],
  in: { A: "a", B: "b", C: "c" } }
```

`CustomHlsl` declares its own pins, like a material `Custom` node:

```js
{ id: "remap", type: "CustomHlsl",
  inputs: [["Age", "float"], ["Sharpness", "float"]],
  outputs: [["OutAlpha", "float"]],
  code: "OutAlpha = saturate(pow(1.0 - Age, Sharpness));",
  in: { Age: "get:Particles.NormalizedAge", Sharpness: "get:Module.Sharpness" } }
```

`FunctionCall` takes its pins from the asset it points at, so the spec states them:

```js
{ id: "lerp", type: "FunctionCall",
  function: "/Niagara/DynamicInputs/Lerp/Lerp_Float",
  inputs: [["A", "float"], ["B", "float"], ["Alpha", "float"]],
  outputs: [["Value", "float"]],
  in: { A: "lo", B: "hi", Alpha: "t" } }
```

**`FunctionCall` pin names are not yet verified against a real copy.** The engine builds them
from the called script's exposed input nodes (`UNiagaraNodeFunctionCall::AllocateDefaultPins`),
and whether a dynamic input's pins keep the `Module.` prefix has not been confirmed. The graph
renders either way; if a paste comes in unwired, copy a real call out of the editor and compare.

## Regenerating

```
node niagara/generate-ops.mjs /path/to/UE_5.8
```

Run it when moving engine version. An op whose pins the parser cannot resolve is left out and
named in the generated file's header, so a gap reads as a known gap.

**Type indices move with the engine version.** An `FNiagaraVariable` stores its type as a
runtime registry index and the T3D carries it verbatim. It is stable across editor restarts —
verified by taking the same copy twice across a restart — but a UE 5.1 capture has
`NiagaraParameterMap` at 69 where 5.8 has 95. Only `Input`, `CustomHlsl` and the
`If`/`Select`/`StaticSwitch` family need one; a Map Get → ops → Map Set graph never touches it.
The emitter throws with instructions rather than emitting a wrong index.
`reference/ENCODING-NIAGARA.md` documents how to reharvest the table.

## Known limits

- **The emitter stack is out of scope.** Copying an emitter is not possible even in the editor —
  an overview node carries only a system pointer and a handle GUID, not the emitter.
- **Output nodes cannot be pasted.** `UNiagaraNodeOutput::CanDuplicateNode()` is false, so a
  real copy never contains one and a payload must not either.
- **Script variable metadata is omitted.** Parameter descriptions and default values are carried
  by `NiagaraScriptVariable` sub-objects that this emitter leaves out; parameters themselves are
  rebuilt from the pins. Tooltips and defaults may be missing after a paste.
- **A `CustomHlsl` node draws taller than the layout assumes.** The renderer prints the HLSL
  body inside the node, and auto-layout only knows about a standard node box, so a long snippet
  can reach into the row below. Give it its own `block`, or pin `y` on the nodes beside it.
- **A pasted comment box does not drag its contents until it is reselected** — the same Slate
  behaviour `material-graph` documents.
- **No one-click copy in a Claude Artifact.** The viewer never grants `clipboard-write`, so the
  button selects the block and the reader presses Ctrl+C.

## Files

Paths are relative to the **plugin root** — two levels up from this file.

| | |
|---|---|
| `build.mjs` | CLI: spec → self-contained HTML, for both domains |
| `niagara/emit-t3d.mjs` | spec → inner node T3D → Base64 → clipboard wrapper |
| `niagara/niagara-nodes.mjs` | the structural node table |
| `niagara/types.mjs` | type paths and the registry indices |
| `niagara/ue-niagara-ops.mjs` | generated operator table |
| `niagara/generate-ops.mjs` | regenerates it from an installed engine |
| `lib/` | layout and GUIDs, shared with `material-graph` |
| `page.template.html` | page shell, including the stage row |
| `vendor/` | bue-render (MIT) — its Niagara support is upstream, not a local patch |
| `reference/ENCODING-NIAGARA.md` | the clipboard format, verified against a real UE 5.8 copy |
| `examples/niagara/` | working specs |
