import test from 'node:test';
import assert from 'node:assert/strict';
import { evidencedTurns,mergeObservations,publicationDecision,quoteMatches } from '../learning-policy.js';
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
test('quote matching tolerates whitespace and punctuation but still rejects fabrication',()=>{
 assert.equal(quoteMatches('修复服务并验证','修复服务并验证'),true,'逐字命中');
 assert.equal(quoteMatches('修复服务 并 验证','修复服务并验证'),true,'空白差异');
 assert.equal(quoteMatches('修复服务，并验证。','修复服务,并验证,'),true,'全角半角标点差异');
 assert.equal(quoteMatches('他说“完成”了','他说"完成"了'),true,'弯引号与直引号');
 assert.equal(quoteMatches('修复服务并验证','我修复了所有问题'),false,'编造内容必须失败');
 assert.equal(quoteMatches('凭证 [凭证已隐藏] 已保存','[凭证已隐藏]'),false,'脱敏片段不能作为引用');
 assert.equal(quoteMatches('修复服务','修'),false,'过短');
 assert.equal(quoteMatches('修复服务','x'.repeat(1001)),false,'过长');
 assert.equal(quoteMatches('修复服务',null),false,'非字符串');
});
