# Local patches to the vendored renderer

Re-vendoring `bue-render.js` drops these. Re-apply them, or the graphs get harder to read.

## Node titles follow Unreal's own caption

`NMaterialGraphNode.prototype.getMaterialName` titles a node by stripping `MaterialExpression`
off its class, special-casing only `MaterialFunctionCall`, `LinearInterpolate` and the
constants. Unreal itself captions a node with `GetCaption()`, which for the node types a large
graph is mostly made of returns something far more useful than the class:

| node | Unreal's caption | what the stock renderer drew |
|---|---|---|
| `ScalarParameter` / `VectorParameter` / `StaticBoolParameter` | the parameter name | "ScalarParameter" |
| `NamedRerouteDeclaration` | the variable name | "NamedRerouteDeclaration" |
| `Custom` | its `Description` | "Custom" |

A graph of forty parameters and twenty reroutes drawn that way is unreadable — every node
carries the same word, and the one thing that identifies it is exactly what is missing.

The patch inserts a lookup just before the class-name fallback, in this order:

1. `Desc` — the expression's own comment field. A general override for any node, and the only
   handle available for `NamedRerouteUsage`, whose link to its declaration is a Guid the
   renderer cannot resolve without cross-referencing the rest of the graph.
2. `ParameterName` — covers the whole parameter family at once.
3. `Name` on a named reroute declaration.
4. `Description` on a Custom node.

It is guarded by `this.nodes.length > 1` because the root node has no expression object.

Search for `__unq` to find it.
