import express from 'express';
import { synthesize, getStatus } from '../controllers/ttsController.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Status probe: provides information about TTS configuration and cache
router.get('/status', getStatus);

// Synthesize speech from text: protected by existing authentication pattern
router.post('/', authMiddleware, synthesize);

export default router;
