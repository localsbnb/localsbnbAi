# 工具与示例问法（海外）

工具 **name** 仍是英文。description 随门店语言切换。

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
