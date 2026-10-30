import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workshop,parseSkill } from '../workshop.js';
import { schema } from '../config.js';
import { learnSkill } from '../learning.js';

export const markdown=(name,steps='读取原文件，修改后运行测试并检查差异。')=>`---\nname: ${name}\ndescription: 对本地项目做有验证和回退的文件修改\n---\n\n## 适用条件\n需要修改有测试覆盖的本地项目。\n\n## 操作步骤\n${steps}\n\n## 验证标准\n测试通过且文件差异符合需求。\n\n## 失败回退\n恢复修改前的文件并重新验证。\n`;
export function experience(task,{candidateId=null,name='verified-file-edit',...changes}={}){
 return {taskId:task.taskId,candidateId,name,description:'对本地项目做有验证和回退的文件修改',reason:'成功验证的修改步骤具有明确的重复使用价值。',
  procedure:{when:'需要修改有测试覆盖的本地项目。',steps:['读取原文件和对应测试用例。','修改后运行测试并核对文件差异。'],verify:'测试通过且文件差异符合用户需求。',fallback:'恢复原文件并重跑原有测试。'},quality:{reusability:3,verification:3,specificity:3},
  sameProcedure:!!candidateId,independentTask:true,matchReason:'适用条件、读取修改步骤、测试验收与失败回退均一致。',
  sources:task.sources.filter(source=>['user','assistant'].includes(source.role)).map(source=>({sessionId:source.sessionId,seq:source.seq,quote:source.text.slice(0,160)})),...changes};
}
export function fixture(options={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-learning-pipeline-')),cwd=path.join(directory,'work'),home=path.join(directory,'home');
 fs.mkdirSync(cwd);fs.mkdirSync(home);fs.mkdirSync(path.join(cwd,'.git'));
 const cfg={...schema.defaults,minTurnEvents:2,...options.config},header={id:'learning-fixture-session',cwd,origin:'desktop',createdAt:Date.now()},events=[],requests=[],diags=[];
 let responder=options.respond??(request=>{const data=JSON.parse(request.messages[1].content[0].text);if(data.tasks)return {experiences:data.tasks.map((task,index)=>experience(task,{candidateId:data.relatedCandidates[0]?.id,name:data.relatedCandidates[0]?.name??'verified-file-edit',sameProcedure:!!data.relatedCandidates[0]||index>0})),skippedTaskIds:[]};return {files:{'SKILL.md':markdown(data.name)}};});
 const ctx={get(){return undefined;},emit(){},dshHomePath:(...parts)=>path.join(home,...parts),
  skills:{async get(name){const filename=path.join(cwd,'.dsh/skills',name,'SKILL.md');if(!fs.existsSync(filename))return null;const parsed=parseSkill(fs.readFileSync(filename,'utf8'));return {...parsed,path:filename,content:parsed.body};},
   async snapshot(){const base=path.join(cwd,'.dsh/skills');return {complete:true,skills:fs.existsSync(base)?(await Promise.all(fs.readdirSync(base).map(name=>ctx.skills.get(name)))).filter(Boolean):[]};}},
  sessionQuery:{async listSessions(){return [{header}];},async observeSession(){return {events,inheritedEventCount:0,[Symbol.dispose](){}};}},
  agentDefaultModel:{currentSelection(){return {provider:'opencode-go',model:'fixture-model'};}},tokenMeter:{estimateMessage:options.estimateMessage??(()=>25)},
  llm:{async resolveModelInfo(){return {context:{contextWindow:40000},defaultMaxTokens:4096};},async *stream(request){requests.push(request);const output=await responder(request,requests.length);request.signal?.throwIfAborted();yield {type:'text-delta',index:0,text:typeof output==='string'?output:output.raw??JSON.stringify(output.value??output)};if(output.finish!==false)yield {type:'finish',reason:{kind:output.finish??'stop'}};}}
 };
 let shop=new Workshop(path.join(home,'state.sqlite'),ctx,()=>cfg);
 const addTask=(user='请修复本地项目文件，运行测试并核对修改结果。',assistant='已经读取原文件并修复；测试通过，文件差异符合需求。',reason='stop')=>{
  const turn=events.filter(event=>event.type==='turn/end').length+1;
  const append=(type,data,extra={})=>{const event={seq:events.length+1,type,data,...extra};events.push(event);return event;};
  append('turn/start',{turn});append('user/message',{source:{kind:'user'},content:[{type:'text',text:user}]},{surfaceOp:'append'});append('assistant/message',{message:{content:[{type:'text',text:assistant}]}});return append('turn/end',{turn,reason:{kind:reason}});
 };
 if(options.initial!==false)addTask();
 return {directory,cwd,home,ctx,cfg,header,events,requests,diags,addTask,get shop(){return shop;},set respond(fn){responder=fn;},
  reopen(){shop.close();shop=new Workshop(path.join(home,'state.sqlite'),ctx,()=>cfg);},
  async run(args={}){const result=await learnSkill(ctx,shop,cwd,cfg,{...args,onDiagnostic:detail=>diags.push(detail)});if(result.proposal&&options.autoApply!==false)result.publication=shop.autoApply(cwd,result.proposal.id,args.signal);return result;},
  close(){shop.close();fs.rmSync(directory,{recursive:true,force:true});}
 };
}
