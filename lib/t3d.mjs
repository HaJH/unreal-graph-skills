// T3D primitives shared by every domain emitter.
//
// Unreal's copy format is the same skeleton whatever editor wrote it -- `Begin Object` blocks
// with properties indented under them -- so the pieces that have nothing to do with materials
// or Niagara in particular live here.

// Deterministic GUIDs keep rebuilds byte-stable, which makes diffs meaningful. Seeding off a
// name the spec already states also lets two nodes that must agree on a Guid derive it
// independently, without the spec having to carry one.
export const guid = (seed) => {
  let out = "";
  for (let salt = 0; salt < 4; salt++) {
    let h = 0x811c9dc5 ^ (salt * 0x9e3779b9);
    for (const ch of `${seed}#${salt}`) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).toUpperCase().padStart(8, "0");
  }
  return out;
};

// Unreal writes booleans in property text as True/False, not true/false.
export const flag = (on) => (on ? "True" : "False");
