# NSUK 官网

新模拟大都市官方站点。本分支是重构版本，与 `main` 无共同历史。

## 技术栈

Nuxt 4 + Nitro（`cloudflare_module`）+ Hono，跑在单个 Cloudflare Worker 上。

| 层 | 用途 |
|---|---|
| Nuxt / Nitro | 页面渲染与路由 |
| Hono | `/api/**` 全部业务接口 |
| D1 | 关系数据（用户档案、工坊、反馈、审计） |
| KV | 会话、JWKS 缓存、License 吊销名单 |
| R2 | 上传文件 |

身份认证由 [Prism](https://github.com/siiway/prism) 提供，官网不存任何凭据。

## 开始

```bash
pnpm install

# 首次：创建 Cloudflare 资源，把返回的 id 填进 wrangler.toml
wrangler d1 create nsuk
wrangler kv namespace create KV
wrangler r2 bucket create nsuk-uploads

# 本地库建表
pnpm db:migrate:local

# 本地 secret
cp .dev.vars.example .dev.vars

pnpm dev
```

访问 <http://localhost:3000>，首页会显示绑定自检结果。

## 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发服务器（含 D1/KV/R2 本地模拟） |
| `pnpm build` | 构建到 `.output/` |
| `pnpm preview` | 用 wrangler 跑构建产物 |
| `pnpm deploy` | 构建并部署 |
| `pnpm lint` / `lint:fix` | ESLint |
| `pnpm typecheck` | 类型检查 |
| `pnpm db:migrate:local` / `:remote` | 应用 D1 迁移 |

## 目录

```
app/                  前端（Nuxt 4 默认 srcDir）
server/
├── routes/api/       Nitro catch-all，转交 Hono
└── hono/
    ├── app.ts        Hono 应用与错误中间件
    ├── lib/          rbac 等共享逻辑
    └── routes/       业务路由
migrations/           D1 迁移，按序号应用
docs/                 设计文档
```

## 数据库

schema 只通过 `migrations/` 下的有序文件演进，**不在请求路径上建表**。新增迁移时序号连续、不复用。

## 文档

- [模组授权设计](docs/mod-authorization.md)

## 进度

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架、CI、迁移骨架 | ✅ |
| M1 | Prism 登录链路（D 组） | 等 Prism 侧适配 |
| M2 | 前台：首页 / 画廊 / 工坊 / 反馈 / 个人页 | |
| M3 | 管理后台 | |
| M4 | 模组授权（F 组） | |
| M5 | 切换上线 | |

官网不提供任何修改用户角色的入口 —— 角色由 Prism 团队身份组派生。
