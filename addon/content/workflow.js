/*
 * Literature Flow
 * Copyright (C) 2026 Xiqing
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file intentionally contains only the literature workflow needed by
 * this installation. It does not include chat, dashboard, image, export, or
 * review functions from the upstream AI Butler project.
 */

var LiteratureFlow = (() => {
  const PREF = "extensions.zotero.literatureFlow.";
  const LEVELS = { L1: 1, L2: 2, L3: 3 };
  const LEVEL_TAGS = { L1: "AI:L1", L2: "AI:L2", L3: "AI:L3" };
  const NOTE_TAG = "Literature Flow";
  const active = new Map();
  const debounced = new Map();
  const menus = new Map();
  let notifierID;
  let alive = false;

  function pref(name) {
    return Zotero.Prefs.get(PREF + name);
  }

  function setPref(name, value) {
    Zotero.Prefs.set(PREF + name, value);
  }

  function log(message, error) {
    Zotero.debug(`[Literature Flow] ${message}`);
    if (error) Zotero.logError(error);
  }

  function toNumber(value, fallback) {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  function levelName(level) {
    return Object.entries(LEVELS).find(([, rank]) => rank === level)?.[0];
  }

  function parentItem(item) {
    if (item?.isRegularItem?.()) return item;
    return item?.parentItem || null;
  }

  function getRating(item) {
    const extra = String(item.getField("extra") || "");
    const match = extra.match(
      /(?:^|\r?\n)\s*(?:rate|rating|评级)\s*:\s*([0-5])\s*(?=\r?$|\r?\n)/im,
    );
    return match ? Number(match[1]) : 0;
  }

  function targetForRating(rating) {
    if (rating >= 5) return LEVELS.L3;
    if (rating >= 2) return LEVELS.L2;
    return LEVELS.L1;
  }

  function hasTag(item, tag) {
    return item.getTags().some((entry) => entry.tag === tag);
  }

  function addTag(item, tag) {
    if (!hasTag(item, tag)) item.addTag(tag);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function notify(window, text, type = "info") {
    log(text);
    try {
      const progress = new Zotero.ProgressWindow({ closeOnClick: true });
      progress.changeHeadline("Literature Flow");
      progress.addDescription(escapeHtml(text));
      progress.show();
      window?.setTimeout?.(() => progress.close(), type === "error" ? 9000 : 4500);
    } catch (_) {
      // Automated jobs do not require a visible window.
    }
  }

  function bestWindow() {
    return Zotero.getMainWindow?.() || null;
  }

  async function selectedItems(window) {
    const pane = window?.ZoteroPane;
    const items = pane?.getSelectedItems?.() || [];
    return items.map(parentItem).filter(Boolean);
  }

  async function collectionItems(window) {
    const collection = window?.ZoteroPane?.getSelectedCollection?.();
    if (!collection) throw new Error("请先选择一个文献库或分类文件夹。");
    const ids = collection.getChildItems?.() || [];
    const items = [];
    for (const id of ids) {
      const item = await Zotero.Items.getAsync(id);
      if (item?.isRegularItem?.()) items.push(item);
    }
    return items;
  }

  function appendMenuItem(doc, popup, label, handler) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", label);
    item.addEventListener("command", handler);
    popup.appendChild(item);
    return item;
  }

  function addWorkflowMenu(window, popupID, useCollection) {
    const doc = window.document;
    const host = doc.getElementById(popupID);
    if (!host || doc.getElementById(`${popupID}-literature-flow`)) return [];

    const menu = doc.createXULElement("menu");
    menu.id = `${popupID}-literature-flow`;
    menu.setAttribute("label", "Literature Flow");
    const popup = doc.createXULElement("menupopup");
    menu.appendChild(popup);
    const getItems = () =>
      useCollection ? collectionItems(window) : selectedItems(window);
    const run = (level, force = false) => async () => {
      try {
        const items = await getItems();
        if (!items.length) throw new Error("没有可处理的文献条目。");
        for (const item of items) enqueue(item, level, force, "manual");
        notify(window, `已加入 ${items.length} 篇文献的 ${levelName(level)} 队列。`);
      } catch (error) {
        notify(window, error.message || String(error), "error");
      }
    };
    appendMenuItem(doc, popup, "运行 L1：快速概括", run(LEVELS.L1, true));
    appendMenuItem(doc, popup, "运行 L2：结构化解读", run(LEVELS.L2, true));
    appendMenuItem(doc, popup, "运行 L3：证据审视", run(LEVELS.L3, true));
    appendMenuItem(doc, popup, "按评级运行", async () => {
      try {
        const items = await getItems();
        if (!items.length) throw new Error("没有可处理的文献条目。");
        for (const item of items) {
          enqueue(item, targetForRating(getRating(item)), false, "rating");
        }
        notify(window, `已按评级加入 ${items.length} 篇文献。`);
      } catch (error) {
        notify(window, error.message || String(error), "error");
      }
    });
    popup.appendChild(doc.createXULElement("menuseparator"));
    appendMenuItem(doc, popup, "配置接口与 MinerU…", () => configure(window));
    host.appendChild(menu);
    return [menu];
  }

  async function onMainWindowLoad(window) {
    if (!alive) return;
    const add = () => {
      const elements = [
        ...addWorkflowMenu(window, "zotero-itemmenu", false),
        ...addWorkflowMenu(window, "zotero-collectionmenu", true),
      ];
      if (elements.length) menus.set(window, elements);
    };
    add();
    window.setTimeout(add, 1000);
  }

  async function onMainWindowUnload(window) {
    for (const element of menus.get(window) || []) element.remove();
    menus.delete(window);
  }

  async function configure(window) {
    const fields = [
      ["l1l2Endpoint", "L1/L2 OpenAI 兼容地址（例如 http://server:port/v1）"],
      ["l1l2Model", "L1/L2 模型名称"],
      ["l1l2ApiKey", "L1/L2 API Key（没有可留空）"],
      ["l3Endpoint", "L3 OpenAI 兼容地址（例如 http://server:port/v1）"],
      ["l3Model", "L3 模型名称"],
      ["l3ApiKey", "L3 API Key（没有可留空）"],
      ["mineruApiKey", "MinerU API Key（留空则使用 Zotero 全文索引）"],
    ];
    for (const [key, label] of fields) {
      const value = { value: String(pref(key) || "") };
      if (!Services.prompt.prompt(window, "Literature Flow 配置", label, value, null, {})) {
        return;
      }
      setPref(key, value.value.trim());
    }
    setPref("useMinerU", Boolean(pref("mineruApiKey")));
    notify(window, "配置已保存。右键条目即可运行 L1、L2、L3。\n");
  }

  function enqueue(item, target, force, source) {
    const parent = parentItem(item);
    if (!parent || !parent.id) return;
    const existing = active.get(parent.id);
    if (existing) {
      existing.target = Math.max(existing.target, target);
      existing.force = existing.force || force;
      return;
    }
    const job = { itemID: parent.id, target, force, source };
    active.set(parent.id, job);
    process(job).catch((error) => {
      log(`Job failed for item ${parent.id}: ${error.message || error}`, error);
      notify(bestWindow(), `处理失败：${parent.getField("title") || parent.id}\n${error.message || error}`, "error");
    }).finally(() => active.delete(parent.id));
  }

  async function process(job) {
    while (true) {
      const item = await Zotero.Items.getAsync(job.itemID);
      if (!item || !item.isRegularItem?.()) return;
      const target = job.target;
      for (let rank = LEVELS.L1; rank <= target; rank += 1) {
        const level = levelName(rank);
        if (job.force || !hasTag(item, LEVEL_TAGS[level])) {
          await runLevel(item, level);
        }
      }
      if (job.target === target) return;
    }
  }

  async function runLevel(item, level) {
    const window = bestWindow();
    const title = String(item.getField("title") || "未命名文献");
    notify(window, `${level} 开始：${title}`);
    const text = await extractText(item);
    const prompt = String(pref(`prompt${level}`) || "").trim();
    const answer = await requestLLM(level, prompt, text, title);
    if (!answer.trim()) throw new Error(`${level} 模型没有返回有效内容。`);
    await appendToAINote(item, level, answer);
    addTag(item, LEVEL_TAGS[level]);
    await item.saveTx();
    notify(window, `${level} 完成：${title}`);
  }

  async function findPDF(item) {
    const candidates = [];
    for (const id of item.getAttachments()) {
      const attachment = await Zotero.Items.getAsync(id);
      if (attachment?.attachmentContentType === "application/pdf") candidates.push(attachment);
    }
    candidates.sort((a, b) => String(a.dateAdded).localeCompare(String(b.dateAdded)));
    for (const attachment of candidates) {
      let path = await attachment.getFilePathAsync?.();
      if (!path && attachment.isStoredFileAttachment?.() && Zotero.Sync?.Runner?.downloadFile) {
        await Zotero.Sync.Runner.downloadFile(attachment);
        path = await attachment.getFilePathAsync?.();
      }
      if (path && await IOUtils.exists(path)) return { attachment, path };
    }
    throw new Error("找不到可访问的本地 PDF。请先确认该附件已下载到本机。");
  }

  async function extractIndexedText(pdf) {
    const fromAttachment = await pdf.attachmentText;
    if (fromAttachment?.trim()) return fromAttachment;
    const readCache = async () => {
      const cache = Zotero.Fulltext.getItemCacheFile(pdf);
      if (!cache?.path || !(await IOUtils.exists(cache.path))) return "";
      return String(await Zotero.File.getContentsAsync(cache.path) || "");
    };
    let cached = await readCache();
    if (cached.trim()) return cached;
    await Zotero.Fulltext.indexItems([pdf.id], { complete: true });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await Zotero.Promise.delay(1000);
      const direct = await pdf.attachmentText;
      if (direct?.trim()) return direct;
      cached = await readCache();
      if (cached.trim()) return cached;
    }
    throw new Error("Zotero 全文索引未能提取 PDF 文本。请确认 PDF 可阅读，或配置 MinerU。 ");
  }

  async function extractMinerU(path) {
    const apiKey = String(pref("mineruApiKey") || "").trim();
    if (!apiKey) throw new Error("MinerU API Key 未配置。");
    const pdfData = await IOUtils.read(path);
    const batchResponse = await fetch("https://mineru.net/api/v4/file-urls/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ name: "document.pdf" }], model_version: "vlm" }),
    });
    if (!batchResponse.ok) throw new Error(`MinerU 创建任务失败（HTTP ${batchResponse.status}）。`);
    const batch = await batchResponse.json();
    const data = batch?.data || {};
    const uploadURL = data.file_urls?.[0] || data.urls?.[0] || data.urls?.document?.pdf || data.items?.[0]?.url || data.upload_url;
    if (!data.batch_id || !uploadURL) throw new Error("MinerU 返回的上传信息不完整。 ");
    const uploadResponse = await fetch(uploadURL, { method: "PUT", body: pdfData });
    if (!uploadResponse.ok) throw new Error(`MinerU 上传 PDF 失败（HTTP ${uploadResponse.status}）。`);

    const timeout = toNumber(pref("requestTimeoutMs"), 600000);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await Zotero.Promise.delay(5000);
      const statusResponse = await fetch(`https://mineru.net/api/v4/extract-results/batch/${data.batch_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!statusResponse.ok) throw new Error(`MinerU 查询任务失败（HTTP ${statusResponse.status}）。`);
      const status = await statusResponse.json();
      const result = status?.data?.extract_result?.[0] || status?.data || {};
      const state = String(result.state || "").toLowerCase();
      if (["failed", "error"].includes(state)) throw new Error("MinerU 解析任务失败。 ");
      if (state !== "done") continue;
      const zipURL = result.full_zip_url;
      if (!zipURL) throw new Error("MinerU 未返回结果文件。 ");
      const zipResponse = await fetch(zipURL);
      if (!zipResponse.ok) throw new Error(`MinerU 下载结果失败（HTTP ${zipResponse.status}）。`);
      const zip = await JSZip.loadAsync(await zipResponse.arrayBuffer());
      const names = Object.keys(zip.files).filter((name) => /\.md$/i.test(name));
      const preferred = names.find((name) => /(?:full|content|auto)\.md$/i.test(name)) || names[0];
      if (!preferred) throw new Error("MinerU 结果中没有 Markdown 文本。 ");
      return await zip.files[preferred].async("string");
    }
    throw new Error("MinerU 解析超时。 ");
  }

  async function extractText(item) {
    const { attachment, path } = await findPDF(item);
    if (Boolean(pref("useMinerU")) && String(pref("mineruApiKey") || "").trim()) {
      try {
        return await extractMinerU(path);
      } catch (error) {
        log(`MinerU failed; falling back to Zotero full text: ${error.message || error}`);
      }
    }
    return extractIndexedText(attachment);
  }

  function endpointFor(level) {
    const group = level === "L3" ? "l3" : "l1l2";
    const raw = String(pref(`${group}Endpoint`) || "").trim().replace(/\/$/, "");
    const model = String(pref(`${group}Model`) || "").trim();
    const key = String(pref(`${group}ApiKey`) || "").trim();
    if (!raw || !model) throw new Error(`请先配置 ${level === "L3" ? "L3" : "L1/L2"} 的接口地址和模型名称。`);
    return { url: /\/chat\/completions$/i.test(raw) ? raw : `${raw}/chat/completions`, model, key };
  }

  async function requestLLM(level, prompt, text, title) {
    const { url, model, key } = endpointFor(level);
    const timeout = toNumber(pref("requestTimeoutMs"), 600000);
    const maxChars = toNumber(pref("maxInputChars"), 120000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          stream: false,
          messages: [
            { role: "system", content: "你是严谨的学术文献助手。不要创建、建议或输出 Zotero 标签。" },
            { role: "user", content: `文献题目：${title}\n\n任务：${prompt}\n\n全文：\n${text.slice(0, maxChars)}` },
          ],
        }),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`模型请求失败（HTTP ${response.status}）：${raw.slice(0, 500)}`);
      const payload = JSON.parse(raw);
      const content = payload?.choices?.[0]?.message?.content ?? payload?.output_text;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) return content.map((entry) => entry.text || "").join("\n");
      throw new Error("模型响应中没有可用文本。 ");
    } finally {
      clearTimeout(timer);
    }
  }

  async function findAINote(item) {
    const ids = item.getNotes?.() || [];
    for (const id of ids) {
      const note = await Zotero.Items.getAsync(id);
      if (!note) continue;
      const tags = note.getTags().map((tag) => tag.tag.toLowerCase());
      const content = String(note.getNote() || "").toLowerCase();
      if (tags.includes(NOTE_TAG.toLowerCase()) || tags.some((tag) => /ai[ :_-]?(note|summary|butler)/i.test(tag)) || content.includes("[ai-butler]")) return note;
    }
    return null;
  }

  async function appendToAINote(item, level, answer) {
    let note = await findAINote(item);
    const timestamp = new Date().toLocaleString();
    const section = `<h2>${escapeHtml(level)} · Literature Flow</h2><p><em>${escapeHtml(timestamp)}</em></p><pre>${escapeHtml(answer)}</pre>`;
    if (!note) {
      note = new Zotero.Item("note");
      note.libraryID = item.libraryID;
      note.parentID = item.id;
      note.setNote(`<h1>AI Note</h1>${section}`);
      note.addTag(NOTE_TAG);
    } else {
      note.setNote(`${note.getNote() || ""}${section}`);
      note.addTag(NOTE_TAG);
    }
    await note.saveTx();
  }

  function schedule(item, target, delay = 900) {
    const parent = parentItem(item);
    if (!parent?.id) return;
    const current = debounced.get(parent.id);
    if (current) clearTimeout(current.timer);
    const entry = { target: Math.max(target, current?.target || 0), timer: null };
    entry.timer = setTimeout(() => {
      debounced.delete(parent.id);
      enqueue(parent, entry.target, false, "automatic");
    }, delay);
    debounced.set(parent.id, entry);
  }

  async function notifyObserver(event, type, ids) {
    if (!alive || type !== "item") return;
    for (const id of ids) {
      const changed = await Zotero.Items.getAsync(id);
      const item = parentItem(changed);
      if (!item?.isRegularItem?.()) continue;
      if (event === "add") {
        if (Boolean(pref("autoNewL1"))) schedule(item, LEVELS.L1);
        continue;
      }
      if (event === "modify") {
        const rating = getRating(item);
        if (rating >= 2) schedule(item, targetForRating(rating));
      }
    }
  }

  async function startup() {
    alive = true;
    notifierID = Zotero.Notifier.registerObserver({ notify: notifyObserver }, ["item"], "literature-flow");
    for (const window of Zotero.getMainWindows?.() || []) await onMainWindowLoad(window);
    log("started");
  }

  async function shutdown() {
    alive = false;
    if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
    notifierID = undefined;
    for (const [id, entry] of debounced) clearTimeout(entry.timer);
    debounced.clear();
    for (const window of [...menus.keys()]) await onMainWindowUnload(window);
    active.clear();
    log("stopped");
  }

  return { startup, shutdown, onMainWindowLoad, onMainWindowUnload };
})();
