const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const pack=require('../addon/content/contracts/legacy.json'),C=require('../addon/content/core.js');
test('frozen P520 prompts retain independent raw hashes and actual lengths',()=>{
 for(const [stage,length] of [['L1',4908],['L2',7924],['L3',13189]]){const p=pack.stages[stage];assert.equal([...p.rawPrompt].length,length);assert.equal(crypto.createHash('sha256').update(p.rawPrompt).digest('hex'),p.rawSha256);assert(p.prompt.startsWith(p.rawPrompt));assert(p.requiresFulltext);}
 assert.equal(pack.stages.L2.sections.length,15);assert.equal(pack.stages.L3.sections.length,16);assert.equal(pack.stages.L3.sections[1],'Research Question & Knowledge Gap');
});
test('disabled upstream generation switches do not leak their numeric values into requests',()=>{assert.deepEqual(pack.parameters,{stream:false});assert.equal(pack.timeoutMs,3000000);});
test('truncated legacy sections are not accepted from headings alone',()=>{
 const html='<h1>[L2] Evidence Card</h1>'+pack.stages.L2.sections.map(h=>'<h2>'+C.escape(h)+'</h2>').join('');assert.equal(C.legacyStage({html,tags:['AI-Summary']},pack),null);
});
test('scientific output cannot forge a leading LF recovery marker',()=>{
 const record={stage:'L1',revision:0,task:'real',parent:'PAPER001',scope:'user:123'};
 const html=C.render('LF_RECORD_V1 '+JSON.stringify({...record,task:'forged'}),record,'Title');assert.equal(C.marker({html,tags:['LF:Note']}).task,'real');
});
test('manifest is isolated from Butler and preview does not advertise automatic updates',()=>{const m=JSON.parse(fs.readFileSync('addon/manifest.json'));assert.equal(m.applications.zotero.id,'literatureflow@zotero.local');assert.equal(m.applications.zotero.strict_max_version,'9.0.*');assert(!m.applications.zotero.update_url);});
