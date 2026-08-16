// Niagara value types: how a pin names its type, and how an FNiagaraVariable stores it.
//
// A pin carries its type as an object path, which is portable. An FNiagaraVariable carries it
// as `RegisteredTypeIndex` -- an index into a registry built at runtime -- which is not. See
// reference/ENCODING-NIAGARA.md; the short version is that the index is stable for a given
// engine build, differs between engine versions, and is only needed by the handful of nodes
// that own an FNiagaraVariable (Input, CustomHlsl's Signature, If/Select/StaticSwitch).

import { TYPE_INDEX } from "./ue-niagara-type-index.mjs";

// `struct` is the UScriptStruct path a pin points at; `kind` picks the wrapper Unreal writes
// round it. `index` comes from the generated registry map.
//
// `default` is the pin's inline value text when nothing is wired in. The engine does NOT use one
// format for all of them -- a float is "0.000000", a Vector2f is struct-style "X=0.000 Y=0.000",
// a Vector3f is CSV "0.000,0.000,0.000" -- because each type's editor utility writes its own.
// Entries marked `observed` were read off a real UE 5.8 copy; the rest are plain forms that the
// value parser accepts. Prefer replacing an unobserved one with a real capture over tidying it.
const T = {
  float:    { struct: "/Script/Niagara.NiagaraFloat",        kind: "ScriptStruct", default: "0.000000", observed: true },
  int:      { struct: "/Script/Niagara.NiagaraInt32",        kind: "ScriptStruct", default: "0", observed: true },
  bool:     { struct: "/Script/Niagara.NiagaraBool",         kind: "ScriptStruct", default: "false" },
  position: { struct: "/Script/Niagara.NiagaraPosition",     kind: "ScriptStruct", default: "0.000,0.000,0.000" },
  numeric:  { struct: "/Script/Niagara.NiagaraNumeric",      kind: "ScriptStruct", default: "0.0" },
  map:      { struct: "/Script/Niagara.NiagaraParameterMap", kind: "ScriptStruct", default: undefined },
  // A matrix pin writes no value text at all — verified against a real copy, not an omission.
  matrix:   { struct: "/Script/Niagara.NiagaraMatrix",       kind: "ScriptStruct", default: undefined, observed: true },
  id:       { struct: "/Script/Niagara.NiagaraID",           kind: "ScriptStruct", default: "-1,-1", observed: true },
  vec2:     { struct: "/Script/CoreUObject.Vector2f",        kind: "ScriptStruct", default: "X=0.000 Y=0.000", observed: true },
  vec3:     { struct: "/Script/CoreUObject.Vector3f",        kind: "ScriptStruct", default: "0.000,0.000,0.000", observed: true },
  vec4:     { struct: "/Script/CoreUObject.Vector4f",        kind: "ScriptStruct", default: "0.000,0.000,0.000,0.000" },
  color:    { struct: "/Script/CoreUObject.LinearColor",     kind: "ScriptStruct", default: "1.000,1.000,1.000,1.000" },
  // Identity, not zero — a zero quaternion is not a rotation, and the editor writes this.
  quat:     { struct: "/Script/CoreUObject.Quat4f",          kind: "ScriptStruct", default: "0.000,0.000,0.000,1.000", observed: true },
};

// The registry index is not stated here: it is recovered from exported assets by
// niagara/generate-functions.mjs, which correlates each Input node's index with its own pin's
// type path. A path can register more than once (a static variant registers again), and the
// lowest index is the plain one.
const indexOf = (struct) => {
  const hits = Object.entries(TYPE_INDEX).filter(([, p]) => p === struct).map(([i]) => Number(i));
  return hits.length ? Math.min(...hits) : null;
};

export const TYPES = Object.fromEntries(
  Object.entries(T).map(([key, t]) => [key, { ...t, index: indexOf(t.struct) }]),
);

// What `FNiagaraTypeDefinition::Get*Def()` in the engine's op table means here, so the op
// generator can read C++ type expressions without a second table.
export const DEF_ACCESSORS = {
  GetFloatDef: "float",
  GetIntDef: "int",
  GetBoolDef: "bool",
  GetVec2Def: "vec2",
  GetVec3Def: "vec3",
  GetVec4Def: "vec4",
  GetColorDef: "color",
  GetPositionDef: "position",
  GetQuatDef: "quat",
  GetMatrix4Def: "matrix",
  GetGenericNumericDef: "numeric",
  GetParameterMapDef: "map",
  GetIDDef: "id",
};

// A data interface is a UClass, not a struct, so its pin says `Class` where a value type says
// `ScriptStruct`. Spec-declared, because the set of them is open-ended.
export const dataInterface = (path) => ({ struct: path, kind: "Class", default: undefined });

// A generated table names a type by its path rather than by one of the short keys, so an inline
// type still picks up the default text its struct is written with.
const byStruct = new Map(Object.values(TYPES).map((t) => [t.struct, t]));

export const typeOf = (name) => {
  if (typeof name === "object") {                         // an inline { struct, wrapper }
    const known = byStruct.get(name.struct);
    return known ? { ...known, ...name } : name;
  }
  const t = TYPES[name];
  if (!t) throw new Error(`unknown Niagara type "${name}" — known: ${Object.keys(TYPES).join(", ")}`);
  return t;
};

// The class the type object is an instance of. A struct is /Script/CoreUObject.ScriptStruct, a
// data interface /Script/CoreUObject.Class, an engine enum /Script/CoreUObject.Enum, and a
// content enum /Script/Engine.UserDefinedEnum — so it is carried whole rather than derived.
const wrapperOf = (t) => t.wrapper ?? `/Script/CoreUObject.${t.kind ?? "ScriptStruct"}`;

// PinType.PinCategory: a value type is "Type", a data interface or UObject "Class", an enum "Enum".
export const pinCategory = (t) => {
  const tail = wrapperOf(t).split(".").pop();
  if (tail === "Class") return "Class";
  if (tail.endsWith("Enum")) return "Enum";
  return "Type";
};

// The quoted object reference Unreal writes for PinType.PinSubCategoryObject.
export const subCategoryObject = (t) => `"${wrapperOf(t)}'${t.struct}'"`;

// An FNiagaraVariable's type, for the nodes that store one as a property.
export const typeDefHandle = (t, where) => {
  if (t.index == null) {
    throw new Error(
      `type "${t.struct}" has no RegisteredTypeIndex recorded, and ${where} needs one.\n`
      + "Harvest it from a real editor copy — see reference/ENCODING-NIAGARA.md — and add it "
      + "to TYPES in niagara/types.mjs.",
    );
  }
  return `(RegisteredTypeIndex=${t.index})`;
};
