import { logger } from '../utils/logger.js';
import { AxiosError } from 'axios';

export class RetryHandler {
  constructor(
    private maxRetries: number = 3,
    private baseDelay: number = 1000
  ) {}

  /**
   * 执行带重试的请求
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // 如果是最后一次尝试，直接抛出错误
        if (attempt === this.maxRetries) {
          break;
        }

        // 检查是否可重试
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // 计算延迟时间（指数退避）
        const delay = this.baseDelay * Math.pow(2, attempt);
        logger.warn(`Request failed, retrying... (attempt ${attempt + 1}/${this.maxRetries})`, {
          error: error instanceof Error ? error.message : String(error),
          delay,
        });

        await this.sleep(delay);
      }
    }

    // 所有重试都失败，抛出最后一个错误
    throw lastError;
  }

  /**
   * 判断错误是否可重试
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof AxiosError) {
      // 网络错误、超时错误可重试
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return true;
      }

      // 5xx服务器错误可重试
      if (error.response && error.response.status >= 500) {
        return true;
      }

      // 429速率限制可重试
      if (error.response && error.response.status === 429) {
        return true;
      }
    }

    return false;
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
