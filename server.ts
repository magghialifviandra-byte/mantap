import { GoogleGenAI, Type } from '@google/genai';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_CLASSES = new Set(['hokkaido', 'saitama', 'nara', 'kaigo', 'all']);
const ALLOWED_CATEGORIES = new Set([
  'kana',
  'vocab',
  'kanji',
  'grammar',
  'reading',
  'conversation',
  'kaigo',
  'jlpt_jft',
]);
const ALLOWED_PEDAGOGICAL_TYPES = new Set([
  'multiple_choice',
  'fill_blank',
  'sentence_completion',
  'sentence_arrangement',
  'kanji_reading',
  'reading_comprehension',
]);

function clampStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function stripFuriganaNotation(text: string): string {
  return text.replace(/\[[^\]]+\]/g, '');
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY belum dikonfigurasi di server. Periksa panel Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/vocab/translate', async (req: Request, res: Response) => {
    try {
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      if (rawItems.length === 0) {
        res.status(400).json({ error: 'Minimal 1 kosakata harus dikirim untuk diterjemahkan.' });
        return;
      }

      const items = rawItems.slice(0, 30).map((it: Record<string, unknown>) => ({
        id: clampStr(it.id, 40),
        word: clampStr(it.word, 80),
        reading: clampStr(it.reading, 80),
        pos: Array.isArray(it.pos) ? it.pos.slice(0, 3).map((p) => clampStr(p, 30)) : [],
        meaningEn: Array.isArray(it.meaningEn)
          ? it.meaningEn.slice(0, 4).map((m) => clampStr(m, 120))
          : [],
      }));

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          'Translate each Japanese vocabulary item into natural, accurate Bahasa Indonesia for Indonesian students studying Japanese for JLPT / Tokutei Ginou.',
          'Use part-of-speech (`pos`) and English glosses (`meaningEn`) for contextual disambiguation so homonyms and nuances are exact.',
          'Return 1-3 Indonesian meanings (`meaningId`) plus a brief Indonesian usage note (`noteId`, max 120 chars, e.g. nuance or example collocation).',
          JSON.stringify(items),
        ].join('\n\n'),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                meaningId: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                noteId: { type: Type.STRING },
              },
              required: ['id', 'meaningId', 'noteId'],
            },
          },
        },
      });

      const rawText = (response.text ?? '[]').trim();
      const parsed = JSON.parse(rawText);
      const translations = Array.isArray(parsed)
        ? parsed.map((row: Record<string, unknown>) => ({
            id: clampStr(row.id, 40),
            meaningId: Array.isArray(row.meaningId)
              ? row.meaningId
                  .map((s) => clampStr(s, 120))
                  .filter(Boolean)
                  .slice(0, 5)
              : [],
            noteId: clampStr(row.noteId, 200),
          }))
        : [];

      res.json({ translations });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses terjemahan Gemini.';
      const status = msg.includes('GEMINI_API_KEY') ? 503 : 500;
      res.status(status).json({ error: msg });
    }
  });

  app.post('/api/questions/generate', async (req: Request, res: Response) => {
    try {
      const program = clampStr(req.body?.program, 30);
      const chapterNumber =
        typeof req.body?.chapterNumber === 'number' ? req.body.chapterNumber : undefined;
      const topic = clampStr(req.body?.topic, 160);
      const chapterGroup = clampStr(req.body?.chapterGroup, 100) || 'Umum / 一般';
      const classId = ALLOWED_CLASSES.has(req.body?.classId) ? String(req.body.classId) : 'all';
      const testType = req.body?.testType === 'weekly' ? 'weekly' : 'daily';
      const count = Math.min(Math.max(Number(req.body?.count) || 5, 1), 15);
      const allowFuriganaOnCore = Boolean(req.body?.allowFurigana);

      const rawTypes: string[] = Array.isArray(req.body?.pedagogicalTypes)
        ? req.body.pedagogicalTypes.map((t: unknown) => clampStr(t, 40))
        : ['multiple_choice'];

      if (rawTypes.some((t) => t.includes('listening') || t.includes('choukai'))) {
        res.status(400).json({ error: 'Pembuatan soal Choukai / listening dilarang oleh kebijakan.' });
        return;
      }

      const pedagogicalTypes = rawTypes.filter((t) => ALLOWED_PEDAGOGICAL_TYPES.has(t));
      if (pedagogicalTypes.length === 0) {
        pedagogicalTypes.push('multiple_choice');
      }

      const seedWords = Array.isArray(req.body?.words)
        ? req.body.words.slice(0, 25).map((w: Record<string, unknown>) => ({
            id: clampStr(w.id, 40),
            word: clampStr(w.word, 60),
            reading: clampStr(w.reading, 60),
            meaning: clampStr(w.meaning, 140),
            pos: clampStr(w.pos, 40),
            jlpt: clampStr(w.jlpt, 10),
          }))
        : [];

      const mustIncludeFurigana = program === 'minna_1_50';
      const mustForbidFurigana = program === 'jlpt_n4' || program === 'jft_basic_a2';
      const effectiveFurigana = mustIncludeFurigana
        ? true
        : mustForbidFurigana
        ? false
        : allowFuriganaOnCore;

      const programDirectives =
        program === 'minna_1_50'
          ? `Program: Minna no Nihongo Bab ${chapterNumber || 1}. Wajib gunakan tata bahasa & kosakata yang sesuai tepat untuk Bab ${chapterNumber || 1} Minna no Nihongo. WAJIB sertakan furigana inline dengan format 漢字[ふりがな] pada kata berkanji dalam soal (KECUALI pada soal tipe kanji_reading untuk kanji yang sedang diuji). WAJIB sertakan terjemahan Bahasa Indonesia pada penjelasan.`
          : program === 'jlpt_n4'
          ? 'Program: JLPT N4. DILARANG KERAS menampilkan furigana atau tanda bacaan [ふりがな] dalam soal maupun pilihan jawaban (uji bacaan N4 secara otentik).'
          : program === 'jft_basic_a2'
          ? 'Program: JFT-Basic A2 (situasi kehidupan & kerja di Jepang). DILARANG KERAS menampilkan furigana atau tanda [ふりがな] dalam soal maupun pilihan jawaban.'
          : `Program: Kosakata Inti JLPT. ${effectiveFurigana ? 'Sertakan furigana format 漢字[ふりがな] kecuali pada soal kanji_reading.' : 'Jangan sertakan furigana dalam soal.'}`;

      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          'Anda adalah penyusun soal ujian bahasa Jepang profesional untuk siswa Indonesia di sekolah bahasa Jepang (Genki Academy).',
          `Buat tepat ${count} soal ujian berkualitas tinggi (JANGAN pernah membuat soal Choukai / audio / mendengarkan).`,
          programDirectives,
          topic ? `Topik / Fokus Materi: ${topic}` : '',
          `Tipe soal yang diminta (distribusikan merata): ${pedagogicalTypes.join(', ')}.`,
          'Panduan tipe soal:',
          '- multiple_choice: Pilihan ganda kosakata/makna/konteks kalimat (4 opsi).',
          '- fill_blank: Isian bagian kosong （　　） dengan partikel atau kata tepat.',
          '- sentence_completion: Melengkapi dialog/kalimat agar bermakna wajar.',
          '- sentence_arrangement: Susun urutan kata model JLPT (＿＿ ＿＿ ★ ＿＿) dan tentukan kata yang menempati posisi ★.',
          '- kanji_reading: Menentukan cara baca hiragana dari kata berkanji yang digarisbawahi 「〜」 (4 opsi hiragana, jangan beri furigana pada kata target!).',
          '- reading_comprehension: Paragraf bacaan singkat (3-5 kalimat) diikuti 1 pertanyaan pemahaman.',
          seedWords.length > 0
            ? `Gunakan kosakata berikut sebagai acuan utama:\n${JSON.stringify(seedWords)}`
            : '',
          'Setiap soal wajib memuat: prompt (max 900 karakter), questionFormat ("multiple_choice" atau "written"), options (array tepat 4 opsi untuk multiple_choice tanpa prefix A./B. karena UI/lembar cetak akan menomori A/B/C/D, atau [] untuk written), correctAnswer (harus sama persis dengan salah satu isi options jika multiple_choice, max 250 karakter), explanation (penjelasan & terjemahan bahasa Indonesia, max 450 karakter), category ("vocab"|"kanji"|"grammar"|"reading"|"conversation"|"jlpt_jft"), pedagogicalType, points (1-5).',
        ]
          .filter(Boolean)
          .join('\n\n'),
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                pedagogicalType: { type: Type.STRING },
                category: { type: Type.STRING },
                questionFormat: { type: Type.STRING },
                prompt: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctAnswer: { type: Type.STRING },
                explanation: { type: Type.STRING },
                points: { type: Type.INTEGER },
                sourceVocabId: { type: Type.STRING },
              },
              required: [
                'pedagogicalType',
                'category',
                'questionFormat',
                'prompt',
                'options',
                'correctAnswer',
                'explanation',
                'points',
              ],
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '[]').trim());
      if (!Array.isArray(parsed)) {
        res.status(500).json({ error: 'Respons Gemini bukan array soal yang valid.' });
        return;
      }

      const staged = parsed.slice(0, 20).map((item: Record<string, unknown>, idx: number) => {
        const rawPed = clampStr(item.pedagogicalType, 40);
        const pedagogicalType = ALLOWED_PEDAGOGICAL_TYPES.has(rawPed)
          ? rawPed
          : pedagogicalTypes[0];

        const rawCat = clampStr(item.category, 30);
        const category = ALLOWED_CATEGORIES.has(rawCat) ? rawCat : 'vocab';

        let prompt = clampStr(item.prompt, 950);
        let options = Array.isArray(item.options)
          ? item.options
              .map((o) => clampStr(o, 190))
              .filter(Boolean)
              .slice(0, 6)
          : [];
        let correctAnswer = clampStr(item.correctAnswer, 280);
        let explanation = clampStr(item.explanation, 480);

        if (mustForbidFurigana) {
          prompt = stripFuriganaNotation(prompt);
          options = options.map(stripFuriganaNotation);
          correctAnswer = stripFuriganaNotation(correctAnswer);
        }

        const questionFormat =
          item.questionFormat === 'written' || options.length < 2 ? 'written' : 'multiple_choice';

        if (questionFormat === 'written') {
          options = [];
        }

        const pointsNum = typeof item.points === 'number' ? Math.round(item.points) : 1;

        return {
          tempId: `ai_${Date.now()}_${idx}`,
          selected: true,
          classId,
          category,
          testType,
          questionFormat,
          pedagogicalType,
          program: program || 'jlpt_core',
          chapterGroup,
          prompt: prompt || '（問題文）',
          options,
          correctAnswer: correctAnswer || options[0] || '—',
          explanation,
          points: Math.min(Math.max(pointsNum, 1), 100),
          hasFurigana: effectiveFurigana && pedagogicalType !== 'kanji_reading',
          sourceVocabId: clampStr(item.sourceVocabId, 40) || undefined,
        };
      });

      res.json({ questions: staged });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal membuat soal dengan Gemini.';
      const status = msg.includes('GEMINI_API_KEY') ? 503 : 500;
      res.status(status).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
