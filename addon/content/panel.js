/* SPDX-License-Identifier: AGPL-3.0-or-later */
const args=window.arguments[0],api=args.api,$=id=>document.getElementById(id),initialAction=args.initialAction||'overview';
let latest,queueState,queueBusy=false,queueTimer,queueSignature='',automationBusy=false,mergePreview,mergeBusy=false;
const selectedTasks=new Set();
const make=tag=>document.createElementNS('http://www.w3.org/1999/xhtml',tag);
const taskLabels={queued:'排队中',running:'正在处理',waiting:'等待中',ready_to_commit:'准备保存',completed:'已完成',failed:'失败',cancelled:'已取消'};
const reasonLabels={'review-combined-note-format':'综合笔记结构已改变，请先核对','review-note-changed':'笔记同时被修改，已停止写入','review-conflicting-notes':'存在重复或冲突的笔记，请核对','output-tags-json':'标签格式无法解析；可先检查已存结果','checking-saved-response':'正在检查已存结果（不调用模型）','review-saved-response-missing':'已存结果缺失，需核对后重新请求','waiting-pdf':'缺少 PDF','waiting-local-pdf':'PDF 尚未下载','waiting-fulltext-coverage':'全文索引不完整','waiting-fulltext-cache':'尚无全文缓存','waiting-stale-index':'全文索引需更新','waiting-main-pdf-selection':'需选择主文 PDF','waiting-prerequisite':'等待前一级结果','waiting-fulltext-too-long':'全文超出长度限制',paused:'队列已暂停',user:'已由你取消','rating-lowered':'评分降低','automation-disabled':'自动化已关闭','explicit-retry':'等待重试'};
const labels={complete:'完成',missing:'缺失',review:'待核对',conflict:'冲突',deleted:'结果已删除'};
const inputModes={PDF_TEXT:'Zotero PDF 全文',MINERU_TEXT:'MinerU 全文'};
function inputLabel(input){
  if(typeof input==='string')return reasonLabels[input]||input;
  if(!input||typeof input!=='object')return '输入状态未知';
  const parts=[inputModes[input.mode]||input.mode||'文本输入'];
  if(Number.isFinite(input.characters))parts.push(`${input.characters.toLocaleString('zh-CN')} 字符`);
  const coverage=input.coverage;
  if(coverage&&typeof coverage==='object'&&Number.isFinite(coverage.indexedPages)&&Number.isFinite(coverage.total))parts.push(`已索引 ${coverage.indexedPages}/${coverage.total} 页`);
  else if(coverage==='user-confirmed')parts.push('已人工确认完整');
  return parts.join(' · ');
}
function message(text){$('message').textContent=text;}
const mergePhaseLabels={start:'正在准备合并',checking:'正在核对最新笔记',backup:'正在保存私有备份',write:'正在写入综合笔记',trash:'正在将来源笔记移入回收站',complete:'本篇处理完成',done:'全部合并完成'};
const mergePhaseStep={start:0,checking:0,backup:1,write:2,trash:3,complete:4,done:4};
function mergeProgress(progress,error=false){
  const box=$('mergeProgress'),bar=$('mergeProgressBar'),total=progress.total||mergePreview?.papers||1,current=progress.current||0;
  box.hidden=false;box.classList.toggle('error',error);bar.max=Math.max(1,total*4);bar.value=progress.phase==='done'?bar.max:Math.min(bar.max,Math.max(0,(Math.max(1,current)-1)*4+(mergePhaseStep[progress.phase]||0)));
  $('mergeProgressLabel').textContent=error?'合并已停止':mergePhaseLabels[progress.phase]||'正在处理';
  $('mergeProgressCount').textContent=error?String(progress.error||'未知错误'):`${current||0}/${total}${progress.title?' · '+progress.title:''}`;
}
function dateLabel(value){if(!value)return '无日期';const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString('zh-CN',{hour12:false});}
function renderMergePreview(preview){
  mergePreview=preview;$('mergeApply').textContent='确认合并并移入回收站';$('mergePreviewRows').replaceChildren();
  for(const row of preview.rows)for(const selection of row.selections)for(const candidate of selection.candidates){
    const tr=make('tr');if(candidate.selected)tr.className='selected';
    const result=candidate.current?(candidate.selected?'保留当前综合笔记':'综合笔记中本级将被替换'):(candidate.selected?'采用内容；来源笔记移入回收站':'旧版本；来源笔记移入回收站');
    for(const value of [row.title,selection.stage,candidate.key,dateLabel(candidate.at),candidate.basis,result]){const td=make('td');td.textContent=value;tr.appendChild(td);}
    $('mergePreviewRows').appendChild(tr);
  }
  $('mergePreviewSummary').textContent=`${preview.papers} 篇文献 · ${preview.sources} 条明确识别的来源笔记 · ${preview.duplicateStageGroups} 组同级重复。绿色行是每一级将采用的版本。合并不调用模型。`;
  $('mergeProgress').hidden=true;$('mergePreviewSection').hidden=false;$('mergePreviewSection').scrollIntoView({behavior:'smooth'});
}
async function openMergePreview(){
  $('mergePreviewSection').hidden=false;$('mergeProgress').hidden=false;$('mergeProgress').classList.remove('error');$('mergeProgressBar').removeAttribute('value');$('mergeProgressLabel').textContent='正在扫描可合并笔记…';$('mergeProgressCount').textContent='不会请求模型或修改笔记';$('mergeApply').disabled=true;
  message('正在生成合并预览，请稍候…');
  try{const p=await api.consolidationPreview(args,$('recursive').checked);if(!p.sources)throw new Error('当前范围没有明确由 AI Butler / Literature Flow 生成的可整合笔记');renderMergePreview(p);message('请核对下方版本选择依据，再确认合并。');}
  catch(e){mergePreview=null;mergeProgress({phase:'error',current:0,total:1,error:e.message||String(e)},true);message(e.message||String(e));}
  finally{$('mergeApply').disabled=!mergePreview?.sources;}
}
async function refresh(){
  latest=await api.view(args,$('recursive').checked);
  $('items').replaceChildren();
  for(const i of latest.items){const tr=make('tr');for(const text of [i.title,`${i.rating.value??'未评分'} (${i.rating.source}; ${i.rating.status})`,['L1','L2','L3'].map(s=>s+': '+labels[i.levels[s].state]+(i.levels[s].shared?' / 旧 Note':'')).join('\n'),inputLabel(i.input)]){const td=make('td');td.textContent=text;tr.appendChild(td);}$('items').appendChild(tr);}
  $('summary').textContent=`选择 ${latest.items.length} 篇。只读预览不会请求模型或改写标签。补齐按有效 Note 判断，待核对条目不会自动重算。`;
  await refreshQueue();
  $('attachments').textContent=JSON.stringify(await api.attachments(args),null,2);
}
function visibleTasks(){const f=$('taskFilter').value,q=$('taskSearch').value.trim().toLowerCase();return (queueState?.tasks||[]).filter(t=>(f==='all'||f==='active'&&!['completed','cancelled'].includes(t.status)||t.status===f)&&(!q||(t.title+' '+t.parent).toLowerCase().includes(q)));}
function selectionState(){
  const rows=visibleTasks().filter(t=>!['completed','cancelled'].includes(t.status)),ids=new Set(rows.map(t=>t.id));
  for(const id of selectedTasks)if(!ids.has(id))selectedTasks.delete(id);
  $('selectTasks').checked=rows.length>0&&rows.every(t=>selectedTasks.has(t.id));$('selectTasks').indeterminate=selectedTasks.size>0&&!$('selectTasks').checked;
  $('selectTasks').disabled=!rows.length;
  $('cancelTasks').disabled=!selectedTasks.size;
  $('retryTasks').disabled=queueState?.paused||queueState?.role!=='executor'||!rows.some(t=>selectedTasks.has(t.id)&&t.status==='failed');
  $('taskCount').textContent=`显示 ${visibleTasks().length} / ${queueState?.tasks.length||0} 项 · 已勾选 ${selectedTasks.size} 项`;
}
async function operateTasks(ids,action){
  if(action==='retry'&&!confirm(`重试 ${ids.length} 个失败任务？可能重新调用模型，已有结果会再次核对。`))return;
  try{const count=await api.taskAction(ids,action);for(const id of ids)selectedTasks.delete(id);queueSignature='';message(`${action==='cancel'?'已取消':action==='revalidate'?'已排队检查已存结果（不调用模型）':'已重新排队'} ${count} 个任务。已有笔记保留。`);await refreshQueue();}catch(e){message(e.message||String(e));}
}
function renderQueue(){
  const rows=visibleTasks();selectionState();$('tasks').replaceChildren();
  if(!rows.length){const tr=make('tr'),td=make('td');td.colSpan=8;td.className='empty';td.textContent=queueState?.tasks.length?'没有匹配的任务':'暂无任务。新任务将在这里显示，历史结果不会批量重跑。';tr.appendChild(td);$('tasks').appendChild(tr);return;}
  for(const t of rows){
    const tr=make('tr');const cell=text=>{const td=make('td');if(text!==undefined)td.textContent=text;tr.appendChild(td);return td;};
    const cb=make('input');cb.type='checkbox';cb.checked=selectedTasks.has(t.id);cb.disabled=['completed','cancelled'].includes(t.status);cb.setAttribute('aria-label','选择 '+t.title+' '+t.stage);cb.addEventListener('change',()=>{if(cb.checked)selectedTasks.add(t.id);else selectedTasks.delete(t.id);selectionState();});cell().appendChild(cb);
    const title=cell(t.title),key=make('span');key.className='task-key';key.textContent=t.parent;title.appendChild(key);cell(t.stage);
    const badge=make('span');badge.className='badge '+t.status;badge.textContent=taskLabels[t.status]||t.status;cell().appendChild(badge);
    cell(t.mode==='automatic'?'自动':'手动');cell(String(t.attempts||0));cell(reasonLabels[t.reason]||t.reason||'—');
    const actions=cell();for(const action of ['cancel','revalidate','retry']){if(action==='revalidate'&&!t.canRevalidate||action==='retry'&&t.status!=='failed'||action==='cancel'&&['completed','cancelled'].includes(t.status))continue;const b=make('button');b.textContent=action==='cancel'?'取消':action==='revalidate'?'检查已存结果':'重新请求';b.disabled=action!=='cancel'&&(queueState.paused||queueState.role!=='executor');b.addEventListener('click',async()=>{b.disabled=true;await operateTasks([t.id],action);b.disabled=false;});actions.appendChild(b);}if(!actions.childNodes.length)actions.textContent='—';
    $('tasks').appendChild(tr);
  }
}
function renderAutomation(){
  const q=queueState,active=q.role==='executor'&&q.auto&&!q.paused;
  $('automationStatus').textContent=active?'自动处理已开启':q.auto&&q.paused?'自动处理已暂停':q.role!=='executor'?'本机仅阅读，未开启自动处理':'自动处理未开启';
  $('automationHint').textContent=active?'Zotero 打开时运行。暂停会同时暂停手动任务。':q.auto&&q.paused?'点击继续即可恢复，原有任务与历史记录保留。':!q.connectionReady?'首次使用：展开高级设置，填写模型连接。':'点击开启，由本机负责后续文献处理。';
  $('automationToggle').textContent=active?'暂停自动处理':!q.connectionReady?'设置并开启':q.auto&&q.paused?'继续自动处理':'开启自动处理';
  $('automationToggle').disabled=automationBusy;
  $('automationHistory').textContent=q.baseline?`历史保护已启用${Number.isInteger(q.baselineCount)?' · 已记录 '+q.baselineCount+' 篇文献':''}。继续运行不会重建历史记录，已有结果不会重复生成。`:'首次开启只记录当前文献，不批量处理历史文献。';
  const count=status=>q.tasks.filter(t=>status.includes(t.status)).length;
  $('automationCounts').textContent=`处理中 ${count(['running','ready_to_commit'])} · 排队 / 等待 ${count(['queued','waiting'])} · 失败 ${count(['failed'])}`;
}
function confirmExecutor(){return queueState.role==='executor'||confirm('将本机设为负责处理文献的唯一设备？请确认其他设备及旧方案的自动扫描已暂停，初始同步已完成。');}
async function startAutomation(){
  if(!confirmExecutor())return;
  await api.startAutomation({activateExecutor:true});$('role').value='executor';
  message('自动处理已开启。已有历史记录保留，只补齐符合条件的缺失结果。');
}
$('automationToggle').addEventListener('click',async()=>{
  if(automationBusy)return;automationBusy=true;$('automationToggle').disabled=true;
  try{
    await refreshQueue();
    if(queueState.role==='executor'&&queueState.auto&&!queueState.paused){await api.pause();message('已暂停。已有任务和笔记保留；点击继续可恢复。');}
    else if(!queueState.connectionReady){$('advancedSettings').open=true;$('baseURL').focus();}
    else await startAutomation();
  }catch(e){message(e.message||String(e));}
  finally{automationBusy=false;await refreshQueue();}
});
$('showTasks').addEventListener('click',()=>{$('queueSection').scrollIntoView({behavior:'smooth'});$('taskFilter').focus({preventScroll:true});});
async function refreshQueue(){
  if(queueBusy)return;queueBusy=true;
  try{queueState=await api.queue();renderAutomation();const roles={executor:'执行端','reader-standby':'阅读 / 待机',disabled:'停用'};
    $('state').textContent=`角色：${roles[queueState.role]} · ${queueState.paused?'已暂停':'运行中'} · 自动化：${queueState.auto?'开启':'关闭'} · 历史基线：${queueState.baseline?'已建立':'未建立'}`;
    const signature=JSON.stringify(queueState);if(signature!==queueSignature){queueSignature=signature;renderQueue();}else selectionState();
  }finally{queueBusy=false;}
}
$('taskFilter').addEventListener('change',renderQueue);$('taskSearch').addEventListener('input',renderQueue);
$('selectTasks').addEventListener('change',()=>{for(const t of visibleTasks())if(!['completed','cancelled'].includes(t.status)){if($('selectTasks').checked)selectedTasks.add(t.id);else selectedTasks.delete(t.id);}renderQueue();});
$('queueRefresh').addEventListener('click',()=>refreshQueue().catch(e=>message(e.message)));
$('cancelTasks').addEventListener('click',()=>operateTasks([...selectedTasks],'cancel'));
$('retryTasks').addEventListener('click',()=>operateTasks((queueState?.tasks||[]).filter(t=>selectedTasks.has(t.id)&&t.status==='failed').map(t=>t.id),'retry'));
function button(id,fn){$(id).addEventListener('click',async()=>{const el=$(id);el.disabled=true;try{await fn();await refresh();}catch(e){message(e.message||String(e));}finally{el.disabled=false;}});}
function preview(action){
  const level=Number($('level').value);
  if(action==='regenerate' && !level)throw new Error('重新生成前请选择 L1、L2 或 L3');
  const eligible=latest.items.filter(i=>i.writable);
  let planned=0,review=0,waiting=0,repair=0,skip=0;
  for(const i of eligible){
    const goal=level || (i.rating.status==='conflict'?0:i.rating.value===5?3:i.rating.value>=2?2:1);
    const levels=['L1','L2','L3'].slice(0,goal).map(s=>i.levels[s].state);
    if(levels.some(s=>['review','conflict','deleted'].includes(s))){review++;continue;}
    if(levels.includes('complete'))repair++;
    if(action==='regenerate' || levels.includes('missing')){if(typeof i.input==='string')waiting++;else planned++;}else skip++;
  }
  return `操作：${action}\n范围：${latest.items.length} 篇，其中可写 ${eligible.length} 篇\n级别：${level?'L'+level:'当前评分'}\n预计可推理 ${planned} 篇，等待输入 ${waiting} 篇，待核对 ${review} 篇，已有结果 ${skip} 篇；可核对完成标签 ${repair} 篇。\n修复标签与保护副本均不调用模型。最终执行前会再次核对。\n`+eligible.map(i=>i.title).slice(0,20).join('\n')+'\n\n确认执行？';
}
button('refresh',async()=>message('只读检查完成'));
button('save',async()=>{await api.configure({role:$('role').value,baseURL:$('baseURL').value,model:$('model').value},$('token').value);$('token').value='';message('设置已保存，队列已暂停。');});
button('probe',async()=>message(JSON.stringify(await api.probe(),null,2)));
button('resume',async()=>{if(queueState.auto)throw new Error('自动处理已开启，请使用顶部的继续按钮；如需只处理手动任务，请先关闭自动触发。');await api.resume();message('手动队列已恢复');});
button('pause',async()=>{await api.pause();message('已暂停，旧在途响应不得写回');});
button('saveStart',async()=>{
  if(automationBusy)return;automationBusy=true;
  try{
    await refreshQueue();if(!confirmExecutor())return;
    if(!$('baseURL').value.trim()||!$('model').value.trim())throw new Error('请填写模型服务地址和模型名称');
    await api.configure({role:'executor',baseURL:$('baseURL').value,model:$('model').value},$('token').value);
    $('token').value='';$('role').value='executor';
    await api.startAutomation();$('advancedSettings').open=false;
    message('连接已保存，自动处理已开启。已有历史记录保留。');
  }finally{automationBusy=false;await refreshQueue();}
});
button('autoOff',async()=>{await api.disableAuto();message('自动化已关闭');});
async function runWorkflowAction(action,refreshFirst=true){
  const el=$(action);el.disabled=true;
  try{if(refreshFirst)await refresh();if(confirm(preview(action))){message('正在提交任务…');await api.action(args,$('recursive').checked,action,Number($('level').value));message('操作已提交；请查看队列和条目状态。');await refreshQueue();}}
  catch(e){message(e.message||String(e));}finally{el.disabled=false;}
}
for(const action of ['fill','repair','retry','cancel','regenerate','protect'])$(action).addEventListener('click',()=>runWorkflowAction(action));
button('bind',async()=>{if(confirm('确认该全文来自所选主文 PDF，并且正文内容完整？仅发送文字，不发送图像。')){await api.bind(args,$('pdfKey').value.trim(),$('markdownKey').value.trim());message('来源绑定已保存');}});
button('exportConfig',()=>api.exportConfig(window));
button('importConfig',async()=>{if(confirm('导入后重置为待机，清除本机端点、密钥与来源绑定。继续？')){await api.importConfig(window);await loadSettings();message('已导入并重置为待机');}});
$('consolidate').addEventListener('click',()=>openMergePreview());
$('mergeApply').addEventListener('click',async()=>{
  if(mergeBusy)return;if(!mergePreview?.sources){message('请先生成合并预览');return;}
  mergeBusy=true;$('mergeApply').disabled=true;$('mergeClose').disabled=true;document.body.setAttribute('aria-busy','true');
  const planned={selection:mergePreview.rows.map(r=>r.id),collections:[]};mergeProgress({phase:'start',current:0,total:mergePreview.papers,title:''});message('合并已开始。正在核对笔记并创建恢复备份…');
  try{
    const r=await api.consolidate(planned,false,{latestOnly:true,deleteSources:true,onProgress:mergeProgress});
    mergeProgress({phase:'done',current:r.length,total:mergePreview.papers,title:''});
    $('mergeApply').textContent='合并完成';mergePreview=null;message(`已整合 ${r.length} 篇，${r.reduce((n,x)=>n+x.deleted,0)} 条明确识别的原分散笔记已移入回收站。私有备份已完成，可从 Zotero 回收站或备份恢复。`);
  }catch(e){mergeProgress({phase:'error',current:0,total:mergePreview?.papers||1,error:e.message||String(e)},true);message('合并停止：'+(e.message||String(e)));$('mergeApply').disabled=false;}
  finally{mergeBusy=false;$('mergeClose').disabled=false;document.body.removeAttribute('aria-busy');}
});
$('mergeClose').addEventListener('click',()=>{if(mergeBusy)return;$('mergePreviewSection').hidden=true;mergePreview=null;$('mergeApply').textContent='确认合并并移入回收站';message('已关闭合并预览，未修改笔记。');});
button('exportMarkdown',()=>api.exportMarkdown(window,args,$('recursive').checked));
button('report',()=>api.exportReport(window,args,$('recursive').checked));
async function loadSettings(){
  if(initialAction==='merge'){
    latest=await api.settings();$('role').value=latest.role;$('baseURL').value=latest.config.baseURL;$('model').value=latest.config.model;await refreshQueue();await openMergePreview();return;
  }
  await refresh();$('role').value=latest.role;$('baseURL').value=latest.config.baseURL;$('model').value=latest.config.model;
  const levels={'fill-rating':'0','fill-l1':'1','fill-l2':'2','fill-l3':'3'};
  if(initialAction in levels){$('level').value=levels[initialAction];await runWorkflowAction('fill',false);}else if(initialAction==='check')message('本分类只读检查完成，没有提交任务。');
}
loadSettings().then(()=>{queueTimer=setInterval(()=>refreshQueue().catch(e=>message(e.message)),3000);}).catch(e=>message(e.message));
window.addEventListener('unload',()=>clearInterval(queueTimer));
