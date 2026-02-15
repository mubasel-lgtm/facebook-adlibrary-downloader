# 📹 Facebook Ad Library Downloader

Eine Railway-App zum Herunterladen von Videos aus der Facebook Ad Library mit Audio-Extraktion und Whisper-Transkription.

## ✨ Features

- 🎥 **Video Download** - Lade Videos in HD aus der Facebook Ad Library herunter
- 🎵 **Audio-Extraktion** - Extrahiere Audio als MP3
- 📝 **KI-Transkription** - Transkribiere Audio mit OpenAI Whisper
- 🚀 **Einfache Bedienung** - Moderne Web-Oberfläche
- ☁️ **Cloud-Ready** - Optimiert für Railway Deployment

## 🛠️ Tech Stack

- **Backend:** Node.js + Express
- **Video Download:** yt-dlp
- **Audio Processing:** FFmpeg
- **Transkription:** OpenAI Whisper API
- **Deployment:** Railway

## 🚀 Schnellstart

### Lokal entwickeln

1. **Repository klonen:**
```bash
git clone <repository-url>
cd facebook-adlibrary-downloader
```

2. **Abhängigkeiten installieren:**
```bash
npm install
```

3. **Umgebungsvariablen konfigurieren:**
```bash
cp .env.example .env
# Bearbeite .env und füge deine OPENAI_API_KEY hinzu
```

4. **yt-dlp und FFmpeg installieren:**
```bash
# macOS
brew install yt-dlp ffmpeg

# Ubuntu/Debian
sudo apt-get install yt-dlp ffmpeg

# Windows (mit chocolatey)
choco install yt-dlp ffmpeg
```

5. **Server starten:**
```bash
npm run dev
```

Die App läuft nun unter `http://localhost:3000`

### Railway Deployment (Empfohlen)

#### Option 1: GitHub Integration (Einfach)

1. **Code auf GitHub pushen:**
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/dein-username/facebook-adlibrary-downloader.git
git push -u origin main
```

2. **Railway Dashboard:**
   - Gehe zu [railway.app](https://railway.app)
   - Klicke "New Project"
   - Wähle "Deploy from GitHub repo"
   - Wähle dein Repository
   - Klicke "Add Variables" und füge `OPENAI_API_KEY` hinzu
   - Die App wird automatisch deployed!

#### Option 2: Railway CLI

1. **Railway CLI installieren:**
```bash
npm install -g @railway/cli
```

2. **Bei Railway anmelden:**
```bash
railway login
```

3. **Projekt erstellen:**
```bash
railway init
```

4. **Umgebungsvariablen setzen:**
```bash
railway variables set OPENAI_API_KEY=dein-api-key
```

5. **Deployen:**
```bash
railway up
```

#### Wichtige Railway Einstellungen

- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Health Check Path:** `/health`
- **Port:** `3000` (oder Railway wählt automatisch)

## 📖 Verwendung

1. Gehe zu [facebook.com/ads/library](https://www.facebook.com/ads/library)
2. Suche nach einem Ad und klicke darauf
3. Kopiere die URL (Format: `https://www.facebook.com/ads/library/?id=123456789`)
4. Füge die URL in die App ein
5. Klicke auf "Video verarbeiten"
6. Warte, bis Video, Audio und Transkript bereit sind

## 🔌 API Endpoints

### POST `/api/process`
Vollständige Verarbeitung (Download + Audio + Transkription)

**Request:**
```json
{
  "url": "https://www.facebook.com/ads/library/?id=123456789",
  "language": "de"
}
```

**Response:**
```json
{
  "success": true,
  "requestId": "uuid",
  "downloads": {
    "video": "/api/download/video/uuid",
    "audio": "/api/download/audio/uuid",
    "transcript": "/api/download/transcript/uuid"
  },
  "transcription": "Text..."
}
```

### POST `/api/download`
Nur Video herunterladen

### POST `/api/extract-audio/:requestId`
Audio aus Video extrahieren

### POST `/api/transcribe/:requestId`
Audio transkribieren

## 🔧 Konfiguration

| Variable | Beschreibung | Erforderlich |
|----------|--------------|--------------|
| `OPENAI_API_KEY` | OpenAI API Key für Whisper | Ja |
| `PORT` | Server Port | Nein (Default: 3000) |
| `NODE_ENV` | Umgebung | Nein |

## 📁 Projektstruktur

```
facebook-adlibrary-downloader/
├── src/
│   └── server.js          # Hauptserver
├── public/
│   └── index.html         # Frontend
├── temp/                  # Temporäre Dateien
├── package.json
├── .env.example
└── README.md
```

## ⚠️ Hinweise

- Die temporären Dateien werden automatisch nach 1 Stunde gelöscht
- Maximale Verarbeitungszeit: 3 Minuten pro Video
- Unterstützte Videoquellen: Facebook Ad Library
- Whisper unterstützt viele Sprachen (de, en, fr, es, it, pt, nl, pl, ...)

## 📝 Lizenz

MIT License

## 🤝 Beitragen

Pull Requests sind willkommen! Für größere Änderungen bitte vorher ein Issue erstellen.
