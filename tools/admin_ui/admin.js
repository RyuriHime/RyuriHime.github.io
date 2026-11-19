(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = {
    current: null,
    kind: "page",
    mode: "ir",
    dirty: false,
    profileDirty: false,
    siteDirty: false,
    lastMtime: 0,
    saveInFlight: false,
    suppressInputUntil: 0,
    meta: { title: "", date: "", categories: [], tags: [], extra: "" },
    originalContent: "",
    originalBody: "",
    bodyDirty: false,
    typora: null,
    list: null,
  };
  let vditor = null;

  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

  function toast(text, bad = false) {
    const el = $("#toast");
    el.textContent = text;
    el.classList.toggle("bad", bad);
    el.classList.add("on");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("on"), 2400);
  }

  function msg(text) {
    $("#msg").textContent = text || "";
  }

  async function api(url, options) {
    const response = await fetch(url, options);
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new Error(`服务返回了非 JSON 内容（${response.status}）`);
    }
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function unquote(value) {
    let text = String(value || "").trim();
    if (text.length >= 2 && ((text[0] === "'" && text.at(-1) === "'") || (text[0] === '"' && text.at(-1) === '"'))) {
      const quote = text[0];
      text = text.slice(1, -1);
      text = quote === "'" ? text.replace(/''/g, "'") : text.replace(/\\"/g, '"');
    }
    return text;
  }

  function splitDoc(text) {
    const match = FM_RE.exec(text);
    if (!match) return { fm: null, body: text };
    return { fm: match[1], body: text.slice(match[0].length) };
  }

  function parseFm(fmText) {
    const meta = { title: "", date: "", categories: [], tags: [], extra: "" };
    if (fmText === null) return meta;
    const lines = fmText.split(/\r?\n/);
    const extra = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line);
      if (!match) {
        extra.push(line);
        index += 1;
        continue;
      }
      const key = match[1];
      const value = (match[2] || "").trim();
      if (["title", "date", "categories", "tags"].includes(key)) {
        let values = [];
        if (value.startsWith("[") && value.endsWith("]")) {
          values = value.slice(1, -1).split(",").map((item) => unquote(item.trim())).filter(Boolean);
        } else if (value) {
          values = [unquote(value)];
        } else {
          let next = index + 1;
          while (next < lines.length) {
            const itemMatch = /^\s*-\s*(.*)$/.exec(lines[next]);
            if (!itemMatch) break;
            values.push(unquote(itemMatch[1].trim()));
            next += 1;
          }
          if (next > index + 1) index = next - 1;
        }
        if (key === "title") meta.title = values[0] || "";
        else if (key === "date") meta.date = values[0] || "";
        else meta[key] = values;
      } else {
        extra.push(line);
        let next = index + 1;
        while (next < lines.length && (/^\s+/.test(lines[next]) || /^\s*-\s+/.test(lines[next]))) {
          extra.push(lines[next]);
          next += 1;
        }
        index = next - 1;
      }
      index += 1;
    }
    meta.extra = extra.join("\n").trim();
    return meta;
  }

  function yamlQuote(value) {
    return `'${String(value || "").replace(/'/g, "''")}'`;
  }

  function serializeFm(meta) {
    const lines = ["---", `title: ${yamlQuote(meta.title || "未命名")}`];
    if (meta.date) lines.push(`date: ${yamlQuote(meta.date)}`);
    if (meta.categories.length) {
      lines.push("categories:", ...meta.categories.map((item) => `- ${yamlQuote(item)}`));
    }
    if (meta.tags.length) {
      lines.push("tags:", ...meta.tags.map((item) => `- ${yamlQuote(item)}`));
    }
    if (meta.extra) lines.push(meta.extra);
    lines.push("---", "");
    return `${lines.join("\n")}\n`;
  }

  function splitList(value) {
    return String(value || "").split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  }

  function outsideCode(text, transform) {
    const parts = String(text).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
    return parts.map((part, index) => (index % 2 ? part : transform(part))).join("");
  }

  function halveBackslashes(text) {
    return String(text).replace(/\\+/g, (run) => {
      if (run.length === 1) return run;
      return "\\".repeat(Math.max(1, Math.floor(run.length / 2)));
    });
  }

  function toEditorMath(text) {
    return outsideCode(text, (chunk) => chunk
      .replace(/\\\\\[([\s\S]*?)\\\\\]/g, (match, body) => `$$${halveBackslashes(body)}$$\n`)
      .replace(/\\\\\(([\s\S]*?)\\\\\)/g, (match, body) => `$${halveBackslashes(body)}$`)
      .replace(/\\\[([\s\S]*?)\\\]/g, (match, body) => `$$${body}$$\n`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (match, body) => `$${body}$`));
  }

  // Math is stored as plain $...$ / $$...$$ and protected at build time by
  // scripts/math_protect.js, so nothing needs escaping here.
  function fromEditorMath(text) {
    return text;
  }

  function setCounter(length) {
    $("#counter").textContent = length ? `${Number(length).toLocaleString()} 字` : "";
  }

  function syncCounter() {
    if (state.mode === "source") {
      setCounter($("#editor").value.length);
    } else if (vditor) {
      setCounter(vditor.getValue().length);
    }
  }

  function markDirty() {
    state.dirty = true;
    $("#dirty").hidden = false;
    $("#reload").classList.remove("attention");
  }

  function markBodyDirty() {
    state.bodyDirty = true;
    markDirty();
  }

  function clearDirty() {
    state.dirty = false;
    $("#dirty").hidden = true;
  }

  function setActive(path) {
    document.querySelectorAll(".item").forEach((button) => {
      button.classList.toggle("on", button.dataset.path === path);
    });
  }

  function applyFilter() {
    const query = $("#filter").value.trim().toLowerCase();
    document.querySelectorAll(".group").forEach((group) => {
      let visible = 0;
      group.querySelectorAll(".item").forEach((button) => {
        const hit = !query || button.dataset.search.includes(query);
        button.hidden = !hit;
        if (hit) visible += 1;
      });
      group.hidden = visible === 0;
    });
  }

  async function loadList() {
    const data = await api("/api/files");
    state.list = data;
    const box = $("#list");
    box.innerHTML = "";

    if (data.profile) {
      const group = document.createElement("div");
      group.className = "group";
      const heading = document.createElement("h3");
      heading.textContent = "关于";
      group.appendChild(heading);
      const button = document.createElement("button");
      button.className = "item";
      button.dataset.path = data.profile.path;
      button.dataset.search = `${data.profile.title} ${data.profile.path}`.toLowerCase();
      button.innerHTML = `${esc(data.profile.title)}<span class="p">头像 · 简介 · 联系方式</span>`;
      button.title = data.profile.path;
      button.addEventListener("click", () => openProfile());
      group.appendChild(button);
      box.appendChild(group);
    }

    const siteGroup = document.createElement("div");
    siteGroup.className = "group";
    const siteHeading = document.createElement("h3");
    siteHeading.textContent = "站点";
    siteGroup.appendChild(siteHeading);
    [
      ["_site_copy", "站点文案", "标题 · 描述 · 页脚 · 公告 · 导航"],
      ["_wallpaper", "壁纸", "上传 · 预览 · 重新生成"],
    ].forEach(([key, title, subtitle]) => {
      const button = document.createElement("button");
      button.className = "item";
      button.dataset.path = key;
      button.dataset.search = `${title} ${subtitle}`.toLowerCase();
      button.innerHTML = `${esc(title)}<span class="p">${esc(subtitle)}</span>`;
      button.addEventListener("click", () => (key === "_site_copy" ? openSite() : openWallpaper()));
      siteGroup.appendChild(button);
    });
    box.appendChild(siteGroup);

    const groups = [
      ["文章", data.posts, (item) => item.date || item.mtime],
      ["页面", data.pages, null],
      ["站点配置", data.configs, (item) => item.path],
    ];
    groups.forEach(([title, items, sub]) => {
      if (!items || !items.length) return;
      const group = document.createElement("div");
      group.className = "group";
      const heading = document.createElement("h3");
      heading.textContent = `${title} · ${items.length}`;
      group.appendChild(heading);
      items.forEach((item) => {
        const button = document.createElement("button");
        button.className = "item";
        button.dataset.path = item.path;
        button.dataset.search = `${item.title} ${item.path}`.toLowerCase();
        button.innerHTML = `${esc(item.title)}${sub ? `<span class="p">${esc(sub(item))}</span>` : ""}`;
        button.title = item.path;
        button.addEventListener("click", () => openFile(item.path));
        group.appendChild(button);
      });
      box.appendChild(group);
    });

    if (state.current) setActive(state.current);
    applyFilter();
  }

  function showEditor(text) {
    state.mode = "source";
    $("#vditor").hidden = true;
    $("#editor").hidden = false;
    $("#editor").value = text;
    $("#meta").hidden = state.kind === "config";
    $("#modeBtn").hidden = state.kind === "config";
    if (state.kind !== "config") $("#modeBtn").textContent = "即时渲染";
    setCounter(text.length);
  }

  function ensureVditor(value) {
    if (!window.Vditor) {
      toast("编辑器组件未加载，已回退到源码模式", true);
      showEditor(value);
      return;
    }
    if (vditor) {
      state.suppressInputUntil = Date.now() + 900;
      vditor.setValue(value || "", true);
      syncCounter();
      return;
    }

    $("#vditor").hidden = false;
    $("#editor").hidden = true;
    state.mode = "ir";
    state.suppressInputUntil = Date.now() + 1600;
    try {
      vditor = new Vditor("vditor", {
        mode: "ir",
        value: value || "",
        height: "100%",
        minHeight: 320,
        cdn: "/admin-assets/vditor",
        theme: "classic",
        icon: "ant",
        lang: "zh_CN",
        placeholder: "开始写…",
        cache: { enable: false },
        typewriterMode: false,
        toolbar: [
          "headings", "bold", "italic", "strike", "|",
          "list", "ordered-list", "check", "quote", "|",
          "code", "inline-code", "link", "table", "|",
          "undo", "redo", "|", "outline", "fullscreen",
        ],
        toolbarConfig: { pin: true },
        preview: {
          math: { engine: "KaTeX", inlineDigit: true },
          hljs: { lineNumber: true, style: "github" },
          theme: { current: "light" },
        },
        input: () => {
          if (Date.now() < state.suppressInputUntil) return;
          markBodyDirty();
          syncCounter();
        },
        after: () => {
          state.suppressInputUntil = Date.now() + 500;
          syncCounter();
        },
      });
    } catch (error) {
      console.error(error);
      toast(`编辑器初始化失败：${error.message}`, true);
      showEditor(value);
    }
  }

  function showIr(body) {
    state.mode = "ir";
    state.originalBody = body;
    state.bodyDirty = false;
    $("#meta").hidden = false;
    $("#modeBtn").hidden = false;
    $("#modeBtn").textContent = "源码";
    $("#vditor").hidden = false;
    $("#editor").hidden = true;
    ensureVditor(toEditorMath(body));
  }

  function updateMetaFields() {
    $("#m-title").value = state.meta.title || "";
    $("#m-date").value = state.meta.date || "";
    $("#m-cat").value = (state.meta.categories || []).join(", ");
    $("#m-tags").value = (state.meta.tags || []).join(", ");
    const showTax = state.kind === "post" || state.meta.categories.length || state.meta.tags.length;
    document.querySelectorAll(".meta .tax").forEach((label) => {
      label.hidden = !showTax;
    });
  }

  function readMetaFields() {
    state.meta.title = $("#m-title").value.trim();
    state.meta.date = $("#m-date").value.trim();
    state.meta.categories = splitList($("#m-cat").value);
    state.meta.tags = splitList($("#m-tags").value);
    return state.meta;
  }

  function currentMarkdown() {
    if (state.kind === "config" || state.mode === "source") return $("#editor").value;
    const meta = readMetaFields();
    const body = state.bodyDirty && vditor ? fromEditorMath(vditor.getValue()) : state.originalBody;
    return `${serializeFm(meta)}${body.replace(/^\n+/, "")}`;
  }

  function loadDocument(data, preserveMode = false) {
    state.current = data.path;
    state.lastMtime = Number(data.mtime || 0);
    state.kind = /\.(ya?ml)$/i.test(data.path)
      ? "config"
      : data.path.includes("/_posts/") ? "post" : "page";

    const doc = splitDoc(data.content);
    state.meta = parseFm(doc.fm);
    state.originalContent = data.content;
    state.originalBody = doc.body;
    state.bodyDirty = false;
    state.suppressInputUntil = Date.now() + 900;
    state.profileDirty = false;
    $("#pfDirty").hidden = true;
    $("#profilePanel").hidden = true;
    state.siteDirty = false;
    $("#stDirty").hidden = true;
    $("#sitePanel").hidden = true;
    $("#wallPanel").hidden = true;
    $("#shell").hidden = false;
    clearDirty();
    $("#reload").classList.remove("attention");
    $("#typoraState").textContent = state.typora ? "Typora 就绪" : "";
    $("#path").textContent = data.path;
    $("#docbar").hidden = false;
    $("#intro").hidden = true;
    setActive(data.path);

    if (state.kind === "config") {
      $("#meta").hidden = true;
      $("#modeBtn").hidden = true;
      showEditor(data.content);
      msg(`已打开 ${data.path}`);
      return;
    }

    if (!preserveMode) state.mode = "ir";
    updateMetaFields();
    $("#modeBtn").hidden = false;
    if (state.mode === "source") {
      showEditor(data.content);
    } else {
      $("#meta").hidden = false;
      showIr(doc.body);
    }
    msg(`已打开 ${data.path}`);
  }

  async function openFile(path) {
    if (state.dirty && !confirm("当前内容还没保存，确定离开？")) return;
    if (state.profileDirty && !confirm("关于页的修改还没保存，确定离开？")) return;
    if (state.siteDirty && !confirm("站点文案的修改还没保存，确定离开？")) return;
    try {
      const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
      loadDocument(data, false);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function save(build = false) {
    if (!state.current) return;
    if (!state.dirty) {
      toast("没有需要保存的修改");
      return;
    }
    const content = currentMarkdown();
    state.saveInFlight = true;
    msg("保存中…");
    try {
      const result = await api("/api/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.current, content }),
      });
      state.lastMtime = Number(result.mtime || state.lastMtime);
      state.originalContent = content;
      state.originalBody = splitDoc(content).body;
      state.bodyDirty = false;
      clearDirty();
      msg(`已保存 ${state.current}`);
      toast("已保存");
      if (build) await doBuild();
    } catch (error) {
      msg(`保存失败：${error.message}`);
      toast(`保存失败：${error.message}`, true);
    } finally {
      state.saveInFlight = false;
    }
  }

  async function reload() {
    if (!state.current) return;
    if (state.dirty && !confirm("放弃未保存的修改并重新载入？")) return;
    try {
      const data = await api(`/api/file?path=${encodeURIComponent(state.current)}`);
      loadDocument(data, true);
      toast("已重新载入");
    } catch (error) {
      toast(error.message, true);
    }
  }

  function showOutput(title, text) {
    const dialog = document.createElement("dialog");
    dialog.className = "dlg";
    dialog.style.width = "min(760px, calc(100vw - 30px))";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const pre = document.createElement("pre");
    pre.style.cssText = "max-height:56vh;overflow:auto;padding:12px;background:#f6f8fa;border-radius:8px;font:12px/1.6 var(--mono);white-space:pre-wrap";
    pre.textContent = text || "没有输出";
    const row = document.createElement("div");
    row.className = "row";
    const close = document.createElement("button");
    close.className = "primary";
    close.textContent = "关闭";
    close.addEventListener("click", () => dialog.close());
    row.appendChild(close);
    dialog.append(heading, pre, row);
    dialog.addEventListener("close", () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
  }

  async function doBuild() {
    const buildButton = $("#build");
    const saveButton = $("#saveBuild");
    buildButton.disabled = true;
    saveButton.disabled = true;
    msg("构建中…");
    try {
      const result = await api("/api/build", { method: "POST" });
      if (result.ok) {
        msg("构建完成");
        toast("构建完成，刷新博客预览即可");
      } else {
        msg("构建失败");
        toast("构建失败", true);
        showOutput("构建失败", result.output);
      }
    } catch (error) {
      msg(`构建失败：${error.message}`);
      toast("构建失败", true);
    } finally {
      buildButton.disabled = false;
      saveButton.disabled = false;
    }
  }

  function toggleMode() {
    if (state.kind === "config") return;
    if (state.mode === "ir") {
      const full = currentMarkdown();
      showEditor(full);
      msg("源码模式：可以直接改 front matter 和 HTML");
    } else {
      const doc = splitDoc($("#editor").value);
      state.meta = parseFm(doc.fm);
      updateMetaFields();
      showIr(doc.body);
      msg("即时渲染模式");
    }
  }

  function toggleFocus(force) {
    const on = typeof force === "boolean" ? force : !document.body.classList.contains("focus");
    document.body.classList.toggle("focus", on);
    $("#focusExit").hidden = !on;
    if (on && vditor) setTimeout(() => vditor.focus(), 60);
  }

  async function openTypora() {
    if (!state.current) return;
    try {
      await api("/api/open-typora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.current }),
      });
      toast("已在 Typora 中打开，保存后会自动同步");
      $("#typoraState").textContent = "Typora 已打开";
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function initTypora() {
    try {
      const info = await api("/api/typora");
      if (info.available) {
        state.typora = info.path;
        $("#typoraBtn").hidden = false;
        $("#typoraBtn").title = info.path;
        $("#typoraState").textContent = "Typora 就绪";
      }
    } catch (error) {
      console.warn(error);
    }
  }

  function pollExternal() {
    setInterval(async () => {
      if (!state.current || state.saveInFlight) return;
      const path = state.current;
      try {
        const info = await api(`/api/mtime?path=${encodeURIComponent(path)}`);
        if (path !== state.current) return;
        if (Number(info.mtime) <= state.lastMtime + 0.002) return;
        if (!state.dirty) {
          const data = await api(`/api/file?path=${encodeURIComponent(path)}`);
          if (path !== state.current) return;
          loadDocument(data, true);
          toast("已从 Typora 同步");
        } else {
          $("#reload").classList.add("attention");
          $("#typoraState").textContent = "Typora 有更新";
        }
      } catch (error) {
        /* The file may have been renamed or removed; leave the editor alone. */
      }
    }, 2500);
  }


  /* About-page profile form ------------------------------------------------ */
  function markProfileDirty() {
    state.profileDirty = true;
    $("#pfDirty").hidden = false;
  }

  function addLinkRow(contact = {}) {
    const row = document.createElement("div");
    row.className = "pf-link-row";
    row.innerHTML =
      `<input class="l-label" placeholder="名称" value="${esc(contact.label || "")}" autocomplete="off">` +
      `<input class="l-url" placeholder="https://example.com" value="${esc(contact.url || "")}" autocomplete="off">` +
      `<input class="l-icon" placeholder="fas fa-link" value="${esc(contact.icon || "fas fa-link")}" autocomplete="off">` +
      `<select class="l-group" title="附属到上方某个联系方式"><option value="">独立显示</option></select>` +
      `<button type="button" title="删除这一行">×</button>`;
    row.querySelector(".l-group").dataset.group = contact.group || "";
    row.querySelector("button").addEventListener("click", () => {
      row.remove();
      refreshGroups();
      markProfileDirty();
    });
    row.querySelectorAll("input").forEach((input) => input.addEventListener("input", markProfileDirty));
    row.querySelector(".l-group").addEventListener("change", markProfileDirty);
    $("#pfLinks").appendChild(row);
  }

  function refreshGroups() {
    const rows = Array.from(document.querySelectorAll("#pfLinks .pf-link-row"));
    const desired = new Map(rows.map((row) => {
      const select = row.querySelector(".l-group");
      return [row, (select.dataset.group || select.value || "").trim()];
    }));
    const topLabels = rows
      .filter((row) => !desired.get(row))
      .map((row) => row.querySelector(".l-label").value.trim())
      .filter(Boolean);
    rows.forEach((row) => {
      const select = row.querySelector(".l-group");
      const own = row.querySelector(".l-label").value.trim();
      const options = topLabels.filter((label) => label !== own);
      select.innerHTML = '<option value="">独立显示</option>' + options
        .map((label) => `<option value="${esc(label)}">归入 ${esc(label)}</option>`).join("");
      const want = desired.get(row) || "";
      select.value = options.includes(want) ? want : "";
      delete select.dataset.group;
    });
  }

  function fillProfile(profile) {
    $("#pfName").value = profile.name || "";
    $("#pfTitle").value = profile.title || "";
    $("#pfTagline").value = profile.tagline || "";
    $("#pfAvatar").value = profile.avatar || "";
    $("#pfBio").value = profile.bio || "";
    $("#pfLinks").innerHTML = "";
    (profile.contacts || []).forEach((contact) => addLinkRow(contact));
    if (!(profile.contacts || []).length) addLinkRow({ label: "GitHub", icon: "fab fa-github" });
    refreshGroups();
    state.profileDirty = false;
    $("#pfDirty").hidden = true;
  }

  function readProfileForm() {
    const contacts = Array.from(document.querySelectorAll("#pfLinks .pf-link-row")).map((row) => ({
      label: row.querySelector(".l-label").value.trim(),
      url: row.querySelector(".l-url").value.trim(),
      icon: row.querySelector(".l-icon").value.trim(),
      group: row.querySelector(".l-group").value.trim(),
    })).filter((contact) => contact.url);
    return {
      name: $("#pfName").value.trim(),
      title: $("#pfTitle").value.trim(),
      tagline: $("#pfTagline").value.trim(),
      avatar: $("#pfAvatar").value.trim(),
      bio: $("#pfBio").value,
      contacts,
    };
  }

  async function openProfile() {
    if (state.dirty && !confirm("当前内容还没保存，确定离开？")) return;
    if (!state.profileDirty && state.kind === "profile" && !$("#profilePanel").hidden) return;
    if (state.profileDirty && !confirm("关于页的修改还没保存，确定重新载入？")) return;
    try {
      const data = await api("/api/profile");
      fillProfile(data.profile || {});
      state.current = null;
      state.kind = "profile";
      state.dirty = false;
      clearDirty();
      $("#docbar").hidden = true;
      $("#meta").hidden = true;
      $("#shell").hidden = true;
      $("#sitePanel").hidden = true;
      $("#wallPanel").hidden = true;
      $("#profilePanel").hidden = false;
      setActive((state.list && state.list.profile && state.list.profile.path) || "source/_data/profile.yml");
      msg("关于页：头像、名字、简介和联系方式");
      $("#pfName").focus();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveProfile(build) {
    const payload = readProfileForm();
    if (!payload.name) {
      toast("名字不能为空", true);
      $("#pfName").focus();
      return;
    }
    const saveButton = $("#pfSave");
    const buildButton = $("#pfSaveBuild");
    saveButton.disabled = true;
    buildButton.disabled = true;
    msg("保存关于页…");
    try {
      await api("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.profileDirty = false;
      $("#pfDirty").hidden = true;
      msg("关于页已保存");
      toast("关于页已保存");
      if (build) await doBuild();
    } catch (error) {
      msg(`保存失败：${error.message}`);
      toast(`保存失败：${error.message}`, true);
    } finally {
      saveButton.disabled = false;
      buildButton.disabled = false;
    }
  }

  /* Site copy form -------------------------------------------------------- */
  function markSiteDirty() {
    state.siteDirty = true;
    $("#stDirty").hidden = false;
  }

  function addNavRow(item = {}) {
    const row = document.createElement("div");
    row.className = "pf-link-row";
    row.innerHTML =
      `<input class="n-label" placeholder="名称" value="${esc(item.label || "")}" autocomplete="off">` +
      `<input class="n-path" placeholder="/archives/" value="${esc(item.path || "")}" autocomplete="off">` +
      `<input class="n-icon" placeholder="fas fa-link" value="${esc(item.icon || "")}" autocomplete="off">` +
      `<button type="button" title="删除这一项">×</button>`;
    row.querySelector("button").addEventListener("click", () => {
      row.remove();
      markSiteDirty();
    });
    row.querySelectorAll("input").forEach((input) => input.addEventListener("input", markSiteDirty));
    $("#stNav").appendChild(row);
  }

  function fillSite(site) {
    $("#stTitle").value = site.title || "";
    $("#stSubtitle").value = site.subtitle || "";
    $("#stDescription").value = site.description || "";
    $("#stKeywords").value = site.keywords || "";
    $("#stAuthor").value = site.author || "";
    $("#stNotFound").value = site.notFound || "";
    $("#stTabTitle").value = site.tabTitle || "";
    $("#stFooter").value = site.footer || "";
    $("#stAside").value = site.aside || "";
    $("#stNotice").value = site.notice || "";
    $("#stNoticeOn").checked = Boolean(site.noticeOn);
    $("#stNav").innerHTML = "";
    (site.menu || []).forEach((item) => addNavRow(item));
    state.siteDirty = false;
    $("#stDirty").hidden = true;
  }

  function readSiteForm() {
    const menu = Array.from(document.querySelectorAll("#stNav .pf-link-row")).map((row) => ({
      label: row.querySelector(".n-label").value.trim(),
      path: row.querySelector(".n-path").value.trim(),
      icon: row.querySelector(".n-icon").value.trim(),
    })).filter((item) => item.label && item.path);
    return {
      title: $("#stTitle").value.trim(),
      tabTitle: $("#stTabTitle").value.trim(),
      subtitle: $("#stSubtitle").value.trim(),
      description: $("#stDescription").value.trim(),
      keywords: $("#stKeywords").value.trim(),
      author: $("#stAuthor").value.trim(),
      notFound: $("#stNotFound").value.trim(),
      footer: $("#stFooter").value.trim(),
      aside: $("#stAside").value.trim(),
      notice: $("#stNotice").value.trim(),
      noticeOn: $("#stNoticeOn").checked,
      menu,
    };
  }

  async function openSite() {
    if (state.dirty && !confirm("当前内容还没保存，确定离开？")) return;
    if (state.profileDirty && !confirm("关于页的修改还没保存，确定离开？")) return;
    if (state.siteDirty && !confirm("站点文案的修改还没保存，确定重新载入？")) return;
    try {
      const data = await api("/api/site");
      fillSite(data.site || {});
      state.current = null;
      state.kind = "site";
      state.dirty = false;
      clearDirty();
      $("#docbar").hidden = true;
      $("#meta").hidden = true;
      $("#shell").hidden = true;
      $("#profilePanel").hidden = true;
      $("#wallPanel").hidden = true;
      $("#sitePanel").hidden = false;
      setActive("_site_copy");
      msg("站点文案：标题、描述、页脚、公告与导航");
      $("#stTitle").focus();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveSite(build) {
    const payload = readSiteForm();
    if (!payload.title) {
      toast("站点名称不能为空", true);
      $("#stTitle").focus();
      return;
    }
    const saveButton = $("#stSave");
    const buildButton = $("#stSaveBuild");
    saveButton.disabled = true;
    buildButton.disabled = true;
    msg("保存站点文案…");
    try {
      await api("/api/site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      state.siteDirty = false;
      $("#stDirty").hidden = true;
      msg("站点文案已保存");
      toast("站点文案已保存");
      if (build) await doBuild();
    } catch (error) {
      msg(`保存失败：${error.message}`);
      toast(`保存失败：${error.message}`, true);
    } finally {
      saveButton.disabled = false;
      buildButton.disabled = false;
    }
  }

  /* Wallpaper ------------------------------------------------------------- */
  async function openWallpaper() {
    if (state.dirty && !confirm("当前内容还没保存，确定离开？")) return;
    if (state.profileDirty && !confirm("关于页的修改还没保存，确定离开？")) return;
    if (state.siteDirty && !confirm("站点文案的修改还没保存，确定离开？")) return;
    try {
      const data = await api("/api/wallpaper");
      const info = data.wallpaper || {};
      const image = $("#wpPreview");
      if (info.url) {
        image.src = info.url;
        image.hidden = false;
      } else {
        image.removeAttribute("src");
        image.hidden = true;
      }
      $("#wpHint").innerHTML = info.exists
        ? `当前壁纸来自 <code>${esc(info.source)}</code>。公开站只发布乱序字节碎片。`
        : `还没有生成壁纸，请选择一张图片。原图会保存在 <code>${esc(info.source)}</code>。`;
      state.current = null;
      state.kind = "wall";
      state.dirty = false;
      clearDirty();
      $("#docbar").hidden = true;
      $("#meta").hidden = true;
      $("#shell").hidden = true;
      $("#profilePanel").hidden = true;
      $("#sitePanel").hidden = true;
      $("#wallPanel").hidden = false;
      setActive("_wallpaper");
      msg("壁纸：上传后自动生成各尺寸并构建");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(file);
    });
  }

  async function uploadWallpaper() {
    const input = $("#wpFile");
    const file = input.files && input.files[0];
    if (!file) {
      toast("先选择一张图片", true);
      return;
    }
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast("只支持 PNG / JPEG / WebP", true);
      return;
    }
    const button = $("#wpUpload");
    button.disabled = true;
    msg("处理壁纸…");
    try {
      const dataUrl = await fileToDataUrl(file);
      msg("上传并生成各尺寸…");
      const result = await api("/api/wallpaper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, data: dataUrl }),
      });
      if (result.wallpaper && result.wallpaper.url) {
        $("#wpPreview").src = result.wallpaper.url;
        $("#wpPreview").hidden = false;
      }
      msg(result.ok ? "壁纸已更新并构建完成" : "壁纸已保存，但构建失败");
      toast(result.ok ? "壁纸已更新" : "壁纸已保存，构建失败", !result.ok);
      input.value = "";
    } catch (error) {
      msg(`壁纸上传失败：${error.message}`);
      toast(`壁纸上传失败：${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  }

  function bind() {
    $("#save").addEventListener("click", () => save(false));
    $("#saveBuild").addEventListener("click", () => save(true));
    $("#reload").addEventListener("click", reload);
    $("#stSave").addEventListener("click", () => saveSite(false));
    $("#stSaveBuild").addEventListener("click", () => saveSite(true));
    $("#stReload").addEventListener("click", () => {
      if (state.siteDirty && !confirm("放弃站点文案的修改并重新载入？")) return;
      state.siteDirty = false;
      openSite().catch((error) => toast(error.message, true));
    });
    $("#stAddNav").addEventListener("click", () => {
      addNavRow({ label: "", path: "", icon: "fas fa-link" });
      const rows = document.querySelectorAll("#stNav .pf-link-row .n-label");
      if (rows.length) rows[rows.length - 1].focus();
    });
    ["#stTitle", "#stTabTitle", "#stSubtitle", "#stDescription", "#stKeywords", "#stAuthor",
      "#stNotFound", "#stFooter", "#stAside", "#stNotice"].forEach((selector) => {
      $(selector).addEventListener("input", markSiteDirty);
    });
    $("#stNoticeOn").addEventListener("change", markSiteDirty);
    $("#wpUpload").addEventListener("click", uploadWallpaper);
    $("#wpBuild").addEventListener("click", async () => {
      const button = $("#wpBuild");
      button.disabled = true;
      msg("重新生成壁纸尺寸并构建…");
      try {
        const result = await api("/api/assets/prepare", { method: "POST" });
        msg(result.ok ? "已重新生成并构建" : "已重新生成，但构建失败");
        toast(result.ok ? "已重新生成并构建" : "已重新生成，构建失败", !result.ok);
      } catch (error) {
        msg(`重新生成失败：${error.message}`);
        toast(`重新生成失败：${error.message}`, true);
      } finally {
        button.disabled = false;
      }
    });
    $("#modeBtn").addEventListener("click", toggleMode);
    $("#focusBtn").addEventListener("click", () => toggleFocus());
    $("#focusExit").addEventListener("click", () => toggleFocus(false));
    $("#build").addEventListener("click", doBuild);
    $("#typoraBtn").addEventListener("click", openTypora);
    $("#filter").addEventListener("input", applyFilter);
    $("#pfSave").addEventListener("click", () => saveProfile(false));
    $("#pfSaveBuild").addEventListener("click", () => saveProfile(true));
    $("#pfReload").addEventListener("click", () => {
      if (state.profileDirty && !confirm("放弃关于页的修改并重新载入？")) return;
      openProfile().catch((error) => toast(error.message, true));
    });
    $("#pfAdd").addEventListener("click", () => {
      addLinkRow({ label: "", icon: "fas fa-link" });
      refreshGroups();
      markProfileDirty();
      const inputs = document.querySelectorAll("#pfLinks .pf-link-row .l-label");
      if (inputs.length) inputs[inputs.length - 1].focus();
    });
    ["#pfTitle", "#pfName", "#pfTagline", "#pfAvatar", "#pfBio"].forEach((selector) => {
      $(selector).addEventListener("input", markProfileDirty);
    });

    ["#m-title", "#m-date", "#m-cat", "#m-tags"].forEach((selector) => {
      $(selector).addEventListener("input", markDirty);
    });
    $("#editor").addEventListener("input", () => {
      markDirty();
      setCounter($("#editor").value.length);
    });

    $("#new").addEventListener("click", () => {
      $("#dlg").showModal();
      setTimeout(() => $("#f-title").focus(), 50);
    });
    $("#create").addEventListener("click", async (event) => {
      event.preventDefault();
      const title = $("#f-title").value.trim();
      if (!title) {
        toast("请填标题", true);
        return;
      }
      try {
        const result = await api("/api/new", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            date: $("#f-date").value,
            category: $("#f-cat").value,
            tags: $("#f-tags").value,
          }),
        });
        $("#dlg").close();
        $("#f-title").value = "";
        await loadList();
        await openFile(result.path);
        toast("文章已创建");
        setTimeout(() => $("#m-title").focus(), 300);
      } catch (error) {
        toast(error.message, true);
      }
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        $("#filter").focus();
        $("#filter").select();
      } else if (event.key === "Escape") {
        if (document.body.classList.contains("focus")) toggleFocus(false);
        else if (document.activeElement === $("#filter")) {
          $("#filter").value = "";
          applyFilter();
          $("#filter").blur();
        }
      }
    });

    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty && !state.profileDirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  async function boot() {
    bind();
    initTypora();
    pollExternal();
    try {
      await loadList();
    } catch (error) {
      $("#list").innerHTML = `<h3>无法加载文件</h3><p>${esc(error.message)}</p>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
