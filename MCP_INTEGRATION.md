# 麦当劳 MCP 集成

服务地址：`https://mcp.mcd.cn/`。使用 Streamable HTTP、JSON-RPC 与服务端 Bearer token。

协议接入依据：[麦当劳官方 MCP 使用指南](https://github.com/M-China/mcd-mcp-server)。脱敏配置见 [mcp-config.example.json](mcp-config.example.json)。其中 `${MCD_TOKEN}` 表示环境变量引用，不是可用 Token；不同 MCP 客户端的环境变量语法不同，使用时需按客户端文档配置。本站由 Worker 直接读取运行时 Secret。

`worker/mcp-client.js` 完成 MCP 初始化、工具发现、schema 参数适配及 JSON/SSE 解析。`worker/api.js` 仅对外提供业务接口，使用运行时 `MCD_TOKEN` Secret；前端从不接触 MCP 凭证或 session。

| 实际调用工具 | 流程 | 业务价值 |
| --- | --- | --- |
| `query-nearby-stores` | 作者按城市/关键词或主动定位搜索门店 | 为赞助页面选择真实参考餐厅 |
| `query-meals` | 支持者打开分享链接时加载菜单 | 展示该餐厅当前可选餐品 |
| `calculate-price` | 支持者选好餐品后请求价格 | 生成爱发电建议金额与餐品留言 |

服务端协议客户端也理解 `query-meal-detail`，但当前没有公开该接口，UI 未提供套餐子项定制。

## 实际调用流程

1. 作者填写项目和爱发电 UID。浏览器调用 `POST /api/connect`，服务端读取 `MCD_TOKEN` 并检查 MCP 连接。
2. 作者输入城市/关键词，或主动授权定位。`POST /api/stores` 调用 `query-nearby-stores`；关键词使用 `searchType: 2`，定位使用 `searchType: 3`。不开放查询账号收藏或历史餐厅的模式。
3. 作者选定门店，浏览器将项目、爱发电 UID 和门店信息编码进分享链接；此过程不写数据库，也不向 MCP 传项目或爱发电信息。
4. 支持者打开链接，`POST /api/menu` 将 `storeCode`、可选 `beCode`、`orderType: 1` 和 `beType: 1 / 5` 交给 `query-meals`。
5. 支持者选餐后，`POST /api/quote` 将同一门店上下文和餐品编码/数量交给 `calculate-price`。后端校验结果与购物车一致，并将金额统一为整数分。查询失败时不生成可付款的建议金额。
6. 浏览器用建议金额、餐品清单和祝福语生成爱发电链接。用户在爱发电独立页面再次确认付款；这个步骤不调用麦当劳下单或支付工具。

每个业务请求创建独立 MCP 客户端，依次发送 `initialize`、`notifications/initialized`、`tools/list`，业务查询再发送 `tools/call`。工具参数按官方返回的 schema 适配；解析 JSON 或 SSE 响应后，只向前端返回规范化的必要字段，最后清理客户端凭证、会话状态与未完成请求。`/api/connect` 只验证协议和工具发现，不调用业务工具。

## 验证方式

- `npm test` 使用可控的 MCP 响应验证协议、参数白名单、凭证隔离、账号信息过滤和报价一致性，不访问真实账号。
- 真实 MCP 验证：2026-10-12 通过浏览器操作及 API 实测，在部署站点搜索上海人民广场附近餐厅，加载菜单，并查询巨无霸单品及默认套餐的建议金额；未下单、未付款。该记录仅表示当次调用成功，不保证今后菜单或报价相同。
- 可复现操作：按 README 启动本地服务 → 搜索并选择真实餐厅 → 生成分享链接 → 打开链接选餐 → 点击“计算建议金额”。菜单和报价都必须由 MCP 返回，测试夹具不会作为生产兜底数据。

## 业务价值与使用边界

商品目录并非硬编码；建议金额必须来自 MCP 的有效算价结果。站点服务端对输入、金额、餐品数量及返回清单做校验，去掉常点记录等账号信息。项目仅使用上述只读业务能力，没有创建麦当劳订单、领券或支付功能。

作者收到的是爱发电赞助，之后自行安排用餐；这样开源致谢可以异步完成，不要求作者立刻取餐。建议金额可能受运营者会员权益、门店与时间影响，不构成餐品购买承诺。

当前共享服务端 Token 的公共访问方式，以及赞助场景是否符合 MCP 个人非商业授权和官方文档的使用限制，尚未获得主办方确认。技术隔离与只读白名单不能替代这种授权。详见[参赛核对记录](docs/contest-readiness.md#仍需确认)。
