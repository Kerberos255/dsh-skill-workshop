/** Workspace-local skill learning may use different Agent presets, but never
 * import unverified Discord/Feishu conversations into shared workspace skills.
 */
export function trustedSkillSource(ctx,header){
 if(!header?.id||!header.cwd||header.parentSession||header.origin==='subagent')return false;
 const isChannel=['channel','discord','feishu'].includes(header.origin);
 const core=ctx.get?.('channelCore');
 if(!core?.store?.db)return !isChannel;
 try{
  const db=core.store.db;
  let archived=false;
  try{archived=!!db.prepare('SELECT 1 FROM archived_dm_sessions WHERE session_id=? LIMIT 1').get(header.id);}
  catch(error){if(!/no such table/.test(error.message))throw error;}
  const present=!!(archived||db.prepare('SELECT 1 FROM bindings WHERE session_id=? LIMIT 1').get(header.id)
   ||db.prepare('SELECT 1 FROM receipts WHERE session_id=? LIMIT 1').get(header.id));
  if(!isChannel&&!present)return true;
  const ownerId=ctx.get?.('memoryDreaming')?.configFile?.value?.ownerIdentityId||'owner';
  return core.trustedMemorySession?.(header.id,ownerId)===true;
 }catch{return false;}
}
