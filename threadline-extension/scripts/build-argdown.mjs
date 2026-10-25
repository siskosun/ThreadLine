import { build } from "esbuild";
import { statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extension = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.join(extension, "vendor", "argdown-adapter.js");
const result = await build({
  entryPoints: [path.join(extension, "argdown-adapter.source.js")],
  outfile: output,
  bundle: true,
  format: "iife",
  globalName: "ThreadLineArgdown",
  target: ["chrome141"],
  minify: true,
  legalComments: "inline",
  write: false
});
// Esbuild preserves spaces at the end of third-party diagnostic template lines.
// Trim only physical trailing whitespace so generated artifacts pass repository
// whitespace checks without changing parser code paths.
writeFileSync(output, result.outputFiles[0].text.replace(/[ \t]+(?=\r?\n)/g, ""));
const bytes = statSync(output).size;
console.log(`Argdown browser bundle: ${bytes} bytes (the 200 KiB limit applies only to imported text).`);
