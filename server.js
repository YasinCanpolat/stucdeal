require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const OpenAI  = require('openai');
const { toFile } = require('openai');
const path    = require('path');
const cors    = require('cors');
const sharp   = require('sharp');
const { Blob } = require('buffer');

const app  = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function toDataURL(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// Convert buffer → vierkante PNG van exact 1024x1024 (dall-e-2 edit vereist dit)
async function toSquarePngFile(buffer, filename) {
  const pngBuffer = await sharp(buffer)
    .resize(1024, 1024, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const blob = new Blob([pngBuffer], { type: 'image/png' });
  return await toFile(blob, filename, { type: 'image/png' });
}

// ═══════════════════════════════════════════════════════════
// ROUTE 1 — Behang op jouw eigen kamer plaatsen
//
// Gebruikt dall-e-2 images.edit() — enige API die een foto
// als input accepteert en aanpast
// ═══════════════════════════════════════════════════════════
app.post('/api/apply-wallpaper', upload.fields([
  { name: 'roomPhoto',      maxCount: 1 },
  { name: 'wallpaperPhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { wallpaperDescription, designType } = req.body;
    const roomFile = req.files?.roomPhoto?.[0];
    const wallFile = req.files?.wallpaperPhoto?.[0];

    if (!roomFile) {
      return res.status(400).json({ success: false, error: 'Kamer foto is verplicht.' });
    }

    // ── STAP 1: Analyseer de kamer ──────────────────────────
    const roomDataURL = toDataURL(roomFile.buffer, roomFile.mimetype);
    const kamerAnalyse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: roomDataURL } },
          {
            type: 'text',
            text: `Analyseer deze kamer HEEL precies. Beschrijf:
1. Kamer type
2. Vloer (materiaal, kleur)
3. Plafond (hoogte, kleur, verlichting)
4. Alle meubels (positie, kleur, materiaal)
5. Ramen & deuren
6. Belichting & sfeer
7. Camerahoek
8. De hoofdmuur (kleur, oppervlak)
Wees UITERST gedetailleerd — ik wil exact dezelfde kamer maar met ander behang op de hoofdmuur.`
          }
        ]
      }],
      max_tokens: 1000
    });
    const kamerbeschrijving = kamerAnalyse.choices[0].message.content;

    // ── STAP 2: Analyseer het behang ────────────────────────
    let behangBeschrijving = wallpaperDescription || '';

    if (wallFile) {
      const wallDataURL = toDataURL(wallFile.buffer, wallFile.mimetype);
      const behangAnalyse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: wallDataURL } },
            {
              type: 'text',
              text: `Beschrijf dit behang/afbeelding UITERST gedetailleerd voor een AI image editor.
- WAT staat er precies op (elk element, figuur, object)
- EXACTE kleuren van elk element
- Achtergrondkleur en -textuur
- Stijl (fotorealistisch / illustratie / abstract / etc.)
- Compositie en plaatsing van elementen
- Of het een herhalend patroon is of één enkel beeld`
            }
          ]
        }],
        max_tokens: 800
      });
      behangBeschrijving = behangAnalyse.choices[0].message.content;
    }

    // ── STAP 3: dall-e-2 edit met kamer foto als input ──────
    const editPrompt = `
Exact same room, only change the main wall: cover it completely with this wallpaper/mural:
${behangBeschrijving || wallpaperDescription || 'elegant decorative pattern'}

Rules:
- Wallpaper covers the main wall 100% from edge to edge, floor to ceiling
- ${designType === 'mural' ? 'Single large mural image filling the entire wall' : 'Repeating seamless pattern covering the whole wall'}
- ALL furniture, floor, ceiling, windows, doors and lighting stay EXACTLY the same
- Photorealistic result, correct lighting and shadows
- Room: ${kamerbeschrijving.substring(0, 400)}
    `.trim().substring(0, 1000); // dall-e-2 prompt max 1000 chars

    const roomPng = await toSquarePngFile(roomFile.buffer, 'room.png');

    const response = await openai.images.edit({
      model: 'dall-e-2',
      image: roomPng,
      prompt: editPrompt,
      n: 1,
      size: '1024x1024',
    });

    const imageUrl = response.data[0].url;
    res.json({ success: true, imageUrl });

  } catch (err) {
    console.error('apply-wallpaper fout:', err?.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ROUTE 2 — AI kamer genereren (geen eigen kamer foto nodig)
// Gebruikt gpt-image-1 generate — beste kwaliteit voor generatie
// ═══════════════════════════════════════════════════════════
app.post('/api/generate-room', upload.fields([
  { name: 'wallpaperPhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { wallpaperDescription, designType, roomType, decorationStyle, wallArchitecture, viewMode } = req.body;
    const wallFile = req.files?.wallpaperPhoto?.[0];

    let wallDesc = wallpaperDescription || '';

    if (wallFile) {
      const wallDataURL = toDataURL(wallFile.buffer, wallFile.mimetype);
      const analyse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: wallDataURL } },
            {
              type: 'text',
              text: `Beschrijf dit behang in EXTREME detail voor AI image generator.
Alle kleuren exact, patroon, motieven, stijl, compositie, textuur, achtergrond.
Alleen de beschrijving, geen inleiding.`
            }
          ]
        }],
        max_tokens: 600
      });
      wallDesc = analyse.choices[0].message.content;
    }

    const prompt = `
Professional interior photography of a ${roomType || 'living room'}.
Decoration style: ${decorationStyle || 'Modern'}.
Wall architecture: ${wallArchitecture || 'flat wall'}.

The MAIN WALL is completely covered with this wallpaper:
${wallDesc || 'elegant decorative repeating pattern'}

${designType === 'mural'
  ? 'Single large mural print filling the entire wall, fully visible edge to edge.'
  : 'Seamless repeating pattern covering the entire wall.'}

View: ${viewMode === 'wide' ? 'wide angle full room overview' : 'styled close-up of the wall'}.
Photorealistic, magazine quality, professional lighting.
    `.trim();

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1536x1024',
      quality: 'high',
    });

    const imageData = response.data[0];
    const imageUrl = imageData.b64_json
      ? `data:image/png;base64,${imageData.b64_json}`
      : imageData.url;

    res.json({ success: true, imageUrl });

  } catch (err) {
    console.error('generate-room fout:', err?.message || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Bestand is te groot. Upload een kleinere afbeelding.'
      });
    }

    return res.status(400).json({
      success: false,
      error: `Upload fout: ${err.message}`
    });
  }

  next(err);
});

app.listen(PORT, () => {
  console.log(`\n🎨 WallMockup AI draait op → http://localhost:${PORT}\n`);
});
