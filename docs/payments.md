# 爱发电付款通知与感谢小票

作者可在生成分享链接时开启付款通知；支持者从爱发电返回后，看到本次餐单、祝福和通知查询结果。Worker 接收爱发电订单通知，D1 把一次赞助和浏览器的短期查询凭证关联起来，供感谢页查询。本站不会创建麦当劳订单或执行付款，不需要作者提交爱发电 API Token。

## 页面使用流程

1. 作者填写爱发电 UID，在作者设置中开启“付款通知”，申请一个接入配置。复制私密 `webhookUrl`，填入[爱发电开发者后台](https://afdian.com/dashboard/dev)并保存；该后台由作者操作，本站不会自动修改。后台的测试按钮用于诊断通知连通性，不能代替某次付款的查询结果。
2. 生成的新分享配置携带公开 `integrationId`；`webhookUrl`、`managementToken` 和 Webhook 路径中的秘密部分不会进入分享链接。没有接入 ID 的旧链接继续直接跳转爱发电。关闭开关只影响之后生成的链接，已分享的旧链接及服务端接入不会被撤销。
3. 支持者确认餐单和祝福，准备跳转付款时，页面才创建一次 intent。前端先在 localStorage 保存 `intentId`、`readToken`、过期时间及本地餐单快照；查询凭证不会写进 URL、备注或分享配置。关联创建失败或浏览器无法保存记录时，会留在本站说明原因，可重试，也可明确选择仅前往爱发电。
4. 前端用 `buildAfdianUrl` 的 `reference: intentId` 生成爱发电链接，对应官方 `custom_order_id` 参数。作者 UID 和建议金额与 intent 相同。先用 `history.replaceState` 将当前本站历史记录替换为 `#/thanks/<intentId>`，再用 `location.assign` 在同一标签页打开爱发电。
5. 支持者在爱发电完成操作后，可使用浏览器“返回”，或重新打开本站并选择“最近的心意”。感谢页从当前浏览器恢复小票，POST 查询状态；不会自动再次打开付款页。首次查询到 `notified` 时，显示“心意已送达”和“已收到爱发电付款通知”，并播放一轮五波食材礼花；重复轮询不会重复播放。`unknown` 只表示本站无法确认，提示到爱发电查看，不能显示付款失败。

爱发电 Webhook 是服务器请求，不会打开支持者浏览器。目前查阅的官方支付参数没有支付完成后的自动回跳参数，本站也不会伪造自动回跳。浏览器返回可能先经过爱发电的其他页面，需要返回到本站；在其他浏览器打开感谢页链接，由于没有本地查询凭证，不能查询或宣称付款成功。

## 浏览器本地数据

- 作者私密配置按爱发电 UID 保存在当前站点的 localStorage，最多 10 份，用于复用私密 Webhook 地址和管理凭证。切换 UID 不会混用另一位作者的配置；读取时重新校验格式、接入 ID 和地址来源。私密地址必须与当前站点同源，不支持把其他站点的地址混入配置。
- 支持者的小票最多 5 份，仅包含公开项目配置、餐品清单、建议金额、祝福、创建时间、关联 ID 和私密查询凭证。创建 30 分钟后不再恢复；后续保存会清理过期记录，也可在感谢页主动清除当前小票。
- localStorage 不保存付款状态。即使能恢复餐单，也必须重新查询服务器才能显示收到通知；旧截图或本地数据不能充当支付凭证。D1 的 5 分钟有效期不会因为浏览器保留小票而延长。
- 浏览器禁用存储或空间不足时会显示说明，不会把无法恢复的关联默默当作已跟踪付款。清除站点数据、换设备或换域名会失去本地凭证；作者需重新注册并更新爱发电的 Webhook 设置，支持者以爱发电订单为准。

## 接口

以下接口均为 JSON POST，响应不缓存。浏览器调用只允许本站来源。参数示例中的尖括号内容需替换，不能原样发送。

### 注册作者接入

`POST /api/payments/integrations`

```json
{ "afdianId": "<32位爱发电作者UID>" }
```

成功响应：

```json
{
  "data": {
    "integrationId": "<32位随机十六进制ID>",
    "webhookUrl": "https://你的域名/api/payments/webhook/<integrationId>/<64位秘密值>",
    "managementToken": "<64位随机十六进制管理凭证>"
  }
}
```

服务器仅存秘密值摘要，无法找回原值。注册一个 UID 不代表验证了该作者的账号所有权，也不会占用该 UID；不同接入独立。凭证丢失时可重新注册并更新爱发电 Webhook 配置。

`POST /api/payments/integrations/status`，正文为 `{ "integrationId": "...", "managementToken": "..." }`，返回 `webhookReceived` 和 `lastWebhookAt`。这是接入诊断，不是某次赞助成功的依据；作者后台测试通知也不能代替真实付款。

### 创建短期赞助关联

`POST /api/payments/intents`

```json
{ "integrationId": "<公开接入ID>", "afdianId": "<作者UID>", "amountCents": 2550 }
```

返回 `{ "data": { "intentId": "...", "readToken": "...", "expiresAt": 1791818300000 } }`。

金额单位为整数分。作者 UID 必须与接入配置匹配。intent 从创建起有效 5 分钟；应在即将打开爱发电时创建，不能在加载菜单时提前创建。餐品、祝福语和 GitHub 项目不上传到这个接口。

### 查询付款通知

`POST /api/payments/status`

```json
{ "intentId": "<赞助关联ID>", "readToken": "<私密查询凭证>" }
```

| `data.status` | 含义 |
| --- | --- |
| `pending` | 有效期内，尚未收到可关联的通知；带 `expiresAt` |
| `notified` | 收到通过检查的付款通知；带 `amountCents`、`receivedAt`、`expiresAt` |
| `unknown` | 不存在、已过期或查询凭证不匹配；不代表未付款 |

时间均为 Unix 毫秒。查询凭证放在 POST 正文，不能放进公开 URL、分享链接或爱发电备注。感谢页打开时查询一次；仍为 `pending` 且页面可见时，每隔至少 10 秒再次查询，收到通知、无法确认、发生网络错误、页面隐藏或离开后停止。网络错误可手动重试，不能推断支付失败。

### 接收爱发电 Webhook

`POST /api/payments/webhook/<integrationId>/<secret>`

只接受该接入的私密 URL，并验证当前官方 RSA 公钥签名。必须是 `status: 2` 的有效正金额订单；只有 `custom_order_id` 对应这个接入的有效 intent，且实际金额等于约定建议金额，才会更新为 `notified`。爱发电页面自行修改金额后，本版本不会确认该关联，应以爱发电订单为准。

成功接收返回 `{ "ec": 200 }`；重复通知幂等处理。签名缺失或错误不能更新付款状态。签名验证使用原始金额字符串，不把 `"5.00"` 转成 `"5"` 后再验签。

## 持久化和有效期

- 等待通知的 intent：有效 5 分钟。
- 收到通知的状态：从首次有效通知起再保留 5 分钟；重试通知不会续期。
- 查询严格判断过期时间；Cron 每 5 分钟批量删除过期 intent。因此查询有效期和物理删除时间不同，Cron 延迟时不会让过期状态重新可见。
- 作者接入配置长期保存，以便复用 Webhook URL。秘密值只存 SHA-256 摘要。
- 已处理平台订单号和原始签名消息的 SHA-256 摘要，以及首次接收时间、随机关联 ID（有匹配时）长期保留，用于跨请求、跨 intent 去重。签名消息摘要还防止无分隔符拼接的签名被重新拆分字段后重放。这些记录不含原订单号、明文金额、付款人标识、姓名、电话或地址，不会随着 5 分钟状态一起删除。
- 不保存原始 Webhook 请求、付款人 UID、餐品、留言、联系方式或地址。生产 Worker 日志保持关闭；不要另行记录包含秘密值的 Webhook URL。

状态和去重写入使用 D1 事务，服务重启不会丢失。读取使用主库，避免只读副本延迟影响通知展示。免费额度按读取/写入行数累计，删除和索引维护也计入写入；缩短保留时间不会返还操作额度。

## 通知的可信范围

爱发电当前 RSA 签名覆盖 `out_trade_no + user_id + plan_id + total_amount`，没有覆盖 `custom_order_id`、`status` 和收款作者身份。Webhook 的 `user_id` 是付款人，不是作者。私密接入地址、验签、金额检查和全局去重可以防止常见伪造与重复通知，但不能独立证明作者不会改写一个旧订单的未签名关联字段。

因此接口使用 `notified`，不作为发货、权益发放或独立支付凭证。后续如需严格核验，应在作者授权后用爱发电查单 API 校验关联、金额和收款关系；本版不收集该 API Token。

## 本地开发与部署

```sh
npm ci
npm run build
npx wrangler d1 migrations apply PAYMENTS_DB --local
npx wrangler dev --ip 127.0.0.1 --port 4173
```

本地 D1 文件在被 Git 忽略的 `.wrangler/`，不访问生产数据库。Wrangler 使用构建后的 `dist/public/`，前端代码变更后需重新构建。`npm start` 和 `npm run dev` 的轻量 Node 服务没有 D1 binding，付款接口会返回 503；完整付款后端请使用 Wrangler。本地预览模式不调用真实付款或 MCP 接口。

GitHub Actions 在部署前自动查找/创建数据库、应用迁移。Cloudflare token 需要账户 **D1 编辑（D1 Write）** 权限；缺权限会在部署前明确失败，不会用内存状态替代数据库。不会自动购买付费计划。

Cloudflare Cron 还要求账户注册 `workers.dev` 子域名。部署脚本先读取并保留已有设置；仅当官方接口明确返回“尚未注册”时，注册 `buy-me-a-big-mac-<账户ID前8位>.workers.dev`。这用于满足 Cron 前置条件，本站的 `workers_dev` 和预览地址仍关闭，访问地址继续使用自定义域名。

## 官方参考

- [爱发电 Webhook 与 API 文档](https://afdian.com/p/9c65d9cc617011ed81c352540025c377)
- [爱发电支付 URL 参数](https://afdian.com/p/010ff078177211eca44f52540025c377)
- [Cloudflare D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
