// Renders a Niagara emitter stack.
//
// A stack is a list, not a node network: stages run top to bottom, modules run in order within a
// stage, and an input either holds a value or points at a parameter. There are no wires to draw,
// so this is a styled tree rather than a graph -- which is also why it reads better than the same
// thing written as prose, where the ordering and the nesting have to be described instead of seen.
import { MODULES } from "../niagara/ue-niagara-modules.mjs";
import { ENUMS } from "../niagara/ue-niagara-enums.mjs";
import { resolveModule, normaliseInput, isEnumType } from "../niagara/emit-stack-t3d.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// An enum-typed input stores an ordinal, so a spec read off a real emitter carries "2" where the
// editor draws "Simulation Position". The generated table turns one into the other; a value the
// table cannot place is left as it was written rather than relabelled on a guess.
const labelled = (input, module) => {
  if (input.value === undefined || input.value === null) return input.value;
  const type = module?.inputs.find((p) => p.name === input.name);
  if (!isEnumType(type) || !/^\d+$/.test(String(input.value).trim())) return input.value;
  return ENUMS[type.struct]?.[Number(input.value)] ?? input.value;
};

const renderInput = (raw, module) => {
  const input = normaliseInput(raw);
  const shown = labelled(input, module);
  const value = input.link
    ? `<span class="in-link">${esc(input.link)}</span>`
    : shown === undefined || shown === null
      ? ""
      : `<span class="in-value">${esc(shown)}</span>`;
  const children = input.children?.length
    ? `\n          <ul class="inputs nested">\n${input.children.map((c) => renderInput(c, module)).join("\n")}\n          </ul>`
    : "";
  return `            <li><span class="in-name">${esc(input.name)}</span>${value}${children}</li>`;
};

// The module behind a row, where the table knows it. Drawing must not depend on that: a stack
// section is a picture first, and a row naming a module the sweep has never seen still draws.
const known = (module) => {
  if (module.set) return null;
  try {
    return MODULES[resolveModule(module, "")] ?? null;
  } catch {
    return null;
  }
};

const renderModule = (module) => {
  const kind = module.set ? "set" : module.scratch ? "scratch" : "module";
  // A Set Variables row names what it writes; everything else names the module.
  const title = module.set ? `Set: ${module.set}` : module.module;
  const note = module.note ? `<span class="mod-note">${esc(module.note)}</span>` : "";
  const table = known(module);
  const inputs = module.inputs?.length
    ? `\n          <ul class="inputs">\n${module.inputs.map((i) => renderInput(i, table)).join("\n")}\n          </ul>`
    : "";
  return `        <li class="module ${kind}">
          <span class="mod-name">${esc(title)}</span>${note}${inputs}
        </li>`;
};

// `after` is the stage's paste block, when the section asked for one. It belongs inside the list
// and directly under the modules it carries: a payload is per stage, and three of them collected
// at the bottom of the page leave the reader matching headings back to stages by name.
const renderStage = (stage, after) => {
  const modules = (stage.modules ?? []).map((m) => renderModule(m)).join("\n");
  const empty = modules ? "" : `        <li class="module empty"><span class="mod-name">—</span></li>`;
  const paste = after ? `\n        <li class="stage-paste">\n${after}\n        </li>` : "";
  return `      <li class="stage">
        <span class="stage-name">${esc(stage.stage)}</span>
      </li>
${modules || empty}${paste}`;
};

export const renderStack = (section, pastes = []) => {
  const head = section.emitter
    ? `    <p class="stack-head"><span class="emitter">${esc(section.emitter)}</span>`
      + (section.note ? `<span class="emitter-note">${esc(section.note)}</span>` : "")
      + "</p>\n"
    : "";
  const stages = (section.stages ?? []).map((s, i) => renderStage(s, pastes[i])).join("\n");
  return `${head}    <ol class="stack">\n${stages}\n    </ol>\n`;
};
