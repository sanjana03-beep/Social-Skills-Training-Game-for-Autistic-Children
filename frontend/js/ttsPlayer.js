/**
 * Google Cloud Text-to-Speech Player for Social Steps
 *
 * Primary: Google Cloud Text-to-Speech via POST /api/tts.
 * Fallback: Browser Web Speech API if Google Cloud credentials are not configured or offline.
 *
 * Features:
 * - Plays natural speech audio synthesized by Google Cloud Text-to-Speech.
 * - Prevents overlapping audio by cancelling existing playback on new requests.
 * - Sequential option reading: seamlessly reads question and all options without stopping.
 * - Handles browser autoplay restrictions gracefully.
 * - In-flight cancellation tokens so stale responses never play after question transitions.
 * - Non-blocking error handling: failures never block quiz answers or game progress.
 */
(function (global) {
  let activeAudio = null;
  let activePlaybackToken = 0;
  let pendingAutoplayText = null;

  function getApiEndpoint() {
    if (global.API) {
      return `${global.API}/tts`;
    }
    const origin = global.location ? global.location.origin : 'http://localhost:5000';
    return `${origin}/api/tts`;
  }

  function getAuthToken() {
    try {
      return global.localStorage ? global.localStorage.getItem('token') : null;
    } catch (_) {
      return null;
    }
  }

  // Unlock audio on first user interaction if blocked by browser autoplay policy
  if (typeof window !== 'undefined') {
    const unlockAudio = () => {
      if (pendingAutoplayText) {
        const textToPlay = pendingAutoplayText;
        pendingAutoplayText = null;
        TTSPlayer.speak(textToPlay);
      }
    };
    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
  }

  const TTSPlayer = {
    /**
     * Immediately stop all audio playback.
     */
    stop: function () {
      activePlaybackToken++;
      pendingAutoplayText = null;

      if (activeAudio) {
        try {
          activeAudio.pause();
          activeAudio.currentTime = 0;
          activeAudio.src = '';
        } catch (e) {
          // Ignore audio pause errors
        }
        activeAudio = null;
      }

      if (global.speechSynthesis) {
        try {
          global.speechSynthesis.cancel();
        } catch (e) {
          // Ignore synthesis cancel errors
        }
      }
      global._ttsUtterance = null;
    },

    /**
     * Check if speech audio is currently playing.
     */
    isSpeaking: function () {
      const isAudioPlaying = activeAudio !== null && !activeAudio.paused && !activeAudio.ended;
      const isSynthSpeaking = Boolean(global.speechSynthesis && global.speechSynthesis.speaking);
      return isAudioPlaying || isSynthSpeaking;
    },

    /**
     * Fallback speech synthesis using browser Web Speech API.
     * Used when Google Cloud TTS is unconfigured, unauthorized, or offline.
     */
    speakFallback: function (text, currentToken) {
      if (!global.speechSynthesis) return Promise.resolve(false);

      return new Promise((resolve) => {
        try {
          global.speechSynthesis.cancel();
          if (global.speechSynthesis.paused) {
            global.speechSynthesis.resume();
          }

          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 0.92;
          utterance.pitch = 1.0;
          global._ttsUtterance = utterance; // Prevent garbage collection in Chrome

          let finished = false;
          const finish = (result) => {
            if (finished) return;
            finished = true;
            if (global._ttsUtterance === utterance) {
              global._ttsUtterance = null;
            }
            resolve(result);
          };

          utterance.onend = () => finish(true);
          utterance.onerror = (e) => {
            console.warn('[TTSPlayer] Speech fallback notice:', e.error || e);
            finish(false);
          };

          // Safety timeout based on word count
          const words = text.split(/\s+/).length;
          const maxDurationMs = Math.max(3500, (words / 2) * 1000 + 2000);
          setTimeout(() => finish(true), maxDurationMs);

          global.speechSynthesis.speak(utterance);
        } catch (err) {
          console.warn('[TTSPlayer] Fallback speech error:', err);
          resolve(false);
        }
      });
    },

    /**
     * Synthesize and play a text string using Google Cloud TTS backend (with fallback).
     *
     * @param {string} text - The text to be spoken.
     * @param {object} [options] - Optional overrides for voice, speed, etc.
     * @returns {Promise<boolean>} Resolves true when audio finished, false if interrupted or failed.
     */
    speak: async function (text, options = {}) {
      if (!text || typeof text !== 'string' || !text.trim()) {
        return false;
      }

      // Stop any existing speech before starting new speech
      this.stop();
      const currentToken = activePlaybackToken;

      try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const endpoint = getApiEndpoint();
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            text: text.trim(),
            voiceName: options.voiceName,
            languageCode: options.languageCode,
            speakingRate: options.speakingRate,
            pitch: options.pitch,
          }),
        });

        // If another speech was triggered while fetching, discard this response
        if (currentToken !== activePlaybackToken) {
          return false;
        }

        const data = await response.json();

        // If Google Cloud TTS succeeds with audio content
        if (data && data.success && data.audioContent) {
          return new Promise((resolve) => {
            if (currentToken !== activePlaybackToken) {
              resolve(false);
              return;
            }

            const format = data.format || 'audio/mp3';
            const audio = new Audio(`data:${format};base64,${data.audioContent}`);
            activeAudio = audio;

            let finished = false;
            const finish = (result) => {
              if (finished) return;
              finished = true;
              if (activeAudio === audio) {
                activeAudio = null;
              }
              resolve(result);
            };

            audio.onended = () => finish(true);

            audio.onerror = (err) => {
              console.warn('[TTSPlayer] Audio playback error, using speech fallback:', err);
              this.speakFallback(text, currentToken).then(finish);
            };

            const playPromise = audio.play();
            if (playPromise !== undefined) {
              playPromise.catch((err) => {
                if (err.name === 'NotAllowedError') {
                  console.info('[TTSPlayer] Autoplay prevented by browser.');
                  pendingAutoplayText = text;
                }
                this.speakFallback(text, currentToken).then(finish);
              });
            }
          });
        }

        // If Google Cloud TTS returned an error (e.g. credentials missing in .env), fall back cleanly
        return this.speakFallback(text, currentToken);
      } catch (networkError) {
        return this.speakFallback(text, currentToken);
      }
    },

    /**
     * Sequentially speak multiple items (e.g. Option A, Option B, Option C, Option D).
     * Combines items into a cohesive prosodic utterance to ensure seamless
     * playback across all devices and browsers without mid-sequence cutoffs.
     *
     * @param {string[]|string} items - Array of texts or single text string.
     */
    speakSequence: async function (items) {
      if (!items) return false;
      if (typeof items === 'string') {
        return this.speak(items);
      }
      if (Array.isArray(items)) {
        if (items.length === 0) return false;
        // Clean each item and join with sentence boundary periods to provide natural pauses
        const text = items
          .filter(Boolean)
          .map((s) => String(s).trim().replace(/[.\s]+$/, ''))
          .join('. ') + '.';
        return this.speak(text);
      }
      return false;
    },
  };

  global.TTSPlayer = TTSPlayer;
})(typeof window !== 'undefined' ? window : this);
