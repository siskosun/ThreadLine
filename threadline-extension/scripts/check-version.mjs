import assert from 'node:assert/strict';
import fs from 'node:fs';
const base = new URL('../', import.meta.url);
const read=name=>fs.readFileSync(new URL(name,base),'utf8');
const version=JSON.parse(read('manifest.json')).version;
const pkg=JSON.parse(read('package.json'));
assert.equal(pkg.version,version,'manifest/package version mismatch');
for (const name of ['README.md','CHANGELOG.md','VERIFY.md'])
  assert.ok(read(name).includes('v'+version),`${name} missing v${version}`);
console.log('Version check passed: '+version);
