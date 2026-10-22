# 设计与实现记录 · 2026-10-22

依据用户提供的《Literature Flow：Zotero 辅助插件设计与 Codex 实施规范 v1》实施。附件中的任务文本作为设计参考；首轮授权是构建 XPI、Git 管理和同步 GitHub。后续用户授权先暂停 P520 旧方案，再测试独立插件加官方 AI Butler；本轮已在隔离 profile 执行。生产库尚未迁移，模型服务配置未修改。

## 架构

```mermaid
flowchart LR
  Z[Zotero Notifier / 手动预览] --> E[评分与历史 Note 核对]
  E --> Q[本机持久队列 / 单 worker]
  Q --> I[主文与完整全文核对]
  I --> P[P520 chat/completions]
  P --> R[先原子保存响应]
  R --> V[结构校验与代次复核]
  V --> N[短事务写普通 Note 和允许标签]
```

`core.js` 是可独立测试的状态机；`workflow.js` 集中实现 Zotero 数据层、文件、菜单、凭据和网络适配；`panel.xhtml/js/css` 提供设置、只读状态、批量预览和人工操作。

## 身份和存储

- 插件 ID：`literatureflow@zotero.local`，沿用本仓库的独立 ID，与 AI Butler 不同。
- 新偏好前缀：`extensions.zotero.literatureFlowV1`。
- 本机状态目录：当前 Zotero profile 下 `literature-flow-v1/`，与同步数据目录分开。
- `state.json` 原子替换；`responses/<task>-<generation>.json` 保存完整回答、实际输入和依赖记录。
- 状态损坏时失败关闭，保留文件，不自动清空任务。
- 密钥使用 Gecko Login Manager；共享配置仅包含 schema、模型名、契约 ID，导入后重置待机并清除本机连接及绑定。
- 本机状态和响应含文献内容，不应上传 GitHub，也不应作为共享配置同步。

逻辑键为 `libraryScope/parentKey/stage/revision`。同步个人库使用账号 ID，群组使用 group ID，未登录使用设备命名空间。同进程只有一个 worker。网络超时不保证服务端没有继续计算，因此只承诺客户端去重和受控写回。

## 现用契约冻结

只读导出 P520 AI Butler 5.1.0.3 的 L1、L2、L3 原文，长度 4908、7924、13189 字符。原文和各自 SHA-256 位于 `addon/content/contracts/legacy.json`。

- 用户消息保持 `prompt + "\n\n<Paper>\n" + fulltext + "\n</Paper>"`。
- 系统消息及最终输出约束按运行包源码核对。
- 保留旧 L1 数据可用性后缀、输出章节与结构化标签边界。
- 请求为 `stream: false`；实际 enableTemperature、enableTopP、enableMaxTokens 均为 false，所以没有把偏好里残留的数值擅自加入请求。
- 默认 reasoningEffort 不发送；没有加入 JSON Schema、工具调用或云端备用模型。
- 当前请求总时限沿用 3000000 ms。没有模拟流式首 token / idle timeout。
- 不静默截断：超过 500000 字符进入等待。这是新客户端的保守上限，不是宣称已复刻旧分段策略。

提示词文本和请求格式得到核对不代表历史迁移验收完成。生产 Note 只读抽样遇到数据库锁，未强制解锁，也没有使用忽略 WAL 的复制方法。尚须在未来独立测试库核对真实 Note 样例。

## 状态和写回

首次基线只记录已有父条目与评分。普通题名、标签、Note 或附件事件不为历史五星条目创造补跑资格。低评分取消尚未合法提交的自动高阶任务，不取消明确的手动补齐。

响应先落盘；输出需正常结束、非空、结构化标签块有效、必要章节非空。写回前再次检查角色、父条目、权限、评分、任务代次、依赖 Note 和输入 hash。通过 Zotero `executeTransaction` / `save` 完成短事务，事务中没有模型调用。

恢复优先检查同任务 Note；若响应已写而状态指针未写，则从确定性文件名发现响应并复用。主动取消后不被普通事件重新激活。暂停使旧代次失效，保留恢复资格。

Note 使用普通可见 `LF_RECORD_V1` JSON 行，含 stage、revision、task、scope、parent、prompt、source、created、previous。新版本成功才通过 previous 关系取代旧有效结果；旧内容始终保留。模型正文出现同名恢复标记时会转义其标识，避免伪造任务身份。

## 输入与兼容性限制

多 PDF 等待用户绑定主文。Markdown/HTML 需要用户确认来源及完整性，绑定记录保存源文件状态与文本 hash；只发送文字，不读取或上传相对图片。未绑定时只用本地 PDF 且索引页数完整的缓存。未知或部分覆盖不会被当作完整输入。

旧 L2/L3 同时检查已知标题和完整章节内容；L1 结合 Butler 子 Note 标签、数据可用性行及正文。未知格式和多个无明确版本关系的结果进入人工核对。源文件变化不触发全库重算。

这版不会自动复制旧结果、修改 Butler 偏好或安装/替换任何插件。保护副本是独立预览操作，保留原文快照及 hash，并创建独立 LF Note。

## 参考与接口核对

- [Zotero 插件生命周期](https://www.zotero.org/support/dev/zotero_7_for_developers#plugin_lifecycle_hooks)
- [Zotero 8 菜单 API 与平台变更](https://www.zotero.org/support/dev/zotero_8_for_developers)
- [Zotero 10 接口变更](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Zotero JavaScript 数据 API](https://www.zotero.org/support/dev/client_coding/javascript_api)
- [AI Butler 上游](https://github.com/steven-jianhao-li/zotero-AI-Butler)

实际核对了本机 Zotero 9.0.6 安装包中的 MenuManager、Fulltext.getPages/getItemCacheFile、FilePicker 与 Login Manager 用法。没有把 Web API 全文接口误当作客户端同步调用接口。
