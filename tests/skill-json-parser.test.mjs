import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillProposalJson, SkillJsonFormatError } from '../skill-json.js';

test('one JSON object works directly, fenced, or with harmless explanation',()=>{
 assert.deepEqual(parseSkillProposalJson('{"skip":true}'),{value:{skip:true},format:'direct'});
 assert.deepEqual(parseSkillProposalJson('```json\n{"skip":true}\n```').value,{skip:true});
 assert.deepEqual(parseSkillProposalJson('Result: {"skip":true} Done.').value,{skip:true});
 assert.deepEqual(parseSkillProposalJson('Result: {"note":"quoted \\"text\\" with { braces }"}').value,{note:'quoted "text" with { braces }'});
});
test('ambiguous, truncated, oversized, and invalid output is never accepted',()=>{
 for(const body of ['{"skip":true','{"skip":true} {"skip":true}','[]','[{"skip":true}]',
  '```json\n{"skip":true}\n```\n```json\n{"skip":true}\n```','{"note":unquoted}','a'.repeat(262145)]){
  assert.throws(()=>parseSkillProposalJson(body),err=>err instanceof SkillJsonFormatError&&err.code==='SKILL_JSON_INVALID');
 }
});
