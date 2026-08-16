// Expands a compact graph spec into Niagara script-graph clipboard T3D.
//
// Niagara wraps its node dump: the nodes are ordinary UEdGraphNode T3D, Base64'd into
// `ExportedNodes` on a UNiagaraClipboardContent object, and that object is what lands on the
// clipboard. See reference/ENCODING-NIAGARA.md for the format this reproduces.
//
// Compared with a material, two things are simpler: wiring is only LinkedTo (there is no second
// copy on an expression property), and a value lives in exactly one place (the pin), so the
// drift trap material-graph has to guard against cannot arise here.
import { NODES } from "./niagara-nodes.mjs";
import { typeOf, pinCategory, subCategoryObject, typeDefHandle } from "./types.mjs";
import { guid } from "../lib/t3d.mjs";
import { autoLayout } from "../lib/layout.mjs";

// Everything after the type block, identical on every pin.
const PIN_TYPE_TAIL =
  "PinType.PinSubCategoryMemberReference=(),PinType.PinValueType=(),PinType.ContainerType=None,"
  + "PinType.bIsReference=False,PinType.bIsConst=False,PinType.bIsWeakPointer=False,"
  + "PinType.bIsUObjectWrapper=False,PinType.bSerializeAsSinglePrecisionFloat=False,";

const PIN_FLAGS =
  "bHidden=False,bNotConnectable=False,bDefaultValueIsReadOnly=False,"
  + "bDefaultValueIsIgnored=False,bAdvancedView=False,bOrphanedPin=False,)";

const ZERO_GUID = "00000000000000000000000000000000";

// A wire names its source as "node" or "node:PinName". The separator is a colon rather than a
// dot because Niagara pin names are themselves dotted -- "Particles.NormalizedAge".
const splitRef = (ref) => {
  const at = String(ref).indexOf(":");
  return at < 0 ? [String(ref), null] : [String(ref).slice(0, at), String(ref).slice(at + 1)];
};

export function emitT3D(spec) {
  const script = spec.script ?? "ScratchModule";
  const nodes = spec.nodes.map((n, i) => ({ ...n, index: i }));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (!NODES[node.type]) {
      throw new Error(`unknown node type "${node.type}" on "${node.id}" — known: ${Object.keys(NODES).join(", ")}`);
    }
    if (byId.get(node.id) !== node) throw new Error(`duplicate node id "${node.id}"`);
  }

  const nodeName = (n) => `${NODES[n.type].class}_${n.index}`;
  const pinId = (id, pin) => guid(`${script}/${id}/${pin}`);
  const persistentGuid = (seed) => guid(`${script}/persistent/${seed}`);
  const typeHandle = (t, where) => typeDefHandle(typeOf(t), where);

  // Pins are resolved once and reused: the wire pass, the layout pass and the emit pass all
  // have to agree on the same list.
  const pinsOf = new Map(nodes.map((n) => [n.id, NODES[n.type].pins(n)]));
  const findPin = (node, name, dir) =>
    pinsOf.get(node.id).find((p) => p.name === name && p.dir === dir);

  // Resolve every wire to a concrete (output pin -> input pin) pair up front, so a bad
  // reference fails here rather than producing a graph with a silently missing wire.
  const links = [];
  for (const node of nodes) {
    for (const [pinName, target] of Object.entries(node.in ?? {})) {
      const [fromId, fromPin] = splitRef(target);
      const source = byId.get(fromId);
      if (!source) throw new Error(`"${node.id}.${pinName}" points at unknown node "${fromId}"`);

      const outputs = pinsOf.get(fromId).filter((p) => p.dir === "out" && p.sub !== "DynamicAddPin");
      const output = fromPin ? outputs.find((p) => p.name === fromPin) : outputs[0];
      if (!output) {
        throw new Error(
          `"${fromId}" has no output pin named "${fromPin}" — has ${outputs.map((p) => p.name).join(", ")}`,
        );
      }
      if (!findPin(node, pinName, "in")) {
        const names = pinsOf.get(node.id).filter((p) => p.dir === "in").map((p) => p.name ?? "<default>");
        throw new Error(`"${node.type}" node "${node.id}" has no input pin "${pinName}" — has ${names.join(", ")}`);
      }
      links.push({ from: { id: fromId, pin: output.name }, to: { id: node.id, pin: pinName } });
    }
  }

  autoLayout(nodes, links, spec.layout ?? {});

  // LinkedTo is written on both ends, so collect the peers for every pin first.
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

  const pinLine = (node, pin, seq) => {
    // An unnamed pin (a Map Get default) still needs a stable id, so seed off its position.
    const key = pin.name ?? `#${seq}`;
    const type = pin.type ? typeOf(pin.type) : null;
    const wired = pin.name ? linkedTo(node.id, pin.name) : "";
    const value = pin.dir === "in" && !wired && type ? (pin.value ?? type.default) : undefined;

    return "   CustomProperties Pin ("
      + `PinId=${pinId(node.id, key)},`
      + (pin.name ? `PinName="${pin.name}",` : "")
      + (pin.tooltip ? `PinToolTip="${pin.tooltip}",` : "")
      + (pin.friendly && pin.name ? `PinFriendlyName=INVTEXT("${pin.name}"),` : "")
      + (pin.dir === "out" ? `Direction="EGPD_Output",` : "")
      + `PinType.PinCategory="${type ? pinCategory(type) : "Misc"}",`
      + `PinType.PinSubCategory="${pin.sub ?? ""}",`
      + `PinType.PinSubCategoryObject=${type ? subCategoryObject(type) : "None"},`
      + PIN_TYPE_TAIL
      + (value !== undefined ? `DefaultValue="${value}",AutogeneratedDefaultValue="${value}",` : "")
      + wired
      + `PersistentGuid=${pin.persistent ? persistentGuid(pin.persistent) : ZERO_GUID},`
      + PIN_FLAGS;
  };

  const blocks = nodes.map((node) => {
    const def = NODES[node.type];
    const name = nodeName(node);
    const path = `/Engine/Transient.${script}:NiagaraScriptSource_0.NiagaraGraph_0.${name}`;

    let props = def.props(node, { persistentGuid, typeHandle });
    // A node that stores an FNiagaraVariable needs the runtime type index; keeping it out of
    // the node table means the index is stated once, in types.mjs.
    if (def.needsTypeHandle) {
      const handle = typeHandle(def.needsTypeHandle, `${node.type} "${node.id}"`);
      props = props.map((p) => p.split("__MAP_HANDLE__").join(handle));
    }

    return [
      `Begin Object Class=/Script/NiagaraEditor.${def.class} Name="${name}" ExportPath="/Script/NiagaraEditor.${def.class}'${path}'"`,
      ...props.map((p) => `   ${p}`),
      `   ChangeId=${guid(`${script}/${node.id}/change`)}`,
      `   NodePosX=${node.x}`,
      `   NodePosY=${node.y}`,
      `   NodeGuid=${guid(`${script}/${node.id}/node`)}`,
      ...pinsOf.get(node.id).map((pin, i) => pinLine(node, pin, i)),
      "End Object",
    ].join("\r\n");
  });

  // The inner dump uses CRLF, because that is what FEdGraphUtilities writes and what the
  // decoder on the other side reads back.
  const inner = blocks.join("\r\n") + "\r\n";
  const encoded = Buffer.from(inner, "utf8").toString("base64");
  const wrapper = "NiagaraClipboardContent_0";

  return [
    `Begin Object Class=/Script/NiagaraEditor.NiagaraClipboardContent Name="${wrapper}" ExportPath="/Script/NiagaraEditor.NiagaraClipboardContent'/Engine/Transient.${wrapper}'"`,
    `   ExportedNodes="${encoded}"`,
    "End Object",
    "",
  ].join("\n");
}

// The renderer reads `ExportedNodes` itself, but a human reading a build log should not have to
// -- and the encoding doc's examples come from here.
export function decodeExportedNodes(t3d) {
  const m = t3d.match(/^\s*ExportedNodes="([^"]*)"/m);
  if (!m) throw new Error("no ExportedNodes property found");
  return Buffer.from(m[1], "base64").toString("utf8");
}
