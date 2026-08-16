// Niagara value types: how a pin names its type, and how an FNiagaraVariable stores it.
//
// A pin carries its type as an object path, which is portable. An FNiagaraVariable carries it
// as `RegisteredTypeIndex` -- an index into a registry built at runtime -- which is not. See
// reference/ENCODING-NIAGARA.md; the short version is that the index is stable for a given
// engine build, differs between engine versions, and is only needed by the handful of nodes
// that own an FNiagaraVariable (Input, CustomHlsl's Signature, If/Select/StaticSwitch).

// `struct` is the UScriptStruct path a pin points at; `kind` picks the wrapper Unreal writes
// round it. `index` is the UE 5.8 registry index, harvested from a real editor copy.
export const TYPES = {
  float:    { struct: "/Script/Niagara.NiagaraFloat",        kind: "ScriptStruct", index: 99,  default: "0" },
  int:      { struct: "/Script/Niagara.NiagaraInt32",        kind: "ScriptStruct", index: 101, default: "0" },
  bool:     { struct: "/Script/Niagara.NiagaraBool",         kind: "ScriptStruct", index: null, default: "false" },
  position: { struct: "/Script/Niagara.NiagaraPosition",     kind: "ScriptStruct", index: 107, default: "0,0,0" },
  numeric:  { struct: "/Script/Niagara.NiagaraNumeric",      kind: "ScriptStruct", index: null, default: "0" },
  map:      { struct: "/Script/Niagara.NiagaraParameterMap", kind: "ScriptStruct", index: 95,  default: undefined },
  matrix:   { struct: "/Script/Niagara.NiagaraMatrix",       kind: "ScriptStruct", index: null, default: undefined },
  id:       { struct: "/Script/Niagara.NiagaraID",           kind: "ScriptStruct", index: null, default: undefined },
  vec2:     { struct: "/Script/CoreUObject.Vector2f",        kind: "ScriptStruct", index: 103, default: "0,0" },
  vec3:     { struct: "/Script/CoreUObject.Vector3f",        kind: "ScriptStruct", index: null, default: "0,0,0" },
  vec4:     { struct: "/Script/CoreUObject.Vector4f",        kind: "ScriptStruct", index: null, default: "0,0,0,0" },
  color:    { struct: "/Script/CoreUObject.LinearColor",     kind: "ScriptStruct", index: 106, default: "1,1,1,1" },
  quat:     { struct: "/Script/CoreUObject.Quat4f",          kind: "ScriptStruct", index: null, default: undefined },
};

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

export const typeOf = (name) => {
  if (typeof name === "object") return name;              // an inline { struct, kind }
  const t = TYPES[name];
  if (!t) throw new Error(`unknown Niagara type "${name}" — known: ${Object.keys(TYPES).join(", ")}`);
  return t;
};

// PinType.PinCategory: a value type is "Type", a data interface or UObject is "Class".
export const pinCategory = (t) => (t.kind === "Class" ? "Class" : "Type");

// The quoted object reference Unreal writes for PinType.PinSubCategoryObject.
export const subCategoryObject = (t) =>
  `"/Script/CoreUObject.${t.kind}'${t.struct}'"`;

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
