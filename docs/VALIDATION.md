# 验收记录 · 2026-10-22

最新 0.4.4 按层级择新、整合和来源清理见 [LATEST_STAGE_MERGE.md](LATEST_STAGE_MERGE.md)。0.4.1 原版 AI 管家预览兼容见 [BUTLER_PREVIEW.md](BUTLER_PREVIEW.md)。0.4.0 合并笔记、Markdown 验证见 [COMBINED_NOTES.md](COMBINED_NOTES.md)。以下为历史版本记录。

以下记录 0.3.1 在 P520 Zotero 9.0.1 独立 profile 的模型实测，以及和未经修改的上游 AI Butler 5.1.0 共存测试。0.3.3 正式迁移和新增历史审计见 [P520_PRODUCTION.md](P520_PRODUCTION.md)。隔离测试详情见 [P520_TEST.md](P520_TEST.md)。

## 本地验证

- 46 项 Node 自动化测试通过：核心状态机、冻结契约、模拟 Zotero 数据层、文件、凭据和菜单适配。
- 新增真实合并旧 Note 的结构回归；适配测试使用会拒绝 JSON.stringify 的数据库代理行，覆盖实机发现的问题。
- JavaScript 语法、XPI ZIP 完整性、manifest、XHTML 和三份提示词 SHA-256 校验通过。
- 同一源码可复现构建；包内没有临时测试驱动、生产笔记、数据库、API key 或私有端点。
- 测试原始输出见 [test-results.tap](test-results.tap)。

## 已取得的实机证据

- AddonManager 确认官方 Butler 5.1.0 和 LF 0.3.1 同时 active；两者 ID 不同。
- 新 LF 默认 reader-standby、paused、自动化关闭。原生产队列没有导入。
- 工作流面板显示真实模型配置、选择、评级和全文覆盖；实际 `/models` 返回所用服务名。
- 真实 PDF 经 Zotero 索引，读取 10/10 页、41,911 字符；没有退回摘要。
- L1、L2、L3 已取得真实模型响应。L3 的嵌套标题误判在本轮修复，并使用保存的响应重新校验。各级校验、落盘和普通子 Note 写回分别核对。完成标签与 Note 一致，具有 LF 标记，没有 Butler 归属标签或 h1/h2。
- 重复补齐、父条目与附件混选不增加既有任务。
- 真实旧合并 Note 同时识别 L1/L2/L3；标签修复后正文不变，没有触发生成。创建保护副本后各级转为独立 LF Note，原文不变，重复保护不会重复复制。
- 实际 Notifier：5 星创建三级任务；降为 1 星取消 L2/L3；新增条目连续保存只创建一个 L1。建立基线附近的条目保守视为历史，不批量重算。
- 原生产数据库 SHA-256 与关闭后备份一致。旧 XPI 已可逆移走，防止原队列重启。

## 最终实机结果

| 检查 | 结果 |
|---|---|
| L1 / L2 / L3 真实响应 | 均为 `finish_reason=stop`，分别 636 / 7,233 / 7,755 字符 |
| Zotero 写回 | 三篇独立 LF Note，AI:L1/L2/L3 完成标签一致 |
| 官方 Butler 手动摘要 | 同一文献的独立副本上新增 AI-Summary Note；已有两篇 LF Note 原文逐字不变 |
| 缺 PDF | waiting-pdf，attempts=0；测试后取消 |
| 正常重启 | 三篇 Note 不变，三级仍 complete，菜单仅一份，没有重新请求 |
| 测试收尾 | LF reader-standby、paused、auto=false；临时测试驱动已卸载 |
| 原库保护 | 数据库与关闭后备份 SHA-256 相同；86 条旧队列原样保留；旧 XPI 可逆暂停 |
| XPI 回读 | P520 已装包与交付包 SHA-256 均为 `d223d16a40c28c6f0232028886ae666936be34df4b394a4c50c50feadee6e6de` |

机器可读证据见 [p520-runtime.json](p520-runtime.json)。L1 的 attempts=3 含诊断期间两次客户端中止，最终只有一篇 L1 Note。L3 因嵌套标题误判被拦截，修正后通过受控测试状态恢复复用原响应，attempts 仍为 1；不将这次恢复描述为自动生产迁移。已装最终 XPI 在重新安装及完整重启后再次核对。

GitHub Actions 在代码提交 `b84a3cd` 的 push 和 pull_request 检查均通过。

## 仍未覆盖

- 官方 Butler 精读与全部侧边栏动作未单独覆盖；共存写入测试针对手动摘要。
- 大库、长时间运行、多设备同步、编辑保存后跨设备重建、群组权限和 Zotero 10 原生多分类。
- 真实强制崩溃的两个写回窗口：目前仅有自动化故障注入，不等同实机断电测试。
- 在模型推理中删除父条目、撤销群组权限、同步标签先于 Note 的网络时序，主要由状态机测试覆盖。
- 动态提示词导入、全自动 MinerU、视觉分析、复杂数学/表格排版不在本版范围。
- PDF 页数完整不证明图表被正确理解。结构校验也不等于科学结论正确，仍需人工阅读。

已修复的问题和具体实现理由见 P520_TEST.md。Zotero 要求更新 URL，故本版本提供独立空更新清单；不会自动投放预览升级。
