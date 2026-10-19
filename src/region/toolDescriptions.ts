import type { AppLocale } from './types.js';

type ToolName =
  | 'query_room_status_new'
  | 'query_today_room_status'
  | 'query_room_prices'
  | 'query_today_orders'
  | 'query_pre_arrival_orders'
  | 'query_in_house_orders'
  | 'query_pre_departure_orders'
  | 'query_orders_by_date_range'
  | 'get_order_details_v2'
  | 'query_operational_data_v2'
  | 'check_in_order'
  | 'check_out_order'
  | 'extend_order'
  | 'arrange_room';

const DESC: Record<ToolName, Record<AppLocale, string>> = {
  query_room_status_new: {
    en: 'Query listing/room calendar: availability, inventory, reservations and blocks. Not rate/price. For “this week / last week” pass timeRange=this_week or last_week (Mon–Sun in the property timezone). Do not use a rolling 30 days for “this week”.',
    ja: 'リスティング／部屋カレンダー（在庫・予約・ブロック）。料金照会ではない。「今週／先週」は timeRange=this_week または last_week（月曜始まり、施設タイムゾーン）。「今週」を直近30日で代用しない。',
    th: 'ปฏิทินห้อง: คงเหลือ การจอง และปิดห้อง ไม่ใช่ราคา ถ้าพูดว่าสัปดาห์นี้/สัปดาห์ก่อน ต้องส่ง timeRange=this_week หรือ last_week (จ–อา ตามโซนเวลาที่พัก)',
    ms: 'Kalendar bilik: inventori, tempahan dan sekatan. Bukan harga. Untuk “minggu ini / minggu lepas” hantar timeRange=this_week atau last_week (Isnin–Ahad, zon waktu hartanah).',
    'zh-CN': '按房型日历查询房态、可售与库存（海外组装接口）。与房价无关：用户说房价/日历价时必须调用 query_room_prices。「本周」「上周」必须传 timeRange=this_week 或 last_week（自然周周一至周日，门店时区）。',
    'zh-TW': '依房型日曆查詢房態、可售與庫存。與房價無關：使用者說房價/日曆價時請呼叫 query_room_prices。「本週」「上週」必須傳 timeRange=this_week 或 last_week（週一至週日，門市時區）。',
  },
  query_today_room_status: {
    en: 'Today’s room snapshot: clean/dirty, occupancy, arrivals and departures. Not channel rates. Keywords: today rooms, room status.',
    ja: '本日の部屋状況（清掃・稼働・到着／出発）。チャネル料金ではない。',
    th: 'สถานะห้องวันนี้: สะอาด/สกปรก เข้าพัก ถึง/ออก ไม่ใช่ราคาช่องทาง',
    ms: 'Snapshot bilik hari ini: bersih/kotor, penginapan, ketibaan dan berlepas. Bukan harga saluran.',
    'zh-CN': '查询今日（或指定日）房态汇总：房间、库存与保洁等，不含渠道房价。',
    'zh-TW': '查詢今日（或指定日）房態彙總：房間、庫存與清潔等，不含通路房價。',
  },
  query_room_prices: {
    en: 'Query channel rates (Airbnb / Booking / Agoda / Trip.com). For “this week / last week” pass timeRange. Amounts are in the property currency (fen/100).',
    ja: 'チャネル料金（Airbnb / Booking / Agoda / Trip.com）。「今週／先週」は timeRange を指定。金額は施設通貨（分/100）。',
    th: 'ราคาสายช่องทาง (Airbnb / Booking / Agoda / Trip.com) สัปดาห์นี้/ก่อน ต้องส่ง timeRange จำนวนเงินเป็นสกุลเงินที่พัก (หาร 100)',
    ms: 'Harga saluran (Airbnb / Booking / Agoda / Trip.com). Untuk minggu ini/lepas hantar timeRange. Amaun dalam mata wang hartanah (dibahagi 100).',
    'zh-CN': '查询房价（渠道 RP）。用户说「本周房价」「上周房价」时必须传 timeRange=this_week 或 last_week（自然周，门店时区）。金额为分/100 并带货币。',
    'zh-TW': '查詢房價（通路 RP）。「本週／上週房價」必須傳 timeRange。金額為分/100 並帶貨幣。',
  },
  query_today_orders: {
    en: 'Today’s board: arrivals (pending check-in), in-house, and departures. Always include guest names in the reply.',
    ja: '本日の予約ボード：到着・滞在中・出発。返信時は必ずゲスト名を含める。',
    th: 'บอร์ดวันนี้: ถึง กำลังพัก และออก ต้องระบุชื่อแขกเสมอ',
    ms: 'Papan hari ini: ketibaan, sedang menginap dan berlepas. Wajib nyatakan nama tetamu.',
    'zh-CN': '今日订单（聚合）：同时查询预抵、在住、预离三组，并分别返回总数与明细。回复必须包含客人姓名。',
    'zh-TW': '今日訂單（聚合）：同時查詢預抵、在住、預離。回覆必須包含客人姓名。',
  },
  query_pre_arrival_orders: {
    en: 'Arrivals today: reservations whose check-in date is today and status is pending check-in.',
    ja: '本日到着：チェックイン日が今日で未チェックインの予約。',
    th: 'ถึงวันนี้: วันเช็คอินคือวันนี้ และยังไม่เช็คอิน',
    ms: 'Ketibaan hari ini: tarikh daftar masuk hari ini dan belum check-in.',
    'zh-CN': '预抵订单（今日待入住）。入住日=今天且子单状态=待入住。',
    'zh-TW': '預抵訂單（今日待入住）。入住日=今天且子單狀態=待入住。',
  },
  query_in_house_orders: {
    en: 'In-house stays: checked-in reservations that have not reached check-out yet (last 30 check-in days, then filtered).',
    ja: '滞在中：チェックイン済で未チェックアウト（直近30日の到着日から再フィルタ）。',
    th: 'กำลังพัก: เช็คอินแล้วและยังไม่ออก (ย้อน 30 วันแล้วกรอง)',
    ms: 'Sedang menginap: sudah check-in dan belum check-out (30 hari terakhir, ditapis semula).',
    'zh-CN': '在住订单：子单入住中，且离店日晚于今天（入住日近 30 天再过滤）。',
    'zh-TW': '在住訂單：子單入住中，且離店日晚於今天。',
  },
  query_pre_departure_orders: {
    en: 'Departures today: in-house reservations whose check-out date is today.',
    ja: '本日出発：チェックアウト日が今日の滞在中予約。',
    th: 'ออกวันนี้: วันเช็คเอาต์คือวันนี้ และกำลังพัก',
    ms: 'Berlepas hari ini: tarikh daftar keluar hari ini dan masih menginap.',
    'zh-CN': '预离订单（今日待退房）。离店日=今天且子单状态=入住中。',
    'zh-TW': '預離訂單（今日待退房）。離店日=今天且子單狀態=入住中。',
  },
  query_orders_by_date_range: {
    en: 'Orders in a date range. Default searches by check-in date. Use timeRange=this_week/last_week or startDate+endDate. Do not mix with the today board tools.',
    ja: '期間指定の予約。既定はチェックイン日。timeRange または startDate+endDate。本日ボードツールと混在させない。',
    th: 'คำสั่งตามช่วงวันที่ ค่าเริ่มค้นตามวันเช็คอิน ใช้ timeRange หรือ startDate+endDate',
    ms: 'Pesanan mengikut julat. Lalai ikut tarikh daftar masuk. Guna timeRange atau startDate+endDate.',
    'zh-CN': '按日期范围查订单。默认按入住日。支持 startDate/endDate 或 timeRange=this_week/last_week。不要与今日预抵/在住/预离混用。',
    'zh-TW': '依日期範圍查訂單。預設按入住日。支援 startDate/endDate 或 timeRange。',
  },
  get_order_details_v2: {
    en: 'Get one booking by order ID. The reply MUST include the guest name. You may first list today’s orders to obtain the ID.',
    ja: '注文IDで詳細取得。返信にゲスト名必須。先に本日の予約でIDを取得してよい。',
    th: 'ดูรายละเอียดด้วยรหัสคำสั่ง ต้องระบุชื่อแขกเสมอ',
    ms: 'Dapatkan butiran mengikut ID pesanan. Nama tetamu wajib dalam balasan.',
    'zh-CN': '根据订单ID查询订单详情。返回中含客人姓名，向用户回复时必须说明客人姓名（不得省略）。',
    'zh-TW': '依訂單ID查詢詳情。回覆時必須說明客人姓名。',
  },
  query_operational_data_v2: {
    en: 'Occupancy, ADR, revenue and daily/monthly series. No night-audit. For “this week / last week” pass timeRange (Mon–Sun, property timezone).',
    ja: 'OCC・ADR・売上と日次／月次系列。ナイト監査なし。「今週／先週」は timeRange（月曜始まり、施設TZ）。',
    th: 'OCC ADR รายได้ และชุดข้อมูลรายวัน ไม่มี night audit สัปดาห์นี้/ก่อน ต้องส่ง timeRange',
    ms: 'OCC, ADR, hasil dan siri harian. Tiada night audit. Minggu ini/lepas: timeRange.',
    'zh-CN': '查询经营数据：营业收入、OCC、ADR、开房数及日/月序列。海外无夜审。「本周」「上周」必须传 timeRange（周一至周日，门店时区）。',
    'zh-TW': '查詢經營數據：營業收入、OCC、ADR、開房數及日/月序列。海外無夜審。「本週／上週」必須傳 timeRange。',
  },
  check_in_order: {
    en: 'Check in. First call WITHOUT confirm to show guest/order ID/dates. Ask the human which booking it is; only after they confirm, call again with confirm=true. Never confirm in the same turn as the first lookup.',
    ja: 'チェックイン。まず confirm なしでゲスト・注文ID・日程を示し、ユーザーが「この予約」と認めてから confirm=true。初回と同じターンで確定しない。',
    th: 'เช็คอิน รอบแรกห้าม confirm โชว์ชื่อแขก/รหัส/วัน รอผู้ใช้ยืนยันว่ารายการนี้ แล้วค่อย confirm=true ห้ามยืนยันรอบเดียวกับที่ค้นหา',
    ms: 'Daftar masuk. Panggil pertama TANPA confirm, tunjuk tetamu/ID/tarikh, tunggu manusia sahkan, kemudian confirm=true. Jangan sahkan dalam pusingan yang sama.',
    'zh-CN': '办理入住。第一次不要传 confirm，展示客人/订单号/入离，问用户是不是这一笔；用户确认后再以 confirm=true 执行。禁止在第一次查找的同一轮就 confirm。',
    'zh-TW': '辦理入住。第一次不要傳 confirm，展示客人／訂單號／入離，問使用者是不是這一筆；確認後再以 confirm=true 執行。禁止在第一次查找的同一輪就 confirm。',
  },
  check_out_order: {
    en: 'Check out. Preview without confirm (guest/order ID/dates), wait for the human to confirm that booking, then confirm=true. Never confirm in the same turn as the first lookup.',
    ja: 'チェックアウト。confirm なしで内容を示し、ユーザー確認後に confirm=true。初回と同じターンで確定しない。',
    th: 'เช็คเอาต์ พรีวิวโดยไม่ confirm รอผู้ใช้ยืนยันรายการ แล้วค่อย confirm=true',
    ms: 'Daftar keluar. Pratonton tanpa confirm, tunggu manusia sahkan tempahan, kemudian confirm=true.',
    'zh-CN': '办理退房。先不传 confirm 展示客人/订单号/入离，用户确认是这一笔后再 confirm=true。禁止同一轮查找并确认。',
    'zh-TW': '辦理退房。先不傳 confirm 展示客人／訂單號／入離，使用者確認是這一筆後再 confirm=true。禁止同一輪查找並確認。',
  },
  extend_order: {
    en: 'Extend stay: previousOrderId + nights(>=1) + roomId. Preview without confirm (guest/dates/quote), wait for the human to confirm that booking, then confirm=true.',
    ja: '延長：previousOrderId + nights(≥1) + roomId。confirm なしで確認し、ユーザーが認めてから confirm=true。',
    th: 'ต่อคืน: previousOrderId + nights + roomId พรีวิวไม่ confirm รอผู้ใช้ยืนยัน แล้วค่อย confirm=true',
    ms: 'Lanjut menginap: previousOrderId + nights + roomId. Pratonton tanpa confirm, tunggu sahkan, kemudian confirm=true.',
    'zh-CN': '续住：previousOrderId + nights(≥1) + roomId。先不传 confirm 展示客人/入离/报价，用户确认是这一笔后再 confirm=true。',
    'zh-TW': '續住：previousOrderId + nights(≥1) + roomId。先不傳 confirm 展示客人／入離／報價，確認是這一筆後再 confirm=true。',
  },
  arrange_room: {
    en: 'Assign/change room: orderDetailId + roomId. Preview without confirm (guest/order/dates), wait for the human to confirm that booking, then confirm=true.',
    ja: '部屋割当：orderDetailId + roomId。confirm なしで示し、ユーザー確認後に confirm=true。',
    th: 'จัด/ย้ายห้อง orderDetailId + roomId พรีวิวไม่ confirm รอผู้ใช้ยืนยัน แล้วค่อย confirm=true',
    ms: 'Tugaskan/tukar bilik: orderDetailId + roomId. Pratonton tanpa confirm, tunggu sahkan, kemudian confirm=true.',
    'zh-CN': '换房/排房：orderDetailId + roomId。先不传 confirm 展示客人/订单/入离，用户确认是这一笔后再 confirm=true。',
    'zh-TW': '換房/排房：orderDetailId + roomId。先不傳 confirm 展示客人／訂單／入離，確認是這一筆後再 confirm=true。',
  },
};

export function getOverseasToolDescription(name: string, locale: AppLocale): string | undefined {
  const row = DESC[name as ToolName];
  if (!row) return undefined;
  return row[locale] || row.en;
}
