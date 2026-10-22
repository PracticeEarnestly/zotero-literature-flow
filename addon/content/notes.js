/* SPDX-License-Identifier: AGPL-3.0-or-later */
var LFNotes = (()=>{
  const C=typeof LFCore!=='undefined'?LFCore:require('./core.js');
  const titles={L1:'一句话概览',L2:'证据卡',L3:'深度阅读'};
  function recordParagraphs(html){
    return [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].flatMap(m=>{
      const v=C.visible(m[0]).trim();if(!v.startsWith('LF_RECORD_V1 '))return [];
      try{return [{start:m.index,end:m.index+m[0].length,record:JSON.parse(v.slice(13))}];}catch{throw new Error('review-note-record-format');}
    });
  }
  function singleBody(note){
    const rs=C.records(note),ps=recordParagraphs(note.html),head=/<h3\b[^>]*>[\s\S]*?<\/h3>/i.exec(note.html);
    if(rs.length!==1||ps.length!==1||!head||!C.visible(head[0]).startsWith('[Literature Flow]'))throw new Error('review-note-format');
    const tail=note.html.slice(ps[0].end).replace(/<\/?div\b[^>]*>/gi,'').trim();
    if(tail)throw new Error('review-note-extra-content');
    return {body:note.html.slice(head.index+head[0].length,ps[0].start),record:rs[0]};
  }
  function split(note){
    const rs=C.records(note),ps=recordParagraphs(note.html);
    const heads=[...note.html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].flatMap(m=>{const stage=C.visible(m[1]).trim().match(/^\[(L[123])\]/)?.[1];return stage?[{start:m.index,end:m.index+m[0].length,stage}]:[];});
    if(!rs.length||heads.length!==rs.length||ps.length!==rs.length||new Set(heads.map(h=>h.stage)).size!==heads.length)throw new Error('review-combined-note-format');
    const footer=[...note.html.matchAll(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi)].find(m=>C.visible(m[1]).trim()==='生成记录');
    if(!footer||footer.index<heads[heads.length-1].end||ps.some(p=>p.start<footer.index))throw new Error('review-combined-note-format');
    const blocks={};
    for(let i=0;i<heads.length;i++){
      const h=heads[i],r=rs.find(r=>r.stage===h.stage);
      if(!r)throw new Error('review-combined-note-format');
      blocks[h.stage]={body:note.html.slice(h.end,heads[i+1]?.start??footer.index),record:r};
    }
    return {prefix:note.html.slice(0,heads[0].start),suffix:note.html.slice(ps[ps.length-1].end),blocks};
  }
  function legacyText(note,stage){
    // Preserve the original Note separately; import only the validated level.
    const text=C.visible(note.html.replace(/<\/t[dh]>/gi,' | ').replace(/<\/tr>/gi,'\n'));
    const marks=[...text.matchAll(/^\s*\[(L2|L3)\]\s*(?:Evidence\s*Card|Deep\s*Reading).*$/gim)];
    if(stage==='L1')return text.slice(0,marks[0]?.index??text.length).trim();
    const i=marks.findIndex(m=>m[1].toUpperCase()===stage);if(i<0)throw new Error('review-legacy-block');
    return text.slice(marks[i].index,marks[i+1]?.index??text.length).trim();
  }
  function assemble(item,pack,history,incoming=null,formatted={}){
    const live=item.notes.filter(n=>!(n.tags||[]).includes('LF:Archive'));
    const combined=live.filter(n=>(n.tags||[]).includes('LF:Combined'));
    if(combined.length>1)throw new Error('review-multiple-combined-notes');
    const target=combined[0],parts=target?split(target):{prefix:'<div><h3>[Literature Flow] 综合阅读 · '+C.escape(item.title)+'</h3><p>按 L1 概览 → L2 证据卡 → L3 深读顺序阅读；后续结果更新在本笔记中。</p>',suffix:'</div>',blocks:{}};
    const states=C.inspect(item,pack,history),blocks=parts.blocks;
    if(target&&C.records(target).some(r=>r.parent!==item.key||r.scope!==item.scope))throw new Error('review-note-owner');
    for(const stage of C.stages){
      if(states[stage].state==='conflict')throw new Error('review-conflicting-notes');
      if(blocks[stage]||states[stage].state!=='complete')continue;
      const n=states[stage].note;let body,record;
      if(n.record){({body,record}=singleBody(n));body=formatted[n.key]??body;record={...record,originKey:record.originKey||n.key,previous:[...new Set([...(record.previous||[]),n.key])]};}
      else{body=C.markdownHTML(legacyText(n,stage));record={stage,revision:0,task:'legacy:'+n.key+':'+stage,parent:item.key,scope:item.scope,prompt:'legacy-preserved',source:'LEGACY_TEXT',originKey:n.key,previous:[n.key]};}
      blocks[stage]={body,record,after:''};
    }
    if(incoming){const p=singleBody({html:incoming,tags:['LF:Note']});const old=blocks[p.record.stage];p.record={...p.record,previous:[...new Set([...(p.record.previous||[]),...(old?.record.previous||[])])]};blocks[p.record.stage]={...p,after:old?.after||''};}
    if(!Object.keys(blocks).length)throw new Error('review-no-complete-results');
    const available=C.stages.filter(s=>blocks[s]);
    const html=parts.prefix+available.map(s=>'<h3>['+s+'] '+titles[s]+'</h3>'+blocks[s].body).join('')+'<h6>生成记录</h6>'+available.map(s=>C.recordHTML(blocks[s].record)).join('')+parts.suffix;
    const archive=live.filter(n=>n.key!==target?.key&&(n.tags||[]).includes('LF:Note')&&C.records(n).length&&C.records(n).every(r=>blocks[r.stage]?.record.task===r.task)).map(n=>n.id);
    return {html,target,archive,records:C.stages.filter(s=>blocks[s]).map(s=>blocks[s].record)};
  }
  return {singleBody,split,assemble,legacyText};
})();
if(typeof module!=='undefined')module.exports=LFNotes;
