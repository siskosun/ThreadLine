const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'panel.html'),'utf8');
const css=fs.readFileSync(path.join(root,'panel.css'),'utf8');
const js=fs.readFileSync(path.join(root,'panel.js'),'utf8');
test('three workspace tabs have equal columns and visible keyboard focus',()=>{
  const tabs=[...html.matchAll(/id="nav-(switch|research|evidence)" data-workspace="\1"/g)];
  assert.equal(tabs.length,3);
  assert.match(css,/\.workspace-tabs\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.workspace-tabs button:focus-visible\{[^}]*outline:/);
  assert.match(css,/@media\(max-width:480px\)\{\.workspace-tabs \.nav-icon\{display:none\}\}/);
});
test('empty-state actions distinguish no-project, no-evidence, unavailable store',()=>{
  for(const id of ['evidence-empty','evidence-go-create','evidence-go-research'])
    assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(js,/showEvidenceEmpty\("no-project"\)/);
  assert.match(js,/showEvidenceEmpty\(evidenceHasRows\?null:"no-evidence"\)/);
  assert.match(js,/证据库不可用：/);
  assert.match(js,/showEvidenceEmpty\(null\)/);
  assert.match(js,/ev\$\("manage-accordion"\)\.open=true/);
  assert.match(js,/ev\$\("topic-name"\)\.focus\(\)/);
  assert.match(js,/setWorkspace\("research",true\)/);
  assert.match(js,/ev\$\("evidence-handoff"\)\.disabled=true/);
});
