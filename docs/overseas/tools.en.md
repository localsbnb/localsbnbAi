# Tools and sample prompts (Overseas)

Tool **names** stay in English. Descriptions follow the property language.

## Read

| Tool | Ask like |
|------|----------|
| `query_today_orders` | Today’s board / arrivals, in-house, departures |
| `query_pre_arrival_orders` | Who arrives today? Pending check-in |
| `query_in_house_orders` | Who is in-house? |
| `query_pre_departure_orders` | Who checks out today? |
| `query_orders_by_date_range` | This week’s bookings (`timeRange=this_week`) |
| `get_order_details_v2` | Details for order `{id}` — always say the guest name |
| `query_today_room_status` | Today’s rooms / dirty / vacant |
| `query_room_status_new` | This week room calendar (`timeRange=this_week`) |
| `query_room_prices` | This week Airbnb / Booking rates |
| `query_operational_data_v2` | This week OCC / ADR / revenue (no night-audit) |

“This week” / “last week” = Monday–Sunday in the **property timezone**. Do not send a rolling 7 or 30 days instead.

Amounts are fen ÷ 100 with the property currency. JPY / KRW show 0 decimals.

## Write (overseas only, two-step confirm)

| Tool | Required | Confirm |
|------|----------|---------|
| `check_in_order` | `orderDetailIds` | First call without `confirm`; then `confirm=true` |
| `check_out_order` | `orderDetailIds` | same |
| `extend_order` | `previousOrderId`, `nights` ≥ 1, `roomId` | `paid` optional (fen). Preview quotes via `/bnbOrder/calcPayout` unless `calcPayout=false` |
| `arrange_room` | `orderDetailId`, `roomId` | assign / change room |

Cancellation is **not** in v1.
