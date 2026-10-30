import test from 'node:test';
import assert from 'node:assert/strict';
import {completedTasks,isContinuation,relatedCandidates} from '../learning-sources.js';

const header={id:'source-fixture',createdAt:Date.now()};
function turn(user='Repair this project and verify its tests.',assistant='Tests passed and the file diff matches the requested fix.',kind='stop'){
 return [{seq:1,type:'turn/start',data:{turn:1}},
  {seq:2,type:'user/message',surfaceOp:'append',data:{source:{kind:'user'},content:[{type:'text',text:user}]}},
  {seq:3,type:'assistant/message',data:{message:{content:[{type:'text',text:assistant}]}}},
  {seq:4,type:'turn/end',data:{turn:1,reason:{kind}}}];
}
test('a real completed task preserves paired roles and a stable identity',()=>{
 const events=turn(),first=completedTasks(header,events,{minTurnEvents:2});
 assert.equal(first.length,1);assert.deepEqual(first[0].sources.map(source=>source.role),['user','assistant']);
 assert.equal(first[0].key,completedTasks(header,events,{minTurnEvents:2})[0].key);
 const next=events.map(event=>({...event,seq:event.seq+4}));assert.notEqual(first[0].key,completedTasks(header,next,{minTurnEvents:2})[0].key);
});
test('continuations, synthetic sources, inherited users and incomplete turns add no independent evidence',()=>{
 for(const word of ['继续吧','好的','重试','ok','continue'])assert(isContinuation(word));
 assert(!isContinuation('Check a different project and run its tests.'));
 assert.equal(completedTasks(header,turn('继续吧'),{minTurnEvents:2}).length,0);
 for(const kind of ['aborted','error','blocked','max-tokens'])assert.equal(completedTasks(header,turn(undefined,undefined,kind),{minTurnEvents:2}).length,0);
 for(const kind of ['schedule','plugin','subagent','recalled','compact-checkpoint']){const events=turn();events[1].data.source.kind=kind;assert.equal(completedTasks(header,events,{minTurnEvents:2}).length,0);}
 assert.equal(completedTasks(header,turn(),{minTurnEvents:2,inheritedEventCount:3}).length,0);
 assert.equal(completedTasks(header,turn().slice(0,-1),{minTurnEvents:2}).length,0);
});
test('long results keep bounded original excerpts including the final verification',()=>{
 const original='Start of the repair. '+('intermediate work '.repeat(1000))+'End: all tests passed.';
 const task=completedTasks(header,turn(undefined,original),{minTurnEvents:2})[0],excerpts=task.sources.filter(source=>source.role==='assistant');
 assert.equal(excerpts.length,2);assert(excerpts.every(source=>source.text.length<=1300&&original.includes(source.text)));assert(excerpts[1].text.endsWith('End: all tests passed.'));
});
test('related candidate lookup retains stable IDs while ranking relevant methods first',()=>{
 const candidates=[{id:'travel',name:'route-planning',updated:1,summary:{description:'地铁公交路线规划，计算步行距离。'}},{id:'repair',name:'project-repair',updated:1,summary:{description:'修复项目文件并运行测试，检查文件差异。'}}];
 const tasks=[{sources:[{text:'请修复项目文件并运行测试，核对文件差异。'}]}],related=relatedCandidates(candidates,tasks,1);
 assert.equal(related.length,1);assert.equal(related[0].id,'repair');assert.equal(candidates.length,2,'retrieval must not merge or mutate candidates');
});
