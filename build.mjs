// Builds a self-contained page from a spec.
//
//   node build.mjs <spec.mjs> [out.html]
//
// A spec is either a single graph -- a `material` key builds Material Editor T3D, a `script` key
// builds a Niagara script graph -- or a `sections` array, which is how a build guide is written:
// prose, an emitter stack and any number of graphs on one page, in reading order.
//
// The renderer (bue-render, the one blueprintue.com runs) is inlined whole, so the result makes
// zero network requests -- required, because the Artifact CSP blocks every external host.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderStack } from "./lib/stack.mjs";
import { renderProse } from "./lib/prose.mjs";
import { emitStackT3D } from "./niagara/emit-stack-t3d.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), "utf8");

const [specArg, outArg] = process.argv.slice(2);
if (!specArg) {
  console.error("usage: node build.mjs <spec.mjs> [out.html]");
  process.exit(1);
}
const specPath = resolve(specArg);
const outPath = outArg
  ? resolve(outArg)
  : join(dirname(specPath), basename(specPath).replace(/\.m?js$/, "") + ".html");

const spec = (await import(pathToFileURL(specPath).href)).default;

// Each graph domain states how to name an untitled page and what to print above the heading, so
// the shell below stays free of per-domain special cases.
const DOMAINS = {
  material: {
    module: "./material/emit-t3d.mjs",
    subject: (s) => s.material,
    eyebrow: "Unreal material graph",
    fallback: "Material Graph",
    pasteHeading: "Paste this into the Material Editor",
    pasteSub: "This is the text Unreal itself writes when you copy nodes. Select it and press "
      + "Ctrl+C, then open a material and press Ctrl+V &mdash; the network arrives with its "
      + "wiring and layout intact.",
  },
  niagara: {
    module: "./niagara/emit-t3d.mjs",
    subject: (s) => s.script,
    eyebrow: "Unreal Niagara graph",
    fallback: "Niagara Graph",
    pasteHeading: "Paste this into a Niagara script graph",
    pasteSub: "This is the text Unreal itself writes when you copy nodes in a scratch pad. "
      + "Select it and press Ctrl+C, then open a scratch pad module and press Ctrl+V &mdash; "
      + "the nodes arrive with their wiring and layout intact.",
    // The nodes live Base64'd inside the wrapper, so counting the outer text would report one
    // node and no pins for every graph.
    countable: (t3d, api) => api.decodeExportedNodes(t3d),
    // Which stage runs the module. A script graph without it leaves the reader knowing what the
    // nodes do and not where they go.
    stages: ["Emitter Spawn", "Emitter Update", "Particle Spawn", "Particle Update", "Render"],
  },
};

const domainOf = (s) => s.domain ?? (s.script ? "niagara" : "material");

// A single-graph spec is one section; writing it that way keeps one code path.
const sections = spec.sections ?? [{ type: domainOf(spec), ...spec }];

// Literal replacement — avoids $& / $1 expansion in String.replace patterns.
const putAll = (haystack, needle, value) => haystack.split(needle).join(value);
const put = (haystack, needle, value) => {
  const at = haystack.indexOf(needle);
  if (at < 0) throw new Error(`placeholder not found: ${needle}`);
  return haystack.slice(0, at) + value + haystack.slice(at + needle.length);
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const css = read("vendor/bue-render.css");
const external = css.match(/url\((?!['"]?data:)[^)]*\)/);
if (external) throw new Error(`renderer css would be CSP-blocked: ${external[0]}`);

const stats = [];
const parts = [];
const sources = [];

for (const [i, section] of sections.entries()) {
  const heading = section.heading ? `    <h2>${esc(section.heading)}</h2>\n` : "";
  const body = section.body ? renderProse(section.body) : "";

  if (section.type === "prose") {
    parts.push(`  <section>\n${heading}${body}  </section>`);
    continue;
  }

  if (section.type === "stack") {
    // A stack section draws by default and only emits paste payloads when it asks to, because
    // the two want different things from a spec. A picture is happy with "Spawn Count:
    // MaxTrajectoryCount × SegmentsPerTrajectory"; a payload needs a number. Opting in is what
    // turns every module name, input name, type and value into something the build checks.
    const pastes = (section.stages ?? []).map((stage, n) => {
      const t3d = section.paste ? emitStackT3D(stage) : null;
      if (!t3d) return null;
      const id = `stack-${i}-${n}`;
      stats.push({
        label: `${section.emitter ?? "stack"} — ${stage.stage}`,
        modules: (stage.modules ?? []).length,
        inputs: (t3d.match(/^\s*InputName=/gm) ?? []).length,
      });
      // Each payload sits under its own stage, so "this stage" is unambiguous without repeating
      // the stage name in the heading.
      return `          <div class="src-head">
            <div>
              <h3>Paste this stage</h3>
              <p class="sub">Select exactly one row in this stage of the target emitter &mdash; a
              multi-selection is refused &mdash; then press Ctrl+V.</p>
            </div>
            <button type="button" data-copies="${id}">Select T3D</button>
          </div>
          <pre id="${id}">${esc(t3d)}</pre>`;
    });
    parts.push(`  <section>\n${heading}${body}${renderStack(section, pastes)}  </section>`);
    continue;
  }

  const domain = DOMAINS[section.type];
  if (!domain) {
    throw new Error(`unknown section type "${section.type}" — expected prose, stack, `
      + Object.keys(DOMAINS).join(" or "));
  }

  const api = await import(pathToFileURL(join(here, domain.module)).href);
  const t3d = api.emitT3D(section);
  const id = `graph-${i}`;
  const srcId = `src-${i}`;
  const height = `${section.height ?? spec.height ?? 560}px`;

  const counted = domain.countable ? domain.countable(t3d, api) : t3d;
  stats.push({
    label: section.heading ?? domain.subject(section) ?? domain.fallback,
    nodes: (counted.match(/^Begin Object Class=/gm) ?? []).length,
    pins: (counted.match(/CustomProperties Pin \(/g) ?? []).length,
    wires: section.nodes.reduce((total, n) => total + Object.keys(n.in ?? {}).length, 0),
  });

  // Two ids, on purpose: the hidden textarea the renderer reads and the <pre> the reader copies
  // hold the same text, and giving both the same id makes getElementById return the <pre>, whose
  // `.value` is undefined — a graph panel that stays blank with no error.
  parts.push(`  <section>
${heading}${body}    <div class="panel" data-graph="${id}" data-height="${height}">
      <div class="playground" style="min-height:${height}"></div>
    </div>
    <div class="src-head">
      <div>
        <h3>${esc(section.pasteHeading ?? domain.pasteHeading)}</h3>
        <p class="sub">${section.pasteSub ?? domain.pasteSub}</p>
      </div>
      <button type="button" data-copies="${srcId}">Select T3D</button>
    </div>
    <pre id="${srcId}">${esc(t3d)}</pre>
  </section>`);
  sources.push(`<textarea id="${id}" hidden>${esc(t3d)}</textarea>`);
}

// A stage row, when the spec says which stage a single-graph page is in. A guide page states
// that per stack section instead, so it is skipped there.
const contextStrip = () => {
  const stage = spec.stage;
  if (!stage || spec.sections) return "";
  const stages = spec.stages ?? DOMAINS[domainOf(spec)]?.stages ?? [];
  const all = stages.includes(stage) ? stages : [...stages, stage];
  const items = all
    .map((s) => `      <li${s === stage ? ' aria-current="step"' : ""}>${esc(s)}</li>`)
    .join("\n");
  return `    <ul class="stages">\n${items}\n    </ul>\n`;
};

const first = DOMAINS[domainOf(spec)];
const heading = spec.title ?? first?.subject(spec) ?? "Unreal Graph";
const eyebrow = spec.eyebrow ?? (spec.sections ? "Unreal build guide" : first?.eyebrow);

let html = read("page.template.html");
html = put(html, "__TITLE__", esc(heading));
html = put(html, "__EYEBROW__", esc(eyebrow));
html = put(html, "__HEADING__", esc(heading));
html = put(html, "__DEK__", esc(spec.summary ?? ""));
html = put(html, "__CONTEXT_STRIP__", contextStrip());
html = put(html, "__SECTIONS__", `${parts.join("\n\n")}\n\n${sources.join("\n")}\n`);
html = put(html, "__BUE_CSS__", css);
html = put(html, "__BUE_JS__", read("vendor/bue-render.js"));

writeFileSync(outPath, html);

console.log(`${outPath}  ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
for (const s of stats) {
  console.log(s.modules === undefined
    ? `  ${s.nodes} nodes, ${s.pins} pins, ${s.wires} wires — ${s.label}`
    : `  ${s.modules} modules, ${s.inputs} inputs — ${s.label}`);
}
if (!stats.length) console.log(`  ${sections.length} section(s), no graphs`);
