import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './learning-fixture.mjs';
import { LearningStore } from '../learning-store.js';
import { scopeId } from '../workspace-io.js';

const DAY=86400000;
const stage=(store,cwd,name,key,now=Date.now(),extra={})=>store.stage(cwd,{name,summary:{description:'Repeatable '+name,steps:['Read','Validate'],reason:'Verified workflow'},turnKeys:[key],taskKeys:[key],...extra},now);
test('legacy schema migration preserves all proposal states, ownership markers, evidence and stable candidate IDs',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE proposals(id TEXT PRIMARY KEY,scope TEXT,created INTEGER,state TEXT,payload TEXT);CREATE TABLE learned_proposals(id TEXT PRIMARY KEY,scope TEXT,sources TEXT,auto_publish INTEGER DEFAULT 0);CREATE TABLE learning_candidates(scope TEXT,name TEXT,proposal_id TEXT,observations TEXT,updated INTEGER,PRIMARY KEY(scope,name));CREATE TABLE managed_workspaces(scope TEXT PRIMARY KEY,cwd TEXT);CREATE TABLE publications(id TEXT PRIMARY KEY);`);
 const scope='scope-one',payload=JSON.stringify({files:{'SKILL.md':'---\nname: legacy\ndescription: Existing candidate\n---\n## Steps\nRead and test'}});
 db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?)').run('p1',scope,100,'pending',payload);db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?)').run('manual',scope,90,'pending',payload);
 db.prepare('INSERT INTO learned_proposals VALUES(?,?,?,0)').run('p1',scope,'[{"sessionId":"s1","seq":1}]');db.prepare('INSERT INTO learning_candidates VALUES(?,?,?,?,?)').run(scope,'legacy','p1','["s1#8"]',110);
 const parse=()=>({description:'Existing candidate',body:'## Steps\nRead and test'}),config=()=>({maxLearningCandidates:64,candidateIdleDays:21});
 try{
  let store=new LearningStore(db,config,()=>scope,parse);const first=store.list('cwd')[0];assert(first.id);assert.deepEqual(first.taskKeys,['s1#8']);assert.equal(first.sources.length,1);
  store=new LearningStore(db,config,()=>scope,parse);assert.equal(store.list('cwd')[0].id,first.id);assert.equal(db.prepare("SELECT count(*) AS n FROM proposals WHERE state='pending'").get().n,2);
  assert.equal(store.stage('cwd',{candidateId:first.id,name:'renamed',summary:first.summary,sources:[],turnKeys:['s1#8'],taskKeys:['new-hash-for-same-old-turn'],independentTask:true,sameProcedure:true}).reason,'duplicate-evidence');
 }finally{db.close();}
});
test('candidate expiry archives only automatic candidates and preserves ordinary pending proposals',async()=>{
 const f=fixture();try{
  const manual=await f.shop.propose(f.cwd,{files:{'SKILL.md':'---\nname: manual-pending\ndescription: Human maintained proposal\n---\nBody'}}),now=Date.now();
  stage(f.shop.learningStore,f.cwd,'old-candidate','s#1',now-22*DAY);stage(f.shop.learningStore,f.cwd,'fresh-candidate','s#2',now);
  f.shop.learningStore.prune(f.cwd,now);assert.deepEqual(f.shop.learningStore.list(f.cwd).map(row=>row.name),['fresh-candidate']);assert.equal(f.shop.proposal(f.cwd,manual.id).state,'pending');
  assert.equal(f.shop.db.prepare('SELECT reason FROM learning_archive').get().reason,'expired');
 }finally{f.close();}
});
test('capacity rotation retains fresh and two-evidence candidates while archiving an old weak singleton',()=>{
 const f=fixture({config:{maxLearningCandidates:4}});try{
  const store=f.shop.learningStore,now=Date.now();stage(store,f.cwd,'old-weak','s#1',now-8*DAY,{quality:6});
  const mature=stage(store,f.cwd,'mature','s#2',now-10*DAY).candidate;
  stage(store,f.cwd,'mature','s#3',now-9*DAY,{candidateId:mature.id,independentTask:true,sameProcedure:true});stage(store,f.cwd,'fresh-one','s#4',now);stage(store,f.cwd,'fresh-two','s#5',now);
  const plan=store.plan(f.cwd,now);assert.equal(plan.reinforceOnly,false);assert.equal(store.candidate(f.cwd,'old-weak'),null);assert.equal(store.candidate(f.cwd,'mature').taskKeys.length,2);assert.equal(store.list(f.cwd).length,3);
 }finally{f.close();}
});
test('explicit rejection and publication release candidate capacity without affecting another workspace',async()=>{
 const f=fixture();try{
  await f.run();const candidate=f.shop.learningStore.list(f.cwd)[0];assert.equal(f.shop.learningStore.byId(f.directory,candidate.id),null);
  assert.throws(()=>f.shop.learningStore.stage(f.directory,{candidateId:candidate.id,name:candidate.name,summary:candidate.summary,turnKeys:['other#1'],taskKeys:['other#1'],independentTask:true,sameProcedure:true}),/不属于/);
  assert.equal(f.shop.learningStore.byId(f.cwd,candidate.id).taskKeys.length,1);
 }finally{f.close();}
});
test('queued tasks persist, remain idempotent after processing, and failed retries stop after three attempts',()=>{
 const f=fixture();try{
  const task={sessionId:'queued-session',turn:2,endSeq:29},now=Date.now();f.shop.learningStore.enqueue(f.cwd,task,now);f.shop.learningStore.enqueue(f.cwd,task,now);f.reopen();assert.equal(f.shop.learningStore.pending(f.cwd,now).length,1);
  for(let n=0;n<3;n++){assert.equal(f.shop.learningStore.pending(f.cwd,now+n*3600000).length,1);f.shop.learningStore.fail(f.cwd,[task],now+n*3600000);}
  assert.equal(f.shop.learningStore.pending(f.cwd,now+4*3600000).length,0);assert.equal(f.shop.db.prepare('SELECT attempts FROM learning_tasks').get().attempts,3);
  f.shop.learningStore.enqueue(f.cwd,task,now);assert.equal(f.shop.learningStore.pending(f.cwd,now+5*3600000).length,0);
 }finally{f.close();}
});
test('queue, processed history and archive remain bounded independently of manual proposal history settings',()=>{
 const f=fixture({config:{historyDays:0,maxHistory:0}});try{
  const now=Date.now(),store=f.shop.learningStore;for(let n=0;n<150;n++)store.enqueue(f.cwd,{sessionId:'s',turn:n,endSeq:n},now+n);assert.equal(store.queuedCount(f.cwd),128);
  const insert=f.shop.db.prepare('INSERT INTO learning_archive VALUES(?,?,?,?,?,?)');for(let n=0;n<300;n++)insert.run('a'+n,scopeId(f.cwd),'candidate-'+n,now+n,'capacity','{}');store.prune(f.cwd,now+1000);assert.equal(f.shop.db.prepare('SELECT count(*) AS n FROM learning_archive').get().n,256);
 }finally{f.close();}
});
