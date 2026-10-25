const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(base,'evidence-adoption-ui.js'),'utf8');
const capture=fs.readFileSync(path.join(base,'capture-ui.js'),'utf8');
const fork=fs.readFileSync(path.join(base,'ff-page.js'),'utf8');

test('adoption dialog requires explicit conclusion and source excerpt without truncation',()=>{
  assert.match(ui,/结论正文超过 4,000 字符/);
  assert.match(ui,/请填写并核对依据片段/);
  assert.match(ui,/ThreadLineEvidenceAdoption/);
  assert.doesNotMatch(ui,/\.slice\(0,\s*(?:2000|3900)\)/);
});
test('ordinary findings use capture-backed adoption instead of legacy decision mutation',()=>{
  assert.match(capture,/EV_ADOPT_CAPTURE/);
  assert.match(capture,/captureRunId:form\.source\.captureRunId/);
  assert.match(capture,/未提供来源编号，请手选原始消息/);
  assert.doesNotMatch(capture,/patch:\{decision\}/);
});
test('fork adoption requires persisted exact reply provenance and does not label truncation complete',()=>{
  assert.match(fork,/EV_ADOPT_FORK/);
  assert.match(fork,/evidence\?\.captureRunId/);
  assert.match(fork,/evidence\?\.messageId/);
  assert.doesNotMatch(fork,/reply\.slice\(0,\s*(?:2000|3900)\)/);
});
