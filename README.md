# Buy Me a Big Mac 🍔

代码帮到你了？请作者吃个巨无霸。

[打开网站](https://buy-me-a-big-mac.liukairui.me) · [麦当劳 MCP](https://github.com/M-China/mcd-mcp-server)

作者为 GitHub 项目选一家参考餐厅，生成 README 徽章；支持者打开链接即可配餐、获取建议金额、写祝福，再跳转爱发电送出心意。双方都不用填写麦当劳 token，作者自己决定什么时候吃这顿饭。

这是独立开发的麦当劳 MCP 挑战赛作品，不是麦当劳官方产品。本站不创建麦当劳订单；爱发电赞助与之后的餐饮消费是独立行为。

## 使用

1. 作者填写 GitHub 仓库与爱发电作者 UID（32 位十六进制标识，不是主页链接）。
2. 搜索并选择参考餐厅，生成分享链接及 Markdown / HTML 徽章。
3. 支持者打开链接，菜单自动加载；选餐后计算建议金额并选择祝福语。
4. 跳转爱发电确认金额、留言及收款作者，再自行完成付款。

分享链接的片段内包含可解码的公开配置：项目、门店编码及名称、取餐类型、爱发电 UID。没有凭证。旧版 `#/gift/...` 分享格式继续可用，迁移域名时更换链接和徽章的站点地址即可。

## 架构

```text
浏览器 ── 静态页面 ── Cloudflare Workers Static Assets
      └─ /api/* ── Worker ── 麦当劳官方 MCP
                            ↑
                      MCD_TOKEN Secret
```

一个 Cloudflare Worker 项目同时部署静态资源与业务 API，无数据库、无常驻服务器。页面使用原生 ES Modules，运行时没有第三方依赖。Wrangler 与 esbuild 仅用于开发和部署。

公开接口仅有 `POST /api/connect`、`/api/stores`、`/api/menu`、`/api/quote`。MCP 初始化、工具发现和鉴权均在服务端完成；客户端不能提交任意 MCP 方法。菜单和报价经服务器规范化，只返回页面需要的字段，剔除常点记录等账号数据。

## 本地运行

需要 Node.js 22.9+。

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

`main` 分支推送后自动执行检查、测试和构建，通过后部署到 `buy-me-a-big-mac.liukairui.me`。PR 只运行检查，不接触部署凭证。

在仓库 Actions Secrets 中设置：

| Secret | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 部署 Worker 和自定义域名的 Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `MCD_TOKEN` | 站点使用的麦当劳 MCP token |

部署将 `MCD_TOKEN` 通过管道作为 Worker Secret 与代码一起上传，不写入仓库、构建产物或临时文件。更新 GitHub Secret 后，在 Actions 手动运行 **Test and deploy** 即可同步到运行时。Cloudflare token 需要目标账户的 Workers 部署权限，以及目标域名的读取与 Workers Routes 权限；R2 S3 密钥不能代替部署权限。

Fork 自行部署时，修改 `wrangler.jsonc` 的 Worker 名称、自定义域名和限流 namespace；设置自己仓库的 Secrets。域名需已接入对应 Cloudflare 账户。无需启用 R2、D1 或付费计划。

## 价格、账号与请求边界

- 建议金额来自站点运营者账号和所选门店的实时 MCP 算价，可能包含该账号可用的会员优惠；不保证作者日后购买时同价。
- 菜单金额以元返回，算价以分返回。服务端统一为整数分；只有算价结果与购物车餐品及数量对应时，才能跳转爱发电。
- 不开放下单、支付、积分、领券、收藏餐厅或账号历史查询。公共 API 不接受优惠券及随单购参数。
- 每个来源 IP 每分钟最多 60 次 API 请求，使用 Cloudflare Rate Limiting binding；该限制按边缘机房生效，不是全局精确配额。运营者 token 还受麦当劳上游限频约束。
- 生产部署缺少限流 binding 或 token 时，API 返回 503；超频返回 429。请求体最多 16 KiB，上游响应最多 3 MiB，请求整体超时 30 秒。
- token 仅在 Worker 中使用，不发送给浏览器、不进入分享 URL、不记录日志；上游错误不会原样暴露给访问者。过期后由运营者更新 Secret。

静态资源使用 Cloudflare 原生资产托管，静态请求不执行业务 Worker。Worker API 可先使用免费额度；实际 CPU 和请求用量以账户控制台为准。[Cloudflare 价格](https://developers.cloudflare.com/workers/platform/pricing/)

## 验证

单元测试覆盖配置/金额解析、共享凭证隔离、参数白名单、账号字段过滤、超时取消、限流、浏览器连接生命周期和报价一致性。已使用真实 MCP 验证门店搜索、菜单与单品算价，未创建订单或执行付款。

`tests/browser-smoke.mjs` 提供独立的 Playwright 模拟流程测试，可另行安装 Playwright 后运行；不会触发真实爱发电付款。套餐可选子项尚无定制界面，当前按麦当劳服务可计算的默认组合查询；不接受的组合会显示查询失败。

爱发电参数依据：[官方开发者功能说明](https://afdian.com/p/010ff078177211eca44f52540025c377)。最终付款金额、方式和平台费用以爱发电页面为准。
