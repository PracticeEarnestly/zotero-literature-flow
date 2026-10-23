# 按 AI 生成时间合并笔记 · 0.4.6

Literature Flow 0.4.6 将“同一层级保留最新结果”的判断改为优先读取 AI 结果的真实生成时间，并在执行合并前显示可核对的候选表格。正式合并仍按 L1 概览 → L2 证据卡 → L3 深读写入唯一综合笔记；只有点击“确认合并并移入回收站”后才会写入。

## 版本选择规则

同一文献、同一层级存在多个候选时，排序依次使用：

1. Literature Flow 私有记录中的 `created`；
2. AI Butler 笔记元数据中的 `generatedAt`；
3. 笔记正文可解析的“生成时间”；
4. Zotero `dateModified`；
5. Zotero `dateAdded`；
6. 条目 ID 与 key，保证相同输入得到固定结果。

综合笔记已经包含某一级时，该级继续使用原来源笔记的生成时间参与比较。后来查看、同步或修改综合笔记，不会让旧内容被误判为新的 AI 结果。

## 合并预览

点击“整合并清理分散笔记…”后，界面先显示文献、层级、候选笔记 key、用于排序的时间、选择依据和处理结果。绿色行是准备采用的版本。关闭预览不会修改笔记；预览本身不请求模型。

只有明确识别为 Literature Flow 或 AI Butler 生成的 L1–L3 笔记才进入计划。正式执行前会再次按同一规则计算，并完成私有备份；所有明确识别的分散来源笔记随后移入 Zotero 回收站。普通笔记不参与，也不删除。

## P520 实机验收

2026-10-23 在 P520 Zotero 9.0.1 中安装 0.4.6，并与原版 AI Butler 5.1.0 共存验证。目标文献为 *Oral exposure to PET microplastics induces the pancreatic immune response and oxidative stress in immature pigs*。

- 只读预览识别到 1 条 L2 来源笔记 `MF8JE3WH`。
- 排序依据为“AI 生成时间”，读取值为 2026-09-23 14:51:20（北京时间）。
- 界面表格显示该行将“采用内容；来源笔记移入回收站”。本次只做预览，没有点击执行合并。
- 预览前后两条现有笔记的正文 SHA-256、标签、修改时间均逐项一致。
- 自动化保持开启且未暂停；历史基线保持 1,926 篇；任务保持 6 项完成和 1 项既有失败；模型尝试数保持 7；活动任务为 0。
- 临时验证驱动验收后已卸载。最终激活插件只有 Literature Flow 0.4.6 与原版 AI Butler 5.1.0。
- P520 已安装 XPI 与交付包 SHA-256 均为 `75137a9b09912be0e160fc24a1f6c01aa811841919048303dcff36b417c76f82`。

机器可读摘要见 [generation-aware-merge-validation.json](generation-aware-merge-validation.json)。完整备份及带条目正文哈希的证据保留在 P520 私有目录 `/home/xiqing/literature-flow-migration/20261023-generation-aware-merge/`，不提交公开仓库。

## 自动化验证

84 项 Node 测试通过，新增覆盖：

- AI 生成时间优先于更晚的 Zotero 修改时间；
- Literature Flow 与 AI Butler 两类时间元数据；
- 综合笔记沿用原来源时间，避免自身保存时间抬高排序；
- 预览返回全部候选且每一级恰好选择一条；
- 预览为只读，不增加数据库保存。

语法检查、XHTML、manifest、提示词哈希和 XPI 完整性检查均通过。
