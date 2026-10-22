/* SPDX-License-Identifier: AGPL-3.0-or-later */
const args=window.arguments[0],api=args.api,$=id=>document.getElementById(id);
let latest,queueState,queueBusy=false,queueTimer,queueSignature='';
const selectedTasks=new Set();
const make=tag=>document.createElementNS('http://www.w3.org/1999/xhtml',tag);
const taskLabels={queued:'排队中',running:'正在处理',waiting:'等待中',ready_to_commit:'准备保存',completed:'已完成',failed:'失败',cancelled:'已取消'};
const reasonLabels={'waiting-pdf':'缺少 PDF','waiting-local-pdf':'PDF 尚未下载','waiting-fulltext-coverage':'全文索引不完整','waiting-fulltext-cache':'尚无全文缓存','waiting-stale-index':'全文索引需更新','waiting-main-pdf-selection':'需选择主文 PDF','waiting-prerequisite':'等待前一级结果','waiting-fulltext-too-long':'全文超出长度限制',paused:'队列已暂停',user:'已由你取消','rating-lowered':'评分降低','automation-disabled':'自动化已关闭','explicit-retry':'等待重试'};
const labels={complete:'完成',missing:'缺失',review:'待核对',conflict:'冲突',deleted:'结果已删除'};
function message(text){$('message').textContent=text;}
async function refresh(){
  latest=await api.view(args,$('recursive').checked);
  $('items').replaceChildren();
  for(const i of latest.items){const tr=make('tr');for(const text of [i.title,`${i.rating.value??'未评分'} (${i.rating.source}; ${i.rating.status})`,['L1','L2','L3'].map(s=>s+': '+labels[i.levels[s].state]+(i.levels[s].shared?' / 旧 Note':'')).join('\n'),typeof i.input==='string'?i.input:JSON.stringify(i.input)]){const td=make('td');td.textContent=text;tr.appendChild(td);}$('items').appendChild(tr);}
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
  try{const count=await api.taskAction(ids,action);for(const id of ids)selectedTasks.delete(id);queueSignature='';message(`${action==='cancel'?'已取消':'已重新排队'} ${count} 个任务。已有笔记保留。`);await refreshQueue();}catch(e){message(e.message||String(e));}
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
    const actions=cell();for(const action of ['cancel','retry']){if(action==='retry'&&t.status!=='failed'||action==='cancel'&&['completed','cancelled'].includes(t.status))continue;const b=make('button');b.textContent=action==='cancel'?'取消':'重试';b.disabled=action==='retry'&&(queueState.paused||queueState.role!=='executor');b.addEventListener('click',async()=>{b.disabled=true;await operateTasks([t.id],action);b.disabled=false;});actions.appendChild(b);}if(!actions.childNodes.length)actions.textContent='—';
    $('tasks').appendChild(tr);
  }
}
async function refreshQueue(){
  if(queueBusy)return;queueBusy=true;
  try{queueState=await api.queue();const roles={executor:'执行端','reader-standby':'阅读 / 待机',disabled:'停用'};
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
button('resume',async()=>{await api.resume();message('队列已恢复');});
button('pause',async()=>{await api.pause();message('已暂停，旧在途响应不得写回');});
button('auto',async()=>{if(confirm('确认初始同步已完成、只有本机负责自动化？本操作只建立已有条目的基线，之后才处理新增及实际评分变化。')){await api.enableAuto();message('基线已建立，自动化已开启');}});
button('autoOff',async()=>{await api.disableAuto();message('自动化已关闭');});
for(const action of ['fill','repair','retry','cancel','regenerate','protect'])button(action,async()=>{
  await refresh();if(confirm(preview(action))){await api.action(args,$('recursive').checked,action,Number($('level').value));message('操作已提交；请查看队列和条目状态。');}
});
button('bind',async()=>{if(confirm('确认该全文来自所选主文 PDF，并且正文内容完整？仅发送文字，不发送图像。')){await api.bind(args,$('pdfKey').value.trim(),$('markdownKey').value.trim());message('来源绑定已保存');}});
button('exportConfig',()=>api.exportConfig(window));
button('importConfig',async()=>{if(confirm('导入后重置为待机，清除本机端点、密钥与来源绑定。继续？')){await api.importConfig(window);await loadSettings();message('已导入并重置为待机');}});
button('report',()=>api.exportReport(window,args,$('recursive').checked));
async function loadSettings(){await refresh();$('role').value=latest.role;$('baseURL').value=latest.config.baseURL;$('model').value=latest.config.model;}
loadSettings().then(()=>{queueTimer=setInterval(()=>refreshQueue().catch(e=>message(e.message)),3000);}).catch(e=>message(e.message));
window.addEventListener('unload',()=>clearInterval(queueTimer));
