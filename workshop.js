import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { parseDocument, stringify } from 'yaml';
import { isUtf8 } from 'node:buffer';
import { readZip } from './zip.js';
import { PublicationJournal } from './publication.js';
import { mergeObservations,publicationDecision } from './learning-policy.js';
import { scopeOf } from '@deepseek-ai/dsh-scope';
import { digest, readBounded, safePath, projectRoot, ownedDirectory, scopeId, absent } from './workspace-io.js';

const validName=value=>typeof value==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)&&value.length<=80&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
const bool=value=>{if(typeof value==='boolean')return value;if(typeof value==='string'&&/^(true|yes|on|1|false|no|off|0)$/i.test(value))return /^(true|yes|on|1)$/i.test(value);throw new Error('调用开关必须是布尔值');};
export function parseSkill(raw,maxBytes=1048576){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>maxBytes||raw.includes('\0'))throw new Error('技能文件过大或不是文本');
 const match=/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(raw);if(!match)throw new Error('需要 YAML frontmatter（以 --- 包围）');
 const doc=parseDocument(match[1],{uniqueKeys:true});if(doc.errors.length)throw new Error('YAML 无效：'+doc.errors[0].message);
 const meta=doc.toJS({maxAliasCount:20});if(!meta||Array.isArray(meta)||typeof meta!=='object')throw new Error('frontmatter 必须是对象');
 if(!validName(meta.name))throw new Error('名称使用小写字母、数字和连字符，最多 80 字符');
 if(typeof meta.description!=='string'||!meta.description.trim()||meta.description.length>2000)throw new Error('请填写技能描述（最多 2000 字符）');
 if(!match[2].trim())throw new Error('请填写技能正文');
 const invocation={modelInvocable:meta['disable-model-invocation']===undefined?true:!bool(meta['disable-model-invocation']),userInvocable:meta['user-invocable']===undefined?true:bool(meta['user-invocable'])};
 return {name:meta.name,description:meta.description,invocation,meta,body:match[2]};
}
export function changeSkill(raw,changes){const parsed=parseSkill(raw);return '---\n'+stringify({...parsed.meta,...changes})+'---\n'+parsed.body;}
export function validateBundle(files,config){
 if(!files||Array.isArray(files)||typeof files!=='object'||Object.keys(files).length>config.maxBundleFiles)throw new Error('技能文件数量超过限制');
 let size=0;for(const [file,text] of Object.entries(files)){
  if(!file||file.includes('\\')||file.includes(':')||file.includes('\0')||file.split('/').some(part=>!part||part==='.'||part==='..'||/[<>"|?*]/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)||/[. ]$/.test(part)))throw new Error('包内文件路径无效');
  if(typeof text==='string'){if(text.includes('\0'))throw new Error('文本资源包含 NUL 字符');size+=Buffer.byteLength(text);}else{
   if(file==='SKILL.md'||!text||Array.isArray(text)||Object.keys(text).length!==1||typeof text.base64!=='string'||text.base64.length>config.maxBundleBytes*2)throw new Error('二进制资源格式无效');
   const bytes=Buffer.from(text.base64,'base64');if(bytes.toString('base64')!==text.base64)throw new Error('二进制资源编码无效');size+=bytes.length;
  }if(size>config.maxBundleBytes)throw new Error('技能包超过大小限制');
 }
 if(!Object.hasOwn(files,'SKILL.md'))throw new Error('技能包需要 SKILL.md');return parseSkill(files['SKILL.md'],config.maxSkillBytes);
}
export function readBundle(directory,config){
 if(fs.lstatSync(directory).isSymbolicLink())throw new Error('联接目录仅供读取，请复制到工作区后编辑');
 const result={},stack=[['',directory]];let bytes=0,entries=0;
 while(stack.length){const [relative,current]=stack.pop();for(const entry of fs.readdirSync(current,{withFileTypes:true})){
  if(++entries>config.maxBundleFiles*10+100)throw new Error('技能包目录层数或条目过多');if(entry.isSymbolicLink())throw new Error('导入与编辑不支持符号链接或目录联接');
  const key=relative?relative+'/'+entry.name:entry.name,target=path.join(current,entry.name);
  if(entry.isDirectory())stack.push([key,target]);else if(entry.isFile()){
   if(Object.keys(result).length>=config.maxBundleFiles)throw new Error('技能文件数量超过限制');if(fs.statSync(target).size>config.maxBundleBytes)throw new Error('技能资源过大');const value=fs.readFileSync(target);bytes+=value.length;if(bytes>config.maxBundleBytes)throw new Error('技能包超过大小限制');result[key]=isUtf8(value)&&!value.includes(0)?value.toString('utf8'):{base64:value.toString('base64')};
  }else throw new Error('技能包包含特殊文件');
 }}validateBundle(result,config);return result;
}
const bundleHash=files=>digest(JSON.stringify(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))));
export class Workshop {
 constructor(filename,ctx,getConfig,options={}){fs.mkdirSync(path.dirname(filename),{recursive:true});this.ctx=ctx;this.getConfig=getConfig;this.db=new DatabaseSync(filename);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,scope TEXT NOT NULL,created INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL); CREATE INDEX IF NOT EXISTS proposal_scope ON proposals(scope,created);');
  this.publications=new PublicationJournal(this.db,{editable:(cwd,file)=>this.editable(cwd,file),hash:bundleHash,read:(filename,flat,limits)=>{if(flat){const text=readBounded(filename,limits.maxSkillBytes);return text===null?null:bundleHash({'SKILL.md':text});}return bundleHash(readBundle(filename,limits));},notify:(spec,destination)=>{try{ctx.emit('fs/observed',{displayPath:spec.action==='delete'?spec.source:spec.outputFlat?destination:path.join(destination,'SKILL.md')},{},{name:'write'});}catch(error){console.warn('[dsh-skill-workshop] 原生技能刷新通知失败：',error.message);}}},filename+'.publication-lock.sqlite',options.checkpoint);this.publications.recover();
  this.db.exec(`CREATE TABLE IF NOT EXISTS learned_proposals(id TEXT PRIMARY KEY,scope TEXT NOT NULL,sources TEXT NOT NULL,auto_publish INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS learning_candidates(scope TEXT NOT NULL,name TEXT NOT NULL,proposal_id TEXT NOT NULL,observations TEXT NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(scope,name));
   CREATE TABLE IF NOT EXISTS managed_workspaces(scope TEXT PRIMARY KEY,cwd TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS managed_skills(scope TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,revision TEXT NOT NULL,created INTEGER NOT NULL,last_used INTEGER NOT NULL,retired INTEGER,uses INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,name));`);
  this.recoverManaged();
 }
 candidate(cwd,name){const row=this.db.prepare('SELECT * FROM learning_candidates WHERE scope=? AND name=?').get(scopeId(cwd),name);return row?{...row,observations:JSON.parse(row.observations)}:null;}
 canStageLearning(cwd,name){
  this.prune(cwd);
  if(this.candidate(cwd,name))return true;
  return this.db.prepare('SELECT COUNT(*) AS count FROM learning_candidates WHERE scope=?').get(scopeId(cwd)).count<this.getConfig().maxLearningCandidates;
 }
 markLearning(cwd,id,sources,turnKeys=[]){
  const proposal=this.proposal(cwd,id),scope=scopeId(cwd),previous=this.candidate(cwd,proposal.name);
  if(!previous&&!this.canStageLearning(cwd,proposal.name))throw new Error('自动学习候选已达到安全上限');
  const observations=mergeObservations(previous?.observations??[],turnKeys),now=Date.now();
  this.db.prepare('INSERT INTO learned_proposals(id,scope,sources) VALUES(?,?,?)').run(id,scope,JSON.stringify(sources));
  this.db.prepare('INSERT OR REPLACE INTO managed_workspaces VALUES(?,?)').run(scope,cwd);
  this.db.prepare('INSERT INTO learning_candidates(scope,name,proposal_id,observations,updated) VALUES(?,?,?,?,?) ON CONFLICT(scope,name) DO UPDATE SET proposal_id=excluded.proposal_id,observations=excluded.observations,updated=excluded.updated').run(scope,proposal.name,id,JSON.stringify(observations),now);
  if(previous&&previous.proposal_id!==id)this.db.prepare("UPDATE proposals SET state='rejected' WHERE id=? AND state='pending' AND id IN (SELECT id FROM learned_proposals)").run(previous.proposal_id);
  return {observations:observations.length,ready:observations.length>=2};
 }
 managed(cwd){return this.db.prepare('SELECT * FROM managed_skills WHERE scope=? ORDER BY last_used DESC').all(scopeId(cwd));}
 remember(proposal,cwd){
  const filename=path.join(proposal.root,proposal.target,'SKILL.md'),revision=bundleHash(proposal.files),stamp=Date.now();
  this.db.prepare('INSERT INTO managed_skills VALUES(?,?,?,?,?,?,NULL,0) ON CONFLICT(scope,name) DO UPDATE SET path=excluded.path,revision=excluded.revision,last_used=excluded.last_used,retired=NULL').run(scopeId(cwd),proposal.name,filename,revision,stamp,stamp);
 }
 recoverManaged(){
  for(const row of this.db.prepare("SELECT p.scope,p.payload FROM proposals p JOIN learned_proposals l ON p.id=l.id WHERE p.state='applied' AND l.auto_publish=1 ORDER BY p.created,p.id").all()){
   const proposal=JSON.parse(row.payload),filename=path.join(proposal.root,proposal.target,'SKILL.md');
   if(proposal.action!=='save'||this.db.prepare('SELECT 1 FROM managed_skills WHERE scope=? AND name=?').get(row.scope,proposal.name))continue;
   try{if(bundleHash(readBundle(path.dirname(filename),this.getConfig()))===bundleHash(proposal.files))this.db.prepare('INSERT OR IGNORE INTO managed_skills VALUES(?,?,?,?,?,?,NULL,0)').run(row.scope,proposal.name,filename,bundleHash(proposal.files),Date.now(),Date.now());}catch{}
  }
 }
 autoApply(cwd,id,signal){
  signal?.throwIfAborted();const proposal=this.proposal(cwd,id),config=this.getConfig(),origin=this.db.prepare('SELECT 1 FROM learned_proposals WHERE id=? AND scope=?').get(id,scopeId(cwd));
  if(!config.enabled||!origin)return {published:false,reason:'manual-review'};
  const candidate=this.candidate(cwd,proposal.name),owned=this.db.prepare('SELECT * FROM managed_skills WHERE scope=? AND name=?').get(scopeId(cwd),proposal.name);
  if(proposal.source&&(!owned||owned.path!==proposal.source||owned.revision!==proposal.baseRevision))return {published:false,reason:'user-owned'};
  const decision=publicationDecision({observations:candidate?.observations??[],candidateId:candidate?.proposal_id,proposalId:id,
   managedCount:this.db.prepare('SELECT COUNT(*) AS count FROM managed_skills WHERE scope=?').get(scopeId(cwd)).count,
   alreadyManaged:!!owned,maxManagedSkills:config.maxManagedSkills,autoPublish:config.autoPublish});
  if(!decision.published)return decision;
  this.db.prepare('UPDATE learned_proposals SET auto_publish=1 WHERE id=?').run(id);signal?.throwIfAborted();
  this.apply(cwd,id,proposal.name);this.remember(proposal,cwd);
  this.db.prepare('DELETE FROM learning_candidates WHERE scope=? AND name=? AND proposal_id=?').run(scopeId(cwd),proposal.name,id);
  return {published:true,name:proposal.name};
 }
 touch(cwd,name,now=Date.now()){this.db.prepare('UPDATE managed_skills SET last_used=?,uses=uses+1 WHERE scope=? AND name=?').run(now,scopeId(cwd),name);}
 async sweep(cwd,signal,now=Date.now()){
  const config=this.getConfig();if(!config.enabled||!config.unusedDays)return {retired:0,deleted:0,protected:0};
  const result={retired:0,deleted:0,protected:0};
  for(const owned of this.managed(cwd)){
   signal?.throwIfAborted();if(now-owned.last_used<config.unusedDays*86400000)continue;
   const current=await this.read(cwd,owned.name,undefined,signal);signal?.throwIfAborted();
   let latest=this.db.prepare('SELECT * FROM managed_skills WHERE scope=? AND name=?').get(scopeId(cwd),owned.name);
   if(!latest||latest.last_used!==owned.last_used||latest.revision!==owned.revision)continue;
   if(!current||!current.editable||current.path!==owned.path||current.revision!==owned.revision){result.protected++;continue;}
   if(owned.retired&&now-owned.retired<config.pruneGraceDays*86400000)continue;
   const action=owned.retired?'delete':'disable',proposal=await this.propose(cwd,{action,name:owned.name,revision:owned.revision,reason:'自动学习技能长期未使用，按保留策略'+(owned.retired?'清理':'退役')},undefined,signal);
   signal?.throwIfAborted();if(JSON.stringify(this.getConfig())!==JSON.stringify(config))throw new Error('工坊设置已变化，取消技能整理');
   latest=this.db.prepare('SELECT * FROM managed_skills WHERE scope=? AND name=?').get(scopeId(cwd),owned.name);
   if(!latest||latest.last_used!==owned.last_used||latest.revision!==owned.revision){this.reject(cwd,proposal.id);continue;}
   this.apply(cwd,proposal.id,proposal.name);
   if(action==='delete'){this.db.prepare('DELETE FROM managed_skills WHERE scope=? AND name=?').run(scopeId(cwd),owned.name);result.deleted++;}
   else{this.db.prepare('UPDATE managed_skills SET revision=?,retired=? WHERE scope=? AND name=?').run(bundleHash(proposal.files),now,scopeId(cwd),owned.name);result.retired++;}
  }return result;
 }
 root(cwd,kind=this.getConfig().targetRoot){return kind==='user'?ownedDirectory(fs.realpathSync(this.ctx.dshHomePath()),'skills'):ownedDirectory(projectRoot(cwd),'.dsh/skills');}
 async lookup(scope,operation){
  const presets=this.ctx.get?.('agentPresets');if(scope!==undefined||!presets?.acquireScope)return operation(scope?.ctx?scopeOf(scope.ctx):scope);
  const lease=await presets.acquireScope(this.getConfig().agentPreset);try{return await operation(lease.key);}finally{await lease[Symbol.asyncDispose]();}
 }
 async snapshot(cwd,scope,signal){return this.lookup(scope,scope=>this.ctx.skills.snapshot({cwd,scope,signal}));}
 async list(cwd,scope,signal){this.prune(cwd);const catalog=await this.snapshot(cwd,scope,signal);return {...catalog,workspace:cwd,targetRoot:this.root(cwd),recovery:this.publications.rows(cwd),managed:this.managed(cwd),proposals:this.proposals(cwd).map(({files,before,...proposal})=>({...proposal,files:Object.keys(files)})),skills:catalog.skills.map(item=>({...item,editable:!!item.path&&this.editable(cwd,item.path)}))};}
 prune(cwd){
  const config=this.getConfig(),scope=scopeId(cwd),eligible="scope=? AND state IN ('applied','rejected') AND id NOT IN (SELECT id FROM publications)";
  const expiry=Date.now()-45*86400000;
  this.db.prepare("UPDATE proposals SET state='rejected' WHERE state='pending' AND id IN (SELECT proposal_id FROM learning_candidates WHERE scope=? AND updated<?)").run(scope,expiry);
  this.db.prepare('DELETE FROM learning_candidates WHERE scope=? AND updated<?').run(scope,expiry);
  // Bound only auto-learned history regardless of legacy manual-history settings.
  this.db.prepare("DELETE FROM proposals WHERE "+eligible+" AND id IN (SELECT id FROM learned_proposals) AND created<?").run(scope,Date.now()-180*86400000);
  if(config.historyDays>0)this.db.prepare('DELETE FROM proposals WHERE '+eligible+' AND created<?').run(scope,Date.now()-config.historyDays*86400000);
  if(config.maxHistory>0)this.db.prepare('DELETE FROM proposals WHERE '+eligible+' AND id NOT IN (SELECT id FROM proposals WHERE '+eligible+' ORDER BY created DESC,id DESC LIMIT ?)').run(scope,scope,config.maxHistory);
  this.db.prepare('DELETE FROM learned_proposals WHERE id NOT IN (SELECT id FROM proposals)').run();
 }
 editable(cwd,filename){
  const roots=[path.join(projectRoot(cwd),'.dsh/skills'),path.join(projectRoot(cwd),'.agents/skills'),path.join(this.ctx.dshHomePath(),'skills')];
  return roots.some(root=>{const relative=path.relative(root,filename);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);});
 }
 async read(cwd,name,scope,signal){if(!validName(name))throw new Error('无效技能名称');const skill=await this.lookup(scope,scope=>this.ctx.skills.get(name,{cwd,scope,signal}));if(!skill)return null;if(!skill.path)return {...skill,editable:false,files:{'SKILL.md':'---\n'+stringify({name:skill.name,description:skill.description})+'---\n'+skill.content},revision:null};
  const config=this.getConfig(),filename=skill.path,flat=path.basename(filename).toUpperCase()!=='SKILL.MD',files=flat?{'SKILL.md':readBounded(filename,config.maxSkillBytes)}:readBundle(path.dirname(filename),config);
  return {...skill,editable:this.editable(cwd,filename),files,revision:bundleHash(files),flat};
 }
 proposals(cwd){return this.db.prepare('SELECT * FROM proposals WHERE scope=? ORDER BY created DESC LIMIT ?').all(scopeId(cwd),this.getConfig().maxProposals).map(row=>({id:row.id,created:row.created,state:row.state,...JSON.parse(row.payload)}));}
 proposal(cwd,id){const row=this.db.prepare('SELECT * FROM proposals WHERE id=? AND scope=?').get(id,scopeId(cwd));if(!row)throw new Error('提案不存在或属于其他工作区');return {id:row.id,created:row.created,state:row.state,...JSON.parse(row.payload)};}
 async propose(cwd,request,scope,signal){
  this.prune(cwd);
  signal?.throwIfAborted();const config=this.getConfig();if(!config.enabled)throw new Error('技能工坊已停用');
  if(this.db.prepare("SELECT COUNT(*) AS count FROM proposals WHERE scope=? AND state='pending'").get(scopeId(cwd)).count>=config.maxProposals)throw new Error('待审提案数量已达上限，请先处理已有提案');
  const action=request.action??'save';if(!['save','rename','duplicate','disable','enable','delete'].includes(action))throw new Error('无效工坊操作');
  const current=request.name?await this.read(cwd,request.name,scope,signal):null;
  signal?.throwIfAborted();
  if(action!=='save'&&!current)throw new Error('原技能不存在');
  if(current&&action!=='duplicate'&&!current.editable)throw new Error('此技能由其他插件或只读来源提供，请复制到工作区');
  if(current&&request.revision!==current.revision)throw new Error('技能已被外部修改，请重新读取');
  let files=request.files??current?.files;if(action==='disable'||action==='enable')files={...current.files,'SKILL.md':changeSkill(current.files['SKILL.md'],{'disable-model-invocation':action==='disable','user-invocable':action!=='disable'})};
  if(action==='rename'||action==='duplicate'){if(!validName(request.newName))throw new Error('请填写有效的新名称');files={...current.files,'SKILL.md':changeSkill(current.files['SKILL.md'],{name:request.newName})};}
  const parsed=validateBundle(files,config),name=action==='delete'?current.name:parsed.name;
  if(action==='save'&&current&&name!==current.name)throw new Error('改变名称请使用重命名操作');
  const root=current&&action!=='duplicate'?path.dirname(current.flat?current.path:path.dirname(current.path)):this.root(cwd);
  const target=action==='delete'||(current&&!['rename','duplicate'].includes(action))?(current.flat?path.basename(current.path):path.basename(path.dirname(current.path))):name;
  const destination=safePath(root,target);if(!current||['rename','duplicate'].includes(action)){if(fs.existsSync(destination))throw new Error('目标名称已存在');}
  const payload={action,name,root,target,source:current?.path??null,flat:current?.flat??false,baseRevision:current?.revision??null,before:current?.files??{},files,reason:String(request.reason??'').slice(0,4000)};
  const id=randomUUID();this.db.prepare('INSERT INTO proposals VALUES(?,?,?,?,?)').run(id,scopeId(cwd),Date.now(),'pending',JSON.stringify(payload));return this.proposal(cwd,id);
 }
 async import(cwd,request,signal){
  signal?.throwIfAborted();if(typeof request.path!=='string'||request.path.length>4096)throw new Error('请填写导入目录或 SKILL.md 的路径');
  const imported=path.resolve(cwd,request.path);if(fs.lstatSync(imported).isSymbolicLink())throw new Error('导入不支持符号链接');const info=fs.statSync(imported);
 let files;if(info.isDirectory())files=readBundle(imported,this.getConfig());else if(imported.toLowerCase().endsWith('.zip')){
   if(info.size>this.getConfig().maxBundleBytes*2)throw new Error('ZIP 大小超过限制');files=readZip(fs.readFileSync(imported),this.getConfig());
  }else if(imported.endsWith('.skill.json')){
   const bundle=JSON.parse(readBounded(imported,this.getConfig().maxBundleBytes*2));if(bundle.format!=='dsh-skill-bundle'||bundle.version!==1)throw new Error('技能包格式或版本无效');files=bundle.files;
  }else files={'SKILL.md':readBounded(imported,this.getConfig().maxSkillBytes)};
  return this.propose(cwd,{files,reason:'从文件导入：'+imported},undefined,signal);
 }
 apply(cwd,id,confirmation){
  const proposal=this.proposal(cwd,id);if(proposal.state!=='pending')throw new Error('此提案已经处理');if(confirmation!==proposal.name)throw new Error('请明确确认技能名称');
  const config=this.getConfig();if(!config.enabled)throw new Error('技能工坊已停用');validateBundle(proposal.files,config);
  const destination=safePath(proposal.root,proposal.target),original=proposal.source;
  // Revalidate the root and original skill against this workspace at publication.
  if(!this.editable(cwd,path.join(proposal.root,proposal.target,'SKILL.md')))throw new Error('目标已不属于可编辑技能目录');
  if(original){const current=proposal.flat?{'SKILL.md':readBounded(original,config.maxSkillBytes)}:readBundle(path.dirname(original),config);if(bundleHash(current)!==proposal.baseRevision)throw new Error('技能已在外部修改，提案未发布');}
  if(!original||['rename','duplicate'].includes(proposal.action)){if(fs.existsSync(destination))throw new Error('目标名称已存在，提案未发布');}
  this.publications.apply(cwd,proposal,{maxSkillBytes:config.maxSkillBytes,maxBundleBytes:config.maxBundleBytes,maxBundleFiles:config.maxBundleFiles});return this.proposal(cwd,id);
 }
 reject(cwd,id){const proposal=this.proposal(cwd,id);if(proposal.state!=='pending')throw new Error('此提案已经处理');this.db.prepare("UPDATE proposals SET state='rejected' WHERE id=?").run(id);return this.proposal(cwd,id);}
 close(){this.publications.close();this.db.close();}
}
