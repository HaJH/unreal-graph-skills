---
name: niagara-graph
description: Draw an Unreal Niagara script graph as a real node graph on the web instead of describing it in terminal text. Use whenever explaining a Niagara scratch pad, module script, dynamic input or function script of three or more connected nodes - Map Get/Map Set chains, operator maths on particle attributes, Custom HLSL - or when the user asks to see a Niagara graph, wants a node setup "as a picture", or asks which pins to add to a Map Get. Emits Niagara clipboard T3D, so the same output pastes straight into a script graph with Ctrl+V. Also builds multi-section build-guide pages, where the emitter stack is drawn as a list beside the graphs - reach for that when asked to write up or visualise how a whole effect is built. Not for single-node answers.
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

It also draws the emitter **stack**, as a list rather than a graph, and can emit the clipboard
payload for each stage — see [Build guides](#build-guides--more-than-one-section).

Do **not** use it for:
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
| `DataInterfaceCall` | Calls a function on a data interface — `Length`, `Get` on an Array DI. |
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

A **data interface** is read through `DataInterfaceCall`. It is the same node class as a script
call, but there is no asset to point at, so it is driven by a signature the spec states:

```js
{ id: "start", type: "DataInterfaceCall", fn: "Get",
  di: "/Script/Niagara.NiagaraDataInterfaceArrayFloat3",
  inputs: [["Index", "int"]], outputs: [["Value", "vec3"]],
  in: { "Array interface": "get:Module.Positions", Index: "traj" } }
```

The interface arrives on the first pin, named `Array interface` by default (`self` renames it).
Declare the DI's own parameter on a Map Get with an inline type:

```js
["Module.Positions", { struct: "/Script/Niagara.NiagaraDataInterfaceArrayFloat3",
                       wrapper: "/Script/CoreUObject.Class" }]
```

The registry indices for 47 data interfaces come from the generated type map, so a call emits the
same `Signature` the editor writes.

`CustomHlsl` declares its own pins, like a material `Custom` node:

```js
{ id: "remap", type: "CustomHlsl",
  inputs: [["Age", "float"], ["Sharpness", "float"]],
  outputs: [["OutAlpha", "float"]],
  code: "OutAlpha = saturate(pow(1.0 - Age, Sharpness));",
  in: { Age: "get:Particles.NormalizedAge", Sharpness: "get:Module.Sharpness" } }
```

**771 function scripts, generated from the assets.** A `FunctionCall` names the asset and
nothing else — its pins come from `niagara/ue-niagara-functions.mjs`:

```js
{ id: "slerp", type: "FunctionCall",
  function: "/Niagara/Functions/Rotation/LerpQuaternion",
  in: { "Quat A": "from", "Quat B": "to", "Lerp Factor": "t" } }
```

Pin names are the called script's own input names, verbatim — spaces included, no namespace
prefix, and whatever the asset's author typed. Grep the table for the asset path to see them;
guessing from the asset name does not work.

An unknown asset fails the build with instructions rather than emitting a wrong node. Declare
`inputs`/`outputs` by hand to override the table — the escape hatch for a script written since
the last sweep:

```js
{ id: "call", type: "FunctionCall", function: "/Game/VFX/Scripts/NM_MyModule",
  inputs: [["Amount", "float"]], outputs: [["Result", "float"]] }
```

Pin defaults are the **function's own**, decoded from the variable's stored bytes — so a call to
`Nlerp_Function` arrives with `Scale` at 1.0 rather than at the type's zero.

## Regenerating

```
node niagara/generate-ops.mjs /path/to/UE_5.8          # operators, from engine C++
```

Everything else lives in the assets, so it needs one editor step first — about 15 seconds for
roughly 950 assets — and then three offline passes over the same export:

```
# in Unreal:  exec(open('<plugin>/niagara/export-functions.py').read())
node niagara/generate-functions.mjs <export dir>       # function-call pins + the type-index map
node niagara/generate-modules.mjs   <export dir>       # module stack inputs, for the stack payload
node niagara/generate-enums.mjs     <export dir>       # enumerator display names
```

Run all four when moving engine version. Each leaves out what it cannot resolve and says so:
an op whose pins the parser cannot read, a module parameter with no type path in its own graph,
an enum nothing switches on. A gap reads as a known gap rather than a plausible wrong value.

**Type indices are generated too.** `niagara/ue-niagara-type-index.mjs` is recovered by the
same sweep, by correlating each Input node's stated index with its own pin's type path.

**They move with the engine version.** An `FNiagaraVariable` stores its type as a
runtime registry index and the T3D carries it verbatim. It is stable across editor restarts —
verified by taking the same copy twice across a restart — but a UE 5.1 capture has
`NiagaraParameterMap` at 69 where 5.8 has 95. Only `Input`, `CustomHlsl` and the
`If`/`Select`/`StaticSwitch` family need one; a Map Get → ops → Map Set graph never touches it.
The emitter throws with instructions rather than emitting a wrong index.
`reference/ENCODING-NIAGARA.md` documents how to reharvest the table.

## Build guides — more than one section

A guide for an effect is prose, an emitter stack and several graphs on one page, material and
Niagara together. Give the spec a `sections` array instead of nodes at the top level:

```js
export default {
  title: "Projectile Trajectory Indicator",
  sections: [
    { type: "prose",    heading: "What this builds", body: "…" },
    { type: "stack",    heading: "Emitter stack", emitter: "NS_X", stages: [ … ] },
    { type: "niagara",  heading: "…", script: "SNM_X", nodes: [ … ] },
    { type: "material", heading: "…", material: "M_X", nodes: [ … ] },
  ],
};
```

**This skill is written in English; the page you build is not.** `title`, `summary`, a section's
`heading` and `body`, and the `pasteHeading` / `pasteSub` overrides are author-supplied prose —
**write them in the language the user is speaking**, translating as you go. Every example here is
English so that nothing about the skill implies a language for the page; copying an example's
wording verbatim into a page for a Korean-speaking user is the mistake this note exists to
prevent. Only the fixed chrome — the eyebrow and the select button — stays English, alongside
Unreal's own names. Read the page back before publishing it.

Same `build.mjs`, same publish step. `reference/BUILD-GUIDES.md` has the section types, the
stack spec, and how to read a stack off a shipped system instead of transcribing it.
`examples/guides/projectile-trajectory.spec.mjs` is a worked one — stack, scratch pad graph and the ribbon material in one page.

### A stack you can paste back

A stack section with `paste: true` emits the emitter-stack clipboard T3D for each stage, drawn
under that stage. The reader selects one row in that stage and presses Ctrl+V.

The value is the checking, not the payload. A stack paste is a replay that matches inputs by name
**and** type and silently skips everything else, so a mistyped input name produces a payload that
pastes cleanly and leaves the row at its default, with nothing downstream able to notice. Opting
in checks every module name (against 244 modules swept from the assets), every input name and
type, every value, and whether the module is even allowed in that stage — and fails the build with
the module's real input list instead.

```js
{ type: "stack", emitter: "NS_SparkBurst", paste: true, stages: [
  { stage: "Emitter Update", modules: [
    { module: "Emitter State", inputs: [["Life Cycle Mode", "Self"], ["Loop Duration", 1.0]] },
  ] },
] }
```

Enum inputs are written by the name the editor shows (`"Self"`, `"Simulation Position"`) and
encoded to the ordinal; an ordinal written directly is drawn as the name. `examples/guides/spark-burst.spec.mjs`
is a worked one. Renderers are out of scope — a Render row draws but carries no payload.

## Known limits

- **A whole emitter cannot be copied**, even in the editor — an overview node carries only a
  system pointer and a handle GUID. A stack payload is per *stage*, which is what a real copy
  contains and what a paste expects.
- **The stack payload is verified against a capture, not round-tripped.** Its
  `SpawnBurst_Instantaneous` output is byte-identical to a real UE 5.8 copy, but a stack paste
  needs a selected row in an open emitter and cannot be driven from script, so it has not been
  proven end to end the way the graph payload has.
- **Renderers carry no payload.** The clipboard puts the whole `UNiagaraRendererProperties`
  object in a separate array, with no name-and-type table to check a spec against.
- **Seven enums used by module inputs have no label table**, because nothing in the sweep
  switches on them. Those inputs take an ordinal instead, and the build says so by name.
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
- **Keep a Custom HLSL body ASCII.** The renderer mangles non-ASCII characters when it
  prints the code inside the node. The T3D itself carries them fine, so this costs nothing but
  readable comments.
- **Fullscreen is removed when the page cannot have it.** The renderer's button calls
  `requestFullscreen()` and resizes the frame whether or not the request is granted; inside
  the artifact viewer it never is, so the frame would grow to screen height with no way back.
  The page drops the button when `document.fullscreenEnabled` is false, and keeps it where it
  works — the Pages demo, or the file opened directly.
- **No one-click copy in a Claude Artifact.** The viewer never grants `clipboard-write`, so the
  button selects the block and the reader presses Ctrl+C.

## Files

Paths are relative to the **plugin root** — two levels up from this file.

| | |
|---|---|
| `build.mjs` | CLI: spec → self-contained HTML, for both domains |
| `niagara/emit-t3d.mjs` | spec → inner node T3D → Base64 → clipboard wrapper |
| `niagara/emit-stack-t3d.mjs` | one stage of a stack spec → clipboard T3D, validated against the module table |
| `niagara/niagara-nodes.mjs` | the structural node table |
| `niagara/types.mjs` | type paths and the registry indices |
| `niagara/ue-niagara-ops.mjs` | generated operator table |
| `niagara/generate-ops.mjs` | regenerates it from an installed engine |
| `niagara/export-functions.py` | editor step: exports script and enum assets to T3D |
| `niagara/sweep.mjs` | shared reading of that export — encoding, exposed version, object bodies |
| `niagara/ue-niagara-functions.mjs` | generated function-call pin table |
| `niagara/generate-functions.mjs` | parses the export into that table and the type-index map |
| `niagara/ue-niagara-modules.mjs` | generated module stack-input table, with usage bitmask and version |
| `niagara/generate-modules.mjs` | parses the export into it |
| `niagara/ue-niagara-enums.mjs` | generated enumerator labels, in value order |
| `niagara/generate-enums.mjs` | recovers that order from static switch / select pins |
| `niagara/asset-names.mjs` | last-resort FName dump from a .uasset |
| `niagara/read-stack.mjs` | reads an emitter's stack out of an exported system, as a spec fragment |
| `lib/` | layout, GUIDs, and the guide section renderers — shared with `material-graph` |
| `reference/BUILD-GUIDES.md` | the `sections` spec: prose, stack, and graphs on one page |
| `page.template.html` | page shell, including the stage row |
| `vendor/` | bue-render (MIT) — its Niagara support is upstream, not a local patch |
| `reference/ENCODING-NIAGARA.md` | the clipboard format, verified against a real UE 5.8 copy |
| `examples/niagara/` | working specs |
| `examples/guides/` | worked build guides |
