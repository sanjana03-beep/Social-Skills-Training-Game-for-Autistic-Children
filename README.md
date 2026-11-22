# Social Steps: Social Skill Training Games (SSTG)

Social Steps is a web-based educational game designed to help autistic children develop and practice vital social skills through adaptive, interactive activities.

## Features
- **Adaptive Item Selection:** Rasch 1PL Item Response Theory (IRT) with weighted random selection to tailor question difficulty to each child's ability level.
- **Child-Friendly Text-to-Speech:** Natural, calm speech synthesis powered by **Google Cloud Text-to-Speech** (Neural2 voice) with in-memory caching and playback queue management.
- **5 Learning Modules:**
  - Greeting Skills
  - Sharing & Kindness
  - Waiting & Turn-Taking
  - Emotion Recognition
  - Communication & Politeness
- **Child Profile & Progress Tracking:** Personalized dashboard with stars, badges, and progress tracking.

## Quick Start

### 1. Prerequisites
- Node.js (v18+)
- MongoDB Atlas account or local MongoDB instance
- Google Cloud account with Cloud Text-to-Speech API enabled

### 2. Setup & Installation
```bash
cd backend
npm install
cp .env.example .env
```
Edit `backend/.env` with your MongoDB connection string, JWT secret, and Google Cloud credentials path (`GOOGLE_APPLICATION_CREDENTIALS`).

### 3. Run the Application
```bash
cd backend
npm run dev
```
Open your browser at `http://localhost:5000`.

### 4. Running Tests
```bash
cd backend
npm run test:tts
```

For complete Google Cloud Text-to-Speech configuration and API details, see [`backend/README.md`](backend/README.md).