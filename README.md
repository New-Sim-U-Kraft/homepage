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

- [部署](docs/deployment.md) —— 从零上线的完整步骤与验证清单
- [模组授权设计](docs/mod-authorization.md)

## 进度

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 | 脚手架、CI、迁移骨架 | ✅ |
| M1 | Prism 登录链路 | ✅ 代码完成，等配置值 |
| M2 | 前台：首页 / 工坊 / 画廊 / 开发者 / 个人页 / 反馈 | ✅ |
| M3 | 管理后台 | ✅ |
| M4 | 模组授权 + 审计 webhook | ✅ |
| M5 | 切换上线 | 待部署 |

### 上线前需要的配置

线上跑起来还差这些值（填进 `wrangler.toml` 与 secret）：

| 项 | 来源 |
|---|---|
| `database_id` / KV id | `wrangler d1 create` / `kv namespace create` |
| `PRISM_ISSUER` / `PRISM_CLIENT_ID` / `PRISM_TEAM_ID` | Prism 实例运营方 |
| `PRISM_CLIENT_SECRET` | 同上，用 `wrangler secret put` |
| `MOD_LICENSE_PRIVATE_KEY` | 自行生成 RSA 密钥对，公钥内置模组 |
| `WEBHOOK_SECRET` | 自定，同时配到 Prism 的团队 webhook header |

**官网应用必须创建在 NSUK 团队名下** —— 通过团队邀请链接注册的受限账号只能授权
来源团队及其后代拥有的应用，建在个人名下会导致这批用户在授权阶段被静默拒绝。

Prism 侧的 webhook 需要配置 general 类型，body 模板：

```json
{"event":"{event}","resource_id":"{resource_id}","scope_id":"{scope_id}","metadata":{metadata},"timestamp":"{timestamp}"}
```

订阅事件：`team.member.groups_change`、`team.member.remove`、`team.group.delete`。

官网不提供任何修改用户角色的入口 —— 角色由 Prism 团队身份组派生。
