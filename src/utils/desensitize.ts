/**
 * 数据脱敏工具（按 PRD 5.2 数据脱敏与隐私）
 * 姓名：保留姓，其余用 *；手机号：保留前3后4；证件号：仅保留后4位或全部 *
 */

/**
 * 姓名脱敏：保留姓，其余用 *（如「张**」）
 */
export function maskName(name: string | null | undefined): string {
  if (name == null || String(name).trim() === '') return '';
  const s = String(name).trim();
  if (s.length <= 1) return s;
  return s[0] + '*'.repeat(Math.min(s.length - 1, 2)); // 最多显示2个*
}

/**
 * 手机号脱敏：保留前3后4，中间 ****（如 138****1234）
 */
export function maskPhone(phone: string | null | undefined): string {
  if (phone == null || String(phone).trim() === '') return '';
  const s = String(phone).replace(/\s/g, '');
  if (s.length <= 7) return s.length <= 3 ? s : s.slice(0, 3) + '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/**
 * 证件号脱敏：仅保留后4位，其余用 *（如 ****1234）
 */
export function maskIdCard(idCard: string | null | undefined): string {
  if (idCard == null || String(idCard).trim() === '') return '';
  const s = String(idCard).trim();
  if (s.length <= 4) return '*'.repeat(s.length);
  return '****' + s.slice(-4);
}

const ORDER_LIST_NAME_FIELDS = ['guestName', 'channelGuestName', 'urgencyGuestName'] as const;

/**
 * 对订单列表项脱敏（guestName、channelGuestName、urgencyGuestName、guestMobile）
 */
export function desensitizeOrderItem<
  T extends { guestName?: string; guestMobile?: string; channelGuestName?: string; urgencyGuestName?: string },
>(item: T): T {
  const out = { ...item };
  const rec = out as Record<string, unknown>;
  for (const key of ORDER_LIST_NAME_FIELDS) {
    if (typeof rec[key] === 'string') {
      rec[key] = maskName(rec[key] as string);
    }
  }
  if (typeof rec.guestMobile === 'string') {
    rec.guestMobile = maskPhone(rec.guestMobile as string);
  }
  return out;
}

/**
 * 对订单详情脱敏（guestName、guestMobile、channelGuestName、channelGuestMobile、urgencyGuestName、urgencyGuestMobile 等）
 */
export function desensitizeOrderDetail(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  const nameFields = ['guestName', 'channelGuestName', 'urgencyGuestName', 'creatorName', 'promotionUserName'];
  const phoneFields = ['guestMobile', 'channelGuestMobile', 'urgencyGuestMobile'];
  nameFields.forEach((key) => {
    if (typeof out[key] === 'string') out[key] = maskName(out[key] as string);
  });
  phoneFields.forEach((key) => {
    if (typeof out[key] === 'string') out[key] = maskPhone(out[key] as string);
  });
  if (typeof out.idCard === 'string' || typeof out.idNo === 'string') {
    if (typeof out.idCard === 'string') out.idCard = maskIdCard(out.idCard);
    if (typeof out.idNo === 'string') out.idNo = maskIdCard(out.idNo);
  }
  if (out.virtualMobile && typeof out.virtualMobile === 'object' && Array.isArray((out.virtualMobile as { virtualMobileDetails?: unknown[] }).virtualMobileDetails)) {
    const vmd = (out.virtualMobile as { virtualMobileDetails: Array<{ mobile?: string }> }).virtualMobileDetails;
    vmd.forEach((item) => {
      if (typeof item.mobile === 'string') item.mobile = maskPhone(item.mobile);
    });
  }
  return out;
}

/**
 * 订单详情不向终端展示「优惠/减免」类字段（产品无此口径时从返回中剔除）
 */
export function stripOrderDetailDiscountFields(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  delete out.totalReducePrice;
  if (Array.isArray(out.orderDetails)) {
    out.orderDetails = (out.orderDetails as Record<string, unknown>[]).map((row) => {
      const r = { ...row };
      delete r.reducePrice;
      return r;
    });
  }
  return out;
}

/**
 * 对房态中的 guestName、orders[].guestName/guestMobile 脱敏
 */
export function desensitizeRoomStatusItem(room: Record<string, unknown>): Record<string, unknown> {
  const out = { ...room };
  if (typeof out.guestName === 'string') out.guestName = maskName(out.guestName as string);
  if (Array.isArray(out.orders)) {
    out.orders = (out.orders as Record<string, unknown>[]).map((o) => {
      const o2 = { ...o };
      if (typeof o2.guestName === 'string') o2.guestName = maskName(o2.guestName as string);
      if (typeof o2.guestMobile === 'string') o2.guestMobile = maskPhone(o2.guestMobile as string);
      return o2;
    });
  }
  return out;
}
