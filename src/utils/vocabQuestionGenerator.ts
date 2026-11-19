import {
  JFT_A2_TOPICS,
  JLPT_N4_TOPICS,
  MINNA_CHAPTERS,
  MinnaVocabSeed,
} from '../data/curriculumCatalog';
import {
  ClassId,
  CurriculumProgram,
  JlptVocabEntry,
  PedagogicalQuestionType,
  QuestionCategory,
  StagedGeneratedQuestion,
  TestType,
} from '../types';
import { clampArray, clampNum, clampStr } from './payloadGuards';

export function stripFurigana(text: string): string {
  return text.replace(/\[[^\]]+\]/g, '');
}

function shuffleDeterministic<T>(arr: T[], seedOffset = 0): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = (i * 7 + seedOffset + 3) % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function pickDistractors(pool: string[], correct: string, count = 3, seedOffset = 0): string[] {
  const unique = Array.from(new Set(pool.filter((x) => x && x !== correct)));
  const rotated = shuffleDeterministic(unique, seedOffset);
  const picked = rotated.slice(0, count);
  while (picked.length < count) {
    picked.push(`（別解 ${picked.length + 1}）`);
  }
  return picked;
}

export interface DeterministicGenInput {
  program: CurriculumProgram;
  chapterNumber: number;
  topicId: string;
  pedagogicalTypes: PedagogicalQuestionType[];
  count: number;
  classId: ClassId | 'all';
  testType: TestType;
  chapterGroup: string;
  allowFuriganaCore: boolean;
  selectedVocab: JlptVocabEntry[];
  vocabPool: JlptVocabEntry[];
  getEffectiveMeaningId: (entry: JlptVocabEntry) => string[];
}

function mapPedagogicalToCategory(
  ped: PedagogicalQuestionType,
  program: CurriculumProgram
): Exclude<QuestionCategory, 'listening'> {
  if (ped === 'kanji_reading') return 'kanji';
  if (ped === 'reading_comprehension') return 'reading';
  if (ped === 'sentence_arrangement' || ped === 'sentence_completion') return 'grammar';
  if (program === 'jlpt_n4' || program === 'jft_basic_a2') return 'jlpt_jft';
  return 'vocab';
}

export function generateDeterministicQuestions(
  input: DeterministicGenInput
): StagedGeneratedQuestion[] {
  const safeTypes = input.pedagogicalTypes.filter((t) => t.length > 0);
  const types: PedagogicalQuestionType[] =
    safeTypes.length > 0 ? safeTypes : ['multiple_choice'];

  const totalCount = clampNum(input.count, 1, 15);
  const results: StagedGeneratedQuestion[] = [];

  if (input.program === 'minna_1_50') {
    const ch =
      MINNA_CHAPTERS.find((c) => c.chapter === input.chapterNumber) || MINNA_CHAPTERS[0];
    const seeds: MinnaVocabSeed[] = ch.seeds.length > 0 ? ch.seeds : MINNA_CHAPTERS[0].seeds;
    const allMeaningsPool = MINNA_CHAPTERS.flatMap((c) => c.seeds.map((s) => s.meaningId));
    const allReadingsPool = MINNA_CHAPTERS.flatMap((c) => c.seeds.map((s) => s.reading));
    const allWordsFuriganaPool = MINNA_CHAPTERS.flatMap((c) =>
      c.seeds.map((s) => s.wordFurigana)
    );

    for (let i = 0; i < totalCount; i += 1) {
      const ped = types[i % types.length];
      const seed = seeds[i % seeds.length];
      const grammarHint = ch.grammarFocus[i % ch.grammarFocus.length] || ch.titleId;

      let prompt = '';
      let options: string[] = [];
      let correctAnswer = '';
      let explanation = '';
      let questionFormat: 'multiple_choice' | 'written' = 'multiple_choice';
      let hasFurigana = true;

      if (ped === 'kanji_reading') {
        hasFurigana = false;
        prompt = `「${seed.wordPlain}」の読[よ]み方[かた]として正[ただ]しいものを選[えら]びなさい。（みんなの日本語[にほんご] 第[だい]${ch.chapter}課[か]）`;
        correctAnswer = seed.reading;
        const dist = pickDistractors(allReadingsPool, correctAnswer, 3, i);
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation = `Arti Bahasa Indonesia: "${seed.meaningId}" (${seed.wordPlain} = ${seed.reading}).`;
      } else if (ped === 'fill_blank') {
        prompt =
          seed.sampleSentenceFurigana ||
          `次[つぎ]の文[ぶん]の（　　）に入[はい]る言葉[ことば]を選[えら]びなさい：「〜は ${seed.meaningId} です」→ それは（　　）です。`;
        correctAnswer = seed.sampleAnswer || seed.wordFurigana;
        const dist = pickDistractors(allWordsFuriganaPool, correctAnswer, 3, i);
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation =
          seed.sampleMeaningId ||
          `Minna no Nihongo Bab ${ch.chapter} (${grammarHint}): ${seed.wordFurigana} = ${seed.meaningId}.`;
      } else if (ped === 'sentence_completion') {
        questionFormat = 'written';
        prompt = `次[つぎ]の日本語[にほんご]の意味[いみ]になるように文[ぶん]を完成[かんせい]させなさい（第[だい]${ch.chapter}課[か] 文型[ぶんけい]：${grammarHint}）：\n「${seed.meaningId}」を使[つか]って短[みじか]い文[ぶん]を書[か]きなさい。`;
        correctAnswer = `${seed.wordFurigana}（${seed.meaningId}）`;
        options = [];
        explanation = `Pola Bab ${ch.chapter}: ${grammarHint} · Kosakata kunci: ${seed.wordFurigana} (${seed.meaningId}).`;
      } else if (ped === 'sentence_arrangement') {
        const chunks = [
          'わたしは',
          `昨日[きのう]`,
          seed.wordFurigana,
          seed.pos.startsWith('verb') ? 'を勉強[べんきょう]しました' : 'を見[み]ました',
        ];
        prompt = `次[つぎ]の言葉[ことば]を並[なら]べ替[か]えて、★に入[はい]るものを選[えら]びなさい（第[だい]${ch.chapter}課[か]）：\n＿＿ ＿＿ ★ ＿＿`;
        correctAnswer = seed.wordFurigana;
        options = shuffleDeterministic(chunks, i);
        explanation = `Susunan benar: ${chunks.join(' ')} (${seed.wordFurigana} = ${seed.meaningId}).`;
      } else if (ped === 'reading_comprehension') {
        prompt = `次[つぎ]の文[ぶん]を読[よ]んで答[こた]えなさい（第[だい]${ch.chapter}課[か]）：\n「今日[きょう]、クラスで『${seed.wordFurigana}』という言葉[ことば]を習[なら]いました。とても大切[たいせつ]な言葉[ことば]です。」\n『${seed.wordFurigana}』の意味[いみ]は何[なん]ですか。`;
        correctAnswer = seed.meaningId;
        const dist = pickDistractors(allMeaningsPool, correctAnswer, 3, i);
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation = `Dalam teks, ${seed.wordFurigana} berarti "${seed.meaningId}" (Bab ${ch.chapter}).`;
      } else {
        prompt = `「${seed.wordFurigana}」のインドネシア語[ご]の意味[いみ]として正[ただ]しいものを選[えら]びなさい。（第[だい]${ch.chapter}課[か]）`;
        correctAnswer = seed.meaningId;
        const dist = pickDistractors(allMeaningsPool, correctAnswer, 3, i);
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation = `${seed.wordFurigana} = ${seed.meaningId} (Minna no Nihongo Bab ${ch.chapter}: ${ch.titleId}).`;
      }

      results.push({
        tempId: `det_minna_${Date.now()}_${i}`,
        selected: true,
        classId: input.classId,
        category: mapPedagogicalToCategory(ped, input.program),
        testType: input.testType,
        questionFormat,
        pedagogicalType: ped,
        program: input.program,
        chapterGroup: clampStr(input.chapterGroup || `Minna Bab ${ch.chapter}`, 100),
        prompt: clampStr(prompt, 980),
        options: questionFormat === 'multiple_choice' ? clampArray(options, 6) : [],
        correctAnswer: clampStr(correctAnswer, 280),
        explanation: clampStr(explanation, 480),
        points: ped === 'reading_comprehension' ? 2 : 1,
        hasFurigana,
      });
    }
    return results;
  }

  if (input.program === 'jlpt_n4' || input.program === 'jft_basic_a2') {
    const topicList = input.program === 'jlpt_n4' ? JLPT_N4_TOPICS : JFT_A2_TOPICS;
    const topic = topicList.find((t) => t.id === input.topicId) || topicList[0];
    const topicSeeds = topic.seeds;
    const allMeaningPool = [
      ...topicSeeds.map((s) => s.meaningId),
      'jadwal keberangkatan',
      'kartu identitas',
      'izin libur',
      'daftar hadir',
    ];
    const allReadingPool = [
      ...topicSeeds.map((s) => s.reading),
      'れんしゅう',
      'しつもん',
      'あんない',
      'ちゅうい',
    ];

    for (let i = 0; i < totalCount; i += 1) {
      const ped = types[i % types.length];
      const seed = topicSeeds[i % topicSeeds.length];

      let prompt = '';
      let options: string[] = [];
      let correctAnswer = '';
      let explanation = '';
      let questionFormat: 'multiple_choice' | 'written' = 'multiple_choice';

      if (ped === 'kanji_reading') {
        prompt = `「${stripFurigana(seed.word)}」の読み方として最もよいものを1つ選びなさい。`;
        correctAnswer = seed.reading;
        const dist = pickDistractors(allReadingPool, correctAnswer, 3, i);
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation = `Arti: ${seed.meaningId} (${stripFurigana(seed.word)} = ${seed.reading}).`;
      } else if (ped === 'fill_blank' || ped === 'sentence_completion') {
        prompt =
          seed.sentenceBlank ||
          `（　　）に入れるのに最もよいものを1つ選びなさい：この仕事には（　　）が必要です。`;
        correctAnswer = seed.sentenceAnswer || stripFurigana(seed.word);
        const dist = pickDistractors(
          topicSeeds.map((s) => s.sentenceAnswer || stripFurigana(s.word)),
          correctAnswer,
          3,
          i
        );
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation = `${correctAnswer} berarti "${seed.meaningId}".`;
      } else if (ped === 'sentence_arrangement') {
        const chunks = seed.sentenceArrangeChunks || [
          '明日の',
          '授業は',
          '★',
          '始まります',
        ];
        const answerChunk = seed.sentenceArrangeAnswer || '9時から';
        prompt = `★に入るものはどれですか：\n${chunks.map((c) => (c === '★' ? '★' : '＿＿')).join(' ')}\n選択肢から★の位置に入るものを選びなさい。`;
        options = shuffleDeterministic(
          chunks.map((c) => (c === '★' ? answerChunk : c)),
          i
        );
        correctAnswer = answerChunk;
        explanation = `Urutan kalimat yang tepat menempatkan "${answerChunk}" pada posisi ★.`;
      } else if (ped === 'reading_comprehension') {
        const passage =
          seed.readingPassage ||
          topicSeeds.find((s) => s.readingPassage)?.readingPassage ||
          'お知らせ：明日の授業は朝9時から始まります。教科書を忘れないでください。';
        const qText =
          seed.readingQuestion ||
          topicSeeds.find((s) => s.readingQuestion)?.readingQuestion ||
          '明日の授業は何時から始まりますか。';
        correctAnswer =
          seed.readingAnswer ||
          topicSeeds.find((s) => s.readingAnswer)?.readingAnswer ||
          '朝9時から始まります';
        const dist =
          seed.readingDistractors ||
          topicSeeds.find((s) => s.readingDistractors)?.readingDistractors || [
            '午後1時から始まります',
            '明日は休みです',
            '教科書は要りません',
          ];
        prompt = `次の文章を読んで、質問に答えなさい。\n\n${passage}\n\n質問：${qText}`;
        options = shuffleDeterministic([correctAnswer, ...dist.slice(0, 3)], i);
        explanation = `Jawaban sesuai isi teks bacaan: ${correctAnswer}.`;
      } else {
        prompt = `「${stripFurigana(seed.word)}」の意味として最も近いものを1つ選びなさい。`;
        correctAnswer = seed.meaningId;
        const dist = pickDistractors(allMeaningPool, correctAnswer, 3, i);
        options = shuffleDeterministic([correctAnswer, ...dist], i);
        explanation = `${stripFurigana(seed.word)}（${seed.reading}）= ${seed.meaningId}.`;
      }

      results.push({
        tempId: `det_${input.program}_${Date.now()}_${i}`,
        selected: true,
        classId: input.classId,
        category: mapPedagogicalToCategory(ped, input.program),
        testType: input.testType,
        questionFormat,
        pedagogicalType: ped,
        program: input.program,
        chapterGroup: clampStr(
          input.chapterGroup || (input.program === 'jlpt_n4' ? 'JLPT N4' : 'JFT-Basic A2'),
          100
        ),
        prompt: stripFurigana(clampStr(prompt, 980)),
        options: clampArray(options.map(stripFurigana), 6),
        correctAnswer: stripFurigana(clampStr(correctAnswer, 280)),
        explanation: clampStr(explanation, 480),
        points: ped === 'reading_comprehension' ? 2 : 1,
        hasFurigana: false,
      });
    }
    return results;
  }

  // JLPT Core Vocabulary Reference Mode A (deterministic from selected JLPT entries)
  const seeds = input.selectedVocab.length > 0 ? input.selectedVocab : input.vocabPool.slice(0, 10);
  if (seeds.length === 0) return [];

  const getMeaning = (entry: JlptVocabEntry) => {
    const idMeanings = input.getEffectiveMeaningId(entry);
    if (idMeanings.length > 0) return idMeanings[0];
    return entry.meaningEn[0] || entry.reading;
  };

  for (let i = 0; i < totalCount; i += 1) {
    const ped = types[i % types.length];
    const seed = seeds[i % seeds.length];
    const meaning = getMeaning(seed);
    const sameLevelPool = input.vocabPool.filter((v) => v.jlpt === seed.jlpt && v.id !== seed.id);
    const fallbackPool = sameLevelPool.length >= 6 ? sameLevelPool : input.vocabPool;
    const samePosPool = fallbackPool.filter((v) =>
      v.pos.some((p) => seed.pos.includes(p))
    );
    const distractorSource = samePosPool.length >= 4 ? samePosPool : fallbackPool;

    const furiganaWord =
      input.allowFuriganaCore && seed.word !== seed.reading
        ? `${seed.word}[${seed.reading}]`
        : seed.word;

    let prompt = '';
    let options: string[] = [];
    let correctAnswer = '';
    let explanation = '';
    let questionFormat: 'multiple_choice' | 'written' = 'multiple_choice';
    let hasFurigana = input.allowFuriganaCore;

    if (ped === 'kanji_reading') {
      hasFurigana = false;
      prompt = `「${seed.word}」の正しい読み方を選びなさい。（JLPT ${seed.jlpt}）`;
      correctAnswer = seed.reading;
      const dist = pickDistractors(
        distractorSource.map((d) => d.reading),
        correctAnswer,
        3,
        i
      );
      options = shuffleDeterministic([correctAnswer, ...dist], i);
      explanation = `${seed.word}（${seed.reading}）: ${meaning} [${seed.pos.join(', ')}].`;
    } else if (ped === 'fill_blank') {
      prompt = `次の文の（　　）に入る最も適切な語を選びなさい（意味：${meaning}）：\nこの文脈では（　　）を使います。`;
      correctAnswer = furiganaWord;
      const dist = pickDistractors(
        distractorSource.map((d) =>
          input.allowFuriganaCore && d.word !== d.reading ? `${d.word}[${d.reading}]` : d.word
        ),
        correctAnswer,
        3,
        i
      );
      options = shuffleDeterministic([correctAnswer, ...dist], i);
      explanation = `Kata yang dimaksud adalah ${seed.word}（${seed.reading}）= ${meaning}.`;
    } else if (ped === 'sentence_completion') {
      questionFormat = 'written';
      prompt = `次の日本語の語彙を使って、自然な例文を1つ書きなさい（JLPT ${seed.jlpt}）：\n語彙：${furiganaWord}（意味：${meaning}）`;
      correctAnswer = `${seed.word}（${seed.reading}）: ${meaning}`;
      options = [];
      explanation = `Target kata (${seed.jlpt} · ${seed.pos.join(', ')}): ${seed.word}（${seed.reading}）= ${meaning}.`;
    } else if (ped === 'sentence_arrangement') {
      const chunks = ['今日は', furiganaWord, 'について', '話しましょう'];
      prompt = `次の言葉を並べ替えて、★に入るものを選びなさい（JLPT ${seed.jlpt}）：\n＿＿ ★ ＿＿ ＿＿`;
      correctAnswer = furiganaWord;
      options = shuffleDeterministic(chunks, i);
      explanation = `Urutan kalimat: 今日は ${seed.word} について 話しましょう (${meaning}).`;
    } else if (ped === 'reading_comprehension') {
      prompt = `次の短文を読んで答えなさい：\n「今日の授業で『${furiganaWord}』について確認しました。」\n『${furiganaWord}』の最も近い意味はどれですか。`;
      correctAnswer = meaning;
      const dist = pickDistractors(distractorSource.map(getMeaning), correctAnswer, 3, i);
      options = shuffleDeterministic([correctAnswer, ...dist], i);
      explanation = `${seed.word}（${seed.reading}）berarti "${meaning}".`;
    } else {
      prompt = `「${furiganaWord}」の意味として正しいものを選びなさい。（JLPT ${seed.jlpt}）`;
      correctAnswer = meaning;
      const dist = pickDistractors(distractorSource.map(getMeaning), correctAnswer, 3, i);
      options = shuffleDeterministic([correctAnswer, ...dist], i);
      explanation = `${seed.word}（${seed.reading}）= ${meaning} (${seed.meaningEn.slice(0, 2).join('; ')}).`;
    }

    results.push({
      tempId: `det_core_${Date.now()}_${seed.id}_${i}`,
      selected: true,
      classId: input.classId,
      category: mapPedagogicalToCategory(ped, input.program),
      testType: input.testType,
      questionFormat,
      pedagogicalType: ped,
      program: input.program,
      chapterGroup: clampStr(input.chapterGroup || `JLPT ${seed.jlpt}`, 100),
      prompt: clampStr(prompt, 980),
      options: questionFormat === 'multiple_choice' ? clampArray(options, 6) : [],
      correctAnswer: clampStr(correctAnswer, 280),
      explanation: clampStr(explanation, 480),
      points: 1,
      hasFurigana,
      sourceVocabId: seed.id,
    });
  }

  return results;
}
