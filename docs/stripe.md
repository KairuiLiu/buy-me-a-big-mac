# Stripe Payment Link 与感谢小票

作者填写自己的 Stripe Payment Link, 支持者选餐后前往 Stripe 付款, 再回到本站查看本地感谢小票. 第一版只支持人民币 (CNY); Stripe 流程不需要 API Key、Webhook 或 D1, 也不查询 Stripe 付款状态.

## 作者配置

1. 在 Stripe Dashboard 的 **Payment Links** 中新建链接, 选择 **Customers choose what to pay**, 填写标题等展示信息, 并将默认币种设为 **CNY**. 不要选择固定价格; 本站会按餐单预填建议金额. 可设置建议金额和上下限, 金额范围应覆盖你希望接受的赞助. [创建指南](https://docs.stripe.com/payment-links/create)
2. 打开 **After the payment**, 选择付款后跳转到网站, 填写 `https://buy-me-a-big-mac.liukairui.me/thanks/stripe`. 保存并创建 Payment Link. 无需添加 `{CHECKOUT_SESSION_ID}`; 本版不通过 Session ID 查单. [付款后跳转配置](https://docs.stripe.com/payment-links/post-payment)
3. 在本站创建页选择 **Stripe**, 粘贴完整的 `https://buy.stripe.com/...` 链接, 再生成分享链接. 沙盒测试链接 `https://buy.stripe.com/test_...` 也可使用; 自定义收款域名暂不支持.

浏览器只能检查链接格式, 无法读出该 Payment Link 的币种或定价模式. 请在 Stripe 后台确认 CNY 和自由金额设置; 如果账号暂时无法创建这类链接, 先完成 Stripe 要求的账号配置.

本地演示用于检查页面和流程, 不代表真实 Stripe 付款已验证. 接入后仍需使用作者创建的沙盒链接验证金额预填与回跳.

## 支持者流程与金额

1. 支持者选餐并填写祝福. 餐单总额是 CNY 建议金额, 例如 ¥25.50 对应 `prefilled_amount=2550`.
2. 点击赞助后, 本站在当前浏览器保存小票, 并给 Payment Link 添加 `prefilled_amount` 和 `utm_content=bm_<32位随机十六进制ID>`, 然后打开 Stripe.
3. Stripe 付款流程结束后, 按作者设置跳转到 `/thanks/stripe`, 并将 UTM 参数带回. 本站用随机 ID 找回同一浏览器中的小票. [UTM 参数与回跳](https://docs.stripe.com/payment-links/url-parameters)

`prefilled_amount` 使用价格默认币种的最小单位, 只对自由金额链接生效. 支持者仍可修改金额; 超出 Stripe 配置上下限的预填值可能被忽略. 本站不换汇, 也无法知道修改后的实付金额, 小票保留选餐时的建议金额. [金额参数说明](https://docs.stripe.com/payment-links/customize#customize-checkout-with-url-parameters)

本站填写的祝福只保存在本地小票中, 不会通过 Stripe 发送给作者. 餐品、项目名和留言也不会放入付款链接; 传给 Stripe 的关联参数只有随机 ID.

如需接收支持者留言, 作者可在 Payment Link 的 **Options → Add custom fields** 中添加 **Text** 字段, 命名为"留言", 并设为可选. 该字段最多 255 个字符, 支持者需在 Stripe 付款页填写, 作者付款后可在 Stripe Dashboard 的付款详情中查看. Stripe 公开文档列出的 Payment Link URL 参数不支持预填这个自定义字段, 所以本站本地祝福不会自动复制过去. [自定义字段说明](https://docs.stripe.com/payment-links/customize#add-custom-fields)

## 返回页与本地记录

Stripe 返回状态为 `returned`, 表示"已从 Stripe 返回". 回跳 URL、`utm_content` 或任何 `session_id` 都不是付款凭证, 本站不会据此显示"已收到付款通知"、生成 Stripe 订单号或付款条码; 真实收款以 Stripe 后台和 Stripe 收据为准. 直接打开返回页或手动添加参数也不会核验付款.

小票最多保存 5 份, 从创建起保留 30 分钟. 恢复需要同一浏览器、匹配的随机 ID 和尚未过期的本地记录; 换浏览器、清除站点数据、记录过期或没有匹配记录时, 返回页会提示无法恢复, 不猜测付款结果. Stripe 流程不创建爱发电 intent, 也不调用本站付款通知接口.

生产构建包含 `/thanks/stripe` 的独立页面入口.`/preview/thanks/stripe` 展示离线演示小票, 两个入口均带 `noindex`; 演示不打开真实付款页. 原有爱发电分享链接和通知流程继续使用[爱发电说明](payments.md).

## 本地与沙盒验收

```sh
npm ci
npm run build
npm run preview
```

先打开本地 `/preview/create` 检查 Stripe 配置和分享链接, 再打开 `/preview/thanks/stripe` 检查小票展示.`npm run build` 会检查两个返回入口、编译资源和生产服务的页面解析.

作者完成账号设置后, 可在 Stripe 沙盒创建 CNY 自由金额 Payment Link, 并按上述步骤配置返回地址. 在需要测试的站点用这条链接完成选餐、金额预填、付款和回跳, 确认原浏览器恢复正确小票; 同时检查直接访问、丢失本地记录和超过 30 分钟等情况. 测试环境的返回地址应与发起选餐的站点同源, 否则无法读取该站点的本地小票.

沙盒只使用 [Stripe 官方测试卡](https://docs.stripe.com/testing), 例如 `4242 4242 4242 4242` 配合未来有效期和任意三位 CVC; 不要使用自己的真实银行卡测试. 测试完成后, 再由作者按需要创建并分享正式 Payment Link.

## 分享配置

配置对象使用 `paymentProvider: 'stripe'` 和完整的 `stripePaymentLink`. 分享 URL 中的 `s` 保存 Stripe 链接 token, 替代爱发电的 `a` 和 `h`; 完整 Payment Link 在浏览器解析时恢复.`prefilled_amount` 和随机小票关联 ID 只在支持者发起赞助时加入, 不属于作者分享链接.
