import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillProposalJson, SkillJsonFormatError } from '../skill-json.js';
import { learnSkill } from '../learning.js';
import { schema } from '../config.js';

test('accepts only a single complete JSON object, with harmless wrapping',()=>{
 assert.deepEqual(parseSkillProposalJson('{"skip":true}'),{value:{skip:true},format:'direct'});
 assert.deepEqual(parseSkillProposalJson('```json\n{"skip":true}\n```').value,{skip:true});
 assert.deepEqual(parseSkillProposalJson('技能建议：\n{"skip":true}\n完毕').value,{skip:true});
 assert.deepEqual(parseSkillProposalJson('正文 {"note":"escaped \\"quoted\\" with { braces }"}').value,
  {note:'escaped "quoted" with { braces }'});
});
test('rejects truncated, ambiguous, oversized, non-object and invented-structure candidates',()=>{
 for(const body of [
  '{"skip":true', '{"skip":true}\n{"skip":true}', '[]', '[{"skip":true}]',
  '```json\n{"skip":true}\n```\n```json\n{"skip":true}\n```',
  '{"note":unquoted}', '{"skip":true}\n{"files":{}}', 'x'.repeat(262145),
 ]){
  assert.throws(()=>parseSkillProposalJson(body),error=>error instanceof SkillJsonFormatError&&
   error.code==='SKILL_JSON_INVALID'&&!error.message.includes(body.slice(0,30)));
 }
});
function harness(outputs){
 const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-skill-json-fixture-'));
 const header={id:'session-workshop-json',cwd,origin:'desktop'};
 const events=[
  {seq:1,type:'turn/start',data:{turn:1}},
  {seq:2,type:'user/message',surfaceOp:'append',data:{source:{kind:'user'},content:[{type:'text',text:'请给项目整理可靠的发布流程'}]}},
  {seq:3,type:'assistant/message',data:{message:{content:[{type:'text',text:'测试、部署、验证并准备回滚。'}]}}},
  {seq:4,type:'turn/end',data:{turn:1,reason:{kind:'stop'}}},
 ];
 const requests=[],diags=[];
 const ctx={
  sessionQuery:{
   async listSessions(){return [{header}]},
   async observeSession(){return {events,inheritedEventCount:0,[Symbol.dispose](){}}}
  },
  get(){return undefined},
  agentDefaultModel:{currentSelection(){return {provider:'opencode-go',model:'deepseek-v4.1-flash'}}},
  tokenMeter:{estimateMessage(){return 25}},
  llm:{
   async resolveModelInfo(){return {context:{contextWindow:40000},defaultMaxTokens:4096}},
   async *stream(request){
    requests.push(request);
    const value=outputs[requests.length-1];
    yield {type:'text-delta',index:0,text:value.text};
    yield {type:'finish',reason:{kind:value.finish??'stop'}};
   },
  }
 };
 const config={...schema.defaults,minTurnEvents:2,reviewOutputTokens:8000};
 const shop={async snapshot(){return {skills:[]}}};
 const run=()=>learnSkill(ctx,shop,cwd,config,{onDiagnostic:detail=>diags.push(detail)});
 return {run,requests,diags,dispose(){fs.rmSync(cwd,{recursive:true,force:true})}};
}
test('malformed JSON gets exactly one fresh model attempt, with same source and no raw output echo',async()=>{
 const f=harness([{text:'not valid JSON content SECRET_SENTINEL'}, {text:'{"skip":true}'}]);
 try{
  assert.equal((await f.run()).empty,true);
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[0].sessionId,f.requests[1].sessionId);
  assert.equal(f.requests[0].maxTokens,4096);
  assert.equal(f.requests[1].maxTokens,4096);
  assert.deepEqual(f.requests[0].messages[1],f.requests[1].messages[1]);
  assert(!JSON.stringify(f.requests[1]).includes('SECRET_SENTINEL'));
  assert.deepEqual(f.diags.map(x=>x.event),['learning.json-invalid','learning.json-valid']);
  assert.deepEqual(f.diags.map(x=>x.attempt),[1,2]);
  assert.equal(f.diags[0].formatCode,'no-object');
  assert.equal(Object.hasOwn(f.diags[0],'text'),false);
 }finally{f.dispose()}
});
test('repeated malformed JSON fails after second call; no proposal and only safe diagnostics',async()=>{
 const f=harness([{text:'invalid private content'}, {text:'```json\n{"skip":true'}]);
 try{
  await assert.rejects(f.run(),error=>error.code==='SKILL_JSON_INVALID');
  assert.equal(f.requests.length,2);
  assert.equal(f.diags.length,2);
  assert(f.diags.every(x=>x.event==='learning.json-invalid'&&!JSON.stringify(x).includes('private')));
 }finally{f.dispose()}
});
test('truncated model finish never retries and never creates proposals',async()=>{
 const f=harness([{text:'{"skip":true',finish:'max-tokens'}, {text:'{"skip":true}'}]);
 try{
  await assert.rejects(f.run(),error=>error.code==='SKILL_LLM_MAX_TOKENS');
  assert.equal(f.requests.length,1);
  assert.equal(f.diags.length,0);
 }finally{f.dispose()}
});
test('syntactically valid but untrusted sources fail evidence check without retry',async()=>{
 const f=harness([{text:JSON.stringify({reason:'verify',files:{'SKILL.md':'---\nname: safe-test\ndescription: Process\n---\n## Steps\nRun\n## Validate\nCheck\n## Rollback\nUndo'},sources:[{sessionId:'made-up',seq:99,quote:'forged'}]})}]);
 try{
  await assert.rejects(f.run(),error=>error.message.includes('来源不匹配'));
  assert.equal(f.requests.length,1);
  assert.deepEqual(f.diags.map(x=>x.event),['learning.json-valid']);
 }finally{f.dispose()}
});
