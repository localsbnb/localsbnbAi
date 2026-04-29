import { logger } from '../utils/logger.js';

export class APIKeyManager {
  private apiKey: string | null = null;
  private scopes: string[] = [];
  private hudsonAccessToken: string | null = null;
  private campId: string | null = null;

  /**
   * 从环境变量加载API密钥
   */
  loadFromEnv(): void {
    this.apiKey = process.env.LUKEYUN_API_KEY || null;
    const scopesStr = process.env.LUKEYUN_API_SCOPES;
    this.scopes = scopesStr ? scopesStr.split(',').map((s) => s.trim()) : [];
    
    // 加载应用鉴权信息（APP_SECRET / APP_ID）
    this.hudsonAccessToken = process.env.APP_SECRET || null;
    this.campId = process.env.APP_ID || null;

    if (!this.apiKey) {
      logger.warn('API key not found in environment variables');
    } else {
      logger.info('API key loaded from environment', { hasScopes: this.scopes.length > 0 });
    }

    if (!this.hudsonAccessToken || !this.campId) {
      logger.warn('APP_SECRET or APP_ID not found in environment variables');
    } else {
      logger.info('Hudson credentials loaded from environment');
    }
  }

  /**
   * 从配置文件加载API密钥
   */
  loadFromConfig(config: { 
    apiKey?: string; 
    scopes?: string[];
    hudsonAccessToken?: string;
    campId?: string;
  }): void {
    this.apiKey = config.apiKey || null;
    this.scopes = config.scopes || [];
    this.hudsonAccessToken = config.hudsonAccessToken || null;
    this.campId = config.campId || null;

    if (this.apiKey) {
      logger.info('API key loaded from config', { hasScopes: this.scopes.length > 0 });
    }
    
    if (this.hudsonAccessToken && this.campId) {
      logger.info('Hudson credentials loaded from config');
    }
  }

  /**
   * 设置API密钥
   */
  setAPIKey(apiKey: string, scopes?: string[]): void {
    this.apiKey = apiKey;
    this.scopes = scopes || [];
    logger.info('API key set', { hasScopes: this.scopes.length > 0 });
  }

  /**
   * 设置Hudson认证信息
   */
  setHudsonCredentials(accessToken: string, campId: string): void {
    this.hudsonAccessToken = accessToken;
    this.campId = campId;
    logger.info('Hudson credentials set');
  }

  /**
   * 获取API密钥
   * 如果未配置，返回空字符串（用于仅使用Hudson认证的场景）
   */
  getAPIKey(): string {
    return this.apiKey || '';
  }

  /**
   * 检查是否配置了API密钥
   */
  hasAPIKey(): boolean {
    return this.apiKey !== null && this.apiKey !== '';
  }

  /**
   * 检查是否有指定权限
   */
  hasScope(scope: string): boolean {
    // 如果有 * 权限，则拥有所有权限
    if (this.scopes.includes('*')) {
      return true;
    }
    return this.scopes.includes(scope);
  }

  /**
   * 获取所有权限范围
   */
  getScopes(): string[] {
    return [...this.scopes];
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * 检查Hudson认证是否已配置
   */
  isHudsonConfigured(): boolean {
    return this.hudsonAccessToken !== null && this.campId !== null;
  }

  /**
   * 获取Hudson访问令牌
   */
  getHudsonAccessToken(): string {
    if (!this.hudsonAccessToken) {
      throw new Error('APP_SECRET not configured. Please set APP_SECRET environment variable.');
    }
    return this.hudsonAccessToken;
  }

  /**
   * 获取Camp ID
   */
  getCampId(): string {
    if (!this.campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }
    return this.campId;
  }
}
