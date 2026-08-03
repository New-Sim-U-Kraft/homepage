# NSUK 模组授权设计

> 状态：设计待评审
> 适用范围：NSUK 官网重构分支 + NeoForge 模组客户端
> 依赖：Prism 团队身份组（已合并）、Prism 团队邀请链接注册（待实现）
>
> **本方案不改动任何现有 API 端点与请求参数**，只在响应上做向后兼容的扩展。

---

## 〇、先澄清三件事

这一节是给参与讨论的人看的，不是设计内容。

### 「每次开游戏都要重新输码」从未成立

原实现里 token 是**长期有效**的，模组只要把它存到本地就不用再输。现在看起来像是每次都输，只是因为模组没做本地存储——这是实现上的空缺，不是设计上的保证，原代码没有任何机制能阻止玩家的模组把 token 存下来。

所以「保持现状 = 每次都验证」这个前提不成立。

### 「校验码 + 暗文验证码」就是签名令牌

「每次校验码会变，但实际上变的只是藏在里面的验证码」——这个东西有标准名字：**签名令牌**（本方案里就是 License JWT）。明文载荷（谁、什么等级、何时过期）+ 私钥签名，每次签发内容都不同，客户端能本地验真伪但伪造不了。

本方案里的 License 就是这个东西，不是新架构。

### 离线可用与实时吊销不可兼得

两种担心其实是同一个权衡的两面：

- 「凭证被存起来，玩家不用再登官网」
- 「玩家不登官网，资格取消了也吊销不掉」

**凭证能离线用多久，就有多久吊销不掉。** 唯一的旋钮是联网间隔，不存在既永久离线又实时吊销的设计。本方案把这个旋钮做成配置项（见第六节），内测期收紧、正式期放宽。

关键在于：**续期由模组自动完成，不需要玩家登录官网。** 所以「玩家不登官网就吊销不掉」不成立——模组自己会去问，玩家躲不掉。

---

## 一、现状与改动范围

### 现有实现（`src/routes/mod.js`）

四个端点，前端契约见 `public/assets/account.js:117-217`：

| 端点 | 权限 | 用途 |
|---|---|---|
| `POST /api/mod/validate` | 公开 | 模组校验 `token` + `fingerprint`，首次调用自动绑定设备 |
| `GET /api/mod/token` | 登录 + level≥1 | 查询当前令牌与绑定状态 |
| `POST /api/mod/token/generate` | 登录 + level≥1 | 生成令牌 |
| `POST /api/mod/token/reset` | 登录 + level≥1 | 重置设备绑定，24 小时冷却 |

### 沿用的既有设计

以下都是原实现里正确的部分，本方案原样保留：

- **JOIN `users` + `roles` 取 level 判权**，而不是把等级冗余在 `mod_tokens` 上
- **首次调用自动绑定设备指纹**，玩家无需额外操作
- **重置冷却**，防止令牌在多人之间来回切换
- **返回 `display_name || username`**，模组内显示友好名称
- **`{ ok: true, token: null }` 表示尚未生成**，前端据此切换空状态
- **响应字段 `{ valid, username, message }`**，失败也返回 200 靠 `valid` 判断
- 全部错误消息使用中文，可直接展示给玩家

### 本方案的改动

| 改动 | 说明 |
|---|---|
| `validate` 响应增加 `license` 等字段 | 模组据此本地验签，**离线可用**，且续期无需玩家操作 |
| 令牌绑定 `sub` 而非 `username` | 账号体系迁移到 Prism |
| level 语义更新为新的五级身份组 | 见第三节 |
| 加入速率限制 | 原 `validate` 是公开端点且完全无限流 |
| 加入吊销机制 | 原令牌永久有效，无法作废 |
| 冷却时长改为可配置 | 原代码写死 24 小时，注释写的是 30 天，两处不一致 |
| `generate` 允许重新生成 | 原实现在已有令牌时直接 400，玩家无法应对令牌泄露 |
| 响应增加机器可读的 `code` | 原实现只有中文 `message`，模组无法据此分支处理 |
| schema 移入 migration | 原 `mod.js:10-29` 在请求路径上 `CREATE TABLE` |

---

## 二、总体流程

```
首次授权（玩家唯一一次手动操作）
────────────────────────────
① 玩家在官网登录，账号中心点「生成令牌」
② 复制令牌，填入模组
③ 模组 POST /api/mod/validate { token, fingerprint }
④ 官网校验 → 绑定设备 → 返回 { valid: true, license, ... }
⑤ 模组落盘 token 与 license

后续启动（全自动，玩家无感）
──────────────────────────
读本地 license
├─ 验签通过、未过期、fp 匹配
│    ├─ 剩余 > 1/4 有效期 → 直接放行，本次不联网
│    └─ 剩余 < 1/4 有效期 → 放行，后台异步续期
├─ 已过期但在宽限期内 → 放行 + 提示「授权即将失效，请联网」
└─ 无 license / 验签失败 / 超出宽限 → 联网 validate
     ├─ 有本地 token → 自动续期，玩家无感
     └─ 无本地 token → 提示玩家填入令牌
```

**续期与吊销检查都复用 `validate`**，不需要新增端点：模组本来就存着 `token` 和 `fingerprint`，重新调用一次即可。

---

## 三、身份组与准入

Prism 团队身份组 slug 与官网角色一一对应：

| Prism group slug | 官网 role_key | level | 模组授权 |
|---|---|---|---|
| （无 group） | `guest` | 0 | ✗ |
| `sponsor` | `sponsor` | 1 | ✓ |
| `staff` | `staff` | 2 | ✓ |
| `developer` | `developer` | 3 | ✓ |
| `admin` | `admin` | 4 | ✓ |

**模组授权对赞助者及以上开放**，即沿用原实现的 `level >= 1` 判定。

持有多个 group 时取 level 最高者。`groups_in_team_<NSUK>` claim 缺失是正常路径，映射为 `guest`。

### 身份来源统一，凭证各自独立

「用户验证」与「内测验证」是两件事，但正确的分法不是搭两套独立系统：

| | 判定依据 | 持有的凭证 |
|---|---|---|
| 官网 | Prism 身份组 | 会话 cookie（KV） |
| 模组 | Prism 身份组 | License JWT（本地文件） |

**身份来源统一**（一处维护，改一次全局生效），**凭证各自独立**（模组根本不接触 Prism，拿的是官网签发的东西）。

这样既没有「两套验证臃肿」，也没有「混为一谈」——模组的凭证体系是完全独立的，只是它判断资格时问的是同一个数据源。

### 身份组的同步

官网 D1 中的 `role_key` 是派生字段，靠三条途径保持新鲜：

| 途径 | 时机 | 覆盖范围 |
|---|---|---|
| 登录同步 | 用户网页登录时读 ID token claim | 只覆盖会上网页的用户 |
| **Prism webhook** | `team.member.groups_change` 等事件触发后回查 | 覆盖全部用户，**主路径** |
| 定期对账 | cron 拉取团队成员列表全量比对 | 兜底，见下 |

**为什么需要第三条**：Prism 的 audit webhook 是 best-effort 投递，**无重试、无签名**。丢一条 `groups_change` 事件，被取消资格的用户就会一直续期成功，而且没人会发现。

对账实现：官网用一个 NSUK 团队 admin 授权的长期令牌，定期调用 Prism 的 `GET /api/oauth/me/team/:teamId/members`（该端点返回每个成员的 `groups`），与本地 `role_key` 全量比对，差异即修正并写审计。

这需要官网应用持有绑定到 NSUK 团队的 `team:member:read` scope，由团队 owner 授权一次。**列为 P2 加固项**——有了短周期 License（第六节），即使完全没有对账，吊销延迟也被限制在 4 天内，所以不阻塞上线。

---

## 四、数据模型

保留 `mod_tokens` 表名与既有列，补充新增列：

```sql
CREATE TABLE mod_tokens (
  token             TEXT PRIMARY KEY,
  sub               TEXT NOT NULL REFERENCES users(sub),  -- 原 username
  bound_fingerprint TEXT,
  bound_at          TEXT,
  reset_at          TEXT,
  created_at        TEXT NOT NULL,
  -- 新增
  device_name       TEXT DEFAULT '',   -- 玩家可命名，便于识别是哪台机器
  machine_hint      TEXT,              -- 异常检测用，见第七节
  last_seen_at      TEXT,              -- 最近一次 validate 成功时间
  current_jti       TEXT,              -- 当前有效 License 的 jti
  revoked_at        TEXT               -- 令牌作废时间，非空即失效
);
CREATE INDEX idx_mod_tokens_sub ON mod_tokens(sub);
```

一账号至多一条记录（原实现即如此），即**一账号一设备**。

---

## 五、各端点的校验流程

### `POST /api/mod/validate`（公开）

请求体沿用 `{ token, fingerprint }`，可选新增 `machine_hint`、`device_name`。

| # | 校验项 | `code` | `message` |
|---|---|---|---|
| 1 | 速率限制（按 IP + 按 token） | `RATE_LIMITED` | 请求过于频繁，请稍后再试 |
| 2 | `token` 与 `fingerprint` 均非空 | `BAD_REQUEST` | 缺少 token 或 fingerprint |
| 3 | 令牌存在（JOIN `users` + `roles`） | `TOKEN_NOT_FOUND` | token 不存在 |
| 4 | `revoked_at` 为空 | `TOKEN_REVOKED` | 此令牌已作废，请在网站重新生成 |
| 5 | `level >= 1` | `NOT_SPONSOR` | 权限不足，需要赞助者身份 |
| 6 | 未绑定 → 绑定并放行；已绑定 → 指纹必须一致 | `DEVICE_MISMATCH` | 此 token 已绑定其他设备，请在网站重置绑定 |
| 7 | 签发 License，更新 `current_jti` / `last_seen_at` | — | 首次激活成功 / 空 |

第 1、4 步是新增，其余与原实现一致，连 `message` 文案都保持不变。

**`code` 字段是新增的**：原实现只返回中文 `message`，模组要分支处理只能匹配字符串，文案一改就断。加上机器可读的 `code` 后，模组按下表决定本地状态：

| `code` | 清除本地 license | 清除本地 token | 玩家需要做什么 |
|---|---|---|---|
| `TOKEN_NOT_FOUND` | ✓ | ✓ | 重新去网页生成并填入 |
| `TOKEN_REVOKED` | ✓ | ✓ | 重新去网页生成并填入 |
| `NOT_SPONSOR` | ✓ | ✗ | 恢复赞助后自动可用，无需重填 |
| `DEVICE_MISMATCH` | ✓ | ✗ | 去网页重置绑定，无需重填 |
| `RATE_LIMITED` | ✗ | ✗ | 稍后重试 |

区分「清 token」与「留 token」很重要：掉赞助和设备冲突都是**可恢复**的，让玩家重新复制一次令牌纯属折腾。

**成功响应**（在原有字段后追加，老版本模组忽略新字段仍可正常工作）：

```json
{
  "valid": true,
  "username": "显示名",
  "message": "",
  "license": "<License JWT>",
  "expires_at": 1754286400,
  "tier": "sponsor"
}
```

### `GET /api/mod/token`（登录 + level≥1）

响应结构保持不变，仅追加字段：

```json
{
  "ok": true,
  "token": {
    "token": "…",
    "hasBound": true,
    "boundAt": "2026-08-03T...",
    "resetAt": null,
    "createdAt": "2026-08-01T...",
    "deviceName": "玩家的台式机",
    "lastSeenAt": "2026-08-03T...",
    "cooldownHours": 24
  }
}
```

`cooldownHours` 是新增的：前端目前把 24 小时**写死在 `account.js:141`** 的倒计时里，冷却时长一旦改配置就会和后端不一致。改为由接口下发。

### `POST /api/mod/token/generate`（登录 + level≥1）

原实现在已有令牌时返回 `400 已存在 token，请先删除或重置`——但**并不存在删除端点**，玩家遇到令牌泄露时无路可走。

改为允许重新生成，但**与 reset 共用同一冷却**：

| 情况 | 处理 |
|---|---|
| 首次生成 | 立即执行，不进入冷却 |
| 已有令牌、冷却已过 | 删除旧令牌、其 License `jti` 进吊销名单，生成新令牌并开始新的冷却 |
| 已有令牌、冷却中 | `429 REBIND_COOLDOWN` |

**为什么不给重新生成开免冷却的口子**：它会清除设备绑定，效果与 reset 完全相同。若不受同一约束，玩家反复生成新令牌就能在多台设备间来回切换，冷却机制形同虚设。

代价是令牌泄露后最多要等一个冷却周期才能彻底作废旧令牌。考虑到冷却默认 24 小时，且泄露者还得抢在本人之前完成设备绑定，这个窗口可以接受 —— 相比之下，给换设备留后门的代价更大。

### `POST /api/mod/token/reset`（登录 + level≥1）

逻辑不变：清空 `bound_fingerprint` / `bound_at`，写 `reset_at`，冷却期内返回 `429`。

新增：同时吊销 `current_jti`，使原设备上尚未过期的 License 立即失效。否则重置后原设备仍能用满整个有效期，重置就没有意义。

冷却时长从写死的 24 小时改为读 `site_config`，默认仍是 24 小时。

---

## 六、License JWT

```json
{
  "iss": "https://<官网域名>",
  "aud": "nsuk-mod",
  "sub": "<prism user id>",
  "jti": "<uuid>",
  "iat": 1754200000,
  "exp": 1754286400,
  "fp": "<bound_fingerprint>",
  "tier": "sponsor",
  "name": "<显示名>"
}
```

- 算法 **RS256**。不用 ML-DSA —— Java 侧没有内置支持，会迫使模组打包额外依赖
- 私钥存于 Cloudflare Secrets，公钥内置于模组
- `fp` 与本机指纹比对，防止把别人的 license 文件拷过来直接用

### 有效期与吊销延迟

有效期存 `site_config`，按阶段调整，不改代码：

| 阶段 | License 有效期 | 离线宽限 | 吊销最大延迟 |
|---|---|---|---|
| **内测** | **24 小时** | 3 天 | **4 天** |
| 正式 | 7 天 | 3 天 | 10 天 |

内测期用 24 小时：模组每天自动续一次（玩家无感），被取消资格的人最多再玩 4 天。代价只是连续断网超过 4 天的玩家需要联网一次，对 MC 玩家不构成障碍。

这个参数同时满足了两种诉求——**验证在程序逻辑上是频繁的（每天一次），在玩家操作上是零次的**。

### 吊销

`jti` 写入 KV（`license:revoked:<jti>`，TTL 设为 License 剩余寿命）。触发源：

1. 玩家重置绑定或重新生成令牌
2. 官网收到 Prism 的 `team.member.groups_change` webhook，回查确认掉组
3. 定期对账发现差异
4. 管理员操作

模组下次 `validate` 时会拿到新 License 或失败响应，不需要额外的吊销检查端点。

---

## 七、设备指纹

`fingerprint` 由模组生成并上报，含义与原实现一致，生成方式明确为：**首次运行生成的随机 UUID**。

### 存放位置：用户级目录，不是实例的 config

```
Windows  %APPDATA%\nsuk\device.id
macOS    ~/Library/Application Support/nsuk/device.id
Linux    ~/.config/nsuk/device.id
```

**不要存在 `config/nsuk/` 下**。Minecraft 玩家普遍同时安装多个整合包 / 多个实例，每个实例有独立的 `config` 目录。存在实例目录里会导致同一台机器上的每个实例都是「不同设备」，而一账号只能绑一台——玩家换个整合包就被锁在外面。

存用户级目录后，同一台机器的所有实例共享同一个 `fingerprint`，符合「一账号一设备」的真实语义。

### 为什么不用硬件指纹

Minecraft 玩家换机器、重装系统、双系统、笔记本在有线与无线间切换都很常见，硬件指纹的误伤率高得不可接受。绑定挂在本地文件上虽然可被复制，但配合一账号一设备、冷却和吊销机制已经足够。在客户端侧硬防复制本来就不成立。

### 可选的 `machine_hint`

`SHA-256(MAC + os.name + user.home)`，**仅用于异常检测**。同一 `fingerprint` 出现在不同 `machine_hint` 上时记审计并告警（很可能是配置目录被拷贝分享），但**不硬性拦截**，避免误伤换网卡、双系统的玩家。模组不传则跳过检测。

### 玩家侧的注意事项

`device.id` 被删除或用户目录被清理时，模组会生成新的 `fingerprint`，对官网而言等同于换了一台设备，需要走重置流程并等待冷却。**这一点必须在模组界面文案里说清楚**，否则玩家重装系统后会被冷却卡住而不知道原因。

---

## 八、模组端适配方案（NeoForge）

### 相对现有模组的改动量

HTTP 层不用动——端点、请求参数都没变。需要新增的只有四块：

1. `fingerprint` 改存用户级目录（见第七节）
2. 解析 `validate` 响应里的 `license` 字段并落盘
3. RS256 验签逻辑（约 50 行）
4. 启动时先验本地 license，失败或临近过期才联网

### 技术选型：零新增依赖

| 需求 | 使用 |
|---|---|
| HTTP 请求 | `java.net.http.HttpClient`（JDK 11+） |
| JSON 解析 | Gson（NeoForge 自带） |
| JWT 验签 | `KeyFactory.getInstance("RSA")` + `Signature.getInstance("SHA256withRSA")` |
| 摘要 | `MessageDigest.getInstance("SHA-256")` |
| 用户目录 | `System.getenv("APPDATA")` / `System.getProperty("user.home")` |
| 打开网页 | `Util.getPlatform().openUri()` |

**JWT 验签不要引入 nimbus-jose-jwt 之类的库**——只需支持 RS256 一种算法，手动实现：按 `.` 分段、base64url 解码、用内置公钥验签、检查 `exp` / `iss` / `aud` / `fp`。

务必**硬编码只接受 `alg: RS256`**，拒绝 header 中的其他算法值（包括 `none`）。这是 JWT 实现最经典的漏洞。

### 落盘文件

```
<用户目录>/nsuk/
└── device.id      随机 UUID，首次运行生成后不再改变

<实例>/config/nsuk/
├── token.dat      玩家填入的令牌（AES-GCM 加密）
└── license.jwt    License 令牌
```

`device.id` 在用户级目录（跨实例共享），令牌与 license 在实例级目录（各实例独立授权互不干扰，但由于绑定同一 `fingerprint`，实际上是同一台设备）。

`token.dat` 的加密密钥由机器特征派生。这不是真正的安全存储（客户端环境没有），目的仅是让「直接拷贝整个 config 目录给别人」不能立刻得到可用的令牌。

### 时钟回拨检测

本地验签只能拿系统时间比对 `exp`，玩家改系统时间即可延长 License 寿命。完全防不住，但可以提高门槛：

在 license 旁记录**上次成功 `validate` 的时间戳**，若发现系统时间早于该值，视为异常并强制联网校验。这拦不住有心人，但能挡住「随手把时间调回去」。

验证 `exp` 时允许 **±5 分钟容差**——玩家机器时间不准是常态，别把正常用户挡在外面。

### 实现要点

- **时机**：客户端启动完成、进入主菜单时校验，**不阻塞游戏启动**
- **线程**：所有网络请求在独立线程执行，用 `CompletableFuture` 串联，结果回到主线程更新 UI
- **超时**：HTTP 请求设 10 秒超时，失败按离线处理，不弹错误打断玩家
- **令牌输入**：自动去除空格、统一大小写，减少玩家粘贴出错
- **续期节流**：同一次游戏进程内最多续期一次，避免异常情况下反复打接口

### 界面

模组配置界面或主菜单入口，显示：授权状态、显示名、身份组、到期时间。

未授权时提供令牌输入框 + 「打开官网获取令牌」按钮（`Util.getPlatform().openUri()` 指向账号中心）。

失败时**直接展示后端返回的 `message`**（已是面向玩家的中文），同时按 `code` 决定本地状态清理与是否需要玩家重填（见第五节的表）。

### 无授权时的行为

**功能降级，绝不崩溃、绝不阻止玩家进入游戏。** 具体降级到什么程度需要模组开发者确定（见第十节）。

---

## 九、边界与已知限制

模组是运行在玩家机器上的客户端软件：内置公钥可以被替换，验签逻辑可以被 patch，落盘文件可以被伪造，系统时间可以被修改。**任何纯客户端校验都能被绕过。**

这套机制防的是「未授权用户正常使用」，不是「防止逆向破解」。相比原方案，它把门槛提高到「需要主动修改 jar 文件」的程度，同时提供了吊销、审计、过期和离线可用能力——这些原方案一样都没有。

**遗留的抢绑风险**：令牌是长期凭证，泄露后他人可抢先绑定。缓解手段是玩家可随时重新生成令牌立即止损（原实现做不到），以及 `machine_hint` 异常告警。这个风险源于「手填令牌」这一交互形态本身，不消除该形态就无法根除。

### 已决定：不做服务端校验

真正不可绕过的校验只能发生在玩家控制不了的地方（例如进服时由服务端验证 License）。**已决定不做这一层**，因此本方案就是最终形态。

这意味着：

- **破解版必然会出现**，只是需要有人主动改 jar 并分发。这套机制拦不住，也不打算拦
- 它的实际作用是**防止普通玩家在无需任何技术手段的情况下白嫖**——拿到别人的令牌、拷贝配置目录、共享账号，这几条路都被堵住了
- 因此**不要把 License 当作收入的唯一保护手段**。真正有效的是内容更新节奏、社区与服务本身，授权机制只负责让「正常使用」这条路必须经过授权

---

## 十、待定项

| 项 | 说明 |
|---|---|
| **无授权时的降级行为** | 模组具体关闭哪些功能，由模组开发者确定 |
| **定期对账** | P2 加固项，需要官网持有 NSUK 团队的 `team:member:read` scope |
| **Prism P1 窄 scope** | 未落地前临时使用 `teams:read`，落地后替换 |

---

## 附录：接口契约

### `POST /api/mod/validate`

**请求**

```json
{
  "token": "…",
  "fingerprint": "<UUID>",
  "machine_hint": "<sha256 hex，可选>",
  "device_name": "玩家的台式机（可选）"
}
```

**成功响应 `200`**

```json
{
  "valid": true,
  "username": "显示名",
  "message": "",
  "license": "<License JWT>",
  "expires_at": 1754286400,
  "tier": "sponsor"
}
```

**失败响应 `200`**（沿用原实现：失败也返回 200，靠 `valid` 判断）

```json
{
  "valid": false,
  "code": "DEVICE_MISMATCH",
  "message": "此 token 已绑定其他设备，请在网站重置绑定"
}
```

### `GET /api/mod/token`

需要官网会话 + `level >= 1`。

```json
{
  "ok": true,
  "token": {
    "token": "…",
    "hasBound": true,
    "boundAt": "2026-08-03T10:00:00.000Z",
    "resetAt": null,
    "createdAt": "2026-08-01T10:00:00.000Z",
    "deviceName": "玩家的台式机",
    "lastSeenAt": "2026-08-03T12:00:00.000Z",
    "cooldownHours": 24,
    "remainingCooldownHours": 0
  }
}
```

未生成令牌时 `token` 为 `null`。`remainingCooldownHours` 为 0 表示不在冷却中。

### `POST /api/mod/token/generate`

需要官网会话 + `level >= 1`。已有令牌时重新生成：删除旧令牌、其 License `jti` 进吊销名单。与 reset 共用冷却，冷却期内返回 `429 REBIND_COOLDOWN`。

```json
{ "ok": true, "token": "…" }
```

### `POST /api/mod/token/reset`

需要官网会话 + `level >= 1`。清除设备绑定并吊销当前 License。

```json
{ "ok": true, "message": "设备绑定已重置" }
```

冷却期内：

```json
{ "ok": false, "error": "重置冷却中，还需等待 N 小时" }
```
