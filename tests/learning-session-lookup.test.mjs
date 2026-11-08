import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './learning-fixture.mjs';
import {sourceTasks} from '../learning.js';
import {completedTasks} from '../learning-sources.js';

test('background learning uses queued session IDs without catalog enumeration',async()=>{
 const f=fixture();
 try{
  const task=completedTasks(f.header,f.events,{minTurnEvents:2})[0];
  f.shop.learningStore.enqueue(f.cwd,task);
  f.ctx.sessionQuery.listSessions=async()=>{throw Error('must not scan all sessions');};
  let observations=0;
  f.ctx.sessionQuery.observeSession=async id=>{
   assert.equal(id,f.header.id);observations++;
   return {header:f.header,events:f.events,inheritedEventCount:0,[Symbol.dispose](){}};
  };
  const found=await sourceTasks(f.ctx,f.shop,f.cwd,f.cfg,{agent:{}});
  assert.deepEqual(found.map(item=>item.id),[task.id]);
  assert.equal(observations,1);
 }finally{f.close();}
});

test('queued IDs do not override observed session identity or owner boundary',async()=>{
 for(const changed of [{id:'wrong-session'}, {origin:'subagent'}]){
  const f=fixture();
  try{
   const task=completedTasks(f.header,f.events,{minTurnEvents:2})[0];
   f.shop.learningStore.enqueue(f.cwd,task);
   f.ctx.sessionQuery.listSessions=async()=>{throw Error('unexpected catalog scan');};
   f.ctx.sessionQuery.observeSession=async()=>({header:{...f.header,...changed},events:f.events,[Symbol.dispose](){}});
   const found=await sourceTasks(f.ctx,f.shop,f.cwd,f.cfg,{agent:{}});
   assert.equal(found.length,0);
   assert.equal(f.shop.learningStore.queuedCount(f.cwd),0);
  }finally{f.close();}
 }
});

test('manual learning still scans the session catalog for discovery',async()=>{
 const f=fixture();
 try{
  let calls=0;
  f.ctx.sessionQuery.listSessions=async()=>{calls++;return [{header:f.header}];};
  const found=await sourceTasks(f.ctx,f.shop,f.cwd,f.cfg,{sessionId:f.header.id});
  assert.equal(found.length,1);
  assert.equal(calls,1);
 }finally{f.close();}
});
