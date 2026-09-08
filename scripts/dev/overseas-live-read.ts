/**
 * Overseas property read-only integration smoke test. No writes; tokens are never logged.
 * Run: npx tsx scripts/dev/overseas-live-read.ts
 */
import dotenv from 'dotenv';
import { HTTPClient } from '../../src/client/httpClient.js';
import { resolveRegionProfile } from '../../src/region/resolve.js';
import { getActiveToolDefinitions, toolDefinitions } from '../../src/config/tools.js';
import { t } from '../../src/region/i18n.js';
import { getOverseasToolDescription } from '../../src/region/toolDescriptions.js';
import { queryPreArrivalOrdersOverseas } from '../../src/tools/overseas/orders.js';
import { queryInHouseOrdersOverseas } from '../../src/tools/overseas/orders.js';
import { queryPreDepartureOrdersOverseas } from '../../src/tools/overseas/orders.js';
import { queryTodayOrdersOverseas } from '../../src/tools/overseas/orders.js';
import { queryOrdersByDateRangeOverseas } from '../../src/tools/overseas/orders.js';
import { getOrderDetailsOverseas } from '../../src/tools/overseas/orders.js';
import { queryTodayRoomStatusOverseas } from '../../src/tools/overseas/rooms.js';
import { queryRoomStatusNewOverseas } from '../../src/tools/overseas/rooms.js';
import { queryRoomPricesOverseas } from '../../src/tools/overseas/prices.js';
import { queryOperationalDataOverseas } from '../../src/tools/overseas/finance.js';
import { checkInOrderOverseas } from '../../src/tools/overseas/writes.js';
import type { ToolContext, ToolResult } from '../../src/types/mcp.js';

dotenv.config();

const SAMPLE_ORDER = process.env.OVERSEAS_SAMPLE_ORDER_ID || '2096985573978292226';

function ok(name: string, detail: string) {
  console.log(`PASS\t${name}\t${detail}`);
}
function fail(name: string, detail: string) {
  console.log(`FAIL\t${name}\t${detail}`);
}

function textOf(r: ToolResult): string {
  return r.content?.map((c) => c.text).join('\n') || '';
}

async function main() {
  const campId = process.env.APP_ID;
  const token = process.env.APP_SECRET;
  if (!campId || !token) {
    console.log('SKIP\tlive\tno APP_ID/APP_SECRET in env');
    process.exit(2);
  }

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };
  const client = new HTTPClient('', token);
  const profile = await resolveRegionProfile(client, campId, logger);

  if (profile.region !== 'overseas') {
    fail('resolve', `expected overseas, got ${profile.region} (isBnb not 1?)`);
    process.exit(1);
  }
  ok(
    'resolve',
    `locale=${profile.locale} tz=${profile.hudsonTimeZone} iana=${profile.ianaTimeZone} currency=${profile.currency} weekends=${profile.highlightWeekends}`
  );

  if (profile.region === 'overseas') {
    client.setExtraHeaders({
      lang: profile.localeCode,
      'Accept-Language': profile.localeCode,
      campId: String(profile.campId || campId),
    });
  }

  const tools = getActiveToolDefinitions(profile);
  const names = tools.map((x) => x.name);
  const writes = ['check_in_order', 'check_out_order', 'extend_order', 'arrange_room'];
  if (writes.every((w) => names.includes(w)) && tools.length === toolDefinitions.length + 4) {
    ok('tools', `count=${tools.length} writes=4`);
  } else {
    fail('tools', `count=${tools.length} names=${names.join(',')}`);
  }

  const desc = getOverseasToolDescription('query_today_orders', profile.locale) || '';
  const label = t(profile.locale, 'title.preArrival');
  if (desc && label && desc !== getOverseasToolDescription('query_today_orders', 'en') || profile.locale === 'en') {
    ok('i18n-desc', `locale=${profile.locale} preArrival="${label}"`);
  } else {
    fail('i18n-desc', 'description missing');
  }

  const context: ToolContext = {
    apiClient: client,
    logger,
    permissionChecker: { checkPermission() {} },
    campId,
    regionProfile: profile,
  };

  const jobs: Array<[string, () => Promise<ToolResult>]> = [
    ['pre-arrival', () => queryPreArrivalOrdersOverseas({ pageNum: 1, pageSize: 5 }, context)],
    ['in-house', () => queryInHouseOrdersOverseas({ pageNum: 1, pageSize: 5 }, context)],
    ['pre-departure', () => queryPreDepartureOrdersOverseas({ pageNum: 1, pageSize: 5 }, context)],
    ['today-orders', () => queryTodayOrdersOverseas({ pageNum: 1, pageSize: 5 }, context)],
    ['date-range-week', () => queryOrdersByDateRangeOverseas({ timeRange: 'this_week', pageNum: 1, pageSize: 5 }, context)],
    ['order-detail', () => getOrderDetailsOverseas({ orderId: SAMPLE_ORDER }, context)],
    ['today-rooms', () => queryTodayRoomStatusOverseas({}, context)],
    ['room-calendar-week', () => queryRoomStatusNewOverseas({ timeRange: 'this_week' }, context)],
    ['prices-week', () => queryRoomPricesOverseas({ timeRange: 'this_week' }, context)],
    ['ops-week', () => queryOperationalDataOverseas({ timeRange: 'this_week' }, context)],
    [
      'check-in-preview',
      () => checkInOrderOverseas({ orderDetailIds: ['0'], orderId: SAMPLE_ORDER }, context),
    ],
  ];

  let failed = 0;
  for (const [name, run] of jobs) {
    try {
      const result = await run();
      const text = textOf(result);
      if (result.isError) {
        fail(name, text.slice(0, 180).replace(/\s+/g, ' '));
        failed += 1;
        continue;
      }
      const hasLocaleLabel =
        name === 'check-in-preview'
          ? text.includes(t(profile.locale, 'confirm.need'))
          : name === 'order-detail'
            ? text.includes(t(profile.locale, 'label.guest')) || /guest/i.test(text)
            : true;
      const snippet = text.replace(/\s+/g, ' ').slice(0, 80);
      if (!hasLocaleLabel) {
        fail(name, `locale label missing; head=${snippet}`);
        failed += 1;
      } else {
        ok(name, `chars=${text.length} localeOk=1 head=${snippet}`);
      }
    } catch (e) {
      fail(name, e instanceof Error ? e.message : String(e));
      failed += 1;
    }
  }

  console.log(failed === 0 ? 'SUMMARY\tALL_READ_PASS' : `SUMMARY\tFAILED=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  fail('fatal', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
