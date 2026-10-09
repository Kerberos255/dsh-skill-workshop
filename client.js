window.__ModuleLoader__.load({ id: 'dsh-skill-workshop', factory: require => {
const React = require('react');
// BEGIN GENERATED PLUGIN SETTINGS
// Embedded by build.mjs. React and the official Connection are provided by DSH.
const { Switch: DshSwitch, Button: DshButton } = require('@deepseek-ai/dsh-client-ui-primitives');
function createConfigScope(connection, endpoint) {
  let state = { status: 'loading', writable: connection.isLoopback !== false }, closed = false, serial = 0, saving = false;
  const listeners = new Set(), requests = new Set();
  const publish = next => { if (!closed) { state = next; for (const fn of listeners) fn(); } };
  const call = async (method, args) => {
    if (closed) throw new Error('插件已停用');
    const abort = new AbortController(); requests.add(abort);
    const timeout = setTimeout(() => abort.abort(), 15000);
    try {
      const result = await connection.rpc.call('/api', endpoint + '/' + method, { args }, abort.signal);
      if (!result.ok) throw Object.assign(new Error(result.error?.message || result.error?.code || '请求失败'), { code: result.error?.code });
      return result.value;
    } finally { clearTimeout(timeout); requests.delete(abort); }
  };
  const accept = value => publish({ ...value, status: 'ready', writable: connection.isLoopback !== false, requestError: '' });
  const scope = {
    getSnapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async reload() {
      const sequence = ++serial;
      try { const value = await call('getConfig', {}); if (sequence === serial) accept(value); return value; }
      catch (error) { if (sequence === serial) publish({ ...state, requestError: error.message }); throw error; }
    },
    async update(value, revision = state.revision) {
      if (saving) throw new Error('正在保存，请稍候');
      saving = true; ++serial;
      try { const result = await call('setConfig', { value, revision }); accept(result); return result; }
      finally { saving = false; }
    },
    set(key, value) { return scope.update({ ...state.value, [key]: value }); },
    call,
    async runAction() { const result = await call('runAction', {}); accept(result); return result; },
    close() { closed = true; ++serial; for (const abort of requests) abort.abort(); listeners.clear(); },
  };
  return scope;
}
function useFileConfig(scope) {
  return React.useSyncExternalStore(scope.subscribe, scope.getSnapshot, scope.getSnapshot);
}
const configValue=(value,key)=>key.split('.').reduce((current,part)=>current?.[part],value);
const configChange=(value,key,next)=>{
  const [head,...tail]=key.split('.');
  return {...value,[head]:tail.length?configChange(value[head],tail.join('.'),next):next};
};
function ModelPicker({ scope, kind='chat', provider, model, disabled, label, emptyLabel, onChange }) {
  const e=React.createElement, [catalog,setCatalog]=React.useState({groups:[]}), [error,setError]=React.useState('');
  React.useEffect(()=>{
    let active=true,sequence=0;
    const load=()=>{const current=++sequence;scope.call('modelCatalog',{kind}).then(value=>{if(active&&current===sequence){setCatalog(value);setError('');}}).catch(failure=>{if(active&&current===sequence)setError(failure.message);});};
    load();window.addEventListener('focus',load);return()=>{active=false;window.removeEventListener('focus',load);};
  },[scope,kind]);
  const encode=(provider,model)=>JSON.stringify([provider,model]),value=encode(provider||'',model||'');
  const known=catalog.groups.some(group=>group.models.some(entry=>group.id===provider&&entry.id===model));
  return e('div',null,e('select',{'aria-label':label,value,disabled,onChange:event=>{const [provider,model]=JSON.parse(event.target.value);onChange({provider,model});}},
    e('option',{value:encode('','')},emptyLabel || (kind==='embedding'?'词语检索（不使用向量模型）':'继承 DSH 默认模型')),
    provider&&model&&!known?e('option',{value},`${provider} / ${model}（当前配置）`):null,
    catalog.groups.map(group=>e('optgroup',{key:group.id,label:group.name||group.id},group.models.map(entry=>e('option',{key:entry.id,value:encode(group.id,entry.id)},entry.name||entry.id))))),
    error?e('small',{role:'status'},'模型目录暂不可用：'+error):kind==='embedding'&&!catalog.groups.length?e('small',null,'尚未注册向量模型。'):null);
}
function FileConfigPage({ scope, title, description, fields, actionLabel, credentialApi, credentials, credentialTitle='凭证', credentialsFirst=false }) {
  const e = React.createElement, snapshot = useFileConfig(scope);
  const [editor, setEditor] = React.useState({ base: null, draft: null, error: '', saved: false });
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false), alive = React.useRef(false);
  const dirty = !!editor.base && JSON.stringify(editor.draft) !== JSON.stringify(editor.base.value);
  const external = !!editor.base && snapshot.revision !== editor.base.revision;
  React.useEffect(() => {
    if (snapshot.status !== 'ready') return;
    setEditor(previous => !previous.base || (!busyRef.current && JSON.stringify(previous.draft) === JSON.stringify(previous.base.value))
      ? { base: snapshot, draft: structuredClone(snapshot.value), error: '', saved: previous.saved } : previous);
  }, [snapshot]);
  React.useEffect(() => {
    alive.current = true;
    let reloading = false;
    const reload = () => {
      if (busyRef.current || reloading) return;
      reloading = true;
      void scope.reload().catch(() => {}).finally(() => { reloading = false; });
    };
    reload(); window.addEventListener('focus', reload);
    const interval = actionLabel ? setInterval(() => { if (document.visibilityState !== 'hidden') reload(); }, 2000) : null;
    return () => { alive.current = false; window.removeEventListener('focus', reload); if (interval) clearInterval(interval); };
  }, [scope, actionLabel]);
  const work = async operation => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await operation(); }
    catch (error) { if (alive.current) setEditor(previous => ({ ...previous, error: error.message, errorCode: error.code, saved: false })); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  const replace = result => { if (alive.current) setEditor({ base: result, draft: structuredClone(result.value), error: '', saved: false }); };
  const change = (key, value) => setEditor(previous => ({ ...previous, draft: configChange(previous.draft,key,value), error: '', errorCode: '', saved: false }));
  const disabled = busy || !snapshot.writable || !editor.draft;
  const field = spec => {
    const value = configValue(editor.draft,spec.key), id = 'dsh-config-' + spec.key;
    const common = { id, disabled: disabled || spec.disabled, 'aria-label': spec.label };
    let input;
    if (spec.type === 'readonly') input = e('input', { ...common, type: 'text', readOnly: true, value: snapshot.details?.[spec.detail] ?? '', placeholder: spec.placeholder });
    else if (spec.type === 'boolean') input = e(DshSwitch, { label: spec.label, disabled: common.disabled, checked: value, onChange: next => change(spec.key, next) });
    else if (spec.type === 'multiline') input = e('textarea', {...common,rows:5,value,onChange:event=>change(spec.key,event.target.value)});
    else if (spec.type === 'list') input = e('textarea', {...common, rows: Math.max(3,Math.min(8,value.length+1)), value:editor.listText?.[spec.key]??value.join('\n'),
      onChange:event=>{const text=event.target.value;setEditor(previous=>({...previous,draft:configChange(previous.draft,spec.key,text.split(/[\n,]/).map(item=>item.trim()).filter(Boolean)),listText:{...previous.listText,[spec.key]:text},error:'',errorCode:'',saved:false}));} });
    else if (spec.type === 'model') input = e(ModelPicker,{scope,kind:spec.kind,provider:configValue(editor.draft,spec.providerKey),model:value,emptyLabel:spec.emptyLabel,disabled:common.disabled,label:spec.label,onChange:selection=>setEditor(previous=>({...previous,draft:configChange(configChange(previous.draft,spec.providerKey,selection.provider),spec.key,selection.model),error:'',errorCode:'',saved:false}))});
    else if (spec.type === 'select') input = e('select', { ...common, value, onChange: event => change(spec.key, spec.numeric ? Number(event.target.value) : event.target.value) }, spec.options.map(([key, label]) => e('option', { key, value: key }, label)));
    else if (spec.type === 'order' || spec.type === 'providers') input = e('ol', { className: 'dpc-order' }, value.map((key, index) => e('li', { key },
      e('span', { className: 'dpc-rank', 'aria-hidden': true }, index + 1), e('span', { className: 'dpc-provider-name' }, spec.labels[key] || key),
      spec.type === 'providers' ? e(DshSwitch, { label: '启用 ' + (spec.labels[key] || key), checked: editor.draft.enabledProviders.includes(key), disabled,
        onChange: next => change('enabledProviders', next ? [...editor.draft.enabledProviders, key] : editor.draft.enabledProviders.filter(item => item !== key)) }) : null,
      e('div', { className: 'dpc-order-actions' }, ...[-1, 1].map(delta => e(DshButton, {
        key: delta, type: 'button', disabled: disabled || index + delta < 0 || index + delta >= value.length,
        variant: 'ghost', size: 'sm', className: 'dpc-arrow', title: delta < 0 ? '上移' : '下移',
        'aria-label': (delta < 0 ? '上移 ' : '下移 ') + (spec.labels[key] || key),
        onClick: () => { const next = [...value]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; change(spec.key, next); },
      }, e('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true },
        e('path', { d: delta < 0 ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6' }))))))));
    else if (spec.type === 'choices') input = e('div', null, Object.entries(spec.labels).map(([key, label]) => e('label', { className: 'dpc-choice', key }, e('input', {
      type: 'checkbox', checked: value.includes(key), disabled, onChange: event => change(spec.key, event.target.checked ? [...value, key] : value.filter(x => x !== key)),
    }), ' ', label)));
    else input = e('input', { ...common, type: spec.type === 'number' ? 'number' : 'text', value,
      min: spec.min, max: spec.max, step: spec.step ?? 1,
      onChange: event => change(spec.key, spec.type === 'number' ? Number(event.target.value) : event.target.value),
    });
    return e('div', { className: 'dpc-field dpc-' + spec.type, key: spec.key },
      e('div', { className: 'dpc-label' }, e('label', { htmlFor: spec.type === 'boolean' ? undefined : id }, spec.label), spec.help ? e('small', null, spec.help) : null, spec.emptyHelp&&Array.isArray(value)&&!value.length?e('small',null,spec.emptyHelp):null),
      e('div', { className: 'dpc-control' }, input));
  };
  const visible=spec=>!spec.when||(Array.isArray(spec.when)?spec.when:[spec.when]).some(condition=>Object.entries(condition).every(([key,value])=>configValue(editor.draft,key)===value));
  const grouped=advanced=>{
    const groups=[];
    for(const spec of fields.filter(spec=>!!spec.advanced===advanced&&visible(spec))){
      if(!groups.length||groups.at(-1).title!==(spec.group||''))groups.push({title:spec.group||'',fields:[]});
      groups.at(-1).fields.push(spec);
    }
    return groups.map((group,index)=>e('section',{className:'dpc-group',key:index},group.title?e('h4',null,group.title):null,group.fields.map(field)));
  };
  const credentialView=credentialApi&&credentials&&snapshot.value?e(CredentialsPage,{api:credentialApi,refs:credentials(snapshot.value),writable:snapshot.writable,title:credentialTitle,expanded:credentialsFirst}):null;
  const reloadNeeded = external || snapshot.requestError || editor.errorCode?.includes('conflict');
  return e('form', { className: 'dpc-page', 'aria-label': title, onSubmit: event => { event.preventDefault(); if (disabled || external || (!dirty && !snapshot.error)) return;
    void work(async () => { const result = await scope.update(editor.draft, editor.base.revision); replace(result); if (alive.current) setEditor(previous => ({ ...previous, saved: true })); });
  } },credentialsFirst?credentialView:null,editor.draft?grouped(false):e('p',null,'正在读取配置…'),
    editor.draft&&fields.some(spec=>spec.advanced&&visible(spec))?e('details',{className:'dpc-advanced'},e('summary',null,'高级设置'),grouped(true)):null,
    snapshot.error ? e('p', { role: 'alert' }, '文件有误，运行时保留上一次有效设置。', snapshot.error.message, '；保存可修复文件。') : null,
    external ? e('p', { role: 'alert' }, '配置已被其他页面或文件编辑修改。重新载入后再保存，可避免覆盖外部修改。') : null,
    editor.error || snapshot.requestError ? e('p', { role: 'alert' }, editor.error || snapshot.requestError) : null,
    e('div', { className: 'dpc-actions' }, e(DshButton, { type: 'submit', variant: 'primary', disabled: disabled || external || (!dirty && !snapshot.error) }, busy ? '处理中…' : '保存'),
      reloadNeeded ? e(DshButton, { type: 'button', variant: 'outline', disabled: busy, onClick: () => void work(async () => replace(await scope.reload())) }, dirty ? '放弃草稿并重新载入' : '重新载入') : null,
      actionLabel ? e(DshButton, { type: 'button', variant: 'outline', disabled: busy || !snapshot.writable, onClick: () => void work(async () => { await scope.runAction(); }) }, actionLabel) : null,
      e('span', { role: 'status' }, editor.saved ? '已保存并生效' : dirty ? '尚未保存' : '')),
    snapshot.details ? e('p', { role: 'status' }, snapshot.details.message) : null,
    e('p', { className: 'dpc-note' }, '保存后自动应用，后续操作使用新配置。'),
    snapshot.configFile ? e('details', { className: 'dpc-path' }, e('summary', null, '配置文件'), e('code', null, snapshot.configFile)) : null,
    credentialsFirst?null:credentialView,
  );
}
function CredentialsPage({ api, refs, writable, title, expanded=false }) {
  const e = React.createElement;
  const [status, setStatus] = React.useState({}), [drafts, setDrafts] = React.useState({}), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const alive = React.useRef(false), running = React.useRef(false);
  const identity = JSON.stringify(refs);
  React.useEffect(() => {
    let active = true;
    alive.current = true;
    void api.describe(Object.keys(refs)).then(result => {
      if (!active) return;
      if (!result.ok) throw new Error(result.error?.message || '读取凭证状态失败');
      setStatus(result.value);
    }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; alive.current = false; };
  }, [api, identity]);
  const save = async (ref, clear) => {
    if (running.current || !writable) return; running.current = true; setBusy(true); setError('');
    try {
      const result = clear ? await api.unset(ref) : await api.set(ref, drafts[ref]);
      if (!result.ok) throw new Error(result.error?.message || '保存凭证失败');
      if (!alive.current) return;
      setDrafts(previous => ({ ...previous, [ref]: '' }));
      setStatus(previous => ({ ...previous, [ref]: { configured: !clear } }));
    } catch (reason) { if (alive.current) setError(reason.message); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  return e(expanded?'section':'details', { className: 'dpc-credentials' }, e(expanded?'h4':'summary', null, title), e('fieldset', { disabled: busy || !writable },
    e('p', null, '密钥单独保存到 DSH 凭证管理；已有密钥只显示配置状态。'),
    Object.entries(refs).map(([ref, label]) => e('div', { className: 'dpc-field', key: ref }, e('label', null, label, ' · ', ref),
      e('input', { type: 'password', autoComplete: 'new-password', 'aria-label': label + ' 密钥', value: drafts[ref] || '', placeholder: status[ref]?.configured ? '已配置；留空保持' : '未配置',
        onChange: event => setDrafts(previous => ({ ...previous, [ref]: event.target.value })) }),
      e('div', { className: 'dpc-actions' }, e(DshButton, { type: 'button', variant: 'outline', disabled: !drafts[ref], onClick: () => void save(ref, false) }, '保存密钥'),
        e(DshButton, { type: 'button', variant: 'ghost', disabled: !status[ref]?.configured, onClick: () => void save(ref, true) }, '清除密钥')))),
    error ? e('p', { role: 'alert' }, error) : null));
}
function installConfigPage(ctx, options) {
  const scope = createConfigScope(ctx.connection, options.endpoint);
  ctx.effect(() => {
    const refresh = () => { void scope.reload().catch(() => {}); };
    refresh(); window.addEventListener?.('focus', refresh);
    if (typeof document === 'undefined') return () => { window.removeEventListener?.('focus', refresh); scope.close(); };
    const style = document.createElement('style'); style.dataset.pluginConfig = options.packageName;
    style.textContent = `
      .dpc-page{max-width:760px;color:var(--dsw-alias-label-primary);font-size:14px}
      .dpc-page p,.dpc-page small{line-height:1.65;color:var(--dsw-alias-label-secondary)}
      .dpc-page [role=alert]{color:var(--dsw-alias-state-error-primary,#d64545)}
      .dpc-group+.dpc-group{margin-top:28px}.dpc-group h4{margin:0 0 8px;font-size:14px;font-weight:600}
      .dpc-field{display:grid;grid-template-columns:minmax(180px,1fr) minmax(160px,280px);gap:24px;padding:18px 0;border-bottom:1px solid var(--dsw-alias-border-l2);align-items:center}
      .dpc-label label{line-height:22px;font-weight:500}.dpc-label small{display:block;margin-top:4px;font-size:12px}
      .dpc-control{min-width:0}.dpc-boolean .dpc-control{justify-self:end}
      .dpc-field input:not([type=checkbox]),.dpc-field select,.dpc-field textarea{box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit}.dpc-field textarea{resize:vertical;line-height:1.6}
      .dpc-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:24px}
      .dpc-order{margin:0;padding:0;list-style:none;display:grid;gap:4px}.dpc-order li{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}
      .dpc-rank{font-size:12px;color:var(--dsw-alias-label-tertiary);width:20px;text-align:center;font-variant-numeric:tabular-nums}.dpc-provider-name{flex:1}.dpc-order-actions{display:flex;gap:2px}.dpc-arrow{min-width:28px;padding:0!important}
      .dpc-providers,.dpc-order{grid-template-columns:1fr;gap:12px}.dpc-choice{display:inline-flex;gap:4px;margin:4px 12px 4px 0}
      .dpc-note{font-size:12px}.dpc-path{overflow-wrap:anywhere;margin-top:16px;color:var(--dsw-alias-label-tertiary);font-size:12px}.dpc-path code{display:block;margin-top:8px;user-select:text}
      .dpc-credentials{border-top:1px solid var(--dsw-alias-border-l2);margin-top:24px;padding-top:18px}.dpc-credentials fieldset{border:0;padding:0;min-width:0}.dpc-page summary{cursor:pointer;line-height:22px}
      .dpc-credentials:first-child{border-top:0;margin-top:0;padding-top:0;margin-bottom:28px}.dpc-credentials h4{margin:0;font-size:14px;font-weight:600}
      .dpc-advanced{margin-top:28px;padding:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}.dpc-advanced>summary{font-weight:500}.dpc-advanced[open]>summary{margin-bottom:20px}
      .dpc-credentials .dpc-field{grid-template-columns:140px minmax(0,1fr) auto;gap:14px}.dpc-credentials .dpc-actions{margin:0}
      .dpc-page :is(select,input,textarea):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:3px}
      [data-plugin-detail="${options.packageName}"] [data-plugin-rows]:has(>ul>[data-plugin-row]:only-child):not(:has([data-state=failed],[data-state=off])){display:none}
      @media(max-width:620px){.dpc-field,.dpc-credentials .dpc-field{grid-template-columns:1fr;gap:10px}.dpc-boolean{grid-template-columns:1fr auto;gap:20px}}
    `;
    document.head.appendChild(style);
    return () => { window.removeEventListener?.('focus', refresh); scope.close(); style.remove(); };
  });
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: options.packageName },
    ({ view }) => view === 'summary' ? options.description : React.createElement(React.Fragment, null,
      options.panel ? React.createElement(options.panel, { scope, connection: ctx.connection }) : null,
      React.createElement(FileConfigPage, { ...options, scope }))));
  return scope;
}

// END GENERATED PLUGIN SETTINGS

function PluginPanel({scope}) {
 const e=React.createElement,snapshot=useFileConfig(scope);
 const [catalog,setCatalog]=React.useState(null),[editor,setEditor]=React.useState(null),[proposal,setProposal]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
 const alive=React.useRef(false),working=React.useRef(false),epoch=React.useRef(0),timer=React.useRef(null),serial=React.useRef(0);
 const reload=async()=>{const version=epoch.current,sequence=++serial.current,result=await scope.call('catalog',{});if(alive.current&&version===epoch.current&&sequence===serial.current){setCatalog(result);clearTimeout(timer.current);if(result.learning?.busy)timer.current=setTimeout(()=>{if(document.visibilityState!=='hidden')void reload().catch(reason=>{if(alive.current&&version===epoch.current)setError(reason.message);});},2000);}return result;};
 React.useEffect(()=>{alive.current=true;const version=++epoch.current;setCatalog(null);setEditor(null);setProposal(null);setError('');const refresh=()=>{clearTimeout(timer.current);if(document.visibilityState!=='hidden'&&snapshot.status==='ready'&&snapshot.value.enabled)void reload().catch(reason=>{if(alive.current&&version===epoch.current)setError(reason.message);});};refresh();window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{alive.current=false;++epoch.current;clearTimeout(timer.current);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[scope,snapshot.revision]);
 const work=async(fn)=>{if(working.current)return;const version=epoch.current;working.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(reason){if(alive.current&&version===epoch.current)setError(reason.message);}finally{working.current=false;if(alive.current)setBusy(false);}};
 const call=async(method,args)=>{const version=epoch.current,result=await scope.call(method,args);if(!alive.current||version!==epoch.current)return null;return result;};
 const open=async name=>{const result=await call('readSkill',{name});if(result)setEditor({...result.skill,originalName:result.skill.name});setProposal(null);};
 const submit=async(action,extra={})=>{const result=await call('propose',{request:{action,name:editor?.originalName,revision:editor?.revision??null,files:editor?.files,...extra}});if(result){setProposal(result);setEditor(null);await reload();}};
 const button=(label,onClick,variant='outline')=>e(DshButton,{type:'button',variant,disabled:busy||!snapshot.writable,onClick:()=>void work(onClick)},label);
 const draft=()=>{setEditor({originalName:null,revision:null,editable:true,files:{'SKILL.md':'---\nname: new-skill\ndescription: 填写何时使用这个技能\n---\n\n# 技能名称\n\n## 使用条件\n\n## 执行步骤\n\n## 验证结果\n'}});setProposal(null);};
 const display=value=>value===undefined?'（新文件）':typeof value==='string'?value:'（二进制资源 · '+Math.floor(value.base64.length*3/4)+' 字节，随技能包保留）';
 const review=async id=>{const result=await call('readProposal',{id});if(result)setProposal(result);setEditor(null);};
 return e('section',{className:'dpc-page workshop-panel','aria-label':'技能工坊'},
  e('style',null,'.workshop-panel{margin-bottom:32px}.workshop-toolbar{display:flex;gap:10px;flex-wrap:wrap}.workshop-skills{display:grid;gap:10px;margin:16px 0}.workshop-item{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px}.workshop-item h4{margin:0 0 6px}.workshop-item p{margin:6px 0;font-size:13px}.workshop-meta{font-size:12px;color:var(--dsw-alias-label-tertiary)}.workshop-editor textarea{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:13px/1.7 monospace;resize:vertical}.workshop-diff{display:grid;grid-template-columns:1fr 1fr;gap:12px}.workshop-diff pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:380px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);padding:12px;font:12px/1.6 monospace;border-radius:8px}.workshop-panel code{overflow-wrap:anywhere}@media(max-width:620px){.workshop-diff{grid-template-columns:1fr}}'),
  e('div',{className:'workshop-toolbar'},button('新建技能',async()=>draft(),'primary'),button('从文件导入',async()=>{const filename=window.prompt('导入技能目录、SKILL.md、ZIP 或 .skill.json 的路径');if(!filename)return;const result=await call('importSkill',{request:{path:filename}});if(result)setProposal(result);await reload();}),button(catalog?.learning?.busy?'取消技能学习':'从最近会话学习',async()=>{await call(catalog?.learning?.busy?'cancelLearning':'startLearning',{});}),button('刷新列表',reload)),
  error?e('p',{role:'alert'},error):null,notice?e('p',{role:'status'},notice):null,
  !catalog?e('p',null,'正在读取原生技能…'):e(React.Fragment,null,
   catalog.complete===false?e('p',{role:'alert'},'部分技能来源暂不可用，以下显示已读取的技能。'):null,
   e('p',{className:'workshop-meta'},'当前工作区：',e('code',null,catalog.workspace)),
   e('p',{className:'workshop-meta'},'自动学习候选：',catalog.learning?.candidates??0,' / ',catalog.learning?.candidateLimit??32,' · 已管理技能：',catalog.managed?.length??0,' / ',catalog.learning?.managedLimit??64),
   catalog.recovery?.length?e('section',{'aria-label':'技能发布恢复'},e('p',{role:'alert'},'有发布尚未核对完成。遇到外部修改会保留现有文件与恢复目录；请处理冲突后重新核对。'),catalog.recovery.map(row=>e('p',{className:'workshop-meta',key:row.id},row.name+' · '+({prepared:'另一个进程正在发布',committed:'发布已提交，恢复目录待核对','needs-review':'需要审阅文件变化'}[row.state]??row.state),row.error?' · '+row.error:'',e('br'),e('code',null,row.recoveryDirectory))),button('重新核对恢复',async()=>{await call('recheckPublications',{});await reload();})):null,
   catalog.learning?.busy?e('p',{role:'status'},'正在从已完成的任务提炼技能，并按发布设置应用。'):null,
   catalog.learning?.reviews?.length?e('details',null,e('summary',null,'技能学习记录'),catalog.learning.reviews.map(row=>{const result=row.result?JSON.parse(row.result):{};return e('p',{className:'workshop-meta',key:row.session+':'+row.turn},new Date(row.created).toLocaleString()+' · '+(row.state==='completed'?(result.publication?.published?'已自动发布':result.publication?.reason==='awaiting-independent-evidence'?'自动验证中（无需人工确认）':result.publication?.reason==='managed-skill-limit'?'已达技能容量上限，暂缓发布':result.publication?.reason==='auto-publish-disabled'?'自动发布已关闭，保留待审':'已生成候选，待自动检查'):({running:'执行中',skipped:'没有可复用的新经验',cancelled:'已取消',failed:'失败',interrupted:'已中断'}[row.state]??row.state)),row.state==='failed'?' · '+result.error:'');})):null,
   e('div',{className:'workshop-skills'},catalog.skills.length?catalog.skills.map(skill=>e('article',{className:'workshop-item',key:skill.name},
    e('h4',null,skill.name),e('p',null,skill.description),e('p',{className:'workshop-meta'},skill.provider,' · ',skill.source,' · ',skill.invocation.modelInvocable?'模型可调用':'模型调用已关闭',' · ',skill.invocation.userInvocable?'用户可调用':'用户调用已关闭'),catalog.managed?.some(row=>row.name===skill.name)?e('p',{className:'workshop-meta'},'自动学习 · ',catalog.managed.find(row=>row.name===skill.name).uses,' 次使用'):null,button(skill.editable?'查看 / 编辑':'查看 / 复制',()=>open(skill.name))
   )):e('p',null,'还没有本地技能。新建或导入后，原生技能列表会自动更新。')),
   e('details',null,e('summary',null,'提案与发布记录'),catalog.proposals.map(item=>e('div',{className:'workshop-item',key:item.id},e('strong',null,item.name),e('span',{className:'workshop-meta'},' · ',{pending:'待审阅',publishing:'发布待核对','needs-review':'恢复需审阅',applied:'已发布',rejected:'已拒绝'}[item.state]??item.state),e('p',null,item.reason),button('查看差异',()=>review(item.id))))),
  ),
  editor?e('section',{className:'workshop-editor'},e('h4',null,editor.originalName||'新技能草稿'),e('textarea',{'aria-label':'SKILL.md 内容',rows:18,disabled:busy||!editor.editable,value:editor.files['SKILL.md'],onChange:event=>setEditor({...editor,files:{...editor.files,'SKILL.md':event.target.value}})}),
   Object.keys(editor.files).filter(name=>name!=='SKILL.md').length?e('details',null,e('summary',null,'技能资源（保存时一并保留）'),Object.entries(editor.files).filter(([name])=>name!=='SKILL.md').map(([name,value])=>e('details',{key:name},e('summary',null,name),typeof value==='string'?e('textarea',{'aria-label':name+' 内容',rows:8,disabled:busy||!editor.editable,value,onChange:event=>setEditor({...editor,files:{...editor.files,[name]:event.target.value}})}):e('p',null,display(value))))):null,
   e('div',{className:'dpc-actions'},editor.editable?button('生成待审提案',()=>submit('save'),'primary'):null,
    editor.originalName?button('复制',async()=>{const name=window.prompt('新技能名称');if(name)await submit('duplicate',{newName:name});}):null,
    editor.originalName&&editor.editable?button('重命名',async()=>{const name=window.prompt('新技能名称',editor.originalName);if(name)await submit('rename',{newName:name});}):null,
    editor.originalName&&editor.editable?button(editor.invocation.modelInvocable||editor.invocation.userInvocable?'停用技能':'启用技能',()=>submit(editor.invocation.modelInvocable||editor.invocation.userInvocable?'disable':'enable')):null,
    editor.originalName&&editor.editable?button('删除技能',()=>submit('delete')):null,
    button('导出技能包',async()=>{const data=JSON.stringify({format:'dsh-skill-bundle',version:1,files:editor.files},null,2),url=URL.createObjectURL(new Blob([data],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=(editor.originalName||'skill')+'.skill.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}),button('关闭编辑',async()=>setEditor(null))),
  ):null,
  proposal?e('section',{'aria-label':'技能提案差异'},e('h4',null,'审阅：'+proposal.name),e('p',null,proposal.action==='delete'?'确认后删除技能目录与其中的资源文件。':'校验通过；确认后写入原生技能目录。'),
   [...new Set([...Object.keys(proposal.before),...Object.keys(proposal.files)])].map(name=>e('details',{key:name,open:name==='SKILL.md'},e('summary',null,name,JSON.stringify(proposal.before[name])===JSON.stringify(proposal.files[name])?' · 无变化':' · 已修改'),e('div',{className:'workshop-diff'},e('div',null,e('small',null,'当前内容'),e('pre',null,display(proposal.before[name]))),e('div',null,e('small',null,proposal.action==='delete'?'删除后':'提案内容'),e('pre',null,proposal.action==='delete'?'（删除）':display(proposal.files[name])))))),
   e('div',{className:'dpc-actions'},proposal.state==='pending'?button(proposal.action==='delete'?'确认删除':'确认发布',async()=>{if(!window.confirm((proposal.action==='delete'?'删除技能及其资源：':'发布技能：')+proposal.name+'？'))return;await call('applyProposal',{id:proposal.id,confirmation:proposal.name});setProposal(null);setNotice('已发布，原生技能列表已更新。');await reload();},'primary'):null,proposal.state==='pending'?button('拒绝提案',async()=>{await call('rejectProposal',{id:proposal.id});setProposal(null);await reload();}):null,button('关闭审阅',async()=>setProposal(null))),
  ):null,
 );
}

return { inject: ['slots', 'connection'], apply(ctx) { installConfigPage(ctx, { ...{"rowId":"skill-workshop","endpoint":"skillWorkshop","standalone":true,"title":"技能工坊","description":"从日常工作自动提炼、发布和更新技能，按使用情况整理受管技能；也支持手工编辑与导入。","fields":[{"key":"workspace","label":"工作区","type":"text","help":"留空时使用客户端默认工作区。"},{"key":"targetRoot","label":"新技能保存位置","type":"select","options":[["project","当前项目 · .dsh/skills"],["user","所有工作区 · DSH 用户技能"]]},{"key":"selfLearning","label":"完成任务后自动学习","type":"boolean","help":"成功完成任务且会话空闲时提炼经验；简短闲聊跳过，新消息会取消复查。"},{"key":"autoPublish","label":"自动发布学习成果","type":"boolean","help":"自动学习先积累独立成功任务证据；满足两条不同任务来源后自动发布。证据不足的候选无需人工确认，原有人工技能不被覆盖。"},{"key":"unusedDays","label":"受管技能闲置期限（天）","type":"number","min":0,"max":3650,"help":"超过期限先退役，0 关闭自动清理；手工创建、导入和修改过的技能保留。"},{"key":"pruneGraceDays","label":"退役后的保留期（天）","type":"number","min":1,"max":365,"help":"保留期结束后清理未变化的受管技能。"},{"key":"learningCooldownMinutes","label":"自动学习最短间隔（分钟）","type":"number","min":0,"max":1440,"advanced":true},{"key":"maxReviewsPerDay","label":"每工作区每日最多自动学习次数","type":"number","min":1,"max":100,"advanced":true},{"key":"reviewInputTokens","label":"学习输入 token 上限","type":"number","min":1000,"max":32768,"step":1},{"key":"reviewOutputTokens","label":"学习最大输出 token","type":"number","min":512,"max":16384,"step":1},{"key":"minTurnEvents","label":"用于学习的轮次最少事件数","type":"number","min":2,"max":1000,"help":"简短闲聊不进行自动提炼。","step":1},{"key":"maxSkillBytes","label":"单个技能正文上限（字节）","type":"number","min":4096,"max":1048576,"step":1},{"key":"maxBundleBytes","label":"技能包大小上限（字节）","type":"number","min":4096,"max":16777216,"step":1},{"key":"maxBundleFiles","label":"每包最多文件数","type":"number","min":1,"max":500,"step":1},{"key":"maxProposals","label":"最多待审提案数","type":"number","min":10,"max":500,"step":1},{"key":"maxLearningCandidates","label":"每工作区最多待验证技能候选","type":"number","min":4,"max":100,"help":"默认 32，超过 45 天未获得新证据的自动候选会失效；人工提案不受影响。"},{"key":"maxManagedSkills","label":"每工作区自动受管技能数量上限","type":"number","min":4,"max":500,"help":"默认 64；达到上限时暂缓自动创建，旧技能按闲置期限自然退役及清理。"},{"key":"historyDays","label":"已处理提案保留天数","type":"number","min":0,"max":3650,"help":"0 为永久保留；仅清理已发布或已拒绝的提案，待审与恢复中的提案会保留。","step":1},{"key":"maxHistory","label":"已处理提案数量上限","type":"number","min":0,"max":10000,"help":"0 为不限制；按当前工作区保留最近记录，技能文件不受影响。","step":1}],"packageName":"dsh-skill-workshop"}, panel: PluginPanel,  }); } };
} });
