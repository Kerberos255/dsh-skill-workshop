import test from 'node:test';
import assert from 'node:assert/strict';
import { evidencedTurns,mergeObservations,publicationDecision } from '../learning-policy.js';
import { reusableProcedure } from '../learning-policy.js';

test('paired real task sources count once per completed turn',()=>{
 const refs=[
  {turnKey:'s1#10',role:'user'}, {turnKey:'s1#10',role:'assistant'},
  {turnKey:'s1#10',role:'assistant'}, {turnKey:'s2#33',role:'user'},
  {turnKey:'s3#44',role:'assistant'}
 ];
 assert.deepEqual(evidencedTurns(refs),['s1#10']);
 assert.deepEqual(evidencedTurns([...refs,{turnKey:'s2#33',role:'assistant'}]),['s1#10','s2#33']);
});
test('duplicate evidence is idempotent across repeated learning runs',()=>{
 const once=mergeObservations([],['s1#10','s1#10']);
 const again=mergeObservations(once,['s1#10']);
 assert.deepEqual(again,['s1#10']);
 assert.equal(publicationDecision({observations:again,candidateId:'p1',proposalId:'p1'}).reason,'awaiting-independent-evidence');
});
test('auto publishes only when two independent successes and current proposal matches',()=>{
 const observations=mergeObservations(['s1#10'],['s2#20']);
 assert.equal(publicationDecision({observations,candidateId:'p2',proposalId:'p2'}).published,true);
 assert.equal(publicationDecision({observations,candidateId:'p2',proposalId:'p1'}).reason,'candidate-superseded');
 assert.equal(publicationDecision({observations,candidateId:'p2',proposalId:'p2',autoPublish:false}).reason,'auto-publish-disabled');
});
test('managed skill count blocks expansion but still permits existing skill updates',()=>{
 const input={observations:['s1#10','s2#20'],candidateId:'p2',proposalId:'p2',managedCount:64,maxManagedSkills:64};
 assert.equal(publicationDecision(input).reason,'managed-skill-limit');
 assert.equal(publicationDecision({...input,alreadyManaged:true}).published,true);
});
test('malformed or unpaired evidence never unlocks publication',()=>{
 const turns=evidencedTurns([{turnKey:'faked',role:'user'},{role:'assistant'},{turnKey:'',role:'assistant'}]);
 assert.deepEqual(turns,[]);
 assert.equal(publicationDecision({observations:turns,candidateId:'p',proposalId:'p'}).published,false);
});
test('model output without a reusable verification and rollback procedure is rejected',()=>{
 assert.equal(reusableProcedure('## 适用条件\n生产故障\n## 操作步骤\n修复\n## 验证\n测试\n## 回退\n回滚'),true);
 assert.equal(reusableProcedure('## 操作步骤\n总之问题解决了'),false);
});
