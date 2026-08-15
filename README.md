# unreal-material-graph-skill

Describe an Unreal material node network in a few lines, get back a real graph on a web page —
and the Material Editor T3D to paste straight back into Unreal.

A [Claude Code](https://claude.com/claude-code) skill. Terminal text is a poor medium for a
node network: pin-by-pin prose is slow to read and easy to get wrong. This turns a compact
spec into the same text Unreal writes when you copy nodes, renders it with blueprintue.com's
own renderer, and produces one self-contained HTML file.

```js
// cooldown.spec.mjs
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
  19 nodes, 53 pins, 19 wires
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

Unknown node types, wires to nodes that do not exist, and pin names a node does not have all
fail the build.

## Node types

Constants and parameters, texturing and UVs, ~20 maths nodes, blending and channels, surface
and scene, and both material outputs — 46 in all. `SKILL.md` lists them; `material-nodes.mjs`
is the table.

Adding one is a table entry. [`reference/ENCODING.md`](reference/ENCODING.md) documents the
serialisation format, and `reference/survey.mjs` prints the pin encoding of any Material Editor
copy you feed it — enough to write the entry from.

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
