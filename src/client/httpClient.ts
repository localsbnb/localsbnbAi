import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from 'axios';
import type { APIClient, RequestConfig } from '../types/mcp.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { MCPError, ErrorCode } from '../utils/errorHandler.js';
import { RetryHandler } from './retryHandler.js';

export class HTTPClient implements APIClient {
  private client: AxiosInstance;
  private apiKey: string;
  private hudsonAccessToken?: string;
  private retryHandler: RetryHandler;

  constructor(apiKey: string, hudsonAccessToken?: string) {
    this.apiKey = apiKey;
    this.hudsonAccessToken = hudsonAccessToken;
    this.retryHandler = new RetryHandler(config.retry.maxRetries, config.retry.delay);

    this.client = axios.create({
      baseURL: config.api.baseURL,
      timeout: config.api.timeout,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Type': 'mcp',
        'X-Client-Version': process.env.npm_package_version || '1.0.0',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // 请求拦截器：自动注入API密钥和Hudson token
    this.client.interceptors.request.use(
      (config) => {
        // 只有在提供了API key时才添加Authorization header
        if (this.apiKey) {
          config.headers.Authorization = `Bearer ${this.apiKey}`;
        }
        // 如果提供了Hudson token，添加到header
        if (this.hudsonAccessToken) {
          config.headers['hudson-access-token'] = this.hudsonAccessToken;
        }
        logger.debug('API request', {
          method: config.method,
          url: config.url,
          params: config.params,
        });
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', error);
        return Promise.reject(error);
      }
    );

    // 响应拦截器：错误处理
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('API response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      async (error: AxiosError) => {
        return this.handleError(error);
      }
    );
  }

  private async handleError(error: AxiosError): Promise<never> {
    if (error.response) {
      // API返回了错误响应
      const status = error.response.status;
      const data = error.response.data as { code?: number; message?: string };

      logger.error('API error response', {
        status,
        url: error.config?.url,
        message: data.message,
      });

      switch (status) {
        case 401:
          throw new MCPError(ErrorCode.AUTH_INVALID, 'API密钥无效或已过期', data);
        case 403:
          throw new MCPError(ErrorCode.PERMISSION_DENIED, data?.message || '权限不足', {
            ...(data != null && typeof data === 'object' ? data : {}),
            domain: 'generic',
            source: '路客云AI',
          });
        case 404:
          throw new MCPError(ErrorCode.API_NOT_FOUND, '资源不存在', data);
        case 429:
          throw new MCPError(ErrorCode.API_RATE_LIMIT, '请求频率过高，请稍后重试', data);
        case 500:
        case 502:
        case 503:
        case 504:
          throw new MCPError(ErrorCode.API_ERROR, '服务器错误，请稍后重试', data);
        default:
          throw new MCPError(
            ErrorCode.API_ERROR,
            data.message || `API错误：${status}`,
            data
          );
      }
    } else if (error.request) {
      // 请求已发出但没有收到响应
      logger.error('API request timeout', {
        url: error.config?.url,
        timeout: config.api.timeout,
      });

      if (error.code === 'ECONNABORTED') {
        throw new MCPError(ErrorCode.API_TIMEOUT, '请求超时，请稍后重试');
      }

      throw new MCPError(ErrorCode.API_ERROR, '网络错误，请检查网络连接');
    } else {
      // 请求配置错误
      logger.error('Request configuration error', error);
      throw new MCPError(ErrorCode.INTERNAL_ERROR, '请求配置错误');
    }
  }

  async request<T>(requestConfig: RequestConfig): Promise<T> {
    const axiosConfig: AxiosRequestConfig = {
      method: requestConfig.method,
      url: requestConfig.url,
      params: requestConfig.params,
      data: requestConfig.data,
      headers: requestConfig.headers,
    };

    try {
      const response = await this.retryHandler.execute(() => this.client.request<T>(axiosConfig));
      return response.data;
    } catch (error) {
      // 错误已在拦截器中处理，直接抛出
      throw error;
    }
  }
}
