import dotenv from 'dotenv';
import { HTTPClient } from '../src/client/httpClient';
import { resolveRegionProfile } from '../src/region/resolve';
import { getActiveToolDefinitions } from '../src/config/tools';

dotenv.config();

const campId = process.env.APP_ID || process.env.CAMP_ID;
const token = process.env.APP_SECRET || process.env.HUDSON_ACCESS_TOKEN;
const enabled = Boolean(campId && token);

const describeSmoke = enabled ? describe : describe.skip;

describeSmoke('overseas live smoke (requires APP_ID + APP_SECRET)', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  it('resolves overseas profile and registers write tools without calling write APIs', async () => {
    const client = new HTTPClient('', token);
    const profile = await resolveRegionProfile(client, campId, logger);
    expect(profile.region).toBe('overseas');
    const tools = getActiveToolDefinitions(profile);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['query_today_orders', 'check_in_order', 'extend_order'])
    );
  }, 30000);
});
