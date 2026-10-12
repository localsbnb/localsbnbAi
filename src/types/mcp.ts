import { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { RegionProfile } from '../region/types.js';

export interface ToolHandler {
  (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  /** 仅远程模式注入；本地确认逻辑维持原路径。 */
  remote?: { preview: (input: {args: Record<string, unknown>; tool: string; endpoint: string; payload: Record<string, unknown>; summary: unknown; snapshot: unknown; readBack?: (data: unknown) => Promise<unknown>}) => Promise<ToolResult> };
  apiClient: APIClient;
  logger: Logger;
  permissionChecker: PermissionChecker;
  campId?: string; // Hudson认证的campId
  regionProfile?: RegionProfile;
  applyHudsonSession?: (accessToken: string, campId: string) => Promise<void>;
  getHudsonAccessToken?: () => string;
}

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export interface ToolDefinition extends Tool {
  handler: ToolHandler;
  requiredScopes?: string[];
}

export interface APIClient {
  request<T>(config: RequestConfig): Promise<T>;
  setHudsonAccessToken?(token?: string): void;
}

export interface RequestConfig {
  /** Disable automatic retries for non-idempotent writes. */
  retry?: boolean;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
}

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface PermissionChecker {
  checkPermission(toolName: string, requiredScopes: string[]): void;
}
