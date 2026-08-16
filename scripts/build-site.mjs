// Builds every spec in examples/ into _site/, plus an index that links them.
//
//   node scripts/build-site.mjs [outDir]
//
// This is what the Pages workflow runs. Nothing it produces is committed — the pages are
// rebuilt from the specs on every push, so the demo cannot drift from the source.
import { execFileSync } from "node:child_process";
import { readdirSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(process.argv[2] ?? join(root, "_site"));
mkdirSync(outDir, { recursive: true });

// examples/ is one directory per domain, so a page can say which editor it belongs to and the
// index can group them.
const domains = readdirSync(join(root, "examples"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const specs = domains.flatMap((domain) =>
  readdirSync(join(root, "examples", domain))
    .filter((f) => f.endsWith(".spec.mjs"))
    .sort()
    .map((file) => ({ domain, file })));
if (!specs.length) throw new Error("no specs in examples/");

const built = [];
for (const { domain, file } of specs) {
  const name = basename(file, ".spec.mjs");
  const out = join(outDir, `${name}.html`);
  const specPath = join(root, "examples", domain, file);
  execFileSync(process.execPath, [join(root, "build.mjs"), specPath, out], { stdio: "inherit" });
  const { title, summary } = (await import(`file://${specPath}`)).default;
  built.push({
    name, domain,
    title: title ?? name,
    summary: summary ?? "",
    kb: Math.round(statSync(out).size / 1024),
  });
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Same palette as the generated pages, so the index does not look like a different project.
writeFileSync(join(outDir, "index.html"), `<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>unreal-graph-skills — examples</title>
<style>
:root{color-scheme:light dark;--ground:#f4f6f8;--surface:#fff;--ink:#151a22;--ink-soft:#5b6673;--line:#dee3ea;--accent:#c25f16}
@media (prefers-color-scheme:dark){:root{--ground:#0e1117;--surface:#161b23;--ink:#e6eaf0;--ink-soft:#93a0b1;--line:#252c37;--accent:#f0913f}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font:16px/1.6 Roboto,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:760px;margin:0 auto;padding:64px 24px 80px}
.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:12px;color:var(--accent);margin:0}
h1{font-size:clamp(32px,5vw,46px);line-height:1.05;margin:10px 0 0;text-wrap:balance}
.dek{margin:14px 0 0;color:var(--ink-soft);max-width:62ch}
ul{list-style:none;padding:0;margin:40px 0 0;display:flex;flex-direction:column;gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
a.item{display:block;background:var(--surface);padding:20px 22px;text-decoration:none;color:inherit}
a.item:hover{background:var(--ground)}
.t{font-size:19px;font-weight:600}
.s{color:var(--ink-soft);font-size:14.5px;margin-top:4px}
.k{color:var(--ink-soft);font-size:12.5px;margin-top:8px;font-variant-numeric:tabular-nums}
.foot{margin-top:40px;color:var(--ink-soft);font-size:13.5px;border-top:1px solid var(--line);padding-top:20px}
.foot a{color:var(--accent)}
</style>
<div class="wrap">
  <p class="eyebrow">unreal-graph-skills</p>
  <h1>Example graphs</h1>
  <p class="dek">Each page is a single self-contained file: the renderer is inlined, so it
  makes no network requests. Drag to pan, scroll to zoom, and the T3D below every graph
  pastes straight back into the editor it came from.</p>
  <ul>
${built.map((b) => `    <li><a class="item" href="${b.name}.html">
      <div class="t">${escape(b.title)}</div>
      <div class="s">${escape(b.summary)}</div>
      <div class="k">${escape(b.domain)} &middot; ${b.kb} KB &middot; no network requests</div>
    </a></li>`).join("\n")}
  </ul>
  <p class="foot">Built from <a href="https://github.com/HaJH/unreal-graph-skills">the specs in this repository</a>.</p>
</div>
`);

console.log(`\n${built.length} page(s) + index -> ${outDir}`);
