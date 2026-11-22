import { synthesizeSpeech, getCacheStats, hasCredentialsConfigured } from '../services/ttsService.js';

/**
 * Handle POST /api/tts
 * Convert incoming text into speech using Google Cloud Text-to-Speech.
 */
export const synthesize = async (req, res) => {
  try {
    const { text, languageCode, voiceName, speakingRate, pitch } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Request body must include a non-empty "text" string.',
      });
    }

    const options = {};
    if (languageCode) options.languageCode = String(languageCode);
    if (voiceName) options.voiceName = String(voiceName);
    if (typeof speakingRate === 'number') options.speakingRate = speakingRate;
    if (typeof pitch === 'number') options.pitch = pitch;

    const result = await synthesizeSpeech(text, options);

    return res.status(200).json({
      success: true,
      audioContent: result.audioContent,
      format: result.format,
      cached: result.cached,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || 'Error generating text-to-speech audio',
      ...(process.env.NODE_ENV === 'development' && error.details ? { details: error.details } : {}),
    });
  }
};

/**
 * Handle GET /api/tts/status
 * Health probe for TTS service, providing cache status and readiness.
 */
export const getStatus = async (req, res) => {
  const stats = getCacheStats();
  const hasCredentials = hasCredentialsConfigured();

  return res.status(200).json({
    success: true,
    service: 'Google Cloud Text-to-Speech',
    credentialsConfigured: hasCredentials,
    cache: stats,
    defaults: {
      languageCode: process.env.GOOGLE_TTS_LANGUAGE_CODE || 'en-US',
      voiceName: process.env.GOOGLE_TTS_VOICE_NAME || 'en-US-Neural2-F',
      speakingRate: parseFloat(process.env.GOOGLE_TTS_SPEAKING_RATE) || 0.92,
      pitch: parseFloat(process.env.GOOGLE_TTS_PITCH) || 0.0,
    },
  });
};
