import { defineConfig } from './plugin-settings/remote-config.js';
export const schema=defineConfig({enabled:true,workspace:'',targetRoot:'project',agentPreset:'agent',selfLearning:true,autoPublish:true,unusedDays:90,pruneGraceDays:7,learningCooldownMinutes:60,maxReviewsPerDay:8,reviewInputTokens:8000,reviewOutputTokens:4096,minTurnEvents:8,maxSkillBytes:1048576,maxBundleBytes:4194304,maxBundleFiles:100,maxProposals:100,maxLearningCandidates:32,maxManagedSkills:64,historyDays:180,maxHistory:500}, {
 unusedDays:v=>Number.isSafeInteger(v)&&v>=0&&v<=3650,pruneGraceDays:v=>Number.isSafeInteger(v)&&v>=1&&v<=365,
 learningCooldownMinutes:v=>Number.isSafeInteger(v)&&v>=0&&v<=1440,maxReviewsPerDay:v=>Number.isSafeInteger(v)&&v>=1&&v<=100,
 workspace:v=>v.length<=4096,targetRoot:v=>['project','user'].includes(v),
 maxSkillBytes:v=>Number.isSafeInteger(v)&&v>=4096&&v<=1048576,
 maxBundleBytes:v=>Number.isSafeInteger(v)&&v>=4096&&v<=16777216,
 maxBundleFiles:v=>Number.isSafeInteger(v)&&v>=1&&v<=500,
 maxLearningCandidates:v=>Number.isSafeInteger(v)&&v>=4&&v<=100,maxManagedSkills:v=>Number.isSafeInteger(v)&&v>=4&&v<=500,
 maxProposals:v=>Number.isSafeInteger(v)&&v>=10&&v<=500,
 historyDays:v=>Number.isSafeInteger(v)&&v>=0&&v<=3650,maxHistory:v=>Number.isSafeInteger(v)&&v>=0&&v<=10000,
 agentPreset:v=>/^[a-z0-9-]{1,80}$/.test(v),reviewInputTokens:v=>Number.isSafeInteger(v)&&v>=1000&&v<=32768,reviewOutputTokens:v=>Number.isSafeInteger(v)&&v>=512&&v<=16384,minTurnEvents:v=>Number.isSafeInteger(v)&&v>=2&&v<=1000,
});
