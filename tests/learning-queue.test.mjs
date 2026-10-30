import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {LearningStore} from '../learning-store.js';
import {scopeId} from '../workspace-io.js';

const DAY=86400000;
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'skill-queue-')),cwd=path.join(root,'workspace'),other=path.join(root,'other');fs.mkdirSync(cwd);fs.mkdirSync(other);
 const db=new DatabaseSync(path.join(root,'state.sqlite'));db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;
 CREATE TABLE proposals(id TEXT PRIMARY KEY,scope TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE learned_proposals(id TEXT PRIMARY KEY,scope TEXT NOT NULL,sources TEXT NOT NULL,auto_publish INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE learning_candidates(scope TEXT NOT NULL,name TEXT NOT NULL,proposal_id TEXT NOT NULL,observations TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(scope,name));
 CREATE TABLE managed_workspaces(scope TEXT PRIMARY KEY,cwd TEXT NOT NULL);CREATE TABLE publications(id TEXT PRIMARY KEY);`);
 const config={candidateIdleDays:21,maxLearningCandidates:4},parseLegacy=raw=>JSON.parse(raw);
 let store;return {root,cwd,other,db,config,get store(){return store??=new LearningStore(db,()=>config,scopeId,parseLegacy);},reopen(){store=new LearningStore(db,()=>config,scopeId,parseLegacy);return store;},close(){db.close();fs.rmSync(root,{recursive:true,force:true});}};
}
function stage(f,name,key,now=Date.now(),extra={}){return f.store.stage(f.cwd,{name,summary:{description:'Verified '+name,when:'A project needs repair',steps:['Read the file','Run its tests'],verify:'Tests pass',fallback:'Restore the backup',reason:'Repeatable verified process'},turnKeys:[key],taskKeys:[key],...extra},now);}

test('first evidence creates only a compact candidate and stable IDs survive reopening the store',()=>{
 const f=fixture();try{const first=stage(f,'repair','session#9').candidate;assert(first.id);assert.equal(first.proposal_id,'');assert.equal(f.db.prepare('SELECT count(*) AS n FROM proposals').get().n,0);f.reopen();assert.equal(f.store.candidate(f.cwd,'repair').id,first.id);}finally{f.close();}
});
test('new independent evidence uses the selected candidate ID and duplicate evidence never refreshes its lifetime',()=>{
 const f=fixture();try{
  const now=Date.now(),first=stage(f,'repair','session#9',now).candidate;
  assert.equal(stage(f,'renamed','session#9',now+DAY,{candidateId:first.id,independentTask:true,sameProcedure:true}).reason,'duplicate-evidence');assert.equal(f.store.byId(f.cwd,first.id).updated,now);
  assert.equal(stage(f,'renamed','session#10',now+DAY,{candidateId:first.id,independentTask:false,sameProcedure:true}).reason,'not-independent');
  const second=stage(f,'renamed','session#10',now+DAY,{candidateId:first.id,independentTask:true,sameProcedure:true}).candidate;assert.equal(second.id,first.id);assert.equal(second.name,'repair');assert.equal(second.taskKeys.length,2);assert.equal(f.store.ready(f.cwd,now+DAY).length,1);
 }finally{f.close();}
});
test('a candidate ID from another workspace cannot acquire evidence',()=>{
 const f=fixture();try{const first=stage(f,'repair','session#9').candidate;assert.equal(f.store.byId(f.other,first.id),null);assert.throws(()=>f.store.stage(f.other,{candidateId:first.id,name:'repair',summary:first.summary,taskKeys:['other#1'],turnKeys:['other#1'],independentTask:true,sameProcedure:true}),/不属于/);assert.equal(f.store.byId(f.cwd,first.id).taskKeys.length,1);}finally{f.close();}
});
test('full fresh pools enter reinforcement mode; an old weak singleton can rotate out',()=>{
 const f=fixture();try{const now=Date.now();for(let n=0;n<4;n++)stage(f,'candidate-'+n,'session#'+n,now);assert.equal(f.store.plan(f.cwd,now).reinforceOnly,true);assert.equal(stage(f,'overflow','session#9',now).reason,'candidate-limit');
  f.db.prepare('UPDATE learning_candidates SET updated=? WHERE name=?').run(now-8*DAY,'candidate-0');const plan=f.store.plan(f.cwd,now);assert.equal(plan.reinforceOnly,false);assert.equal(f.store.candidate(f.cwd,'candidate-0'),null);assert.equal(f.db.prepare('SELECT reason FROM learning_archive').get().reason,'capacity');
 }finally{f.close();}
});
test('rotation protects mature candidates and publications in recovery',()=>{
 const f=fixture();try{const now=Date.now(),mature=stage(f,'mature','s#1',now-10*DAY).candidate;stage(f,'mature','s#2',now-9*DAY,{candidateId:mature.id,independentTask:true,sameProcedure:true});const recovery=stage(f,'recovering','s#3',now-10*DAY).candidate;
  f.db.prepare('INSERT INTO publications VALUES(?)').run('recovering-proposal');f.db.prepare('UPDATE learning_candidates SET proposal_id=? WHERE candidate_id=?').run('recovering-proposal',recovery.id);stage(f,'fresh-one','s#4',now);stage(f,'fresh-two','s#5',now);
  assert.equal(f.store.plan(f.cwd,now).reinforceOnly,true);assert(f.store.byId(f.cwd,recovery.id));assert.equal(f.store.byId(f.cwd,mature.id).taskKeys.length,2);
 }finally{f.close();}
});
test('expiry releases automatic capacity while manual pending proposals remain untouched',()=>{
 const f=fixture();try{const now=Date.now();f.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?)').run('manual',scopeId(f.cwd),now-100*DAY,'pending','{}');stage(f,'expired','s#1',now-22*DAY);stage(f,'fresh','s#2',now);f.store.prune(f.cwd,now);assert.equal(f.store.list(f.cwd).length,1);assert.equal(f.db.prepare('SELECT state FROM proposals WHERE id=?').get('manual').state,'pending');assert.equal(f.db.prepare('SELECT reason FROM learning_archive').get().reason,'expired');}finally{f.close();}
});
test('legacy candidate evidence is preserved and seeded as processed so renaming cannot replay the same turn',()=>{
 const f=fixture();try{
  const scope=scopeId(f.cwd),now=Date.now(),legacySkill=JSON.stringify({description:'Legacy procedure',body:'## Steps\nRead and verify'});
  f.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?)').run('legacy-proposal',scope,now,'pending',JSON.stringify({files:{'SKILL.md':legacySkill}}));f.db.prepare('INSERT INTO learned_proposals VALUES(?,?,?,0)').run('legacy-proposal',scope,'[]');f.db.prepare('INSERT INTO learning_candidates VALUES(?,?,?,?,?)').run(scope,'legacy','legacy-proposal','["source-session#9"]',now);
  const candidate=f.store.candidate(f.cwd,'legacy');assert(candidate.id);assert.equal(candidate.proposal_id,'legacy-proposal');assert.deepEqual(candidate.taskKeys,['source-session#9']);assert.equal(f.store.pending(f.cwd).length,0);
  f.store.enqueue(f.cwd,{sessionId:'source-session',turn:1,endSeq:9});assert.equal(f.store.pending(f.cwd).length,0);f.reopen();assert.equal(f.store.candidate(f.cwd,'legacy').id,candidate.id);
 }finally{f.close();}
});
test('queued tasks are idempotent, processed tasks stay processed, and three failures stop automatic retries',()=>{
 const f=fixture();try{
  const task={sessionId:'queued',turn:1,endSeq:9},now=Date.now();f.store.enqueue(f.cwd,task,now);f.store.enqueue(f.cwd,task,now);f.reopen();assert.equal(f.store.pending(f.cwd,now).length,1);f.store.finish(f.cwd,[task]);f.store.enqueue(f.cwd,task,now);assert.equal(f.store.pending(f.cwd,now).length,0);
  const failed={...task,endSeq:10};f.store.enqueue(f.cwd,failed,now);for(let n=0;n<3;n++)f.store.fail(f.cwd,[failed],now+n*3600000);assert.equal(f.store.pending(f.cwd,now+4*3600000).length,0);f.store.resetTaskFailures(f.cwd);assert.equal(f.store.pending(f.cwd).length,1);
 }finally{f.close();}
});
test('a failed batch transaction cannot leave a half-staged candidate',()=>{
 const f=fixture();try{assert.throws(()=>f.store.transaction(()=>{stage(f,'temporary','s#1');f.store.stage(f.cwd,{candidateId:'missing',name:'bad',summary:{},turnKeys:['s#2'],taskKeys:['s#2'],independentTask:true,sameProcedure:true});}),/候选不存在/);assert.equal(f.store.list(f.cwd).length,0);assert.equal(f.db.prepare('SELECT count(*) AS n FROM managed_workspaces').get().n,0);}finally{f.close();}
});
test('pending queues and archived candidate metadata remain bounded',()=>{
 const f=fixture();try{const now=Date.now();for(let n=0;n<140;n++)f.store.enqueue(f.cwd,{sessionId:'many',turn:n,endSeq:n},now+n);assert.equal(f.store.queuedCount(f.cwd),128);const add=f.db.prepare('INSERT INTO learning_archive VALUES(?,?,?,?,?,?)');for(let n=0;n<270;n++)add.run('a'+n,scopeId(f.cwd),'candidate-'+n,now+n,'capacity','{}');f.store.prune(f.cwd,now+1000);assert.equal(f.db.prepare('SELECT count(*) AS n FROM learning_archive').get().n,256);}finally{f.close();}
});
