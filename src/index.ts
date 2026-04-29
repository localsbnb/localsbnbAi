#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LukeyunMCPServer } from './server.js';
import { logger } from './utils/logger.js';

async function main() {
  try {
    // 创建MCP Server实例
    const server = new LukeyunMCPServer();
    await server.start();

    // 创建StdIO传输层（用于Claude Desktop等本地连接）
    const transport = new StdioServerTransport();
    await server.getServer().connect(transport);

    logger.info('MCP Server connected via StdIO');
  } catch (error) {
    logger.error('Failed to start MCP Server', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  }
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', new Error(String(reason)));
  process.exit(1);
});

// 启动服务器
main().catch((error) => {
  logger.error('Fatal error', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
