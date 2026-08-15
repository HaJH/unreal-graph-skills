// Builds a self-contained material-graph page from a spec.
//
//   node build.mjs <spec.mjs> [out.html]
//
// The renderer (bue-render, the one blueprintue.com runs) is inlined whole, so
// the result makes zero network requests — required, because the Artifact CSP blocks every
// external host.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { emitT3D } from "./emit-t3d.mjs";

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

let html = read("page.template.html");
// A flat, wide chain wastes a tall frame; a spec can ask for a shorter one.
html = putAll(html, "__PANEL_HEIGHT__", `${spec.height ?? 560}px`);
html = put(html, "__TITLE__", esc(spec.title ?? spec.material ?? "Material Graph"));
html = put(html, "__EYEBROW__", esc(spec.eyebrow ?? "Unreal material graph"));
html = put(html, "__HEADING__", esc(spec.title ?? spec.material ?? "Material Graph"));
html = put(html, "__DEK__", esc(spec.summary ?? ""));
html = put(html, "__BUE_CSS__", css);
html = put(html, "__T3D_TEXTAREA__", esc(t3d));
html = put(html, "__T3D_ESCAPED__", esc(t3d));
html = put(html, "__BUE_JS__", read("vendor/bue-render.js"));

writeFileSync(outPath, html);

const nodes = (t3d.match(/^Begin Object Class=/gm) ?? []).length;
const pins = (t3d.match(/CustomProperties Pin \(/g) ?? []).length;
// Count wires from the spec: an output feeding two inputs writes one LinkedTo on the output
// and one on each input, so counting LinkedTo occurrences does not halve cleanly.
const wires = spec.nodes.reduce((total, n) => total + Object.keys(n.in ?? {}).length, 0);
console.log(`${outPath}  ${Math.round(Buffer.byteLength(html) / 1024)} KB`);
console.log(`  ${nodes} nodes, ${pins} pins, ${wires} wires`);
