/** Cloud callbacks are an additional policy, never a replacement for desktop callbacks. */
export function isWorkbuddyCloudRedirect(url: URL): boolean {
  const suffixes = ['workbuddy.cn', 'codebuddy.cn', 'workbuddy.ai'];
  const exact = ['copilot.tencent.com', 'staging-codebuddy.tencent.com'];
  const host = url.hostname;
  return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
    !url.hash && !url.searchParams.has('code') && !url.searchParams.has('state') &&
    (exact.includes(host) || suffixes.some(domain => host.endsWith(`.${domain}`) && host.length > domain.length + 1));
}
