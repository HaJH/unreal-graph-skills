// Expands a compact graph spec into Material Editor T3D.
//
// The output is the same text Unreal writes when you copy nodes, so it both feeds the
// renderer and pastes back into a material with Ctrl+V. Writing it by hand is impractical:
// every pin needs its own GUID, its type encoding, and a LinkedTo entry on both ends.
import { NODES, t3dString } from "./material-nodes.mjs";
import { guid, flag } from "../lib/t3d.mjs";
import { autoLayout, blockBoxes } from "../lib/layout.mjs";

const PIN_TYPE_TAIL =
  "PinType.PinSubCategoryObject=None,PinType.PinSubCategoryMemberReference=(),"
  + "PinType.PinValueType=(),PinType.ContainerType=None,PinType.bIsReference=False,"
  + "PinType.bIsConst=False,PinType.bIsWeakPointer=False,PinType.bIsUObjectWrapper=False,"
  + "PinType.bSerializeAsSinglePrecisionFloat=False,";

// A channel tap is carried by the mask bits on the wire, not by the output index: an
// expression like TextureSample compiles the whole RGBA whichever output you pull from, and
// FExpressionInput's Mask is what swizzles it down. Unreal writes only the bits that are set.
const MASK_FIELDS = ["MaskR", "MaskG", "MaskB", "MaskA"];
const maskFields = (bits) =>
  bits ? `,Mask=1${[...bits].map((b, i) => (b === "1" ? `,${MASK_FIELDS[i]}=1` : "")).join("")}` : "";

export function emitT3D(spec) {
  const material = spec.material ?? "M_Preview";
  const transient = `/Engine/Transient.${material}`;
  const nodes = spec.nodes.map((n, i) => ({ ...n, index: i + 1 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (!NODES[node.type]) throw new Error(`unknown node type "${node.type}" on "${node.id}"`);
  }

  // Most node types have a fixed pin list. A few — Custom above all — carry one pin per
  // entry the spec declares, so the table may name its inputs with a function instead.
  const pinsOf = (node) => {
    const def = NODES[node.type];
    return typeof def.pins === "function" ? def.pins(node) : def.in;
  };
  // Outputs can vary per node too: a function call shows whatever the function it points at
  // returns, so the spec names them and the shape follows.
  const outsOf = (node) => {
    const def = NODES[node.type];
    return typeof def.outs === "function" ? def.outs(node) : def.out;
  };

  // Resolve every wire to a concrete (output pin -> input pin) pair up front.
  const links = [];
  for (const node of nodes) {
    for (const [pinName, target] of Object.entries(node.in ?? {})) {
      const [fromId, fromPin] = String(target).split(".");
      const source = byId.get(fromId);
      if (!source) throw new Error(`"${node.id}.${pinName}" points at unknown node "${fromId}"`);
      const outputs = outsOf(source);
      const output = fromPin ? outputs.find(([name]) => name === fromPin) : outputs[0];
      if (!output) throw new Error(`"${fromId}" has no output named "${fromPin}"`);
      const input = pinsOf(node).find(([name]) => name === pinName);
      if (!input) throw new Error(`"${node.type}" has no input pin named "${pinName}"`);
      // Which output was tapped has to travel on the expression property as well as the pin.
      // The pin's LinkedTo is what the renderer draws, but Unreal reads FExpressionInput on
      // paste, and its OutputIndex defaults to 0 — so a `.G` tap that is only recorded on the
      // pin draws correctly and pastes in reading the first output instead.
      links.push({
        from: {
          id: fromId,
          pin: output[0],
          outputIndex: outputs.indexOf(output),
          mask: output[2]?.mask,
        },
        to: { id: node.id, pin: pinName },
      });
    }
  }

  // `layout` lets a spec widen the lane a graph wraps at, or tighten the gaps — the defaults
  // suit a handful of blocks, and a big one may want a wider page to stay readable.
  autoLayout(nodes, links, spec.layout ?? {});

  const nodeName = (n) => `MaterialGraphNode_${n.index}`;
  const exprName = (n) => `${NODES[n.type].expression}_${n.index}`;
  const pinId = (id, pin) => guid(`${material}/${id}/${pin}`);

  // LinkedTo is written on both ends, so collect the peers for every pin. Pin names
  // contain spaces ("Default Value", "A > B"), so the key is encoded, not concatenated.
  const pinKey = (id, pin) => JSON.stringify([id, pin]);
  const peers = new Map();
  const addPeer = (side, other) => {
    const key = pinKey(side.id, side.pin);
    const entry = `${nodeName(byId.get(other.id))} ${pinId(other.id, other.pin)}`;
    peers.set(key, [...(peers.get(key) ?? []), entry]);
  };
  for (const { from, to } of links) { addPeer(from, to); addPeer(to, from); }
  const linkedTo = (id, pin) => {
    const list = peers.get(pinKey(id, pin));
    return list ? `LinkedTo=(${list.map((e) => `${e},`).join("")}),` : "";
  };

  const inputPin = (node, [name, opts = {}]) => {
    const wired = links.find((l) => l.to.id === node.id && l.to.pin === name);
    // Unreal reads the pin's DefaultValue when pasting, so it has to agree with the
    // expression property. Derive it from the props unless the spec states one outright.
    const derived = NODES[node.type].pinDefaults?.(node.props ?? {}) ?? {};
    const value = node.values?.[name] ?? derived[name] ?? opts.value;
    return "   CustomProperties Pin ("
      + `PinId=${pinId(node.id, name)},PinName="${name}",`
      + `PinType.PinCategory="optional",PinType.PinSubCategory="${opts.sub ?? ""}",`
      + PIN_TYPE_TAIL
      + (value !== undefined ? `DefaultValue="${value}",` : "")
      + (wired ? linkedTo(node.id, name) : "")
      + "PersistentGuid=00000000000000000000000000000000,bHidden=False,"
      + `bNotConnectable=${flag(opts.fixed)},bDefaultValueIsReadOnly=False,`
      + `bDefaultValueIsIgnored=False,bAdvancedView=${flag(opts.advanced)},bOrphanedPin=False,)`;
  };

  const outputPin = (node, [name, sub, opts = {}]) =>
    "   CustomProperties Pin ("
    + `PinId=${pinId(node.id, name)},PinName="${name}",`
    + `PinFriendlyName=NSLOCTEXT("MaterialGraphNode", "Space", " "),Direction="EGPD_Output",`
    + `PinType.PinCategory="${opts.plain ? "" : "mask"}",PinType.PinSubCategory="${sub}",`
    + PIN_TYPE_TAIL
    + linkedTo(node.id, name)
    + "PersistentGuid=00000000000000000000000000000000,bHidden=False,bNotConnectable=False,"
    + "bDefaultValueIsReadOnly=False,bDefaultValueIsIgnored=False,bAdvancedView=False,"
    + "bOrphanedPin=False,)";

  const blocks = nodes.map((node) => {
    const def = NODES[node.type];

    // The root carries no expression object — it is the material's own output node.
    if (def.root) {
      return [
        `Begin Object Class=/Script/UnrealEd.MaterialGraphNode_Root Name="${nodeName(node)}" ExportPath=/Script/UnrealEd.MaterialGraphNode_Root'"${transient}:MaterialGraph_0.${nodeName(node)}"'`,
        `   Material=/Script/UnrealEd.PreviewMaterial'"${transient}"'`,
        `   NodePosX=${node.x}`,
        `   NodePosY=${node.y}`,
        `   NodeGuid=${guid(`${material}/${node.id}/node`)}`,
        ...pinsOf(node).map((pin) => inputPin(node, pin)),
        "End Object",
      ].join("\n");
    }

    const expr = def.expression;
    const path = `${transient}:MaterialGraph_0.${nodeName(node)}.${exprName(node)}`;
    const ref = `/Script/Engine.${expr}'"${path}"'`;

    // What is wired into a named pin, as the pieces a property reference needs. `ref` is the
    // whole FExpressionInput body, so every caller carries the tapped output with it.
    const wiredOf = (name) => {
      const link = links.find((l) => l.to.id === node.id && l.to.pin === name);
      if (!link) return null;
      const source = byId.get(link.from.id);
      const expression = NODES[source.type].expression;
      return {
        expression,
        name: exprName(source),
        outputIndex: link.from.outputIndex,
        ref: `Expression=/Script/Engine.${expression}'"${exprName(source)}"'`
          + `,OutputIndex=${link.from.outputIndex}${maskFields(link.from.mask)}`,
      };
    };

    // Wired inputs become expression properties referencing the upstream expression. A node
    // whose inputs live in an array rather than in one property each (Custom) builds its own.
    // `ctx.guid` seeds off the material, so a node type that has to agree with another node on
    // a Guid — the named reroute pair — can derive both ends from a name the spec already has.
    const wiredProps = def.buildProps
      ? def.buildProps(node, wiredOf, { material, guid: (seed) => guid(`${material}/${seed}`) })
      : pinsOf(node).flatMap(([name, opts = {}]) => {
        if (!opts.prop) return [];
        const source = wiredOf(name);
        return source ? [`${opts.prop}=(${source.ref})`] : [];
      });
    const literalProps = Object.entries(node.props ?? {}).map(([k, v]) => `${k}=${v}`);

    // `note` is the comment bubble Unreal draws above a node — the place to say what a
    // parameter is for and what range it expects, which a name alone never manages. A real
    // export carries it twice, as `Desc` on the expression and `NodeComment` on the graph
    // node, with the bubble flag on both; the two are written from one string here rather
    // than guessing which half is read back on paste.
    const note = node.note ? t3dString(node.note) : null;

    return [
      `Begin Object Class=/Script/UnrealEd.MaterialGraphNode Name="${nodeName(node)}" ExportPath=/Script/UnrealEd.MaterialGraphNode'"${transient}:MaterialGraph_0.${nodeName(node)}"'`,
      `   Begin Object Class=/Script/Engine.${expr} Name="${exprName(node)}" ExportPath=${ref}`,
      "   End Object",
      `   Begin Object Name="${exprName(node)}" ExportPath=${ref}`,
      ...[...wiredProps, ...literalProps].map((p) => `      ${p}`),
      ...(note ? [`      Desc="${note}"`, "      bCommentBubbleVisible=True"] : []),
      `      MaterialExpressionEditorX=${node.x}`,
      `      MaterialExpressionEditorY=${node.y}`,
      `      MaterialExpressionGuid=${guid(`${material}/${node.id}/expr`)}`,
      `      Material=/Script/UnrealEd.PreviewMaterial'"${transient}"'`,
      "   End Object",
      `   MaterialExpression=/Script/Engine.${expr}'"${exprName(node)}"'`,
      `   NodePosX=${node.x}`,
      `   NodePosY=${node.y}`,
      // What the editor lets you rename in place: a parameter carries its own name, and a named
      // reroute's name IS the variable. Real exports carry the flag on exactly these, and it is
      // a graph-node property rather than an expression one, so nothing recomputes it on paste.
      ...(note ? ["   bCommentBubbleVisible=True"] : []),
      ...(/Parameter$|NamedRerouteDeclaration$/.test(expr) ? ["   bCanRenameNode=True"] : []),
      ...(note ? [`   NodeComment="${note}"`] : []),
      ...Object.entries(def.node ?? {}).map(([k, v]) => `   ${k}=${v}`),
      `   NodeGuid=${guid(`${material}/${node.id}/node`)}`,
      ...pinsOf(node).map((pin) => inputPin(node, pin)),
      ...outsOf(node).map((pin) => outputPin(node, pin)),
      "End Object",
    ].join("\n");
  });

  // A comment box is two objects, not one. The graph node is what gets drawn, but the box only
  // survives because of the MaterialExpressionComment inside it: FMaterialEditor::PasteNodesHere
  // adds that expression to the material's comment collection and skips the node entirely when
  // it is missing, so a comment pasted without one is gone the next time the asset is opened —
  // and deleting it meanwhile dereferences the null pointer and takes the editor with it.
  // A named block becomes a comment box drawn round its members; the geometry is shared, but
  // the object that carries it is not -- a material comment only survives because of the
  // MaterialExpressionComment inside it, which is emitted below.
  const boxes = blockBoxes(nodes, { blockColors: spec.blockColors });

  const comments = [...boxes, ...(spec.comments ?? [])].map((c, i) => {
    const name = `MaterialGraphNode_Comment_${i + 1}`;
    const expr = `MaterialExpressionComment_${i + 1}`;
    const path = `${transient}:MaterialGraph_0.${name}.${expr}`;
    const ref = `/Script/Engine.MaterialExpressionComment'"${path}"'`;
    const x = c.x ?? 0;
    const y = c.y ?? 0;
    const w = c.w ?? 400;
    const h = c.h ?? 200;
    const color = c.color ?? "(R=1.000000,G=1.000000,B=1.000000,A=0.400000)";
    return [
      `Begin Object Class=/Script/UnrealEd.MaterialGraphNode_Comment Name="${name}" ExportPath=/Script/UnrealEd.MaterialGraphNode_Comment'"${transient}:MaterialGraph_0.${name}"'`,
      `   Begin Object Class=/Script/Engine.MaterialExpressionComment Name="${expr}" ExportPath=${ref}`,
      "   End Object",
      `   Begin Object Name="${expr}" ExportPath=${ref}`,
      `      SizeX=${w}`,
      `      SizeY=${h}`,
      `      Text="${c.text}"`,
      `      CommentColor=${color}`,
      `      MaterialExpressionEditorX=${x}`,
      `      MaterialExpressionEditorY=${y}`,
      `      MaterialExpressionGuid=${guid(`${material}/comment/${i}/expr`)}`,
      `      Material=/Script/UnrealEd.PreviewMaterial'"${transient}"'`,
      "   End Object",
      `   MaterialExpressionComment=/Script/Engine.MaterialExpressionComment'"${expr}"'`,
      `   NodePosX=${x}`,
      `   NodePosY=${y}`,
      `   NodeWidth=${w}`,
      `   NodeHeight=${h}`,
      `   CommentColor=${color}`,
      `   NodeComment="${c.text}"`,
      // Which nodes a box actually drags is `NodesUnderComment`, and that is private and not a
      // UPROPERTY -- it is rebuilt in Slate, never serialised, so a pasted box starts empty.
      // MoveMode is at least declared here rather than left to the class default.
      "   MoveMode=GroupMovement",
      `   NodeGuid=${guid(`${material}/comment/${i}`)}`,
      "End Object",
    ].join("\n");
  });

  const t3d = [...comments, ...blocks].join("\n") + "\n";
  assertValuesAgree(t3d);
  return t3d;
}

// A value-carrying node states its number twice — as an expression property and as the pin's
// DefaultValue — and Unreal reads the pin when pasting. If they ever drift, the graph renders
// correctly but pastes in with the wrong values, which is the worst kind of wrong: silent.
function assertValuesAgree(t3d) {
  const drifted = [];
  for (const block of t3d.split(/^Begin Object Class=/m).slice(1)) {
    const cls = block.match(/\/Script\/Engine\.(MaterialExpression\w+)/)?.[1];
    if (!cls || !/Constant|Parameter/.test(cls)) continue;
    const prop = block.match(/\n\s+(?:R|DefaultValue|Constant)=([^\n]+)/);
    const pin = block.match(/PinName="([^"]+)"[\s\S]*?DefaultValue="([^"]*)"/);
    if (!prop || !pin) continue;
    const numbers = (s) => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const expected = numbers(prop[1]);
    const actual = numbers(pin[2]);
    if (!expected.length) continue;
    if (!expected.every((n, i) => Math.abs(n - (actual[i] ?? NaN)) < 1e-6)) {
      drifted.push(`${cls}: property ${prop[1].trim()} but pin "${pin[1]}" = "${pin[2]}"`);
    }
  }
  if (drifted.length) {
    throw new Error(
      "pin defaults disagree with expression properties, so these would paste in wrong:\n  "
      + drifted.join("\n  ")
      + "\nAdd or fix `pinDefaults` for the node type in material-nodes.mjs.",
    );
  }
}
