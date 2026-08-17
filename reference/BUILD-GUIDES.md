# Build guides — many sections, one page

A single graph is one section. A **build guide** is several: prose, an emitter stack, and as
many graphs as the effect needs — material and Niagara together, because one effect needs both.
`NS_ProjectileTrajectory` writes `Particles.FillProgress` and the ribbon material reads it back
through a dynamic parameter; split across two pages, that contract disappears from the document.

Both skills build these. `build.mjs` takes the same spec file either way.

## Shape

```js
export default {
  title: "투사체 궤적 인디케이터",
  summary: "One line under the heading.",
  eyebrow: "Unreal build guide",        // optional; defaults to this when `sections` is present

  sections: [
    { type: "prose",    heading: "…", body: "…" },
    { type: "stack",    heading: "…", emitter: "NS_X", note: "…", stages: [ … ] },
    { type: "niagara",  heading: "…", script: "SNM_X", nodes: [ … ] },
    { type: "material", heading: "…", material: "M_X", nodes: [ … ] },
  ],
};
```

A spec with no `sections` is a single graph, exactly as before — it becomes one section
internally, so nothing about the existing examples changed.

Every section takes `heading` and `body` (prose, rendered above the section's own content).
A graph section also takes `height` — a **ceiling**, not a fixed size; the panel takes the height
its own graph needs and stops there. It may also override `pasteHeading` / `pasteSub`.

All of those, along with the page's `title` and `summary`, are prose for whoever asked for the
page — write them in the language the work is happening in. The fixed chrome, the eyebrow and the
select button, stays English.

## `prose`

The smallest markdown a guide needs: paragraphs, `- ` bullets, `**bold**`, `` `code` ``, and
`[text](https://…)`. A `body` that starts with `<` is passed through as HTML instead.

## `stack`

A Niagara stack is a list, not a network — stages run top to bottom, modules in order, and an
input either holds a value or points at a parameter. There are no wires, so it is drawn as a
tree rather than sent through the graph renderer.

```js
{
  type: "stack",
  emitter: "NS_ProjectileTrajectory",
  note: "Ribbon Renderer · CPUSim",     // shown beside the name
  stages: [
    { stage: "Particle Update", modules: [
      { module: "Particle State", inputs: [
        ["Kill Particles When Lifetime Has Elapsed", "true"],
        ["Lifetime", { link: "Particles.Lifetime" }],       // drawn as → Particles.Lifetime
      ] },
      { set: "Particles.LastPulseTime" },                   // a Set Variables row
      { module: "TrajParams", scratch: true, note: "…", inputs: [
        ["Position Mode", "Direct Set", { children: [["Position Offset", "0, 0, 0"]] }],
      ] },
    ] },
  ],
}
```

- `module` names an engine or asset module; `set` names what a Set Variables row writes;
  `scratch: true` marks a scratch pad module, which the page picks out.
- An input is `["Name", value]`. A `{ link: "Particles.X" }` value draws as an arrow in the
  accent colour so a binding never reads as a literal. `"-> Particles.X"` is shorthand for the
  same. `children` nests sub-inputs, the way a mode with its own value does in the editor.
- An **enum input written as its ordinal is drawn as the name the editor draws** — `2` on
  `Position Mode` comes out as `Simulation Position`. That comes from a generated table, so an
  enum the sweep never saw is left as the number rather than relabelled on a guess.

### `paste: true` — a stack you can put back

Add `paste: true` to a stack section and each stage gains the clipboard T3D for its own modules,
drawn under that stage. Select one row in that stage of the target emitter and press Ctrl+V.

Opting in is what turns the section from a picture into a payload, and the two want different
things from a spec. A picture is happy with `["Spawn Count", "MaxTrajectoryCount ×
SegmentsPerTrajectory"]`; a payload needs a number. So a section without `paste` draws exactly as
before, and a section with it is checked to the letter:

- every module name must resolve to exactly one asset,
- every input name must exist on that module,
- every value must encode to that input's type,
- and the module must be allowed in the stage it is written under.

Any of those fails the build with the module's real input list, rather than emitting something
that pastes cleanly and quietly does nothing. That is not caution for its own sake: a paste is a
replay that matches inputs by name **and** type and silently skips the rest, so a typo is
invisible at every point after the build.

```js
{
  type: "stack", emitter: "NS_SparkBurst", paste: true,
  stages: [
    { stage: "Emitter Update", modules: [
      { module: "Emitter State", inputs: [
        ["Life Cycle Mode", "Self"],          // an enum, by the name the editor shows
        ["Loop Duration", 1.0],
      ] },
      // "Initialize Particle" names two assets — the original and the V2 rewrite — so this row
      // says which. The build lists both rather than picking.
      { script: "/Niagara/Modules/Spawn/Initialization/V2/InitializeParticle",
        module: "Initialize Particle", inputs: [["Lifetime Min", 0.4]] },
      // A Set Variables row writes a parameter rather than calling a script, and the type it
      // writes is the one thing no table can supply.
      { set: "Particles.LastPulseTime", types: { "Particles.LastPulseTime": "float" } },
    ] },
  ],
}
```

`examples/guides/spark-burst.spec.mjs` is a worked one: three stages, all three pasteable.

**Renderers are out of scope.** A Render row draws, but never carries a payload — the clipboard
puts the whole `UNiagaraRendererProperties` object in a separate `Renderers` array, and there is
no name-and-type table to check it against.

### Reading a stack off a real system

Rather than transcribing, export the system in the editor and read it:

```
node niagara/read-stack.mjs <System.T3D> [EmitterName]
```

It prints a `stages:` fragment ready to paste into a spec. It gives structure, not input values —
those live in the script's `RapidIterationParameters` as bytes at named offsets, and pairing each
block with its own data blob is fiddly enough that reading the values off the stack in the editor
is the honest route. Structure is most of what a guide is about anyway.

## `material` and `niagara`

Exactly the single-graph spec of each skill, minus the page-level keys. See each SKILL.md for the
node tables and spec details.

Two things bite in a guide page specifically:

- **A tall node breaks auto-layout.** A material `Custom` or a Niagara `CustomHlsl` prints its
  body inside the node, far below the box the layout reserves, so a neighbour lands on top of it.
  Give it its own `block`, or set `x`/`y` on the nodes around it. The projectile guide does the
  latter.
- **Keep an HLSL body ASCII.** The renderer mangles anything else when it prints the code inside
  the node. The T3D carries it fine — this is a rendering limit, not an encoding one.

Blocks are how a large graph stays readable: `block: "Tuning"` groups nodes, each block gets a
comment box drawn round it, and `layout: { laneColumns: 12 }` decides how wide the page runs
before blocks wrap to the next row. Wrapping sooner makes the nodes bigger, because the panel
scales the whole graph to its width.

## Reading reality first

The projectile guide was built from the shipped assets rather than from the written guide, and
the two disagreed: the impact point had moved from `dir * Range` to a value C++ passes in, a
straight shot had gained a faint arc, and a `LineArcRatio` input existed that the document never
mentioned. Export the assets, read them, and write the page from what is there — then the
disagreement is a finding rather than a bug you ship.
