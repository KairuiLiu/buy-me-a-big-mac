# Buy Me a Big Mac 🍔

代码帮到你了？请作者吃个巨无霸。

[打开网站](https://buy-me-a-big-mac.liukairui.me) · [麦当劳 MCP](https://github.com/M-China/mcd-mcp-server)

作者为 GitHub 项目选一家参考餐厅，生成 README 徽章；支持者打开链接即可配餐、获取建议金额、写祝福，再跳转爱发电送出心意。双方都不用填写麦当劳 token，作者自己决定什么时候吃这顿饭。

这是独立开发、拟参加麦当劳 MCP 创意开发大赛的项目，不是麦当劳官方产品。本站不创建麦当劳订单；爱发电赞助与之后的餐饮消费是独立行为。

参赛材料已补齐，但共享服务端凭证和爱发电赞助场景的适用范围仍需主办方确认；不表示已获授权或已报名成功。详见[参赛核对记录](docs/contest-readiness.md)。

## 目标用户

- 开源作者：给自己的 GitHub 项目生成餐厅与爱发电收款信息绑定的赞助入口。
- 项目使用者：用一份具体的餐品清单表达感谢，作者收到赞助后自行安排用餐。
- 自行部署的开发者：了解如何用麦当劳 MCP 的门店、菜单和算价能力实现一个完整的网页流程。

## 使用

1. 作者填写 GitHub 仓库与爱发电作者 UID（32 位十六进制标识，不是主页链接）。
2. 搜索并选择参考餐厅，生成分享链接及 Markdown / HTML 徽章。
3. 支持者打开链接，菜单自动加载；选餐后计算建议金额并选择祝福语。
4. 跳转爱发电确认金额、留言及收款作者，再自行完成付款。

分享链接的片段内包含可解码的公开配置：项目、门店编码及名称、取餐类型、爱发电 UID。没有凭证。旧版 `#/gift/...` 分享格式继续可用，迁移域名时更换链接和徽章的站点地址即可。

### 使用示例

作者输入自己的仓库地址和爱发电 UID，在城市中搜索一处地点，选择返回的餐厅，然后复制生成的 Markdown 到项目 README。支持者点击徽章后，例如选择一份巨无霸，点击“计算建议金额”，选好祝福语，再跳转爱发电核对收款作者、金额和留言。

开发者可在本地验证门店查询；先按下文启动服务，再运行：

```sh
curl --fail-with-body http://127.0.0.1:4173/api/stores \
  -H 'Content-Type: application/json' \
  --data '{"city":"上海","keyword":"人民广场","beType":1}'
```

响应来自真实 MCP，门店和价格随账号、时间及供应情况变化。测试赞助流程时停在跳转按钮即可，不必付款；完整调用顺序见 [MCP_INTEGRATION.md](MCP_INTEGRATION.md)。

## 架构

```text
浏览器 ── 静态页面 ── Cloudflare Workers Static Assets
      └─ /api/* ── Worker ── 麦当劳官方 MCP
                            ↑
                      MCD_TOKEN Secret
```

一个 Cloudflare Worker 项目同时部署静态资源与业务 API，无常驻服务器。付款通知后端使用 D1 保存短期状态；麦当劳查询不依赖 D1。页面使用原生 ES Modules，运行时没有第三方依赖。Wrangler 与 esbuild 仅用于开发和部署。

麦当劳接口为 `POST /api/connect`、`/api/stores`、`/api/menu`、`/api/quote`。MCP 初始化、工具发现和鉴权均在服务端完成；客户端不能提交任意 MCP 方法。菜单和报价经服务器规范化，只返回页面需要的字段，剔除常点记录等账号数据。

`/api/payments/*` 提供独立的爱发电 Webhook 注册、赞助关联与状态查询。当前仅实现后端，现有页面还不会创建付款关联或展示通知结果。前端接入步骤、有效期与验签边界见[付款通知接口](docs/payments.md)。

## 本地运行

需要 Node.js 22.9+。

通过[麦当劳 MCP 开放平台](https://open.mcd.cn/mcp)申请自己的凭证，并阅读服务规则。仓库内的 [mcp-config.example.json](mcp-config.example.json) 使用 `${MCD_TOKEN}` 环境变量占位符，不含真实凭证；它是接入说明，本站运行时直接读取 `MCD_TOKEN`，不会自动导入该 JSON。

```sh
npm ci
cp .dev.vars.example .dev.vars
# 在 .dev.vars 中填写自己的 MCD_TOKEN；该文件已被 Git 忽略。
npm start
```

打开 `http://127.0.0.1:4173`。也可用 `npm run dev` 在本地 Cloudflare Workers 运行时测试。

```sh
npm run check
npm test
npm run build
npx wrangler deploy --dry-run
```

构建输出为 `dist/worker.js` 和 `dist/public/`，不替换任何环境变量或把密钥写入前端。生产部署由 Wrangler 从同一份源码打包。

## GitHub Actions → Cloudflare

以下是当前部署实现。将个人 MCP 凭证托管到 GitHub / Cloudflare 并用于公共服务是否属于官方允许范围，尚待确认；技术上可运行不等于已获得该使用方式的授权。核对事项见[参赛记录](docs/contest-readiness.md#仍需确认)。

`main` 分支推送后自动执行检查、测试和构建，通过后部署到 `buy-me-a-big-mac.liukairui.me`。PR 只运行检查，不接触部署凭证。

在仓库 Actions Secrets 中设置：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 部署 Worker 和自定义域名的 Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `MCD_TOKEN` | 站点使用的麦当劳 MCP token |

部署将 `MCD_TOKEN` 通过管道作为 Worker Secret 与代码一起上传，不写入仓库、构建产物或临时文件。更新 GitHub Secret 后，在 Actions 手动运行 **Test and deploy** 即可同步到运行时。Cloudflare token 需要目标账户的 Workers 部署权限、D1 编辑权限（D1 Write），以及目标域名的读取与 Workers Routes 权限；R2 S3 密钥不能代替部署权限。

部署会按 `wrangler.jsonc` 中的数据库名称查找或创建 D1，应用版本化迁移后再发布 Worker；重复部署不会重建数据库。仓库内的全零数据库 ID 是本地占位符，真实 ID 只写入被 Git 忽略的 `.wrangler/deploy.json`。新数据库请求 APAC 区域，不开启只读副本。

Fork 自行部署时，修改 `wrangler.jsonc` 的 Worker 名称、自定义域名、数据库名称和限流 namespace；设置自己仓库的 Secrets。域名需已接入对应 Cloudflare 账户。使用 Workers 与 D1 免费额度，无需启用 R2 或付费计划。

## 价格、账号与请求边界

- 建议金额来自站点运营者账号和所选门店的实时 MCP 算价，可能包含该账号可用的会员优惠；不保证作者日后购买时同价。
- 菜单金额以元返回，算价以分返回。服务端统一为整数分；只有算价结果与购物车餐品及数量对应时，才能跳转爱发电。
- 不开放下单、支付、积分、领券、收藏餐厅或账号历史查询。公共 API 不接受优惠券及随单购参数。
- 每个来源 IP 每分钟最多 60 次 API 请求，使用 Cloudflare Rate Limiting binding；该限制按边缘机房生效，不是全局精确配额。运营者 token 还受麦当劳上游限频约束。
- 生产部署缺少限流 binding 或 token 时，API 返回 503；超频返回 429。请求体最多 16 KiB，上游响应最多 3 MiB，请求整体超时 30 秒。
- token 仅在 Worker 中使用，不发送给浏览器、不进入分享 URL、不记录日志；上游错误不会原样暴露给访问者。过期后由运营者更新 Secret。
- 参考餐厅不在营业时间时，MCP 可能不提供菜单。已识别的门店不可用错误返回 409，并提示营业时再试或联系作者更换餐厅；查询超时返回 504，未知上游错误返回 502。

静态资源使用 Cloudflare 原生资产托管，静态请求不执行业务 Worker。Worker API 可先使用免费额度；实际 CPU 和请求用量以账户控制台为准。[Cloudflare 价格](https://developers.cloudflare.com/workers/platform/pricing/)

## 验证

单元测试覆盖配置/金额解析、共享凭证隔离、参数白名单、账号字段过滤、超时取消、限流、浏览器连接生命周期和报价一致性。已使用真实 MCP 验证门店搜索、菜单与单品算价，未创建订单或执行付款。

`tests/browser-smoke.mjs` 提供独立的 Playwright 模拟流程测试，可另行安装 Playwright 后运行；不会触发真实爱发电付款。套餐可选子项尚无定制界面，当前按麦当劳服务可计算的默认组合查询；不接受的组合会显示查询失败。

爱发电参数依据：[官方开发者功能说明](https://afdian.com/p/010ff078177211eca44f52540025c377)。最终付款金额、方式和平台费用以爱发电页面为准。

## 参赛材料与许可

- [CONTEST_DECLARATION.md](CONTEST_DECLARATION.md)：按比赛要求原样保存官方声明，提交前由参赛者阅读并确认其中承诺。
- [MCP_INTEGRATION.md](MCP_INTEGRATION.md)：服务、工具、调用流程与业务价值。
- [mcp-config.example.json](mcp-config.example.json)：脱敏接入示例。
- [参赛核对记录](docs/contest-readiness.md)：规则来源、已满足项、待确认项及报名步骤。

目前没有使用 WorkBuddy 的可核验记录，因此不提供 `workbuddy.md`，不据此申领 WorkBuddy 使用专项奖励。

本项目自行编写的代码按 [MIT License](LICENSE) 开源。麦当劳、巨无霸、GitHub、爱发电等名称及商标归各自权利人所有；MCP 动态返回的餐品图片、菜单和价格，以及原样保存的官方参赛声明，不因本项目的代码许可而获得再授权。参赛者仍需在提交前确认代码及素材的来源与使用权。
