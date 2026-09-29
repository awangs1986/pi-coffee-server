import { build } from "esbuild";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Browser bundle for the Diff panel: @pierre/diffs (Apache-2.0) with Shiki (MIT).
// public/vendor/diffs.js keeps a stable name and is loaded on the first Diff open;
// everything else is a flat, content-hashed chunk (diffs-<hash>.js) that the Web
// Server may cache for good. Shiki grammars and themes stay separate lazy chunks,
// so a Diff only downloads the languages it shows. Versions are pinned by
// package-lock; the output is generated and git-ignored like public/vendor-*.js.
const here = dirname(fileURLToPath(import.meta.url));
// The renderer's few visible strings are English literals; the shell is Chinese (docs/spec/arena-navigation.md).
// They are replaced in the pinned @pierre/diffs sources while bundling. A missing literal fails the build,
// so a version bump cannot silently bring the English back.
const TRANSLATIONS = [
  ["renderers/DiffHunksRenderer.js", '`${lines} unmodified line${EN_PLURAL_RULES.select(lines) === "one" ? "" : "s"}`', "`${lines} 行未改动`"],
  ["renderers/DiffHunksRenderer.js", '"More unchanged context may be available"', '"后面可能还有未改动的行"'],
  ["utils/createSeparator.js", 'createTextNodeElement("Expand all")', 'createTextNodeElement("全部展开")'],
  ["utils/createNoNewlineElement.js", 'createTextNodeElement("No newline at end of file")', 'createTextNodeElement("文件末尾没有换行符")'],
];
const applied = new Set();
const translate = {
  name: "pi-coffee-zh",
  setup(bundle) {
    bundle.onLoad({ filter: /[\\/]@pierre[\\/]diffs[\\/]dist[\\/].*\.js$/ }, async (args) => {
      const path = args.path.replaceAll("\\", "/");
      const rules = TRANSLATIONS.filter(([file]) => path.endsWith("/@pierre/diffs/dist/" + file));
      if (!rules.length) return undefined;
      let contents = await readFile(args.path, "utf8");
      for (const rule of rules) {
        if (!contents.includes(rule[1])) throw new Error(`@pierre/diffs changed: ${rule[0]} no longer contains ${rule[1]}`);
        contents = contents.replaceAll(rule[1], rule[2]);
        applied.add(rule);
      }
      return { contents, loader: "js" };
    });
  },
};
const root = resolve(here, "..");
const outdir = resolve(root, "public/vendor");
await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints: { diffs: resolve(here, "vendor-diffs.js") },
  outdir,
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  target: "es2022",
  platform: "browser",
  entryNames: "[name]",
  chunkNames: "diffs-[hash]",
  assetNames: "diffs-[hash]",
  charset: "utf8",
  legalComments: "eof",
  logLevel: "warning",
  plugins: [translate],
});
const missing = TRANSLATIONS.filter((rule) => !applied.has(rule));
if (missing.length) throw new Error("Untranslated @pierre/diffs strings: " + missing.map((rule) => rule[1]).join(", "));
const files = await readdir(outdir);
let bytes = 0;
for (const file of files) bytes += (await stat(resolve(outdir, file))).size;
console.log(`public/vendor: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
