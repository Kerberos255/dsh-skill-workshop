import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseSkill,Workshop} from '../workshop.js';
import {schema} from '../config.js';

test('learned candidates survive restart, dedupe turns and automatically publish only after independent evidence',async()=>{
 const root=fs.mkdtempSync(path.resolve('skill-gate-fixture-')),cwd=path.join(root,'workspace'),home=path.join(root,'home');
 fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(home,{recursive:true});
 const conf={...schema.defaults,unusedDays:90},dbFile=path.join(home,'workshop.sqlite');
 const ctx={dshHomePath:(...parts)=>path.join(home,...parts),emit(){},get(){return undefined;},
  skills:{async get(name){const file=path.join(cwd,'.dsh','skills',name,'SKILL.md');if(!fs.existsSync(file))return null;const data=parseSkill(fs.readFileSync(file,'utf8'));return {path:file,name,description:data.description,content:data.body,editable:true};},
    async snapshot(){return {skills:[]};}}};
 const content='---\nname: repair-service\ndescription: Repair a service with repeatable verification\n---\n# Service repair\n\n## Conditions\nService returns errors.\n\n## Steps\nInspect logs, test changes, and verify health.\n\n## Rollback\nRestore previous configuration.\n';
 let shop;
 try{
  shop=new Workshop(dbFile,ctx,()=>conf);
  const first=await shop.propose(cwd,{files:{'SKILL.md':content},reason:'first task'});
  shop.markLearning(cwd,first.id,[{sessionId:'s1',seq:1} ],['s1#9']);
  assert.equal(shop.autoApply(cwd,first.id).reason,'awaiting-independent-evidence');
  assert.equal(shop.candidate(cwd,'repair-service').observations.length,1);
  shop.close();shop=null;
  shop=new Workshop(dbFile,ctx,()=>conf);
  assert.equal(shop.candidate(cwd,'repair-service').observations.length,1);
  assert.equal(shop.autoApply(cwd,first.id).reason,'awaiting-independent-evidence');
  const second=await shop.propose(cwd,{files:{'SKILL.md':content},reason:'second task'});
  shop.markLearning(cwd,second.id,[{sessionId:'s2',seq:3}],['s2#19']);
  assert.equal(shop.proposal(cwd,first.id).state,'rejected');
  assert.equal(shop.autoApply(cwd,first.id).reason,'candidate-superseded');
  assert.equal(shop.autoApply(cwd,second.id).published,true);
  assert.equal(shop.proposal(cwd,second.id).state,'applied');
  assert.equal(shop.candidate(cwd,'repair-service'),null);
  assert.equal(shop.managed(cwd).length,1);
  assert(fs.existsSync(path.join(cwd,'.dsh','skills','repair-service','SKILL.md')));
 }finally{shop?.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('candidate ceiling is enforced before new pending proposal',async()=>{
 const root=fs.mkdtempSync(path.resolve('skill-limit-fixture-')),cwd=path.join(root,'workspace'),home=path.join(root,'home');
 fs.mkdirSync(cwd,{recursive:true});fs.mkdirSync(home,{recursive:true});
 const conf={...schema.defaults,maxLearningCandidates:4},ctx={dshHomePath:(...items)=>path.join(home,...items),emit(){},get(){return undefined;}};
 const shop=new Workshop(path.join(home,'state.sqlite'),ctx,()=>conf);
 try{
  const scoped=(await shop.propose(cwd,{files:{'SKILL.md':'---\nname: repair-one\ndescription: Repair one\n---\n# Repair\n\n## Steps\n1. Verify'} }));
  shop.markLearning(cwd,scoped.id,[],['s1#9']);
  for(let n=2;n<=4;n++){
   const name='repair-'+n,prop=await shop.propose(cwd,{files:{'SKILL.md':`---\nname: ${name}\ndescription: Skill ${n}\n---\n# Skill\n\n## Steps\nCheck.` }});
   shop.markLearning(cwd,prop.id,[],[`s${n}#9`]);
  }
  assert.equal(shop.canStageLearning(cwd,'repair-one'),true);
  assert.equal(shop.canStageLearning(cwd,'repair-five'),false);
 }finally{shop.close();fs.rmSync(root,{recursive:true,force:true});}
});
