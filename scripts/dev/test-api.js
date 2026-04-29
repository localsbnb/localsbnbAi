#!/usr/bin/env node

/**
 * 本地联调脚本：验证房态接口（需自行配置 .env，勿提交密钥）
 * 运行：npm run test:api
 */

import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const API_BASE_URL = process.env.LUKEYUN_API_BASE_URL || 'https://api.lukeyun.com';
const HUDSON_ACCESS_TOKEN = process.env.APP_SECRET || process.env.HUDSON_ACCESS_TOKEN;
const CAMP_ID = process.env.APP_ID || process.env.CAMP_ID;

async function testRoomStatusAPI() {
  console.log('🚀 开始测试房态接口...\n');

  if (!HUDSON_ACCESS_TOKEN) {
    console.error('❌ 错误: 未配置访问令牌');
    console.log('请在 .env 中设置 APP_SECRET（或兼容项 HUDSON_ACCESS_TOKEN）');
    process.exit(1);
  }

  if (!CAMP_ID) {
    console.error('❌ 错误: 未配置营地 ID');
    console.log('请在 .env 中设置 APP_ID（或兼容项 CAMP_ID）');
    process.exit(1);
  }

  console.log('✅ 环境变量检查通过');
  console.log(`   API Base URL: ${API_BASE_URL}`);
  console.log(`   Camp ID: ${CAMP_ID}`);
  console.log(`   Token: ${HUDSON_ACCESS_TOKEN.substring(0, 10)}...\n`);

  const today = new Date().toISOString().split('T')[0];
  const requestData = {
    campId: String(CAMP_ID),
    date: today,
    days: 7,
    pageNum: 1,
    pageSize: 10,
  };

  console.log('📤 发送请求...');
  console.log(`   URL: ${API_BASE_URL}/roomCategoryStatuses/central/get`);
  console.log(`   方法: POST`);
  console.log(`   数据:`, JSON.stringify(requestData, null, 2));
  console.log('');

  try {
    const response = await axios.post(
      `${API_BASE_URL}/roomCategoryStatuses/central/get`,
      requestData,
      {
        headers: {
          'Content-Type': 'application/json',
          'hudson-access-token': HUDSON_ACCESS_TOKEN,
        },
        timeout: 30000,
      }
    );

    console.log('✅ 请求成功！\n');
    console.log('📥 响应状态:', response.status);
    console.log('📥 响应数据:');
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.success === false) {
      console.log('\n⚠️  警告: API返回 success: false');
      console.log(`   错误代码: ${response.data.errorCode || 'N/A'}`);
      console.log(`   错误消息: ${response.data.errorMsg || 'N/A'}`);
    } else if (response.data.success === true) {
      const roomCount = response.data.data?.roomStatusViews?.length || 0;
      console.log(`\n✅ 成功获取 ${roomCount} 个房间的房态信息`);
    }
  } catch (error) {
    console.error('\n❌ 请求失败！\n');

    if (error.response) {
      console.error('错误状态码:', error.response.status);
      console.error('错误响应:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('网络错误: 无法连接到服务器');
      console.error('请检查:');
      console.error('  1. API_BASE_URL 是否正确');
      console.error('  2. 网络连接是否正常');
    } else {
      console.error('请求配置错误:', error.message);
    }

    process.exit(1);
  }
}

testRoomStatusAPI().catch((error) => {
  console.error('未处理的错误:', error);
  process.exit(1);
});
