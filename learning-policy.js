// A successful turn is not a proof of a reusable skill. Require a supported
// user request and assistant outcome in two distinct completed task turns.
export function evidencedTurns(references) {
 const turns=new Map();
 for(const item of references){
  if(typeof item?.turnKey!=='string'||!item.turnKey||!['user','assistant'].includes(item.role))continue;
  const roles=turns.get(item.turnKey)??new Set();roles.add(item.role);turns.set(item.turnKey,roles);
 }
 return [...turns].filter(([,roles])=>roles.has('user')&&roles.has('assistant')).map(([key])=>key);
}
export function reusableProcedure(body) {
 const headings=String(body??'').split(/\r?\n/).filter(line=>/^\s*#{1,4}\s+/.test(line));
 return [
  /适用|前提|条件|when to use|prerequisite|condition/i,
  /步骤|操作|流程|step|procedure|workflow/i,
  /验证|验收|测试|verify|validat|test/i,
  /失败|回退|恢复|rollback|fallback|recovery/i,
 ].every(pattern=>headings.some(line=>pattern.test(line)));
}
export function mergeObservations(previous,latest,limit=16) {
 return [...new Set([...previous,...latest].filter(x=>typeof x==='string'&&x.length>0))].slice(-limit);
}
export function publicationDecision({observations=[],candidateId,proposalId,managedCount=0,alreadyManaged=false,maxManagedSkills=64,autoPublish=true}={}) {
 if(!autoPublish)return {published:false,reason:'auto-publish-disabled'};
 if(candidateId!==proposalId)return {published:false,reason:'candidate-superseded'};
 if(new Set(observations).size<2)return {published:false,reason:'awaiting-independent-evidence'};
 if(!alreadyManaged&&managedCount>=maxManagedSkills)return {published:false,reason:'managed-skill-limit'};
 return {published:true};
}
