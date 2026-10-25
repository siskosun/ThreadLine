const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync, readFileSync, rmSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const http = require("node:http");

function adapter() { return require("../argdown-adapter.source.js"); }

test("official Argdown parser maps statement relations into preview-only rows", async () => {
  const Argdown = await adapter();
  const parsed = Argdown.parse("[con_abcdefgh]: 上游事实\n  +> [con_ijklmnop]: 下游判断");
  assert.deepEqual(parsed.statements.map(x => x.label).sort(), ["con_abcdefgh", "con_ijklmnop"]);
  assert.deepEqual(parsed.relations, [{fromLabel:"con_abcdefgh",toLabel:"con_ijklmnop",type:"support"}]);
});

test("export retains stable conclusion labels and support direction", async () => {
  const Argdown = await adapter();
  const text = Argdown.exportEvidence({
    rows:[{conclusion:{id:"con_abcdefgh"},current:{text:"上游 [特殊] 文本"}}, {conclusion:{id:"con_ijklmnop"},current:{text:"下游判断"}}],
    edges:[{upstreamConclusionId:"con_abcdefgh",downstreamConclusionId:"con_ijklmnop",active:true}]
  });
  const parsed = Argdown.parse(text);
  assert.equal(parsed.statements.find(x=>x.label==="con_abcdefgh").text, "上游 [特殊] 文本");
  assert.deepEqual(parsed.relations, [{fromLabel:"con_abcdefgh",toLabel:"con_ijklmnop",type:"support"}]);
});

test("syntax errors and oversized payloads reject without partial preview", async () => {
  const Argdown = await adapter();
  assert.throws(() => Argdown.parse("[con_abcdefgh]: broken\n  +>"), /Argdown 语法无效/);
  assert.throws(() => Argdown.parse("x".repeat(Argdown.MAX_BYTES + 1)), /200 KiB/);
});

test("the bounded CLI bridge returns an official-parser preview", () => {
  const fixture = join(tmpdir(), `threadline-argdown-${process.pid}.argdown`);
  writeFileSync(fixture, "[con_abcdefgh]: 上游\n  +> [con_ijklmnop]: 下游", "utf8");
  try {
    const result = spawnSync(process.execPath, ["scripts/argdown-preview.mjs", fixture], {
      cwd: join(__dirname, ".."), encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).relations, [
      {fromLabel:"con_abcdefgh",toLabel:"con_ijklmnop",type:"support"}
    ]);
  } finally {
    rmSync(fixture, { force: true });
  }
});

test("browser bundle runs under an isolated script-src self CSP", async (t) => {
  const browser = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  if (!require("node:fs").existsSync(browser)) return t.skip("Chrome is unavailable on this host");
  const extension = join(__dirname, "..");
  const reproduction = spawnSync(process.execPath, ["scripts/check-argdown-build.mjs"], { cwd: extension, encoding: "utf8" });
  assert.equal(reproduction.status, 0, reproduction.stderr);
  const bundle = readFileSync(join(extension, "vendor", "argdown-adapter.js"), "utf8");
  assert.doesNotMatch(bundle, /\beval\s*\(|\bnew\s+Function\b/);
  const probe = `try { const result = ThreadLineArgdown.parse("[con_abcdefgh]: A\\n  +> [con_ijklmnop]: B"); document.body.textContent = "TL_ARGDOWN_OK " + JSON.stringify(result.relations); } catch (error) { document.body.textContent = "TL_ARGDOWN_ERROR " + error.message; }`;
  const server = http.createServer((request, response) => {
    if (request.url === "/argdown-adapter.js") {
      response.writeHead(200, { "Content-Type": "application/javascript", "Content-Security-Policy": "default-src 'none'; script-src 'self'" });
      return response.end(bundle);
    }
    if (request.url === "/probe.js") {
      response.writeHead(200, { "Content-Type": "application/javascript", "Content-Security-Policy": "default-src 'none'; script-src 'self'" });
      return response.end(probe);
    }
    response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; script-src 'self'; base-uri 'none'" });
    response.end('<!doctype html><body>pending<script src="/argdown-adapter.js"></script><script src="/probe.js"></script></body>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const profile = mkdtempSync(join(tmpdir(), "threadline-argdown-edge-"));
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--virtual-time-budget=1000", `--user-data-dir=${profile}`, "--dump-dom", `http://127.0.0.1:${port}/`], { windowsHide: true });
      let stdout = "", stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve(stdout) : reject(new Error(`Chrome exited ${code}: ${stderr}`)));
    });
    assert.match(output, /TL_ARGDOWN_OK/);
    assert.match(output, /"type":"support"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    // Chromium can keep crash-report handles briefly after --dump-dom exits.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch {}
  }
}, { timeout: 30000 });
