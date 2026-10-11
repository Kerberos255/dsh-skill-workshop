/** Validate model completion without treating a truncated or failed JSON as a skill. */
export function verifyWorkshopFinish(finish,maxTokens){
  if(finish && !['error','aborted','max-tokens'].includes(finish.kind))return;
  let code,message;
  if(!finish){
    code='SKILL_LLM_NO_FINISH';
    message='技能复查模型未返回完成状态，请检查模型服务或连接';
  }else if(finish.kind==='aborted'){
    code='SKILL_LLM_ABORTED';
    message='技能复查模型请求被中止';
  }else if(finish.kind==='max-tokens'){
    code='SKILL_LLM_MAX_TOKENS';
    message='技能复查模型输出达到 '+maxTokens+' Tokens 上限，结果可能被截断；未保存技能提案';
  }else{
    const status=finish.failure?.status;
    const raw=finish.failure?.code;
    const safe=typeof raw==='string'&&/^[A-Z][A-Z0-9_]{1,31}$/.test(raw)?raw:'UNKNOWN';
    code='SKILL_LLM_STREAM_ERROR';
    const http=Number.isInteger(status)&&status>=100&&status<=599?', HTTP '+status:'';
    message='技能复查模型调用失败（'+safe+http+'），请检查 DSH 模型服务、账户与网络';
  }
  const error=new Error(message);
  error.code=code;
  throw error;
}
