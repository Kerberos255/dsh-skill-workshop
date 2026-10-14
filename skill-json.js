/** Read one complete JSON object, without modifying JSON syntax or inventing fields.
 * Supports a single JSON fence or one balanced object surrounded by commentary.
 * Only returns data; evidence and publication validation remain separate.
 */
export class SkillJsonFormatError extends Error {
 constructor(formatCode) {
  super('技能复查未返回有效 JSON');
  this.name='SkillJsonFormatError';
  this.code='SKILL_JSON_INVALID';
  this.formatCode=formatCode;
 }
}
const fail=code=>{throw new SkillJsonFormatError(code);};
const toObject=text=>{
 let value;
 try {value=JSON.parse(text);}catch{return null;}
 return value && typeof value==='object' && !Array.isArray(value) ? value : null;
};
function balancedObject(text,start) {
 let depth=0,inString=false,escaped=false;
 for(let i=start;i<text.length;i++){
  const c=text[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"'){inString=true;continue;}
  if(c==='{')depth++;
  else if(c==='}'){
   depth--;
   if(depth===0)return {end:i+1,raw:text.slice(start,i+1)};
   if(depth<0)return null;
  }
 }
 return null;
}
export function parseSkillProposalJson(source) {
 if(typeof source!=='string'||!source.trim())fail('empty');
 if(source.length>262144)fail('too-large');
 const text=source.replace(/^\uFEFF/,'').trim();
 const direct=toObject(text);
 if(direct)return {value:direct,format:'direct'};
 if(text.startsWith('[')&&!text.startsWith('[{'))fail('not-object');
 // A fenced body is accepted only when there is exactly one fenced section
 // and the surrounding explanation contains no other object candidate.
 const fences=[...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/gi)];
 if(fences.length>1)fail('ambiguous');
 if(fences.length===1){
  const match=fences[0],before=text.slice(0,match.index),after=text.slice(match.index+match[0].length);
  if(/[{}\[\]]/.test(before+after))fail('ambiguous');
  const value=toObject(match[1].trim());
  if(!value)fail('invalid-fence');
  return {value,format:'fence'};
 }
 if(text.includes('```'))fail('invalid-fence');
 const start=text.indexOf('{');
 if(start<0)fail('no-object');
 const part=balancedObject(text,start);
 if(!part)fail('unclosed-object');
 const before=text.slice(0,start),after=text.slice(part.end);
 if(/[{}\[\]]/.test(before+after))fail('ambiguous');
 const value=toObject(part.raw);
 if(!value)fail('invalid-json');
 return {value,format:before.trim()||after.trim()?'wrapped':'direct'};
}
