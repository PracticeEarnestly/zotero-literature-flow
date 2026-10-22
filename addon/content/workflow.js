/* SPDX-License-Identifier: AGPL-3.0-or-later */
var LiteratureFlow = (() => {
  const C=LFCore, N=LFNotes, PREF='extensions.zotero.literatureFlowV1.config', LOGIN='chrome://literature-flow';
  let engine,pack,dir,config,observer,timer,stopped=false,writeChain=Promise.resolve(),automationEpoch=0;
  const debounce=new Map(),menuIDs=[],panels=new Set(),controllers=new Set();
  const defaults={baseURL:'',model:'Qwen3.6-27B-AWQ-Hermes-256K',allowedGroups:[],debounceMs:2500,intervalMs:5000,bindings:{}};
  const uuid=()=>Services.uuid.generateUUID().toString().replace(/[{}]/g,'');
  const hash=text=>{
    const bytes=new TextEncoder().encode(text),h=Components.classes['@mozilla.org/security/hash;1'].createInstance(Components.interfaces.nsICryptoHash);
    h.init(h.SHA256);h.update(bytes,bytes.length);return Array.from(h.finish(false),c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  };
  async function atomic(path,value) {await IOUtils.writeUTF8(path,JSON.stringify(value,null,2),{tmpPath:path+'.tmp'});}
  async function read(path) {try{return JSON.parse(await IOUtils.readUTF8(path));}catch(e){if(await IOUtils.exists(path))throw new Error('review-corrupt-local-state');return null;}}
  function scope(libraryID) {
    const lib=Zotero.Libraries.get(libraryID);
    if(lib.libraryType==='group')return 'group:'+lib.groupID;
    return Zotero.Users.getCurrentUserID() ? 'user:'+Zotero.Users.getCurrentUserID() : 'local:'+engine.state.device;
  }
  function allowed(item) {
    const lib=Zotero.Libraries.get(item.libraryID);
    return !!lib?.editable && (item.libraryID===Zotero.Libraries.userLibraryID || lib.libraryType==='group' && config.allowedGroups.includes(lib.groupID));
  }
  async function get(id) {
    const item=await Zotero.Items.getAsync(id);
    if(!item?.isRegularItem?.())return null;
    const notes=[];
    for(const nid of item.getNotes()) {const n=await Zotero.Items.getAsync(nid);if(n && !n.deleted)notes.push({key:n.key,id:n.id,html:n.getNote(),tags:n.getTags().map(t=>t.tag)});}
    return {id:item.id,key:item.key,scope:scope(item.libraryID),libraryID:item.libraryID,title:item.getField('title'),extra:item.getField('extra'),tags:item.getTags().map(t=>t.tag),authors:item.getCreators().map(c=>c.name||[c.firstName,c.lastName].filter(Boolean).join(' ')).join(', '),dateAdded:Date.parse(item.dateAdded.replace(' ','T')+'Z'),deleted:item.deleted,writable:allowed(item),notes};
  }
  async function normalized(items) {
    const ids=new Set();
    for(let i of items) {
      if(typeof i==='number')i=await Zotero.Items.getAsync(i);
      if(i?.parentItemID)i=await Zotero.Items.getAsync(i.parentItemID);
      if(i?.isRegularItem?.())ids.add(i.id);
    }
    return (await Promise.all([...ids].map(get))).filter(Boolean);
  }
  async function allItems() {
    const libs=Zotero.Libraries.getAll().filter(l=>l.libraryID===Zotero.Libraries.userLibraryID || l.libraryType==='group' && config.allowedGroups.includes(l.groupID));
    const result=[];
    for(const lib of libs)result.push(...await normalized(await Zotero.Items.getAll(lib.libraryID,true,false)));
    return result;
  }
  async function input(item) {
    const parent=await Zotero.Items.getAsync(item.id),atts=await Zotero.Items.getAsync(parent.getAttachments());
    const binding=config.bindings[item.scope+'/'+item.key];
    const pdfs=atts.filter(a=>a.attachmentContentType==='application/pdf' && !a.deleted);
    const pdf=binding ? pdfs.find(p=>p.key===binding.pdf) : pdfs.length===1 ? pdfs[0] : null;
    if(!pdf)throw new Error(pdfs.length>1 ? 'waiting-main-pdf-selection' : 'waiting-pdf');
    const path=await pdf.getFilePathAsync();
    if(!path || !await IOUtils.exists(path))throw new Error('waiting-local-pdf');
    const st=await IOUtils.stat(path);
    if(binding?.markdown) {
      const md=atts.find(a=>a.key===binding.markdown);
      const mp=await md?.getFilePathAsync();
      if(!mp || !await IOUtils.exists(mp))throw new Error('waiting-local-markdown');
      if(!/\.(md|markdown|html?)$/i.test(mp))throw new Error('review-markdown-type');
      const raw=await IOUtils.readUTF8(mp),text=/\.html?$/i.test(mp) ? C.visible(raw) : raw;
      // Binding explicitly confirms the main PDF correspondence; file replacement invalidates it.
      if(binding.pdfSize!==st.size || binding.pdfModified!==st.lastModified || binding.markdownHash!==hash(raw))throw new Error('review-binding-source-changed');
      return {text,hash:hash(text),mode:'MINERU_TEXT',complete:true,pdfKey:pdf.key,attachmentKey:md.key,coverage:'user-confirmed',imagesSent:0};
    }
    const row=await Zotero.Fulltext.getPages(pdf.id);
    // Zotero DB rows are proxies; never persist or JSON-serialize the row itself.
    const stats=row ? {indexedPages:row.indexedPages,total:row.total} : null;
    if(!stats || !stats.total || stats.indexedPages!==stats.total)throw new Error('waiting-fulltext-coverage');
    const cache=Zotero.Fulltext.getItemCacheFile(pdf).path;
    if(!await IOUtils.exists(cache))throw new Error('waiting-fulltext-cache');
    const cacheStat=await IOUtils.stat(cache);
    if(cacheStat.lastModified < st.lastModified)throw new Error('waiting-stale-index');
    const text=await IOUtils.readUTF8(cache);
    return {text,hash:hash(text+'|'+pdf.key+'|'+st.size+'|'+st.lastModified),mode:'PDF_TEXT',complete:!!text.trim(),pdfKey:pdf.key,coverage:stats,imagesSent:0};
  }
  function endpoint(base) {
    const url=Services.io.newURI(base.trim());
    if(!['http','https'].includes(url.scheme) || !url.host || url.host==='0.0.0.0' || url.userPass || /[?#]/.test(base))throw new Error('review-endpoint');
    return base.trim().replace(/\/+$/,'').replace(/\/chat\/completions$/,'');
  }
  async function key() {return (await Services.logins.findLogins(LOGIN,null,'Literature Flow'))[0]?.password || '';}
  async function setKey(value) {
    const old=await Services.logins.findLogins(LOGIN,null,'Literature Flow');
    for(const login of old)Services.logins.removeLogin(login);
    if(value){const l=Components.classes['@mozilla.org/login-manager/loginInfo;1'].createInstance(Components.interfaces.nsILoginInfo);l.init(LOGIN,null,'Literature Flow','api',value,'','');await Services.logins.addLoginAsync(l);}
  }
  async function http(path,body,timeout=pack.timeoutMs) {
    const base=endpoint(config.baseURL),token=await key(),ac=new AbortController();controllers.add(ac);
    const timeoutID=setTimeout(()=>ac.abort(),timeout);
    try {
      const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token} : {})},body:body?JSON.stringify(body):undefined,signal:ac.signal,redirect:'error'});
      if(!r.ok)throw Object.assign(new Error('http-'+r.status),{code:'http-'+r.status});
      try{return await r.json();}catch{throw new Error('output-invalid-json');}
    }catch(e){if(/^(http-|output-)/.test(e.message))throw e;throw new Error('network-request-failed');}
    finally{clearTimeout(timeoutID);controllers.delete(ac);}
  }
  async function request(item,stage,source,contract) {
    if(!config.model.trim())throw new Error('review-model-empty');
    const prompt=contract.stages[stage].prompt.replace(/\{\{title\}\}/g,()=>item.title).replace(/\{\{authors\}\}/g,()=>item.authors);
    const data=await http('/chat/completions',{model:config.model,...contract.parameters,messages:[{role:'system',content:contract.system},{role:'user',content:prompt+'\n\n<Paper>\n'+source.text+'\n</Paper>'}]});
    const choice=data.choices?.[0];
    return {text:choice?.message?.content,finish:choice?.finish_reason,model:data.model,usage:data.usage};
  }
  const noteSignature=item=>JSON.stringify(item.notes.map(n=>({id:n.id,key:n.key,html:n.html,tags:n.tags})).sort((a,b)=>a.id-b.id));
  async function formattedBodies(item){
    const result={};
    for(const n of item.notes){
      if(!n.tags.includes('LF:Note')||n.tags.includes('LF:Combined')||n.tags.includes('LF:Archive'))continue;
      const record=C.marker(n),task=engine.state.tasks.find(t=>t.id===record?.task);if(!task?.response)continue;
      try{
        const e=await read(task.response);if(e?.contract!==record.prompt)continue;
        const output=C.validate(e.response,record.stage,pack),body=N.singleBody(n).body;
        const old=output.text.replace(/LF_RECORD_V1/g,'LF_QUOTED_RECORD_V1').split(/\r?\n/).map(l=>/^\s*#{1,6}\s/.test(l)?'<h3>'+C.escape(l.replace(/^\s*#{1,6}\s+/,''))+'</h3>':'<p>'+C.escape(l||' ')+'</p>').join('\n')+'<p>输入：'+C.escape(record.source)+'；文本分析，未发送图像。结构校验不等于科学事实验证。</p>';
        const norm=s=>C.visible(s).replace(/\s+/g,' ').trim();
        if(norm(body)===norm(old))result[n.key]=C.renderBody(output.text,record);
      }catch{/* Unavailable source or user edits: preserve the existing HTML verbatim. */}
    }
    return result;
  }
  async function saveCombined(item,incoming,tags,valid,trashOld=false){
    const snapshot=await get(item.id);if(!snapshot?.writable||snapshot.deleted||!valid())throw new Error('review-commit-ineligible');
    const plan=N.assemble(snapshot,pack,engine.state.tasks,incoming,await formattedBodies(snapshot));
    if(plan.target?.html===plan.html&&!plan.archive.length&&plan.target.tags.includes('AI-Summary'))return {key:plan.target.key,archived:0};
    // Durable, private backup precedes any mutation; edits to other levels remain intact.
    const backupDir=PathUtils.join(dir,'note-backups');await IOUtils.makeDirectory(backupDir,{ignoreExisting:true,permissions:0o700});
    await atomic(PathUtils.join(backupDir,Date.now()+'-'+uuid()+'.json'),{parent:snapshot.key,scope:snapshot.scope,notes:snapshot.notes});
    let noteKey;
    await Zotero.DB.executeTransaction(async()=>{
      const current=await get(item.id),parent=await Zotero.Items.getAsync(item.id);
      if(!valid()||!current?.writable||current.deleted)throw new Error('review-commit-ineligible');
      if(noteSignature(current)!==noteSignature(snapshot))throw new Error('review-note-changed');
      const active=engine.state.tasks.find(t=>t.itemID===item.id&&t.status==='ready_to_commit');
      if(incoming&&active?.mode==='automatic'&&C.target(C.rating(parent.getField('extra'),parent.getTags().map(t=>t.tag),engine.state.tagAdapter))<C.stages.indexOf(active.stage)+1)throw new Error('review-rating-changed');
      const note=plan.target?await Zotero.Items.getAsync(plan.target.id):new Zotero.Item('note');
      if(!plan.target){note.libraryID=parent.libraryID;note.parentID=parent.id;}
      note.setNote(plan.html);if(!note.getTags().some(t=>t.tag==='LF:Note'))note.addTag('LF:Note');if(!note.getTags().some(t=>t.tag==='LF:Combined'))note.addTag('LF:Combined');
      // Native AI Butler summary discovery uses this tag; no duplicate preview Note.
      if(!note.getTags().some(t=>t.tag==='AI-Summary'))note.addTag('AI-Summary');
      await note.save();noteKey=note.key;
      for(const id of plan.archive){const old=await Zotero.Items.getAsync(id);old.addTag('LF:Archive');if(trashOld)old.deleted=true;await old.save();}
      for(const tag of tags)if(!parent.hasTag(tag))parent.addTag(tag);
      if(tags.length)await parent.save();
    });
    for(const t of engine.state.tasks)if(t.status==='completed'&&plan.records.some(r=>r.task===t.id))t.noteKey=noteKey;
    return {key:noteKey,archived:plan.archive.length};
  }
  async function commit(item,html,tags,valid){return (await saveCombined(item,html,tags,valid)).key;}
  const responsePath=(id,g)=>PathUtils.join(dir,'responses',id+'-'+g+'.json');
  async function startup() {
    config={...defaults,...JSON.parse(Zotero.Prefs.get(PREF,true)||'{}')};
    // Profile directory is local and separate from Zotero's synced data directory.
    dir=PathUtils.join(Services.dirsvc.get('ProfD',Components.interfaces.nsIFile).path,'literature-flow-v1');
    await IOUtils.makeDirectory(PathUtils.join(dir,'responses'),{ignoreExisting:true,permissions:0o700});
    const contractFile=await Zotero.HTTP.request('GET',rootURI+'content/contracts/legacy.json');
    pack=JSON.parse(contractFile.responseText);
    const state=await read(PathUtils.join(dir,'state.json'));
    engine=new C.Engine({now:()=>Date.now(),uuid,get,input,request,commit,
      save:s=>{const snapshot=JSON.parse(JSON.stringify(s));const p=writeChain.then(()=>atomic(PathUtils.join(dir,'state.json'),snapshot));writeChain=p.catch(()=>{});return p;},
      readResponse:read,writeResponse:async(id,g,value)=>{const p=responsePath(id,g);await atomic(p,value);return p;},
      findResponse:async(id,g)=>await IOUtils.exists(responsePath(id,g))?responsePath(id,g):null
    },pack,state);
    engine.state.device ||= uuid();await engine.recover();
    if(engine.state.role!=='disabled')registerObserver();
    registerMenus();
    if(engine.canRun() && engine.state.auto)for(const i of await allItems())await engine.observe(i);
    schedule();
  }
  function registerObserver(){
    if(observer)return;
    observer=Zotero.Notifier.registerObserver({notify(event,type,ids){
      if(stopped || !engine.canRun())return;
      // Notifications only schedule work; never await model requests or writes here.
      for(const id of ids){clearTimeout(debounce.get(id));debounce.set(id,setTimeout(async()=>{
        debounce.delete(id);
        try{
          const raw=await Zotero.Items.getAsync(id),items=await normalized(raw?[raw]:[]);
          for(const item of items)await engine.observe(item);
          for(const t of engine.state.tasks)if(t.status==='waiting' && /^waiting-/.test(t.reason||''))t.nextAt=0;
        }catch{Zotero.debug('[Literature Flow] notifier reconciliation failed');}
      },config.debounceMs));}
    }},['item'],'literature-flow-v1');
  }
  function schedule(){if(stopped)return;timer=setTimeout(async()=>{try{await engine.step();}catch{Zotero.debug('[Literature Flow] worker error');}schedule();},config.intervalMs);}
  async function shutdown(){
    automationEpoch++;stopped=true;clearTimeout(timer);for(const t of debounce.values())clearTimeout(t);debounce.clear();
    if(observer)Zotero.Notifier.unregisterObserver(observer);observer=null;
    for(const id of menuIDs)Zotero.MenuManager.unregisterMenu(id);
    for(const c of controllers)c.abort();
    for(const p of panels)try{p.close();}catch{}
    if(engine){engine.alive=false;await engine.controls({});}await writeChain;
  }
  function registerMenus(){
    if(!Zotero.MenuManager)throw new Error('Zotero MenuManager unavailable');
    for(const target of ['main/library/item','main/library/collection','main/menubar/tools']){
      const menuID='literature-flow-v1-'+target.replace(/\//g,'-');
      menuIDs.push(Zotero.MenuManager.registerMenu({menuID,pluginID:'literatureflow@zotero.local',target,menus:[{
        menuType:'menuitem',onShowing:(e,c)=>{c.menuElem.setAttribute('label','Literature Flow · 工作流与队列…');},
        onCommand:(e,c)=>open(target,c)
      }]}));
    }
  }
  function open(target,context){
    const main=Zotero.getMainWindow();
    const raw=context?.items || main.ZoteroPane.getSelectedItems();
    // Zotero 9 provides one selected collection; Zotero 10 multi-select can pass collections.
    const collections=context?.collections || (context?.collection ? [context.collection] : [main.ZoteroPane.getSelectedCollection()].filter(Boolean));
    const args={api,selection:raw.map(i=>typeof i==='number'?i:i.id),collections:target==='main/library/collection'?collections.map(c=>typeof c==='number'?c:c.id):[]};
    const win=main.openDialog('chrome://zotero-literature-flow/content/panel.xhtml','','chrome,dialog=no,modal=no,centerscreen,resizable,width=1000,height=800',args);panels.add(win);
  }
  async function selected(args,recursive){
    const raw=[...args.selection];
    if(args.collections.length){raw.length=0;const ids=new Set(args.collections);
      if(recursive)for(const id of args.collections)for(const c of Zotero.Collections.getByParent(id,true))ids.add(c.id);
      for(const id of ids){const c=Zotero.Collections.get(id);if(c)raw.push(...c.getChildItems());}
    }
    return normalized(raw);
  }
  async function picker(win,save){
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const fp=new FilePicker();fp.init(win,save?'导出共享配置':'导入共享配置',save?fp.modeSave:fp.modeOpen);fp.appendFilter('JSON','*.json');fp.defaultString='literature-flow-config.json';
    return await fp.show()===fp.returnCancel?null:fp.file;
  }
  const api={
    async queue(){
      const tasks=[];
      for(const t of engine.state.tasks){const p=await Zotero.Items.getAsync(t.itemID);
        tasks.push({...Object.fromEntries(['id','parent','stage','status','reason','mode','revision','attempts'].map(k=>[k,t[k]])),canRevalidate:t.status==='failed'&&t.reason==='output-tags-json'&&!!t.response,title:p?.getField('title')||t.parent});
      }
      return {role:engine.state.role,paused:engine.state.paused,auto:engine.state.auto,baseline:!!engine.state.enabledAt,baselineCount:Object.keys(engine.state.baseline).length,connectionReady:!!config.baseURL.trim()&&!!config.model.trim(),contract:pack.id,tasks};
    },
    async consolidate(args,recursive,trashOld=false){
      if(engine.state.role!=='executor')throw new Error('请在执行设备上整合笔记');
      const items=await selected(args,recursive),result=[];
      return engine.serial(async()=>{
        for(const item of items){if(!item.writable||item.deleted)continue;
          result.push({parent:item.key,...await saveCombined(item,null,[],()=>engine.state.role==='executor'&&!stopped,trashOld)});
        }
        await engine.save();return result;
      });
    },
    async markdown(args,recursive){
      const items=await selected(args,recursive),notes=[];
      for(const item of items){const matches=item.notes.filter(n=>n.tags.includes('LF:Combined')&&!n.tags.includes('LF:Archive'));if(matches.length>1)throw new Error('请先核对重复的综合笔记');if(matches.length)notes.push(await Zotero.Items.getAsync(matches[0].id));}
      if(!notes.length)throw new Error('当前选择没有综合笔记，请先整合已有结果');
      const translation=new Zotero.Translate.Export();translation.setItems(notes);translation.setTranslator('1412e9e2-51e1-42ec-aa35-e036a895534b');await translation.translate();
      return translation.string.replace(/^LF\\?_RECORD\\?_V1\s+\{[^\n]*\}\s*$/gm,'').replace(/^#{1,6}\s+生成记录\s*$/gm,'').replace(/^### \[Literature Flow\] 综合阅读/gm,'# 综合阅读').replace(/^### \[(L[123])\]/gm,'## [$1]').replace(/^#{4,6} /gm,s=>s.slice(1)).trim()+'\n';
    },
    async exportMarkdown(win,args,recursive){
      const text=await api.markdown(args,recursive),{FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
      const fp=new FilePicker();fp.init(win,'导出综合笔记 Markdown',fp.modeSave);fp.appendFilter('Markdown','*.md');fp.defaultString='literature-flow-notes.md';
      if(await fp.show()!==fp.returnCancel)await IOUtils.writeUTF8(fp.file,text);
    },
    async taskAction(ids,action){return engine.taskAction(ids,action);},
    async view(args,recursive){
      const items=await selected(args,recursive);
      const report=[];
      for(const i of items){let source;try{const s=await input(i);source={mode:s.mode,characters:s.text.length,coverage:s.coverage};}catch(e){source=e.message;}
        report.push({id:i.id,key:i.key,title:i.title,writable:i.writable,rating:C.rating(i.extra,i.tags,engine.state.tagAdapter),levels:Object.fromEntries(Object.entries(C.inspect(i,pack,engine.state.tasks)).map(([s,v])=>[s,{state:v.state,note:v.note?.key,shared:v.shared}])),input:source});}
      return {config:{...config,bindings:undefined},role:engine.state.role,paused:engine.state.paused,auto:engine.state.auto,baseline:!!engine.state.enabledAt,contract:pack.id,items:report,tasks:engine.state.tasks.map(({id,parent,stage,status,reason,mode,revision,attempts})=>({id,parent,stage,status,reason,mode,revision,attempts}))};
    },
    async configure(values,token){
      automationEpoch++;
      if(!['executor','reader-standby','disabled'].includes(values.role))throw new Error('无效角色');
      if(values.baseURL)endpoint(values.baseURL);
      await engine.controls({paused:true});for(const c of controllers)c.abort();
      config.baseURL=values.baseURL.trim();config.model=values.model.trim();
      Zotero.Prefs.set(PREF,JSON.stringify(config),true);
      if(token)await setKey(token);
      await engine.controls({role:values.role});
      if(values.role==='disabled' && observer){Zotero.Notifier.unregisterObserver(observer);observer=null;}else if(values.role!=='disabled')registerObserver();
    },
    async resume(){automationEpoch++;if(engine.state.role!=='executor')throw new Error('只有 executor 可以执行');await engine.controls({paused:false});},
    async pause(){automationEpoch++;await engine.controls({paused:true});for(const c of controllers)c.abort();},
    async startAutomation({activateExecutor=false}={}){
      const epoch=++automationEpoch;
      if(!config.baseURL.trim()||!config.model.trim())throw new Error('请先填写并保存模型服务地址和模型名称');
      endpoint(config.baseURL);
      if(engine.state.role!=='executor'&&!activateExecutor)throw new Error('请先确认本机负责处理文献');
      await engine.controls({paused:true});for(const c of controllers)c.abort();
      if(!engine.state.enabledAt){
        if(Zotero.Sync?.Runner?.syncInProgress)throw new Error('请等待 Zotero 同步完成后再开启');
        const items=await allItems();
        if(epoch!==automationEpoch)throw new Error('开启已中止：设置或暂停状态已改变');
        if(Zotero.Sync?.Runner?.syncInProgress)throw new Error('请等待 Zotero 同步完成后再开启');
        await engine.baseline(items);
      }
      if(epoch!==automationEpoch)throw new Error('开启已中止：设置或暂停状态已改变');
      registerObserver();
      await engine.controls({role:'executor',auto:true,paused:false});
    },
    async enableAuto(){return api.startAutomation();},
    async disableAuto(){automationEpoch++;await engine.controls({auto:false});for(const t of engine.state.tasks)if(t.mode==='automatic' && t.status!=='completed'){t.status='cancelled';t.generation++;t.reason='automation-disabled';}await engine.save();},
    async action(args,recursive,action,level){
      const items=await selected(args,recursive);
      if(!engine.canRun())throw new Error('当前为待机或暂停，请先在设置中启用执行端并恢复队列');
      if(action==='cancel')return engine.cancel(items);
      if(action==='repair' || action==='protect')return engine.serial(async()=>{
        for(const i of items){if(!i.writable || i.deleted)continue;const states=C.inspect(i,pack,engine.state.tasks);
          for(const [stage,v] of Object.entries(states)){
            if(v.state!=='complete')continue;
            if(action==='protect' && v.shared){
              await atomic(PathUtils.join(dir,'legacy-'+i.key+'-'+v.note.key+'.json'),{note:v.note,hash:hash(v.note.html)});
              const record={stage,revision:0,task:uuid(),parent:i.key,scope:i.scope,prompt:'legacy-protected',source:'LEGACY_TEXT',created:new Date().toISOString(),previous:[v.note.key]};
              await commit(i,C.render(C.visible(v.note.html),record,i.title),['AI:'+stage],()=>engine.canRun());
            }else if(action==='repair')await Zotero.DB.executeTransaction(async()=>{const p=await Zotero.Items.getAsync(i.id);if(!engine.canRun()||p.deleted||!allowed(p))return;p.addTag('AI:'+stage);await p.save();});
          }
        }
      });
      for(const i of items){
        if(action==='retry'){
          const tasks=engine.state.tasks.filter(t=>t.itemID===i.id && t.status==='failed');
          for(const t of tasks)await engine.serial(async()=>{t.status='queued';t.generation++;t.attempts=0;t.nextAt=0;delete t.response;delete t.cachedOnly;await engine.save();});
        }else await engine.plan(i,level||C.target(C.rating(i.extra,i.tags,engine.state.tagAdapter)),'manual',action==='regenerate');
      }
    },
    async bind(args,pdfKey,markdownKey){
      const items=await selected(args,false);if(items.length!==1)throw new Error('绑定来源时请选择一篇父文献');
      const i=items[0],p=await Zotero.Items.getAsync(i.id),atts=await Zotero.Items.getAsync(p.getAttachments());
      const pdf=atts.find(a=>a.key===pdfKey && a.attachmentContentType==='application/pdf'),md=atts.find(a=>a.key===markdownKey);
      if(!pdf || markdownKey && !md)throw new Error('附件 key 不属于当前文献');
      const pp=await pdf.getFilePathAsync();if(!pp || !await IOUtils.exists(pp))throw new Error('PDF 未下载');
      const st=await IOUtils.stat(pp),mp=md?await md.getFilePathAsync():null;
      if(md && (!mp || !await IOUtils.exists(mp)))throw new Error('Markdown 未下载');
      config.bindings[i.scope+'/'+i.key]={pdf:pdf.key,markdown:md?.key,pdfSize:st.size,pdfModified:st.lastModified,markdownHash:mp?hash(await IOUtils.readUTF8(mp)):null};
      Zotero.Prefs.set(PREF,JSON.stringify(config),true);
    },
    async attachments(args){const items=await selected(args,false);if(items.length!==1)return [];const p=await Zotero.Items.getAsync(items[0].id);return (await Zotero.Items.getAsync(p.getAttachments())).map(a=>({key:a.key,title:a.getField('title'),type:a.attachmentContentType}));},
    async probe(){const r=await http('/models',null,15000);return {models:(r.data||[]).map(m=>m.id),note:'仅检查模型列表，不代表已完成文本推理或视觉验证'};},
    async exportConfig(win){const path=await picker(win,true);if(path)await atomic(path,{schema:1,model:config.model,contract:pack.id});},
    async importConfig(win){const path=await picker(win,false);if(!path)return;const v=await read(path);if(v?.schema!==1 || typeof v.model!=='string')throw new Error('配置格式无效');automationEpoch++;await engine.controls({role:'reader-standby',paused:true,auto:false});config.model=v.model;config.baseURL='';config.bindings={};config.allowedGroups=[];await setKey('');Zotero.Prefs.set(PREF,JSON.stringify(config),true);},
    async exportReport(win,args,recursive){const path=await picker(win,true);if(path){const r=await api.view(args,recursive);delete r.config;await atomic(path,r);}}
  };
  return {startup,shutdown};
})();
