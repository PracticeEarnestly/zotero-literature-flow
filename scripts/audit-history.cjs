// Read-only simulation using the exact production classification/planning engine.
// Usage: node scripts/audit-history.cjs PRIVATE-export.json PRIVATE-report.json
const fs=require('node:fs'),assert=require('node:assert/strict');
const C=require('../addon/content/core.js'),pack=require('../addon/content/contracts/legacy.json');
(async()=>{
  const data=JSON.parse(fs.readFileSync(process.argv[2])),items=data.items;
  let seq=0,calls=0;
  const port={now:()=>Date.now(),uuid:()=>String(++seq),save:async()=>{},request:async()=>{calls++;throw Error('Audit must never request inference');}};
  const e=new C.Engine(port,pack);
  await e.controls({role:'executor',paused:false});await e.baseline(items);await e.controls({auto:true});
  for(let pass=0;pass<3;pass++)for(const item of items)await e.observe(item);
  assert.equal(e.state.tasks.length,0,'Historical baseline must produce zero tasks');
  const counts=Object.fromEntries(C.stages.map(s=>[s,{}])),ratings={},rows=[];
  for(const item of items){
    const levels=C.inspect(item,pack),r=C.rating(item.extra,item.tags);
    const bucket=r.status==='valid'?String(r.value):r.status;ratings[bucket]=(ratings[bucket]||0)+1;
    for(const s of C.stages)counts[s][levels[s].state]=(counts[s][levels[s].state]||0)+1;
    const before=e.state.tasks.length;
    await e.plan(item,3);
    const tasks=e.state.tasks.slice(before);
    for(const t of tasks)assert.equal(levels[t.stage].state,'missing','Completed/review/conflict stages must not be planned');
    rows.push({id:item.id,key:item.key,rating:r,levels:Object.fromEntries(C.stages.map(s=>[s,{state:levels[s].state,note:levels[s].note?.key,notes:levels[s].notes?.map(n=>n.key),shared:levels[s].shared}])),plannedMissing:tasks.map(t=>t.stage)});
  }
  assert.equal(calls,0);
  const summary={items:items.length,notes:data.allNoteHashes.length,ratings,levels:counts,historicalReplayPasses:3,historicalAutomaticTasks:0,modelRequests:0,completedReviewConflictRescheduled:0,itemsWithReviewOrConflict:rows.filter(r=>Object.values(r.levels).some(v=>['review','conflict'].includes(v.state))).length};
  fs.writeFileSync(process.argv[3],JSON.stringify({summary,rows},null,2),{mode:0o600});
  console.log(JSON.stringify(summary,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
