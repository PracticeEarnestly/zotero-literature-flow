/* SPDX-License-Identifier: AGPL-3.0-or-later */
var LFNotes = (()=>{
  const C=typeof LFCore!=='undefined'?LFCore:require('./core.js');
  const titles={L1:'一句话概览',L2:'证据卡',L3:'深度阅读'};
  const decode=v=>String(v).replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  function recordMarkers(html){
    const hidden=[...html.matchAll(/<span\b[^>]*\bdata-lf-record="([^"]+)"[^>]*>[\s\S]*?<\/span>/gi)].map(m=>{
      try{return {start:m.index,end:m.index+m[0].length,record:JSON.parse(decode(m[1]))};}catch{throw new Error('review-note-record-format');}
    });
    if(hidden.length)return hidden;
    return [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].flatMap(m=>{
      const v=C.visible(m[0]).trim();if(!v.startsWith('LF_RECORD_V1 '))return [];
      try{return [{start:m.index,end:m.index+m[0].length,record:JSON.parse(v.slice(13))}];}catch{throw new Error('review-note-record-format');}
    });
  }
  function cleanBody(html){
    const unwanted=text=>{
      const v=text.replace(/\s+/g,' ').trim();
      return /^按 L1 概览\s*→\s*L2 证据卡\s*→\s*L3 深读顺序阅读；?后续结果更新在本笔记中。?$/.test(v)
        || /^AI\s*管家\s*[-—–:：]\s*.+$/i.test(v)
        || /^(?:AI\s*来源|原笔记生成信息)\s*[:：]/i.test(v)
        || /^输入\s*[:：].*结构校验不等于科学事实验证。?$/.test(v);
    };
    return String(html).replace(/<(p|h[1-6])\b[^>]*>[\s\S]*?<\/\1>/gi,block=>unwanted(C.visible(block))?'':block);
  }
  function singleBody(note){
    const rs=C.records(note),ps=recordMarkers(note.html),head=/<h3\b[^>]*>[\s\S]*?<\/h3>/i.exec(note.html);
    if(rs.length!==1||ps.length!==1||!head||!C.visible(head[0]).startsWith('[Literature Flow]'))throw new Error('review-note-format');
    const tail=note.html.slice(ps[0].end).replace(/<\/?div\b[^>]*>/gi,'').trim();
    if(tail)throw new Error('review-note-extra-content');
    return {body:note.html.slice(head.index+head[0].length,ps[0].start),record:rs[0]};
  }
  function split(note){
    const rs=C.records(note),ps=recordMarkers(note.html);
    const heads=[...note.html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].flatMap(m=>{const text=C.visible(m[1]).trim(),stage=C.stages.find(s=>text==='['+s+'] '+titles[s]);return stage?[{start:m.index,end:m.index+m[0].length,stage}]:[];});
    if(!rs.length||heads.length!==rs.length||ps.length!==0&&ps.length!==rs.length||new Set(heads.map(h=>h.stage)).size!==heads.length)throw new Error('review-combined-note-format');
    const footer=[...note.html.matchAll(/<h6\b[^>]*>([\s\S]*?)<\/h6>/gi)].find(m=>C.visible(m[1]).trim()==='生成记录');
    const closing=note.html.lastIndexOf('</div>'),recordStart=ps.length?(footer?.index??Math.min(...ps.map(p=>p.start))):(closing>=0?closing:note.html.length);
    if(recordStart<heads[heads.length-1].end||footer&&ps.some(p=>p.start<footer.index)||!footer&&ps.some(p=>p.start<recordStart))throw new Error('review-combined-note-format');
    const blocks={};
    for(let i=0;i<heads.length;i++){
      const h=heads[i],r=rs.find(r=>r.stage===h.stage);
      if(!r)throw new Error('review-combined-note-format');
      blocks[h.stage]={body:note.html.slice(h.end,heads[i+1]?.start??recordStart),record:r};
    }
    return {prefix:note.html.slice(0,heads[0].start),suffix:note.html.slice(ps.length?ps[ps.length-1].end:recordStart),blocks};
  }
  function inferRecords(note,parent,scope,prompt){
    return [...note.html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].flatMap(m=>{
      const text=C.visible(m[1]).trim(),stage=C.stages.find(s=>text==='['+s+'] '+titles[s]);
      return stage?[{stage,revision:0,task:'combined:'+note.key+':'+stage,parent,scope,prompt,source:'COMBINED_NOTE',previous:[]}]:[];
    });
  }
  function legacyText(note,stage){
    // Preserve the original Note separately; import only the validated level.
    const text=C.visible(note.html.replace(/<\/t[dh]>/gi,' | ').replace(/<\/tr>/gi,'\n'));
    const marks=[...text.matchAll(/^\s*\[(L2|L3)\]\s*(?:Evidence\s*Card|Deep\s*Reading).*$/gim)];
    if(stage==='L1')return text.slice(0,marks[0]?.index??text.length).trim();
    const i=marks.findIndex(m=>m[1].toUpperCase()===stage);if(i<0)throw new Error('review-legacy-block');
    return text.slice(marks[i].index,marks[i+1]?.index??text.length).trim();
  }
  const withoutArchive=note=>({...note,tags:(note.tags||[]).filter(t=>t!=='LF:Archive')});
  const managedRecords=note=>C.records(withoutArchive(note));
  function sourceStages(note,pack){
    const managed=managedRecords(note).map(r=>r.stage);
    if(managed.length)return managed;
    const tags=note.tags||[],butler=tags.some(t=>['AI-Generated','AI-Summary','AI-DeepRead'].includes(t));
    return butler?C.legacyStages(note,pack):[];
  }
  const modified=note=>Date.parse(note.dateModified||note.dateAdded||'')||0;
  const later=(a,b)=>modified(a.note)!==modified(b.note)?modified(a.note)-modified(b.note):(a.note.id||0)!==(b.note.id||0)?(a.note.id||0)-(b.note.id||0):String(a.note.key).localeCompare(String(b.note.key));
  function sourceBlock(note,stage,item,pack,formatted){
    const managed=managedRecords(note).find(r=>r.stage===stage);
    if(managed){const parsed=singleBody(withoutArchive(note));return {body:cleanBody(formatted[note.key]??parsed.body),record:{...parsed.record,originKey:parsed.record.originKey||note.key,previous:[...new Set([...(parsed.record.previous||[]),note.key])]}};}
    if(!sourceStages(note,pack).includes(stage))return null;
    return {body:cleanBody(C.markdownHTML(legacyText(note,stage))),record:{stage,revision:0,task:'legacy:'+note.key+':'+stage,parent:item.key,scope:item.scope,prompt:'legacy-preserved',source:'LEGACY_TEXT',originKey:note.key,previous:[note.key]}};
  }
  function assemble(item,pack,history,incoming=null,formatted={},options={}){
    const all=item.notes||[],live=all.filter(n=>!(n.tags||[]).includes('LF:Archive'));
    const combined=live.filter(n=>(n.tags||[]).includes('LF:Combined'));
    if(combined.length>1)throw new Error('review-multiple-combined-notes');
    const target=combined[0],parts=target?split(target):{prefix:'<div><h3>[Literature Flow] 综合阅读 · '+C.escape(item.title)+'</h3>',suffix:'</div>',blocks:{}};
    parts.prefix=cleanBody(parts.prefix);parts.suffix=cleanBody(parts.suffix);
    const states=C.inspect(item,pack,history),blocks=parts.blocks;
    if(target&&C.records(target).some(r=>r.parent!==item.key||r.scope!==item.scope))throw new Error('review-note-owner');
    if(options.latestOnly){
      for(const stage of C.stages){
        const sources=all.filter(n=>n.key!==target?.key&&!((n.tags||[]).includes('LF:Combined'))).flatMap(n=>{const block=sourceBlock(n,stage,item,pack,formatted);return block?[{note:n,block}]:[];});
        const current=blocks[stage]&&{note:all.find(n=>n.key===blocks[stage].record.originKey)||target,block:blocks[stage],current:true};
        const ranked=[...(current?[current]:[]),...sources].sort(later),chosen=ranked[ranked.length-1];
        if(chosen&&!chosen.current)blocks[stage]={...chosen.block,after:''};
      }
    }else for(const stage of C.stages){
        if(states[stage].state==='conflict')throw new Error('review-conflicting-notes');
        if(blocks[stage]||states[stage].state!=='complete')continue;
        const n=states[stage].note,parsed=sourceBlock(n,stage,item,pack,formatted);blocks[stage]={...parsed,after:''};
    }
    if(incoming){const p=singleBody({html:incoming,tags:['LF:Note']});const old=blocks[p.record.stage];p.record={...p.record,previous:[...new Set([...(p.record.previous||[]),...(old?.record.previous||[])])]};blocks[p.record.stage]={...p,after:old?.after||''};}
    if(!Object.keys(blocks).length)throw new Error('review-no-complete-results');
    for(const block of Object.values(blocks))block.body=cleanBody(block.body);
    const available=C.stages.filter(s=>blocks[s]);
    const html=parts.prefix+available.map(s=>'<h3>['+s+'] '+titles[s]+'</h3>'+blocks[s].body).join('')+parts.suffix;
    const archive=options.latestOnly?[]:live.filter(n=>n.key!==target?.key&&(n.tags||[]).includes('LF:Note')&&C.records(n).length&&C.records(n).every(r=>blocks[r.stage]?.record.task===r.task)).map(n=>n.id);
    const retire=options.deleteSources?all.filter(n=>n.key!==target?.key&&!(n.tags||[]).includes('LF:Combined')&&sourceStages(n,pack).length).map(n=>n.id):[];
    return {html,target,archive,retire,records:C.stages.filter(s=>blocks[s]).map(s=>blocks[s].record)};
  }
  return {singleBody,split,assemble,legacyText,sourceStages,inferRecords};
})();
if(typeof module!=='undefined')module.exports=LFNotes;
