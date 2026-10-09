import { spawn } from 'child_process';

const OPEN_TIMEOUT_MS = 2500;

export type OpenBrowserResult = {
  opened: boolean;
  reason: string;
};

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function spawnCommand(url: string): { cmd: string; args: string[] } {
  if (process.platform === 'darwin') {
    return { cmd: 'open', args: [url] };
  }
  if (process.platform === 'win32') {
    return { cmd: 'cmd', args: ['/c', 'start', '', url] };
  }
  return { cmd: 'xdg-open', args: [url] };
}

/**
 * Try once to open the Handshake / OAuth URL in the host OS browser.
 * Fail closed: never throw; caller always still prints the URL for manual open.
 * LOCALSBNB_OPEN_BROWSER=0 skips spawn (tests / headless).
 */
export async function tryOpenSystemBrowser(url: string): Promise<OpenBrowserResult> {
  if ((process.env.LOCALSBNB_OPEN_BROWSER || '').trim() === '0') {
    return { opened: false, reason: 'disabled' };
  }
  const href = String(url || '').trim();
  if (!isHttpUrl(href)) {
    return { opened: false, reason: 'invalid_url' };
  }

  const { cmd, args } = spawnCommand(href);
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: OpenBrowserResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ opened: false, reason: 'timeout' });
    }, OPEN_TIMEOUT_MS);

    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    } catch (error) {
      done({
        opened: false,
        reason: error instanceof Error ? error.message : 'spawn_failed',
      });
      return;
    }

    child.once('error', (error) => {
      done({ opened: false, reason: error.message || 'spawn_error' });
    });
    child.once('exit', (code) => {
      if (code === 0 || code == null) {
        done({ opened: true, reason: 'opened' });
        return;
      }
      done({ opened: false, reason: `exit_${code}` });
    });
    child.unref();
  });
}
