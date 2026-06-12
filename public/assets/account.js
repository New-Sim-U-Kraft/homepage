// 账户设置:自助改资料 / 头像 / 密码。
const el = (id) => document.getElementById(id);
function toast(id, msg, ok) {
  if (window.siteToast) window.siteToast(msg, ok ? "success" : "error");
  const t = el(id);
  if (!t) return;
  t.textContent = msg;
  t.style.color = ok ? "#16a34a" : "#dc2626";
}
async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error((data.error || "请求失败") + (data.ref ? `(错误码 ${data.ref})` : ""));
  return data;
}
const json = (url, method, body) => api(url, {
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

let me = null;

function fill(user) {
  me = user;
  el("account-who").textContent = `你好,${user.displayName || user.username}`;
  el("account-username").textContent = user.username;
  el("account-role").textContent = `${user.roleName}(L${user.level})`;
  el("account-display-name").value = user.displayName || "";
  el("account-qq").value = user.qq || "";
  el("account-intro").value = user.intro || "";
  el("account-avatar-preview").src = user.avatar || "/assets/logo.png";
}

async function boot() {
  let data;
  try {
    data = await api("/api/auth/me");
  } catch {
    data = { user: null };
  }
  if (!data.user) {
    el("account-who").textContent = "未登录";
    el("account-guard").hidden = false;
    el("account-body").hidden = true;
    return;
  }
  el("account-guard").hidden = true;
  el("account-body").hidden = false;
  fill(data.user);
}

// 保存资料
const profileForm = el("profile-form");
if (profileForm) {
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await json("/api/auth/profile", "PATCH", {
        displayName: el("account-display-name").value.trim(),
        qq: el("account-qq").value.trim(),
        intro: el("account-intro").value.trim(),
      });
      fill(data.user);
      toast("profile-toast", "资料已保存。", true);
      if (window.__SITE_REFRESH_AUTH) window.__SITE_REFRESH_AUTH();
    } catch (err) {
      toast("profile-toast", `保存失败:${err instanceof Error ? err.message : String(err)}`, false);
    }
  });
}

// 上传头像
const avatarFile = el("account-avatar-file");
if (avatarFile) {
  avatarFile.addEventListener("change", async () => {
    const file = avatarFile.files && avatarFile.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast("profile-toast", "头像不能超过 10MB。", false);
    try {
      const buf = await file.arrayBuffer();
      const data = await api("/api/auth/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
        body: buf,
      });
      fill(data.user);
      toast("profile-toast", "头像已更新。", true);
      if (window.__SITE_REFRESH_AUTH) window.__SITE_REFRESH_AUTH();
    } catch (err) {
      toast("profile-toast", `上传失败:${err instanceof Error ? err.message : String(err)}`, false);
    } finally {
      avatarFile.value = "";
    }
  });
}

// 改密码
const pwForm = el("password-form");
if (pwForm) {
  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await json("/api/auth/change-password", "POST", {
        oldPassword: el("account-old-password").value,
        newPassword: el("account-new-password").value,
      });
      el("account-old-password").value = "";
      el("account-new-password").value = "";
      toast("password-toast", "密码已修改。", true);
    } catch (err) {
      toast("password-toast", `修改失败:${err instanceof Error ? err.message : String(err)}`, false);
    }
  });
}

boot();
