const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path");
const Evidence=require("../evidence-core.js"), Workflows=require("../evidence-workflows.js");
const ext=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
test("S1 production worker and panel do not require S2-S5 runtime",()=>{
 const background=ext("background.js"),workflows=ext("evidence-workflows.js"),html=ext("panel.html");
 assert.ok(background.includes("evidence-workflows.js"));
 assert.ok(!background.includes("research-core.js"));
 assert.ok(!background.includes("ThreadLineResearchCore"));
 assert.ok(!workflows.includes("EV_RESEARCH_COMMAND"));
 assert.ok(!html.includes('src="research-ui.js"'));
 assert.ok(!html.includes('src="argdown-ui.js"'));
 assert.ok(!html.includes('src="vendor/argdown-adapter.js"'));
});
test("S1 /3 backup with handoff history validates without research-core",async()=>{
 const blank={format:"threadline-evidence/3",projectId:"p1",project:{takeover:false,handoffs:[]},conclusions:[],versions:[],sources:[],links:[]};
 assert.equal(await Evidence.validateExportPackage(blank),true);
 await assert.rejects(()=>Evidence.validateExportPackage({...blank,project:{takeover:false,research:{schema:1}}}),/S2–S4/);
});
test("S1 workflow rejects S2-S5 commands before any storage access",async()=>{
 const api=Workflows.create({});
 for(const type of ["EV_RESEARCH_LIST","EV_RESEARCH_COMMAND","EV_REVIEW_PREPARE","EV_REVIEW_COMPLETE","EV_DEPENDENCY_PROMPT","EV_SUGGESTIONS_PREVIEW"])
  assert.equal(await api.handle({type}),undefined);
});
