# เครื่องมือและคำถามตัวอย่าง (ต่างประเทศ)

| เครื่องมือ | ถามแบบนี้ได้ |
|------------|----------------|
| `query_today_orders` | ออเดอร์วันนี้ |
| `query_pre_arrival_orders` | ใครถึงวันนี้ |
| `query_in_house_orders` | ใครกำลังพัก |
| `query_pre_departure_orders` | ใครออกวันนี้ |
| `query_orders_by_date_range` | ออเดอร์สัปดาห์นี้ (`timeRange=this_week`) |
| `get_order_details_v2` | รายละเอียดออเดอร์ (ต้องบอกชื่อแขก) |
| `query_today_room_status` | สถานะห้องวันนี้ |
| `query_room_status_new` | ปฏิทินห้องสัปดาห์นี้ |
| `query_room_prices` | ราคาสายช่องทางสัปดาห์นี้ |
| `query_operational_data_v2` | OCC / ADR / รายได้สัปดาห์นี้ |

เขียนข้อมูล (ต่างประเทศเท่านั้น): `check_in_order` / `check_out_order` / `extend_order` / `arrange_room` ต้อง `confirm=true` ยังไม่รองรับยกเลิก
