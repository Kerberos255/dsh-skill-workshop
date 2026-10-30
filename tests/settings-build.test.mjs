import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workshop-settings-'));
 for(const name of ['package.json','client.js','client-panel.inc.js','config.js','config.example.json','tools/settings','plugin-settings','locale'])fs.cpSync(path.join(root,name),path.join(directory,name),{recursive:true});
 return {directory,build(){const result=spawnSync(process.execPath,['tools/settings/build.mjs'],{cwd:directory,encoding:'utf8',timeout:15000});assert.equal(result.status,0,result.stderr);},close(){fs.rmSync(directory,{recursive:true,force:true});}};
}
test('regenerating settings reproduces shipped UI and preserves public metadata and peer ranges',()=>{
 const f=fixture();try{
  const before=JSON.parse(fs.readFileSync(path.join(f.directory,'package.json'),'utf8')),client=fs.readFileSync(path.join(f.directory,'client.js'),'utf8');
  f.build();const after=JSON.parse(fs.readFileSync(path.join(f.directory,'package.json'),'utf8')),built=fs.readFileSync(path.join(f.directory,'client.js'),'utf8');
  assert.deepEqual(after,before);assert.equal(built,client);assert.doesNotThrow(()=>new vm.Script(built));
  const page=JSON.parse(fs.readFileSync(path.join(f.directory,'tools/settings/pages.json'),'utf8'))['dsh-skill-workshop'];
  for(const name of ['maxLearningCandidates','candidateIdleDays','maxManagedSkills'])assert.equal(page.fields.filter(field=>field.key===name).length,1);
  assert(page.fields.find(field=>field.key==='candidateIdleDays').help.includes('21'));assert(page.fields.find(field=>field.key==='maxLearningCandidates').help.includes('64'));
 }finally{f.close();}
});
test('settings rebuild keeps an explicitly pinned supported host version',()=>{
 const f=fixture();try{
  const file=path.join(f.directory,'package.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.peerDependencies['@deepseek-ai/dsh-typert-protocol']='0.2.1-rc.3';fs.writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
  f.build();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).peerDependencies['@deepseek-ai/dsh-typert-protocol'],'0.2.1-rc.3');
 }finally{f.close();}
});
