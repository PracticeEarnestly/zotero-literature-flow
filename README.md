# Literature Flow for Zotero

独立的 L1–L3 文献工作流插件，辅助原版 AI Butler。当前交付 **0.3.0 预览版**：已生成 XPI，未安装到任何 Zotero 实例。

[下载 XPI](dist/zotero-literature-flow-0.3.0.xpi) · [SHA-256](dist/zotero-literature-flow-0.3.0.xpi.sha256) · [设计与实现](docs/DESIGN.md) · [验收记录](docs/VALIDATION.md) · [迁移与回滚](docs/MIGRATION.md)

## 日常操作

在条目或分类右键菜单打开 **Literature Flow · 工作流与队列**，先检查当前范围，再选择操作：

- 按评分或手动补齐至 L1 / L2 / L3；只生成缺失的级别。
- Extra `rate: 2–4` 对应 L2，`rate: 5` 对应 L3；L1、L2、L3 按前置结果顺序执行。
- 只读检查、标签修复、失败重试、取消、明确重生成和旧 Note 保护副本。
- 分类可包含子分类；条目、附件与 Note 会归一化到父文献并去重。
- 所有写操作先显示范围预览；重生成保留旧版本。

默认 `reader-standby`，不会调用模型或修改文献库。使用时需明确设置唯一 `executor`、填写本机连接，再恢复队列。自动化另外启用：首次建立基线不处理历史高星条目；后续只有真正新增或实际评分变化产生任务。

## 输入和输出

冻结了 P520 AI Butler **5.1.0.3** 的现用三份提示词及 hash，没有把 L3 改成逐图解读。三层都需要全文。可使用明确绑定到主文 PDF 的已保存 MinerU Markdown/HTML，或页数覆盖完整的 Zotero PDF 索引。缺文件、部分索引、多主文候选、无法确认来源或全文过长均等待处理。

结果保存为普通子 Note，使用 `LF:Note` 与可同步的可见任务标记；不使用 Butler 的笔记归属标签，也不输出 h1/h2。程序维护 `AI:L1/L2/L3` 和既有允许值的 `Evidence:E0–E5`、`Data:` 标签，不更改人工评分。未知旧格式、单独完成标签或冲突结果均待核对。

## 当前边界

- 安装目标暂限制 **Zotero 9.0.x**；本机 9.0.6 的接口源码已核对，但**没有安装或实机运行验证**。这不是全版本兼容声明。
- 自动化默认关闭；只支持人为指定唯一执行端，没有跨设备选主。
- UI 默认仅个人库；群组库、Zotero 10 多分类选择、保存后同步保真均未实机验收。
- 现用提示词已冻结，尚无可成功读取的生产 Note 样例做回归；未知旧格式继续保守等待。
- 暂不提供动态提示词包导入、自动 MinerU 服务调用、视觉输入或流式传输。当前使用已冻结的非流式请求契约。
- 此预览包不提供自动更新 URL；不会通过旧版的 latest 更新清单投放。

## 可复现构建

需要现有 Node.js 和 Python 3；零 npm 运行时依赖，不需要创建新环境。

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run build
python3 scripts/verify-package.py
```

XPI 输出到 `dist/`。构建脚本不会安装插件、改写 Zotero profile、修改文献库或访问模型服务。重复构建产生相同 SHA-256。

源码及历史版本采用 AGPL-3.0-or-later，见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。v0.2.1 Release 源码已纳入 Git 历史；新实现使用独立偏好命名空间，不继承旧版自动运行开关。
