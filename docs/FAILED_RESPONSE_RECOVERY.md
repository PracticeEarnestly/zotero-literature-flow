# 已保存失败响应恢复 · 0.4.9

## 问题

P520 自动队列追平后保留两条结构校验失败：

- `Host–microbial interactions in idiopathic pulmonary fibrosis` 的 L3 已包含完整章节，但标题 `Statistical and Methodological App appraisal` 多出一个 `App`。
- `The 2025 British Society for Rheumatology management recommendations for ANCA-associated vasculitis` 的 L1 最终答案完整，但兼容接口只返回了结尾 `</think>`，导致前置推理草稿和最终答案同时进入响应，并出现多组标签边界。

两份响应的 `finish_reason` 均为 `stop`，PDF 输入哈希仍与当前全文一致。插件此前按严格结构拒绝写入，因此没有产生不完整笔记。

## 修复

0.4.9 增加两项定向处理：

- 当响应只有结尾推理标签时，只丢弃该标签以前的前缀，再对最终答案执行原有的完整结构、标签 JSON、数据可用性和来源哈希校验。
- 只修正已经观察到的完整 L3 标题拼写 `Statistical and Methodological App appraisal`；其余必需章节和正文仍按原合同严格校验。

任务表的“检查已存结果”现在适用于所有带已保存响应的 `output-*` 失败。复检只读取原响应，不调用模型；若修复规则仍不足，任务会继续保持失败，不会自动退回模型重算。

## P520 验证

- 部署前备份：`/home/xiqing/literature-flow-migration/20261026-075945-failed-response-recovery`
- 两份真实保存响应均通过 0.4.9 离线复检。
- 本地测试 92/92 通过，语法检查和确定性 XPI 构建通过。
- XPI：`dist/zotero-literature-flow-0.4.9.xpi`
- SHA-256：`e448238d644338fd377696c481b28e512a0bcf1d556fcef2f6af6fdec65d15b4`
- P520 原生复检恢复 2 条任务；总模型调用保持 107，历史基线保持 2,042。
- L3 写回原综合笔记 `7BQ9L2L9`，该笔记继续包含 L1、L2、L3。
- L1 写入综合笔记 `8WBLVDGP`，带 `AI-Summary`、`LF:Combined` 和 `LF:Note`，可由原版 AI Butler 预览。
- 重启后任务为 107 完成、2 等待 PDF、14 已取消、0 失败；自动化仍为 `executor / auto=true / paused=false`。
- 临时验证驱动及控制目录已移除。Literature Flow 0.4.9 与原版 AI Butler 5.1.0.4 同时启用。
