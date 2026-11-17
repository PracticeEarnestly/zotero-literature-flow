const test=require('node:test'),assert=require('node:assert/strict'),C=require('../addon/content/core'),N=require('../addon/content/notes'),pack=require('../addon/content/contracts/legacy.json');
const record=(stage,task=stage,revision=0)=>({stage,task,revision,parent:'PAPER',scope:'user:123',source:'PDF_TEXT',prompt:pack.id,previous:[]});
const note=(stage,id)=>({id,key:'OLD'+id,tags:['LF:Note'],html:C.render('## Findings\n\n**Result**\n\n- First\n- Second',record(stage),'Paper')});
const item=notes=>({id:1,key:'PAPER',scope:'user:123',title:'Paper',tags:[],notes,writable:true});
function asNote(plan){return {id:99,key:'COMBINED',tags:['LF:Note','LF:Combined'],html:plan.html,records:plan.records};}
test('Markdown renders headings, emphasis, nested lists, tables, quotes and code safely',()=>{
 const html=C.markdownHTML('# Main\n## Sub\n\n**Bold** and *italic*\n\n- one\n  - nested\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```js\nalert("text")\n```\n\n<script>alert(1)</script>\n\n![figure](https://example.org/image.png)\n\n[x](javascript:alert(1))');
 for(const tag of ['h4','h5','strong','em','ul','li','table','th','td','blockquote','pre','code'])assert(html.includes('<'+tag));
 assert(!/<(?:script|img|h1|h2|h3)\b/.test(html));assert(!/href="javascript:/.test(html));assert(html.includes('&lt;script&gt;'));assert(html.includes('[图像：figure]'));
});
test('merge separate stages into one Note; archived backups do not cause conflicts',()=>{
 const originals=[note('L1',1),note('L2',2),note('L3',3)],p=N.assemble(item(originals),pack,[]),combined=asNote(p);
 assert.deepEqual(p.archive,[1,2,3]);assert.deepEqual(C.records(combined).map(r=>r.stage),['L1','L2','L3']);assert(!C.visible(p.html).includes('生成记录'));assert(!p.html.includes('data-lf-record='));
 const state=C.inspect(item([...originals.map(n=>({...n,tags:[...n.tags,'LF:Archive']})),combined]),pack,[]);for(const s of C.stages)assert.equal(state[s].state,'complete');
 assert.deepEqual(Object.keys(N.split(combined).blocks),['L1','L2','L3']);assert(p.html.indexOf('[L1]')<p.html.indexOf('[L2]'));assert(p.html.indexOf('[L2]')<p.html.indexOf('[L3]'));
});
test('next stage updates the same bundle and preserves user edits in other sections, introduction and tail',()=>{
 const first=asNote(N.assemble(item([]),pack,[],C.render('L1 result',record('L1'),'Paper')));
 first.html=first.html.replace('[L1] 一句话概览','[L1] 一句话概览').replace('<p>L1 result</p>','<p><strong>User annotation</strong> L1 result</p>').replace('<h3>[L1]','<p>User introduction</p><h3>[L1]').replace(/<\/div>$/,'<p>User tail</p></div>');
 const next=N.assemble(item([first]),pack,[],C.render('# [L2] Model title\n## Finding\nL2 result',record('L2'),'Paper'));
 assert.equal(next.target.key,'COMBINED');for(const t of ['User annotation','User introduction','User tail','L1 result','L2 result'])assert(next.html.includes(t));assert.equal(C.records(asNote(next)).length,2);assert.equal(Object.keys(N.split(asNote(next)).blocks).length,2);
 assert.equal(N.assemble(item([asNote(next)]),pack,[]).html,next.html);
});
test('regenerating one level keeps other levels and supersession, while dependency identity changes',()=>{
 const old=note('L1',1),p=N.assemble(item([old,note('L2',2)]),pack,[]),combined=asNote(p),before=C.inspect(item([combined]),pack,[]);
 const next=N.assemble(item([old,combined]),pack,[],C.render('New L1',record('L1','new-task',1),'Paper')),after=C.inspect(item([old,asNote(next)]),pack,[]);
 assert.equal(after.L1.state,'complete');assert.equal(after.L2.state,'complete');assert.equal(after.L2.note.record.task,'L2');assert(!C.dependencyMatches(after.L1,C.stageIdentity(before.L1)));assert(C.dependencyMatches(after.L2,C.stageIdentity(before.L2)));
});
test('valid legacy L1 is copied into the combined note without altering the original',()=>{
 const old={id:1,key:'LEGACY',tags:['AI-Summary'],html:'<p>Original summary</p><p>DATA_AVAILABILITY: NotReported</p><p>DATA_ACCESSION: Not reported</p>'},bytes=old.html;
 const p=N.assemble(item([old,note('L2',2)]),pack,[]),s=C.inspect(item([old,asNote(p)]),pack,[]);assert.equal(s.L1.state,'complete');assert.equal(s.L2.state,'complete');assert.equal(old.html,bytes);assert.deepEqual(p.archive,[2]);assert.equal(s.L1.note.record.originKey,'LEGACY');assert(C.dependencyMatches(s.L1,'LEGACY'));
});
test('conflicting or malformed notes are held for review instead of overwritten',()=>{
 assert.throws(()=>N.assemble(item([note('L1',1),note('L1',2)]),pack,[]),/conflicting/);
 const p=asNote(N.assemble(item([note('L1',1)]),pack,[]));p.html=p.html.replace('[L1] 一句话概览','User removed section marker');assert.throws(()=>N.assemble(item([p]),pack,[],C.render('New',record('L2'),'Paper')),/format/);
 const n=note('L1',1);n.html=n.html.replace(/<\/div>$/,'<p>Trailing user note</p></div>');assert.throws(()=>N.assemble(item([n]),pack,[]),/extra-content/);
});

test('copied Butler display metadata is removed while private workflow identity remains valid',()=>{
 const source='<p>AI 来源：供应商：Original · 模型：Model-A · 生成时间：2026-10-21</p><p>Summary</p><p>DATA_AVAILABILITY: NotReported</p><p>DATA_ACCESSION: Not reported</p>';
 const legacy={id:1,key:'LEGACY',tags:['AI-Summary'],html:source};
 const p=N.assemble(item([legacy,note('L2',2),note('L3',3)]),pack,[]);
 assert(!p.html.includes('供应商：Original'));assert(!p.html.includes('模型：Model-A'));assert(!p.html.includes('生成时间：2026-10-21'));assert(!/AI\s*来源[:：]/.test(p.html));assert.equal(legacy.html,source);
 assert(!C.visible(p.html).includes('LF_RECORD_V1'));assert(!p.html.includes('data-lf-record='));assert.deepEqual(C.records(asNote(p)).map(r=>r.stage),['L1','L2','L3']);
 const upgraded=N.assemble(item([asNote(p)]),pack,[]);assert.equal(upgraded.html,p.html);
 const state=C.inspect(item([asNote(upgraded)]),pack,[]);for(const s of C.stages)assert.equal(state[s].state,'complete');
});
test('destructive consolidation selects the newest note per stage and retires every recognized source',()=>{
 const older=note('L2',2),newer=note('L2',3),archived=note('L3',4),l1old={id:5,key:'L1OLD',dateModified:'2026-01-01 00:00:00',tags:['AI-Summary'],html:'<p>Old L1</p><p>DATA_AVAILABILITY: Public</p><p>DATA_ACCESSION: OLD</p>'},l1new={id:6,key:'L1NEW',dateModified:'2026-02-01 00:00:00',tags:['AI-Summary'],html:'<p>**Newest L1**</p><p>DATA_AVAILABILITY: Public</p><p>DATA_ACCESSION: NEW</p>'};
 older.dateModified='2026-01-01 00:00:00';older.html=older.html.replace('Result','Older result');newer.dateModified='2026-03-01 00:00:00';newer.html=newer.html.replace('Result','Newest result');archived.dateModified='2026-01-15 00:00:00';archived.tags.push('LF:Archive');
 const p=N.assemble(item([older,newer,archived,l1old,l1new]),pack,[],null,{}, {latestOnly:true,deleteSources:true});
 assert(p.html.includes('Newest result'));assert(!p.html.includes('Older result'));assert(p.html.includes('Newest L1'));assert(!p.html.includes('Old L1'));
 assert.deepEqual(p.retire.sort((a,b)=>a-b),[2,3,4,5,6]);assert.deepEqual(p.archive,[]);assert.deepEqual(C.records(asNote(p)).map(r=>r.stage),['L1','L2','L3']);
 assert(p.html.indexOf('[L1]')<p.html.indexOf('[L2]'));assert(p.html.indexOf('[L2]')<p.html.indexOf('[L3]'));
});

test('true AI generation time outranks Zotero modification time and is exposed in the merge plan',()=>{
 const managed=(id,created,modified,label)=>({id,key:'LF'+id,dateModified:modified,tags:['LF:Note'],html:C.render(label,{...record('L2',label),created},'Paper')});
 const oldManaged=managed(20,'2026-01-01T00:00:00Z','2026-04-01 00:00:00','Old managed'),newManaged=managed(21,'2026-03-01T00:00:00Z','2026-02-01 00:00:00','New managed');
 const managedPlan=N.assemble(item([oldManaged,newManaged]),pack,[],null,{}, {latestOnly:true,deleteSources:true});
 assert(managedPlan.html.includes('New managed'));assert(!managedPlan.html.includes('Old managed'));assert.equal(managedPlan.selections[0].candidates.find(c=>c.selected).key,'LF21');assert.equal(managedPlan.selections[0].candidates.find(c=>c.selected).basis,'AI 生成时间');
 const butler=(id,generatedAt,modified,label)=>{const meta=Buffer.from(JSON.stringify({generatedAt})).toString('base64url');return {id,key:'BUTLER'+id,dateModified:modified,tags:['AI-Summary'],html:`<!-- AI_BUTLER_LLM_META_B64URL::v1::${meta} --><p>${label}</p><p>DATA_AVAILABILITY: Public</p><p>DATA_ACCESSION: TEST</p>`};};
 const oldButler=butler(30,'2026-01-01T00:00:00Z','2026-04-01 00:00:00','Old Butler'),newButler=butler(31,'2026-03-01T00:00:00Z','2026-02-01 00:00:00','New Butler');
 const butlerPlan=N.assemble(item([oldButler,newButler]),pack,[],null,{}, {latestOnly:true,deleteSources:true}),selected=butlerPlan.selections[0].candidates.find(c=>c.selected);
 assert(butlerPlan.html.includes('New Butler'));assert(!butlerPlan.html.includes('Old Butler'));assert.equal(selected.key,'BUTLER31');assert.equal(selected.at,'2026-03-01T00:00:00.000Z');assert.equal(selected.basis,'AI 生成时间');
});

test('newer dispersed stage replaces its older combined origin while other combined stages stay intact',()=>{
 const oldL1=note('L1',1);oldL1.dateModified='2026-01-01 00:00:00';const base=asNote(N.assemble(item([oldL1,note('L2',2)]),pack,[]));base.dateModified='2026-04-01 00:00:00';
 const replacement=note('L1',3);replacement.dateModified='2026-03-01 00:00:00';replacement.html=replacement.html.replace('Result','Replacement result');
 const p=N.assemble(item([{...oldL1,tags:[...oldL1.tags,'LF:Archive']},base,replacement]),pack,[],null,{}, {latestOnly:true,deleteSources:true});
 assert(p.html.includes('Replacement result'));assert(p.html.includes('Result'));assert.equal(N.split(asNote(p)).blocks.L2.record.task,'L2');assert.deepEqual(p.retire.sort((a,b)=>a-b),[1,3]);
});

test('destructive consolidation leaves an untagged human note untouched even when its text resembles L2',()=>{
 const human={id:8,key:'HUMAN',dateModified:'2026-04-01 00:00:00',tags:[],html:'<p>[L2] Evidence Card</p><p>Human reading note that must remain.</p>'};
 const source=note('L1',1),p=N.assemble(item([source,human]),pack,[],null,{}, {latestOnly:true,deleteSources:true});
 assert.deepEqual(N.sourceStages(human,pack),[]);assert.deepEqual(p.retire,[1]);assert(!p.html.includes('Human reading note'));
});

test('combined-note parser ignores legacy h3 headings and needs no metadata in the Note body',()=>{
 const source=note('L2',2);source.html=source.html.replace('<h4>Findings</h4>','<h3>[L2] Evidence Card</h3><h3>1. One-Sentence Conclusion</h3>');
 const p=N.assemble(item([source]),pack,[]),combined=asNote(p),parsed=N.split(combined);
 assert.deepEqual(Object.keys(parsed.blocks),['L2']);assert(parsed.blocks.L2.body.includes('[L2] Evidence Card'));assert(!p.html.includes('data-lf-record'));assert(!C.visible(p.html).includes('LF_RECORD_V1'));
});
