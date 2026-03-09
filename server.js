require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── HELPER: buffer → base64 data URL ──────────────────────────────────────────
function toDataURL(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// ─── ROUTE 1: AI-only room (no uploaded room photo) ────────────────────────────
app.post('/api/generate-room', async (req, res) => {
  try {
    const { wallpaperDescription, designType, roomType, decorationStyle, wallArchitecture, viewMode } = req.body;

    const prompt = `
Photorealistic interior design photo of a ${roomType || 'Living Room'}.
Decoration style: ${decorationStyle || 'Modern'}.
Wall architecture: ${wallArchitecture || 'Plain Wall'}.
The main wall is covered with this wallpaper: ${wallpaperDescription || 'elegant abstract pattern'}.
${designType === 'mural' ? 'The wallpaper is a single large mural piece.' : 'The wallpaper has a repeating seamless pattern.'}
View: ${viewMode === 'wide' ? 'wide angle showing full room' : 'styled close-up of wall detail'}.
Professional interior photography, perfect lighting, magazine quality, 8K resolution.
The wallpaper must be clearly visible and dominant on the wall — do not change the room layout.
    `.trim();

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1792x1024',
      quality: 'hd',
      style: 'natural'
    });

    res.json({ success: true, imageUrl: response.data[0].url });
  } catch (err) {
    console.error('generate-room error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── ROUTE 2: Apply wallpaper onto uploaded room photo ─────────────────────────
// This uses gpt-image-1 edit with the room as base image and a precise prompt
// to place the wallpaper onto the wall — keeping everything else identical.
app.post('/api/apply-wallpaper', upload.fields([
  { name: 'roomPhoto', maxCount: 1 },
  { name: 'wallpaperPhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { wallpaperDescription, designType, decorationStyle } = req.body;

    const roomFile = req.files?.roomPhoto?.[0];
    const wallFile = req.files?.wallpaperPhoto?.[0];

    if (!roomFile) {
      return res.status(400).json({ success: false, error: 'Room photo is required.' });
    }

    // ── Step 1: Analyze the room with GPT-4o Vision ──────────────────────────
    const roomDataURL = toDataURL(roomFile.buffer, roomFile.mimetype);

    const analysisResp = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: roomDataURL } },
          {
            type: 'text',
            text: `Analyseer deze kamer foto zorgvuldig en beschrijf precies:
1. Type kamer (woonkamer, slaapkamer, kinderkamer, etc.)
2. De GROOTSTE VLAKKE FRONTALE MUUR — kleur, afmetingen, wat erop staat
3. Alle meubels met exacte posities
4. Belichting en kleurpalet
5. Vloermateriaal
6. Camerahoek en perspectief

Identificeer de beste muur voor behang: bij voorkeur een RECHTE VLAKKE MUUR die frontaal zichtbaar is — geen schuine hoekweergaves.
Wees zeer precies zodat ik exact dezelfde kamer kan nabootsen.`
          }
        ]
      }],
      max_tokens: 800
    });

    const roomDesc = analysisResp.choices[0].message.content;

    // ── Step 2: Build the edit prompt ────────────────────────────────────────
    let wallpaperVisual = wallpaperDescription || 'elegant decorative wallpaper pattern';

    if (wallFile) {
      const wallDataURL = toDataURL(wallFile.buffer, wallFile.mimetype);
      const wallAnalysis = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: wallDataURL } },
            {
              type: 'text',
              text: 'Beschrijf dit behang ontwerp in extreme detail: de exacte kleuren, het patroon, motieven, stijl, textuur, herhaalstructuur. Wees zeer specifiek zodat het exact gereproduceerd kan worden.'
            }
          ]
        }],
        max_tokens: 500
      });
      wallpaperVisual = wallAnalysis.choices[0].message.content;
    }

    // ── Step 3: Generate the final image ─────────────────────────────────────
    const finalPrompt = `
Photorealistic interior room photo.

ROOM (keep 100% identical):
${roomDesc}

WALL CHANGE — THIS IS THE ONLY THING THAT CHANGES:
The main wall must be shown as a FLAT, STRAIGHT, RECTANGULAR wall viewed from the FRONT.
NO diagonal angles, NO corner views, NO triangular perspective cuts.
The wall must fill a large portion of the image as a perfect rectangle.

Cover this flat rectangular wall COMPLETELY with the following wallpaper:
${wallpaperVisual}
${designType === 'mural' ? 'Applied as one single full-wall mural — the entire pattern is 100% visible.' : 'Applied as a seamlessly repeating pattern — the full pattern is 100% visible across the entire wall.'}

CRITICAL:
- The wallpaper must be 100% visible, fully covering the wall from edge to edge
- No partial views, no cut-off patterns, no diagonal cuts
- The wall is shown straight/frontal — flat rectangle, not angled
- Keep all furniture, floor, ceiling, lighting IDENTICAL
- Professional interior photography, perfect lighting
    `.trim();

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: finalPrompt,
      n: 1,
      size: '1792x1024',
      quality: 'hd',
      style: 'natural'
    });

    res.json({
      success: true,
      imageUrl: response.data[0].url,
      roomAnalysis: roomDesc,
      wallpaperAnalysis: wallpaperVisual
    });

  } catch (err) {
    console.error('apply-wallpaper error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎨 WallMockup AI → http://localhost:${PORT}\n`);
});
