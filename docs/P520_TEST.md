# P520 隔离测试与回滚 · 2026-10-22

本文件保留隔离测试结束时的历史状态。之后的正式迁移状态以 [P520_PRODUCTION.md](P520_PRODUCTION.md) 为准。

用户明确授权：先暂停原方案，再测试 Literature Flow + 上游官方 AI Butler。

## 隔离与备份

测试根目录：`/home/xiqing/literature-flow-test/20261022-180628`，仅本机用户可访问。

- 原生产 profile：`/home/xiqing/snap/zotero-snap/common/.zotero/zotero/aegvivj3.default`。
- 原数据目录：`/home/xiqing/snap/zotero-snap/common/Zotero`。
- 原进程正常退出后，备份数据库、偏好、扩展信息、旧 AI Butler 5.1.0.3 XPI；文件在测试根目录 `before/`。
- 原队列 86 条（76 completed、1 processing、9 pending）原样保留，并单独保存快照；没有把旧队列带入新测试 profile。
- 原 profile 的 autoScan、ratingWorkflowEnabled 关闭，workflowDeviceRole 设为 reader-standby。生产 Zotero 保持关闭。旧插件队列会独立启动，因此还将原 XPI 可逆移至测试根目录 `paused-old-extension/`，避免重启生产实例时自动续跑。文件 SHA-256 与备份一致。
- 新 profile/data 分别为测试根目录 `profile/` 和 `data/`。不登录 Zotero 同步账号，关闭自动同步。
- 测试只复制一篇文献的 PDF/元数据和少量旧 Note；原文献库不受新插件写操作影响。私有笔记、配置、密钥与数据库不纳入 Git。

## 软件与输入

- P520 Zotero 9.0.1，现有 snap 128 运行文件。
- 官方 AI Butler 5.1.0 原始 XPI，来自 [上游 v5.1.0 Release](https://github.com/steven-jianhao-li/zotero-AI-Butler/releases/tag/v5.1.0)。SHA-256：`5ffc86bc4a0eea2ca618dde628cc8174ddea9c64a0cdb25b2717016457a1f175`。
- Literature Flow 0.3.1，独立 ID 和偏好。新增临时文件驱动仅供隔离测试使用，不进入产品 XPI。
- 使用现有 OpenAI 兼容模型入口，服务名 `Qwen3.6-27B-AWQ-Hermes-256K`；未修改模型服务。
- 真实 PDF：10 页，Zotero 索引 10/10 页、41,911 字符。发送全文文字，不声称视觉推理。

## 实机发现并修复

1. Zotero 9 校验要求 `applications.zotero.update_url`；缺失时 XPI 会被拒绝。补齐指向仓库的独立空更新清单，不投放自动更新。
2. 对 jar URI 使用 `Zotero.File.getContentsAsync()` 得到 XMLHttpRequest，不能直接 JSON.parse；改为 `Zotero.HTTP.request()`。
3. `Zotero.Fulltext.getPages()` 返回数据库代理行，JSON.stringify 会触发 `DB column 'toJSON' not found`；转换成普通 `{indexedPages,total}` 后再保存和显示。
4. XHTML 面板脚本移至文档末尾，窗口明确使用非模态参数；UI 已实际读取模型、任务和全文信息。
5. 真实旧 Note 可把 L1/L2/L3 合并在一起；改为分别识别各级区块。测试库中已识别全部三级，并验证仅修复标签不改 Note 正文、不请求模型。

6. L3 的主章节以三级小标题开头时，原校验器误判为空；改为按 Markdown 标题层级确定章节边界，同时仍拒绝只有小标题、没有正文的输出。真实响应 16 个主章节完整；停用 LF 后备份测试状态，将该失败任务恢复为 queued，保留原响应与 generation，再启用修正版校验写回，没有重发 L3 请求。

## 回滚边界

本轮是隔离测试，没有把生产库切换成新插件。恢复旧方案时：

1. 先关闭隔离 Zotero，确认无在途新任务。
2. 保留测试目录及结果证据。
3. 如果要恢复原行为，用 `before/prefs-after-graceful-stop.js` 恢复原 profile 偏好，并将 `paused-old-extension/zotero-ai-butler@github.com.xpi` 移回原 profile 的 `extensions/`。必须在全部 Zotero 进程退出后进行；原数据库无需替换。
4. 重启原 profile 前检查旧队列的 processing/pending 项。新测试生成的 Note 只在隔离库，无需从生产库删除。

禁止把测试 profile 整体复制到另一台机器作为第二个 executor。正式迁移、跨设备同步和长时间稳定性仍需独立验收。

## 最终运行状态

测试实例保持打开，仅两个正式插件 active：LF 0.3.1 与上游 AI Butler 5.1.0。LF 为 reader-standby、paused、auto=false，测试任务已完成或取消。临时驱动已卸载。生产库与旧队列均通过独立读回校验，旧 XPI 保留在暂停目录。

重新打开测试实例可运行测试根目录的 `launch-test.sh`。不要把它误认为生产库迁移。结果表与机器可读证据见 VALIDATION.md 和 p520-runtime.json。

插件 manifest 与生命周期依据 [Zotero 开发文档](https://www.zotero.org/support/dev/zotero_7_for_developers)，安装可用性以本次 Zotero 9.0.1 实际读回为准。
