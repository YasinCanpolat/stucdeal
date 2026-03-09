require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const OpenAI  = require('openai');
const path    = require('path');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

console.log(process.env.OPENAI_API_KEY);

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

// ─── HELPER ────────────────────────────────────────────────
function toDataURL(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// ═══════════════════════════════════════════════════════════
// ROUTE 1 — AI kamer genereren (geen eigen kamer foto nodig)
// ═══════════════════════════════════════════════════════════
app.post('/api/generate-room', upload.fields([
  { name: 'wallpaperPhoto', maxCount: 1 }
]), async (req, res) => {
  try {
    const { wallpaperDescription, designType, roomType, decorationStyle, wallArchitecture, viewMode } = req.body;
    const wallFile = req.files?.wallpaperPhoto?.[0];

    let wallDesc = wallpaperDescription || '';

    // Analyseer behang foto als die er is
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
              text: `Beschrijf dit behang/afbeelding in EXTREME detail voor een AI image generator.
Beschrijf: alle kleuren exact, het patroon, de motieven, stijl, compositie, textuur, achtergrondkleur.
Wees ZO specifiek dat de AI exact hetzelfde op een muur kan nabootsen. Alleen de beschrijving, geen inleiding.`
            }
          ]
        }],
        max_tokens: 600
      });
      wallDesc = analyse.choices[0].message.content;
    }

    const prompt = `
Professionele interieur fotografie van een ${roomType || 'woonkamer'}.
Decoratiestijl: ${decorationStyle || 'Modern'}.
Wandarchitectuur: ${wallArchitecture || 'Rechte vlakke muur'}.

De HOOFDMUUR is volledig bedekt met dit behang (100% zichtbaar, vlak, rechthoekig van voren gezien):
${wallDesc || 'elegant decoratief herhalend patroon'}

${designType === 'mural'
  ? 'Het behang is één grote muurprint — het volledige beeld is zichtbaar van rand tot rand.'
  : 'Het behang is een herhalend naadloos patroon dat de hele muur bedekt.'}

Weergave: ${viewMode === 'wide' ? 'groothoek totaaloverzicht van de kamer' : 'gestileerde close-up van de muur'}.

VERPLICHT: de muur is PLAT en FRONTAAL zichtbaar — GEEN diagonale hoeken of driehoekige perspectiefvervormingen.
Het behang bedekt de muur van rand tot rand, 100% zichtbaar. Fotorealistisch, magazine kwaliteit.
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
    console.error('generate-room fout:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// ROUTE 2 — Behang op jouw eigen kamer foto plaatsen
//
// AANPAK (3 stappen):
// 1. GPT-4o analyseert de kamer foto → gedetailleerde beschrijving
// 2. GPT-4o analyseert de behang foto → pixel-perfecte beschrijving
// 3. DALL-E 3 genereert de kamer opnieuw met jouw behang op de muur
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

    const roomDataURL = toDataURL(roomFile.buffer, roomFile.mimetype);

    // ── STAP 1: Kamer analyseren ──────────────────────────
    const kamerAnalyse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: roomDataURL } },
          {
            type: 'text',
            text: `Analyseer deze kamer foto HEEL precies. Geef een gedetailleerde beschrijving van:

1. KAMER TYPE (woonkamer, slaapkamer, kinderkamer, etc.)
2. VLOER — materiaal, kleur, patroon
3. PLAFOND — hoogte, kleur, verlichting
4. ALLE MEUBELS — elk meubel, exacte positie, kleur, materiaal
5. RAMEN & DEUREN — positie en grootte
6. BELICHTING — lichtbronnen, sfeer, schaduwen
7. KLEURPALET — welke kleuren domineren
8. CAMERAHOEK — van welke positie is gefotografeerd
9. DE HOOFDMUUR — kleur, oppervlak, wat erop staat

Wees UITERST gedetailleerd — ik wil exact dezelfde kamer nabootsen maar met ander behang op de hoofdmuur.`
          }
        ]
      }],
      max_tokens: 1000
    });

    const kamerbeschrijving = kamerAnalyse.choices[0].message.content;

    // ── STAP 2: Behang analyseren ─────────────────────────
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
              text: `Dit is een afbeelding/behang die iemand op zijn muur wil hebben als muurbehang.

Beschrijf dit UITERST gedetailleerd zodat een AI image generator het EXACT kan reproduceren op een muur:

- WAT IS ER TE ZIEN? Beschrijf elk element, figuur, object (bijv: "een grote tijger die van links naar rechts loopt, fotorealistisch")
- EXACTE KLEUREN — gebruik precieze kleurbenamingen (bijv: "oranje en zwarte strepen op een tijger, bruine aarden achtergrond")
- ACHTERGROND — kleur en textuur
- STIJL — fotorealistisch / illustratie / abstract / aquarel / etc.
- COMPOSITIE — hoe zijn de elementen verdeeld? Centrum? Links/rechts?
- PATROON — herhaalt het zich of is het één enkel beeld?

Beschrijf zo gedetailleerd dat de AI generator EXACT dit beeld op de muur maakt.`
            }
          ]
        }],
        max_tokens: 800
      });

      behangBeschrijving = behangAnalyse.choices[0].message.content;
    }

    // ── STAP 3: Uiteindelijke kamer genereren ─────────────
    const eindPrompt = `
FOTOREALISTISCH INTERIEUR — PROFESSIONELE INTERIEUR FOTOGRAFIE

REPRODUCEER EXACT DEZE KAMER (alles blijft hetzelfde):
${kamerbeschrijving}

═════════════════════════════════════════════
HET ENIGE DAT VERANDERT: DE HOOFDMUUR
═════════════════════════════════════════════

BEHANG DAT OP DE MUUR MOET KOMEN:
${behangBeschrijving || 'elegant decoratief patroon'}

REGELS VOOR HET BEHANG OP DE MUUR:
1. Het behang bedekt de hoofdmuur VOLLEDIG van rand tot rand, van vloer tot plafond
2. De muur is RECHT en FRONTAAL zichtbaar als een PERFECT RECHTHOEKIG VLAK
3. GEEN diagonale hoeken, GEEN driehoekige perspectiefvervormingen, GEEN schuine weergave
4. Het behang is 100% zichtbaar — het volledige patroon/beeld is te zien
5. ${designType === 'mural'
  ? 'Het is een grote MUURPRINT — één enkel beeld dat de hele muur vult, volledig zichtbaar'
  : 'Het is een HERHALEND PATROON dat naadloos de hele muur bedekt'}
6. Correcte belichting: het behang heeft dezelfde lichtinval als de rest van de kamer
7. Fotorealistisch — het ziet eruit als echt aangebracht muurbehang

WAT GELIJK BLIJFT:
- Alle meubels (zelfde positie, kleur, materiaal)
- Vloer (zelfde materiaal en kleur)
- Plafond (zelfde kleur en verlichting)
- Ramen en deuren (zelfde positie)
- Algemene belichting en sfeer van de kamer

KWALITEIT: Ultra-fotorealistisch, professionele interieur fotografie, 8K kwaliteit.
    `.trim();

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: eindPrompt,
      n: 1,
      size: '1792x1024',
      quality: 'hd',
      style: 'natural'
    });

    res.json({
      success: true,
      imageUrl: response.data[0].url
    });

  } catch (err) {
    console.error('apply-wallpaper fout:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🎨 WallMockup AI draait op → http://localhost:${PORT}\n`);
});
