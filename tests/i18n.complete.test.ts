import { t, type AppLocale } from '../src/region/i18n';
import { getOverseasToolDescription } from '../src/region/toolDescriptions';
import { handleError, MCPError, ErrorCode } from '../src/utils/errorHandler';

const LOCALES: AppLocale[] = ['en', 'ja', 'th', 'ms', 'zh-CN', 'zh-TW'];

const I18N_KEYS = [
  'label.total',
  'label.guest',
  'label.empty',
  'title.preArrival',
  'title.inHouse',
  'title.preDeparture',
  'title.todayOrders',
  'title.orderDetail',
  'guest.mustShow',
  'confirm.need',
  'confirm.needIdentity',
  'confirm.title.checkIn',
  'confirm.done.checkIn',
  'error.auth',
  'error.params',
  'error.orderNotFound',
  'error.internal',
  'clean.0',
  'clean.2',
];

const TOOLS = [
  'query_today_orders',
  'query_pre_arrival_orders',
  'query_in_house_orders',
  'query_pre_departure_orders',
  'query_orders_by_date_range',
  'get_order_details_v2',
  'query_today_room_status',
  'query_room_status_new',
  'query_room_prices',
  'query_operational_data_v2',
  'check_in_order',
  'check_out_order',
  'extend_order',
  'arrange_room',
];

describe('i18n completeness', () => {
  it('every listed key has six distinct-enough locale strings', () => {
    for (const key of I18N_KEYS) {
      const texts = LOCALES.map((loc) => t(loc, key));
      expect(texts.every((s) => s && s !== key)).toBe(true);
      expect(t('en', key)).not.toBe(t('zh-CN', key));
      expect(new Set(texts).size).toBeGreaterThanOrEqual(4);
    }
  });

  it('unknown locale falls back to English', () => {
    expect(t(undefined, 'label.total')).toBe(t('en', 'label.total'));
  });

  it('all overseas tool descriptions exist in six locales', () => {
    for (const name of TOOLS) {
      const en = getOverseasToolDescription(name, 'en');
      expect(en && en.length > 10).toBe(true);
      for (const loc of LOCALES) {
        const d = getOverseasToolDescription(name, loc);
        expect(d && d.length > 8).toBe(true);
      }
      expect(getOverseasToolDescription(name, 'zh-CN')).not.toBe(en);
    }
  });

  it('overseas handleError uses locale, CN handleError stays Chinese', () => {
    const cn = handleError(new MCPError(ErrorCode.API_NOT_FOUND, 'x', { domain: 'order_detail' }));
    const en = handleError(
      new MCPError(ErrorCode.API_NOT_FOUND, 'x', { domain: 'order_detail' }),
      'en'
    );
    const ja = handleError(
      new MCPError(ErrorCode.API_NOT_FOUND, 'x', { domain: 'order_detail' }),
      'ja'
    );
    expect(cn.content[0].text).toContain('未查询到相关订单数据');
    expect(en.content[0].text).toContain('Order not found');
    expect(ja.content[0].text).toContain('注文が見つかりません');
    expect(en.content[0].text).not.toContain('未查询到相关订单数据');
  });

  it('missing required fields are param errors, not system-busy', () => {
    const ja = handleError(new Error('orderDetailIds is required'), 'ja');
    expect(ja.content[0].text).toContain('入力条件を確認して再試行してください');
    expect(ja.content[0].text).not.toContain('システムが混み合っています');
    expect(ja.content[0].text).toContain('INVALID_PARAMS');

    const en = handleError(new MCPError(ErrorCode.MISSING_PARAMS, 'orderDetailIds is required'), 'en');
    expect(en.content[0].text).toContain('Please check the input and try again');
    expect(en.content[0].text).not.toContain('The system is busy');
  });

  it('AUTH_INVALID uses localized auth copy, not system-busy', () => {
    const zh = handleError(new MCPError(ErrorCode.AUTH_INVALID, 'token invalid'));
    const ja = handleError(new MCPError(ErrorCode.AUTH_INVALID, 'token invalid'), 'ja');
    const en = handleError(new MCPError(ErrorCode.AUTH_INVALID, 'token invalid'), 'en');
    expect(zh.content[0].text).toContain('AUTH_INVALID');
    expect(zh.content[0].text).toContain('当前秘钥信息错误');
    expect(ja.content[0].text).toContain('認証キーが無効です');
    expect(en.content[0].text).toContain('The current key is invalid');
    expect(ja.content[0].text).not.toContain('システムが混み合っています');
  });

  it('Hudson Param error on order details maps to Order not found', () => {
    const ja = handleError(
      new MCPError(ErrorCode.API_NOT_FOUND, 'Order not found', { domain: 'order_detail' }),
      'ja'
    );
    expect(ja.content[0].text).toContain('注文が見つかりません');
    expect(ja.content[0].text).not.toContain('Param error');
  });
});
