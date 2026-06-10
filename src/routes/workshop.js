// P4/P5:工坊投稿 + NBT 上传 + NBT 预览。
import { Hono } from "hono";
import { requireAuth } from "../lib/rbac.js";
import {
  isValidFeedbackDraftId, isValidWorkshopFileName, normalizeWorkshopCategory,
  sanitizeWorkshopFiles, sanitizeWorkshopExternalLinks, buildWorkshopItemPayload,
  workshopRowToEntry, randomId, nowIso,
} from "../lib/content.js";
import { sanitizeNbtPreviewValue, extractWorkshopRenderModel, parseNbtBuffer } from "../lib/nbt.js";

const r = new Hono();

// NBT 上传(二进制)
r.post("/upload", requireAuth(), async (c) => {
  const kind = c.req.query("kind") === "nbt" ? "nbt" : "";
  const draftId = String(c.req.query("draftId") || "").trim();
  if (!kind || !isValidFeedbackDraftId(draftId)) return c.json({ ok: false, error: "无效上传参数" }, 400);
  const fileName = decodeURIComponent(c.req.header("x-file-name") || "").trim();
  if (!isValidWorkshopFileName(kind, fileName)) return c.json({ ok: false, error: "创意工坊现在只支持上传 .nbt 文件" }, 400);
  const buf = await c.req.arrayBuffer();
  if (!buf || buf.byteLength === 0) return c.json({ ok: false, error: "上传文件为空" }, 400);
  if (buf.byteLength > 30 * 1024 * 1024) return c.json({ ok: false, error: "单个创意工坊文件不能超过 30MB" }, 400);

  const key = `uploads/workshop/${draftId}/${kind}/${fileName}`;
  await c.env.R2.put(key, buf, { httpMetadata: { contentType: "application/octet-stream" } });
  return c.json({
    ok: true,
    attachment: {
      kind, name: fileName, size: buf.byteLength,
      url: `/uploads/workshop/${encodeURIComponent(draftId)}/${kind}/${encodeURIComponent(fileName)}`,
    },
  });
});

// 投稿提交
r.post("/", requireAuth(), async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const draftId = String(body.draftId || "").trim();
  if (!isValidFeedbackDraftId(draftId)) return c.json({ ok: false, error: "投稿编号无效,请重新选择文件后再提交" }, 400);
  const category = normalizeWorkshopCategory(body.category);
  if (!category) return c.json({ ok: false, error: "请选择创意工坊分类" }, 400);
  const title = (typeof body.title === "string" ? body.title.trim() : "").slice(0, 60);
  const description = (typeof body.description === "string" ? body.description.trim() : "").slice(0, 1200);
  if (!title || !description) return c.json({ ok: false, error: "请填写作品名称和描述介绍" }, 400);
  const files = sanitizeWorkshopFiles(body.files, category, draftId);
  if (!files) return c.json({ ok: false, error: "当前投稿必须上传 NBT 文件" }, 400);
  const externalLinks = sanitizeWorkshopExternalLinks(body.externalLinks);
  if (Array.isArray(body.externalLinks) && body.externalLinks.length && externalLinks.length === 0) {
    return c.json({ ok: false, error: "外链格式无效,请检查链接地址" }, 400);
  }

  const id = randomId();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO workshop_items (id, draft_id, title, category, description, files, external_links,
       author_username, author_display_name, status, review_reason, reviewed_by,
       created_at, updated_at, reviewed_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '', ?, ?, NULL, NULL)`
  ).bind(id, draftId, title, category, description, JSON.stringify(files), JSON.stringify(externalLinks),
    user.username, (user.display_name || user.username).slice(0, 40), now, now).run();
  // 上限 2000:删旧
  const all = await c.env.DB.prepare("SELECT id FROM workshop_items ORDER BY created_at DESC").all();
  for (const row of (all.results || []).slice(2000)) {
    await c.env.DB.prepare("DELETE FROM workshop_items WHERE id = ?").bind(row.id).run();
  }
  const row = await c.env.DB.prepare("SELECT * FROM workshop_items WHERE id = ?").bind(id).first();
  return c.json({ ok: true, item: buildWorkshopItemPayload(workshopRowToEntry(row), new Map([[user.username, user]])) });
});

// NBT 预览(公开)
r.get("/nbt-preview", async (c) => {
  const fileUrl = (c.req.query("url") || "").trim();
  if (!fileUrl || !/\.nbt$/i.test(fileUrl)) return c.json({ ok: false, error: "NBT 文件地址无效" }, 400);
  if (!fileUrl.startsWith("/uploads/workshop/")) return c.json({ ok: false, error: "NBT 文件路径无效" }, 400);
  // url -> R2 key:去前导 /,逐段 decode
  const key = fileUrl.replace(/^\/+/, "").split("/").map(decodeURIComponent).join("/");
  try {
    const obj = await c.env.R2.get(key);
    if (!obj) return c.json({ ok: false, error: "NBT 解析失败,可能不是有效的结构文件" }, 400);
    const rawSimplified = await parseNbtBuffer(await obj.arrayBuffer());
    return c.json({
      ok: true, type: "big", fileUrl,
      fileName: key.split("/").pop(),
      preview: sanitizeNbtPreviewValue(rawSimplified),
      renderModel: extractWorkshopRenderModel(rawSimplified),
    });
  } catch {
    return c.json({ ok: false, error: "NBT 解析失败,可能不是有效的结构文件" }, 400);
  }
});

export default r;
