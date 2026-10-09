import { formatHudsonAccessTokenHeader, looksLikeJwt } from '../src/auth/hudsonToken';

describe('hudson access token header', () => {
  it('adds Bearer only for login JWT', () => {
    const jwt = 'aaa.bbb.ccc';
    expect(looksLikeJwt(jwt)).toBe(true);
    expect(formatHudsonAccessTokenHeader(jwt)).toBe('Bearer aaa.bbb.ccc');
    expect(formatHudsonAccessTokenHeader(`Bearer ${jwt}`)).toBe('Bearer aaa.bbb.ccc');
  });

  it('keeps /user/secret/generate App Secret and direct APP_SECRET raw', () => {
    const secret = 'abcdefghijklmnopqrstuvwxyz123456';
    expect(looksLikeJwt(secret)).toBe(false);
    expect(formatHudsonAccessTokenHeader(secret)).toBe(secret);
    // Accidental Bearer prefix on App Secret must be stripped (direct mcp.json paste safety)
    expect(formatHudsonAccessTokenHeader(`Bearer ${secret}`)).toBe(secret);
  });
});
