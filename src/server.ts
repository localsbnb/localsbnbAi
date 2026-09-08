import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getActiveToolDefinitions, toolDefinitions } from './config/tools.js';
import { APIKeyManager } from './auth/apiKeyManager.js';
import { PermissionChecker } from './auth/permissionChecker.js';
import { HTTPClient } from './client/httpClient.js';
import { logger } from './utils/logger.js';
import { ErrorCode, handleToolError, isHudsonAuthError, MCPError } from './utils/errorHandler.js';
import { CN_PROFILE, profilesDiffer, resolveRegionProfile, type RegionProfile } from './region/index.js';
import type { ToolContext, ToolDefinition } from './types/mcp.js';

export class LukeyunMCPServer {
  private server: Server;
  private apiKeyManager: APIKeyManager;
  private permissionChecker: PermissionChecker;
  private apiClient: HTTPClient | null = null;
  private campId: string | null = null;
  private regionProfile: RegionProfile = { ...CN_PROFILE };
  private activeTools: ToolDefinition[] = toolDefinitions;
  private profileExpiresAt = 0;
  private authError: MCPError | null = null;

  constructor() {
    this.server = new Server(
      {
        name: 'lukeyun-pms',
        version: process.env.npm_package_version || '1.0.0',
      },
      {
        capabilities: {
          tools: { listChanged: true },
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
    await this.ensureRegionProfile('always');
    if (this.authError) {
      logger.warn('Hudson auth invalid at startup; tools will return AUTH_INVALID');
    }

    logger.info('MCP Server initialized', {
      hasAPIKey: this.apiKeyManager.hasAPIKey(),
      hasHudsonAuth: this.apiKeyManager.isHudsonConfigured(),
      hasCampId: !!this.campId,
      region: this.regionProfile.region,
      locale: this.regionProfile.locale,
      toolCount: this.activeTools.length,
      scopes: this.apiKeyManager.getScopes(),
    });
  }

  /**
   * 设置MCP协议处理器
   */
  private setupHandlers(): void {
    // 工具列表
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      await this.ensureRegionProfile('always');
      return {
        tools: this.activeTools.map((tool) => ({
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

      await this.ensureRegionProfile('ttl');
      if (this.authError) {
        return handleToolError(this.authError, { regionProfile: this.regionProfile }) as CallToolResult;
      }

      // 查找工具定义
      const toolDef = this.activeTools.find((t) => t.name === name);
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
        regionProfile: this.regionProfile,
      };

      // 调用工具处理函数
      try {
        const result = await toolDef.handler(args || {}, context);
        return result as CallToolResult;
      } catch (error) {
        logger.error('Tool execution error', error instanceof Error ? error : new Error(String(error)));
        return handleToolError(error, { regionProfile: this.regionProfile }) as CallToolResult;
      }
    });

    // 错误处理
    this.server.onerror = (error) => {
      logger.error('MCP Server error', error);
    };

    logger.info('MCP Server handlers setup completed', {
      toolCount: this.activeTools.length,
    });
  }

  /**
   * 海外店语言/时区/货币跟 Hudson 门店配置。
   * ListTools 每次重读；CallTool 默认 30s 缓存（REGION_PROFILE_TTL_MS）。
   */
  private async ensureRegionProfile(mode: 'always' | 'ttl'): Promise<void> {
    if (!this.apiClient) return;
    const ttlMs = Number(process.env.REGION_PROFILE_TTL_MS || 30000);
    if (mode === 'ttl' && Date.now() < this.profileExpiresAt) {
      return;
    }

    let next;
    try {
      next = await resolveRegionProfile(this.apiClient, this.campId || undefined, logger);
      this.authError = null;
    } catch (error) {
      if (isHudsonAuthError(error)) {
        this.authError =
          error instanceof MCPError
            ? error
            : new MCPError(ErrorCode.AUTH_INVALID, error instanceof Error ? error.message : String(error));
        logger.warn('Hudson auth invalid, keep current region profile', {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      throw error;
    }
    const changed = profilesDiffer(this.regionProfile, next);
    this.regionProfile = next;
    this.profileExpiresAt = Date.now() + (Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 30000);

    if (next.region === 'overseas') {
      this.apiClient.setExtraHeaders({
        lang: next.localeCode,
        'Accept-Language': next.localeCode,
        campId: String(next.campId || this.campId || ''),
      });
    } else {
      this.apiClient.setExtraHeaders({});
    }

    const nextTools = getActiveToolDefinitions(next);
    const toolsChanged =
      changed ||
      this.activeTools === toolDefinitions ||
      this.activeTools.length !== nextTools.length ||
      this.activeTools.some((tool, i) => tool.description !== nextTools[i]?.description);
    this.activeTools = nextTools;
    if (toolsChanged && this.server.transport) {
      void this.notifyToolsChanged();
    }
  }

  private async notifyToolsChanged(): Promise<void> {
    try {
      await this.server.notification({ method: 'notifications/tools/list_changed' });
    } catch (error) {
      logger.warn('Failed to notify tools/list_changed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
