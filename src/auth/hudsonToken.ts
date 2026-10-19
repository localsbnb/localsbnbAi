/**
 * `hudson-access-token` 头格式约定（与海外 PC / 直配 APP_SECRET 一致）：
 *
 * 1. 登录/注册接口返回的短期 JWT（`sign-in` / `sign-up` 的 data）→ 必须加 `Bearer `
 * 2. `/user/secret/generate`（或 `/user/secret/get`）返回的持久 App Secret，以及 mcp.json
 *    里直接配置的 `APP_SECRET` → **不要**加 Bearer，原样放入 header
 *
 * 直配方案（env 同时有 APP_SECRET + APP_ID）不经过登录换 secret，只走本函数格式化后请求 Hudson。
 * 启发式：形如 `a.b.c` 的三段 token 视为 JWT；其余视为 App Secret。
 */
export function looksLikeJwt(token: string): boolean {
  const parts = token.trim().split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

export function formatHudsonAccessTokenHeader(token: string): string {
  const raw = token.trim().replace(/^Bearer\s+/i, '').trim();
  if (!raw) return '';
  return looksLikeJwt(raw) ? `Bearer ${raw}` : raw;
}
