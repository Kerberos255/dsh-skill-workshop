import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkillProposalJson, SkillJsonFormatError } from '../skill-json.js';
import { learnSkill } from '../learning.js';
import { schema } from '../config.js';
import { fixture,experience } from './learning-fixture.mjs';

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
 const f=fixture({respond(request,index){const output=typeof outputs[index-1]==='function'?outputs[index-1](request):outputs[index-1];return {raw:output.text,finish:output.finish??'stop'};}});
 return {run:()=>f.run(),requests:f.requests,diags:f.diags,dispose:()=>f.close()};
}
test('malformed JSON gets exactly one fresh model attempt, with same source and no raw output echo',async()=>{
 const f=harness([{text:'not valid JSON content SECRET_SENTINEL'}, {text:'{"skip":true}'}]);
 try{
  assert.equal((await f.run()).empty,true);
  assert.equal(f.requests.length,2);
  assert.equal(f.requests[0].sessionId,f.requests[1].sessionId);
  assert.equal(f.requests[0].maxTokens,3072);
  assert.equal(f.requests[1].maxTokens,3072);
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
 const f=harness([request=>{const data=JSON.parse(request.messages[1].content[0].text),item=experience(data.tasks[0]);item.sources[0].sessionId='made-up';return {text:JSON.stringify({experiences:[item],skippedTaskIds:[]})};}]);
 try{
  await assert.rejects(f.run(),error=>error.message.includes('来源不匹配'));
  assert.equal(f.requests.length,1);
  assert.deepEqual(f.diags.map(x=>x.event),['learning.json-valid']);
 }finally{f.dispose()}
});
