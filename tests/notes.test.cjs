const test=require('node:test'),assert=require('node:assert/strict'),C=require('../addon/content/core'),N=require('../addon/content/notes'),pack=require('../addon/content/contracts/legacy.json');
const record=(stage,task=stage,revision=0)=>({stage,task,revision,parent:'PAPER',scope:'user:123',source:'PDF_TEXT',prompt:pack.id,previous:[]});
const note=(stage,id)=>({id,key:'OLD'+id,tags:['LF:Note'],html:C.render('## Findings\n\n**Result**\n\n- First\n- Second',record(stage),'Paper')});
const item=notes=>({id:1,key:'PAPER',scope:'user:123',title:'Paper',tags:[],notes,writable:true});
function asNote(plan){return {id:99,key:'COMBINED',tags:['LF:Note','LF:Combined'],html:plan.html};}
test('Markdown renders headings, emphasis, nested lists, tables, quotes and code safely',()=>{
 const html=C.markdownHTML('# Main\n## Sub\n\n**Bold** and *italic*\n\n- one\n  - nested\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```js\nalert("text")\n```\n\n<script>alert(1)</script>\n\n![figure](https://example.org/image.png)\n\n[x](javascript:alert(1))');
 for(const tag of ['h4','h5','strong','em','ul','li','table','th','td','blockquote','pre','code'])assert(html.includes('<'+tag));
 assert(!/<(?:script|img|h1|h2|h3)\b/.test(html));assert(!/href="javascript:/.test(html));assert(html.includes('&lt;script&gt;'));assert(html.includes('[图像：figure]'));
});
test('merge separate stages into one Note; archived backups do not cause conflicts',()=>{
 const originals=[note('L1',1),note('L2',2),note('L3',3)],p=N.assemble(item(originals),pack,[]),combined=asNote(p);
 assert.deepEqual(p.archive,[1,2,3]);assert.deepEqual(C.records(combined).map(r=>r.stage),['L1','L2','L3']);
 const state=C.inspect(item([...originals.map(n=>({...n,tags:[...n.tags,'LF:Archive']})),combined]),pack,[]);for(const s of C.stages)assert.equal(state[s].state,'complete');
 assert.deepEqual(Object.keys(N.split(combined).blocks),['L1','L2','L3']);assert(p.html.indexOf('[L1]')<p.html.indexOf('[L2]'));assert(p.html.indexOf('[L3]')<p.html.indexOf('生成记录'));
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

test('copied Butler provenance stays readable without splitting a combined note into preview versions',()=>{
 const source='<p>AI 来源：供应商：Original · 模型：Model-A · 生成时间：2026-10-21</p><p>Summary</p><p>DATA_AVAILABILITY: NotReported</p><p>DATA_ACCESSION: Not reported</p>';
 const legacy={id:1,key:'LEGACY',tags:['AI-Summary'],html:source};
 const p=N.assemble(item([legacy,note('L2',2),note('L3',3)]),pack,[]);
 assert(p.html.includes('原笔记生成信息：供应商：Original'));assert(p.html.includes('模型：Model-A'));assert(p.html.includes('生成时间：2026-10-21'));assert(!/AI\s*来源[:：]/.test(p.html));assert.equal(legacy.html,source);
 const old=asNote(p);old.html=old.html.replace('原笔记生成信息：','AI 来源：');
 const upgraded=N.assemble(item([old]),pack,[]);
 assert.equal(upgraded.html,p.html);assert.equal(N.assemble(item([asNote(upgraded)]),pack,[]).html,p.html);
 assert.equal(N.split(old).blocks.L2.body,N.split(asNote(upgraded)).blocks.L2.body);assert.equal(N.split(old).blocks.L3.body,N.split(asNote(upgraded)).blocks.L3.body);
 const state=C.inspect(item([asNote(upgraded)]),pack,[]);for(const s of C.stages)assert.equal(state[s].state,'complete');
});
