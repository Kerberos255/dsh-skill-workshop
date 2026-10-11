import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyWorkshopFinish } from '../model-completion.js';
import { learnSkill } from '../learning.js';
import { schema } from '../config.js';

test('workshop reports actionable sanitized model completion causes',()=>{
 assert.doesNotThrow(()=>verifyWorkshopFinish({kind:'stop'},8192));
 const cases=[
  [undefined,'SKILL_LLM_NO_FINISH','未返回完成状态'],
  [{kind:'aborted'},'SKILL_LLM_ABORTED','被中止'],
  [{kind:'max-tokens'},'SKILL_LLM_MAX_TOKENS','8192 Tokens'],
  [{kind:'error',failure:{code:'RATE_LIMIT',status:429,detail:'SENSITIVE_ACCESS_TOKEN'}},'SKILL_LLM_STREAM_ERROR','RATE_LIMIT, HTTP 429']
 ];
 for(const [finish,code,hint] of cases)assert.throws(
  ()=>verifyWorkshopFinish(finish,8192),
  error=>error.code===code&&error.message.includes(hint)&&!error.message.includes('SENSITIVE_ACCESS_TOKEN')
 );
});

test('OpenCode Go skill inference always receives sessionId including settings-page calls',async()=>{
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-skill-model-session-'));
 const calls=[],cfg={...schema.defaults,minTurnEvents:2,reviewOutputTokens:1024};
 const header={id:'session-test-valid',cwd,origin:'desktop'};
 const records={header};
 const events=[
  {seq:1,type:'turn/start',data:{turn:1}},
  {seq:2,type:'user/message',surfaceOp:'append',data:{source:{kind:'user'},content:[{type:'text',text:'请给这个项目整理持续集成的可验证发布步骤'}]}},
  {seq:3,type:'assistant/message',data:{message:{content:[{type:'text',text:'执行单元测试、再部署与健康检查。'}]}}},
  {seq:4,type:'turn/end',data:{turn:1,reason:{kind:'stop'}}}
 ];
 const ctx={
  get:()=>undefined,
  sessionQuery:{
   async listSessions(){return [records];},
   async observeSession(){return {events,inheritedEventCount:0,[Symbol.dispose](){}};}
  },
  agentDefaultModel:{currentSelection(){return {provider:'opencode-go',model:'deepseek-v4.1-flash'};}},
  tokenMeter:{estimateMessage:()=>25},
  llm:{
   async resolveModelInfo(){return {context:{contextWindow:40000}};},
   async *stream(request){
    calls.push(request);
    yield {type:'text-delta',index:0,text:'{"skip":true}'};
    yield {type:'finish',reason:{kind:'stop'}};
   }
  }
 };
 const shop={async snapshot(){return {skills:[]};}};
 try{
  assert.equal((await learnSkill(ctx,shop,cwd,cfg,{})).empty,true);
  assert.equal((await learnSkill(ctx,shop,cwd,cfg,{})).empty,true);
  assert.equal(calls.length,2);
  assert.match(calls[0].sessionId,/^dsh-skill-[a-f0-9]{32}$/);
  assert.equal(calls[1].sessionId,calls[0].sessionId);
  const agent={session:{id:'session-agent-active',requestHeader(){return {config:{provider:'opencode-go',model:'deepseek-v4.1-flash'}};}}};
  assert.equal((await learnSkill(ctx,shop,cwd,cfg,{agent})).empty,true);
  assert.equal(calls[2].sessionId,'session-agent-active');
  assert(calls.every(c=>c.purpose==='skill-workshop'));
  cfg.reviewOutputTokens=4096;
  ctx.llm.resolveModelInfo=async()=>({context:{contextWindow:40000},defaultMaxTokens:2048});
  assert.equal((await learnSkill(ctx,shop,cwd,cfg,{})).empty,true);
  assert.equal(calls[3].maxTokens,2048,'model output budget must be capped at the provider limit');
 }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
