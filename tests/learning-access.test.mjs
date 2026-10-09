import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {trustedSkillSource} from '../learning-access.js';

test('ordinary local work across different presets is allowed',()=>{
 const ctx={get(){return undefined;}};
 assert.equal(trustedSkillSource(ctx,{id:'local-1',cwd:'E:\\workspace',origin:'desktop'}),true);
 assert.equal(trustedSkillSource(ctx,{id:'group',cwd:'E:\\workspace',origin:'discord'}),false);
 assert.equal(trustedSkillSource(ctx,{id:'child',cwd:'E:\\workspace',origin:'subagent'}),false);
});
test('only verified owner DM may enter workspace-wide skill learning',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE bindings(session_id TEXT);CREATE TABLE receipts(session_id TEXT);CREATE TABLE archived_dm_sessions(session_id TEXT);');
 db.prepare('INSERT INTO bindings VALUES(?)').run('owner-dm');
 db.prepare('INSERT INTO bindings VALUES(?)').run('stranger-dm');
 db.prepare('INSERT INTO archived_dm_sessions VALUES(?)').run('old-dm');
 const core={store:{db},trustedMemorySession(id,owner){return owner==='owner'&&['owner-dm','old-dm'].includes(id);}};
 const ctx={get(name){return name==='channelCore'?core:undefined;}};
 const allowed=id=>trustedSkillSource(ctx,{id,cwd:'E:\\workspace'});
 try{
  assert.equal(allowed('owner-dm'),true);
  assert.equal(allowed('old-dm'),true);
  assert.equal(allowed('stranger-dm'),false);
  assert.equal(allowed('local'),true);
 }finally{db.close();}
});
test('legacy Channel Core without archival table still allows local work and rejects strangers',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE bindings(session_id TEXT);CREATE TABLE receipts(session_id TEXT);');
 db.prepare('INSERT INTO receipts VALUES(?)').run('untrusted-dm');
 const core={store:{db},trustedMemorySession(){return false;}};
 const ctx={get(name){return name==='channelCore'?core:undefined;}};
 try{
  assert.equal(trustedSkillSource(ctx,{id:'local',cwd:'E:\\workspace'}),true);
  assert.equal(trustedSkillSource(ctx,{id:'untrusted-dm',cwd:'E:\\workspace'}),false);
 }finally{db.close();}
});
