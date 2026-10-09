import { Remote, RemoteError } from '@deepseek-ai/dsh-typert-protocol';
import { PluginConfig } from './plugin-settings/remote-config.js';
import { schema } from './config.js';
import { Workshop } from './workshop.js';
import { workspace,scopeId } from './workspace-io.js';
import { learnSkill } from './learning.js';
import { trustedSkillSource } from './learning-access.js';

const json=value=>JSON.parse(JSON.stringify(value));

export default class SkillWorkshop extends PluginConfig {
 static inject=['dshHomePath','workspaceController','skills','sessionQuery','agentDefaultModel','llm','tokenMeter'];
 constructor(ctx,legacy={}){
  super(ctx,{service:'skillWorkshop',packageName:'dsh-skill-workshop',schema},legacy);this.context=ctx;this.closed=false;this.abort=new AbortController();this.configAbort=new AbortController();this.operations=new Set();this.learning=new Map();
  this.workshop=new Workshop(ctx.dshHomePath('skill-workshop','state.sqlite'),ctx,()=>this.configFile.value);
  this.workshop.db.exec('CREATE TABLE IF NOT EXISTS reviews(scope TEXT NOT NULL,session TEXT NOT NULL,turn INTEGER NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,result TEXT,PRIMARY KEY(scope,session,turn));');
  this.workshop.db.prepare("UPDATE reviews SET state='interrupted' WHERE state='running'").run();
  this.configFile.subscribe(()=>{this.configAbort.abort();this.configAbort=new AbortController();});
  ctx.on('tools/result',(exec,result)=>{if(!this.closed&&exec.name==='skill'&&!result.isError&&exec.agent?.session.header.cwd&&typeof exec.arguments?.name==='string')this.workshop.touch(exec.agent.session.header.cwd,exec.arguments.name);},{global:true});
  ctx.on('session/event',(session,event)=>{if(!this.closed&&event.type==='user/message'&&event.data.source?.kind==='skill-invocation'&&session.header.cwd&&typeof event.data.source.name==='string')this.workshop.touch(session.header.cwd,event.data.source.name);},{global:true});
  ctx.on('agent/status',({agent,status})=>{const cwd=agent.session.header.cwd;if(!cwd)return;const review=this.learning.get(scopeId(cwd));if(status==='running'){if(review&&!review.maintenance)review.abort.abort();}else this.reviewIdle(agent);},{global:true});
  ctx.on('agent/inbox/inserted',({agent})=>{if(agent.session.header.cwd)this.learning.get(scopeId(agent.session.header.cwd))?.abort.abort();},{global:true});
  ctx.effect(()=>{const timer=setInterval(()=>{void this.housekeeping().catch(()=>{});},6*3600000);timer.unref?.();void this.housekeeping().catch(()=>{});return()=>clearInterval(timer);});
  ctx.effect(()=>async()=>{this.closed=true;this.abort.abort();await Promise.allSettled([...this.operations]);this.workshop.close();});
  for(const initialize of initializers)initialize.call(this);
  ctx.inject(['tools'],scope=>scope.tools.register({name:'skill_workshop',description:'查看原生技能或提出修订。日常任务完成后的自动学习按工坊设置发布和整理受管技能；手工与导入提案在设置页审阅。',
   parameters:{type:'object',properties:{action:{type:'string',enum:['list','read','propose']},name:{type:'string'},revision:{type:['string','null']},files:{type:'object',additionalProperties:{type:'string'}},reason:{type:'string'}},required:['action'],additionalProperties:false},
   output:{schema:{type:'object',additionalProperties:true},render:(_args,result)=>[{type:'text',text:JSON.stringify(result)}]},
   execute:async(args,exec)=>{exec.signal.throwIfAborted();this.ready();const cwd=exec.agent?.session.header.cwd;if(!cwd)throw new Error('缺少会话工作区');const signal=AbortSignal.any([exec.signal,this.abort.signal,this.configAbort.signal]);
    const task=(async()=>{if(args.action==='list')return this.workshop.list(cwd,exec.agent,signal);
     if(args.action==='read'){const skill=await this.workshop.read(cwd,args.name,exec.agent,signal);if(!skill)return {skill:null};const {files,...metadata}=skill;return {skill:{...metadata,skillMarkdown:files['SKILL.md'],resources:Object.keys(files).filter(name=>name!=='SKILL.md')}};}
     const {before,files,...proposal}=await this.workshop.propose(cwd,{...args,action:'save'},exec.agent,signal);return {...proposal,files:Object.keys(files)};
    })();this.operations.add(task);try{return json(await task);}finally{this.operations.delete(task);}
   },
  }));
 }
 ready(){if(this.closed||!this.configFile.value.enabled)throw new RemoteError('workshop/unavailable','技能工坊已停用',{});}
 async run(operation){this.ready();const signal=AbortSignal.any([this.abort.signal,this.configAbort.signal]);const task=(async()=>{try{const cwd=await workspace(this.context,this.configFile.value,signal);signal.throwIfAborted();return json(await operation(cwd,signal));}catch(error){if(error instanceof RemoteError)throw error;throw new RemoteError('workshop/operation-failed',error.message,{});}})();this.operations.add(task);try{return await task;}finally{this.operations.delete(task);}}
 catalog(){return this.run(async(cwd,signal)=>({...await this.workshop.list(cwd,undefined,signal),learning:{busy:this.learning.has(scopeId(cwd)),reviews:this.workshop.db.prepare('SELECT * FROM reviews WHERE scope=? ORDER BY created DESC LIMIT 10').all(scopeId(cwd)),candidates:this.workshop.db.prepare('SELECT COUNT(*) AS count FROM learning_candidates WHERE scope=?').get(scopeId(cwd)).count,candidateLimit:this.configFile.value.maxLearningCandidates,managedLimit:this.configFile.value.maxManagedSkills}}));}
 health({cwd,agentPreset}={}){
  if(this.closed)throw new Error('技能工坊已卸载');const config=this.configFile.value;
  // A workspace can learn across presets; trust still follows the channel owner.
  const scope=cwd?scopeId(cwd):null,where=scope?' WHERE scope=?':'',args=scope?[scope]:[];
  const states=table=>Object.fromEntries(this.workshop.db.prepare('SELECT state,COUNT(*) AS count FROM '+table+where+' GROUP BY state').all(...args).map(row=>[row.state,row.count]));
  return {enabled:config.enabled,selfLearning:config.selfLearning,busy:scope?this.learning.has(scope):this.learning.size>0,proposals:states('proposals'),reviews:states('reviews'),recovery:states('publications')};
 }
 readSkill(name){return this.run(async(cwd,signal)=>({skill:await this.workshop.read(cwd,name,undefined,signal)}));}
 propose(request){return this.run((cwd,signal)=>this.workshop.propose(cwd,request,undefined,signal));}
 readProposal(id){return this.run(cwd=>this.workshop.proposal(cwd,id));}
 importSkill(request){return this.run((cwd,signal)=>this.workshop.import(cwd,request,signal));}
 applyProposal(id,confirmation){return this.run(cwd=>this.workshop.apply(cwd,id,confirmation));}
 rejectProposal(id){return this.run(cwd=>this.workshop.reject(cwd,id));}
 recheckPublications(){return this.run(cwd=>({recovery:this.workshop.publications.recover(cwd)}));}
 startLearning(sessionId){return this.run((cwd,signal)=>this.startReview(cwd,{sessionId,signal}));}
 cancelLearning(){return this.run(cwd=>{this.learning.get(scopeId(cwd))?.abort.abort();return {cancelled:true};});}
 async housekeeping(){
  if(this.closed||!this.configFile.value.enabled||this.sweeping)return;
  const signal=AbortSignal.any([this.abort.signal,this.configAbort.signal]);
  const task=(async()=>{
   this.workshop.db.prepare("DELETE FROM reviews WHERE session NOT LIKE 'manual-%' AND state IN ('completed','skipped','failed','cancelled','interrupted') AND created<?").run(Date.now()-180*86400000);
   for(const row of this.workshop.db.prepare('SELECT * FROM managed_workspaces').all()){
   signal.throwIfAborted();this.workshop.prune(row.cwd);if(!this.configFile.value.unusedDays)continue;
   const agents=this.context.get('agents')?.list()??[];
   if(this.learning.has(row.scope)||agents.some(agent=>agent.session.header.cwd&&scopeId(agent.session.header.cwd)===row.scope&&(agent.status!=='idle'||agent.inbox?.hasPending)))continue;
   try{await this.workshop.sweep(row.cwd,signal);}catch(error){if(signal.aborted)throw error;console.warn('[dsh-skill-workshop] 自动技能整理：',error.message);}
  }})();this.sweeping=task;this.operations.add(task);try{await task;}finally{this.operations.delete(task);this.sweeping=null;}
 }
 startReview(cwd,{sessionId,turn=0,signal,agent}={}){
  const scope=scopeId(cwd);if(this.learning.has(scope))throw new Error('此工作区正在生成技能提案');const abort=new AbortController(),combined=AbortSignal.any([abort.signal,this.abort.signal,this.configAbort.signal,...signal?[signal]:[]]);
  const id=sessionId??'manual-'+Date.now();this.workshop.db.prepare("INSERT OR REPLACE INTO reviews VALUES(?,?,?,'running',?,NULL)").run(scope,id,turn,Date.now());
  const entry={abort,maintenance:!!agent};this.learning.set(scope,entry);
  const learn=async signal=>{
   await this.workshop.sweep(cwd,signal);signal.throwIfAborted();
   const result=await learnSkill(this.context,this.workshop,cwd,this.configFile.value,{sessionId,signal,agent});signal.throwIfAborted();
   if(result.proposal)result.publication=this.workshop.autoApply(cwd,result.proposal.id,signal);return result;
  };
  const task=Promise.resolve().then(()=>{combined.throwIfAborted();return agent?agent.runMaintenance(nativeSignal=>learn(AbortSignal.any([combined,nativeSignal]))):learn(combined);});entry.task=task;this.operations.add(task);
  task.then(result=>this.workshop.db.prepare('UPDATE reviews SET state=?,result=? WHERE scope=? AND session=? AND turn=?').run(result.empty?'skipped':'completed',JSON.stringify(result),scope,id,turn),error=>this.workshop.db.prepare('UPDATE reviews SET state=?,result=? WHERE scope=? AND session=? AND turn=?').run(combined.aborted?'cancelled':'failed',JSON.stringify({error:error.message}),scope,id,turn)).finally(()=>{this.learning.delete(scope);this.operations.delete(task);}).catch(()=>{});
  return {started:true};
 }
 reviewIdle(agent){
  const config=this.configFile.value,cwd=agent.session.header.cwd;if(this.closed||!config.enabled||!config.selfLearning||!cwd||!trustedSkillSource(this.context,agent.session.header)||agent.status!=='idle'||agent.inbox?.hasPending||this.learning.size)return;
  if(!this.context.get('tools')?.get('skill_workshop',agent))return;
  const end=agent.session.snapshotEvents().findLast(event=>event.type==='turn/end');if(!end||['aborted','error','blocked','max-tokens'].includes(end.data.reason?.kind))return;
  const start=agent.session.snapshotEvents().findLast(event=>event.type==='turn/start'&&event.data.turn===end.data.turn&&event.seq<end.seq);
  if(!start||end.seq-start.seq<config.minTurnEvents)return;
  if(this.workshop.db.prepare('SELECT 1 FROM reviews WHERE scope=? AND session=? AND turn=?').get(scopeId(cwd),agent.session.id,end.data.turn))return;
  const now=Date.now(),scope=scopeId(cwd),latest=this.workshop.db.prepare('SELECT MAX(created) AS stamp,COUNT(*) AS count FROM reviews WHERE scope=? AND created>=?').get(scope,now-86400000);
  if(latest.count>=config.maxReviewsPerDay||latest.stamp&&now-latest.stamp<config.learningCooldownMinutes*60000)return;
  try{this.startReview(cwd,{sessionId:agent.session.id,turn:end.data.turn,agent});}catch{}
 }
}
const initializers=[];
for(const name of ['catalog','readSkill','propose','readProposal','importSkill','applyProposal','rejectProposal','recheckPublications','startLearning','cancelLearning'])Remote(SkillWorkshop.prototype[name],{kind:'method',name,static:false,private:false,addInitializer:fn=>initializers.push(fn)});
