import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const extension = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const result = await build({
  entryPoints: [path.join(extension, "argdown-adapter.source.js")],
  bundle: true,
  format: "iife",
  globalName: "ThreadLineArgdown",
  target: ["chrome141"],
  minify: true,
  legalComments: "inline",
  write: false
});
const expected = result.outputFiles[0].text.replace(/[ \t]+(?=\r?\n)/g, "");
const output = path.join(extension, "vendor", "argdown-adapter.js");
if (readFileSync(output, "utf8") !== expected) {
  throw new Error("Argdown bundle is stale; run npm run build:argdown and commit the regenerated vendor file.");
}
console.log(`Argdown bundle reproduction check: ${Buffer.byteLength(expected)} bytes`);
