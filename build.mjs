// Builds a self-contained graph page from a spec.
//
//   node build.mjs <spec.mjs> [out.html]
//
// The domain is read off the spec: a `material` key builds Material Editor T3D, a `script` key
// builds a Niagara script graph. `domain: "material" | "niagara"` overrides the guess.
//
// The renderer (bue-render, the one blueprintue.com runs) is inlined whole, so the result
// makes zero network requests — required, because the Artifact CSP blocks every external host.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// Each domain states how to name an untitled page and what to print above the heading, so the
// shell below stays free of per-domain special cases.
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
const key = domainOf(spec);
const domain = DOMAINS[key];
if (!domain) throw new Error(`unknown domain "${key}" — expected one of ${Object.keys(DOMAINS)}`);

const api = await import(pathToFileURL(join(here, domain.module)).href);
const { emitT3D } = api;

// Literal replacement — avoids $& / $1 expansion in String.replace patterns.
const putAll = (haystack, needle, value) => haystack.split(needle).join(value);
const put = (haystack, needle, value) => {
  const at = haystack.indexOf(needle);
  if (at < 0) throw new Error(`placeholder not found: ${needle}`);
  return haystack.slice(0, at) + value + haystack.slice(at + needle.length);
};

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const css = read("vendor/bue-render.css");
const external = css.match(/url\((?!['"]?data:)[^)]*\)/);
if (external) throw new Error(`renderer css would be CSP-blocked: ${external[0]}`);

const t3d = emitT3D(spec);
const heading = spec.title ?? domain.subject(spec) ?? domain.fallback;

// A stage row, when the domain has stages and the spec says which one it is in. A spec may
// name a stage outside the default list (a simulation stage, an event handler) and it is
// appended rather than rejected.
const contextStrip = () => {
  if (!spec.stage) return "";
  const stages = spec.stages ?? domain.stages ?? [];
  const all = stages.includes(spec.stage) ? stages : [...stages, spec.stage];
  const items = all
    .map((s) => `      <li${s === spec.stage ? ' aria-current="step"' : ""}>${esc(s)}</li>`)
    .join("\n");
  return `    <ul class="stages">\n${items}\n    </ul>\n`;
};

let html = read("page.template.html");
// A flat, wide chain wastes a tall frame; a spec can ask for a shorter one.
html = putAll(html, "__PANEL_HEIGHT__", `${spec.height ?? 560}px`);
html = put(html, "__TITLE__", esc(heading));
html = put(html, "__EYEBROW__", esc(spec.eyebrow ?? domain.eyebrow));
html = put(html, "__HEADING__", esc(heading));
html = put(html, "__DEK__", esc(spec.summary ?? ""));
html = put(html, "__CONTEXT_STRIP__", contextStrip());
html = put(html, "__PASTE_HEADING__", esc(domain.pasteHeading));
// Raw: the copy carries an entity, and it is ours rather than spec-supplied.
html = put(html, "__PASTE_SUB__", domain.pasteSub);
html = put(html, "__BUE_CSS__", css);
html = put(html, "__T3D_TEXTAREA__", esc(t3d));
html = put(html, "__T3D_ESCAPED__", esc(t3d));
html = put(html, "__BUE_JS__", read("vendor/bue-render.js"));

writeFileSync(outPath, html);

const counted = domain.countable ? domain.countable(t3d, api) : t3d;
const nodes = (counted.match(/^Begin Object Class=/gm) ?? []).length;
const pins = (counted.match(/CustomProperties Pin \(/g) ?? []).length;
// Count wires from the spec: an output feeding two inputs writes one LinkedTo on the output
// and one on each input, so counting LinkedTo occurrences does not halve cleanly.
const wires = spec.nodes.reduce((total, n) => total + Object.keys(n.in ?? {}).length, 0);
console.log(`${outPath}  ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
console.log(`  ${nodes} nodes, ${pins} pins, ${wires} wires`);
