import { tryOpenSystemBrowser } from '../src/auth/openSystemBrowser';

describe('tryOpenSystemBrowser', () => {
  const orig = process.env.LOCALSBNB_OPEN_BROWSER;

  afterEach(() => {
    if (orig == null) delete process.env.LOCALSBNB_OPEN_BROWSER;
    else process.env.LOCALSBNB_OPEN_BROWSER = orig;
  });

  it('skips spawn when LOCALSBNB_OPEN_BROWSER=0', async () => {
    process.env.LOCALSBNB_OPEN_BROWSER = '0';
    const result = await tryOpenSystemBrowser('http://localhost:3000/ai/handshake/x');
    expect(result.opened).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('rejects non-http URLs without spawning', async () => {
    delete process.env.LOCALSBNB_OPEN_BROWSER;
    const result = await tryOpenSystemBrowser('file:///etc/passwd');
    expect(result.opened).toBe(false);
    expect(result.reason).toBe('invalid_url');
  });
});
