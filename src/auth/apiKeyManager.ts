import { logger } from '../utils/logger.js';

export class APIKeyManager {
  private apiKey: string | null = null;
  private scopes: string[] = [];
  private hudsonAccessToken: string | null = null;
  private campId: string | null = null;

  /**
   * Load API key from environment variables.
   */
  loadFromEnv(): void {
    this.apiKey = process.env.LUKEYUN_API_KEY || null;
    const scopesStr = process.env.LUKEYUN_API_SCOPES;
    this.scopes = scopesStr ? scopesStr.split(',').map((s) => s.trim()) : [];
    
    // Load app credentials (APP_SECRET / APP_ID)
    this.hudsonAccessToken = process.env.APP_SECRET || process.env.HUDSON_ACCESS_TOKEN || null;
    this.campId = process.env.APP_ID || process.env.CAMP_ID || null;

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
   * Load API key from configuration.
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
   * Set API key and optional scopes.
   */
  setAPIKey(apiKey: string, scopes?: string[]): void {
    this.apiKey = apiKey;
    this.scopes = scopes || [];
    logger.info('API key set', { hasScopes: this.scopes.length > 0 });
  }

  /**
   * Set Hudson authentication credentials.
   */
  setHudsonCredentials(accessToken: string, campId: string): void {
    this.hudsonAccessToken = accessToken;
    this.campId = campId;
    logger.info('Hudson credentials set');
  }

  /**
   * Get API key.
   * Returns empty string when not configured (Hudson-only auth scenarios).
   */
  getAPIKey(): string {
    return this.apiKey || '';
  }

  /**
   * Whether an API key is configured.
   */
  hasAPIKey(): boolean {
    return this.apiKey !== null && this.apiKey !== '';
  }

  /**
   * Whether the given scope is granted.
   */
  hasScope(scope: string): boolean {
    // Wildcard scope grants all permissions
    if (this.scopes.includes('*')) {
      return true;
    }
    return this.scopes.includes(scope);
  }

  /**
   * Get all granted scopes.
   */
  getScopes(): string[] {
    return [...this.scopes];
  }

  /**
   * Whether an API key has been set (may be empty).
   */
  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Whether Hudson authentication is configured.
   */
  isHudsonConfigured(): boolean {
    return this.hudsonAccessToken !== null && this.campId !== null;
  }

  /**
   * Get Hudson access token.
   */
  getHudsonAccessToken(): string {
    if (!this.hudsonAccessToken) {
      throw new Error('APP_SECRET not configured. Please set APP_SECRET environment variable.');
    }
    return this.hudsonAccessToken;
  }

  /**
   * Get camp ID.
   */
  getCampId(): string {
    if (!this.campId) {
      throw new Error('APP_ID not configured. Please set APP_ID environment variable.');
    }
    return this.campId;
  }
}
