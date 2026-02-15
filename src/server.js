require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// 11 Labs API Key
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Rate Limiting: 50 Anfragen pro Tag
const DAILY_LIMIT = 50;
let requestCount = 0;
let lastReset = new Date().setHours(0,0,0,0);

function checkRateLimit(req, res, next) {
  const now = new Date().setHours(0,0,0,0);
  
  // Reset um Mitternacht
  if (now > lastReset) {
    requestCount = 0;
    lastReset = now;
  }
  
  if (requestCount >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'Tägliches Limit erreicht (50 Anfragen). Bitte versuche es morgen wieder.',
      limit: DAILY_LIMIT,
      resetAt: '00:00 UTC'
    });
  }
  
  requestCount++;
  console.log(`[RateLimit] Anfrage ${requestCount}/${DAILY_LIMIT}`);
  next();
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate Limit auf API-Routen anwenden
app.use('/api', checkRateLimit);

// Temp-Verzeichnis
const TEMP_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'temp')
  : path.join(__dirname, '../temp');
fs.ensureDirSync(TEMP_DIR);
console.log(`Temp-Verzeichnis: ${TEMP_DIR}`);

// Hilfsfunktion: Ausführung mit Timeout
function execWithTimeout(command, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { 
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 50
    }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Railway/Nixpacks stellt `yt-dlp` als System-Binary bereit.
const YTDLP_CMD = 'yt-dlp';

// Facebook Ad Library URL validieren
function isValidFacebookAdLibraryUrl(url) {
  const regex = /^https:\/\/www\.facebook\.com\/ads\/library\/\?id=\d+/;
  return regex.test(url);
}

// Route: Hauptseite
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Route: Video Download
app.post('/api/download', async (req, res) => {
  const { url } = req.body;
  
  if (!url || !isValidFacebookAdLibraryUrl(url)) {
    return res.status(400).json({ 
      error: 'Ungültige Facebook Ad Library URL. Format: https://www.facebook.com/ads/library/?id=...' 
    });
  }

  const requestId = uuidv4();
  const workDir = path.join(TEMP_DIR, requestId);
  
  try {
    await fs.ensureDir(workDir);
    console.log(`[${requestId}] Starte Download für: ${url}`);
    
    const videoPath = path.join(workDir, 'video.mp4');
    const ytdlpCommand = `${YTDLP_CMD} -o "${videoPath}" --format "best[ext=mp4]/best" --no-check-certificate --no-warnings "${url}"`;
    
    try {
      await execWithTimeout(ytdlpCommand, 180000);
    } catch (e) {
      const fallbackCommand = `${YTDLP_CMD} -o "${videoPath}" --format "best" --user-agent "Mozilla/5.0" --no-check-certificate --no-warnings "${url}"`;
      await execWithTimeout(fallbackCommand, 180000);
    }

    if (!await fs.pathExists(videoPath)) {
      throw new Error('Video konnte nicht heruntergeladen werden');
    }

    const stats = await fs.stat(videoPath);
    
    res.json({
      success: true,
      requestId,
      message: 'Video erfolgreich heruntergeladen',
      videoSize: stats.size,
      videoPath: `/api/download/video/${requestId}`
    });

  } catch (error) {
    console.error(`[${requestId}] Download Fehler:`, error);
    await fs.remove(workDir).catch(() => {});
    res.status(500).json({ 
      error: 'Download fehlgeschlagen: ' + (error.error?.message || error.message)
    });
  }
});

// Route: Video Datei
app.get('/api/download/video/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const videoPath = path.join(TEMP_DIR, requestId, 'video.mp4');
  
  if (!await fs.pathExists(videoPath)) {
    return res.status(404).json({ error: 'Video nicht gefunden' });
  }
  
  res.download(videoPath, `facebook-ad-${requestId}.mp4`);
});

// Route: Audio extrahieren
app.post('/api/extract-audio/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const videoPath = path.join(TEMP_DIR, requestId, 'video.mp4');
  const audioPath = path.join(TEMP_DIR, requestId, 'audio.mp3');
  
  if (!await fs.pathExists(videoPath)) {
    return res.status(404).json({ error: 'Video nicht gefunden' });
  }

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .toFormat('mp3')
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .on('end', resolve)
        .on('error', reject)
        .save(audioPath);
    });

    res.json({
      success: true,
      message: 'Audio erfolgreich extrahiert',
      audioPath: `/api/download/audio/${requestId}`
    });

  } catch (error) {
    console.error('Audio Extraktion Fehler:', error);
    res.status(500).json({ error: 'Audio Extraktion fehlgeschlagen' });
  }
});

// Route: Audio Datei
app.get('/api/download/audio/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const audioPath = path.join(TEMP_DIR, requestId, 'audio.mp3');
  
  if (!await fs.pathExists(audioPath)) {
    return res.status(404).json({ error: 'Audio nicht gefunden' });
  }
  
  res.download(audioPath, `facebook-ad-${requestId}.mp3`);
});

// Hilfsfunktion: ElevenLabs Scribe Transkription mit Speaker-Diarization
async function transcribeWithElevenLabs(audioPath, language = 'de') {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API Key nicht konfiguriert');
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(audioPath));
  form.append('model_id', 'scribe_v1');
  form.append('language_code', language);
  form.append('tag_audio_events', 'true');
  form.append('num_speakers', '2');
  form.append('timestamps_granularity', 'word');
  form.append('diarize', 'true');

  const response = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', form, {
    headers: {
      ...form.getHeaders(),
      'xi-api-key': ELEVENLABS_API_KEY
    }
  });

  // Format: Nur Speaker, keine Timestamps
  const words = response.data.words || [];
  let formatted = '';
  let currentSpeaker = null;
  let currentLine = '';

  for (const word of words) {
    if (word.type === 'audio_event') continue;
    
    const speaker = word.speaker_id || 'Unknown';
    
    if (speaker !== currentSpeaker) {
      if (currentLine) {
        formatted += `${currentSpeaker}: ${currentLine.trim()}\n`;
      }
      currentSpeaker = speaker;
      currentLine = word.text + ' ';
    } else {
      currentLine += word.text + ' ';
    }
  }
  
  if (currentLine) {
    formatted += `${currentSpeaker}: ${currentLine.trim()}\n`;
  }

  return formatted;
}

// Route: Transkription mit ElevenLabs Scribe
app.post('/api/transcribe/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const { language = 'de' } = req.body;
  const audioPath = path.join(TEMP_DIR, requestId, 'audio.mp3');
  const videoPath = path.join(TEMP_DIR, requestId, 'video.mp4');
  
  let sourcePath = audioPath;
  if (!await fs.pathExists(audioPath)) {
    if (!await fs.pathExists(videoPath)) {
      return res.status(404).json({ error: 'Quelldatei nicht gefunden' });
    }
    // Audio extrahieren
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .toFormat('mp3')
          .audioCodec('libmp3lame')
          .audioBitrate(128)
          .on('end', resolve)
          .on('error', reject)
          .save(audioPath);
      });
    } catch (error) {
      return res.status(500).json({ error: 'Audio Extraktion fehlgeschlagen' });
    }
  }

  try {
    console.log(`[${requestId}] Starte ElevenLabs Scribe Transkription...`);
    
    const transcription = await transcribeWithElevenLabs(audioPath, language);

    const transcriptPath = path.join(TEMP_DIR, requestId, 'transcript.txt');
    await fs.writeFile(transcriptPath, transcription);

    res.json({
      success: true,
      message: 'Transkription erfolgreich',
      transcription,
      downloadUrl: `/api/download/transcript/${requestId}`
    });

  } catch (error) {
    console.error('Transkription Fehler:', error);
    res.status(500).json({ 
      error: 'Transkription fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler')
    });
  }
});

// Route: Transkript Datei
app.get('/api/download/transcript/:requestId', async (req, res) => {
  const { requestId } = req.params;
  const transcriptPath = path.join(TEMP_DIR, requestId, 'transcript.txt');
  
  if (!await fs.pathExists(transcriptPath)) {
    return res.status(404).json({ error: 'Transkript nicht gefunden' });
  }
  
  res.download(transcriptPath, `facebook-ad-${requestId}-transcript.txt`);
});

// Route: Vollständiger Workflow (Download + Audio + Transkription)
app.post('/api/process', async (req, res) => {
  const { url, language = 'de' } = req.body;
  
  if (!url || !isValidFacebookAdLibraryUrl(url)) {
    return res.status(400).json({ 
      error: 'Ungültige Facebook Ad Library URL' 
    });
  }

  const requestId = uuidv4();
  const workDir = path.join(TEMP_DIR, requestId);
  
  try {
    await fs.ensureDir(workDir);
    console.log(`[${requestId}] Starte vollständige Verarbeitung...`);
    
    // 1. Video Download
    const videoPath = path.join(workDir, 'video.mp4');
    const ytdlpCommand = `${YTDLP_CMD} -o "${videoPath}" --format "best[ext=mp4]/best" --no-check-certificate --no-warnings "${url}"`;
    
    try {
      await execWithTimeout(ytdlpCommand, 180000);
    } catch (e) {
      const fallbackCommand = `${YTDLP_CMD} -o "${videoPath}" --format "best" --user-agent "Mozilla/5.0" --no-check-certificate --no-warnings "${url}"`;
      await execWithTimeout(fallbackCommand, 180000);
    }

    // 2. Audio Extraktion
    const audioPath = path.join(workDir, 'audio.mp3');
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .toFormat('mp3')
        .audioCodec('libmp3lame')
        .audioBitrate(128)
        .on('end', resolve)
        .on('error', reject)
        .save(audioPath);
    });

    // 3. ElevenLabs Scribe Transkription mit Speaker
    const transcription = await transcribeWithElevenLabs(audioPath, language);

    const transcriptPath = path.join(workDir, 'transcript.txt');
    await fs.writeFile(transcriptPath, transcription);

    res.json({
      success: true,
      requestId,
      message: 'Verarbeitung erfolgreich abgeschlossen',
      downloads: {
        video: `/api/download/video/${requestId}`,
        audio: `/api/download/audio/${requestId}`,
        transcript: `/api/download/transcript/${requestId}`
      },
      transcription: transcription.substring(0, 500) + (transcription.length > 500 ? '...' : '')
    });

  } catch (error) {
    console.error(`[${requestId}] Verarbeitungsfehler:`, error);
    await fs.remove(workDir).catch(() => {});
    res.status(500).json({ 
      error: 'Verarbeitung fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler')
    });
  }
});

// Cleanup: Alte Dateien löschen (älter als 1 Stunde)
setInterval(async () => {
  try {
    const dirs = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    
    for (const dir of dirs) {
      const dirPath = path.join(TEMP_DIR, dir);
      const stats = await fs.stat(dirPath);
      
      if (now - stats.mtime.getTime() > 3600000) {
        await fs.remove(dirPath);
        console.log(`Cleanup: ${dir} gelöscht`);
      }
    }
  } catch (error) {
    console.error('Cleanup Fehler:', error);
  }
}, 600000);

// Route: 11 Labs Voice Clone
app.post('/api/clone-voice/:requestId', async (req, res) => {
  if (!ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: '11 Labs API Key nicht konfiguriert' });
  }
  
  const { requestId } = req.params;
  const audioPath = path.join(TEMP_DIR, requestId, 'audio.mp3');
  
  if (!await fs.pathExists(audioPath)) {
    return res.status(404).json({ error: 'Audio nicht gefunden' });
  }
  
  try {
    const form = new FormData();
    form.append('name', `Ad-Voice-${requestId.slice(0, 8)}`);
    form.append('files', fs.createReadStream(audioPath));
    
    const response = await axios.post('https://api.elevenlabs.io/v1/voices/add', form, {
      headers: {
        ...form.getHeaders(),
        'xi-api-key': ELEVENLABS_API_KEY
      }
    });
    
    res.json({
      success: true,
      voiceId: response.data.voice_id,
      message: 'Voice erfolgreich geklont'
    });
    
  } catch (error) {
    console.error('Voice Clone Fehler:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Voice Cloning fehlgeschlagen: ' + (error.response?.data?.detail || error.message)
    });
  }
});

// Route: 11 Labs Text-to-Speech
app.post('/api/text-to-speech/:voiceId', async (req, res) => {
  if (!ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: '11 Labs API Key nicht konfiguriert' });
  }
  
  const { voiceId } = req.params;
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Text erforderlich' });
  }
  
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );
    
    const outputPath = path.join(TEMP_DIR, `tts-${Date.now()}.mp3`);
    await fs.writeFile(outputPath, response.data);
    
    res.sendFile(outputPath);
    
  } catch (error) {
    console.error('TTS Fehler:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Text-to-Speech fehlgeschlagen'
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    rateLimit: {
      dailyLimit: DAILY_LIMIT,
      usedToday: requestCount,
      remaining: Math.max(0, DAILY_LIMIT - requestCount)
    },
    features: {
      elevenlabs: !!ELEVENLABS_API_KEY,
      transcription: 'ElevenLabs Scribe API',
      speakerDiarization: true
    }
  });
});

app.listen(PORT, () => {
  console.log(`Facebook Ad Library Downloader läuft auf Port ${PORT}`);
  console.log(`Transkription: ElevenLabs Scribe API mit Speaker-Erkennung`);
});
