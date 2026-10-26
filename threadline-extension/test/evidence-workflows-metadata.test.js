'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../evidence-core.js');
const TopicCore=require('../core.js');
const Workflows=require('../evidence-workflows.js');

function makePreviewHarness(){
  const data={
    projects:{},conclusions:{},versions:{},sources:{},links:{},operations:{},
  };
  const handlers=Workflows.create({
    chrome:{storage:{local:{async get(){return{threadline_state_v1:TopicCore.emptyState()};}}}},
    Core:{...Core,async validateExportPackage(){return true;}},
    TopicCore,
    DB:{async snapshot(){return data;}},
    Lifecycle:{async planRestore(){return{replay:null};}},
    async db(){return{};},
    async serialize(fn){return fn();},
  });
  const preview=(meta)=>{
    const pkg={format:'threadline-evidence/3',projectId:'p_good',
      conclusions:[],versions:[],links:[],sources:[]};
    return handlers.handle({type:'EV_RESTORE_PREVIEW',
      backup:{format:'threadline-project-backup/1',topic:meta,evidence:pkg},
      replace:false});
  };
  return {handlers,preview};
}
test('direct workflow rejects own __proto__ and unsupported state metadata before restore preview',async()=>{
  const {preview}=makePreviewHarness();
  const valid={id:'p_good',name:'good',goal:'',stage:'active'};
  const prototype=JSON.parse('{"id":"p_good","name":"good","goal":"","stage":"active","__proto__":{"polluted":true}}');
  assert.equal(Object.hasOwn(prototype,'__proto__'),true,'test must retain the dangerous own key');
  for(const extra of [prototype,
    {...valid,history:[{version:999,field:'decision',after:'fake'}]},
    {...valid,knowledgeVersion:999999,decision:'fake'},
    {...valid,constructor:{polluted:true}},
    {...valid,evidenceTakeover:false}]){
    await assert.rejects(preview(extra),/备份课题包含不支持的元信息字段/);
  }
});
test('legitimate legacy and four-field topic metadata stay import-preview compatible',async()=>{
  const {preview}=makePreviewHarness();
  const valid={id:'p_good',name:'Legitimate',goal:'',stage:'active'};
  const wrapped=await preview(valid);
  assert.deepEqual(wrapped.topic,valid);
  const legacy=await preview(null);
  assert.equal(legacy.topic.id,'p_good');
  assert.equal(legacy.topic.name,'恢复的课题 p_good');
});
test('delete preview rejects inherited property names at the same project-id gate',async()=>{
  const {handlers}=makePreviewHarness();
  for(const id of ['toString','valueOf','hasOwnProperty','__proto__','constructor','prototype']){
    await assert.rejects(
      handlers.handle({type:'EV_DELETE_PREVIEW',projectId:id}),
      /课题 ID 无效或保留名称/,
      id);
  }
});
