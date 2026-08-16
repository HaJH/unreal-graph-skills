// The Niagara node table: what class each spec node becomes, which pins it carries, and which
// properties travel with it.
//
// Only the operators come from the engine (ue-niagara-ops.mjs). The structural nodes are here
// by hand because their pins are not fixed by class at all -- a Map Get's pins ARE the
// parameters the spec asks for, the way a material Custom node's pins are its declared inputs.
import { OPS } from "./ue-niagara-ops.mjs";
import { typeOf } from "./types.mjs";

// A parameter entry is ["Particles.Age", "float"]; a bare string means float.
const param = (p) => (Array.isArray(p) ? p : [p, "float"]);

// Nodes that own dynamic pins draw a trailing "+" row. Real copies carry it, and since nothing
// reconstructs pins on paste, leaving it out means pasting a node you cannot extend.
const addPin = (dir) => ({ name: "Add", dir, type: null, sub: "DynamicAddPin" });

export const NODES = {
  // The parameter map every module graph starts from. Its name is what the stack binds to.
  Input: {
    class: "NiagaraNodeInput",
    pins: (n) => [{ name: "Input", dir: "out", type: "map" }],
    props: (n) => [
      `Input=(VarData=(0),Name="${n.name ?? "InputMap"}",TypeDefHandle=__MAP_HANDLE__)`,
      `CallSortPriority=${n.sortPriority ?? 1}`,
    ],
    // Signals the emitter to fill __MAP_HANDLE__ from the type table, so the index lives in
    // exactly one place.
    needsTypeHandle: "map",
  },

  // Reads parameters out of the map. Every parameter is a pair: the output pin that carries the
  // value, and an unnamed input pin holding the default used when nothing upstream set it.
  MapGet: {
    class: "NiagaraNodeParameterMapGet",
    pins: (n) => [
      { name: "Source", dir: "in", type: "map" },
      ...(n.params ?? []).flatMap((p) => {
        const [name, type] = param(p);
        return [
          { name, dir: "out", type, sub: "ParameterPin", friendly: true, persistent: `get/${name}/out` },
          {
            dir: "in", type, sub: "ParameterPin", persistent: `get/${name}/default`,
            tooltip: `Default value for ${name} if no other module has set it previously in the stack.`,
          },
        ];
      }),
      addPin("out"),
    ],
    // Pairs each parameter's output pin with its default pin, by PersistentGuid.
    props: (n, { persistentGuid }) => {
      const pairs = (n.params ?? []).map((p) => {
        const [name] = param(p);
        return `(${persistentGuid(`get/${name}/out`)}, ${persistentGuid(`get/${name}/default`)})`;
      });
      return pairs.length ? [`PinOutputToPinDefaultPersistentId=(${pairs.join(",")})`] : [];
    },
  },

  // Writes parameters back into the map. `Source` in, `Dest` out, one input pin per parameter.
  MapSet: {
    class: "NiagaraNodeParameterMapSet",
    pins: (n) => [
      { name: "Source", dir: "in", type: "map" },
      { name: "Dest", dir: "out", type: "map" },
      ...(n.params ?? []).map((p) => {
        const [name, type] = param(p);
        return { name, dir: "in", type, sub: "ParameterPin", friendly: true };
      }),
      addPin("in"),
    ],
    props: () => [],
  },

  // An engine operator. Pins come from the generated table, so the spec only names the op.
  Op: {
    class: "NiagaraNodeOp",
    pins: (n) => {
      const op = OPS[n.op];
      if (!op) throw new Error(`unknown Niagara op "${n.op}" — grep niagara/ue-niagara-ops.mjs`);
      // A variadic op takes extra operands named on past the last declared one: C, D, E…
      const extra = (n.extraInputs ?? []).map((name) => [name, op.in[0][1]]);
      if (extra.length && !op.variadic) {
        throw new Error(`op "${n.op}" does not support added inputs`);
      }
      return [
        ...[...op.in, ...extra].map(([name, type]) => ({ name, dir: "in", type })),
        ...op.out.map(([name, type]) => ({ name, dir: "out", type })),
        ...(op.variadic ? [addPin("in")] : []),
      ];
    },
    props: (n) => [`OpName="${n.op}"`],
  },

  // Calls a module, dynamic input or function script asset. Its pins come from the asset, so
  // the spec states them -- the same bargain material-graph strikes for MaterialFunctionCall.
  FunctionCall: {
    class: "NiagaraNodeFunctionCall",
    pins: (n) => [
      ...(n.inputs ?? []).map((p) => {
        const [name, type] = param(p);
        return { name, dir: "in", type };
      }),
      ...(n.outputs ?? []).map((p) => {
        const [name, type] = param(p);
        return { name, dir: "out", type };
      }),
    ],
    props: (n) => {
      if (!n.function) throw new Error(`FunctionCall "${n.id}" needs a \`function\` asset path`);
      const short = n.function.split("/").pop();
      return [
        `FunctionScript="/Script/Niagara.NiagaraScript'${n.function}.${short}'"`,
        `FunctionDisplayName="${n.label ?? short}"`,
      ];
    },
  },

  // Inline HLSL, for the few lines that say the thing plainly where a dozen op nodes would not.
  CustomHlsl: {
    class: "NiagaraNodeCustomHlsl",
    pins: (n) => [
      ...(n.inputs ?? []).map((p) => {
        const [name, type] = param(p);
        return { name, dir: "in", type };
      }),
      ...(n.outputs ?? []).map((p) => {
        const [name, type] = param(p);
        return { name, dir: "out", type };
      }),
      addPin("in"),
      addPin("out"),
    ],
    props: (n, { typeHandle }) => {
      const sig = (list) => (list ?? []).map((p) => {
        const [name, type] = param(p);
        return `(Name="${name}",TypeDefHandle=${typeHandle(type, `CustomHlsl "${n.id}"`)})`;
      }).join(",");
      // \r\n, because that is what the editor writes inside the property.
      const code = String(n.code ?? "")
        .replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\r\\n");
      return [
        `CustomHlsl="${code}"`,
        `Signature=(Inputs=(${sig(n.inputs)}),Outputs=(${sig(n.outputs)}),Name="${n.id}")`,
      ];
    },
  },

  // Tidies a single wire. Niagara's reroute is an ordinary node with one pin each way.
  Reroute: {
    class: "NiagaraNodeReroute",
    pins: (n) => [
      { name: "Input", dir: "in", type: n.type ?? "numeric" },
      { name: "Output", dir: "out", type: n.type ?? "numeric" },
    ],
    props: () => [],
  },
};
