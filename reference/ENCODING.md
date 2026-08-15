# How Unreal serialises a material node

Everything here was read off real Material Editor copies — select nodes in a material, press
Ctrl+C, paste into a text editor, and this is what you get. The emitter reproduces it; this
document is the reference for extending the node table.

## Node shape

A material node is a `MaterialGraphNode` wrapper holding the expression itself. The expression
object appears **twice**: once declared empty, once populated. Unreal writes it that way so
references can resolve before the properties that use them are read.

```
Begin Object Class=/Script/UnrealEd.MaterialGraphNode Name="MaterialGraphNode_40" ExportPath=...
   Begin Object Class=/Script/Engine.MaterialExpressionConstant3Vector Name="…_1" ExportPath=...
   End Object
   Begin Object Name="…_1" ExportPath=...
      Constant=(R=0.004320,G=123.199997,B=7657650176.000000,A=0.000000)
      MaterialExpressionEditorX=-2592
      MaterialExpressionEditorY=-688
      MaterialExpressionGuid=6854D92803B449F79902FC5BE6D244F9
      Material=/Script/UnrealEd.PreviewMaterial'"/Engine/Transient.M_Brick_Cut_Stone"'
   End Object
   MaterialExpression=/Script/Engine.MaterialExpressionConstant3Vector'"…_1"'
   NodePosX=-2592
   NodePosY=-688
   NodeGuid=A166C6EF5D5D4C298F8549BFCD353E30
   CustomProperties Pin (…)
   CustomProperties Pin (…)
End Object
```

**Position is stored twice** — `NodePosX/Y` on the graph node and `MaterialExpressionEditorX/Y`
on the expression. Write both, and write them equal. If they disagree the graph draws in one
place while the editor's scroll bounds are computed somewhere else entirely.

GUIDs are 32 uppercase hex characters, no dashes.

## Pins

Pins are explicit `CustomProperties Pin (...)` lines — the renderer and the editor both take
the pin list at face value rather than deriving it from the expression class.

**Inputs** carry `PinType.PinCategory="optional"`. The sub-category hints at the value type
(`red` for a scalar, `rgb`, `rgba`, `byte` for an enum or UV index; empty when untyped).
A pin that is a literal value field rather than a socket sets `bNotConnectable=True`, and one
in the collapsed section sets `bAdvancedView=True` (the node then also needs
`AdvancedPinDisplay=Shown`).

**Outputs** add `Direction="EGPD_Output"` and use `PinType.PinCategory="mask"`, where the
sub-category selects the channel:

| sub-category | meaning |
|---|---|
| *(empty)* | the whole value |
| `red` `green` `blue` `alpha` | one channel |
| `rgba` | all four |

Numbered outputs (`Output`, `Output2`, …) are the Constant\*Vector convention; `TextureSample`
instead names them after the channels (`RGB`, `R`, `G`, `B`, `A`, `RGBA`). A scalar-valued
expression is the exception: its single `Output` carries **no** category at all.

Every pin also gets `PinFriendlyName=NSLOCTEXT("MaterialGraphNode", "Space", " ")` on outputs,
and the long tail of `PinType.*` booleans, all `False` in practice.

## Links

A wire is written on **both** ends, as `LinkedTo=(<NodeName> <PinId>,)` inside each pin. One
output feeding two inputs lists both peers in its own `LinkedTo` and appears once in each
target's. Miss an end and the editor drops the connection.

## The value trap

A value-carrying node states its number **twice**: as an expression property (`R=-1.000000`)
and as the pin's inline `DefaultValue`. **Unreal reads the pin when pasting.** If the two
disagree the graph renders correctly and pastes in wrong — a constant of -1 arrives as 0,
while still displaying "-1.0" as its title, because the title comes from the property.

The formats differ per node, which is what makes this easy to get wrong:

| node | property | pin DefaultValue |
|---|---|---|
| `Constant` | `R=10000.000000` | `"10000.0"` |
| `Constant2Vector` | `R=…`, `G=…` | one pin each, `"0.1"` / `"23.88888"` |
| `Constant3Vector` | `Constant=(R=…,G=…,B=…,A=…)` | `"0.00432,123.199997,7657650176.0"` — **no parentheses** |
| `Constant4Vector` | `Constant=(R=…,G=…,B=…,A=…)` | `"(R=4.000000,G=10.500000,…)"` — **parentheses kept** |

`material-nodes.mjs` encodes this as `pinDefaults`, and `emitT3D` refuses to emit when the two
drift apart.

## Checking a new node type

Add the node in the Material Editor, wire something into each input, copy it, save the text,
and run `node reference/survey.mjs <file.t3d>`. It prints each pin's direction, category,
sub-category and default, which is exactly what a `NODES` entry needs.
