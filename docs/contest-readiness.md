# 参赛核对记录

核对日期：2026-10-12。结论：项目形式、实际 MCP 接入和必需仓库材料已具备；共享凭证与赞助用途仍需主办方确认，尚不能判定完全符合参赛条件。本文不是主办方的审核结果。

## 规则来源

- [比赛首页](https://github.com/M-China/mcd-developer-innovation-challenge)：文件清单、声明原文不可改动、报名格式。
- [完整活动规则](https://github.com/M-China/mcd-developer-innovation-challenge/blob/main/activityGuidelines.md)：项目形式、配置示例、创建时间、资格及排名要求。
- 本次使用的比赛仓库版本为 [`54c3145f95004b28007b0303ad4f7476b97f63d4`](https://github.com/M-China/mcd-developer-innovation-challenge/tree/54c3145f95004b28007b0303ad4f7476b97f63d4)。根目录声明逐字节复制自该版本；以后报名时应再次核对最新规则。
- [MCP 服务规则](https://cdn.mcd.cn/cms/pages/MCPServerRules.html)，页面标注版本日期 2025-12-03；[官方 MCP 文档注意事项](https://github.com/M-China/mcd-mcp-server#5-注意事项)。活动规则要求同时遵守服务规则。

## 已落实的项目要求

| 要求 | 仓库证据 |
| --- | --- |
| 基于麦当劳 MCP 的应用 | 实际调用 `query-nearby-stores`、`query-meals`、`calculate-price`；不是静态假菜单 |
| 个人账号下公开仓库及创建时间 | `KairuiLiu/buy-me-a-big-mac` 为 Public，GitHub 创建时间 2026-10-12，位于规定窗口内 |
| 介绍、安装、使用示例、目标用户 | [README.md](../README.md)、[开发与部署](development.md) |
| 官方原文声明 | [CONTEST_DECLARATION.md](../CONTEST_DECLARATION.md)，文件名与内容保持原样 |
| 工具、流程与业务价值 | [MCP_INTEGRATION.md](../MCP_INTEGRATION.md) |
| 脱敏配置示例 | [mcp-config.example.json](../mcp-config.example.json)，鉴权仅含 `${MCD_TOKEN}` 占位符 |
| 可运行源代码 | 前端、Worker、本地开发入口、测试及 GitHub Actions 部署配置均在仓库内 |
| 开源使用许可 | [MIT License](../LICENSE)，第三方资料与商标的权利边界见[开发文档](development.md#参赛材料与许可) |
| 产品身份说明 | [开发文档](development.md#项目范围)注明独立开发、非麦当劳官方产品 |

比赛对 Skill 的定义包含应用和工作流，不要求为网页额外制作 `SKILL.md`。`workbuddy.md` 只与真实使用 WorkBuddy 的专项奖励有关；本项目没有相应使用记录，因此不提交虚构记录。

## 仍需确认

1. **公共服务中的共享凭证。** 服务规则第 1 条限定个人非商业授权，第 2 条限制凭证分享及托管到未经官方认证的第三方平台。当前 GitHub Secrets → Cloudflare Worker 的方案保护了凭证机密性，但未找到这种部署及多访客使用方式获得官方认可的证据。
2. **赞助用途。** 官方 MCP 文档限制未经书面授权把该仓库内容用于引流变现等用途。本项目免费提供工具、通过爱发电向开源作者赞助，且不代下单；这些事实仍不足以证明它不落入该限制，需主办方解释适用范围。
3. **调用方式。** 服务规则第 3、6 条的自动化调用限制，与本次比赛允许应用/工作流的表述存在适用范围疑问。不能自行推定参赛即获得全部豁免。
4. **参赛者承诺。** 中国大陆居民身份、年龄或监护人同意、素材与代码使用权，以及已阅读并接受规则，需要参赛者本人确认。复制声明文件并不替代这些确认。

给主办方的[询问草稿](contest-questions.md)已准备，尚未发送。若官方不允许共享凭证或赞助用途，需要据其答复调整产品；仅改为让访客输入 token，不能自动解决上述全部问题。

## 报名步骤

1. 先核实以上待确认事项并阅读官方声明。
2. 在北京时间 **2026-10-25 23:59** 前，通过[官方活动仓库 Issue](https://github.com/M-China/mcd-developer-innovation-challenge/issues/new)提交申请。可复制[报名正文草稿](contest-application.txt)；项目名、地址、简介分别与字段名保持在同一行，地址不用 Markdown。
3. 以报名 Issue 下官方系统的成功通知为报名结果。当前仅完成材料准备，没有自动发布询问或报名 Issue。

Star 数影响榜单，0 Star 不进入榜单；榜单展示本身不等于最终资格审核通过。本项目不会生成或操纵 Star 数据。
