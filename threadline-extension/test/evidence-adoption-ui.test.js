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
  assert.match(ui,/每条依据都必须填写并核对片段/);
  assert.match(ui,/ThreadLineEvidenceAdoption/);
  assert.doesNotMatch(ui,/\.slice\(0,\s*(?:2000|3900)\)/);
  assert.doesNotMatch(ui,/maxLength/);
  assert.match(ui,/原始消息全文（只读）/);
  assert.match(ui,/使用上方选中文本/);
  assert.match(ui,/每条结论最多 8 个依据片段/);
  assert.match(ui,/selectionStart/);
});
test('ordinary findings use capture-backed adoption instead of legacy decision mutation',()=>{
  assert.match(capture,/EV_ADOPT_CAPTURE/);
  assert.match(capture,/captureRunId:x\.source\.captureRunId/);
  assert.match(capture,/selections:form\.selections\.map/);
  assert.match(capture,/content:m\.content/);
  assert.match(capture,/未提供来源编号，请手选原始消息/);
  assert.doesNotMatch(capture,/patch:\{decision\}/);
});
test('fork adoption requires persisted exact reply provenance and does not label truncation complete',()=>{
  assert.match(fork,/EV_ADOPT_FORK/);
  assert.match(fork,/evidence\?\.captureRunId/);
  assert.match(fork,/evidence\?\.messageId/);
  assert.match(fork,/content:reply/);
  assert.match(fork,/selections:form\.selections\.map/);
  assert.doesNotMatch(fork,/reply\.slice\(0,\s*(?:2000|3900)\)/);
});
