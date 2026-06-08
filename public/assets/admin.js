const waitForPageTransition =
  window.__SITE_PAGE_TRANSITION_DONE instanceof Promise
    ? window.__SITE_PAGE_TRANSITION_DONE
    : Promise.resolve();
function el(id) {
  return document.getElementById(id);
}

const state = {
  me: null,
  modsManager: null,
  usersManager: null,
  changelogManager: null,
};

const BRANCH_LABELS = {
  main: "forge",
  neoforge: "neoforge",
  sponsor: "内测版(赞助)",
};

function showToast(targetId, message, ok) {
  const toast = el(targetId);
  toast.textContent = message;
  toast.classList.toggle("is-show", Boolean(message));
  toast.style.borderColor = ok ? "rgba(34,197,94,0.35)" : "rgba(245,158,11,0.35)";
}

function formatBranchLabel(branch) {
  return BRANCH_LABELS[branch] || branch;
}

async function fetchJson(url, init) {
  const res = await fetch(url, { cache: "no-store", ...(init || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败：${res.status}`);
  return data;
}

async function postJson(url, payload) {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function deleteJson(url) {
  return fetchJson(url, {
    method: "DELETE",
  });
}

async function patchJson(url, payload) {
  return fetchJson(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)}${units[i]}`;
}

function formatDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatFeedbackType(type) {
  if (type === "bug") return "Bug 反馈";
  if (type === "suggestion") return "建议";
  return "普通反馈";
}

function readFeedbackAttachments(item) {
  const images = Array.isArray(item?.images) ? item.images : [];
  const files = Array.isArray(item?.files) ? item.files : [];
  return { images, files };
}

function createAttachmentCell(item) {
  const td = document.createElement("td");
  const { images, files } = readFeedbackAttachments(item);
  if (images.length === 0 && files.length === 0) {
    td.textContent = "—";
    return td;
  }

  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "8px";

  const groups = [
    { label: "图片", items: images },
    { label: "文件", items: files },
  ];

  for (const group of groups) {
    if (group.items.length === 0) continue;
    const row = document.createElement("div");
    const title = document.createElement("div");
    title.className = "hint";
    title.textContent = `${group.label} ${group.items.length} 个`;
    row.appendChild(title);

    const links = document.createElement("div");
    links.className = "button-row";
    links.style.marginTop = "6px";
    group.items.forEach((attachment, index) => {
      const link = document.createElement("a");
      link.className = "btn btn--ghost";
      link.href = attachment?.url || "#";
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = attachment?.name || `${group.label}${index + 1}`;
      links.appendChild(link);
    });
    row.appendChild(links);
    wrap.appendChild(row);
  }

  td.appendChild(wrap);
  return td;
}

function render(items) {
  const table = el("table");
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  for (const it of items) {
    const tr = document.createElement("tr");

    const tdType = document.createElement("td");
    tdType.textContent = formatFeedbackType(it.type);

    const tdTitle = document.createElement("td");
    tdTitle.textContent = it.title || "—";

    const tdContent = document.createElement("td");
    tdContent.textContent = it.content || "—";

    const tdAttach = createAttachmentCell(it);

    const tdVer = document.createElement("td");
    const parts = [];
    if (it.gameVersion) parts.push(`MC ${it.gameVersion}`);
    if (it.modVersion) parts.push(`MOD ${it.modVersion}`);
    tdVer.textContent = parts.join(" / ") || "—";

    const tdContact = document.createElement("td");
    tdContact.textContent = it.contact || "—";

    const tdTime = document.createElement("td");
    tdTime.textContent = formatTime(it.createdAt);

    const tdStatus = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${it.resolved ? "badge--ok" : "badge--warn"}`;
    badge.textContent = it.resolved ? "已处理" : "待处理";
    tdStatus.appendChild(badge);

    const tdOps = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn--ghost";
    btn.textContent = it.resolved ? "标记未处理" : "标记已处理";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await patchJson(`/api/admin/feedback/${encodeURIComponent(it.id)}`, {
          resolved: !it.resolved,
        });
        await reload();
      } catch (err) {
        showToast("toast", `${err instanceof Error ? err.message : String(err)}`, false);
      } finally {
        btn.disabled = false;
      }
    });
    tdOps.appendChild(btn);

    tr.appendChild(tdType);
    tr.appendChild(tdTitle);
    tr.appendChild(tdContent);
    tr.appendChild(tdAttach);
    tr.appendChild(tdVer);
    tr.appendChild(tdContact);
    tr.appendChild(tdTime);
    tr.appendChild(tdStatus);
    tr.appendChild(tdOps);
    tbody.appendChild(tr);
  }
}

async function getMe() {
  if (window.__SITE_AUTH_PROMISE) {
    return await window.__SITE_AUTH_PROMISE;
  }
  try {
    const data = await fetchJson("/api/auth/me");
    return data.user || null;
  } catch {
    return null;
  }
}

function notifyAuthChanged(user) {
  window.dispatchEvent(
    new CustomEvent("site:auth-changed", {
      detail: { user: user || null },
    }),
  );
}

function getProfileUrl(user = state.me) {
  return user?.profileUrl || "/";
}

function redirectToProfile(user = state.me) {
  window.location.replace(getProfileUrl(user));
}

function getPermissionLevel(user = state.me) {
  const level = Number(user?.permissionLevel || 0);
  return Number.isFinite(level) ? level : 0;
}

function canAccessPreview(user = state.me) {
  return getPermissionLevel(user) >= 2;
}

function canManageSite(user = state.me) {
  return getPermissionLevel(user) >= 3;
}

function wallTypeLabel(wallType) {
  if (wallType === "developer") return "开发者墙";
  if (wallType === "sponsor") return "赞助者墙";
  return "不展示";
}

function syncPermissionView(user = state.me) {
  const preview = el("preview-access");
  const accounts = el("accounts-section");
  const mods = el("mods-section");
  const changelog = el("changelog-section");
  if (preview) preview.hidden = !canAccessPreview(user);
  if (accounts) accounts.hidden = !canManageSite(user);
  if (mods) mods.hidden = !canManageSite(user);
  if (changelog) changelog.hidden = !canManageSite(user);
}

function setView(state) {
  el("login-panel").hidden = state !== "login";
  el("pw-panel").hidden = state !== "changePw";
  el("admin-panel").hidden = state !== "admin";
}

function setupPasswordToggles() {
  document.querySelectorAll('[data-toggle-password="1"]').forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const wrapper = button.closest(".password-field");
    const input = wrapper?.querySelector("input");
    if (!(input instanceof HTMLInputElement)) return;

    button.addEventListener("click", () => {
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      button.textContent = isHidden ? "🙈" : "👁";
      button.setAttribute("aria-label", isHidden ? "隐藏密码" : "显示密码");
    });
  });
}

function renderUserItems(items, onDelete) {
  const table = el("users-table");
  if (!(table instanceof HTMLTableElement)) return;
  const tbody = table.querySelector("tbody");
  if (!(tbody instanceof HTMLTableSectionElement)) return;
  tbody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");
    const displayName = item.displayName || item.username || "—";
    const roleText = `${item.roleName || "游客"} / ${item.permissionLevel || 0}级`;
    const wallText = wallTypeLabel(item.wallType);
    const intro = item.intro || "—";
    const firstLoginText = item.mustChangePassword ? "待首次改密" : "已激活";
    const lastLoginText = formatTime(item.lastLoginAt);
    const canDelete = !item.developerSlug && item.username !== state.me?.username;

    const cells = [
      `<img src="${escapeHtml(item.avatar || "/assets/logo.png")}" alt="${escapeHtml(displayName)}头像" style="width:32px;height:32px;border-radius:8px;object-fit:cover;border:1px solid rgba(255,255,255,0.12);" onerror="this.onerror=null;this.src='/assets/logo.png';" />`,
      `${escapeHtml(displayName)}${item.developerSlug ? `<div class="hint">开发者：${escapeHtml(item.developerSlug)}</div>` : ""}`,
      escapeHtml(item.username || "—"),
      `${escapeHtml(roleText)}${item.qq ? `<div class="hint">QQ：${escapeHtml(item.qq)}</div>` : ""}`,
      escapeHtml(wallText),
      escapeHtml(intro),
      escapeHtml(firstLoginText),
      escapeHtml(lastLoginText),
      canDelete
        ? `<button class="btn btn--ghost" type="button" data-delete-user="${escapeHtml(item.username || "")}">删除</button>`
        : `<span class="hint">不可删除</span>`,
    ];

    cells.forEach((html) => {
      const td = document.createElement("td");
      td.innerHTML = html;
      tr.appendChild(td);
    });
    const deleteButton = tr.querySelector("[data-delete-user]");
    if (deleteButton instanceof HTMLButtonElement && typeof onDelete === "function") {
      deleteButton.addEventListener("click", () => onDelete(item));
    }
    tbody.appendChild(tr);
  }
}

function setupUsersManager() {
  const toggleButton = el("toggle-user-form");
  const formWrap = el("user-form-wrap");
  const form = el("user-form");
  const usernameInput = el("user-username");
  const displayNameInput = el("user-display-name");
  const introInput = el("user-intro");
  const roleInput = el("user-role");
  const wallTypeInput = el("user-wall-type");
  const avatarInput = el("user-avatar");
  if (
    !(toggleButton instanceof HTMLButtonElement) ||
    !(formWrap instanceof HTMLElement) ||
    !(form instanceof HTMLFormElement) ||
    !(usernameInput instanceof HTMLInputElement) ||
    !(displayNameInput instanceof HTMLInputElement) ||
    !(introInput instanceof HTMLInputElement) ||
    !(roleInput instanceof HTMLSelectElement) ||
    !(wallTypeInput instanceof HTMLSelectElement) ||
    !(avatarInput instanceof HTMLInputElement)
  ) {
    return null;
  }

  function syncRoleWallType() {
    if (roleInput.value === "sponsor" && wallTypeInput.value === "none") {
      wallTypeInput.value = "sponsor";
      return;
    }
    if ((roleInput.value === "admin" || roleInput.value === "service") && wallTypeInput.value === "sponsor") {
      wallTypeInput.value = "developer";
    }
  }

  function toggleForm(forceOpen) {
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !formWrap.classList.contains("is-open");
    formWrap.classList.toggle("is-open", shouldOpen);
    const chev = toggleButton.querySelector(".collapse__chev");
    if (chev) chev.textContent = shouldOpen ? "▴" : "▾";
  }

  async function uploadAvatar(username, file) {
    const buf = await file.arrayBuffer();
    return fetchJson(`/api/admin/users/${encodeURIComponent(username)}/avatar`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
      },
      body: buf,
    });
  }

  async function refresh() {
    if (!canManageSite()) return;
    const data = await fetchJson("/api/admin/users");
    renderUserItems(Array.isArray(data.items) ? data.items : [], async (item) => {
      const ok = window.confirm(`确认删除账户 ${item.displayName || item.username} 吗？删除后会同步从墙面移除。`);
      if (!ok) return;
      showToast("user-toast", "删除中…", true);
      try {
        await deleteJson(`/api/admin/users/${encodeURIComponent(item.username || "")}`);
        await refresh();
        if (state.changelogManager) {
          void state.changelogManager.refresh();
        }
        showToast("user-toast", "账户已删除，首页墙面会同步更新。", true);
      } catch (err) {
        showToast("user-toast", `删除失败：${err instanceof Error ? err.message : String(err)}`, false);
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const avatarFile = avatarInput.files && avatarInput.files[0] ? avatarInput.files[0] : null;
    if (avatarFile && avatarFile.size > 10 * 1024 * 1024) {
      showToast("user-toast", "头像大小不能超过 10MB。", false);
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
    try {
      const created = await postJson("/api/admin/users", {
        username: usernameInput.value.trim(),
        displayName: displayNameInput.value.trim(),
        intro: introInput.value.trim(),
        roleKey: roleInput.value,
        wallType: wallTypeInput.value,
      });
      if (avatarFile) {
        await uploadAvatar(created.user?.username || usernameInput.value.trim(), avatarFile);
      }
      form.reset();
      roleInput.value = "guest";
      wallTypeInput.value = "none";
      avatarInput.value = "";
      toggleForm(false);
      await refresh();
      showToast("user-toast", "账户已创建，初始密码与账户名相同，首次登录需修改。", true);
    } catch (err) {
      showToast(
        "user-toast",
        `添加失败：${err instanceof Error ? err.message : String(err)}`,
        false,
      );
    } finally {
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
    }
  });

  roleInput.value = "guest";
  wallTypeInput.value = "none";
  toggleButton.addEventListener("click", () => toggleForm());
  roleInput.addEventListener("change", syncRoleWallType);
  syncRoleWallType();
  return { refresh };
}

async function reload() {
  try {
    showToast("toast", "", true);
    const data = await fetchJson("/api/admin/feedback");
    const items = Array.isArray(data.items) ? data.items : [];
    render(items);
    showToast("toast", `已加载 ${items.length} 条反馈`, true);
  } catch (err) {
    showToast("toast", `加载失败：${err instanceof Error ? err.message : String(err)}`, false);
  }
}

function setupModsManager() {
  const branchSel = el("mods-branch");
  const btnRefresh = el("mods-refresh");
  const status = el("mods-status");
  const dropzone = el("mods-dropzone");
  const fileInput = el("mods-file");
  const picked = el("mods-picked");
  const listEl = el("mods-list");
  const selectedEl = el("mods-selected");
  const linksEl = el("mods-links");
  const btnAddLink = el("mods-add-link");
  const descInput = el("mods-description");
  const btnUpload = el("mods-upload");
  const btnSave = el("mods-save");
  const btnClear = el("mods-clear");

  if (
    !branchSel ||
    !btnRefresh ||
    !status ||
    !dropzone ||
    !fileInput ||
    !picked ||
    !listEl ||
    !selectedEl ||
    !linksEl ||
    !btnAddLink ||
    !descInput ||
    !btnUpload ||
    !btnSave ||
    !btnClear
  ) {
    return null;
  }

  const state = {
    branch: "main",
    pickedFile: null,
    selectedFileName: "",
    externalMap: new Map(),
    mods: [],
  };

  function setStatus(text, ok) {
    status.textContent = text || "";
    status.style.color = ok ? "rgba(34,197,94,0.9)" : "rgba(245,158,11,0.9)";
  }

  function pickFile(file) {
    state.pickedFile = file || null;
    picked.textContent = state.pickedFile ? `已选择：${state.pickedFile.name}` : "未选择文件";
  }

  function normalizeLinks(meta) {
    if (Array.isArray(meta?.links)) {
      return meta.links
        .map((item, index) => {
          const url = typeof item?.url === "string" ? item.url.trim() : "";
          if (!url) return null;
          const label = typeof item?.label === "string" && item.label.trim()
            ? item.label.trim()
            : `站外下载 ${index + 1}`;
          return { label, url };
        })
        .filter(Boolean);
    }
    const fallback = typeof meta?.externalUrl === "string" ? meta.externalUrl.trim() : "";
    return fallback ? [{ label: "站外下载 1", url: fallback }] : [];
  }

  function createLinkRow(link = {}) {
    const row = document.createElement("div");
    row.className = "link-editor__row";
    row.innerHTML =
      `<input class="input" data-link-label="1" maxlength="40" placeholder="按钮名称，例如 蓝奏云 / 夸克 / 主线路" />` +
      `<input class="input" data-link-url="1" placeholder="https://..." />` +
      `<button class="btn btn--ghost" type="button" data-link-remove="1">删除</button>`;
    const labelInput = row.querySelector('[data-link-label="1"]');
    const urlInput = row.querySelector('[data-link-url="1"]');
    if (labelInput instanceof HTMLInputElement) labelInput.value = link.label || "";
    if (urlInput instanceof HTMLInputElement) urlInput.value = link.url || "";
    row.querySelector('[data-link-remove="1"]').addEventListener("click", () => {
      row.remove();
      if (linksEl.children.length === 0) {
        createEmptyLinkRow();
      }
    });
    linksEl.appendChild(row);
  }

  function createEmptyLinkRow() {
    createLinkRow({ label: "", url: "" });
  }

  function renderLinkRows(links) {
    linksEl.innerHTML = "";
    if (!Array.isArray(links) || links.length === 0) {
      createEmptyLinkRow();
      return;
    }
    links.forEach((link) => createLinkRow(link));
  }

  function collectLinks() {
    return Array.from(linksEl.querySelectorAll(".link-editor__row"))
      .map((row) => {
        const labelInput = row.querySelector('[data-link-label="1"]');
        const urlInput = row.querySelector('[data-link-url="1"]');
        const label =
          labelInput instanceof HTMLInputElement ? labelInput.value.trim() : "";
        const url = urlInput instanceof HTMLInputElement ? urlInput.value.trim() : "";
        if (!label && !url) return null;
        return { label, url };
      })
      .filter(Boolean);
  }

  function renderLinksPreview(links) {
    if (!Array.isArray(links) || links.length === 0) return "";
    return (
      `<div class="button-row">` +
      links
        .map(
          (link) =>
            `<a class="btn btn--ghost" href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`,
        )
        .join("") +
      `</div>`
    );
  }

  function selectMod(fileName) {
    state.selectedFileName = fileName;
    selectedEl.textContent = fileName ? `当前选择：${fileName}` : "未选择条目";
    const meta = state.externalMap.get(fileName) || null;
    descInput.value = meta?.description || "";
    renderLinkRows(normalizeLinks(meta));
  }

  function renderMods() {
    listEl.innerHTML = "";
    if (!Array.isArray(state.mods) || state.mods.length === 0) {
      listEl.innerHTML = `<div class="muted">暂无 mod（可拖拽上传 jar/zip）</div>`;
      return;
    }

    for (const mod of state.mods) {
      const fileName = String(mod.fileName || "");
      const version = escapeHtml(mod.versionGuess || fileName || "—");
      const size = formatBytes(mod.sizeBytes);
      const date = formatDate(mod.mtimeMs);
      const description = escapeHtml(mod.description || "");
      const links = normalizeLinks(mod);

      const row = document.createElement("div");
      row.className = "history__item";
      row.innerHTML =
        `<div class="history__left">` +
        `<div class="history__name">${version}</div>` +
        `<div class="history__meta"><span>📦 ${size}</span><span>📅 ${date}</span></div>` +
        (description ? `<div class="hint" style="margin-top:6px;">${description}</div>` : "") +
        `</div>` +
        `<div class="button-row">` +
        `<button class="btn btn--ghost" type="button" data-pick="1">编辑</button>` +
        `<button class="btn btn--ghost" type="button" data-delete="1">删除</button>` +
        renderLinksPreview(links) +
        `</div>`;

      row.querySelector('button[data-pick="1"]').addEventListener("click", () => {
        selectMod(fileName);
        setStatus(`已选中：${fileName}`, true);
      });

      row.querySelector('button[data-delete="1"]').addEventListener("click", async () => {
        const ok = window.confirm(`确认删除 ${fileName} 吗？这会同时移除对应的站外链接配置。`);
        if (!ok) return;
        setStatus(`删除中：${fileName}`, true);
        try {
          await deleteJson(
            `/api/admin/mods?branch=${encodeURIComponent(state.branch)}&fileName=${encodeURIComponent(fileName)}`,
          );
          if (state.selectedFileName === fileName) {
            selectMod("");
          }
          await refreshAll();
          setStatus(`已删除：${fileName}`, true);
        } catch (err) {
          setStatus(err instanceof Error ? err.message : String(err), false);
        }
      });

      listEl.appendChild(row);
    }
  }

  async function loadBranches(preferredBranch = state.branch) {
    const data = await fetchJson("/api/branches");
    const branches = Array.isArray(data.branches) ? data.branches : ["main"];
    const nextBranch =
      branches.includes(preferredBranch) ? preferredBranch : branches[0] || "main";
    branchSel.innerHTML = "";
    for (const b of branches) {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = formatBranchLabel(b);
      branchSel.appendChild(opt);
    }
    branchSel.value = nextBranch;
    state.branch = nextBranch;
  }

  async function loadExternalMap() {
    const data = await fetchJson(`/api/admin/mods/external?branch=${encodeURIComponent(state.branch)}`);
    const items = Array.isArray(data.items) ? data.items : [];
    state.externalMap = new Map(items.map((x) => [x.fileName, x]));
  }

  async function loadMods() {
    const data = await fetchJson(`/api/mods?branch=${encodeURIComponent(state.branch)}`);
    state.mods = Array.isArray(data.mods) ? data.mods : [];
  }

  async function refreshAll(preferredBranch = state.branch) {
    setStatus("加载中…", true);
    try {
      await loadBranches(preferredBranch);
      await Promise.all([loadExternalMap(), loadMods()]);
      if (state.selectedFileName && !state.mods.some((m) => m.fileName === state.selectedFileName)) {
        selectMod("");
      }
      renderMods();
      setStatus(`已加载 ${state.mods.length} 个条目`, true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), false);
    }
  }

  branchSel.addEventListener("change", async () => {
    state.branch = branchSel.value || "main";
    selectMod("");
    await refreshAll(state.branch);
  });

  btnRefresh.addEventListener("click", refreshAll);
  btnAddLink.addEventListener("click", () => {
    createLinkRow({ label: "", url: "" });
  });

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    pickFile(f);
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-over");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-over");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
    const dt = e.dataTransfer;
    const f = dt && dt.files && dt.files[0] ? dt.files[0] : null;
    if (f) pickFile(f);
  });

  btnUpload.addEventListener("click", async () => {
    if (!state.pickedFile) {
      setStatus("请先选择文件", false);
      return;
    }
    const name = state.pickedFile.name || "";
    if (!/\.(zip|jar)$/i.test(name)) {
      setStatus("只允许上传 .jar 或 .zip", false);
      return;
    }
    btnUpload.disabled = true;
    setStatus("上传中…", true);
    try {
      const buf = await state.pickedFile.arrayBuffer();
      await fetchJson(`/api/admin/mods/upload?branch=${encodeURIComponent(state.branch)}`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-file-name": encodeURIComponent(name),
        },
        body: buf,
      });
      setStatus(`上传成功：${name}`, true);
      pickFile(null);
      await refreshAll();
      selectMod(name);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), false);
    } finally {
      btnUpload.disabled = false;
    }
  });

  btnSave.addEventListener("click", async () => {
    if (!state.selectedFileName) {
      setStatus("请先在列表里点“编辑”选中一个条目", false);
      return;
    }
    btnSave.disabled = true;
    setStatus("保存中…", true);
    try {
      const links = collectLinks();
      await postJson("/api/admin/mods/external", {
        branch: state.branch,
        fileName: state.selectedFileName,
        links,
        description: descInput.value.trim(),
      });
      await refreshAll();
      selectMod(state.selectedFileName);
      setStatus("保存成功", true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), false);
    } finally {
      btnSave.disabled = false;
    }
  });

  btnClear.addEventListener("click", async () => {
    if (!state.selectedFileName) {
      setStatus("请先在列表里点“编辑”选中一个条目", false);
      return;
    }
    descInput.value = "";
    renderLinkRows([]);
    btnClear.disabled = true;
    setStatus("清空中…", true);
    try {
      await postJson("/api/admin/mods/external", {
        branch: state.branch,
        fileName: state.selectedFileName,
        links: [],
        description: "",
      });
      await refreshAll();
      selectMod(state.selectedFileName);
      setStatus("已清空", true);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), false);
    } finally {
      btnClear.disabled = false;
    }
  });

  renderLinkRows([]);
  return { refreshAll };
}

function setupChangelogManager() {
  const form = el("changelog-form");
  const dateInput = el("changelog-date");
  const versionInput = el("changelog-version");
  const titleInput = el("changelog-title");
  const summaryInput = el("changelog-summary");
  const list = el("changelog-admin-list");
  if (
    !(form instanceof HTMLFormElement) ||
    !(dateInput instanceof HTMLInputElement) ||
    !(versionInput instanceof HTMLInputElement) ||
    !(titleInput instanceof HTMLInputElement) ||
    !(summaryInput instanceof HTMLTextAreaElement) ||
    !(list instanceof HTMLElement)
  ) {
    return null;
  }

  function todayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function renderItems(items) {
    list.innerHTML = "";
    if (!Array.isArray(items) || items.length === 0) {
      list.innerHTML =
        `<div class="history__item"><div class="history__left"><div class="history__name">暂无更新日志</div></div></div>`;
      return;
    }

    for (const item of items) {
      const row = document.createElement("div");
      row.className = "history__item history__item--stack";
      row.innerHTML =
        `<div class="history__left">` +
        `<div class="history__meta"><span>📅 ${escapeHtml(item.date || "—")}</span>${item.version ? `<span>🏷 ${escapeHtml(item.version)}</span>` : ""}</div>` +
        `<div class="history__name" style="margin-top:8px;">${escapeHtml(item.title || "未命名日志")}</div>` +
        `<div class="hint" style="margin-top:6px;">${escapeHtml(item.summary || "")}</div>` +
        `</div>` +
        `<div class="button-row"><button class="btn btn--ghost" type="button" data-delete-log="${escapeHtml(item.id || "")}">删除</button></div>`;
      const deleteButton = row.querySelector("[data-delete-log]");
      if (deleteButton instanceof HTMLButtonElement) {
        deleteButton.addEventListener("click", async () => {
          const ok = window.confirm(`确认删除日志“${item.title || "未命名日志"}”吗？`);
          if (!ok) return;
          try {
            await deleteJson(`/api/admin/changelog/${encodeURIComponent(item.id || "")}`);
            await refresh();
            showToast("changelog-toast", "日志已删除，首页会同步更新。", true);
          } catch (err) {
            showToast("changelog-toast", `删除失败：${err instanceof Error ? err.message : String(err)}`, false);
          }
        });
      }
      list.appendChild(row);
    }
  }

  async function refresh() {
    const data = await fetchJson("/api/admin/changelog");
    renderItems(Array.isArray(data.items) ? data.items : []);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
    try {
      await postJson("/api/admin/changelog", {
        date: dateInput.value || todayString(),
        version: versionInput.value.trim(),
        title: titleInput.value.trim(),
        summary: summaryInput.value.trim(),
      });
      form.reset();
      dateInput.value = todayString();
      await refresh();
      showToast("changelog-toast", "更新日志已添加，首页导航会同步展示。", true);
    } catch (err) {
      showToast("changelog-toast", `添加失败：${err instanceof Error ? err.message : String(err)}`, false);
    } finally {
      if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
    }
  });

  dateInput.value = todayString();
  return { refresh };
}

async function boot() {
  const me = await getMe();
  state.me = me;
  syncPermissionView(me);
  if (!me) {
    setView("login");
    return;
  }
  if (!canManageSite(me)) {
    notifyAuthChanged(me);
    redirectToProfile(me);
    return;
  }

  el("me").textContent = `当前登录：${me.displayName || me.username} / ${me.roleName || "游客"} / ${getPermissionLevel(me)}级权限`;
  setView("admin");
  if (me.mustChangePassword) {
    setView("changePw");
    showToast("pw-toast", "检测到默认密码未修改，请先修改密码。", false);
  } else {
    await reload();
    if (!state.usersManager) state.usersManager = setupUsersManager();
    if (!state.modsManager) state.modsManager = setupModsManager();
    if (!state.changelogManager) state.changelogManager = setupChangelogManager();
    if (canManageSite(me) && state.usersManager) {
      await state.usersManager.refresh();
    }
    if (canManageSite(me) && state.modsManager) {
      await state.modsManager.refreshAll();
    }
    if (canManageSite(me) && state.changelogManager) {
      await state.changelogManager.refresh();
    }
  }
}

el("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const username = String(fd.get("username") || "").trim();
  const password = String(fd.get("password") || "");

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn instanceof HTMLButtonElement) btn.disabled = true;

  try {
    const data = await postJson("/api/auth/login", { username, password });
    if (!data.ok) throw new Error("登录失败");
    const nextUser = data.user || null;
    notifyAuthChanged(nextUser);
    if (nextUser && !canManageSite(nextUser)) {
      showToast("login-toast", "该账户无反馈后台权限，正在跳转到个人主页。", true);
      redirectToProfile(nextUser);
      return;
    }
    showToast("login-toast", "登录成功", true);
    await waitForPageTransition;
    await boot();
  } catch (err) {
    showToast(
      "login-toast",
      `登录失败：${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  } finally {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
  }
});

el("pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const oldPassword = String(fd.get("oldPassword") || "");
  const newPassword = String(fd.get("newPassword") || "");

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn instanceof HTMLButtonElement) btn.disabled = true;

  try {
    await postJson("/api/auth/change-password", { oldPassword, newPassword });
    showToast("pw-toast", "密码修改成功", true);
    await waitForPageTransition;
    await boot();
  } catch (err) {
    showToast(
      "pw-toast",
      `修改失败：${err instanceof Error ? err.message : String(err)}`,
      false,
    );
  } finally {
    if (btn instanceof HTMLButtonElement) btn.disabled = false;
  }
});

el("reload").addEventListener("click", reload);

setupPasswordToggles();
await waitForPageTransition;
await boot();
