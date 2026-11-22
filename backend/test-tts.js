import express from 'express';
import jwt from 'jsonwebtoken';
import { synthesizeSpeech, clearAudioCache, setCachedAudio, getCacheStats, hasCredentialsConfigured } from './services/ttsService.js';
import ttsRoutes from './routes/ttsRoutes.js';
import gameRoutes from './routes/gameRoutes.js';

// Setup mock test environment
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_123';
const testToken = jwt.sign({ id: 'test_user_id', username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });

const app = express();
app.use(express.json());
app.use('/api/tts', ttsRoutes);
app.use('/api/games', gameRoutes);

let server;
const PORT = 5055;

async function runAllTests() {
  console.log('====================================================');
  console.log('   SOCIAL STEPS - GOOGLE CLOUD TTS TEST SUITE       ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  await new Promise((resolve) => {
    server = app.listen(PORT, resolve);
  });

  const baseUrl = `http://localhost:${PORT}`;

  try {
    // ----------------------------------------------------
    // Test Group 1: Service Unit Tests
    // ----------------------------------------------------
    console.log('Test Group 1: ttsService Unit Tests');
    clearAudioCache();
    assert(getCacheStats().size === 0, 'Cache is cleared initially');

    try {
      await synthesizeSpeech('');
      assert(false, 'Synthesize with empty text should throw');
    } catch (e) {
      assert(e.statusCode === 400, 'Empty text throws 400 error');
    }

    try {
      await synthesizeSpeech('a'.repeat(601));
      assert(false, 'Synthesize with >600 chars should throw');
    } catch (e) {
      assert(e.statusCode === 400, 'Exceeding max length throws 400 error');
    }

    // Cache operations
    const mockAudioBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    setCachedAudio('Hello Social Steps', mockAudioBase64);
    assert(getCacheStats().size === 1, 'In-memory cache successfully stores audio');

    const cachedResult = await synthesizeSpeech('Hello Social Steps');
    assert(cachedResult.cached === true, 'Cache hit returns cached: true');
    assert(cachedResult.audioContent === mockAudioBase64, 'Cache hit returns exact audio content');
    assert(cachedResult.format === 'audio/mp3', 'Cache hit returns format audio/mp3');

    // ----------------------------------------------------
    // Test Group 2: GET /api/tts/status
    // ----------------------------------------------------
    console.log('\nTest Group 2: GET /api/tts/status');
    const statusRes = await fetch(`${baseUrl}/api/tts/status`);
    const statusData = await statusRes.json();
    assert(statusRes.status === 200, 'Status probe returns HTTP 200');
    assert(statusData.success === true, 'Status response success is true');
    assert(statusData.service === 'Google Cloud Text-to-Speech', 'Reports Google Cloud Text-to-Speech service name');
    assert(typeof statusData.credentialsConfigured === 'boolean', 'Reports credentials configuration boolean');
    assert(statusData.defaults.languageCode === 'en-US', 'Default languageCode is en-US');
    assert(statusData.defaults.voiceName === 'en-US-Neural2-F', 'Default voiceName is child-friendly en-US-Neural2-F');

    // ----------------------------------------------------
    // Test Group 3: POST /api/tts Authentication
    // ----------------------------------------------------
    console.log('\nTest Group 3: POST /api/tts Authentication & Authorization');
    const unauthRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });
    assert(unauthRes.status === 401, 'Request without token is rejected with 401');

    const badTokenRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid_token_xyz',
      },
      body: JSON.stringify({ text: 'Hello' }),
    });
    assert(badTokenRes.status === 401, 'Request with invalid token is rejected with 401');

    // ----------------------------------------------------
    // Test Group 4: POST /api/tts Payload Validation
    // ----------------------------------------------------
    console.log('\nTest Group 4: POST /api/tts Payload Validation');
    const emptyBodyRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({ text: '   ' }),
    });
    assert(emptyBodyRes.status === 400, 'Whitespace-only text rejected with 400');

    // ----------------------------------------------------
    // Test Group 5: POST /api/tts Cache Delivery
    // ----------------------------------------------------
    console.log('\nTest Group 5: POST /api/tts Cached Audio Delivery');
    setCachedAudio('Leo says "Hi!" to Nina. What can Nina say?', mockAudioBase64);
    const cachedApiRes = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${testToken}`,
      },
      body: JSON.stringify({ text: 'Leo says "Hi!" to Nina. What can Nina say?' }),
    });
    const cachedApiData = await cachedApiRes.json();
    assert(cachedApiRes.status === 200, 'Cached speech returns HTTP 200');
    assert(cachedApiData.success === true, 'Response indicates success');
    assert(cachedApiData.cached === true, 'Response indicates audio was served from cache');
    assert(cachedApiData.audioContent === mockAudioBase64, 'Audio content is returned accurately');

    // ----------------------------------------------------
    // Test Group 6: Graceful Handling when Live API Credentials Missing
    // ----------------------------------------------------
    console.log('\nTest Group 6: Error Handling for Missing Credentials');
    if (!hasCredentialsConfigured()) {
      const liveUncachedRes = await fetch(`${baseUrl}/api/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testToken}`,
        },
        body: JSON.stringify({ text: 'Uncached text without credentials' }),
      });
      const liveUncachedData = await liveUncachedRes.json();
      assert(liveUncachedRes.status === 503, 'Missing credentials cleanly return HTTP 503');
      assert(liveUncachedData.success === false, 'success is false');
      assert(liveUncachedData.message.includes('credentials'), 'Friendly message indicating missing credentials');
    } else {
      console.log('  [INFO] Real credentials detected, live synthesis test can run');
    }

    // ----------------------------------------------------
    // Test Group 7: Existing Game Routes Regression Test
    // ----------------------------------------------------
    console.log('\nTest Group 7: Existing API Routes Regression Check');
    const healthRes = await fetch(`${baseUrl}/api/games/health`);
    const healthData = await healthRes.json();
    assert(healthRes.status === 200, 'Existing GET /api/games/health returns 200');
    assert(healthData.success === true, 'Game health reports success');
    assert(healthData.modules.greeting > 0, 'Greeting question module is loaded');
    assert(healthData.modules.sharing > 0, 'Sharing question module is loaded');
    assert(healthData.modules.waiting > 0, 'Waiting question module is loaded');
    assert(healthData.modules.emotion > 0, 'Emotion question module is loaded');
    assert(healthData.modules.communication > 0, 'Communication question module is loaded');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('\n----------------------------------------------------');
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
