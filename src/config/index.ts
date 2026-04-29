import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

export interface Config {
  api: {
    baseURL: string;
    timeout: number;
  };
  server: {
    port: number;
    env: string;
  };
  cache: {
    enabled: boolean;
    ttl: number;
  };
  retry: {
    maxRetries: number;
    delay: number;
  };
  log: {
    level: string;
    format: string;
    /** 是否写入 logs/ 目录；默认 false，仅 stderr，避免全局安装时在包目录或用户目录落盘 */
    toFiles: boolean;
  };
}

const resolvedEnv = process.env.NODE_ENV || 'production';

function resolveBaseURL(): string {
  // 显式配置优先，便于调试或特殊环境
  if (process.env.LUKEYUN_API_BASE_URL) {
    return process.env.LUKEYUN_API_BASE_URL;
  }

  // 根据环境自动选择 API 基础地址
  if (resolvedEnv === 'develop' || resolvedEnv === 'development') {
    return 'https://hudson-dev.localhome.cn';
  }

  // 默认 production
  return 'https://hudson-prod.localhome.cn';
}

export const config: Config = {
  api: {
    baseURL: resolveBaseURL(),
    timeout: parseInt(process.env.API_TIMEOUT || '30000', 10),
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: resolvedEnv,
  },
  cache: {
    enabled: process.env.CACHE_ENABLED === 'true',
    ttl: parseInt(process.env.CACHE_TTL || '300000', 10),
  },
  retry: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    delay: parseInt(process.env.RETRY_DELAY || '1000', 10),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    toFiles: process.env.LOCALSBNB_LOG_TO_FILES === '1' || process.env.LOCALSBNB_LOG_TO_FILES === 'true',
  },
};
