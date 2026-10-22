/* SPDX-License-Identifier: AGPL-3.0-or-later */
const args=window.arguments[0],api=args.api,$=id=>document.getElementById(id);
let latest;
const labels={complete:'完成',missing:'缺失',review:'待核对',conflict:'冲突',deleted:'结果已删除'};
function message(text){$('message').textContent=text;}
async function refresh(){
  latest=await api.view(args,$('recursive').checked);
  $('state').textContent=`角色：${latest.role} · ${latest.paused?'已暂停':'运行中'} · 自动化：${latest.auto?'开启':'关闭'} · 基线：${latest.baseline?'已建立':'未建立'} · ${latest.contract}`;
  $('items').replaceChildren();
  for(const i of latest.items){const tr=document.createElement('tr');for(const text of [i.title,`${i.rating.value??'未评分'} (${i.rating.source}; ${i.rating.status})`,['L1','L2','L3'].map(s=>s+': '+labels[i.levels[s].state]+(i.levels[s].shared?' / 旧 Note':'')).join('\n'),typeof i.input==='string'?i.input:JSON.stringify(i.input)]){const td=document.createElement('td');td.textContent=text;tr.appendChild(td);}$('items').appendChild(tr);}
  $('summary').textContent=`选择 ${latest.items.length} 篇。只读预览不会请求模型或改写标签。补齐按有效 Note 判断，待核对条目不会自动重算。`;
  $('tasks').textContent=latest.tasks.length?JSON.stringify(latest.tasks,null,2):'暂无任务';
  $('attachments').textContent=JSON.stringify(await api.attachments(args),null,2);
}
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
loadSettings().catch(e=>message(e.message));
