import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture,experience,markdown } from './learning-fixture.mjs';
import { completedTasks,isContinuation } from '../learning-sources.js';

test('first task stores only a compact candidate; renamed later evidence reuses its identity and publishes',async()=>{
 const f=fixture();try{
  const first=await f.run();assert.equal(first.staged.length,1);assert.equal(f.shop.proposals(f.cwd).length,0);assert.equal(f.requests.length,1);
  const id=first.staged[0].id;f.reopen();assert.equal(f.shop.learningStore.list(f.cwd)[0].id,id);
  f.addTask('修复另一个项目的配置文件，独立运行测试验证结果。');
  f.respond=request=>{const data=JSON.parse(request.messages[1].content[0].text);if(data.tasks){assert(data.relatedCandidates.some(row=>row.id===id));return {experiences:data.tasks.map(task=>experience(task,{candidateId:id,name:'same-method-different-name'})),skippedTaskIds:[]};}assert.equal(data.name,'verified-file-edit');return {files:{'SKILL.md':markdown(data.name)}};};
  const result=await f.run();assert.equal(result.publication.published,true);assert.equal(f.requests.length,3);assert.equal(f.shop.learningStore.list(f.cwd).length,0);assert.equal(f.shop.managed(f.cwd).length,1);
  assert(fs.existsSync(path.join(f.cwd,'.dsh/skills/verified-file-edit/SKILL.md')));
 }finally{f.close();}
});
test('observing the same task again and short continuations never add evidence or spend another model call',async()=>{
 const f=fixture();try{
  await f.run();const id=f.shop.learningStore.list(f.cwd)[0].id,stamp=f.shop.learningStore.byId(f.cwd,id).updated;
  assert.equal((await f.run()).empty,true);f.addTask('继续吧');assert.equal((await f.run()).empty,true);
  assert.equal(f.requests.length,1);assert.equal(f.shop.learningStore.byId(f.cwd,id).taskKeys.length,1);assert.equal(f.shop.learningStore.byId(f.cwd,id).updated,stamp);
 }finally{f.close();}
});
test('two independent task pairs can reinforce one new method within a single extraction batch',async()=>{
 const f=fixture();try{f.addTask('请在第二个独立项目执行同类修改并运行对应测试。');const result=await f.run();assert.equal(result.publication.published,true);assert.equal(f.requests.length,2);assert.equal(result.learning.observations,2);}finally{f.close();}
});
test('same topic without explicit same-procedure and independent-task confirmation cannot unlock publishing',async()=>{
 const f=fixture();try{
  await f.run();f.addTask('分析另一个类似问题，但还没有应用任何修改。');
  f.respond=request=>{const data=JSON.parse(request.messages[1].content[0].text);return {experiences:data.tasks.map(task=>experience(task,{candidateId:data.relatedCandidates[0].id,sameProcedure:false})),skippedTaskIds:[]};};
  assert.equal((await f.run()).empty,true);assert.equal(f.shop.learningStore.list(f.cwd)[0].taskKeys.length,1);assert.equal(f.shop.proposals(f.cwd).length,0);
 }finally{f.close();}
});
test('incomplete evidence batches commit nothing and keep their tasks for bounded retry',async()=>{
 const f=fixture({respond:request=>{const data=JSON.parse(request.messages[1].content[0].text),item=experience(data.tasks[0]);item.sources[1].sessionId='forged-session';return {experiences:[item],skippedTaskIds:[]};}});
 try{await assert.rejects(f.run(),/来源不匹配/);assert.equal(f.shop.learningStore.list(f.cwd).length,0);assert.equal(f.shop.proposals(f.cwd).length,0);assert.equal(f.shop.learningStore.queuedCount(f.cwd),1);assert.equal(f.requests.length,1);}finally{f.close();}
});
test('low-specificity or unverified experience does not enter the candidate pool',async()=>{
 const f=fixture({respond:request=>{const data=JSON.parse(request.messages[1].content[0].text);return {experiences:data.tasks.map(task=>experience(task,{quality:{reusability:3,verification:1,specificity:1}})),skippedTaskIds:[]};}});
 try{assert.equal((await f.run()).empty,true);assert.equal(f.shop.learningStore.list(f.cwd).length,0);assert.equal(f.requests.length,1);}finally{f.close();}
});
test('a full fresh pool with no relevant candidate is detected before any model resolution or stream',async()=>{
 const f=fixture({config:{maxLearningCandidates:4}});try{
  for(let n=0;n<4;n++)f.shop.learningStore.stage(f.cwd,{name:'astronomy-'+n,summary:{description:'quasar nebula astronomy',when:'cosmic telescope',steps:['spectrometry'],verify:'redshift',fallback:'calibrate'},turnKeys:['other#'+n],taskKeys:['other#'+n]});
  f.ctx.llm.resolveModelInfo=async()=>{throw Error('must not resolve model');};
  assert.match((await f.run()).message,/候选池已满/);assert.equal(f.requests.length,0);assert.equal(f.shop.learningStore.queuedCount(f.cwd),1);
 }finally{f.close();}
});
test('automatic publication disabled still waits for two tasks before creating a reviewable full proposal',async()=>{
 const f=fixture({config:{autoPublish:false}});try{
  await f.run();assert.equal(f.shop.proposals(f.cwd).length,0);f.addTask('处理第二个独立项目并完成验证。');
  const result=await f.run();assert.equal(result.publication.reason,'auto-publish-disabled');assert.equal(f.shop.proposals(f.cwd)[0].state,'pending');assert.equal(f.shop.managed(f.cwd).length,0);
  f.shop.reject(f.cwd,result.proposal.id);assert.equal(f.shop.learningStore.list(f.cwd).length,0);
 }finally{f.close();}
});
test('manual file changes are preserved when a learned update is attempted',async()=>{
 const f=fixture();try{
  await f.run();f.addTask('完成第二个独立文件修复并测试。');await f.run();const skill=f.shop.managed(f.cwd)[0];fs.appendFileSync(skill.path,'\n人工补充，不得覆盖。');
  f.addTask('再处理一个独立项目的文件修改和测试。');await f.run();assert(fs.readFileSync(skill.path,'utf8').endsWith('人工补充，不得覆盖。'));assert.equal(f.shop.learningStore.list(f.cwd).length,0);
 }finally{f.close();}
});
test('failed and synthetic turns do not count as independent completed tasks',()=>{
 const f=fixture();try{
  assert(isContinuation('好的'));assert(!isContinuation('请重新检查另一个项目'));
  f.events[1].data.source.kind='schedule';assert.equal(completedTasks(f.header,f.events,{minTurnEvents:2}).length,0);
  f.events[1].data.source.kind='user';f.events[3].data.reason.kind='error';assert.equal(completedTasks(f.header,f.events,{minTurnEvents:2}).length,0);
  f.events[3].data.reason.kind='stop';assert.equal(completedTasks(f.header,f.events,{minTurnEvents:2,inheritedEventCount:3}).length,0);
 }finally{f.close();}
});
test('long task messages preserve real beginning and outcome excerpts within the learning budget',async()=>{
 const f=fixture({initial:false,estimateMessage:value=>Math.ceil(JSON.stringify(value).length/2)});try{
  f.addTask('请修复项目。'+'背景说明'.repeat(3000)+'请运行完整测试。','已完成修改。'+'处理过程'.repeat(3000)+'验收：全部测试通过，差异已核对。');
  await f.run();assert.equal(f.requests.length,1);const data=JSON.parse(f.requests[0].messages[1].content[0].text);assert(data.tasks[0].sources.some(source=>source.text.endsWith('验收：全部测试通过，差异已核对。')));assert(data.tasks[0].sources.every(source=>source.text.length<=2000));
 }finally{f.close();}
});
test('a failed full draft keeps proven evidence, backs off and can retry without re-extracting task sources',async()=>{
 const f=fixture();try{
  await f.run();f.addTask('处理另一个独立项目并运行完整测试。');
  f.respond=request=>{const data=JSON.parse(request.messages[1].content[0].text);return data.tasks?{experiences:data.tasks.map(task=>experience(task,{candidateId:data.relatedCandidates[0].id})),skippedTaskIds:[]}:'invalid draft';};
  await assert.rejects(f.run(),error=>error.code==='SKILL_JSON_INVALID');const candidate=f.shop.learningStore.list(f.cwd)[0];assert.equal(candidate.taskKeys.length,2);assert.equal(candidate.draft_attempts,1);assert.equal(f.shop.learningStore.queuedCount(f.cwd),0);const calls=f.requests.length;
  assert.equal((await f.run()).empty,true);assert.equal(f.requests.length,calls);
  f.shop.learningStore.resetDraftFailures(f.cwd);f.respond=request=>{const data=JSON.parse(request.messages[1].content[0].text);assert(!data.tasks);return {files:{'SKILL.md':markdown(data.name)}};};assert.equal((await f.run()).publication.published,true);assert.equal(f.requests.length,calls+1);
 }finally{f.close();}
});
