import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

function semver(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value))
    throw new Error("Manifest release version must be numeric major.minor.patch");
  return value.split(".").map(Number);
}
function compareVersions(a,b) {
  const left=semver(a),right=semver(b);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return Math.sign(left[i]-right[i]);
  return 0;
}
export function evaluateReleaseDrift({latestTag,previousVersion,currentVersion,changedFiles}) {
  if (latestTag !== "v"+previousVersion)
    throw new Error("Latest release tag and its manifest version disagree");
  if (!Array.isArray(changedFiles) || changedFiles.length===0)
    throw new Error("No tracked extension changes since latest published Release");
  if (changedFiles.some(f=>!f.startsWith("threadline-extension/")))
    throw new Error("Unscoped path supplied to release drift checker");
  if (compareVersions(currentVersion,previousVersion)<=0)
    throw new Error("Extension changed since "+latestTag+
      " without increasing manifest.version ("+currentVersion+"); publication denied");
  return {latestTag,previousVersion,currentVersion,changedFiles:changedFiles.length};
}
function git(cwd,...args) {
  const proc=spawnSync("git",args,{cwd,encoding:"utf8"});
  if(proc.error || proc.status!==0)
    throw new Error("git "+args[0]+" failed: "+String(proc.stderr||proc.error||"unknown").slice(0,300));
  return proc.stdout.trim();
}
export function checkRepository(cwd,latestTag) {
  if(!/^v\d+\.\d+\.\d+$/.test(latestTag||""))
    throw new Error("Pass the latest published release tag, e.g. v0.8.1");
  const current=JSON.parse(fs.readFileSync(path.join(cwd,"threadline-extension/manifest.json"),"utf8")).version;
  const previous=JSON.parse(git(cwd,"show",latestTag+":threadline-extension/manifest.json")).version;
  const paths=git(cwd,"diff","--name-only",latestTag,"HEAD","--","threadline-extension/")
    .split(/\r?\n/).filter(Boolean);
  return evaluateReleaseDrift({latestTag,previousVersion:previous,currentVersion:current,changedFiles:paths});
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{
    const out=checkRepository(process.cwd(),process.argv[2]);
    console.log("Release version guard OK: "+out.latestTag+" -> v"+out.currentVersion+
      " ("+out.changedFiles+" changed extension files)");
  }catch(error){
    console.error("::error::Release guard: "+error.message);
    process.exitCode=1;
  }
}
