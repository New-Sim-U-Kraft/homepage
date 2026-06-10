// P4:反馈提交 + 附件上传(公开,无需登录)。
import { Hono } from "hono";
import {
  isValidFeedbackDraftId, isValidImageFileName, isValidFeedbackFileName,
  randomId, nowIso,
} from "../lib/content.js";

const r = new Hono();

function sanitizeFeedbackAttachments(value, kind, draftId) {
  if (!Array.isArray(value) || !isValidFeedbackDraftId(draftId)) return [];
  const subDir = kind === "image" ? "images" : "files";
  const prefix = `/uploads/feedback/${encodeURIComponent(draftId)}/${subDir}/`;
  const out = [];
  for (const item of value) {
    if (out.length >= 8) break;
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const valid = kind === "image" ? isValidImageFileName(name) : isValidFeedbackFileName(name);
    if (!valid) continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!url.startsWith(prefix)) continue;
    const size = Number(item.size);
    out.push({ kind, name, url, size: Number.isFinite(size) && size > 0 ? size : 0 });
  }
  return out;
}

// 提交反馈
r.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const draftId = String(body.draftId || "").trim();
  const type = body.type === "bug" ? "bug" : "suggestion";
  const images = type === "bug" ? sanitizeFeedbackAttachments(body.images, "image", draftId) : [];
  const files = type === "bug" ? sanitizeFeedbackAttachments(body.files, "file", draftId) : [];
  const title = (typeof body.title === "string" ? body.title.trim() : "").slice(0, 80);
  const content = (typeof body.content === "string" ? body.content.trim() : "").slice(0, 4000);
  if (!title || !content) return c.json({ ok: false, error: "请填写标题和详细描述" }, 400);

  const id = isValidFeedbackDraftId(draftId) ? draftId : randomId();
  const rec = {
    id, createdAt: nowIso(), type, title, content,
    contact: (typeof body.contact === "string" ? body.contact.trim() : "").slice(0, 80),
    gameVersion: (typeof body.gameVersion === "string" ? body.gameVersion.trim() : "").slice(0, 40),
    modVersion: (typeof body.modVersion === "string" ? body.modVersion.trim() : "").slice(0, 60),
    images, files, resolved: false,
    meta: { ip: c.req.header("CF-Connecting-IP") || "", ua: c.req.header("user-agent") || "" },
  };
  await c.env.DB.prepare("INSERT OR REPLACE INTO feedback (id, data, resolved, created_at) VALUES (?,?,0,?)")
    .bind(id, JSON.stringify(rec), rec.createdAt).run();
  // 上限 1000
  const all = await c.env.DB.prepare("SELECT id FROM feedback ORDER BY created_at DESC").all();
  for (const row of (all.results || []).slice(1000)) {
    await c.env.DB.prepare("DELETE FROM feedback WHERE id = ?").bind(row.id).run();
  }
  return c.json({ ok: true, id });
});

// 附件上传(二进制)
r.post("/upload", async (c) => {
  const kind = c.req.query("kind") === "image" ? "image" : c.req.query("kind") === "file" ? "file" : "";
  const draftId = String(c.req.query("draftId") || "").trim();
  if (!kind || !isValidFeedbackDraftId(draftId)) return c.json({ ok: false, error: "无效上传参数" }, 400);
  const fileName = decodeURIComponent(c.req.header("x-file-name") || "").trim();
  const valid = kind === "image" ? isValidImageFileName(fileName) : isValidFeedbackFileName(fileName);
  if (!valid) return c.json({ ok: false, error: "文件名或格式无效" }, 400);
  const buf = await c.req.arrayBuffer();
  if (!buf || buf.byteLength === 0) return c.json({ ok: false, error: "上传文件为空" }, 400);
  const limit = kind === "image" ? 10 * 1024 * 1024 : 20 * 1024 * 1024;
  if (buf.byteLength > limit) return c.json({ ok: false, error: kind === "image" ? "图片不能超过 10MB" : "文件不能超过 20MB" }, 400);

  const subDir = kind === "image" ? "images" : "files";
  const key = `uploads/feedback/${draftId}/${subDir}/${fileName}`;
  await c.env.R2.put(key, buf);
  return c.json({
    ok: true,
    attachment: {
      kind, name: fileName, size: buf.byteLength,
      url: `/uploads/feedback/${encodeURIComponent(draftId)}/${subDir}/${encodeURIComponent(fileName)}`,
    },
  });
});

export default r;
