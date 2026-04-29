import { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface ToolHandler {
  (args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  apiClient: APIClient;
  logger: Logger;
  permissionChecker: PermissionChecker;
  campId?: string; // Hudson认证的campId
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
}

export interface RequestConfig {
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
