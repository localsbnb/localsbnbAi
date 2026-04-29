import { APIKeyManager } from './apiKeyManager.js';
import {
  MCPError,
  ErrorCode,
  type PermissionFriendlyDomain,
  getPermissionDeniedMessage,
} from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';

function toolToPermissionDomain(toolName: string): PermissionFriendlyDomain {
  switch (toolName) {
    case 'query_today_orders':
    case 'query_pre_arrival_orders':
    case 'query_in_house_orders':
    case 'query_pre_departure_orders':
    case 'query_orders_by_date_range':
    case 'get_order_details_v2':
    case 'query_orders':
    case 'get_order_details':
      return 'orders';
    case 'query_operational_data_v2':
      return 'finance';
    case 'query_today_room_status':
    case 'query_room_status_new':
      return 'room_status';
    case 'query_room_prices':
      return 'room_price';
    default:
      return 'generic';
  }
}

export class PermissionChecker {
  constructor(private keyManager: APIKeyManager) {}

  /**
   * 检查工具调用权限
   */
  checkPermission(toolName: string, requiredScopes: string[]): void {
    if (requiredScopes.length === 0) {
      // 如果没有权限要求，则允许
      return;
    }

    // 如果只有Hudson认证（没有API key和权限范围），则允许所有操作
    // 因为Hudson认证本身就包含了权限验证
    if (!this.keyManager.hasAPIKey() && this.keyManager.isHudsonConfigured()) {
      logger.debug('Permission check passed (Hudson auth only)', {
        tool: toolName,
        requiredScopes,
      });
      return;
    }

    const hasPermission = requiredScopes.some((scope) => this.keyManager.hasScope(scope));

    if (!hasPermission) {
      const scopes = this.keyManager.getScopes();
      const domain = toolToPermissionDomain(toolName);
      logger.warn('Permission denied', {
        tool: toolName,
        required: requiredScopes,
        current: scopes,
        domain,
      });

      throw new MCPError(ErrorCode.PERMISSION_DENIED, getPermissionDeniedMessage(domain), {
        tool: toolName,
        requiredScopes,
        currentScopes: scopes,
        domain,
        source: '路客云AI',
      });
    }

    logger.debug('Permission check passed', {
      tool: toolName,
      scopes: requiredScopes,
    });
  }
}
