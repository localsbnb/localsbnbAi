import { mkdirSync } from 'fs';
import winston from 'winston';
import { config } from '../config/index.js';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

// MCP 协议要求：stdout 只能用于 JSON-RPC，所有日志必须输出到 stderr
// 创建一个只输出到 stderr 的 Console transport
const stderrTransport = new winston.transports.Console({
  stderrLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
  // 确保所有级别的日志都输出到 stderr
  consoleWarnLevels: [],
});

const transports: winston.transport[] = [stderrTransport];

if (config.log.toFiles) {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    })
  );
}

export const logger = winston.createLogger({
  level: config.log.level,
  format: config.log.format === 'json' ? logFormat : consoleFormat,
  transports,
});

if (config.log.toFiles) {
  try {
    mkdirSync('logs', { recursive: true });
  } catch {
    // 目录可能已存在，忽略错误
  }
}

export type Logger = typeof logger;
