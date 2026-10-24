const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

test('syntax scanner resolves extension root independent of working directory', () => {
  const script = path.join(__dirname, '..', 'scripts', 'check-syntax.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const match = result.stdout.match(/Syntax check passed: (\d+) JavaScript files/);
  assert.ok(match, result.stdout);
  assert.ok(Number(match[1]) >= 20, 'scanner must not silently inspect an empty or wrong directory');
});
