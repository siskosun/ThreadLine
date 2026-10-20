const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'..','panel.html'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'..','capture-ui.js'),'utf8');
test('ChatGPT webpage analysis is the visible default and Ollama remains optional',()=>{
  const selector=html.match(/<select id="ai-provider">([\s\S]*?)<\/select>/);
  assert.ok(selector);
  assert.match(selector[1],/^\s*<option value="webui" selected>/);
  assert.match(selector[1],/<optgroup label="其他模型方式（可选）">/);
  assert.match(selector[1],/<option value="ollama">/);
  assert.match(selector[1],/<option value="openai">/);
  assert.match(js,/\$\("ai-model"\)\.parentElement\.hidden=true/);
  assert.match(js,/\$\("ai-run"\)\.textContent=mode==="webui"/);
});
