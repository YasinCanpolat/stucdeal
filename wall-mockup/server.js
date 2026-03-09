const dotenv = require('dotenv').config();
const express = require('express');
const multer = require('multer');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Multer for file uploads (in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── AI ROOM GENERATE ──────────────────────────────────────────────────────────
app.post('/api/generate-room', async (req, res) => {
  try {
    const {
      wallpaperDescription,
      designType,
      roomType,
      decorationStyle,
      wallArchitecture,
      viewMode,
      resolution
    } = req.body;

    const sizeMap = { '2K': '1792x1024', '4K': '1792x1024' };
    const size = sizeMap[resolution] || '1792x1024';

    const prompt = `
A stunning, photorealistic interior design mockup of a ${roomType || 'Living Room'} with ${decorationStyle || 'modern harmonious'} decoration style.
The room has a ${wallArchitecture || 'plain wall'} with a beautiful wallpaper design showing: ${wallpaperDescription || 'elegant abstract pattern'}.
View: ${viewMode === 'wide' ? 'wide angle room and space view' : 'styled close-up product-focused composition'}.
The wallpaper is prominently displayed on the wall, showing its full pattern.
Photorealistic, professional interior photography, luxury ${decorationStyle} aesthetic, perfect lighting, 8K quality, magazine worthy.
Design type: ${designType === 'repeating' ? 'repeating pattern wallpaper' : 'full mural single-piece design'}.
    `.trim();

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: size === '1792x1024' ? '1792x1024' : '1024x1024',
      quality: 'hd',
      style: 'natural'
    });

    res.json({ success: true, imageUrl: response.data[0].url, revisedPrompt: response.data[0].revised_prompt });
  } catch (err) {
    console.error('Generate room error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── UPLOAD ROOM + APPLY WALLPAPER ─────────────────────────────────────────────
app.post('/api/apply-wallpaper', upload.single('roomPhoto'), async (req, res) => {
  try {
    const { wallpaperDescription, designType, decorationStyle } = req.body;

    if (!req.file) return res.status(400).json({ success: false, error: 'No room photo uploaded' });

    // Convert uploaded image to base64
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Use GPT-4 Vision to analyze the room, then generate a new version
    const analysisResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageBase64}` }
            },
            {
              type: 'text',
              text: `Analyze this room photo and describe: the room type, wall color, furniture style, lighting conditions, and camera angle. Be very specific and concise. Also identify the main wall where wallpaper could be applied.`
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const roomAnalysis = analysisResponse.choices[0].message.content;

    // Now generate a new room image with the wallpaper applied
    const prompt = `
A photorealistic interior room scene based on this description: ${roomAnalysis}
The main wall now features a beautiful wallpaper showing: ${wallpaperDescription || 'elegant decorative pattern'}.
Design: ${designType === 'repeating' ? 'repeating pattern' : 'full mural'}.
Style: ${decorationStyle || 'harmonious modern'}.
The wallpaper is perfectly applied to the wall, photorealistic, professional interior photography, perfect lighting.
    `.trim();

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1792x1024',
      quality: 'hd',
      style: 'natural'
    });

    res.json({ success: true, imageUrl: response.data[0].url, roomAnalysis });
  } catch (err) {
    console.error('Apply wallpaper error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GENERATE WALLPAPER ONLY ────────────────────────────────────────────────────
app.post('/api/generate-wallpaper', async (req, res) => {
  try {
    const { description, designType, style } = req.body;

    const prompt = designType === 'repeating'
      ? `A seamlessly tileable wallpaper pattern: ${description}. Style: ${style || 'modern'}. Perfect seamless repeat pattern, high detail, professional textile design, flat lay view.`
      : `A full mural wallpaper design: ${description}. Style: ${style || 'modern'}. Full panoramic mural, artistic, high detail, professional wall art design.`;

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
    console.error('Generate wallpaper error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎨 WallMockup AI running at http://localhost:${PORT}\n`);
});
