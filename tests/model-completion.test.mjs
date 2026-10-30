import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyWorkshopFinish } from '../model-completion.js';
import { learnSkill } from '../learning.js';
import { schema } from '../config.js';
import { fixture } from './learning-fixture.mjs';
import { completedTasks } from '../learning-sources.js';

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
 const f=fixture({config:{reviewOutputTokens:1024},respond:()=>({skip:true})});
 try{
  await f.run();f.addTask('请检查第二个项目并完成验证。');await f.run();
  assert.equal(f.requests.length,2);assert.match(f.requests[0].sessionId,/^dsh-skill-[a-f0-9]{32}$/);assert.equal(f.requests[1].sessionId,f.requests[0].sessionId);
  f.addTask('请检查第三个项目并完成验证。');for(const task of completedTasks(f.header,f.events,{minTurnEvents:2}))f.shop.learningStore.enqueue(f.cwd,task);
  const agent={session:{id:'real-native-agent-session',requestHeader(){return {config:{provider:'opencode-go',model:'fixture-model'}};}}};await f.run({agent});
  assert.equal(f.requests[2].sessionId,'real-native-agent-session');assert(f.requests.every(request=>request.purpose==='skill-workshop'));
  f.cfg.reviewOutputTokens=4096;f.ctx.llm.resolveModelInfo=async()=>({context:{contextWindow:40000},defaultMaxTokens:2048});f.addTask('请检查第四个项目并完成验证。');await f.run();assert.equal(f.requests[3].maxTokens,2048);
 }finally{f.close();}
});
