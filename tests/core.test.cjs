const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../addon/content/core.js');
const pack=require('../addon/content/contracts/legacy.json');
const clone=v=>JSON.parse(JSON.stringify(v));
function paper(overrides={}){return {id:1,key:'PAPER001',scope:'user:123',title:'Test paper',authors:'Researcher',dateAdded:1000,extra:'rate: 5',tags:[],notes:[],writable:true,deleted:false,...overrides};}
function output(stage){return {text:(stage==='L1'?'研究者基于原文观察到明确结果。\nDATA_AVAILABILITY: NotReported\nDATA_ACCESSION: Not reported':pack.stages[stage].sections.map(s=>'## '+s+'\nEvidence from the paper.').join('\n'))+'\nZOTERO_TAGS_JSON_START\n{"evidence":["Evidence:E2"],"unsafe":["AI:L3","Status:Core","rate: 5","Data:Public","Disease:Example"]}\nZOTERO_TAGS_JSON_END',finish:'stop'};}
function note(stage,key,previous=[]){const r={stage,revision:previous.length?1:0,task:'task-'+key,parent:'PAPER001',scope:'user:123',prompt:pack.id,source:'PDF_TEXT',created:'2026-10-22',previous};return {key,html:C.render('Body with scientific content',r,'Example'),tags:['LF:Note']};}
function fixture(item=paper()){
 let current=item,clock=10000,id=0,calls=0,commits=0,saved;
 const responses=new Map();
 const p={now:()=>clock,uuid:()=>String(++id),get:async()=>current,input:async()=>({text:'Full original paper',complete:true,hash:'hash-a',mode:'PDF_TEXT'}),request:async(i,s)=>{calls++;return output(s);},save:async s=>{saved=clone(s);},readResponse:async p=>responses.get(p),writeResponse:async(id,g,e)=>{const path=id+'-'+g;responses.set(path,clone(e));return path;},findResponse:async(id,g)=>responses.has(id+'-'+g)?id+'-'+g:null,commit:async(i,html,tags,valid)=>{assert(valid());commits++;const key='NOTE'+commits;current.notes.push({key,html,tags:['LF:Note']});current.tags.push(...tags);return key;}};
 const e=new C.Engine(p,pack);e.state.role='executor';e.state.paused=false;e.state.device='device';
 return {e,p,responses,get item(){return current;},set item(v){current=v;},get calls(){return calls;},get commits(){return commits;},get saved(){return saved;},advance:()=>clock+=60000};
}
async function drain(f,n=5){for(let i=0;i<n;i++){await f.e.step();f.advance();}}

test('A01 baseline and ordinary metadata/note edits never qualify historical five-star papers',async()=>{
 const f=fixture();await f.e.baseline([f.item]);f.e.state.auto=true;f.item.title='Edited';await f.e.observe(f.item);f.item.notes.push({key:'HUMAN',html:'Human note',tags:[]});await f.e.observe(f.item);assert.equal(f.e.state.tasks.length,0);
 const old=paper({id:2,key:'OLD00002',dateAdded:5000});await f.e.observe(old);assert.equal(f.e.state.tasks.length,0);
});
test('A02 repeated new-item events produce exactly one L1 task and note',async()=>{
 const f=fixture(paper({extra:'',dateAdded:20000}));await f.e.baseline([]);f.e.state.auto=true;await Promise.all([f.e.observe(f.item),f.e.observe(f.item),f.e.observe(f.item)]);await drain(f);assert.equal(f.e.state.tasks.length,1);assert.equal(f.calls,1);assert.equal(f.commits,1);
});
test('A03 two-star papers execute L1 then L2 only',async()=>{const f=fixture(paper({extra:'rate: 2'}));await f.e.plan(f.item,C.target(C.rating(f.item.extra)));await drain(f);assert.equal(f.calls,2);assert.deepEqual(f.e.state.tasks.map(t=>t.stage),['L1','L2']);});
test('A04 prior L1 plus five stars fills only L2 and L3',async()=>{const f=fixture(paper({notes:[note('L1','OLDL1')]}));await f.e.plan(f.item,3);await drain(f);assert.equal(f.calls,2);assert.deepEqual(f.e.state.tasks.map(t=>t.stage),['L2','L3']);});
test('A05 duplicate and conflicting ratings are explicit, zero is valid',()=>{assert.equal(C.rating('rate: 2\nrate: 5').status,'conflict');assert.equal(C.rating('rate: 6').status,'conflict');assert.equal(C.rating('rate: 0').value,0);assert.equal(C.rating('rate: 5',['rate: 2'],true).status,'conflict');assert.equal(C.rating('rate: 5',['rate: 2']).value,5);assert.equal(C.rating('rate: 3\nrate: 3').value,3);});
test('A06 a structurally complete legacy L2 is accepted without tags or requests',async()=>{
 const text='[L2] Evidence Card\n'+pack.stages.L2.sections.map(s=>s+'\nEvidence body.').join('\n');
 const f=fixture(paper({notes:[{key:'LEGACY',html:text,tags:[]}]}));assert.equal(C.inspect(f.item,pack).L2.state,'complete');await f.e.plan(f.item,2);assert.deepEqual(f.e.state.tasks.map(t=>t.stage),['L1']);assert.equal(f.calls,0);
});
test('A07 a completion tag without its Note remains under review',async()=>{const f=fixture(paper({tags:['AI:L2'],notes:[note('L1','N1')]}));await f.e.plan(f.item,2);await drain(f);assert.equal(C.inspect(f.item,pack).L2.state,'review');assert.equal(f.calls,0);});
test('A08 unknown legacy format blocks missing stages; edited LF content is preserved',()=>{
 const i=paper({notes:[{key:'UNKNOWN',html:'[L2] Evidence Card\nPartial',tags:['AI-Summary']}]});assert.equal(C.inspect(i,pack).L1.state,'review');
 const n=note('L1','N1');n.html=n.html.replace('Body with scientific content','User corrected the evidence');assert.equal(C.inspect(paper({notes:[n]}),pack).L1.note.html,n.html);
});
test('A09 crash after Zotero commit before state persistence recovers existing Note',async()=>{
 const f=fixture();await f.e.plan(f.item,1);const before=clone(f.e.state);await f.e.step();const recovered=new C.Engine(f.p,pack,before);await recovered.recover();await recovered.step();assert.equal(f.calls,1);assert.equal(f.commits,1);assert.equal(recovered.state.tasks[0].status,'completed');
});
test('A10 orphaned persisted response after crash is reused without a request',async()=>{
 const f=fixture();await f.e.plan(f.item,1);const t=f.e.state.tasks[0];t.status='running';await f.p.writeResponse(t.id,t.generation,{response:output('L1'),input:await f.p.input(),generation:t.generation,contract:pack.id,dependencies:[]});
 const recovered=new C.Engine(f.p,pack,clone(f.e.state));await recovered.recover();await recovered.step();assert.equal(f.calls,0);assert.equal(f.commits,1);
});
test('A11 an automatic in-flight L3 cannot commit after rating drops',async()=>{
 const f=fixture(paper({notes:[note('L1','N1'),note('L2','N2')]}));await f.e.plan(f.item,3,'automatic');f.p.request=async()=>{f.item.extra='rate: 3';return output('L3');};await f.e.step();assert.equal(f.commits,0);
});
test('A12 missing full text waits without spending attempts and resumes the same task',async()=>{
 const f=fixture();await f.e.plan(f.item,1);const input=f.p.input;f.p.input=async()=>{throw new Error('waiting-local-pdf');};await f.e.step();assert.equal(f.e.state.tasks[0].attempts,0);assert.equal(f.calls,0);f.p.input=input;f.advance();await f.e.step();assert.equal(f.e.state.tasks.length,1);assert.equal(f.commits,1);
});
test('A13 empty, truncated and structurally incomplete results never complete',async()=>{
 for(const response of [{text:'',finish:'stop'},{...output('L1'),finish:'length'},{text:'# incomplete',finish:'stop'}]){const f=fixture();f.p.request=async()=>response;await f.e.plan(f.item,1);await f.e.step();assert.equal(f.commits,0);assert.equal(f.e.state.tasks[0].status,'failed');assert(f.responses.size>0);}
});
test('A14 standby cannot plan, request, or commit',async()=>{const f=fixture();await f.e.controls({role:'reader-standby'});f.e.state.auto=true;await f.e.plan(f.item,3);await f.e.observe(f.item);await f.e.step();assert.equal(f.calls,0);assert.equal(f.commits,0);assert.equal(f.e.state.tasks.length,0);});
test('A15 prompt updates do not rerun completed levels; failed new revision keeps old valid Note',async()=>{
 const f=fixture(paper({notes:[note('L1','OLD')]}));f.e.pack={...pack,id:'updated'};await f.e.plan(f.item,1);assert.equal(f.e.state.tasks.length,0);await f.e.plan(f.item,1,'manual',true);f.p.request=async()=>({text:'bad',finish:'length'});await f.e.step();assert.equal(C.inspect(f.item,pack).L1.note.key,'OLD');assert.equal(f.item.notes.length,1);
});
test('A16 overlapping batch selections deduplicate using scope/key/stage/revision',async()=>{const f=fixture();await Promise.all([f.e.plan(f.item,2),f.e.plan(f.item,2),f.e.plan(f.item,1)]);assert.equal(f.e.state.tasks.length,2);});
test('A17 cancel during inference and later attachment events do not resurrect the task',async()=>{
 const f=fixture();await f.e.baseline([f.item]);f.e.state.auto=true;await f.e.plan(f.item,1);f.p.request=async()=>{await f.e.cancel([f.item]);return output('L1');};await f.e.step();await f.e.observe(f.item);assert.equal(f.commits,0);assert.equal(f.e.state.tasks[0].status,'cancelled');
});
test('A17 deleted parents or lost permissions prevent commit',async()=>{for(const field of ['deleted','writable']){const f=fixture();await f.e.plan(f.item,1);f.p.request=async()=>{f.item[field]=field==='deleted';return output('L1');};await f.e.step();assert.equal(f.commits,0);}});
test('A17 pause invalidates in-flight response but preserves recovery eligibility',async()=>{const f=fixture();await f.e.plan(f.item,1);f.p.request=async()=>{await f.e.controls({paused:true});return output('L1');};await f.e.step();assert.equal(f.commits,0);assert.equal(f.e.state.tasks[0].status,'waiting');assert.equal(f.e.state.tasks[0].reason,'paused');});
test('A18 LF renderer never emits Butler tags or h1/h2, and escapes model HTML',()=>{const n=note('L1','N1');const html=C.render('# AI Summary\n<h1>AI-Generated</h1>\n<script>alert(1)</script>',C.marker(n),'Title');assert(!/<h[12]\b|<script>/i.test(html));assert.deepEqual(n.tags,['LF:Note']);assert(html.includes('&lt;script&gt;'));});
test('A19 text-only source never renders an image',async()=>{const f=fixture();f.p.input=async()=>({text:'![Figure](images/1.png)',complete:true,hash:'img',mode:'MINERU_TEXT'});await f.e.plan(f.item,1);await f.e.step();assert(!f.item.notes[0].html.includes('<img'));assert.equal(C.marker(f.item.notes[0]).source,'MINERU_TEXT');});
test('A20 marker survives standard HTML escaping and reconstruction without local ledger',()=>{const n=note('L2','N2');const i=paper({notes:[n]});assert.equal(C.inspect(i,pack,[]).L2.state,'complete');assert.equal(C.marker(n).task,'task-N2');});
test('explicit revision graph resolves active note, branching is a conflict',()=>{const a=note('L1','A'),b=note('L1','B',['A']),c=note('L1','C',['A']);assert.equal(C.inspect(paper({notes:[a,b]}),pack).L1.note.key,'B');assert.equal(C.inspect(paper({notes:[a,b,c]}),pack).L1.state,'conflict');});
test('user-deleted completed Note requires explicit regeneration',async()=>{const f=fixture();await f.e.plan(f.item,1);await f.e.step();f.item.notes=[];f.item.tags=[];assert.equal(C.inspect(f.item,pack,f.e.state.tasks).L1.state,'deleted');await f.e.plan(f.item,1);assert.equal(f.e.state.tasks.length,1);await f.e.plan(f.item,1,'manual',true);assert.equal(f.e.state.tasks.length,2);});
test('manual L3 is independent of low rating',async()=>{const f=fixture(paper({extra:'rate: 0',notes:[note('L1','N1'),note('L2','N2')]}));await f.e.plan(f.item,3);await f.e.step();assert.equal(f.commits,1);});
test('source replacement before commit is held for review',async()=>{const f=fixture();await f.e.plan(f.item,1);let n=0;f.p.input=async()=>({text:'Full',hash:++n===1?'before':'after',complete:true,mode:'PDF_TEXT'});await f.e.step();assert.equal(f.commits,0);assert.equal(f.e.state.tasks[0].reason,'review-source-changed');});
test('only program-controlled level and allowlisted evidence/data tags are emitted',()=>{const result=C.validate(output('L1'),'L1',pack);assert.deepEqual(result.tags,['Evidence:E2','Data:NotReported']);});
test('HTTP 401 fails once; HTTP 503 retries with a bounded budget',async()=>{for(const status of [401,503]){const f=fixture();await f.e.plan(f.item,1);f.p.request=async()=>{throw new Error('http-'+status);};await drain(f,10);assert.equal(f.e.state.tasks[0].status,'failed');assert.equal(f.e.state.tasks[0].attempts,status===401?1:3);}});
test('single worker prevents concurrent inference',async()=>{const f=fixture();await f.e.plan(f.item,2);await Promise.all([f.e.step(),f.e.step(),f.e.step()]);assert.equal(f.calls,1);});
test('pause clears old response pointer so resumed generation is not trapped in review',async()=>{const f=fixture();await f.e.plan(f.item,1);const t=f.e.state.tasks[0];t.status='ready_to_commit';t.response='old';await f.e.controls({paused:true});assert.equal(t.response,undefined);await f.e.controls({paused:false});await f.e.step();assert.equal(f.commits,1);});
test('resume makes paused work visibly queued again',async()=>{
 const f=fixture();await f.e.plan(f.item,1);await f.e.controls({paused:true});const t=f.e.state.tasks[0];assert.equal(t.reason,'paused');
 await f.e.controls({paused:false});assert.equal(t.status,'queued');assert.equal(t.reason,'');assert.equal(t.nextAt,0);
});
test('startup recovery releases paused work when the saved executor is active',async()=>{
 const f=fixture();await f.e.plan(f.item,1);const t=f.e.state.tasks[0];t.status='waiting';t.reason='paused';
 await f.e.recover();assert.equal(t.status,'queued');assert.equal(t.reason,'');assert.equal(t.nextAt,0);
});
test('waiting tasks are checked fairly instead of starving later queue entries',async()=>{
 const f=fixture(),seen=[];f.p.get=async id=>paper({id,key:'PAPER00'+id});f.p.input=async item=>{seen.push(item.id);throw new Error('waiting-local-pdf');};
 for(let id=1;id<=8;id++)f.e.state.tasks.push({id:String(id),logical:'task/'+id,scope:'user:123',parent:'PAPER00'+id,itemID:id,stage:'L1',revision:0,mode:'automatic',previous:[],status:'waiting',reason:'waiting-local-pdf',generation:0,attempts:0,contract:pack.id,nextAt:0});
 for(let i=0;i<8;i++){await f.e.step();f.advance();}
 assert.deepEqual(seen,[1,2,3,4,5,6,7,8]);
});
test('late failure from a cancelled generation cannot fail an explicitly retried task',async()=>{const f=fixture();await f.e.plan(f.item,1);f.p.request=async()=>{await f.e.cancel([f.item]);await f.e.plan(f.item,1);throw new Error('http-401');};await f.e.step();assert.equal(f.e.state.tasks[0].status,'queued');});
test('combined legacy Note independently recognizes L1, L2 and L3 blocks',()=>{
 const html='SUMMARY: A supported finding.\nDATA_AVAILABILITY: NotReported\nDATA_ACCESSION: Not reported\n'+['L2','L3'].map(s=>'['+s+'] '+(s==='L2'?'Evidence Card':'Deep Reading')+'\n'+pack.stages[s].sections.map(h=>h+'\nReal evidence.').join('\n')).join('\n');
 const i=paper({notes:[{key:'COMBINED',html,tags:['AI-Summary']}]});
 assert.deepEqual(C.stages.map(s=>C.inspect(i,pack)[s].state),['complete','complete','complete']);
 const onlyL3={...i,notes:[{...i.notes[0],html:html.slice(html.indexOf('[L3]'))}]};assert.equal(C.inspect(onlyL3,pack).L1.state,'review');assert.equal(C.inspect(onlyL3,pack).L2.state,'missing');
});
test('partial mixed legacy summary and L3 stay under review even when L2 is complete',async()=>{
 const html='An old summary without a DATA_AVAILABILITY field.\n[L2] Evidence Card\n'+pack.stages.L2.sections.map(s=>s+'\nEvidence body.').join('\n')+'\n[L3] Deep Reading\nIncomplete older analysis.';
 const f=fixture(paper({notes:[{key:'MIXED',html,tags:['AI-Generated']}]}));
 assert.deepEqual(C.stages.map(s=>C.inspect(f.item,pack)[s].state),['review','complete','review']);
 await f.e.plan(f.item,3);assert.equal(f.e.state.tasks.length,0);assert.equal(f.calls,0);
});
test('historical Butler chat summaries are held, while unrelated human notes remain eligible',async()=>{
 const f=fixture(paper({notes:[{key:'CHAT',html:'Full-paper summary from a previous conversation.',tags:['AI-Butler-Chat']}]}));
 await f.e.baseline([f.item]);f.e.state.auto=true;f.item.extra='rate: 4';await f.e.observe(f.item);assert.equal(f.e.state.tasks.length,0);
 f.item.notes[0].tags=[];await f.e.plan(f.item,1);assert.equal(f.e.state.tasks.length,1);
});

test('task-table cancel targets exact IDs, works while paused, and preserves completed notes',async()=>{
 const f=fixture();await f.e.plan(f.item,3);await f.e.step();const [l1,l2,l3]=f.e.state.tasks;
 await f.e.controls({paused:true});const count=await f.e.taskAction([l1.id,l2.id],'cancel');
 assert.equal(count,1);assert.equal(l1.status,'completed');assert.equal(l2.status,'cancelled');assert.equal(l3.status,'waiting');assert.equal(f.item.notes.length,1);
});
test('task-table cancellation during inference invalidates the response without affecting another stage',async()=>{
 const f=fixture();await f.e.plan(f.item,2);const [l1,l2]=f.e.state.tasks;
 f.p.request=async()=>{await f.e.taskAction([l1.id],'cancel');return output('L1');};await f.e.step();
 assert.equal(l1.status,'cancelled');assert.equal(l2.status,'queued');assert.equal(f.commits,0);
});
test('task-table retry only revives selected failed tasks and requires an active executor',async()=>{
 const f=fixture();await f.e.plan(f.item,2);const [l1,l2]=f.e.state.tasks;l1.status='failed';l1.response='old-response';
 await f.e.controls({paused:true});await assert.rejects(()=>f.e.taskAction([l1.id],'retry'),/恢复执行队列/);await f.e.controls({paused:false});
 assert.equal(await f.e.taskAction([l1.id,l2.id],'retry'),1);assert.equal(l1.status,'queued');assert.equal(l1.response,undefined);assert.equal(l2.status,'queued');assert.equal(l2.reason,'');
});
test('read-only feed and deleted-item events never extend the personal baseline',async()=>{
 const f=fixture();await f.e.baseline([f.item]);f.e.state.auto=true;
 await f.e.observe(paper({key:'FEED0001',writable:false,dateAdded:20000}));await f.e.observe(paper({key:'DELETED1',deleted:true,dateAdded:20000}));
 assert.equal(Object.keys(f.e.state.baseline).length,1);assert.equal(f.e.state.tasks.length,0);
});
function withTags(raw,stage='L1'){const r=output(stage);r.text=r.text.replace(/ZOTERO_TAGS_JSON_START[\s\S]*?ZOTERO_TAGS_JSON_END/,'ZOTERO_TAGS_JSON_START\n'+raw+'\nZOTERO_TAGS_JSON_END');return r;}
test('tag JSON accepts typographic delimiters including the observed mixed ASCII closing keys',()=>{
 for(const raw of ['{“workflow": [“AI:L1”, “AI:L2”], “evidence": [“Evidence:E2”], “disease”: []}', '{“evidence”: [“Evidence:E2”]}'])assert.deepEqual(C.validate(withTags(raw),'L1',pack).tags,['Evidence:E2','Data:NotReported']);
});
test('tag JSON preserves valid string content and scientific prose with quotation marks',()=>{
 const raw='{"evidence":["Evidence:E2"],"label":["Text with “quoted words” and \\"escaped\\" quotes"]}';
 const r=withTags(raw);r.text='“Quoted scientific statement”\n'+r.text;assert(C.validate(r,'L1',pack).text.startsWith('“Quoted scientific statement”'));
 assert.deepEqual(C.validate(withTags('{“evidence”: [“Evidence:E2”], "label": ["Text “unchanged”"]}'),'L1',pack).tags,['Evidence:E2','Data:NotReported']);
});
test('tag JSON still rejects malformed syntax, ambiguous quotes, wrong schema and conflicting evidence',()=>{
 for(const raw of ['{“evidence”: [“Evidence:E2”],}',"{'evidence':['Evidence:E2']}",'{“evidence”: [“Evidence:E2]}','{“label”: [“a “nested” quote”]}','{“evidence”: [“Evidence:E2”]} trailing','{evidence: ["Evidence:E2"]}'])assert.throws(()=>C.validate(withTags(raw),'L1',pack),/output-tags-json/);
 assert.throws(()=>C.validate(withTags('{“evidence”: “Evidence:E2”}'),'L1',pack),/output-tags-schema/);
 assert.throws(()=>C.validate(withTags('{“evidence”: [“Evidence:E2”, “Evidence:E3”]}'),'L1',pack),/output-conflicting-evidence/);
});
async function cachedFailure(f){await f.e.plan(f.item,1);const t=f.e.state.tasks[0];t.status='failed';t.reason='output-tags-json';t.attempts=1;t.response=await f.p.writeResponse(t.id,t.generation,{response:withTags('{“evidence": [“Evidence:E2”]}'),input:await f.p.input(),generation:t.generation,contract:pack.id,dependencies:[]});return t;}
test('revalidate saved tags commits once without inference or generation changes',async()=>{
 const f=fixture(),t=await cachedFailure(f),generation=t.generation;
 assert.equal(await f.e.taskAction([t.id],'revalidate'),1);await f.e.step();assert.equal(f.calls,0);assert.equal(f.commits,1);assert.equal(t.attempts,1);assert.equal(t.generation,generation);assert.equal(t.status,'completed');
 assert.equal(await f.e.taskAction([t.id],'revalidate'),0);await f.e.step();assert.equal(f.commits,1);
});
test('revalidate never falls back to inference when saved response is absent or changes',async()=>{
 for(const change of ['absent','source','contract','generation']){const f=fixture(),t=await cachedFailure(f);await f.e.taskAction([t.id],'revalidate');
  if(change==='absent')f.responses.clear();if(change==='source')f.p.input=async()=>({text:'Changed',complete:true,hash:'changed'});
  if(change==='contract')f.responses.get(t.response).contract='different';if(change==='generation')f.responses.get(t.response).generation++;
  await f.e.step();assert.equal(f.calls,0);assert.equal(f.commits,0);assert.match(t.reason,/^review-/);
 }
});
test('revalidate only selects failed tags tasks with saved responses, and respects pause and cancellation',async()=>{
 const f=fixture(),t=await cachedFailure(f);assert.equal(await f.e.taskAction(['other'],'revalidate'),0);
 await f.e.controls({paused:true});await assert.rejects(()=>f.e.taskAction([t.id],'revalidate'),/恢复/);await f.e.controls({paused:false});
 await f.e.taskAction([t.id],'revalidate');await f.e.taskAction([t.id],'cancel');await f.e.step();assert.equal(f.commits,0);assert.equal(f.calls,0);
});
test('saved-response checks run before unrelated queued model work',async()=>{
 const f=fixture(),t=await cachedFailure(f);await f.e.taskAction([t.id],'revalidate');
 f.e.state.tasks.unshift({...t,id:'other',parent:'OTHER',cachedOnly:false,response:undefined});await f.e.step();assert.equal(t.status,'completed');assert.equal(f.calls,0);assert.equal(f.commits,1);
});
