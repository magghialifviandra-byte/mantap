#!/usr/bin/env node
/**
 * Build static read-only JLPT N5-N1 Core Vocabulary Reference JSON files
 * from the 8,029 unique JMDict IDs in aehlke/jlpt-classifier and JMDict Simplified.
 *
 * Usage:
 *   node scripts/build-jlpt-vocab.mjs [--csv-dir /tmp/jlpt-classifier] [--translate]
 *
 * When --translate and GEMINI_API_KEY are supplied, also populates contextual
 * Indonesian glosses (`meaningId`) using @google/genai.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'public', 'data', 'vocab');
const CACHE_DIR = '/tmp/jmdict-cache';
const JMDICT_URL =
  'https://github.com/scriptin/jmdict-simplified/releases/download/3.3.1%2B20230206121907/jmdict-eng-3.3.1+20230206121907.json.zip';

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const CSV_DIR = getArg('--csv-dir', '/tmp/jlpt-classifier');
const SHOULD_TRANSLATE = args.includes('--translate') && Boolean(process.env.GEMINI_API_KEY);

const LEVELS = [
  { key: 'N5', file: 'jlpt-n5.csv', out: 'jlpt-n5.json' },
  { key: 'N4', file: 'jlpt-n4.csv', out: 'jlpt-n4.json' },
  { key: 'N3', file: 'jlpt-n3.csv', out: 'jlpt-n3.json' },
  { key: 'N2', file: 'jlpt-n2.csv', out: 'jlpt-n2.json' },
  { key: 'N1', file: 'jlpt-n1.csv', out: 'jlpt-n1.json' },
];

function normalizePos(rawPosList) {
  const tags = new Set();
  for (const tag of rawPosList || []) {
    if (tag === 'n' || tag === 'n-adv' || tag === 'n-suf' || tag === 'n-pref' || tag === 'n-t') {
      tags.add('noun');
    } else if (tag === 'vs' || tag === 'vs-s' || tag === 'vs-i') {
      tags.add('verb-suru');
    } else if (tag === 'v1' || tag === 'v1-s') {
      tags.add('verb-ichidan');
    } else if (tag.startsWith('v5')) {
      tags.add('verb-godan');
    } else if (tag === 'vk' || tag.startsWith('v-')) {
      tags.add('verb');
    } else if (tag === 'adj-i' || tag === 'adj-ix') {
      tags.add('adj-i');
    } else if (tag === 'adj-na') {
      tags.add('adj-na');
    } else if (tag.startsWith('adj-')) {
      tags.add('adj');
    } else if (tag === 'adv' || tag === 'adv-to') {
      tags.add('adv');
    } else if (tag === 'conj') {
      tags.add('conj');
    } else if (tag === 'prt') {
      tags.add('particle');
    } else if (tag === 'exp') {
      tags.add('expr');
    } else if (tag === 'int') {
      tags.add('interj');
    } else if (tag === 'pn') {
      tags.add('pronoun');
    } else if (tag === 'num') {
      tags.add('number');
    } else if (tag === 'ctr') {
      tags.add('counter');
    } else if (tag === 'pref' || tag === 'suf') {
      tags.add('affix');
    } else if (tag === 'aux-v' || tag === 'aux-adj' || tag === 'aux') {
      tags.add('aux');
    }
  }
  if (tags.size === 0 && Array.isArray(rawPosList) && rawPosList.length > 0) {
    tags.add(rawPosList[0]);
  }
  return Array.from(tags).slice(0, 3);
}

async function ensureJmdictJson() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const zipPath = path.join(CACHE_DIR, 'jmdict-eng.zip');
  const jsonPath = path.join(CACHE_DIR, 'jmdict-eng.json');

  if (fs.existsSync(jsonPath)) {
    console.log(`Using cached JMDict JSON: ${jsonPath}`);
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  }

  if (!fs.existsSync(zipPath)) {
    console.log(`Downloading JMDict Simplified from ${JMDICT_URL}...`);
    const res = await fetch(JMDICT_URL);
    if (!res.ok) {
      throw new Error(`Failed to download JMDict (${res.status} ${res.statusText})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(zipPath, buf);
    console.log(`Downloaded ${(buf.length / (1024 * 1024)).toFixed(1)} MB.`);
  }

  console.log('Extracting JMDict ZIP via JSZip...');
  const zipData = fs.readFileSync(zipPath);
  const zip = await JSZip.loadAsync(zipData);
  const entryName = Object.keys(zip.files).find((k) => k.endsWith('.json'));
  if (!entryName) {
    throw new Error('No JSON file found inside JMDict ZIP archive');
  }
  const rawJsonStr = await zip.files[entryName].async('string');
  fs.writeFileSync(jsonPath, rawJsonStr);
  return JSON.parse(rawJsonStr);
}

function readLevelIds() {
  const seen = new Set();
  const byLevel = new Map();
  for (const lvl of LEVELS) {
    const csvPath = path.join(CSV_DIR, lvl.file);
    if (!fs.existsSync(csvPath)) {
      throw new Error(`Missing CSV file: ${csvPath}`);
    }
    const lines = fs
      .readFileSync(csvPath, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));

    const ids = [];
    for (const id of lines) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    byLevel.set(lvl.key, ids);
  }
  return { byLevel, totalUnique: seen.size };
}

async function translateBatchWithGemini(ai, Type, items) {
  const promptPayload = items.map((it) => ({
    id: it.id,
    word: it.word,
    reading: it.reading,
    pos: it.pos.join(', '),
    meaningEn: it.meaningEn.join('; '),
  }));

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      'Translate each Japanese JLPT vocabulary word into natural, accurate Bahasa Indonesia for Indonesian learners preparing for JLPT/SSW in Japan.',
      'Use `pos` and `meaningEn` to disambiguate homonyms (for example kata kerja vs kata benda). Provide 1 to 3 concise Indonesian equivalents per entry.',
      JSON.stringify(promptPayload),
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
          },
          required: ['id', 'meaningId'],
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '[]').trim());
  const map = new Map();
  for (const row of parsed) {
    if (row && row.id && Array.isArray(row.meaningId)) {
      map.set(
        String(row.id),
        row.meaningId.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
      );
    }
  }
  return map;
}

async function main() {
  const { byLevel, totalUnique } = readLevelIds();
  console.log(`Loaded ${totalUnique} unique JLPT IDs across N5-N1.`);

  const jmdict = await ensureJmdictJson();
  const words = Array.isArray(jmdict.words) ? jmdict.words : [];
  console.log(`Indexing ${words.length} JMDict entries...`);

  const neededIds = new Set();
  for (const ids of byLevel.values()) {
    for (const id of ids) neededIds.add(id);
  }

  const wordMap = new Map();
  for (const w of words) {
    if (neededIds.has(String(w.id))) {
      wordMap.set(String(w.id), w);
    }
  }
  console.log(`Matched ${wordMap.size} / ${neededIds.size} entries in JMDict.`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let ai = null;
  let TypeEnum = null;
  if (SHOULD_TRANSLATE) {
    const genai = await import('@google/genai');
    ai = new genai.GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
    TypeEnum = genai.Type;
  }

  const manifestCounts = {};
  let missingCount = 0;

  for (const lvl of LEVELS) {
    const ids = byLevel.get(lvl.key) || [];
    const entries = [];

    for (const id of ids) {
      const raw = wordMap.get(id);
      if (!raw) {
        missingCount += 1;
        continue;
      }
      const kanjiArr = Array.isArray(raw.kanji) ? raw.kanji : [];
      const kanaArr = Array.isArray(raw.kana) ? raw.kana : [];
      const senseArr = Array.isArray(raw.sense) ? raw.sense : [];

      const commonKanji = kanjiArr.find((k) => k.common)?.text || kanjiArr[0]?.text || '';
      const commonKana = kanaArr.find((k) => k.common)?.text || kanaArr[0]?.text || '';
      const word = commonKanji || commonKana;
      const reading = commonKana || word;
      if (!word) continue;

      const allPos = [];
      const allMisc = [];
      const glosses = [];

      for (const s of senseArr) {
        if (Array.isArray(s.partOfSpeech)) allPos.push(...s.partOfSpeech);
        if (Array.isArray(s.misc)) allMisc.push(...s.misc);
        if (Array.isArray(s.gloss)) {
          for (const g of s.gloss) {
            if (g && g.text && glosses.length < 4 && !glosses.includes(g.text)) {
              glosses.push(g.text);
            }
          }
        }
      }

      entries.push({
        id: String(id),
        jlpt: lvl.key,
        word,
        reading,
        usuallyKana: allMisc.includes('uk'),
        pos: normalizePos(allPos),
        meaningEn: glosses,
        meaningId: [],
      });
    }

    if (ai && TypeEnum) {
      console.log(`Translating ${lvl.key} (${entries.length} entries) via Gemini...`);
      for (let i = 0; i < entries.length; i += 40) {
        const chunk = entries.slice(i, i + 40);
        try {
          const idMap = await translateBatchWithGemini(ai, TypeEnum, chunk);
          for (const item of chunk) {
            const tr = idMap.get(item.id);
            if (tr && tr.length > 0) item.meaningId = tr;
          }
        } catch (err) {
          console.warn(`Batch ${i}-${i + chunk.length} failed:`, err.message);
        }
      }
    }

    const outPath = path.join(OUT_DIR, lvl.out);
    fs.writeFileSync(outPath, JSON.stringify(entries));
    manifestCounts[lvl.key] = entries.length;
    const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`Wrote ${lvl.out}: ${entries.length} entries (${sizeKb} KB)`);
  }

  const manifest = {
    source: 'aehlke/jlpt-classifier (core N5-N1) + jmdict-eng-3.3.1',
    totalUnique: Object.values(manifestCounts).reduce((a, b) => a + b, 0),
    missingFromJmdict: missingCount,
    counts: manifestCounts,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Done:', manifest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
