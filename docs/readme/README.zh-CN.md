# LocalsBnb / 路客云 MCP

把 AI 助手连接到已授权门店，查询房态、房价、订单及经营数据。业务修改须经过预览、明确确认和结果回查。

[English](../../README.md)

## 两种使用方式

- **远程连接**：使用已部署的 HTTPS MCP 服务，通过网页登录、选择门店并授权，用户电脑无需安装 Node.js。
- **本地部署**：在电脑上运行 Node.js MCP 进程，通过 stdio 接入支持本地 MCP 的客户端。

国内门店使用路客云接口，海外门店使用 LocalsBnb 接口；可用能力由门店类型、OAuth scopes 和后台接口权限共同决定。

## WorkBuddy 远程连接

添加远程 MCP，地址填写：

```text
https://agent-prod.localhome.cn/workbuddy/mcp
```

在授权页选择“中国国内”或“Overseas”，登录、选择门店并核对权限。密码、验证码、Token 和 App Secret 不应发送到聊天中。没有现成 App Secret 的门店需先由管理员在 PC 配置。

[WorkBuddy 配置文件](../../workbuddy/mcp.json)不含账号凭证。直接用浏览器打开 MCP 地址返回405是正常行为；客户端使用POST，未授权时返回401及OAuth发现信息。

ChatGPT 自定义远程 MCP 应用入口为 `https://agent-prod.localhome.cn/mcp`。是否可配置取决于客户端能力和账号权限；提供入口不代表已经在公开目录上架。

## 本地从源码运行

使用 Node.js 22 和 npm：

```sh
npm install
npm run type-check
npm run build
```

在支持本地 stdio 的客户端中配置，替换为自己电脑的绝对路径：

```json
{
  "mcpServers": {
    "localsbnb": {
      "command": "node",
      "args": ["/absolute/path/localsbnbAi/dist/index.js"],
      "env": {
        "LUKEYUN_API_BASE_URL": "https://hudson-prod.localhome.cn",
        "LOCALSBNB_SITE_URL": "https://localsbnb.com"
      }
    }
  }
}
```

本地模式可使用本地登录流程，或通过受保护的客户端环境配置填写已有 `APP_SECRET`、`APP_ID`。不要提交真实值或把凭证发到聊天中。npm已发布包与GitHub源码可能不是同一版本；从本仓库构建可使用当前源码。

## 支持的能力与边界

- 房态、房价、预抵、在住、预离、订单详情和经营数据查询。
- 按版本支持入住、正常退房、续住、排房、未收款手工录单、关开房和脏净房。
- 国内适配器支持符合条件的整单取消、批量渠道改价、中央日历价及关联渠道影响预览。
- 发起渠道授权网页，并查询渠道账号、门店和房型关联结果；渠道密码在渠道页面输入。

国内取消仅支持未收款、未入住且不涉及押金或退款记录的手工短租订单。提前入住、涉及改价的提前退房及不支持的资金流程须在PC处理。国内价格修改最多30个日期，批量改价最多20个目标。

修改前须核对对象、日期、金额与影响范围，再确认一次。返回 `unknown` 时，应查询操作状态及实际业务对象，不得自动重复写入。

## 自行部署远程服务

远程启动入口为 `dist/remote/runtimeIndex.js`。通用Docker、Compose、占位环境变量和迁移SQL位于 [deployment/remote](../../deployment/remote)。其中没有公司ACK配置或真实凭证。

需配置明确的环境、HTTPS域名、PostgreSQL、Redis、独立加密密钥及OAuth客户端。设置 `LOCALSBNB_WORKBUDDY_SOURCE=localsbnb` 启用WorkBuddy。业务开关应在存储和服务凭证准备后启用；不得把本地门店身份配置注入共享远程服务。

新库使用迁移001、002；003用于旧字段升级，执行前核对实际结构，不要在已升级的库盲目重跑。更新或轮换密钥时，已有加密记录仍需保留旧key的解密能力。海外渠道网页握手另需配置PC服务端。

`/readyz` 正常只代表运行依赖就绪，不等于用户授权、接口权限和业务验收全部通过。

## 支持

[localsbnb.com](https://localsbnb.com/)
