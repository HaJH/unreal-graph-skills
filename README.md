# unreal-material-graph-skill

Describe an Unreal material node network in a few lines, get back a real graph on a web page —
and the Material Editor T3D to paste straight back into Unreal.

A [Claude Code](https://claude.com/claude-code) skill. Terminal text is a poor medium for a
node network: pin-by-pin prose is slow to read and easy to get wrong. This turns a compact
spec into the same text Unreal writes when you copy nodes, renders it with blueprintue.com's
own renderer, and produces one self-contained HTML file.

[![A cooldown sweep material rendered as an Unreal node graph: TextureCoordinate through a polar-angle chain into the material output](docs/preview.png)](https://hajh.github.io/unreal-material-graph-skill/cooldown-sweep.html)

<sub>**[Open the live graph →](https://hajh.github.io/unreal-material-graph-skill/)** — pan,
zoom, go fullscreen, and copy the T3D. The still above is
[`examples/cooldown-sweep.spec.mjs`](examples/cooldown-sweep.spec.mjs), rebuilt from source on
every push.</sub>

```js
// examples/cooldown-sweep.spec.mjs, abridged
export default {
  material: "M_UI_CooldownSweep",
  title: "Cooldown Sweep",
  nodes: [
    { id: "uv", type: "TextureCoordinate" },
    { id: "half", type: "Constant2Vector", props: { R: "0.500000", G: "0.500000" } },
    { id: "centered", type: "Subtract", in: { A: "uv", B: "half" } },
    { id: "u", type: "ComponentMask", in: { Input: "centered" },
      props: { R: "True", G: "False", B: "False", A: "False" } },
    // …
    { id: "out", type: "MaterialOutputUI", in: { "Final Color": "tint", Opacity: "opacity" } },
  ],
};
```

```
node build.mjs cooldown.spec.mjs cooldown.html
  19 nodes, 52 pins, 19 wires
```

## Install

Clone into your skills directory:

```
git clone https://github.com/HaJH/unreal-material-graph-skill.git \
  ~/.claude/skills/material-graph
```

Claude picks it up on the next session. It fires on its own when a material or shader node
setup of three or more connected nodes comes up; you can also invoke it directly.

Node 18+ is the only requirement. Nothing is installed, nothing is fetched at build time.

## What you get

- **A rendered graph** — real UE node boxes, typed pins, curved wires, pan and zoom, scaled to
  fit on load.
- **Pasteable T3D** — select it, `Ctrl+C`, then `Ctrl+V` in a material. The network arrives
  with its wiring and layout intact.
- **One file, no network** — the renderer is inlined, so the page works offline and inside a
  strict CSP. Around 450 KB.

## Writing a spec

`in` maps **pin name → source**; `"node.PinName"` taps a specific output, bare `"node"` takes
the first. `props` are written verbatim into the expression, so quote the way Unreal does:
`ParameterName: '"PanSpeed"'`, floats as `"0.150000"`.

State a value **once**, in `props` — the pin's inline default is derived from it. A value lives
twice in T3D and Unreal reads the pin when pasting, so a mismatch renders fine and pastes in
wrong. The emitter refuses to emit when the two drift.

Positions are optional. Nodes are layered by distance to the output, so constants and
parameters land directly in front of whatever consumes them, and rows relax toward each node's
neighbours. Set `x`/`y` on a node to pin it.

`title`, `summary` and `height` are optional page settings — a flat, wide chain reads better
in a shorter frame than the 560px default.

Unknown node types, wires to nodes that do not exist, and pin names a node does not have all
fail the build.

## Node types

**257 expressions, generated from the engine.** `ue-material-api.mjs` is produced by
`scripts/generate-ue-api.mjs` reading an installed Unreal — pin names, pin order and output
shapes are the engine's own, not a transcription. Use the Unreal class name without the
`MaterialExpression` prefix (`Multiply`, `TextureSample`, `Fresnel`, `ComponentMask`,
`Arctangent2Fast`), plus short aliases for `Lerp`, `Dot`, `Cross`.

```
node scripts/generate-ue-api.mjs /path/to/UE_5.8
```

Re-run it when moving engine version — pin names do change between them. Substrate slabs, the
custom-output family and structural nodes are left out; they are separate subsystems with
their own wiring rules.

`Custom` is the one node with its own spec shape, since a Custom node declares its pins per
instance rather than inheriting them from its class — name the inputs and the HLSL body sees
those names. [`examples/ui-rounded-rect.spec.mjs`](examples/ui-rounded-rect.spec.mjs) uses it
for a rounded-rectangle distance field.

[`reference/ENCODING.md`](reference/ENCODING.md) documents the serialisation format, and
`reference/survey.mjs` prints the pin encoding of any Material Editor copy — useful for the
handful of nodes whose pin labels shift with their own settings.

## Examples

| | |
|---|---|
| [Cooldown Sweep](https://hajh.github.io/unreal-material-graph-skill/cooldown-sweep.html) | a clock wipe for skill icons, from the polar angle of the UV |
| [Shield Pulse](https://hajh.github.io/unreal-material-graph-skill/shield-pulse.html) | a fresnel rim modulated by a panning noise sample |
| [Dissolve with Burn Edge](https://hajh.github.io/unreal-material-graph-skill/dissolve-burn.html) | one subtraction driving both the clip mask and the glowing rim |
| [Hologram Scanlines](https://hajh.github.io/unreal-material-graph-skill/hologram-scanline.html) | scrolling scanlines and a rim, with nothing sampled |
| [Rounded Rectangle Mask](https://hajh.github.io/unreal-material-graph-skill/ui-rounded-rect.html) | a signed distance field in a `Custom` node |

## Known limits

- **Parameter nodes are titled by class, not by parameter name.** A `ScalarParameter` reads
  "ScalarParameter", not "PanSpeed". blueprintue.com behaves the same. Use a comment box when
  the name matters.
- **Inline value fields are not drawn.** The renderer disables pin inputs for material nodes,
  so a constant shows its pins but not its numbers.
- **`MaterialOutput` is display-only on paste.** Unreal allows one root per material and drops
  the pasted one; every other node still arrives.
- **No one-click copy in a Claude Artifact.** The viewer frames the page cross-origin with no
  Permissions Policy delegation, so `clipboard-write` is never granted. The button selects the
  block instead and you press `Ctrl+C`.

## Licence

MIT — see [LICENSE](LICENSE). Vendored third-party code keeps its own terms; see
[THIRD_PARTY.md](THIRD_PARTY.md).
