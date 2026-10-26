import { readFileSync } from "node:fs";
import Adapter from "../argdown-adapter.source.js";

const sourcePath = process.argv[2];
if (!sourcePath) {
  throw new Error("Usage: npm run argdown:preview -- <file.argdown>");
}

const input = readFileSync(sourcePath, "utf8");
// This is intentionally a local developer preview, never an extension import.
// The panel must require a human to confirm every suggested relationship.
process.stdout.write(`${JSON.stringify(Adapter.parse(input), null, 2)}\n`);
