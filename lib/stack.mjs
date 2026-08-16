// Renders a Niagara emitter stack.
//
// A stack is a list, not a node network: stages run top to bottom, modules run in order within a
// stage, and an input either holds a value or points at a parameter. There are no wires to draw,
// so this is a styled tree rather than a graph -- which is also why it reads better than the same
// thing written as prose, where the ordering and the nesting have to be described instead of seen.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// An input is { name, value } or { name, link } — or the shorthand ["Name", value], where a
// value written as "-> Particles.X" is a link.
const normalise = (input) => {
  if (Array.isArray(input)) {
    const [name, value] = input;
    return normalise(typeof value === "object" && value !== null ? { name, ...value } : { name, value });
  }
  const link = input.link ?? (typeof input.value === "string" && input.value.startsWith("->")
    ? input.value.slice(2).trim()
    : null);
  return { ...input, link, value: link ? null : input.value };
};

const renderInput = (raw) => {
  const input = normalise(raw);
  const value = input.link
    ? `<span class="in-link">${esc(input.link)}</span>`
    : input.value === undefined || input.value === null
      ? ""
      : `<span class="in-value">${esc(input.value)}</span>`;
  const children = input.children?.length
    ? `\n          <ul class="inputs nested">\n${input.children.map((c) => renderInput(c)).join("\n")}\n          </ul>`
    : "";
  return `            <li><span class="in-name">${esc(input.name)}</span>${value}${children}</li>`;
};

const renderModule = (module) => {
  const kind = module.set ? "set" : module.scratch ? "scratch" : "module";
  // A Set Variables row names what it writes; everything else names the module.
  const title = module.set ? `Set: ${module.set}` : module.module;
  const note = module.note ? `<span class="mod-note">${esc(module.note)}</span>` : "";
  const inputs = module.inputs?.length
    ? `\n          <ul class="inputs">\n${module.inputs.map((i) => renderInput(i)).join("\n")}\n          </ul>`
    : "";
  return `        <li class="module ${kind}">
          <span class="mod-name">${esc(title)}</span>${note}${inputs}
        </li>`;
};

const renderStage = (stage) => {
  const modules = (stage.modules ?? []).map((m) => renderModule(m)).join("\n");
  const empty = modules ? "" : `        <li class="module empty"><span class="mod-name">—</span></li>`;
  return `      <li class="stage">
        <span class="stage-name">${esc(stage.stage)}</span>
      </li>
${modules || empty}`;
};

export const renderStack = (section) => {
  const head = section.emitter
    ? `    <p class="stack-head"><span class="emitter">${esc(section.emitter)}</span>`
      + (section.note ? `<span class="emitter-note">${esc(section.note)}</span>` : "")
      + "</p>\n"
    : "";
  const stages = (section.stages ?? []).map((s) => renderStage(s)).join("\n");
  return `${head}    <ol class="stack">\n${stages}\n    </ol>\n`;
};
