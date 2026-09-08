#!/usr/bin/env node

/**
 * Local integration script: verifies the room-status API (configure .env yourself; do not commit secrets).
 * Run: npm run test:api
 */

import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const API_BASE_URL = process.env.LUKEYUN_API_BASE_URL || 'https://api.lukeyun.com';
const HUDSON_ACCESS_TOKEN = process.env.APP_SECRET || process.env.HUDSON_ACCESS_TOKEN;
const CAMP_ID = process.env.APP_ID || process.env.CAMP_ID;

async function testRoomStatusAPI() {
  console.log('🚀 Starting room status API test...\n');

  if (!HUDSON_ACCESS_TOKEN) {
    console.error('❌ Error: access token is not configured');
    console.log('Set APP_SECRET in .env (or legacy HUDSON_ACCESS_TOKEN)');
    process.exit(1);
  }

  if (!CAMP_ID) {
    console.error('❌ Error: camp ID is not configured');
    console.log('Set APP_ID in .env (or legacy CAMP_ID)');
    process.exit(1);
  }

  console.log('✅ Environment variables OK');
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

  console.log('📤 Sending request...');
  console.log(`   URL: ${API_BASE_URL}/roomCategoryStatuses/central/get`);
  console.log(`   Method: POST`);
  console.log(`   Body:`, JSON.stringify(requestData, null, 2));
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

    console.log('✅ Request succeeded!\n');
    console.log('📥 Response status:', response.status);
    console.log('📥 Response body:');
    console.log(JSON.stringify(response.data, null, 2));

    if (response.data.success === false) {
      console.log('\n⚠️  Warning: API returned success: false');
      console.log(`   Error code: ${response.data.errorCode || 'N/A'}`);
      console.log(`   Error message: ${response.data.errorMsg || 'N/A'}`);
    } else if (response.data.success === true) {
      const roomCount = response.data.data?.roomStatusViews?.length || 0;
      console.log(`\n✅ Fetched room status for ${roomCount} room(s)`);
    }
  } catch (error) {
    console.error('\n❌ Request failed!\n');

    if (error.response) {
      console.error('HTTP status:', error.response.status);
      console.error('Response body:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('Network error: could not reach the server');
      console.error('Check:');
      console.error('  1. API_BASE_URL is correct');
      console.error('  2. Network connectivity');
    } else {
      console.error('Request setup error:', error.message);
    }

    process.exit(1);
  }
}

testRoomStatusAPI().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
