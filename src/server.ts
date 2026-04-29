import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions } from './config/tools.js';
import { APIKeyManager } from './auth/apiKeyManager.js';
import { PermissionChecker } from './auth/permissionChecker.js';
import { HTTPClient } from './client/httpClient.js';
import { logger } from './utils/logger.js';
import type { ToolContext } from './types/mcp.js';

export class LukeyunMCPServer {
  private server: Server;
  private apiKeyManager: APIKeyManager;
  private permissionChecker: PermissionChecker;
  private apiClient: HTTPClient | null = null;
  private campId: string | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'lukeyun-pms',
        version: process.env.npm_package_version || '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.apiKeyManager = new APIKeyManager();
    this.permissionChecker = new PermissionChecker(this.apiKeyManager);

    this.setupHandlers();
  }

  /**
   * 初始化服务器
   */
  async initialize(): Promise<void> {
    // 加载API密钥和Hudson认证信息
    this.apiKeyManager.loadFromEnv();

    // 检查至少有一种认证方式
    if (!this.apiKeyManager.isConfigured() && !this.apiKeyManager.isHudsonConfigured()) {
      throw new Error(
        'No authentication configured. Please set either LUKEYUN_API_KEY or APP_SECRET and APP_ID environment variables.'
      );
    }

    // 获取campId
    this.campId = this.apiKeyManager.isHudsonConfigured() 
      ? this.apiKeyManager.getCampId() 
      : null;

    // 创建API客户端
    // 如果只有Hudson认证，使用空字符串作为API key
    const apiKey = this.apiKeyManager.getAPIKey();
    const hudsonToken = this.apiKeyManager.isHudsonConfigured() 
      ? this.apiKeyManager.getHudsonAccessToken() 
      : undefined;
    
    if (!hudsonToken && !apiKey) {
      throw new Error('At least one authentication method (API key or Hudson token) must be configured.');
    }

    this.apiClient = new HTTPClient(apiKey, hudsonToken);

    logger.info('MCP Server initialized', {
      hasAPIKey: this.apiKeyManager.hasAPIKey(),
      hasHudsonAuth: this.apiKeyManager.isHudsonConfigured(),
      hasCampId: !!this.campId,
      scopes: this.apiKeyManager.getScopes(),
    });
  }

  /**
   * 设置MCP协议处理器
   */
  private setupHandlers(): void {
    // 工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // 工具调用
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const params = request.params || {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) || {};

      logger.info('Tool called', { tool: name, args });

      // 查找工具定义
      const toolDef = toolDefinitions.find((t) => t.name === name);
      if (!toolDef) {
        throw new Error(`Tool not found: ${name}`);
      }

      // 检查权限
      if (toolDef.requiredScopes && toolDef.requiredScopes.length > 0) {
        this.permissionChecker.checkPermission(name, toolDef.requiredScopes);
      }

      // 创建工具上下文
      if (!this.apiClient) {
        throw new Error('API client not initialized');
      }

      const context: ToolContext = {
        apiClient: this.apiClient,
        logger,
        permissionChecker: this.permissionChecker,
        campId: this.campId || undefined,
      };

      // 调用工具处理函数
      try {
        const result = await toolDef.handler(args || {}, context);
        return result as CallToolResult;
      } catch (error) {
        logger.error('Tool execution error', error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    });

    // 错误处理
    this.server.onerror = (error) => {
      logger.error('MCP Server error', error);
    };

    logger.info('MCP Server handlers setup completed', {
      toolCount: toolDefinitions.length,
    });
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    await this.initialize();
    logger.info('MCP Server started');
  }

  /**
   * 获取Server实例（用于连接传输层）
   */
  getServer(): Server {
    return this.server;
  }
}
