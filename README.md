# 🎨 WallMockup AI

Een luxe AI-powered wallpaper mockup generator, gebaseerd op wallmockup.com.

## 📁 Mappenstructuur

```
wall-mockup/
├── server.js          ← Node.js backend (Express + OpenAI)
├── package.json       ← Dependencies
├── .env               ← Jouw API key (al ingevuld)
└── public/
    └── index.html     ← Volledige frontend (HTML + CSS + JS)
```

## 🚀 Installatie & Starten

```bash
# 1. Ga naar de map
cd wall-mockup

# 2. Installeer dependencies
npm install

# 3. Start de server
node server.js

# 4. Open in browser
# → http://localhost:3000
```

## ✨ Features

- **AI Room Generate** — Genereer een complete kamer met jouw wallpaper via DALL-E 3
- **Upload Room Photo** — Upload een echte kamer foto, AI past jouw wallpaper toe
- **Design Types** — Repeating Pattern of Mural/Single-Piece
- **Room Types** — 13 kamertypes (woon, slaap, commercieel etc.)
- **Decoration Styles** — 12 stijlen (Modern, Art Deco, Luxury, etc.)
- **Wall Architecture** — 7 wandtypes (Corner View, Archway, etc.)
- **HD Kwaliteit** — DALL-E 3 HD generatie
- **Geschiedenis** — Automatisch opgeslagen in localStorage
- **Download** — Direct downloaden van mockups

## 🔧 API Endpoints

| Endpoint | Method | Functie |
|----------|--------|---------|
| `/api/generate-room` | POST | AI kamer genereren |
| `/api/apply-wallpaper` | POST | Wallpaper op foto toepassen |
| `/api/generate-wallpaper` | POST | Alleen wallpaper genereren |

## ⚙️ .env Configuratie

```env
OPENAI_API_KEY=jouw-key-hier
PORT=3000
```

## 💡 Tips

- Geef een gedetailleerde beschrijving van de wallpaper voor betere resultaten
- HD generatie kost ~20-30 seconden per afbeelding
- Gebruik de suggestion chips voor snelle inspiratie
