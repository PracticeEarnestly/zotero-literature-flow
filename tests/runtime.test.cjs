const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pack=require('../addon/content/contracts/legacy.json');
const plain=v=>JSON.parse(JSON.stringify(v));
function runtime(){
 const files=new Map(),menus=[],timers=[],logins=[],items=new Map();let prefs='{}',args,saves=0,requests=0,commits=0,tx=false,timerID=0;
 const main={ZoteroPane:{getSelectedItems:()=>[parent],getSelectedCollection:()=>null},openDialog:(url,name,features,a)=>{args=a;return {close(){}};}};
 const parent={id:1,key:'PAPER001',libraryID:1,dateAdded:'2026-10-22 01:00:00',deleted:false,tags:[],notes:[],isRegularItem:()=>true,getNotes:()=>parent.notes,getAttachments:()=>[2],getCreators:()=>[{firstName:'A',lastName:'Author'}],getField:k=>({extra:'rate: 2',title:'Test paper'}[k]||''),getTags:()=>parent.tags.map(tag=>({tag})),hasTag:t=>parent.tags.includes(t),addTag:t=>{if(!parent.tags.includes(t))parent.tags.push(t);},save:async()=>{assert(tx);saves++;}};
 const attachment={id:2,key:'PDF00001',parentItemID:1,attachmentContentType:'application/pdf',deleted:false,getFilePathAsync:async()=>'/attachment/paper.pdf',getField:()=> 'Main PDF',isRegularItem:()=>false};items.set(1,parent);items.set(2,attachment);files.set('/attachment/paper.pdf','pdf');files.set('/cache/pdf','Full original paper');
 const lib={libraryID:1,libraryType:'user',editable:true};
 const Zotero={Prefs:{get:()=>prefs,set:(k,v)=>prefs=v},Libraries:{get:()=>lib,getAll:()=>[lib],userLibraryID:1},Users:{getCurrentUserID:()=>123},Items:{getAsync:async ids=>Array.isArray(ids)?ids.map(id=>items.get(id)).filter(Boolean):items.get(ids),getAll:async()=>[parent]},Fulltext:{getPages:async()=>new Proxy({indexedPages:10,total:10},{get:(o,k)=>{if(k==='toJSON')throw new Error("DB column 'toJSON' not found");return o[k];}}),getItemCacheFile:()=>({path:'/cache/pdf'})},HTTP:{request:async()=>({responseText:JSON.stringify(pack)})},MenuManager:{registerMenu:m=>{menus.push(m);return m.menuID;},unregisterMenu:()=>{}},Notifier:{registerObserver:o=>{runtime.lastObserver=o;return 'obs';},unregisterObserver:()=>{}},getMainWindow:()=>main,debug:()=>{},Collections:{get:id=>({getChildItems:()=>[parent]}),getByParent:()=>[{id:3}]},DB:{executeTransaction:async fn=>{assert(!tx);tx=true;try{await fn();}finally{tx=false;}}},Item:class{
  constructor(){this.tags=[];this.key='NOTE'+(++commits);this.id=100+commits;this.deleted=false;}
  setNote(html){this.html=html;}getNote(){return this.html;}addTag(t){this.tags.push({tag:t});}getTags(){return this.tags;}
  async save(){assert(tx);saves++;items.set(this.id,this);if(!parent.notes.includes(this.id))parent.notes.push(this.id);}
 }};
 const Services={uuid:{generateUUID:()=>'{'+crypto.randomUUID()+'}'},dirsvc:{get:()=>({path:'/profile'})},io:{newURI:u=>{const v=new URL(u);return {scheme:v.protocol.slice(0,-1),host:v.hostname,userPass:v.username};}},logins:{findLogins:()=>logins,addLoginAsync:async l=>logins.push(l),removeLogin:l=>logins.splice(logins.indexOf(l),1)}};
 const Components={interfaces:{nsIFile:1,nsICryptoHash:2,nsILoginInfo:3},classes:{'@mozilla.org/security/hash;1':{createInstance:()=>({SHA256:1,init(){this.h=crypto.createHash('sha256');},update:b=>{},finish:()=>''})},'@mozilla.org/login-manager/loginInfo;1':{createInstance:()=>({init(a,b,c,d,password){this.password=password;}})}}};
 // Real SHA-256 behavior rather than a constant source identity.
 Components.classes['@mozilla.org/security/hash;1'].createInstance=()=>({SHA256:1,init(){this.h=crypto.createHash('sha256');},update(b){this.h.update(b);},finish(){return this.h.digest('latin1');}});
 const IOUtils={exists:async p=>files.has(p),readUTF8:async p=>{if(!files.has(p))throw new Error('not found');return files.get(p);},writeUTF8:async(p,v)=>files.set(p,v),makeDirectory:async()=>{},stat:async()=>({size:3,lastModified:123})};
 const context=vm.createContext({Zotero,Services,Components,IOUtils,PathUtils:path.posix,TextEncoder,AbortController,rootURI:'resource://test/',setTimeout:(fn,ms)=>{const id=++timerID;timers.push({id,fn,ms});return id;},clearTimeout:id=>{const index=timers.findIndex(t=>t.id===id);if(index>=0)timers.splice(index,1);},ChromeUtils:{importESModule:()=>({FilePicker:class{modeOpen=0;modeSave=1;returnCancel=1;file='/export.json';init(){}appendFilter(){}async show(){return 0;}}})},fetch:async(url,options)=>{assert(!tx);requests++;return {ok:true,json:async()=>url.endsWith('/models')?{data:[{id:'test'}]}:{choices:[{finish_reason:'stop',message:{content:'A supported finding.\nDATA_AVAILABILITY: NotReported\nDATA_ACCESSION: Not reported\nZOTERO_TAGS_JSON_START\n{"evidence":["Evidence:E2"]}\nZOTERO_TAGS_JSON_END'}}]}};}});
 for(const f of ['lib/markdown-it.min.js','core.js','notes.js','workflow.js'])vm.runInContext(fs.readFileSync('addon/content/'+f,'utf8'),context,{filename:f});
 return {context,Zotero,files,menus,timers,parent,lib,get requests(){return requests;},get saves(){return saves;},get commits(){return commits;},get args(){return args;},async start(){await context.LiteratureFlow.startup();menus[0].menus[0].onCommand(null,{items:[parent]});},async configure(){await args.api.configure({role:'executor',baseURL:'http://localhost:9527/v1',model:'test'},'local-test-key');await args.api.resume();},async tick(){await timers.shift().fn();}};
}
test('host adapter startup is standby, menus register once, selection is read-only',async()=>{const r=runtime();await r.start();assert.equal(r.menus.length,3);const v=await r.args.api.view(r.args,false);assert.equal(v.role,'reader-standby');assert.equal(r.requests,0);assert.equal(r.saves,0);assert.equal(v.items[0].input.mode,'PDF_TEXT');await r.context.LiteratureFlow.shutdown();});
test('host adapter writes via one short Zotero transaction after persisting response',async()=>{const r=runtime();await r.start();await r.configure();await r.args.api.action(r.args,false,'fill',1);await r.tick();assert.equal(r.requests,1);assert.equal(r.commits,1);assert(r.files.has('/profile/literature-flow-v1/state.json'));assert([...r.files.keys()].some(k=>k.includes('/responses/')));assert(r.parent.tags.includes('AI:L1'));assert(!r.parent.tags.includes('AI:L3'));await r.context.LiteratureFlow.shutdown();});
test('host adapter repair without inference and normalized attachment selection',async()=>{const r=runtime();await r.start();await r.configure();await r.args.api.action(r.args,false,'fill',1);await r.tick();r.parent.tags=[];await r.args.api.action({...r.args,selection:[1,2]},false,'repair',0);assert.equal(r.requests,1);assert.deepEqual(r.parent.tags,['AI:L1']);const view=await r.args.api.view({...r.args,selection:[1,2]},false);assert.equal(view.items.length,1);});
test('host adapter nested/overlapping collection scope deduplicates parents',async()=>{const r=runtime();await r.start();const view=await r.args.api.view({...r.args,collections:[2,3]},true);assert.equal(view.items.length,1);});
test('host adapter shared export excludes role, endpoints, credentials, bindings and queue',async()=>{const r=runtime();await r.start();await r.configure();await r.args.api.exportConfig({});const out=JSON.parse(r.files.get('/export.json'));assert.deepEqual(Object.keys(out).sort(),['contract','model','schema']);assert(!r.files.get('/export.json').includes('local-test-key'));});
test('host adapter import resets to standby and clears connection settings',async()=>{const r=runtime();await r.start();await r.configure();r.files.set('/export.json',JSON.stringify({schema:1,model:'imported',role:'executor',baseURL:'http://evil.test'}));await r.args.api.importConfig({});const v=await r.args.api.view(r.args,false);assert.equal(v.role,'reader-standby');assert.equal(v.paused,true);assert.equal(v.config.baseURL,'');assert.equal(v.config.model,'imported');});
test('host adapter unknown/partial PDF indexing waits without an inference request',async()=>{const r=runtime();r.Zotero.Fulltext.getPages=async()=>({indexedPages:5,total:10});await r.start();await r.configure();await r.args.api.action(r.args,false,'fill',1);await r.tick();assert.equal(r.requests,0);const v=await r.args.api.view(r.args,false);assert.equal(v.tasks[0].status,'waiting');assert.equal(v.tasks[0].reason,'waiting-fulltext-coverage');});
test('host adapter corrupt state fails closed and preserves original bytes',async()=>{const r=runtime();const p='/profile/literature-flow-v1/state.json';r.files.set(p,'corrupt');await assert.rejects(()=>r.start(),/corrupt-local-state/);assert.equal(r.files.get(p),'corrupt');assert.equal(r.saves,0);});

test('host task table resolves titles and cancels a single stage without inference',async()=>{
 const r=runtime();await r.start();await r.configure();await r.args.api.action(r.args,false,'fill',2);
 const q=await r.args.api.queue();assert.equal(q.tasks[0].title,'Test paper');assert.equal(q.tasks.length,2);assert.equal(r.requests,0);
 assert.equal(await r.args.api.taskAction([q.tasks[1].id],'cancel'),1);const after=await r.args.api.queue();assert.equal(after.tasks[0].status,'queued');assert.equal(after.tasks[1].status,'cancelled');assert.equal(r.requests,0);assert.equal(r.saves,0);
});
test('one-click automation records initial history without model calls, then preserves it on resume and re-enable',async()=>{
 const r=runtime();await r.start();await r.args.api.configure({role:'executor',baseURL:'http://localhost:9527/v1',model:'test'},'');
 await r.args.api.startAutomation();const statePath='/profile/literature-flow-v1/state.json',before=JSON.parse(r.files.get(statePath));
 assert.equal(before.auto,true);assert.equal(before.paused,false);assert.equal(Object.keys(before.baseline).length,1);assert.equal(before.tasks.length,0);
 r.parent.getField=k=>({extra:'rate: 5',title:'Test paper'}[k]||'');
 await r.args.api.pause();await r.args.api.startAutomation();await r.args.api.disableAuto();await r.args.api.enableAuto();
 const after=JSON.parse(r.files.get(statePath));assert.equal(after.enabledAt,before.enabledAt);assert.deepEqual(after.baseline,before.baseline);assert.equal(after.tasks.length,0);assert.equal(r.requests,0);assert.equal(r.saves,0);
 const q=await r.args.api.queue();assert.equal(q.baselineCount,1);assert.equal(q.connectionReady,true);
});
test('first automation start during sync stays paused and leaves history uninitialized',async()=>{
 const r=runtime();await r.start();await r.configure();r.Zotero.Sync={Runner:{syncInProgress:true}};
 await assert.rejects(()=>r.args.api.startAutomation(),/同步/);const q=await r.args.api.queue();assert.equal(q.paused,true);assert.equal(q.auto,false);assert.equal(q.baseline,false);assert.equal(r.requests,0);
});
test('automation requires a saved connection and explicit promotion of a reading device',async()=>{
 const r=runtime();await r.start();await assert.rejects(()=>r.args.api.startAutomation({activateExecutor:true}),/地址/);
 await r.args.api.configure({role:'reader-standby',baseURL:'http://localhost:9527/v1',model:'test'},'');
 await assert.rejects(()=>r.args.api.startAutomation(),/确认本机/);assert.equal((await r.args.api.queue()).role,'reader-standby');
 await r.args.api.startAutomation({activateExecutor:true});const q=await r.args.api.queue();assert.equal(q.role,'executor');assert.equal(q.auto,true);assert.equal(q.paused,false);assert.equal(r.requests,0);
});
test('pause while initial history is being read supersedes a pending automation start',async()=>{
 const r=runtime();await r.start();await r.configure();let release,entered;const waiting=new Promise(resolve=>entered=resolve);
 r.Zotero.Items.getAll=()=>{entered();return new Promise(resolve=>release=()=>resolve([r.parent]));};
 const pending=r.args.api.startAutomation();await waiting;await r.args.api.pause();release();await assert.rejects(()=>pending,/已中止/);
 const q=await r.args.api.queue();assert.equal(q.paused,true);assert.equal(q.auto,false);assert.equal(q.baseline,false);assert.equal(r.requests,0);
});
for(const change of ['import','shutdown'])test(`${change} supersedes automation activation while history is being read`,async()=>{
 const r=runtime();await r.start();await r.configure();let release,entered;const waiting=new Promise(resolve=>entered=resolve);
 r.Zotero.Items.getAll=()=>{entered();return new Promise(resolve=>release=()=>resolve([r.parent]));};const pending=r.args.api.startAutomation();await waiting;
 if(change==='import'){r.files.set('/export.json',JSON.stringify({schema:1,model:'imported'}));await r.args.api.importConfig({});}else await r.context.LiteratureFlow.shutdown();
 release();await assert.rejects(()=>pending,/已中止/);const q=await r.args.api.queue();assert.equal(q.paused,true);assert.equal(q.auto,false);assert.equal(q.baseline,false);assert.equal(r.requests,0);
});
test('host adapter writes L1-L3 into one combined note and replays do not create notes or requests',async()=>{
 const r=runtime();await r.start();await r.configure();let calls=0;
 r.context.fetch=async()=>{const stage=['L1','L2','L3'][calls++],body=stage==='L1'?'**Finding**\nDATA_AVAILABILITY: NotReported\nDATA_ACCESSION: Not reported':pack.stages[stage].sections.map(s=>'## '+s+'\n**Evidence** from the paper.').join('\n');return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:body+'\nZOTERO_TAGS_JSON_START\n{"evidence":["Evidence:E2"]}\nZOTERO_TAGS_JSON_END'}}]})};};
 await r.args.api.action(r.args,false,'fill',3);await r.tick();await r.tick();await r.tick();
 assert.equal(calls,3);assert.equal(r.commits,1);assert.equal(r.parent.notes.length,1);const n=await r.Zotero.Items.getAsync(r.parent.notes[0]);assert(n.getTags().some(t=>t.tag==='LF:Combined'));assert(n.getNote().includes('<strong>'));
 const v=await r.args.api.view(r.args,false);for(const stage of ['L1','L2','L3'])assert.equal(v.items[0].levels[stage].state,'complete');
 const s=JSON.parse(r.files.get('/profile/literature-flow-v1/state.json'));assert.equal(new Set(s.tasks.map(t=>t.noteKey)).size,1);
 await r.args.api.action(r.args,false,'fill',3);await r.tick();assert.equal(calls,3);assert.equal(r.commits,1);
});
test('host consolidation preserves originals, creates a durable backup and is idempotent while paused',async()=>{
 const r=runtime();await r.start();await r.configure();await r.args.api.pause();const C=require('../addon/content/core');
 const old=new r.Zotero.Item('note');old.setNote(C.render('Existing **content**',{stage:'L1',revision:0,task:'old',parent:r.parent.key,scope:'user:123',source:'PDF_TEXT',prompt:pack.id,previous:[]},'Test paper'));old.addTag('LF:Note');await r.Zotero.DB.executeTransaction(()=>old.save());const html=old.getNote();
 const result=await r.args.api.consolidate(r.args,false);assert.equal(result.length,1);assert.equal(result[0].archived,1);assert.equal(old.getNote(),html);assert(old.getTags().some(t=>t.tag==='LF:Archive'));assert([...r.files.keys()].some(p=>p.includes('/note-backups/')));assert.equal(r.requests,0);
 const v=await r.args.api.view(r.args,false);assert.equal(v.items[0].levels.L1.state,'complete');assert.equal(v.paused,true);
 const saves=r.saves;await r.args.api.consolidate(r.args,false);assert.equal(r.saves,saves);assert.equal(r.commits,2);
});
test('host consolidation refuses a concurrently edited original instead of overwriting it',async()=>{
 const r=runtime();await r.start();await r.configure();const C=require('../addon/content/core'),old=new r.Zotero.Item('note');old.setNote(C.render('Existing',{stage:'L1',revision:0,task:'old',parent:r.parent.key,scope:'user:123',source:'PDF_TEXT',prompt:pack.id,previous:[]},'Test paper'));old.addTag('LF:Note');await r.Zotero.DB.executeTransaction(()=>old.save());
 const tx=r.Zotero.DB.executeTransaction;r.Zotero.DB.executeTransaction=async fn=>{old.html+='User concurrent edit';return tx(fn);};
 await assert.rejects(()=>r.args.api.consolidate(r.args,false),/review-note-changed/);assert.equal(r.commits,1);assert(old.html.endsWith('User concurrent edit'));assert(!old.getTags().some(t=>t.tag==='LF:Archive'));assert.equal(r.requests,0);
});
