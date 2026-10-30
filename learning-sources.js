import { createHash } from 'node:crypto';

const hash=text=>createHash('sha256').update(text).digest('hex');
const excluded=new Set(['plugin','compact-checkpoint','schedule','subagent','recalled']);
export const redactLearningText=value=>String(value).replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|[MN][A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{20,})\b/g,'[凭证已隐藏]').replace(/((?:api[_ -]?key|secret|password|access[_ -]?token|bot[_ -]?token|密码|密钥)\s*[:=]\s*["']?)[^\s"',;]{6,}/gi,'$1[凭证已隐藏]');
export function isContinuation(text){
 return /^(?:继续(?:吧)?|好(?:的|吧)?|可以(?:了|吧)?|开干吧|重试|再试(?:一)?次|嗯|行|yes|ok(?:ay)?|continue|go on)[\s。.!！?？]*$/i.test(text.trim());
}

// Keep complete user/outcome pairs. A continuation, inherited message or a
// synthetic schedule is not a new independent task merely because a turn ended.
export function completedTasks(header,events,{minTurnEvents=8,inheritedEventCount=0}={}){
 const tasks=[];let active=null;
 for(const event of events){
  if(event.type==='turn/start'){active={start:event,sources:[]};continue;}
  if(!active)continue;
  const {start,sources}=active;
  if(event.type!=='turn/end'){
   if(event.seq<Math.max(start.seq,inheritedEventCount))continue;
   let role,text;
   if(event.type==='user/message'&&event.surfaceOp==='append'&&!event.sourceEventSeqs?.length&&!excluded.has(event.data.source?.kind)){
    role='user';text=(event.data.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
   }else if(event.type==='assistant/message'){
    role='assistant';text=(event.data.message?.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n');
   }
   if(!text?.trim())continue;
   const clean=redactLearningText(text),excerpts=clean.length>2000?[clean.slice(0,700),clean.slice(-1300)]:[clean];
   for(const excerpt of excerpts)sources.push({sessionId:header.id,seq:event.seq,role,text:excerpt});
   continue;
  }
  const end=event;active=null;
  if(end.data.turn!==start.data.turn||['aborted','error','blocked','max-tokens'].includes(end.data.reason?.kind)||end.seq-start.seq<minTurnEvents)continue;
  const users=sources.filter(source=>source.role==='user');
  if(!users.length||users.every(source=>isContinuation(source.text))||!sources.some(source=>source.role==='assistant'))continue;
  const taskId=header.id+'#'+users[0].seq;
  tasks.push({id:taskId,sessionId:header.id,turn:end.data.turn,endSeq:end.seq,created:end.timestamp??header.createdAt??Date.now(),
   // Repeated observation of the same task always has the same identity.
   key:hash(taskId),sources:sources.map(source=>({...source,turnKey:header.id+'#'+end.seq,taskId,taskKey:hash(taskId)}))});
 }
 return tasks;
}

function tokens(text){
 const words=String(text).toLocaleLowerCase('en-US').match(/[a-z0-9]+|[\p{Script=Han}]{2,}/gu)??[],out=new Set();
 for(const word of words){if(/^[a-z0-9]+$/.test(word)){if(word.length>2)out.add(word);}else for(let i=0;i<word.length-1;i++)out.add(word.slice(i,i+2));}
 return out;
}
export function similarity(left,right){
 const a=tokens(left),b=tokens(right);if(!a.size||!b.size)return 0;
 let common=0;for(const token of a)if(b.has(token))common++;
 return common/Math.sqrt(a.size*b.size);
}
export function relatedCandidates(candidates,tasks,limit=8){
 const query=tasks.flatMap(task=>task.sources.map(source=>source.text)).join('\n');
 return candidates.map(candidate=>({...candidate,matchScore:similarity(query,JSON.stringify(candidate.summary))}))
  .sort((a,b)=>b.matchScore-a.matchScore||b.updated-a.updated||a.id.localeCompare(b.id)).slice(0,limit);
}
