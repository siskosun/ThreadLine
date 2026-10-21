// ThreadLine's GitHub-only development plan gate. Node 22+, no npm dependencies.
// Local mode validates exact Markdown state and evidence structure.
// --github additionally confirms merged PRs, their green CI, and recorded human signoffs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set(['planned','in_progress','in_review','blocked','done','deferred']);
export const REQUIRED = Object.freeze([
  'R-REUSE','Z0-BASE','Z0-LIVE','P1-CORE','P2-FORK','P3-REPORT','BETA-RELEASE','P4-AUTO'
]);
const CODE_TASKS = new Set(['Z0-BASE','P1-CORE','P2-FORK','P3-REPORT','BETA-RELEASE','P4-AUTO']);
const SHA40 = /^[a-f0-9]{40}$/;

function check(ok, message) {
  if (!ok) throw new Error('Plan gate: ' + message);
}
function plainCell(s) { return s.trim().replace(/^`|`$/g,''); }

export function parseTaskTable(markdown) {
  const startToken = '<!-- PLAN_TASKS_START -->';
  const endToken = '<!-- PLAN_TASKS_END -->';
  check(markdown.split(startToken).length===2 && markdown.split(endToken).length===2,'missing/duplicate plan task markers');
  const start = markdown.indexOf(startToken)+startToken.length;
  const end = markdown.indexOf(endToken);
  check(end>start,'task markers in wrong order');
  const lines = markdown.slice(start,end).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  check(lines.length>=3,'missing task table');
  const columns = row => {
    check(row.startsWith('|') && row.endsWith('|'), 'invalid table row: '+row);
    return row.slice(1,-1).split('|').map(plainCell);
  };
  const head=columns(lines[0]);
  check(head.join('|')==='ID|阶段与目标|状态|依赖|完成条件|证据|人工门禁','task table header changed');
  const separator=columns(lines[1]);
  check(separator.length===7 && separator.every(c=>/^:?-{3,}:?$/.test(c)),'invalid task table separator');
  const tasks=lines.slice(2).map(row=>{
    const c=columns(row);
    check(c.length===7,'task row needs seven columns');
    const [id,title,status,depend,acceptance,evidence,manual]=c;
    check(/^[A-Z][A-Z0-9-]{2,32}$/.test(id),'invalid task ID '+id);
    check(title.length>=4 && acceptance.length>=8,'task title/acceptance incomplete: '+id);
    check(ALLOWED.has(status),'invalid task status: '+id+' '+status);
    check(['yes','no'].includes(manual),'invalid manual gate: '+id);
    const dependencies=depend==='-'?[]:depend.split(',').map(x=>x.trim()).filter(Boolean);
    check(depend==='-'||dependencies.length>0,'empty task dependency: '+id);
    check(new Set(dependencies).size===dependencies.length,'duplicate dependency: '+id);
    return {id,title,status,dependencies,acceptance,evidence,manual};
  });
  const ids=tasks.map(t=>t.id);
  check(new Set(ids).size===ids.length,'duplicate task ID');
  check(ids.length===REQUIRED.length && REQUIRED.every(id=>ids.includes(id)),
    'required task IDs removed or added without guard review');
  const lookup=new Map(tasks.map(t=>[t.id,t]));
  for(const task of tasks){
    for(const dep of task.dependencies){
      check(lookup.has(dep)&&dep!==task.id,'invalid dependency '+task.id+' => '+dep);
    }
    if(task.status==='in_review')check(/^PR#\d+$/.test(task.evidence),'in_review needs real PR reference: '+task.id);
    if(task.status==='blocked')check(task.evidence==='docs/ff/BLOCKED.md','blocked task needs BLOCKED.md: '+task.id);
    if(['planned','in_progress','deferred'].includes(task.status))check(task.evidence==='-','unverified task cannot claim evidence: '+task.id);
    if(task.status==='done')check(task.evidence==='docs/ff/evidence/'+task.id+'.json','done needs canonical JSON evidence: '+task.id);
    if(['in_progress','in_review','done'].includes(task.status))
      for(const dep of task.dependencies)check(lookup.get(dep).status==='done','dependency is not done: '+task.id+' => '+dep);
  }
  check(lookup.get('P4-AUTO').status==='deferred','second phase requires explicit change of plan and gate code');
  return tasks;
}

function safeRead(root,relative) {
  check(!path.isAbsolute(relative) && !relative.includes('..') && !relative.includes('\\'),'unsafe evidence path: '+relative);
  const real=path.resolve(root,relative);
  check(real.startsWith(root+path.sep),'evidence escapes repo');
  check(fs.existsSync(real) && fs.statSync(real).isFile(),'missing evidence file: '+relative);
  return fs.readFileSync(real,'utf8');
}

function checkEvidence(task,root) {
  let evidence;
  try{evidence=JSON.parse(safeRead(root,task.evidence));}
  catch(error){throw new Error('Plan gate: invalid JSON for '+task.id+': '+error.message);}
  check(evidence.schema===1 && evidence.task_id===task.id,'incorrect evidence schema/id: '+task.id);
  check(Number.isSafeInteger(evidence.pr_number)&&evidence.pr_number>0,'missing merged PR number: '+task.id);
  check(SHA40.test(evidence.merge_commit),'invalid merge commit: '+task.id);
  check(Array.isArray(evidence.test_cases),'test cases must be an array: '+task.id);
  if(CODE_TASKS.has(task.id))check(evidence.test_cases.length>0,'missing machine-verifiable regression cases: '+task.id);
  for(const c of evidence.test_cases){
    check(c && typeof c==='object','test case must be an object: '+task.id);
    check(typeof c.file==='string' && (
      /^threadline-extension\/test\/[a-z0-9-]+\.test\.js$/.test(c.file) ||
      c.file==='threadline-extension/test/extension-e2e.py'
    ),'non-executed test path: '+task.id);
    check(typeof c.name==='string' && c.name.length>=8 && c.name.length<=160,'test case name missing: '+task.id);
    check(safeRead(root,c.file).includes(c.name),'named test not found in file: '+task.id+' '+c.name);
  }
  if(task.manual==='yes'){
    const m=evidence.manual;
    check(m && Number.isSafeInteger(m.comment_id)&&m.comment_id>0,'manual GitHub comment missing: '+task.id);
    check(SHA40.test(m.accepted_head_sha),'manual acceptance head SHA missing: '+task.id);
    check(typeof m.scope==='string'&&m.scope.trim().length>=12,'manual acceptance scope missing: '+task.id);
  }
  return evidence;
}

export function validatePlan(root=ROOT) {
  root=path.resolve(root);
  const plan=safeRead(root,'docs/PLAN.md');
  const agents=safeRead(root,'AGENTS.md');
  const legacy=safeRead(root,'docs/ff/DEVELOPMENT_PLAN.md');
  check(agents.includes('docs/PLAN.md'),'AGENTS.md must use canonical plan');
  check(legacy.includes('docs/PLAN.md') && legacy.length<1600,
    'historical DEVELOPMENT_PLAN.md must be only a pointer');
  check(plan.includes('唯一正式') && plan.includes('AGENTS.md'),
    'canonical GitHub-only plan statement missing');
  const tasks=parseTaskTable(plan);
  let blocked=null;
  const done=[];
  for(const task of tasks){
    if(task.status==='blocked'){
      blocked ??= safeRead(root,'docs/ff/BLOCKED.md');
      check(blocked.includes(task.id),'blocked task not explained: '+task.id);
    }
    if(task.status==='done')done.push({task,evidence:checkEvidence(task,root)});
  }
  return {tasks,done,root};
}

async function githubJson(endpoint,{repo,token,fetchImpl}) {
  const url='https://api.github.com/repos/'+repo+endpoint;
  const response=await fetchImpl(url,{headers:{
    Accept:'application/vnd.github+json',
    Authorization:'Bearer '+token,
    'X-GitHub-Api-Version':'2022-11-28'
  },signal:AbortSignal.timeout(20000)});
  check(response.ok,'GitHub API '+response.status+' for '+endpoint);
  return response.json();
}

export async function checkGithubEvidence({tasks,done},{repo,token,fetchImpl=fetch}) {
  check(/^[\w.-]+\/[\w.-]+$/.test(repo||''),'GITHUB_REPOSITORY missing/invalid');
  check(typeof token==='string'&&token.length>0,'GITHUB_TOKEN missing (fail closed)');
  const opts={repo,token,fetchImpl};
  for(const t of tasks.filter(x=>x.status==='in_review')){
    const pr=await githubJson('/pulls/'+t.evidence.slice(3),opts);
    check(pr.state==='open' && pr.base?.ref==='main','in_review PR not open against main: '+t.id);
  }
  for(const {task,evidence} of done){
    const pr=await githubJson('/pulls/'+evidence.pr_number,opts);
    check(pr.merged_at && pr.base?.ref==='main','PR not merged into main: '+task.id);
    check(pr.merge_commit_sha===evidence.merge_commit,'merged SHA differs: '+task.id);
    const checks=await githubJson('/commits/'+evidence.merge_commit+'/check-runs?per_page=100',opts);
    check(Array.isArray(checks.check_runs)&&checks.check_runs.some(c=>
      c.name==='verify' && c.conclusion==='success' && c.app?.slug==='github-actions'
    ),'verified GitHub Actions check absent: '+task.id);
    if(task.manual==='yes'){
      const m=evidence.manual;
      const comment=await githubJson('/issues/comments/'+m.comment_id,opts);
      const owner=repo.split('/')[0];
      check(comment.user?.login===owner,'manual acceptance must be from repository owner: '+task.id);
      check(comment.issue_url==='https://api.github.com/repos/'+repo+'/issues/'+evidence.pr_number,
        'manual acceptance belongs to another PR: '+task.id);
      check(comment.body?.trim()==='MANUAL_ACCEPT '+task.id+' '+pr.head?.sha,
        'manual acceptance text/head does not match: '+task.id);
      check(m.accepted_head_sha===pr.head?.sha,'recorded manual head SHA differs: '+task.id);
    }
  }
  return {reviewPrs:tasks.filter(x=>x.status==='in_review').length,done:done.length};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const report=validatePlan();
    if(process.argv.includes('--github')){
      const remote=await checkGithubEvidence(report,{
        repo:process.env.GITHUB_REPOSITORY,
        token:process.env.GITHUB_TOKEN
      });
      console.log('Plan gate passed: '+report.tasks.length+' tasks, '+remote.reviewPrs+' open PRs, '+remote.done+' externally verified done');
    }else console.log('Plan structure passed: '+report.tasks.length+' tasks, '+report.done.length+' locally checked done; remote signoff checked only in GitHub CI');
  }catch(error){
    console.error(error?.message||String(error));process.exitCode=1;
  }
}
