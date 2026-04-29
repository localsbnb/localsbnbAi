import { ZodError } from 'zod';
import type { ToolResult } from '../types/mcp.js';
import { logger } from './logger.js';

/** 无权限时的规范话术（与产品文档一致） */
export type PermissionFriendlyDomain = 'orders' | 'finance' | 'room_status' | 'room_price' | 'generic';

const PERMISSION_DENIED_BY_DOMAIN: Record<PermissionFriendlyDomain, string> = {
  /** 今日订单 / 预抵 / 在住 / 预离 / 订单查询 / 订单详情 */
  orders: '您当前无查询订单权限，请联系酒店管理员前往路客云配置相关账号权限',
  /** 经营数据（当天/区间） */
  finance: '您当前无查询数据权限，请联系酒店管理员前往路客云配置相关账号权限',
  /** 房态数据（当天等） */
  room_status: '您当前无查询房态权限，请联系酒店管理员前往路客云配置相关账号权限',
  /** 房价数据（近一周/自然周等） */
  room_price: '您当前无查询房价权限，请联系酒店管理员前往路客云配置相关账号权限',
  generic: '您当前无权限访问该接口，请联系酒店管理员前往路客云配置相关账号权限',
};

/** API Key 工具权限校验失败时，与产品文档一致的一句话（按业务域） */
export function getPermissionDeniedMessage(domain: PermissionFriendlyDomain): string {
  return PERMISSION_DENIED_BY_DOMAIN[domain] ?? PERMISSION_DENIED_BY_DOMAIN.generic;
}

export enum ErrorCode {
  // 认证错误
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  AUTH_INVALID = 'AUTH_INVALID',
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // 参数错误
  INVALID_PARAMS = 'INVALID_PARAMS',
  MISSING_PARAMS = 'MISSING_PARAMS',

  // API错误
  API_ERROR = 'API_ERROR',
  API_TIMEOUT = 'API_TIMEOUT',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_NOT_FOUND = 'API_NOT_FOUND',

  // 系统错误
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** PRD 附录 A：错误码与拟人化友好话术 */
const FRIENDLY_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.AUTH_REQUIRED]:
    '当前秘钥信息错误，请前往登录路客云SPMS获取秘钥，或联系路客云客户经理咨询',
  [ErrorCode.AUTH_INVALID]:
    '当前秘钥信息错误，请前往登录路客云SPMS获取秘钥，或联系路客云客户经理咨询',
  [ErrorCode.PERMISSION_DENIED]: '您没有执行该操作的权限。（若工具已标注场景，以场景说明为准）',
  [ErrorCode.INVALID_PARAMS]: '请检查输入条件后重试。',
  [ErrorCode.MISSING_PARAMS]: '请检查输入条件后重试。',
  [ErrorCode.API_ERROR]:
    '路客云接口暂时无法完成本次操作，请稍后重试。若持续失败，请将下方「错误说明」提供给管理员。',
  [ErrorCode.API_TIMEOUT]: '老板，网络有点开小差，稍等一分钟再试。',
  [ErrorCode.API_RATE_LIMIT]: '请求有点多，稍等再试。',
  [ErrorCode.API_NOT_FOUND]: '未找到相关数据，请确认查询条件后重试。',
  [ErrorCode.INTERNAL_ERROR]: '系统暂时有点忙，请稍后再试。',
};

function getFriendlyMessage(code: ErrorCode, details?: unknown): string {
  if (details != null && typeof details === 'object') {
    const d = details as Record<string, unknown>;
    if (code === ErrorCode.PERMISSION_DENIED && typeof d.domain === 'string') {
      const byDomain = PERMISSION_DENIED_BY_DOMAIN[d.domain as PermissionFriendlyDomain];
      if (byDomain) return byDomain;
    }
    if (code === ErrorCode.API_NOT_FOUND && d.domain === 'order_detail') {
      return '未查询到相关订单数据';
    }
  }
  return FRIENDLY_MESSAGES[code] ?? FRIENDLY_MESSAGES[ErrorCode.INTERNAL_ERROR];
}

/** 给用户/LLM 的一句话摘要：友好提示 + 具体原因（避免重复整段 JSON） */
function buildUserHint(code: ErrorCode, message: string, details?: unknown): string {
  const friendly = getFriendlyMessage(code, details);
  // 无权限：仅展示规范话术，不拼接「需要 orders:read」等技术说明（与产品文档一致）
  if (code === ErrorCode.PERMISSION_DENIED) {
    return friendly;
  }
  const msg = message?.trim() || '';
  let extra = '';
  if (details != null && typeof details === 'object') {
    const d = details as Record<string, unknown>;
    const bits: string[] = [];
    if (d.errorCode != null) bits.push(`错误码：${d.errorCode}`);
    if (d.errorMsg != null && String(d.errorMsg) !== msg) bits.push(`接口说明：${d.errorMsg}`);
    if (d.errorDetail != null) bits.push(`详情：${d.errorDetail}`);
    if (d.action != null) bits.push(`操作：${d.action}`);
    if (bits.length) extra = `（${bits.join('；')}）`;
  }
  if (!msg) return friendly + extra;
  return `${friendly} 【错误说明】${msg}${extra}`;
}

export interface HudsonApiEnvelope {
  success?: boolean;
  errorMsg?: string;
  errorCode?: string;
  errorDetail?: string;
}

function looksLikePermissionDenied(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('无权限') ||
    t.includes('权限不足') ||
    t.includes('没有权限') ||
    t.includes('common_permission_denied') ||
    t.includes('permission_denied') ||
    t.includes('permission') ||
    t.includes('denied') ||
    t.includes('403') ||
    (t.includes('权限') && (t.includes('访问') || t.includes('查询')))
  );
}

/**
 * 业务接口返回 success===false 时统一抛出 MCPError。
 * permissionDomain：用于匹配「无权限」类接口返回时的规范话术（与产品文档一致）。
 */
export function assertApiSuccess(
  response: HudsonApiEnvelope,
  actionLabel: string,
  permissionDomain?: PermissionFriendlyDomain
): void {
  if (response.success === true) return;
  const apiErrorCode = String(response.errorCode ?? '').trim().toUpperCase();
  const technical =
    [response.errorMsg, response.errorDetail, response.errorCode]
      .map((s) => (s == null ? '' : String(s).trim()))
      .find((s) => s.length > 0) || `${actionLabel}失败`;

  // 鉴权失败（token 无效/未登录/秘钥错误）统一返回 AUTH_INVALID，便于前端与提示话术稳定落地
  if (apiErrorCode === 'USER_TOKEN_INVALID' || apiErrorCode === 'USER_NOT_LOGIN') {
    throw new MCPError(ErrorCode.AUTH_INVALID, technical, {
      action: actionLabel,
      errorCode: response.errorCode,
      errorMsg: response.errorMsg,
      errorDetail: response.errorDetail,
      source: '路客云AI',
    });
  }

  if (looksLikePermissionDenied(technical)) {
    throw new MCPError(ErrorCode.PERMISSION_DENIED, technical, {
      domain: permissionDomain ?? 'generic',
      action: actionLabel,
      errorCode: response.errorCode,
      errorMsg: response.errorMsg,
      errorDetail: response.errorDetail,
      source: '路客云AI',
    });
  }

  throw new MCPError(ErrorCode.API_ERROR, technical, {
    action: actionLabel,
    errorCode: response.errorCode,
    errorMsg: response.errorMsg,
    errorDetail: response.errorDetail,
    source: '路客云AI',
  });
}

export class MCPError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

export function handleError(error: unknown): ToolResult {
  logger.error('Tool execution error', error instanceof Error ? error : new Error(String(error)));

  if (error instanceof MCPError) {
    const friendlyMessage = getFriendlyMessage(error.code, error.details);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              code: error.code,
              message: error.message,
              friendlyMessage,
              userHint: buildUserHint(error.code, error.message, error.details),
              details: error.details,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  if (error instanceof ZodError) {
    const errors = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
    const friendlyMessage = getFriendlyMessage(ErrorCode.INVALID_PARAMS);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              code: ErrorCode.INVALID_PARAMS,
              message: '参数验证失败',
              friendlyMessage,
              userHint: buildUserHint(ErrorCode.INVALID_PARAMS, errors),
              details: errors,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  if (error instanceof Error) {
    const code = inferErrorCodeFromMessage(error.message);
    const friendlyMessage = getFriendlyMessage(code);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              error: true,
              code,
              message: error.message,
              friendlyMessage,
              userHint: buildUserHint(code, error.message),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            error: true,
            code: ErrorCode.INTERNAL_ERROR,
            message: '未知错误',
            friendlyMessage: getFriendlyMessage(ErrorCode.INTERNAL_ERROR),
            userHint: buildUserHint(ErrorCode.INTERNAL_ERROR, '未知错误', String(error)),
            details: String(error),
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

/** 根据错误信息推断错误码（便于返回对应友好话术） */
function inferErrorCodeFromMessage(message: string): ErrorCode {
  if (looksLikePermissionDenied(message)) return ErrorCode.PERMISSION_DENIED;
  const m = message.toLowerCase();
  if (m.includes('timeout') || m.includes('超时')) return ErrorCode.API_TIMEOUT;
  if (m.includes('rate') || m.includes('limit') || m.includes('限流') || m.includes('频繁')) return ErrorCode.API_RATE_LIMIT;
  if (m.includes('camp') || m.includes('token') || m.includes('auth') || m.includes('鉴权')) return ErrorCode.AUTH_REQUIRED;
  if (
    m.includes('接口') ||
    m.includes('请求失败') ||
    m.includes('api错误') ||
    m.includes('服务器错误') ||
    m.includes('网络错误')
  ) {
    return ErrorCode.API_ERROR;
  }
  return ErrorCode.INTERNAL_ERROR;
}

export function createSuccessResult(data: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
