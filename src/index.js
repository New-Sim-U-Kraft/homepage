// NSUK Homepage —— Cloudflare Pages (Advanced 模式) 入口。Hono 应用。
import { Hono } from "hono";
import publicRoutes from "./routes/public.js";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import developersRoutes from "./routes/developers.js";
import workshopRoutes from "./routes/workshop.js";
import feedbackRoutes from "./routes/feedback.js";
import uploadsRoutes from "./routes/uploads.js";

const app = new Hono();

// 健康检查 + 绑定自检
app.get("/healthz", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get("/api/_ping", async (c) => {
  const out = { bindings: { DB: !!c.env.DB, KV: !!c.env.KV, R2: !!c.env.R2 } };
  try {
    const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM roles").first();
    out.roles = r?.n ?? 0;
    const su = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role_key='superadmin'").first();
    out.superadminConfigured = (su?.n ?? 0) > 0; // 仅暴露是否已配置,不泄露用户名
  } catch (e) { out.dbError = String(e); }
  return c.json(out);
});

// 业务路由(更具体的前缀先挂)
app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/developers", developersRoutes);
app.route("/api/workshop", workshopRoutes);
app.route("/api/feedback", feedbackRoutes);
app.route("/api", publicRoutes);
app.route("/uploads", uploadsRoutes);

// 静态资源回落(public/ 下的 html/css/assets/vendor)
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
