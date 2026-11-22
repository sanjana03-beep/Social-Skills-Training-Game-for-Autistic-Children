import textToSpeech from '@google-cloud/text-to-speech';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Configuration defaults tuned for an educational social-skills game for children:
// Clear, calm, friendly tone with a slightly relaxed speaking rate.
const DEFAULT_LANGUAGE_CODE = process.env.GOOGLE_TTS_LANGUAGE_CODE || 'en-US';
const DEFAULT_VOICE_NAME = process.env.GOOGLE_TTS_VOICE_NAME || 'en-US-Neural2-F';
const DEFAULT_SSML_GENDER = process.env.GOOGLE_TTS_SSML_GENDER || 'FEMALE';
const DEFAULT_SPEAKING_RATE = parseFloat(process.env.GOOGLE_TTS_SPEAKING_RATE) || 0.92;
const DEFAULT_PITCH = parseFloat(process.env.GOOGLE_TTS_PITCH) || 0.0;
const MAX_TEXT_LENGTH = 600; // Educational questions & feedback are well within this bound
const MAX_CACHE_SIZE = 500;  // Lightweight in-memory cache capacity

// In-memory cache for synthesized speech to reduce latency and API billing.
// Map preserves insertion order, allowing straightforward LRU-style eviction.
const audioCache = new Map();

let ttsClient = null;

/**
 * Check if Google Cloud credentials are configured in the environment.
 * Supports GOOGLE_APPLICATION_CREDENTIALS path, standard ADC locations,
 * or cloud runtime indicators (Cloud Run / App Engine).
 */
export function hasCredentialsConfigured() {
  if (process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY) {
    return true;
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    return true;
  }

  const adcPath = process.platform === 'win32'
    ? (process.env.APPDATA ? path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json') : null)
    : (process.env.HOME ? path.join(process.env.HOME, '.config', 'gcloud', 'application_default_credentials.json') : null);

  if (adcPath && fs.existsSync(adcPath)) {
    return true;
  }

  if (process.env.K_SERVICE || process.env.GAE_SERVICE) {
    return true;
  }

  return false;
}

/**
 * Lazily instantiate or return the Google Cloud TextToSpeechClient.
 */
function getClient() {
  if (!ttsClient) {
    const clientOptions = {};
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY;
    if (apiKey) {
      clientOptions.apiKey = apiKey;
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      clientOptions.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      clientOptions.projectId = process.env.GOOGLE_CLOUD_PROJECT;
    }
    ttsClient = new textToSpeech.TextToSpeechClient(clientOptions);
  }
  return ttsClient;
}

/**
 * Generate a deterministic cache key from input text and voice settings.
 */
function computeCacheKey(text, voiceOptions = {}) {
  const normText = text.trim();
  const lang = voiceOptions.languageCode || DEFAULT_LANGUAGE_CODE;
  const voice = voiceOptions.voiceName || DEFAULT_VOICE_NAME;
  const rate = voiceOptions.speakingRate || DEFAULT_SPEAKING_RATE;
  const pitch = voiceOptions.pitch || DEFAULT_PITCH;
  const rawKey = `${lang}::${voice}::${rate}::${pitch}::${normText}`;
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Synthesize speech from text using Google Cloud Text-to-Speech API.
 *
 * @param {string} text - The text string to convert to speech.
 * @param {object} [options] - Optional overrides for voice and rate.
 * @returns {Promise<{audioContent: string, format: string, cached: boolean}>}
 */
export async function synthesizeSpeech(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    const err = new Error('Input text must be a non-empty string');
    err.statusCode = 400;
    throw err;
  }

  const trimmedText = text.trim();
  if (trimmedText.length > MAX_TEXT_LENGTH) {
    const err = new Error(`Input text exceeds maximum allowed length of ${MAX_TEXT_LENGTH} characters`);
    err.statusCode = 400;
    throw err;
  }

  const languageCode = options.languageCode || DEFAULT_LANGUAGE_CODE;
  const voiceName = options.voiceName || DEFAULT_VOICE_NAME;
  const ssmlGender = options.ssmlGender || DEFAULT_SSML_GENDER;
  const speakingRate = typeof options.speakingRate === 'number' ? options.speakingRate : DEFAULT_SPEAKING_RATE;
  const pitch = typeof options.pitch === 'number' ? options.pitch : DEFAULT_PITCH;

  const cacheKey = computeCacheKey(trimmedText, {
    languageCode,
    voiceName,
    speakingRate,
    pitch,
  });

  // 1. Check in-memory cache
  if (audioCache.has(cacheKey)) {
    const cachedEntry = audioCache.get(cacheKey);
    // Refresh position for LRU
    audioCache.delete(cacheKey);
    audioCache.set(cacheKey, cachedEntry);
    return {
      audioContent: cachedEntry.audioContent,
      format: cachedEntry.format,
      cached: true,
    };
  }

  // 2. Validate credentials configuration before invoking the cloud client
  if (!hasCredentialsConfigured()) {
    const err = new Error('Google Cloud Text-to-Speech credentials are missing or unauthorized');
    err.statusCode = 503;
    err.details = 'Please set GOOGLE_APPLICATION_CREDENTIALS in backend/.env pointing to your service account key file, or configure Application Default Credentials via gcloud.';
    throw err;
  }

  const client = getClient();

  const request = {
    input: { text: trimmedText },
    voice: {
      languageCode,
      name: voiceName,
      ssmlGender,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate,
      pitch,
    },
  };

  let response;
  try {
    const [apiResponse] = await client.synthesizeSpeech(request);
    response = apiResponse;
  } catch (apiError) {
    console.error('[ttsService] Google Cloud Text-to-Speech synthesis error:', apiError.message);

    const err = new Error(
      apiError.code === 7 || apiError.message?.includes('credentials') || apiError.message?.includes('Could not load the default credentials')
        ? 'Google Cloud Text-to-Speech credentials are missing or unauthorized'
        : 'Failed to synthesize speech via Google Cloud Text-to-Speech'
    );
    err.statusCode = 503;
    err.details = apiError.message;
    throw err;
  }

  if (!response || !response.audioContent) {
    const err = new Error('No audio content received from Google Cloud Text-to-Speech');
    err.statusCode = 502;
    throw err;
  }

  const base64Audio = Buffer.from(response.audioContent).toString('base64');
  const result = {
    audioContent: base64Audio,
    format: 'audio/mp3',
    cached: false,
  };

  // Cache management: Evict oldest if limit reached
  if (audioCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = audioCache.keys().next().value;
    if (oldestKey) audioCache.delete(oldestKey);
  }
  audioCache.set(cacheKey, {
    audioContent: base64Audio,
    format: 'audio/mp3',
    createdAt: Date.now(),
  });

  return result;
}

/**
 * Clear the in-memory audio cache. Useful for tests and diagnostics.
 */
export function clearAudioCache() {
  audioCache.clear();
}

/**
 * Inject an audio entry directly into the cache. Useful for testing or pre-warming.
 */
export function setCachedAudio(text, audioBase64, options = {}) {
  const cacheKey = computeCacheKey(text, options);
  audioCache.set(cacheKey, {
    audioContent: audioBase64,
    format: 'audio/mp3',
    createdAt: Date.now(),
  });
  return cacheKey;
}

/**
 * Get current cache statistics.
 */
export function getCacheStats() {
  return {
    size: audioCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}
