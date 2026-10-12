# 爱发电付款通知后端

本次只提供 Worker + D1 后端。现有配餐页面和 README 分享链接尚未接入这些接口，不会自动出现付款结果页，也不会自动改变作者在爱发电的设置。

设计用于赞助感谢页：接收爱发电订单通知，把一次赞助和浏览器的短期查询凭证关联起来。不会创建麦当劳订单或执行付款，不需要作者提交爱发电 API Token。

## 前端接入顺序

1. 作者申请一个接入配置，将返回的私密 `webhookUrl` 填入[爱发电开发者后台](https://afdian.com/dashboard/dev)并保存。该后台由作者操作；本站没有替作者修改。
2. 分享配置可携带公开 `integrationId`。不得包含 `webhookUrl`、`managementToken` 或 Webhook 路径中的秘密部分。
3. 支持者准备付款时创建一次 intent，保存 `intentId`、`readToken`、过期时间及本地餐单快照；`readToken` 仅留在自己的浏览器。
4. 用现有 `buildAfdianUrl` 的 `reference: intentId` 生成爱发电链接，对应官方 `custom_order_id` 参数。作者 UID 和建议金额须与 intent 相同。
5. 支持者从爱发电返回时，前端 POST 查询状态。`notified` 可以展示“已收到爱发电付款通知”；`unknown` 只表示本站无法确认，应提示到爱发电查看，不能显示付款失败。

爱发电 Webhook 是服务器请求，不会打开支持者浏览器。目前查阅的官方支付参数没有支付完成后的自动回跳参数；前端应提供“返回本站查看”流程或打开单独付款标签页。

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

时间均为 Unix 毫秒。查询凭证放在 POST 正文，不能放进公开 URL、分享链接或爱发电备注。返回页面时查询即可；如短时轮询，应间隔至少 10 秒，并在通知成功、过期、页面隐藏或离开后停止。

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
npx wrangler d1 migrations apply PAYMENTS_DB --local
npx wrangler dev --ip 127.0.0.1 --port 4173
```

本地 D1 文件在被 Git 忽略的 `.wrangler/`，不访问生产数据库。`npm start` 的轻量 Node 服务没有 D1 binding，付款接口会返回 503；完整付款后端请使用 Wrangler。

GitHub Actions 在部署前自动查找/创建数据库、应用迁移。Cloudflare token 需要账户 **D1 编辑（D1 Write）** 权限；缺权限会在部署前明确失败，不会用内存状态替代数据库。不会自动购买付费计划。

Cloudflare Cron 还要求账户注册 `workers.dev` 子域名。部署脚本先读取并保留已有设置；仅当官方接口明确返回“尚未注册”时，注册 `buy-me-a-big-mac-<账户ID前8位>.workers.dev`。这用于满足 Cron 前置条件，本站的 `workers_dev` 和预览地址仍关闭，访问地址继续使用自定义域名。

## 官方参考

- [爱发电 Webhook 与 API 文档](https://afdian.com/p/9c65d9cc617011ed81c352540025c377)
- [爱发电支付 URL 参数](https://afdian.com/p/010ff078177211eca44f52540025c377)
- [Cloudflare D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
