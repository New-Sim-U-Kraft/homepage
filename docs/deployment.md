# 部署

从零把这个分支跑到线上需要的全部步骤。顺序不能打乱 —— Prism 应用必须先建在
NSUK 团队名下，否则受限账号在授权阶段会被静默拒绝。

---

## 一、创建 Cloudflare 资源

```bash
wrangler d1 create nsuk-new
wrangler kv namespace create KV
wrangler r2 bucket create nsuk-uploads-new
```

把返回的 `database_id` 与 KV `id` 填进 `wrangler.toml`，R2 桶名同样要与
`wrangler.toml` 里的 `bucket_name` 一致。

数据库名不必与这里一致 —— `pnpm db:*` 脚本用的是 **binding 名 `DB`**，
wrangler 支持按 binding 定位，所以改库名不需要同步 `package.json`。

## 二、在 Prism 侧建应用

**必须用团队应用的入口创建**（`POST /api/teams/:id/apps` 或团队页面的「新建应用」），
不能用个人应用入口。

原因见 Prism 的团队邀请链接注册方案 §8②：受限账号只能授权「来源团队及其后代
拥有的应用」。NSUK 用户绝大多数通过 `/join/<teamId>` 注册，属于受限账号；应用若
建在个人名下，这批人在 `/authorize` 阶段直接被拒，而且**没有任何面向用户的报错**，
只会表现为登录点了没反应。

| 项 | 值 |
|---|---|
| 客户端类型 | 机密（不勾「公共客户端」） |
| 重定向 URI | `https://<官网域名>/api/auth/callback` |
| 追加重定向 URI | `http://127.0.0.1:3000/api/auth/callback`（本地开发） |
| allowed_scopes | `openid` `profile` `email` `offline_access` |

`teams:read` 在创建时直接勾上即可。

> 若 Prism 实例早于 `4fcf53b`，团队应用创建端点会把 `teams:read` 静默丢弃
> （界面上勾了、保存成功、无报错，但没写进去）。这种情况需要建完后进应用详情页
> 再勾一次保存 —— 更新走 `PATCH /api/apps/:id`，不受该限制。

**漏配的表现**：所有人都能登录，但一律是游客，赞助者拿不到模组令牌，且没有任何
报错。官网对此有专门的诊断 —— Worker 日志出现
`ID token 里没有任何 in_team_* claim` 就是这个问题。

**关于过度授权**：`teams:read` 会带上用户全部团队的 membership claim。在 Prism 的
P1（应用预绑定团队的窄 scope）落地前没有更窄的选择 —— 单团队 scope 要求授权者是
团队 admin 以上，普通赞助者授不了。官网只读 `groups_in_team_<NSUK>`，其余一概忽略。

### 团队身份组

在 NSUK 团队开启 `enable_groups`，创建这些 slug（**创建后不可改**）：

| slug | 对应角色 | level |
|---|---|---|
| `sponsor` | 赞助者 | 1 |
| `staff` | 客服 | 2 |
| `developer` | 开发者 | 3 |
| `admin` | 管理员 | 4 |

没有任何 group 的成员是 `guest`（level 0），这是正常状态而非异常。

### 审计 webhook

团队 owner 在 `/api/audit/team/:teamId/webhooks` 创建 general 类型 webhook：

- URL：`https://<官网域名>/api/hooks/prism/audit`
- Header：`X-NSUK-Webhook-Secret: <与 WEBHOOK_SECRET 相同的值>`
- Body 模板（**一字不差地复制**）：

```json
{"action":"{action}","scope":"{scope}","scope_id":"{scope_id}","resource_type":"{resource_type}","resource_id":"{resource_id}","actor_id":"{actor_id}","metadata":{metadata},"timestamp":"{timestamp}"}
```

事件名的变量是 **`{action}`**，不是 `{event}`。Prism 的 `interpolate`
对未知占位符原样保留，写错变量名不会报错，只会让本站收到字面量 `"{event}"`
然后把每一条都当未知事件忽略 —— 两边都返回 200，链路静默失效。
本站对这种情况会记 error 并返回 400，部署后翻一眼日志即可确认。

`{metadata}` **不要加引号**：它插值出来已经是一个 JSON 对象字面量，
加了引号会变成字符串，解析不出 `added` / `removed`。

- 订阅事件（事件名以 Prism `worker/lib/audit.ts` 为准）：

| 事件 | 不订会怎样 |
|---|---|
| `team.member.groups_change` | 身份组增删完全感知不到 |
| `team.member.remove` | 被踢出团队的人不掉权限 |
| `team.member.leave` | **主动退团**的人不掉权限（与 remove 是两个事件） |
| `team.group.delete` | 身份组定义被删时无任何通知 |
| `team.member.account_deleted` | 注销的账号在本站仍显示为正常用户 |
| `admin.team.dissolve_started` | 团队进入解散流程时没有告警 |

用 glob `team.*` 一次订完更省事，未识别的事件本站会直接忽略。

账号注销要订的是 **`team.member.account_deleted`** 而不是 `user.account.deleted`
—— 本站 webhook 建在团队作用域下，用户作用域的事件未必会投递过来。

这个 webhook 不是可选优化：模组玩家可能长期不访问网页，`validate` 读的是本地
`role_key`，没有 webhook 就只能等 License 自然过期（最长 4 天）才失效。

### 对 Prism 的依赖与降级

以下三项在 Prism 侧未落地时，本站的行为：

| 依赖 | 未落地时 | 影响 |
|---|---|---|
| P1 应用预绑定团队的窄 scope | 用 `teams:read` | 属过度授权，ID token 会带上用户全部团队的 membership claim。本站只读 `groups_in_team_<NSUK>`，其余一概忽略 |
| `/join?continue=` 跨域回跳 | **当前不支持跨域** | 见下 |
| 账号删除审计事件 | 已按现有事件名订阅 | 若事件名变更，本站落到 `unhandled_event` 分支并返回 200，不会报错；注销的用户要到下次静默复查才被标记 |

三项都不阻塞上线。

关于 `continue`：Prism 的注册页（`src/pages/JoinRegister.tsx`）对该参数只接受
**同源**地址：

```js
const url = new URL(raw, window.location.origin)
return url.origin === window.location.origin ? url.toString() : null
```

`window.location.origin` 是 Prism 自己的域名，因此 `continue=https://<官网域名>/`
会被判为跨域而丢弃，用户注册完停在 Prism 页面。

参数照配不误（无害，Prism 放开跨域白名单后会自动生效），但**引导文案不能写
「完成后会自动跳回」**。要根治需要 Prism 侧支持一份回跳白名单 —— 例如允许回跳到
该团队已注册 OAuth 应用的 redirect_uri 域名，这样既不是开放重定向，也能覆盖
本站这种场景。

## 三、生成 License 签名密钥

```bash
node -e "
const {generateKeyPairSync}=require('crypto');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,
  privateKeyEncoding:{type:'pkcs8',format:'pem'},
  publicKeyEncoding:{type:'spki',format:'pem'}});
require('fs').writeFileSync('license-public.pem', publicKey);
console.log(privateKey.replace(/-----[^-]+-----/g,'').replace(/\s+/g,''));
"
```

输出的单行 base64 就是 `MOD_LICENSE_PRIVATE_KEY` 的值；`license-public.pem`
交给模组开发者内置进 jar。**私钥不要提交到任何仓库。**

密钥轮换意味着所有已签发的 License 立刻失效，且旧版模组无法验证新 License ——
只能随模组版本一起换。

## 四、写入配置

`wrangler.toml` 的 `[vars]`：

```toml
SITE_URL     = "https://<官网域名>"
PRISM_ISSUER = "https://<prism 域名>"
PRISM_CLIENT_ID = "<Client ID>"
PRISM_TEAM_ID   = "<NSUK 团队 ID>"
PRISM_JOIN_URL  = "https://<prism 域名>/join/<团队ID>?continue=https://<官网域名>/"
```

secrets：

```bash
wrangler secret put PRISM_CLIENT_SECRET
wrangler secret put MOD_LICENSE_PRIVATE_KEY
wrangler secret put WEBHOOK_SECRET
```

## 四点五、先在本地跑通（强烈建议）

登录链路涉及 Prism、回调地址、scope、身份组映射四处配合，任何一处错了线上都
只表现为「登录后是游客」。在本地把它跑通，比部署完再回头查便宜得多。

前提：第 1.2 步的重定向 URI 里已经加了 `http://127.0.0.1:3000/api/auth/callback`。

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars` 里填上真实值（这个文件已在 `.gitignore` 中）：

```
PRISM_CLIENT_SECRET="…"
MOD_LICENSE_PRIVATE_KEY="…"
WEBHOOK_SECRET="…"
PRISM_ISSUER="https://<prism 域名>"
PRISM_CLIENT_ID="…"
PRISM_TEAM_ID="…"
SITE_URL="http://localhost:3000"
```

`SITE_URL` 必须是 `http://localhost:3000` —— 它同时决定回调地址的拼法和
cookie 的 `Secure` 标志，填成 https 的话本地浏览器不会存 cookie，登录会静默失败。

```bash
pnpm db:migrate:local
pnpm dev
```

浏览器打开 <http://localhost:3000/account> → 用 Prism 登录，逐项确认：

- [ ] 能跳到 Prism 授权页并跳回来
- [ ] 账号中心显示的身份组与 Prism 里给你打的组一致
- [ ] 终端日志**没有** `没有任何 in_team_* claim`
- [ ] 给自己打上 `sponsor` 组 → 重新登录 → 模组授权区出现，能生成令牌
- [ ] 拿生成的令牌调一次 validate，应返回 License：

```bash
curl -X POST http://localhost:3000/api/mod/validate \
  -H "Content-Type: application/json" \
  -d '{"token":"<刚生成的令牌>","fingerprint":"local-test"}'
```

webhook 本地收不到（Prism 打不到 localhost），留到线上验。

## 五、建表与部署

### 5.1 建表（**必须手动，自动部署不会做**）

```bash
pnpm install
pnpm db:migrate:remote
```

在本地跑，通过 wrangler 连远程 D1。**Cloudflare 的 Git 自动部署只做构建与发布，
不会执行数据库迁移** —— 漏了这步部署照样成功，但接口一碰数据库就 500，
`/api/_ping` 会返回 `dbError: true`。

以后每次新增 migration 文件，合并后也都要手动跑一次。

不需要迁移旧数据 —— 旧库已放弃，空库起步。

### 5.2 部署

**方式 A：GitHub + Cloudflare 自动部署（当前采用）**

Dashboard → Workers → 该 Worker → Settings → Build：

| 项 | 值 |
|---|---|
| Git repository | `New-Sim-U-Kraft/homepage` |
| Branch | `refactor/homepage`（正式切换后改 `main`） |
| Build command | `pnpm build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | 留空 |

仓库有 `pnpm-lock.yaml` 与 `packageManager` 字段，Cloudflare 会自动选用 pnpm。

两点需要知道：

- **纹理图集是入库的**（`public/mc/`，约 240KB）。生成它需要 `sharp` +
  `minecraft-assets` 两个重包，放进 CI 会让每次部署白装几十 MB，而产物本身很小。
  所以 `pnpm build` **不生成图集**，只在更新 Minecraft 版本时手动
  `pnpm atlas` 并提交产物。
- secret 独立存储，不随部署更新；`[vars]` 则跟着 `wrangler.toml` 一起生效。

**方式 B：本地手动部署**

```bash
pnpm deploy
```

两种方式可混用，同一个 Worker。

### 第一个管理员

角色由 Prism 身份组决定，官网没有提权入口，所以**第一个管理员必须在 Prism 侧
给自己打上 `admin` 组**，然后登录官网一次即可生效。

## 六、上线后验证

```bash
# 绑定自检：三个绑定都应为 true，roles 应为 5
curl https://<域名>/api/_ping

# 登录链路（浏览器里走一遍）
https://<域名>/api/auth/login

# webhook 密钥校验（无 header 应 401）
curl -X POST https://<域名>/api/hooks/prism/audit -d '{}'

# 结构文件不可直接下载（应 403）
curl https://<域名>/uploads/workshop/<任一id>/files/<任一文件>
```

逐项确认：

- [ ] `/api/_ping` 三个绑定为 true，`roles: 5`
- [ ] 能用 Prism 账号登录，账号中心显示正确的身份组
- [ ] 赞助者能生成模组令牌，非赞助者看到「面向赞助者开放」提示
- [ ] 模组 `validate` 返回 License，用公钥能验签通过
- [ ] 在 Prism 移除某人的 `sponsor` 组，几秒内其 License 被吊销、模组 `validate`
      返回 `NOT_SPONSOR`
- [ ] 工坊结构文件的直链返回 403，作品页下载按钮只指向站外链接
- [ ] 审核员能通过后台下载结构文件核对，且 `audit_log` 有记录

## 七、回滚

新站与旧站是两套 Cloudflare 资源，互不影响。出问题把域名的路由指回旧 Worker
即可，新站的 D1/KV/R2 原样保留。

由于两边账号体系不同（旧站自建密码，新站 Prism），**回滚后新站期间产生的用户
数据不会出现在旧站**。切换前应确认新站稳定，避免来回切。
