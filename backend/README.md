# Social Steps — Backend & Google Cloud Text-to-Speech Integration

This service powers the **Social Steps** educational platform, providing adaptive question delivery (Rasch IRT) and natural, child-friendly speech synthesis using **Google Cloud Text-to-Speech**.

---

## 1. Google Cloud Setup Guide

To enable live Google Cloud Text-to-Speech:

### Step A: Create or Select a Google Cloud Project
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `social-steps-game`) or select an existing project.
3. Ensure billing is enabled for the project (Google Cloud provides a generous free tier of up to 4 million standard characters or 1 million Neural2/WaveNet characters free per month).

### Step B: Enable the Text-to-Speech API
1. Navigate to **APIs & Services** > **Library** in the Google Cloud Console.
2. Search for **Cloud Text-to-Speech API**.
3. Click **Enable**.

### Step C: Authenticate (Choose Option A or Option B)

#### Option A: API Key (Quickest)
1. In the Google Cloud Console, go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **API key**.
3. Copy the key and add it to `backend/.env`:
   ```env
   GOOGLE_TTS_API_KEY=AIzaSyYourApiKeyHere
   ```

#### Option B: Service Account JSON Key
1. Go to **IAM & Admin** > **Service Accounts**.
2. Click **Create Service Account** (e.g., `sstg-tts-service`).
3. Grant the role **Cloud Text-to-Speech User** (`roles/texttospeech.user`).
4. In the service account's **Keys** tab, click **Add Key** > **Create new key** > **JSON**.
5. Save the downloaded JSON file (e.g., `backend/google-credentials.json`) and configure:
   ```env
   GOOGLE_APPLICATION_CREDENTIALS=backend/google-credentials.json
   ```
   > *Note: Credentials files matching `*credentials*.json`, `*gcp*.json`, and `*service-account*.json` are automatically ignored by git.*

---

## 2. Environment Configuration

Copy the provided `.env.example` to `backend/.env` (if not already present):

```env
PORT=5000
MONGO_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/socialsteps?retryWrites=true&w=majority
JWT_SECRET=your_jwt_secret_key

# Google Cloud Text-to-Speech Configuration
GOOGLE_APPLICATION_CREDENTIALS=backend/google-credentials.json
GOOGLE_CLOUD_PROJECT=your-gcp-project-id

# Voice Tuning for Autistic Learners
GOOGLE_TTS_LANGUAGE_CODE=en-US
GOOGLE_TTS_VOICE_NAME=en-US-Neural2-F
GOOGLE_TTS_SPEAKING_RATE=0.92
GOOGLE_TTS_PITCH=0.0
```

### Voice Tuning Considerations
- **Voice Selection:** `en-US-Neural2-F` provides a calm, clear, and natural female voice suitable for young learners. Other supported voices include `en-US-Journey-F` and `en-US-Standard-C`.
- **Speaking Rate:** Defaulted to `0.92` to provide a relaxed, easily understandable pace without sounding unnatural.
- **Pitch:** Defaulted to `0.0` for natural melodic contours.

---

## 3. Installation & Starting the Server

From the `backend` directory:

```bash
# Install dependencies
npm install

# Run the development server with live reload
npm run dev

# Or start the server in production mode
npm start
```

The Express API server will listen on `http://localhost:5000`.

---

## 4. API Endpoints for Text-to-Speech

### `POST /api/tts`
Synthesizes speech from text. Protected by JWT authentication (`Authorization: Bearer <token>`).

**Request Headers:**
- `Content-Type: application/json`
- `Authorization: Bearer <jwt-token>`

**Request Body:**
```json
{
  "text": "Leo says \"Hi!\" to Nina. What can Nina say?",
  "voiceName": "en-US-Neural2-F",
  "languageCode": "en-US",
  "speakingRate": 0.92,
  "pitch": 0.0
}
```

**Response (HTTP 200):**
```json
{
  "success": true,
  "audioContent": "<base64-encoded-mp3-audio>",
  "format": "audio/mp3",
  "cached": false
}
```

### `GET /api/tts/status`
Public health probe reporting TTS configuration, cache status, and default voice settings.

**Response (HTTP 200):**
```json
{
  "success": true,
  "service": "Google Cloud Text-to-Speech",
  "credentialsConfigured": true,
  "cache": {
    "size": 12,
    "maxSize": 500
  },
  "defaults": {
    "languageCode": "en-US",
    "voiceName": "en-US-Neural2-F",
    "speakingRate": 0.92,
    "pitch": 0.0
  }
}
```

---

## 5. Performance & In-Memory Caching

- An in-memory LRU-style cache (capacity 500 entries) stores synthesized MP3 base64 strings keyed by a SHA-256 hash of the normalized text and voice parameters.
- Frequently repeated texts (such as question repetitions, answer options, and feedback messages like *"Correct! Great job!"*) are delivered instantly from cache, saving latency and Google Cloud API billing costs.
- Cache entries persist for the lifetime of the Node.js process and reset cleanly upon server restart without requiring Redis or extra database infrastructure.

---

## 6. Testing

### Run Automated TTS Test Suite
```bash
npm run test:tts
```
This runs 30 automated assertions covering:
- Input validation (empty text, oversized text).
- In-memory cache insertion, retrieval, and eviction.
- Status probe (`GET /api/tts/status`).
- JWT authentication and authorization enforcement.
- Graceful error responses (HTTP 503) when credentials are not configured.
- Regression verification ensuring existing game routes and item banks remain functional.

---

## 7. Frontend Integration & Manual Verification

1. Start the server with `npm run dev` in `backend/`.
2. Open a browser to `http://localhost:5000/login.html` (or `http://localhost:5000/`).
3. Log in with an existing account or register.
4. From the dashboard, click **Start Learning** and select any social skill module (e.g., Greeting Skills).
5. On the quiz screen:
   - **Question Speech:** Verify that the question is read aloud automatically when loaded.
   - **🔊 Repeat Button:** Click to hear the question repeated.
   - **🔊 Read Options Button:** Click to hear each multiple-choice option read sequentially without overlap.
   - **Answer Feedback:** Select an answer and verify that spoken feedback plays (*"Correct! Great job!"* or *"Incorrect. The correct answer is..."*).
   - **Navigation:** Click **Next** to confirm that any ongoing audio stops immediately and the next question loads cleanly.
