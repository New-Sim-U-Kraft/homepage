# 部署

从零把这个分支跑到线上需要的全部步骤。顺序不能打乱 —— Prism 应用必须先建在
NSUK 团队名下，否则受限账号在授权阶段会被静默拒绝。

---

## 一、创建 Cloudflare 资源

```bash
wrangler d1 create nsuk
wrangler kv namespace create KV
wrangler r2 bucket create nsuk-uploads
```

把返回的 `database_id` 与 KV `id` 填进 `wrangler.toml`。R2 桶名已写死为
`nsuk-uploads`，改名的话记得同步。

## 二、在 Prism 侧建应用

**必须用团队应用的入口创建**（`POST /api/teams/:id/apps` 或团队页面的「新建应用」），
不能用个人应用入口。

原因见 Prism 的团队邀请链接注册方案 §8②：受限账号只能授权「来源团队及其后代
拥有的应用」。NSUK 用户绝大多数通过 `/join/<teamId>` 注册，属于受限账号；应用若
建在个人名下，这批人在 `/authorize` 阶段直接被拒，而且**没有任何面向用户的报错**，
只会表现为登录点了没反应。

| 项 | 值 |
|---|---|
| 客户端类型 | 机密 |
| 重定向 URI | `https://<官网域名>/api/auth/callback`（匹配方式：等于） |
| 追加重定向 URI | `http://127.0.0.1:3000/api/auth/callback`（本地开发） |
| allowed_scopes | `openid` `profile` `email` `offline_access` `teams:read` |

`teams:read` 是过度授权（会带上用户所有团队的 membership claim），但在 Prism 的
P1（应用预绑定团队的窄 scope）落地前没有更窄的选择 —— 单团队 scope 要求授权者是
团队 admin 以上，普通赞助者授不了。P1 上线后把 scope 换掉即可，官网侧只读
`groups_in_team_<id>`，不依赖其余 claim。

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
- Body 模板：

```json
{"event":"{event}","resource_id":"{resource_id}","scope_id":"{scope_id}","metadata":{metadata},"timestamp":"{timestamp}"}
```

- 订阅事件：`team.member.groups_change`、`team.member.remove`、`team.group.delete`

**三个都要订**。只订 `groups_change` 会漏掉被整个移出团队的人；只订前两个，
身份组定义被删除时不会有任何通知。

这个 webhook 不是可选优化：模组玩家可能长期不访问网页，`validate` 读的是本地
`role_key`，没有 webhook 就只能等 License 自然过期（最长 4 天）才失效。

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

## 五、建表与部署

```bash
pnpm db:migrate:remote
pnpm deploy
```

不需要迁移旧数据 —— 旧库已放弃，空库起步。

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
