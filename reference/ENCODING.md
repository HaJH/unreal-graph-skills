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
sub-category colours the channel:

| sub-category | meaning |
|---|---|
| *(empty)* | no colour — the whole value, **or a combination with no name** |
| `red` `green` `blue` `alpha` | one channel |
| `rgba` | all four |

**The sub-category does not select anything.** It is the pin's colour, and it only has words
for the five combinations above — RGB (mask bits `1110`) has no name and falls through to the
empty string, which is exactly what an unmasked output looks like. Reading a tap back off the
sub-category therefore loses RGB silently. What actually selects channels lives on the wire,
below.

Numbered outputs (`Output`, `Output2`, …) are the Constant\*Vector convention; `TextureSample`
instead names them after the channels (`RGB`, `R`, `G`, `B`, `A`, `RGBA`). A scalar-valued
expression is the exception: its single `Output` carries **no** category at all.

Every pin also gets `PinFriendlyName=NSLOCTEXT("MaterialGraphNode", "Space", " ")` on outputs,
and the long tail of `PinType.*` booleans, all `False` in practice.

## Links

A wire is written on **both** ends, as `LinkedTo=(<NodeName> <PinId>,)` inside each pin. One
output feeding two inputs lists both peers in its own `LinkedTo` and appears once in each
target's. Miss an end and the editor drops the connection.

But `LinkedTo` is only what the *graph* draws. What the material **compiles** is the
`FExpressionInput` on the consuming expression, and it carries the tap itself:

```
A=(Expression="/Script/Engine.MaterialExpressionTextureSample'…_7'",Mask=1,MaskR=1,MaskG=1,MaskB=1)
```

- `OutputIndex` picks which entry of `Outputs` the expression compiles. It defaults to 0 and
  many expressions ignore it entirely — `TextureSample` returns the whole RGBA from every one
  of its six outputs.
- `Mask` plus `MaskR`/`MaskG`/`MaskB`/`MaskA` is the swizzle, and for those expressions it is
  the *only* thing that distinguishes `.G` from `.RGB`. Unreal writes only the bits that are
  set, and omits the group entirely for an unmasked output.

Record a tap on the pin alone and the graph draws correctly while the paste reads the wrong
value — the same failure mode as the value trap below, and just as quiet.

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

## Nodes that agree on a Guid

Three node types find their partner by Guid rather than by a wire, and they do not behave the
same way when pasted.

**Named reroutes are safe to author.** A `NamedRerouteDeclaration` holds `Name`, `NodeColor`
and `VariableGuid`; a `NamedRerouteUsage` holds `DeclarationGuid` (and a transient
`Declaration` pointer that paste rebuilds). `PostCopyNode` on the usage looks for the
declaration among the pasted expressions first and falls back to the whole material; the
declaration only regenerates its Guid when the target material already holds that one, and
then rewrites the pasted usages to match. So a generated pair keeps whatever Guid it was
given, and colliding with an existing graph is handled rather than fatal.

**Function inputs are not.** `UMaterialExpressionFunctionInput::PostEditImport` calls
`ConditionallyGenerateId(true)` — a *forced* regeneration — so the `Id` you paste is discarded.
`FunctionOutput` does the same.

Which ought to make `MaterialExpressionMaterialFunctionCall` unemittable without first building
the function and reading its ids back. **It is not: on UE 5.8 a call pasted with no
`ExpressionInputId` at all kept every one of its input wires.** Why is not established — the
mechanism above says it should not — so the ids stay optional in the spec and the shape below
is what a real export looks like rather than what the emitter must produce.

```
MaterialFunction="/Script/Engine.MaterialFunction'/Game/…/MF_Name.MF_Name'"
FunctionInputs(0)=(ExpressionInputId=<Guid>,Input=(Expression="…",InputName="InBaseAlpha"))
FunctionOutputs(0)=(ExpressionOutputId=<Guid>,Output=(OutputName="LayerBlendColor"))
Outputs(0)=(OutputName="LayerBlendColor")
```

`UpdateFromFunctionResource` restores each wire by matching `ExpressionInputId` against the
Ids inside the referenced asset — `FindInputById`, with **no** fall back to the input's name.
The one thing that is certainly required is ordering: a call takes its pins from the asset, so
build the function first, then the caller.

The Ids are not reachable from Python either — `Id` on a `FunctionInput` and `FunctionInputs`
on the call are both bare `UPROPERTY()`, which reflection does not expose. If a call ever does
come in unwired, the repair is `set_material_function` plus `connect_material_expressions`,
which resolves pins by name and lets the editor mint the Ids itself. An unnamed input pin
answers to the FName `'None'` there, not to `'Input'`.

## Comments are two objects

A comment box is a `MaterialGraphNode_Comment` wrapping a `MaterialExpressionComment`, and the
inner object is the one that persists: `FMaterialEditor::PasteNodesHere` adds it to the
material's comment collection and skips any comment node that does not have one. Emit the
graph node alone and the box draws, disappears when the asset is reopened, and takes the
editor down if it is deleted first — the delete path dereferences the pointer unguarded.

Both halves carry the geometry, under different names: `NodePosX`/`NodePosY`/`NodeWidth`/
`NodeHeight`/`NodeComment` on the graph node, `MaterialExpressionEditorX`/`Y`/`SizeX`/`SizeY`/
`Text` on the expression. Write them to agree.

## bCanRenameNode

A graph-node property, so nothing recomputes it on paste. Real exports carry
`bCanRenameNode=True` on parameters and on named reroute declarations, and omit it everywhere
else. Leave it off and those nodes arrive unrenameable — which matters most for a reroute,
whose name *is* the variable.

## Checking a new node type

Add the node in the Material Editor, wire something into each input, copy it, save the text,
and run `node reference/survey.mjs <file.t3d>`. It prints each pin's direction, category,
sub-category and default, which is exactly what a `NODES` entry needs.
