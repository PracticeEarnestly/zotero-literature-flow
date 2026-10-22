/* SPDX-License-Identifier: AGPL-3.0-or-later */
var LFCore = (() => {
  const stages = ['L1', 'L2', 'L3'];
  const escape = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function visible(html) {
    return String(html).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|li|pre)>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
  }
  function rating(extra, tags = [], tagAdapter = false) {
    const values = [...String(extra || '').matchAll(/^\s*rate\s*:\s*(.*?)\s*$/gim)].map(m => m[1]);
    const tagValues = tagAdapter ? tags.filter(t => /^rate\s*:/i.test(t)).map(t => t.replace(/^rate\s*:\s*/i,'')) : [];
    const all = [...values, ...tagValues];
    const source = values.length ? 'Extra.rate' : tagValues.length ? 'tag.rate' : 'none';
    if (all.some(v => !/^[0-5]$/.test(v)) || new Set(all).size > 1) return {value:null, status:'conflict', source};
    return {value:all.length ? Number(all[0]) : null, status:all.length ? 'valid' : 'unrated', source};
  }
  const target = r => r.status === 'conflict' ? 0 : r.value === 5 ? 3 : r.value >= 2 ? 2 : 1;
  const normalized = s => s.toLowerCase().replace(/[–—]/g,'-').replace(/\s*[/&]\s*/g,'/').replace(/^\s*\d+[.)、：:]\s*/,'').replace(/[：:]\s*$/,'').replace(/[^\p{L}\p{N}/-]+/gu,' ').trim();
  function checkSections(text, sections, markdown = true) {
    const lines = text.split(/\r?\n/);
    return sections.every(section => {
      const n = lines.findIndex(l => normalized(markdown ? l.replace(/^\s*#{1,6}\s+/,'') : l) === normalized(section));
      if (n < 0) return false;
      const level = markdown ? lines[n].match(/^\s*(#{1,6})\s/)?.[1].length : null;
      const rest = lines.slice(n + 1);
      const end = rest.findIndex(l => {
        const heading = markdown ? l.match(/^\s*(#{1,6})\s/) : null;
        if (heading && level) return heading[1].length <= level;
        return sections.some(s => normalized(l.replace(/^\s*#{1,6}\s+/,'')) === normalized(s));
      });
      // A section may start with subsections; their prose counts, their headings alone do not.
      const body = rest.slice(0,end < 0 ? rest.length : end).filter(l => !markdown || !/^\s*#{1,6}\s/.test(l));
      return /[\p{L}\p{N}]/u.test(body.join('\n'));
    });
  }
  function parseTagJSON(raw) {
    try { return JSON.parse(raw); } catch {}
    // Normalize only paired typographic string delimiters. Never rewrite valid
    // JSON strings, infer missing syntax, or evaluate model-supplied code.
    let result='',quote=null,escaped=false;
    for(const c of raw){
      if(quote){
        if(escaped){result+=c;escaped=false;continue;}
        if(c==='\\'){result+=c;escaped=true;continue;}
        if(quote==='ascii'){result+=c;if(c==='"')quote=null;}
        else if(c==='”'||c==='"'){result+='"';quote=null;}
        else if(c==='“')throw new Error('output-tags-json');
        else result+=c;
      }else if(c==='“'){result+='"';quote='curly';}
      else if(c==='"'){result+=c;quote='ascii';}
      else if(c==='”')throw new Error('output-tags-json');
      else result+=c;
    }
    if(quote)throw new Error('output-tags-json');
    try{return JSON.parse(result);}catch{throw new Error('output-tags-json');}
  }
  function validate(response, stage, pack) {
    if (response.finish !== 'stop') throw new Error('output-incomplete: finish_reason must be stop');
    let text = String(response.text || '').replace(/<(think|thinking|reasoning|analysis)\b[^>]*>[\s\S]*?<\/\1>/gi,'').trim();
    if (!text || /<(think|thinking|reasoning|analysis)\b/i.test(text)) throw new Error('output-empty-or-reasoning');
    const blocks = [...text.matchAll(/ZOTERO_TAGS_JSON_START\s*([\s\S]*?)\s*ZOTERO_TAGS_JSON_END/g)];
    if (blocks.length !== 1 || (text.match(/ZOTERO_TAGS_JSON_(START|END)/g)||[]).length !== 2) throw new Error('output-tags-boundary');
    const parsed = parseTagJSON(blocks[0][1]);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(v => !Array.isArray(v) || v.some(t => typeof t !== 'string'))) throw new Error('output-tags-schema');
    text = text.replace(blocks[0][0],'').replace(/```(?:json)?\s*```/g,'').trim();
    if (!/[\p{L}\p{N}]/u.test(text) || !checkSections(text, pack.stages[stage].sections)) throw new Error('output-missing-sections');
    const tags = [];
    const evidence = [...new Set(Object.values(parsed).flat().filter(t => pack.evidenceValues.some(v => t === 'Evidence:' + v)))];
    if (evidence.length > 1) throw new Error('output-conflicting-evidence');
    tags.push(...evidence);
    if (stage === 'L1') {
      const value = text.match(/^\s*DATA_AVAILABILITY\s*[:：]\s*(\w+)\s*$/m)?.[1];
      if (!pack.dataValues.includes(value)) throw new Error('output-data-availability');
      if (!/[\p{L}\p{N}]/u.test(text.replace(/^\s*DATA_(AVAILABILITY|ACCESSION).*$/gm,''))) throw new Error('output-empty-summary');
      tags.push('Data:' + value);
    }
    return {text, tags};
  }
  function marker(note) {
    if (!(note.tags || []).includes('LF:Note')) return null;
    const match = visible(note.html).match(/^LF_RECORD_V1 (\{[^\n]+\})\s*$/m);
    if (!match) return null;
    try {
      const m = JSON.parse(match[1]);
      return stages.includes(m.stage) && Number.isInteger(m.revision) && m.revision >= 0 && typeof m.task === 'string' && m.task && m.parent && m.scope ? m : null;
    } catch { return null; }
  }
  function inspect(item, pack, history = []) {
    const result = {};
    const notes = item.notes || [];
    const legacy = new Map(notes.map(n => [n.key,legacyStages(n,pack)]));
    const unknown = notes.some(n => !marker(n) && (/\[L[123]\]|AI_BUTLER|DATA_AVAILABILITY/.test(visible(n.html)) || (n.tags || []).some(t => ['LF:Note','AI-Generated','AI-Summary','AI-DeepRead','AI-Butler-Chat','Literature Flow'].includes(t))) && !legacy.get(n.key).length);
    for (const stage of stages) {
      // A valid L2 block does not prove that an older summary/L3 block is absent.
      // Keep partial mixed Notes under review instead of regenerating their contents.
      const partial = notes.some(n => !marker(n) && !legacy.get(n.key).includes(stage) && (
        visible(n.html).includes('['+stage+']') ||
        stage === 'L1' && (n.tags || []).some(t => ['AI-Generated','AI-Summary'].includes(t))
      ));
      const found = notes.map(n => ({...n, record:marker(n)})).filter(n => n.record ? n.record.stage === stage && n.record.parent === item.key && n.record.scope === item.scope : legacyStages(n,pack).includes(stage));
      const superseded = new Set(found.flatMap(n => n.record?.previous || []));
      const active = found.filter(n => !superseded.has(n.key));
      const known = history.filter(t => t.parent === item.key && t.scope === item.scope && t.stage === stage && t.status === 'completed');
      const deleted = !active.length && known.some(t => t.noteKey && !notes.some(n => n.key === t.noteKey));
      result[stage] = active.length > 1 ? {state:'conflict',notes:active} : active.length === 1 ? {state:'complete', note:active[0], shared:!active[0].record} : {state:deleted ? 'deleted' : unknown || partial || item.tags.includes('AI:' + stage) ? 'review' : 'missing'};
    }
    return result;
  }
  function legacyStages(note, pack) {
    const text = visible(note.html);
    if ((note.tags || []).includes('LF:Note')) return [];
    const levels = [];
    const markers = [...text.matchAll(/^\s*\[(L2|L3)\]\s*(?:Evidence\s*Card|Deep\s*Reading).*$/gim)];
    for (let i=0; i<markers.length; i++) {
      const stage=markers[i][1].toUpperCase();
      const section=text.slice(markers[i].index,markers[i+1]?.index ?? text.length);
      if(checkSections(section,pack.stages[stage].sections,false))levels.push(stage);
    }
    // Some legacy Butler Notes append several levels into the same child Note.
    // Validate each actual block; L3 alone must never imply L1 or L2.
    const first=text.slice(0,markers[0]?.index ?? text.length);
    const data=first.match(/^\s*DATA_AVAILABILITY\s*[:：]\s*(\w+)\s*$/m);
    if(data && pack.dataValues.includes(data[1]) && (note.tags || []).some(t=>['AI-Generated','AI-Summary'].includes(t)) && /[\p{L}\p{N}]/u.test(first.replace(/^.*DATA_(AVAILABILITY|ACCESSION).*$/gm,'')))levels.push('L1');
    return [...new Set(levels)];
  }
  function legacyStage(note,pack){return ['L3','L2','L1'].find(s=>legacyStages(note,pack).includes(s)) || null;}
  function render(text, record, title) {
    // No raw HTML, images, links or h1/h2 from the model can acquire Butler ownership.
    const body = text.replace(/LF_RECORD_V1/g, 'LF_QUOTED_RECORD_V1').split(/\r?\n/).map(l => /^\s*#{1,6}\s/.test(l) ? '<h3>' + escape(l.replace(/^\s*#{1,6}\s+/,'')) + '</h3>' : '<p>' + escape(l || ' ') + '</p>').join('\n');
    return '<div><h3>[Literature Flow] ' + record.stage + ' · ' + escape(title) + '</h3>' + body + '<p>输入：' + escape(record.source) + '；文本分析，未发送图像。结构校验不等于科学事实验证。</p><p>' + escape('LF_RECORD_V1 ' + JSON.stringify(record)) + '</p></div>';
  }
  class Engine {
    constructor(port, pack, state) {
      this.p = port; this.pack = pack; this.state = state || {schema:1,role:'reader-standby',paused:true,auto:false,baseline:{},tasks:[],enabledAt:null};
      this.busy = false; this.chain = Promise.resolve(); this.alive = true;
    }
    serial(fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
    save() { return this.p.save(this.state); }
    canRun() { return this.alive && this.state.role === 'executor' && !this.state.paused; }
    async controls(changes) {
      return this.serial(async () => {
        Object.assign(this.state,changes);
        if (!this.canRun()) for (const t of this.state.tasks) if (['queued','running','ready_to_commit'].includes(t.status)) { t.generation++; t.status='waiting'; t.reason='paused'; delete t.response; }
        await this.save();
      });
    }
    async baseline(items) {
      return this.serial(async () => {
        this.state.enabledAt = this.p.now();
        this.state.baseline = Object.fromEntries(items.map(i => [i.scope+'/'+i.key, rating(i.extra,i.tags,this.state.tagAdapter)]));
        await this.save();
      });
    }
    async observe(item) {
      return this.serial(async () => {
        if (!this.canRun() || !this.state.auto || !this.state.enabledAt || !item.writable || item.deleted) return;
        const k=item.scope+'/'+item.key, r=rating(item.extra,item.tags,this.state.tagAdapter), old=this.state.baseline[k];
        this.state.baseline[k]=r;
        const changed=old && (old.value !== r.value || old.status !== r.status);
        const newItem=!old && item.dateAdded > this.state.enabledAt + 2000;
        if (changed || newItem) await this._plan(item,target(r),'automatic',false, true);
        await this.save();
      });
    }
    async plan(item, level, mode='manual', regenerate=false) {
      return this.serial(() => this._plan(item,level,mode,regenerate,true));
    }
    async _plan(item, level, mode, regenerate, revive) {
      if (!this.canRun() || !item.writable || item.deleted) return;
      const found=inspect(item,this.pack,this.state.tasks);
      if (mode === 'automatic') for (const t of this.state.tasks) {
        if (t.parent===item.key && t.scope===item.scope && t.mode==='automatic' && stages.indexOf(t.stage)+1>level && !['completed','cancelled'].includes(t.status)) {t.generation++;t.status='cancelled';t.reason='rating-lowered';}
      }
      for (let n=1;n<=level;n++) {
        const stage=stages[n-1], old=found[stage];
        const force=regenerate && n===level;
        if (old.state==='complete' && !force) continue;
        if (!['complete','missing','deleted'].includes(old.state) || old.state==='deleted' && !force) continue;
        let revision=0;
        const same=this.state.tasks.filter(t=>t.scope===item.scope && t.parent===item.key && t.stage===stage);
        if (force) revision=1+Math.max(0,...same.map(t=>t.revision),old.note?.record?.revision||0);
        const logical=[item.scope,item.key,stage,revision].join('/');
        let t=this.state.tasks.find(t=>t.logical===logical);
        if (!t) {
          t={id:this.p.uuid(),logical,scope:item.scope,parent:item.key,itemID:item.id,stage,revision,mode,previous:force && old.note ? [old.note.key] : [],status:'queued',generation:0,attempts:0,contract:this.pack.id};
          this.state.tasks.push(t);
        } else if (revive && ['failed','cancelled'].includes(t.status)) {t.status='queued';t.reason='explicit-retry';t.generation++;t.attempts=0;t.mode=mode;delete t.response;delete t.cachedOnly;}
        if (mode==='manual' && t.mode==='automatic' && !['completed','cancelled'].includes(t.status)) t.mode='manual';
      }
      await this.save();
    }
    async cancel(items) {
      return this.serial(async()=>{
        const keys=new Set(items.map(i=>i.scope+'/'+i.key));
        for(const t of this.state.tasks) if(keys.has(t.scope+'/'+t.parent) && t.status!=='completed') {t.status='cancelled';t.reason='user';t.generation++;}
        await this.save();
      });
    }
    async taskAction(ids, action) {
      if (!['cancel','retry','revalidate'].includes(action)) throw new Error('无效的任务操作');
      return this.serial(async()=>{
        if(['retry','revalidate'].includes(action) && !this.canRun())throw new Error('恢复执行队列后才能重试');
        const selected=new Set(ids);let count=0;
        for(const t of this.state.tasks){
          if(!selected.has(t.id))continue;
          if(action==='cancel' && !['completed','cancelled'].includes(t.status)){
            t.status='cancelled';t.reason='user';t.generation++;count++;
          }else if(action==='revalidate' && t.status==='failed' && t.reason==='output-tags-json' && t.response){
            t.status='queued';t.reason='checking-saved-response';t.cachedOnly=true;t.nextAt=0;count++;
          }else if(action==='retry' && t.status==='failed'){
            t.status='queued';t.reason='explicit-retry';t.generation++;t.attempts=0;t.nextAt=0;delete t.response;delete t.cachedOnly;count++;
          }
        }
        await this.save();return count;
      });
    }
    valid(t,item,generation) {
      return this.canRun() && t.generation===generation && !['cancelled','completed','failed'].includes(t.status) && item && !item.deleted && item.writable && item.key===t.parent && item.scope===t.scope && (t.mode==='manual' || target(rating(item.extra,item.tags,this.state.tagAdapter))>=stages.indexOf(t.stage)+1);
    }
    async step() {
      if (this.busy || !this.canRun()) return false;
      this.busy=true;
      let t, generation;
      try {
        const due=t=>['queued','running','waiting','ready_to_commit'].includes(t.status) && (!t.nextAt || t.nextAt<=this.p.now());
        t=this.state.tasks.find(t=>t.cachedOnly&&due(t)) || this.state.tasks.find(due);
        if(!t)return false;
        generation=t.generation;
        let item=await this.p.get(t.itemID);
        if(!this.valid(t,item,generation)) {t.status='cancelled';t.reason='eligibility-lost';await this.save();return true;}
        let found=inspect(item,this.pack,this.state.tasks);
        const matches=(item.notes||[]).filter(n=>marker(n)?.task===t.id);
        if(matches.length===1) {t.noteKey=matches[0].key;t.status='completed';await this.save();return true;}
        if(matches.length>1) throw new Error('review-duplicate-task-notes');
        if(found[t.stage].state==='complete' && t.revision===0) {t.noteKey=found[t.stage].note.key;t.status='completed';await this.save();return true;}
        if(!['missing','complete'].includes(found[t.stage].state) && !(t.revision>0 && found[t.stage].state==='deleted')) throw new Error('review-'+found[t.stage].state);
        const dependencies=stages.slice(0,stages.indexOf(t.stage));
        if(dependencies.some(s=>found[s].state!=='complete')) throw new Error('waiting-prerequisite');
        if(t.contract!==this.pack.id) throw new Error('review-contract-changed');
        let envelope=t.response ? await this.p.readResponse(t.response) : null;
        if(!envelope) {
          if(t.cachedOnly)throw new Error('review-saved-response-missing');
          const input=await this.p.input(item,t.stage,this.pack);
          if(!input.complete || !input.text) throw new Error('waiting-fulltext');
          if(input.text.length>this.pack.maxInputChars) throw new Error('waiting-fulltext-too-long');
          if(!this.valid(t,await this.p.get(t.itemID),generation)) return true;
          t.status='running';t.attempts++;t.reason='';await this.save();
          const response=await this.p.request(item,t.stage,input,this.pack);
          envelope={response,input,generation,contract:this.pack.id,dependencies:dependencies.map(s=>found[s].note.key)};
          // Persist before validation. A startup recovery also discovers this deterministic path.
          const path=await this.p.writeResponse(t.id,generation,envelope);
          if(!this.valid(t,await this.p.get(t.itemID),generation)) return true;
          t.response=path;await this.save();
        }
        if(envelope.generation!==generation || envelope.contract!==this.pack.id) throw new Error('review-response-generation');
        const output=validate(envelope.response,t.stage,this.pack);
        await this.serial(async()=>{
          item=await this.p.get(t.itemID);
          if(!this.valid(t,item,generation))return;
          found=inspect(item,this.pack,this.state.tasks);
          if((item.notes||[]).some(n=>marker(n)?.task===t.id)) {t.status='completed';t.noteKey=item.notes.find(n=>marker(n)?.task===t.id).key;await this.save();return;}
          if(dependencies.some((s,i)=>found[s].state!=='complete' || found[s].note.key!==envelope.dependencies[i])) throw new Error('review-dependency-changed');
          if(t.revision===0 && found[t.stage].state!=='missing' || t.revision>0 && !['complete','deleted','missing'].includes(found[t.stage].state)) throw new Error('review-concurrent-note');
          const currentInput=await this.p.input(item,t.stage,this.pack);
          if(currentInput.hash!==envelope.input.hash) throw new Error('review-source-changed');
          t.status='ready_to_commit';await this.save();
          const record={stage:t.stage,revision:t.revision,task:t.id,parent:t.parent,scope:t.scope,prompt:this.pack.id,source:envelope.input.mode,created:new Date(this.p.now()).toISOString(),previous:t.previous};
          t.noteKey=await this.p.commit(item,render(output.text,record,item.title),['AI:'+t.stage,...output.tags],()=>this.valid(t,item,generation));
          t.status='completed';t.reason='';await this.save();
        });
        return true;
      } catch(e) {
        if(!t)throw e;
        if(t.generation!==generation || ['cancelled','completed'].includes(t.status) || !this.canRun()) return true;
        const reason=e.code || e.message || 'internal-error';
        // Only controlled reason codes are persisted; never server bodies or credentials.
        t.reason=/^(waiting|review|output|network|http)-[a-zA-Z0-9-]+/.exec(reason)?.[0] || 'internal-error';
        const retry=/^(network-|http-(429|5\d\d))/.test(t.reason);
        t.status=/^(waiting|review)-/.test(t.reason) || retry && t.attempts<3 ? 'waiting' : 'failed';
        t.nextAt=this.p.now()+(retry ? Math.min(300000,10000*2**t.attempts) : 30000);
        await this.save();return true;
      } finally {this.busy=false;}
    }
    async recover() {
      for (const t of this.state.tasks) {
        if (['completed','cancelled','failed'].includes(t.status))continue;
        const path=await this.p.findResponse(t.id,t.generation);
        if(path)t.response=path;
        if(t.status==='running')t.status='queued';
      }
      await this.save();
    }
  }
  return {stages,escape,visible,rating,target,validate,marker,inspect,legacyStage,legacyStages,render,Engine,checkSections};
})();
if (typeof module !== 'undefined') module.exports = LFCore;
