import { randomUUID } from 'node:crypto';
import { mergeObservations } from './learning-policy.js';

const DAY=86400000;
const decode=(text,fallback)=>{try{return JSON.parse(text);}catch{return fallback;}};
export function summaryFromSkill(skill){
 const sections=String(skill.body).split(/(?=^#{1,4}\s)/m),find=pattern=>sections.find(section=>pattern.test(section.split('\n')[0]))?.replace(/^#{1,4}[^\n]*\n/,'').trim().slice(0,700)??'';
 return {description:skill.description.slice(0,500),when:find(/适用|前提|条件|condition|when|prerequisite/i),
  steps:[find(/步骤|操作|流程|step|procedure|workflow/i)||skill.body.slice(0,700)],verify:find(/验证|验收|测试|verify|validat|test/i),
  fallback:find(/失败|回退|恢复|rollback|fallback|recovery/i),reason:'已有自动学习候选，等待新的独立任务证据。'};
}

/** Only automatic learning owns these bounded queues and archives. */
export class LearningStore {
 constructor(db,getConfig,scopeId,parseSkill){
  this.db=db;this.getConfig=getConfig;this.scopeId=scopeId;
  const columns=new Set(db.prepare('PRAGMA table_info(learning_candidates)').all().map(row=>row.name));
  for(const [name,type] of Object.entries({candidate_id:"TEXT NOT NULL DEFAULT ''",summary:"TEXT NOT NULL DEFAULT '{}'",sources:"TEXT NOT NULL DEFAULT '[]'",task_keys:"TEXT NOT NULL DEFAULT '[]'",created:'INTEGER NOT NULL DEFAULT 0',quality:'INTEGER NOT NULL DEFAULT 0',drafted_count:'INTEGER NOT NULL DEFAULT 0',draft_attempts:'INTEGER NOT NULL DEFAULT 0',next_draft:'INTEGER NOT NULL DEFAULT 0'})){
   if(!columns.has(name))db.exec('ALTER TABLE learning_candidates ADD COLUMN '+name+' '+type);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS learning_tasks(scope TEXT NOT NULL,session TEXT NOT NULL,turn INTEGER NOT NULL,end_seq INTEGER NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,session,end_seq));
   CREATE INDEX IF NOT EXISTS learning_task_pending ON learning_tasks(scope,state,created);
   CREATE TABLE IF NOT EXISTS learning_archive(id TEXT PRIMARY KEY,scope TEXT NOT NULL,name TEXT NOT NULL,archived INTEGER NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL);`);
  this.transaction(()=>{
   for(const row of db.prepare("SELECT * FROM learning_candidates WHERE candidate_id='' OR created=0").all()){
    const proposal=db.prepare('SELECT created,payload FROM proposals WHERE id=? AND scope=?').get(row.proposal_id,row.scope);
    const payload=decode(proposal?.payload,{}),observations=decode(row.observations,[]);
    let summary={description:row.name,reason:'旧候选，等待独立证据。',steps:[]};
    try{summary=summaryFromSkill(parseSkill(payload.files?.['SKILL.md']));}catch{}
    const learned=db.prepare('SELECT sources FROM learned_proposals WHERE id=? AND scope=?').get(row.proposal_id,row.scope);
    db.prepare('UPDATE learning_candidates SET candidate_id=?,summary=?,sources=?,task_keys=?,created=?,quality=?,drafted_count=? WHERE scope=? AND name=?')
     .run(row.candidate_id||randomUUID(),JSON.stringify(summary),learned?.sources??'[]',JSON.stringify(observations),proposal?.created??row.updated,6,observations.length,row.scope,row.name);
    for(const observation of observations){const match=/^(.+)#(\d+)$/.exec(observation);if(match)db.prepare("INSERT OR IGNORE INTO learning_tasks(scope,session,turn,end_seq,created,state) VALUES(?,?,0,?,?,'processed')").run(row.scope,match[1],Number(match[2]),proposal?.created??row.updated);}
   }
  });
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS learning_candidate_identity ON learning_candidates(scope,candidate_id)');
 }
 transaction(operation){
  if(this.db.isTransaction)return operation();
  this.db.exec('BEGIN IMMEDIATE');try{const result=operation();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 row(row){return row?{...row,id:row.candidate_id,observations:decode(row.observations,[]),summary:decode(row.summary,{}),sources:decode(row.sources,[]),taskKeys:decode(row.task_keys,[])}:null;}
 candidate(cwd,name){return this.row(this.db.prepare('SELECT * FROM learning_candidates WHERE scope=? AND name=?').get(this.scopeId(cwd),name));}
 byId(cwd,id){return this.row(this.db.prepare('SELECT * FROM learning_candidates WHERE scope=? AND candidate_id=?').get(this.scopeId(cwd),id));}
 list(cwd){return this.db.prepare('SELECT * FROM learning_candidates WHERE scope=? ORDER BY updated DESC,name').all(this.scopeId(cwd)).map(row=>this.row(row));}
 publicList(cwd){const days=this.getConfig().candidateIdleDays??21;return this.list(cwd).map(row=>({id:row.id,name:row.name,description:row.summary.description,evidenceCount:row.taskKeys.length,updated:row.updated,expiresAt:row.updated+days*DAY,hasDraft:!!row.proposal_id,ready:row.taskKeys.length>=2}));}
 canStage(cwd,name){return !!this.candidate(cwd,name)||this.list(cwd).length<(this.getConfig().maxLearningCandidates??64);}
 archive(candidate,reason,now=Date.now()){
  const {scope,name,id,proposal_id}=candidate;
  if(proposal_id&&this.db.prepare('SELECT 1 FROM publications WHERE id=?').get(proposal_id))return false;
  this.db.prepare('INSERT OR REPLACE INTO learning_archive VALUES(?,?,?,?,?,?)').run(id,scope,name,now,reason,JSON.stringify({summary:candidate.summary,taskKeys:candidate.taskKeys,observations:candidate.observations}));
  this.db.prepare("UPDATE proposals SET state='rejected' WHERE id=? AND scope=? AND state='pending' AND id IN (SELECT id FROM learned_proposals)").run(proposal_id,scope);
  this.db.prepare('DELETE FROM learning_candidates WHERE scope=? AND candidate_id=?').run(scope,id);
  return true;
 }
 prune(cwd,now=Date.now()){
  const scope=this.scopeId(cwd),expiry=now-(this.getConfig().candidateIdleDays??21)*DAY;
  this.transaction(()=>{
   for(const candidate of this.list(cwd)){
    const proposal=candidate.proposal_id?this.db.prepare('SELECT state FROM proposals WHERE id=? AND scope=?').get(candidate.proposal_id,scope):null;
    if(proposal&&['applied','rejected'].includes(proposal.state))this.archive(candidate,'proposal-'+proposal.state,now);
    else if(candidate.updated<expiry)this.archive(candidate,'expired',now);
   }
   this.db.prepare('DELETE FROM learning_archive WHERE scope=? AND (archived<? OR id NOT IN (SELECT id FROM learning_archive WHERE scope=? ORDER BY archived DESC,id LIMIT 256))').run(scope,now-180*DAY,scope);
   this.db.prepare("UPDATE learning_tasks SET state='expired' WHERE scope=? AND state='pending' AND created<?").run(scope,expiry);
   this.db.prepare("DELETE FROM learning_tasks WHERE scope=? AND state!='pending' AND (created<? OR rowid NOT IN (SELECT rowid FROM learning_tasks WHERE scope=? AND state!='pending' ORDER BY created DESC LIMIT 512))").run(scope,now-180*DAY,scope);
  });
 }
 plan(cwd,now=Date.now()){
  this.prune(cwd,now);let candidates=this.list(cwd),limit=this.getConfig().maxLearningCandidates??64;
  if(candidates.length>=limit){
   // A fresh singleton gets a week to find evidence; mature candidates and
   // publications in recovery never lose their slot to an incoming task.
   const replaceable=candidates.filter(row=>row.taskKeys.length<2&&now-row.updated>=7*DAY)
    .sort((a,b)=>a.quality-b.quality||a.updated-b.updated||a.id.localeCompare(b.id));
   while(candidates.length>=limit&&replaceable.length){const row=replaceable.shift();this.transaction(()=>this.archive(row,'capacity',now));candidates=this.list(cwd);}
  }
  return {candidates,reinforceOnly:candidates.length>=limit,limit};
 }
 stage(cwd,{candidateId,name,summary,sources=[],turnKeys=[],taskKeys=turnKeys,quality=6,independentTask=false,sameProcedure=false},now=Date.now()){
  return this.transaction(()=>{
   const scope=this.scopeId(cwd),previous=candidateId?this.byId(cwd,candidateId):null;
   if(candidateId&&!previous)throw new Error('候选不存在或不属于当前工作区');
   if(previous&&(!sameProcedure||!independentTask))return {staged:false,reason:'not-independent'};
   if(previous&&turnKeys.length&&turnKeys.every(key=>previous.observations.includes(key)))return {staged:false,reason:'duplicate-evidence'};
   if(!previous&&this.candidate(cwd,name))return {staged:false,reason:'candidate-id-required'};
   if(!previous&&!this.canStage(cwd,name))return {staged:false,reason:'candidate-limit'};
   const fresh=taskKeys.filter(key=>typeof key==='string'&&key&&!previous?.taskKeys.includes(key));
   if(!fresh.length)return {staged:false,reason:'duplicate-evidence'};
   if(!previous){
    const archived=this.db.prepare('SELECT payload FROM learning_archive WHERE scope=? AND name=?').all(scope,name);
    if(archived.some(row=>{const payload=decode(row.payload,{});return fresh.every(key=>payload.taskKeys?.includes(key))||turnKeys.length&&turnKeys.every(key=>payload.observations?.includes(key));}))return {staged:false,reason:'archived-evidence'};
   }
   const id=previous?.id??randomUUID(),canonical=previous?.name??name,observations=mergeObservations(previous?.observations??[],turnKeys),keys=mergeObservations(previous?.taskKeys??[],fresh);
   const unique=new Map([...(previous?.sources??[]),...sources].map(item=>[item.sessionId+'#'+item.seq+'#'+item.quote,item]));
   this.db.prepare(`INSERT INTO learning_candidates(scope,name,proposal_id,observations,updated,candidate_id,summary,sources,task_keys,created,quality,drafted_count)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,0) ON CONFLICT(scope,name) DO UPDATE SET observations=excluded.observations,updated=excluded.updated,summary=excluded.summary,sources=excluded.sources,task_keys=excluded.task_keys,quality=excluded.quality,drafted_count=0,draft_attempts=0,next_draft=0`)
    .run(scope,canonical,previous?.proposal_id??'',JSON.stringify(observations),now,id,JSON.stringify(summary),JSON.stringify([...unique.values()].slice(-32)),JSON.stringify(keys),previous?.created??now,Math.max(previous?.quality??0,quality));
   this.db.prepare('INSERT OR REPLACE INTO managed_workspaces VALUES(?,?)').run(scope,cwd);
   return {staged:true,candidate:this.byId(cwd,id)};
  });
 }
 attachDraft(cwd,candidateId,proposalId){
  return this.transaction(()=>{
   const candidate=this.byId(cwd,candidateId);if(!candidate)throw new Error('待发布候选已经变化');
   const proposal=this.db.prepare('SELECT state FROM proposals WHERE id=? AND scope=?').get(proposalId,this.scopeId(cwd));
   if(proposal?.state!=='pending')throw new Error('自动学习提案尚未准备完成');
   this.db.prepare('INSERT OR REPLACE INTO learned_proposals(id,scope,sources) VALUES(?,?,?)').run(proposalId,this.scopeId(cwd),JSON.stringify(candidate.sources));
   if(candidate.proposal_id&&candidate.proposal_id!==proposalId)this.db.prepare("UPDATE proposals SET state='rejected' WHERE id=? AND state='pending' AND id IN (SELECT id FROM learned_proposals) AND id NOT IN (SELECT id FROM publications)").run(candidate.proposal_id);
   this.db.prepare('UPDATE learning_candidates SET proposal_id=?,drafted_count=? WHERE scope=? AND candidate_id=?').run(proposalId,candidate.taskKeys.length,this.scopeId(cwd),candidateId);
   return this.byId(cwd,candidateId);
  });
 }
 ready(cwd,now=Date.now()){return this.list(cwd).filter(row=>row.taskKeys.length>=2&&row.taskKeys.length>row.drafted_count&&row.draft_attempts<3&&row.next_draft<=now).sort((a,b)=>b.taskKeys.length-a.taskKeys.length||a.created-b.created);}
 failDraft(cwd,id,now=Date.now()){this.db.prepare('UPDATE learning_candidates SET draft_attempts=draft_attempts+1,next_draft=? WHERE scope=? AND candidate_id=?').run(now+3600000,this.scopeId(cwd),id);}
 resetDraftFailures(cwd){this.db.prepare('UPDATE learning_candidates SET draft_attempts=0,next_draft=0 WHERE scope=?').run(this.scopeId(cwd));}
 resetTaskFailures(cwd){this.db.prepare("UPDATE learning_tasks SET attempts=0,next_attempt=0,state='pending' WHERE scope=? AND state='failed' AND created>=?").run(this.scopeId(cwd),Date.now()-(this.getConfig().candidateIdleDays??21)*DAY);}
 release(cwd,proposalId){
  const candidate=this.db.prepare('SELECT candidate_id FROM learning_candidates WHERE scope=? AND proposal_id=?').get(this.scopeId(cwd),proposalId);
  if(candidate)this.db.prepare('DELETE FROM learning_candidates WHERE scope=? AND candidate_id=?').run(this.scopeId(cwd),candidate.candidate_id);
 }
 enqueue(cwd,{sessionId,turn,endSeq},now=Date.now()){
  const scope=this.scopeId(cwd);
  this.db.prepare('INSERT OR IGNORE INTO learning_tasks(scope,session,turn,end_seq,created) VALUES(?,?,?,?,?)').run(scope,sessionId,turn,endSeq,now);
  this.db.prepare('INSERT OR REPLACE INTO managed_workspaces VALUES(?,?)').run(scope,cwd);
  this.db.prepare("UPDATE learning_tasks SET state='overflow' WHERE scope=? AND state='pending' AND rowid NOT IN (SELECT rowid FROM learning_tasks WHERE scope=? AND state='pending' ORDER BY created DESC,end_seq DESC LIMIT 128)").run(scope,scope);
 }
 pending(cwd,now=Date.now()){return this.db.prepare("SELECT * FROM learning_tasks WHERE scope=? AND state='pending' AND next_attempt<=? ORDER BY created,session,end_seq LIMIT 16").all(this.scopeId(cwd),now);}
 finish(cwd,tasks,state='processed'){
  const update=this.db.prepare("UPDATE learning_tasks SET state=? WHERE scope=? AND session=? AND end_seq=? AND state='pending'");
  for(const task of tasks)update.run(state,this.scopeId(cwd),task.sessionId??task.session,task.endSeq??task.end_seq);
 }
 fail(cwd,tasks,now=Date.now()){
  for(const task of tasks)this.db.prepare("UPDATE learning_tasks SET attempts=attempts+1,next_attempt=?,state=CASE WHEN attempts>=2 THEN 'failed' ELSE 'pending' END WHERE scope=? AND session=? AND end_seq=? AND state='pending'").run(now+3600000,this.scopeId(cwd),task.sessionId??task.session,task.endSeq??task.end_seq);
 }
 defer(cwd,tasks,now=Date.now()){for(const task of tasks)this.db.prepare("UPDATE learning_tasks SET next_attempt=? WHERE scope=? AND session=? AND end_seq=? AND state='pending'").run(now+86400000,this.scopeId(cwd),task.sessionId??task.session,task.endSeq??task.end_seq);}
 queuedCount(cwd){return this.db.prepare("SELECT count(*) AS count FROM learning_tasks WHERE scope=? AND state='pending'").get(this.scopeId(cwd)).count;}
}
