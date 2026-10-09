# 工具与示例问法（海外）

工具 **name** 仍是英文。原有工具 description 随门店语言切换；2026-10-09 新增的 S08/S09 工具 description 暂为英文。新增工具只在海外门店注册；人工验收已通过，MCP 工作区尚未提交/发布。

## 查询

| 工具 | 可以这样问 |
|------|------------|
| `query_today_orders` | 今日订单、今天待办 |
| `query_pre_arrival_orders` | 今天预抵、待入住 |
| `query_in_house_orders` | 在住有谁 |
| `query_pre_departure_orders` | 今天预离、待退房 |
| `query_orders_by_date_range` | 本周订单（`timeRange=this_week`） |
| `get_order_details_v2` | 查 `{id}` 订单详情 — 回复必须带客人姓名 |
| `query_today_room_status` | 今天房态、脏净房 |
| `query_room_status_new` | 本周房态日历 |
| `query_room_prices` | 本周 Airbnb / Booking 房价 |
| `query_operational_data_v2` | 本周入住率 / ADR / 营收（无夜审） |

「本周 / 上周」= 门店时区周一至周日，不要用滚动 7 天或 30 天代替。

金额为分 ÷ 100，带货币。JPY / KRW 不显示小数。

## 写操作（仅海外，二次确认）

| 工具 | 必填 | 确认 |
|------|------|------|
| `check_in_order` | `orderDetailIds` | 先不传 confirm 预览，再 `confirm=true` |
| `check_out_order` | `orderDetailIds` | 同上 |
| `extend_order` | `previousOrderId`、`nights`≥1、`roomId` | `paid` 可选（分）。未传 `paid` 时预览会调 `/bnbOrder/calcPayout`；`calcPayout=false` 可跳过 |
| `arrange_room` | `orderDetailId`、`roomId` | 排房 / 换房 |

第一期不做取消。

## Airbnb Handshake

仅海外店。完整 OAuth 使用已发布的 `https://overseas-dev.localhome.cn`。

2026-10-08 S05、S06 开链验证通过，API 环境隔离修复已在线生效；但浏览器初始化 `/camps/get` 仍返回 `COMMON_PERMISSION_DENIED`。真实 OAuth、poll 成功及导入仍待验收（S10），参见[交接清单](./ai-onboarding-xcode-handoff.zh-CN.md)。

HTTPS 修复已提交并通过发布后复测；S07 暂停；S08/S09 人工验收已通过。开链页须在手机浏览器可用；文案提示「浏览器页面（手机或桌面均可）」。

| 工具 | 可以这样问 |
|------|------------|
| `start_handshake` | 连接 Airbnb |
| `poll_handshake` | 我已完成 Airbnb 授权 / 已完成 |
| `list_channel_accounts` | 已绑的 Airbnb 账号 |
| `import_airbnb_listings` | 导入这些 Airbnb 房源（先预览） |


## S08 · Booking / Trip / Agoda（人工验收通过；暂无真实渠道账号真连）

**默认交互已简化：** 用户说“连接 Booking/Trip/Agoda” → 调用 `start_channel_connection`（仅需 channel）记录当前列表并打开浏览器页面（手机/桌面均可）→ 提示用户在页面完成后只回复“已完成” → 调用无参数 `complete_channel_connection` 比较前后列表及映射状态 → succeeded 后结束。pending/needs_action 保留原记录，不要求用户提供编号。

记录绑定当前客户端/门店/凭证，1 小时有效，重启后需重新发起；一次跟进一个渠道，重复发起不会覆盖未完成流程。仅新增/映射状态变化且关联完整才成功，时间戳、名称变化或仅删除不算完成。沿用浏览器登录态；自动开页失败时提供手动链接。`/linkbooking` 等页须窄屏可用（viewport、主 CTA），详见交接第 0.12 节。以下纯对话写工具为高级方式，只有用户明确要求时使用。


| 工具 | 输入与用途 |
|------|------------|
| `connect_channel_poi` | `channel=booking/trip/agoda`、`outPoiId`；检查已有连接后预览创建物业 |
| `query_channel_connection` | `channel`，可选 `poiId`、`pageNum`；查询关联状态、房型、产品及本地候选；只读 |
| `map_channel_listing` | `channel`、`poiId`、`kind`；`property` 需 `parentPoiId`；`room` 需渠道 `roomCategoryId`、本地 `parentRoomCategoryId`，可带 `productMappings` |

先查询渠道和本地候选，所有 ID 原样用字符串。先关联门店，再在该门店范围内映射房型；产品映射项为 `{roomCategoryProductId, parentRoomCategoryProductId}`，须分别属于所选渠道/本地房型。Trip 的 `isPublish=0` 由工具自动设置。连接状态 1/2/3/4 分别是未关联/关联中/已关联/异常。后台同步未完成时重新查询，不重复创建。

例如用户说“连接 Booking，物业编号 ABC123”，首次调用：

```json
{"channel":"booking","outPoiId":"ABC123"}
```

返回预览后先展示渠道、物业编号和影响。用户明确确认后，保持参数一致，补入实际返回的 `previewId` 和 `confirm:true` 调用同一工具。创建后的 `poiId` 用于继续查询/映射；不把创建请求成功等同于房型与政策已全部配置。

## S09 · 运营写操作（人工验收通过，含真实写入）

| 工具 | 必填 / 规则 |
|------|-------------|
| `update_channel_prices` | `roomCategoryProductId`、`startDate`、`endDate`、`amountFen`；可选 7 位 `validWeekDays`，顺序为周日到周六，0/1 表示是否生效；金额 10–999999999 分 |
| `close_rooms` | `roomId`、`startDate`、`endDate`；`type` 默认 1（普通），可选 4（维修）、5（保留）；可选 `remark` |
| `open_rooms` | `roomId`、`startDate`、`endDate`；只解除指定日期的普通/维修/保留占用，不解除订单和联动占用 |
| `update_room_clean_state` | `roomId`、`cleanState`（`dirty`/`clean`/`waiting`/`not_set` 或 0–3）；对齐 `/room/updateCleanState`。可问：把 lhq 设为脏房 / 净房 |
| `create_manual_order` | `roomCategoryId`、`roomId`、`checkInDate`、`checkOutDate`、`guestName`；可选人数、邮箱、电话、备注、已付与价格覆盖值 |

所有日期是门店时区的 `YYYY-MM-DD`。改价/开关房首尾日期均包含，最多 91 天；录单退房日不占房，最多 90 晚。每次一个价格方案/房间；录单为单房日租、手工渠道 0、已预订状态 2（对齐 PC NewOrderDrawer）。金额对用户展示时带货币即可，不必强调「分」。

录单人数为 `adults`（默认 1）、`children`、`infants`、`pets`（默认 0）；金额字段为 `paidFen`（默认 0）、`accommodationFareFen`、`cleaningFeeFen`、`taxFen`。后 3 项不传则由 calcPayout 报价回填，房费扣除 discountAmount；金额全部为整数分。预览同时展示报价、实际提交金额和未付余额，已付只是记录，不会收款。

### 新写工具统一确认步骤

1. 首次不传 `confirm`，工具读取当前资源/房态/报价，返回 `status=preview`、`previewId`、有效期、名称、日期、金额及请求内容；此时没有写入。
2. 展示预览并等待用户明确批准。保留原参数，增加布尔 `confirm=true` 与返回的 `previewId`，再次调用同一工具。
3. 预览仅本进程/客户端/凭证/门店有效，10 分钟过期。参数、报价或映射状态变更需要新预览与新确认。重启 MCP 后同样需要重新预览。
4. 确认后只发送一次写请求，禁用自动重试；无论成功还是结果不明，旧预览不能再次提交。网络超时先查询结果，不直接重录单。
5. 写入确认成功返回 `status=submitted`，并自动读取最新数据。`readBackStatus=read` 表示回查返回，仍需比较数据；`failed` 表示回查失败，不能由此认为写入失败。同步渠道可能仍在处理中。

新工具所需 scope：查询渠道 `channels:read`；连接/映射 `channels:write`；改价/开关房 `rooms:write`；录单 `orders:write`。直配 Hudson 认证仍由 Hudson 实际校验接口权限。上述 previewId 机制仅用于这批新工具，不改变旧入住/退房等工具的确认协议。
