import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckSquare,
  Edit3,
  Layers,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel, tr, UI_TEXT } from '../i18n';
import {
  JFT_A2_TOPICS,
  JLPT_N4_TOPICS,
  MINNA_CHAPTERS,
} from '../data/curriculumCatalog';
import {
  ClassId,
  CLASSES,
  CurriculumProgram,
  JlptLevel,
  JlptVocabEntry,
  LanguageMode,
  PedagogicalQuestionType,
  QUESTION_CATEGORIES,
  QuestionReviewStatus,
  StagedGeneratedQuestion,
  TestType,
  UserProfile,
  VocabTranslationOverride,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { clampArray, clampNum, clampStr } from '../utils/payloadGuards';
import {
  generateDeterministicQuestions,
  stripFurigana,
} from '../utils/vocabQuestionGenerator';
import { AppleModalSheet } from './AppleGestures';
import { FuriganaText } from './FuriganaText';

interface Props {
  open: boolean;
  onClose: () => void;
  lang: LanguageMode;
  profile: UserProfile;
  vocabOverrides: VocabTranslationOverride[];
  onSavedToast: (msg: string) => void;
}

const JLPT_LEVELS: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];
const LEVEL_FILE_MAP: Record<JlptLevel, string> = {
  N5: '/data/vocab/jlpt-n5.json',
  N4: '/data/vocab/jlpt-n4.json',
  N3: '/data/vocab/jlpt-n3.json',
  N2: '/data/vocab/jlpt-n2.json',
  N1: '/data/vocab/jlpt-n1.json',
};

const vocabCache = new Map<JlptLevel, JlptVocabEntry[]>();

const PEDAGOGICAL_TYPES: {
  id: PedagogicalQuestionType;
  labelJa: string;
  labelId: string;
}[] = [
  { id: 'multiple_choice', labelJa: '選択問題', labelId: 'Pilihan Ganda' },
  { id: 'fill_blank', labelJa: '空欄補充', labelId: 'Isian Rumpang (  )' },
  { id: 'sentence_completion', labelJa: '文完成', labelId: 'Melengkapi Kalimat' },
  { id: 'sentence_arrangement', labelJa: '語順整序 ★', labelId: 'Susun Kalimat ★' },
  { id: 'kanji_reading', labelJa: '漢字の読み', labelId: 'Bacaan Kanji' },
  { id: 'reading_comprehension', labelJa: '読解問題', labelId: 'Pemahaman Bacaan' },
];

const PAGE_SIZE = 30;

export function VocabGeneratorModal({
  open,
  onClose,
  lang,
  profile,
  vocabOverrides,
  onSavedToast,
}: Props) {
  const isHead = profile.role === 'head';
  const [activeModalTab, setActiveModalTab] = useState<'vocab' | 'generator'>('generator');

  // Vocabulary Browser state
  const [activeLevel, setActiveLevel] = useState<JlptLevel>('N5');
  const [levelLoading, setLevelLoading] = useState(false);
  const [levelError, setLevelError] = useState('');
  const [vocabList, setVocabList] = useState<JlptVocabEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [posFilter, setPosFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [selectedVocabIds, setSelectedVocabIds] = useState<string[]>([]);

  // Session Gemini translations (before teacher/admin decides to save overrides)
  const [sessionTranslations, setSessionTranslations] = useState<
    Record<string, { meaningId: string[]; noteId: string }>
  >({});
  const [translatingBatch, setTranslatingBatch] = useState(false);
  const [translateError, setTranslateError] = useState('');

  // Inline Vocab Override Editor
  const [editingVocab, setEditingVocab] = useState<JlptVocabEntry | null>(null);
  const [editMeaningText, setEditMeaningText] = useState('');
  const [editNoteText, setEditNoteText] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  // Generator controls
  const [program, setProgram] = useState<CurriculumProgram>('minna_1_50');
  const [minnaChapter, setMinnaChapter] = useState<number>(1);
  const [n4TopicId, setN4TopicId] = useState<string>(JLPT_N4_TOPICS[0].id);
  const [jftTopicId, setJftTopicId] = useState<string>(JFT_A2_TOPICS[0].id);
  const [selectedTypes, setSelectedTypes] = useState<PedagogicalQuestionType[]>([
    'multiple_choice',
    'fill_blank',
    'kanji_reading',
  ]);
  const [targetClass, setTargetClass] = useState<ClassId | 'all'>('hokkaido');
  const [targetTestType, setTargetTestType] = useState<TestType>('daily');
  const [chapterGroup, setChapterGroup] = useState<string>('Minna Bab 1');
  const [questionCount, setQuestionCount] = useState<number>(5);
  const [allowFuriganaCore, setAllowFuriganaCore] = useState<boolean>(false);

  // Staging Queue state
  const [stagedQuestions, setStagedQuestions] = useState<StagedGeneratedQuestion[]>([]);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [generatorError, setGeneratorError] = useState('');
  const [submitForReview, setSubmitForReview] = useState(false);
  const [savingStaged, setSavingStaged] = useState(false);

  const overrideMap = useMemo(() => {
    const m = new Map<string, VocabTranslationOverride>();
    vocabOverrides.forEach((ov) => m.set(ov.vocabId, ov));
    return m;
  }, [vocabOverrides]);

  // Lazy load active JLPT JSON when modal opens or activeLevel changes
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const cached = vocabCache.get(activeLevel);
    if (cached) {
      setVocabList(cached);
      setLevelError('');
      return;
    }

    setLevelLoading(true);
    setLevelError('');
    fetch(LEVEL_FILE_MAP[activeLevel])
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as JlptVocabEntry[];
      })
      .then((data) => {
        if (cancelled) return;
        vocabCache.set(activeLevel, data);
        setVocabList(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setLevelError(
          err instanceof Error
            ? `Gagal memuat database kosakata ${activeLevel}: ${err.message}`
            : 'Gagal memuat database kosakata.'
        );
      })
      .finally(() => {
        if (!cancelled) setLevelLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, activeLevel]);

  // Auto-suggest chapterGroup when program/chapter changes
  useEffect(() => {
    if (program === 'minna_1_50') {
      setChapterGroup(`Minna Bab ${minnaChapter}`);
    } else if (program === 'jlpt_n4') {
      setChapterGroup('JLPT N4');
    } else if (program === 'jft_basic_a2') {
      setChapterGroup('JFT-Basic A2');
    } else {
      setChapterGroup(`JLPT ${activeLevel}`);
    }
  }, [program, minnaChapter, activeLevel]);

  const getEffectiveMeaningId = (entry: JlptVocabEntry): string[] => {
    const ov = overrideMap.get(entry.id);
    if (ov && ov.customMeaningId.length > 0) return ov.customMeaningId;
    const sess = sessionTranslations[entry.id];
    if (sess && sess.meaningId.length > 0) return sess.meaningId;
    return entry.meaningId || [];
  };

  const availablePos = useMemo(() => {
    const set = new Set<string>();
    vocabList.forEach((v) => v.pos.forEach((p) => set.add(p)));
    return Array.from(set).sort();
  }, [vocabList]);

  const filteredVocab = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vocabList.filter((entry) => {
      if (posFilter !== 'all' && !entry.pos.includes(posFilter)) return false;
      if (!q) return true;
      const meaningsId = getEffectiveMeaningId(entry).join(' ').toLowerCase();
      return (
        entry.word.toLowerCase().includes(q) ||
        entry.reading.toLowerCase().includes(q) ||
        entry.meaningEn.join(' ').toLowerCase().includes(q) ||
        meaningsId.includes(q)
      );
    });
  }, [vocabList, searchQuery, posFilter, overrideMap, sessionTranslations]);

  useEffect(() => {
    setPage(1);
  }, [activeLevel, searchQuery, posFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredVocab.length / PAGE_SIZE));
  const pagedVocab = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredVocab.slice(start, start + PAGE_SIZE);
  }, [filteredVocab, page]);

  const selectedVocabEntries = useMemo(() => {
    const idSet = new Set(selectedVocabIds);
    const allLoaded: JlptVocabEntry[] = [];
    vocabCache.forEach((arr) => allLoaded.push(...arr));
    return allLoaded.filter((v) => idSet.has(v.id));
  }, [selectedVocabIds, vocabList]);

  const toggleVocabSelection = (id: string) => {
    setSelectedVocabIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-25)
    );
  };

  const startEditOverride = (entry: JlptVocabEntry) => {
    const ov = overrideMap.get(entry.id);
    const currentMeanings = getEffectiveMeaningId(entry);
    const sessNote = sessionTranslations[entry.id]?.noteId || '';
    setEditingVocab(entry);
    setEditMeaningText(currentMeanings.join(', '));
    setEditNoteText(ov?.customNote || sessNote);
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingVocab) return;
    const parts = clampArray(
      editMeaningText
        .split(/[,;\n]/)
        .map((s) => clampStr(s, 120))
        .filter(Boolean),
      10
    );
    if (parts.length === 0) return;

    setSavingOverride(true);
    try {
      const actorName = clampStr(profile.nickname || profile.displayName, 100) || 'Sensei';
      await setDoc(doc(db, 'vocabOverrides', editingVocab.id), {
        vocabId: editingVocab.id,
        customMeaningId: parts,
        customNote: clampStr(editNoteText, 300),
        updatedBy: profile.uid,
        updatedByName: actorName,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'vocabOverride',
        targetLabel: `${editingVocab.word} (${editingVocab.jlpt})`,
        detail: `Updated ID meaning: ${parts.join(', ')}`,
      });
      setEditingVocab(null);
      onSavedToast(
        lang === 'ja'
          ? `「${editingVocab.word}」のインドネシア語訳を保存しました`
          : `Terjemahan "${editingVocab.word}" disimpan & dapat digunakan bersama`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `vocabOverrides/${editingVocab.id}`);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleResetOverride = async (entry: JlptVocabEntry) => {
    if (!overrideMap.has(entry.id)) return;
    setSavingOverride(true);
    try {
      await deleteDoc(doc(db, 'vocabOverrides', entry.id));
      await logActivity({
        actor: profile,
        actionType: 'data_delete',
        targetType: 'vocabOverride',
        targetLabel: `${entry.word} (${entry.jlpt})`,
        detail: 'Reset custom Indonesian translation override',
      });
      onSavedToast(
        lang === 'ja'
          ? `「${entry.word}」のカスタム訳をリセットしました`
          : `Override terjemahan "${entry.word}" dihapus`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `vocabOverrides/${entry.id}`);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleTranslateVisiblePage = async () => {
    const untranslated = pagedVocab
      .filter((entry) => getEffectiveMeaningId(entry).length === 0)
      .slice(0, 25);
    if (untranslated.length === 0) {
      onSavedToast(
        lang === 'ja'
          ? '表示中の語彙にはすでに翻訳があります。'
          : 'Semua kosakata pada halaman ini sudah memiliki terjemahan.'
      );
      return;
    }

    setTranslatingBatch(true);
    setTranslateError('');
    try {
      const res = await fetch('/api/vocab/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: untranslated.map((v) => ({
            id: v.id,
            word: v.word,
            reading: v.reading,
            pos: v.pos,
            meaningEn: v.meaningEn,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const nextMap: Record<string, { meaningId: string[]; noteId: string }> = {
        ...sessionTranslations,
      };
      for (const row of data.translations || []) {
        if (row && row.id && Array.isArray(row.meaningId)) {
          nextMap[row.id] = {
            meaningId: row.meaningId,
            noteId: row.noteId || '',
          };
        }
      }
      setSessionTranslations(nextMap);
      onSavedToast(
        lang === 'ja'
          ? `${(data.translations || []).length}件の語彙を翻訳しました（編集して保存できます）`
          : `${(data.translations || []).length} kosakata diterjemahkan. Klik Edit untuk meninjau & simpan permanen.`
      );
    } catch (err) {
      setTranslateError(
        err instanceof Error ? err.message : 'Gagal menerjemahkan kosakata via server.'
      );
    } finally {
      setTranslatingBatch(false);
    }
  };

  const togglePedagogicalType = (t: PedagogicalQuestionType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(t)) {
        return prev.length > 1 ? prev.filter((x) => x !== t) : prev;
      }
      return [...prev, t];
    });
  };

  const currentMinnaSpec = useMemo(
    () => MINNA_CHAPTERS.find((c) => c.chapter === minnaChapter) || MINNA_CHAPTERS[0],
    [minnaChapter]
  );

  const currentTopicLabel = useMemo(() => {
    if (program === 'minna_1_50') {
      return `${currentMinnaSpec.titleId} — Fokus: ${currentMinnaSpec.grammarFocus.join(', ')}`;
    }
    if (program === 'jlpt_n4') {
      const t = JLPT_N4_TOPICS.find((x) => x.id === n4TopicId) || JLPT_N4_TOPICS[0];
      return `${t.labelId}: ${t.descriptionId}`;
    }
    if (program === 'jft_basic_a2') {
      const t = JFT_A2_TOPICS.find((x) => x.id === jftTopicId) || JFT_A2_TOPICS[0];
      return `${t.labelId}: ${t.descriptionId}`;
    }
    return `JLPT ${activeLevel} Core Vocabulary`;
  }, [program, currentMinnaSpec, n4TopicId, jftTopicId, activeLevel]);

  const handleGenerateModeA = () => {
    setGeneratorError('');
    const topicId = program === 'jlpt_n4' ? n4TopicId : jftTopicId;
    const generated = generateDeterministicQuestions({
      program,
      chapterNumber: minnaChapter,
      topicId,
      pedagogicalTypes: selectedTypes,
      count: questionCount,
      classId: targetClass,
      testType: targetTestType,
      chapterGroup,
      allowFuriganaCore,
      selectedVocab: selectedVocabEntries,
      vocabPool: vocabList,
      getEffectiveMeaningId,
    });
    if (generated.length === 0) {
      setGeneratorError(
        lang === 'ja'
          ? '問題を作成できる語彙データがありません。語彙タブでレベルを選択してください。'
          : 'Belum ada kosakata yang dimuat. Buka tab Kamus Referensi atau pilih kosakata terlebih dahulu.'
      );
      return;
    }
    setStagedQuestions((prev) => [...generated, ...prev]);
  };

  const handleGenerateModeB = async () => {
    setGeneratorError('');
    setGeneratingAi(true);
    try {
      const seedWords =
        program === 'minna_1_50'
          ? currentMinnaSpec.seeds.map((s) => ({
              id: `minna_${minnaChapter}_${s.wordPlain}`,
              word: s.wordPlain,
              reading: s.reading,
              meaning: s.meaningId,
              pos: s.pos,
              jlpt: 'N5',
            }))
          : program === 'jlpt_n4'
          ? (JLPT_N4_TOPICS.find((t) => t.id === n4TopicId) || JLPT_N4_TOPICS[0]).seeds.map(
              (s) => ({
                id: `n4_${s.word}`,
                word: s.word,
                reading: s.reading,
                meaning: s.meaningId,
                pos: s.pos,
                jlpt: 'N4',
              })
            )
          : program === 'jft_basic_a2'
          ? (JFT_A2_TOPICS.find((t) => t.id === jftTopicId) || JFT_A2_TOPICS[0]).seeds.map(
              (s) => ({
                id: `jft_${s.word}`,
                word: s.word,
                reading: s.reading,
                meaning: s.meaningId,
                pos: s.pos,
                jlpt: 'N4',
              })
            )
          : (selectedVocabEntries.length > 0 ? selectedVocabEntries : vocabList.slice(0, 12)).map(
              (v) => ({
                id: v.id,
                word: v.word,
                reading: v.reading,
                meaning:
                  getEffectiveMeaningId(v).join(', ') || v.meaningEn.slice(0, 2).join(', '),
                pos: v.pos.join(', '),
                jlpt: v.jlpt,
              })
            );

      const res = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          program,
          chapterNumber: program === 'minna_1_50' ? minnaChapter : undefined,
          topic: currentTopicLabel,
          pedagogicalTypes: selectedTypes,
          count: questionCount,
          words: seedWords,
          classId: targetClass,
          testType: targetTestType,
          chapterGroup,
          allowFurigana:
            program === 'minna_1_50'
              ? true
              : program === 'jlpt_core'
              ? allowFuriganaCore
              : false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      const nextStaged = Array.isArray(data?.questions) ? (data.questions as StagedGeneratedQuestion[]) : [];
      if (nextStaged.length === 0) {
        throw new Error('Gemini tidak mengembalikan daftar soal.');
      }
      setStagedQuestions((prev) => [...nextStaged, ...prev]);
    } catch (err) {
      setGeneratorError(
        err instanceof Error ? err.message : 'Gagal membuat soal dengan Gemini AI.'
      );
    } finally {
      setGeneratingAi(false);
    }
  };

  const updateStagedItem = (
    tempId: string,
    patch: Partial<StagedGeneratedQuestion>
  ) => {
    setStagedQuestions((prev) =>
      prev.map((item) => (item.tempId === tempId ? { ...item, ...patch } : item))
    );
  };

  const removeStagedItem = (tempId: string) => {
    setStagedQuestions((prev) => prev.filter((item) => item.tempId !== tempId));
  };

  const selectedStaged = useMemo(
    () => stagedQuestions.filter((q) => q.selected),
    [stagedQuestions]
  );

  const handleSaveSelectedToBank = async () => {
    if (selectedStaged.length === 0) return;
    setSavingStaged(true);
    setGeneratorError('');

    // Critical requirement: NEVER automatically publish generated questions.
    // Always save as 'draft' (or 'pending' when explicitly submitted for review).
    const saveStatus: QuestionReviewStatus = !isHead && submitForReview ? 'pending' : 'draft';

    try {
      for (const item of selectedStaged) {
        const cleanPrompt = clampStr(
          item.program === 'jlpt_n4' || item.program === 'jft_basic_a2'
            ? stripFurigana(item.prompt)
            : item.prompt,
          1000
        );
        const cleanAnswer = clampStr(
          item.program === 'jlpt_n4' || item.program === 'jft_basic_a2'
            ? stripFurigana(item.correctAnswer)
            : item.correctAnswer,
          300
        );
        if (!cleanPrompt || !cleanAnswer) continue;

        const cleanOptions =
          item.questionFormat === 'multiple_choice'
            ? clampArray(
                item.options
                  .map((o) =>
                    clampStr(
                      item.program === 'jlpt_n4' || item.program === 'jft_basic_a2'
                        ? stripFurigana(o)
                        : o,
                      200
                    )
                  )
                  .filter(Boolean),
                6
              )
            : [];

        await addDoc(collection(db, 'questions'), {
          classId: item.classId,
          category: item.category,
          testType: item.testType,
          questionFormat: cleanOptions.length >= 2 ? item.questionFormat : 'written',
          prompt: cleanPrompt,
          options: cleanOptions,
          correctAnswer: cleanAnswer,
          explanation: clampStr(item.explanation, 500),
          points: clampNum(item.points, 1, 100),
          chapterGroup: clampStr(item.chapterGroup, 100) || 'Umum / 一般',
          audioDataUrl: '',
          audioFileName: '',
          reviewStatus: saveStatus,
          reviewReason: '',
          reviewedBy: '',
          reviewedAt: '',
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'question',
        targetLabel: `${selectedStaged.length} generated questions`,
        detail: `Saved [${chapterGroup}] (${saveStatus}) via ${program}`,
      });

      const savedCount = selectedStaged.length;
      setStagedQuestions((prev) => prev.filter((q) => !q.selected));
      onSavedToast(
        saveStatus === 'pending'
          ? lang === 'ja'
            ? `${savedCount}問を承認待ち（pending）として問題バンクへ保存しました`
            : `${savedCount} soal disimpan ke Bank Soal dengan status Menunggu Review Admin`
          : lang === 'ja'
          ? `${savedCount}問を下書き（Draft）として問題バンクへ保存しました`
          : `${savedCount} soal disimpan ke Bank Soal sebagai Draft (belum dipublikasikan)`
      );
      if (stagedQuestions.length === savedCount) {
        onClose();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'questions');
    } finally {
      setSavingStaged(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <AppleModalSheet open={open} onClose={onClose} maxWidthClass="max-w-6xl">
          {/* Header */}
          <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'ja'
                  ? 'JLPTコア語彙データベース & 問題ジェネレーター'
                  : 'Database Kosakata JLPT (N5–N1) & Generator Soal'}
              </h2>
              <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'ja'
                  ? '7,998語JLPT参照データ・みんなの日本語1〜50課・JLPT N4・JFT-Basic A2対応（すべて確認後に下書き保存）'
                  : 'Kosakata inti JLPT N5–N1, Minna Bab 1–50, JLPT N4 & JFT-Basic A2 · Wajib preview sebelum masuk Bank Soal'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex bg-[#f5f5f7] dark:bg-[#161617] p-1 rounded-[12px] border border-[#d2d2d7]/60 dark:border-[#424245]">
                <button
                  type="button"
                  onClick={() => setActiveModalTab('generator')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[9px] transition-colors ${
                    activeModalTab === 'generator'
                      ? 'bg-white dark:bg-[#2c2c2e] text-[#0071e3] dark:text-[#2997ff] shadow-xs'
                      : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '問題生成' : 'Generator Soal'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModalTab('vocab')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-[9px] transition-colors ${
                    activeModalTab === 'vocab'
                      ? 'bg-white dark:bg-[#2c2c2e] text-[#0071e3] dark:text-[#2997ff] shadow-xs'
                      : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>
                    {lang === 'ja' ? 'JLPT語彙辞書' : 'Kamus JLPT'}{' '}
                    {selectedVocabIds.length > 0 ? `(${selectedVocabIds.length})` : ''}
                  </span>
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6 bg-[#f5f5f7] dark:bg-[#000000]">
            {activeModalTab === 'vocab' ? (
              <div className="space-y-4">
                {/* Level Tabs & Filters */}
                <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {JLPT_LEVELS.map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setActiveLevel(lvl)}
                          className={`px-3 py-1.5 text-[12px] font-semibold rounded-[10px] transition-colors ${
                            activeLevel === lvl
                              ? 'bg-[#0071e3] dark:bg-[#2997ff] text-white'
                              : 'bg-[#f5f5f7] dark:bg-[#161617] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#d2d2d7]/60 dark:border-[#424245]'
                          }`}
                        >
                          {lvl}
                        </button>
                      ))}
                      <span className="ml-2 text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                        {filteredVocab.length} / {vocabList.length} entri
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={translatingBatch || levelLoading || pagedVocab.length === 0}
                        onClick={handleTranslateVisiblePage}
                        className="apple-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] disabled:opacity-50"
                      >
                        {translatingBatch ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                        )}
                        <span>
                          {lang === 'ja'
                            ? 'このページをGemini翻訳'
                            : 'Terjemahkan Halaman via Gemini'}
                        </span>
                      </button>
                      {selectedVocabIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setProgram('jlpt_core');
                            setActiveModalTab('generator');
                          }}
                          className="apple-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium"
                        >
                          <Wand2 className="w-3.5 h-3.5" />
                          <span>
                            {lang === 'ja'
                              ? `${selectedVocabIds.length}語から問題作成`
                              : `Buat Soal dari ${selectedVocabIds.length} Kata`}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        lang === 'ja'
                          ? '漢字・ひらがな・英語・インドネシア語で検索...'
                          : 'Cari kanji, bacaan, arti Indonesia atau Inggris...'
                      }
                      className="glass-input sm:col-span-2 px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                    <select
                      value={posFilter}
                      onChange={(e) => setPosFilter(e.target.value)}
                      className="glass-input px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    >
                      <option value="all">
                        {lang === 'ja' ? 'すべての品詞' : 'Semua Kelas Kata (POS)'}
                      </option>
                      {availablePos.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(levelError || translateError) && (
                    <div className="flex items-center gap-2 text-[12px] text-[#dc2626] dark:text-[#ff453a] bg-[#dc2626]/10 rounded-[12px] px-3 py-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{levelError || translateError}</span>
                    </div>
                  )}
                </div>

                {/* Inline Override Editor Drawer */}
                {editingVocab && (
                  <form
                    onSubmit={handleSaveOverride}
                    className="apple-tile border border-[#0071e3]/50 dark:border-[#2997ff]/50 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {lang === 'ja' ? 'インドネシア語訳を編集: ' : 'Edit Arti Indonesia: '}
                        <span className="text-[#0071e3] dark:text-[#2997ff]">
                          {editingVocab.word}（{editingVocab.reading}）
                        </span>
                        <span className="ml-2 text-[12px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                          [{editingVocab.pos.join(', ')}] · EN: {editingVocab.meaningEn.join('; ')}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingVocab(null)}
                        className="p-1 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'ja'
                            ? 'インドネシア語訳（カンマ区切り）*'
                            : 'Arti Bahasa Indonesia (pisahkan dengan koma) *'}
                        </label>
                        <input
                          type="text"
                          required
                          value={editMeaningText}
                          onChange={(e) => setEditMeaningText(e.target.value)}
                          placeholder="mis: makan, menyantap"
                          className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'ja'
                            ? '文脈メモ・使い分け（任意）'
                            : 'Catatan Konteks / Disambiguasi (opsional)'}
                        </label>
                        <input
                          type="text"
                          maxLength={300}
                          value={editNoteText}
                          onChange={(e) => setEditNoteText(e.target.value)}
                          placeholder="mis: Dipakai untuk kata benda formal / percakapan kerja"
                          className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingVocab(null)}
                        className="apple-btn-secondary px-3 py-1.5 text-[12px]"
                      >
                        {lang === 'ja' ? 'キャンセル' : 'Batal'}
                      </button>
                      <button
                        type="submit"
                        disabled={savingOverride}
                        className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? '保存する' : 'Simpan Arti Indonesia'}</span>
                      </button>
                    </div>
                  </form>
                )}

                {/* Vocab Table */}
                <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245] overflow-hidden">
                  {levelLoading ? (
                    <div className="p-10 flex items-center justify-center gap-2 text-[13px] text-[#6e6e73] dark:text-[#86868b]">
                      <Loader2 className="w-4 h-4 animate-spin text-[#0071e3]" />
                      <span>Memuat kamus {activeLevel}...</span>
                    </div>
                  ) : (
                    <div className="divide-y divide-[#d2d2d7]/50 dark:divide-[#424245]">
                      {pagedVocab.map((entry) => {
                        const isChecked = selectedVocabIds.includes(entry.id);
                        const meaningsId = getEffectiveMeaningId(entry);
                        const ov = overrideMap.get(entry.id);
                        const sess = sessionTranslations[entry.id];

                        return (
                          <div
                            key={entry.id}
                            className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white dark:bg-[#1d1d1f]"
                          >
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => toggleVocabSelection(entry.id)}
                                className="mt-0.5 text-[#0071e3] dark:text-[#2997ff] shrink-0"
                                aria-label={`Select ${entry.word}`}
                              >
                                {isChecked ? (
                                  <CheckSquare className="w-4 h-4" />
                                ) : (
                                  <Square className="w-4 h-4 text-[#86868b]" />
                                )}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-2">
                                  <span className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                                    {entry.word}
                                  </span>
                                  <span className="text-[12px] text-[#6e6e73] dark:text-[#a1a1a6]">
                                    ({entry.reading})
                                  </span>
                                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#a1a1a6]">
                                    {entry.pos.join(', ')}
                                  </span>
                                  {ov && (
                                    <span className="text-[11px] font-medium text-[#15803d] dark:text-[#30d158]">
                                      · Diedit {ov.updatedByName}
                                    </span>
                                  )}
                                  {!ov && sess && (
                                    <span className="text-[11px] font-medium text-[#0071e3] dark:text-[#2997ff]">
                                      · Draf Gemini (belum disimpan)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5">
                                  {meaningsId.length > 0 ? (
                                    <span className="font-medium text-[#0071e3] dark:text-[#2997ff]">
                                      ID: {meaningsId.join(', ')}
                                    </span>
                                  ) : (
                                    <span className="text-[#86868b] italic">
                                      ID: belum diterjemahkan
                                    </span>
                                  )}
                                  <span className="mx-2 text-[#d2d2d7] dark:text-[#424245]">|</span>
                                  <span className="text-[#6e6e73] dark:text-[#a1a1a6]">
                                    EN: {entry.meaningEn.join('; ')}
                                  </span>
                                </div>
                                {(ov?.customNote || sess?.noteId) && (
                                  <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                                    Catatan: {ov?.customNote || sess?.noteId}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 pl-7 sm:pl-0 shrink-0">
                              <button
                                type="button"
                                onClick={() => startEditOverride(entry)}
                                className="apple-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 text-[11px]"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>{lang === 'ja' ? '訳を編集' : 'Edit ID'}</span>
                              </button>
                              {ov && (
                                <button
                                  type="button"
                                  disabled={savingOverride}
                                  onClick={() => handleResetOverride(entry)}
                                  className="p-1.5 text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] rounded-full"
                                  title="Reset override"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-4 py-2.5 bg-[#f5f5f7] dark:bg-[#161617] border-t border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between text-[12px]">
                      <span className="font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                        Hal {page} / {totalPages}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className="apple-btn-secondary px-2.5 py-1 text-[11px] disabled:opacity-40"
                        >
                          Prev
                        </button>
                        <button
                          type="button"
                          disabled={page >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          className="apple-btn-secondary px-2.5 py-1 text-[11px] disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Generator Configuration */}
                <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245] p-5 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                        {lang === 'ja' ? 'プログラム / 教材' : 'Program Belajar'}
                      </label>
                      <select
                        value={program}
                        onChange={(e) => setProgram(e.target.value as CurriculumProgram)}
                        className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      >
                        <option value="minna_1_50">
                          Minna no Nihongo (Bab 1–50 · Furigana + ID)
                        </option>
                        <option value="jlpt_n4">JLPT N4 (Tanpa Furigana)</option>
                        <option value="jft_basic_a2">JFT-Basic A2 (Tanpa Furigana)</option>
                        <option value="jlpt_core">
                          JLPT Core Vocab ({activeLevel}
                          {selectedVocabIds.length > 0
                            ? ` · ${selectedVocabIds.length} dipilih`
                            : ''}
                          )
                        </option>
                      </select>
                    </div>

                    {program === 'minna_1_50' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'ja' ? 'みんなの日本語 課 (1〜50)' : 'Pilih Bab (1–50)'}
                        </label>
                        <select
                          value={minnaChapter}
                          onChange={(e) => setMinnaChapter(Number(e.target.value))}
                          className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        >
                          {MINNA_CHAPTERS.map((ch) => (
                            <option key={ch.chapter} value={ch.chapter}>
                              Bab {ch.chapter} — {ch.titleJa.replace(/^第\d+課：/, '')}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {program === 'jlpt_n4' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'ja' ? 'N4 分野' : 'Materi JLPT N4'}
                        </label>
                        <select
                          value={n4TopicId}
                          onChange={(e) => setN4TopicId(e.target.value)}
                          className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        >
                          {JLPT_N4_TOPICS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.labelId}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {program === 'jft_basic_a2' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'ja' ? 'JFT A2 分野' : 'Materi JFT-Basic A2'}
                        </label>
                        <select
                          value={jftTopicId}
                          onChange={(e) => setJftTopicId(e.target.value)}
                          className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        >
                          {JFT_A2_TOPICS.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.labelId}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {program === 'jlpt_core' && (
                      <div>
                        <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'ja' ? 'JLPT レベル' : 'Level Kosakata Inti'}
                        </label>
                        <select
                          value={activeLevel}
                          onChange={(e) => setActiveLevel(e.target.value as JlptLevel)}
                          className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        >
                          {JLPT_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              JLPT {l}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                        {lang === 'ja' ? '対象クラス・種別' : 'Target Kelas & Jenis Tes'}
                      </label>
                      <div className="flex gap-1.5">
                        <select
                          value={targetClass}
                          onChange={(e) => setTargetClass(e.target.value as ClassId | 'all')}
                          className="glass-input flex-1 px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        >
                          <option value="all">{tr(UI_TEXT.allClasses, lang)}</option>
                          {CLASSES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.nameJa}
                            </option>
                          ))}
                        </select>
                        <select
                          value={targetTestType}
                          onChange={(e) => setTargetTestType(e.target.value as TestType)}
                          className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        >
                          <option value="daily">{tr(UI_TEXT.daily, lang)}</option>
                          <option value="weekly">{tr(UI_TEXT.weekly, lang)}</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                        {lang === 'ja' ? 'フォルダ名 & 問題数' : 'Kelompok Bab & Jumlah'}
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          maxLength={100}
                          value={chapterGroup}
                          onChange={(e) => setChapterGroup(e.target.value)}
                          className="glass-input flex-1 px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        />
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={questionCount}
                          onChange={(e) => setQuestionCount(clampNum(Number(e.target.value), 1, 15))}
                          className="glass-input w-16 px-2.5 py-2 text-[12px] font-mono tabular-nums rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Policy / Program Info Banner */}
                  <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[12px] px-3.5 py-2.5 text-[12px] flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <span className="font-semibold text-[#0071e3] dark:text-[#2997ff]">
                        {program === 'minna_1_50'
                          ? 'Aturan Minna Bab 1–50: '
                          : program === 'jlpt_n4' || program === 'jft_basic_a2'
                          ? 'Aturan JLPT N4 / JFT A2: '
                          : 'Aturan JLPT Core: '}
                      </span>
                      {program === 'minna_1_50'
                        ? 'Otomatis memakai Furigana + Terjemahan Bahasa Indonesia (Tanpa Choukai).'
                        : program === 'jlpt_n4' || program === 'jft_basic_a2'
                        ? 'Furigana DINONAKTIFKAN secara ketat sesuai standar ujian asli (Tanpa Choukai).'
                        : 'Pilih kosakata di tab Kamus JLPT atau gunakan sampel level aktif (Tanpa Choukai).'}
                    </div>
                    {program === 'jlpt_core' && (
                      <label className="inline-flex items-center gap-1.5 text-[12px] text-[#6e6e73] dark:text-[#a1a1a6] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowFuriganaCore}
                          onChange={(e) => setAllowFuriganaCore(e.target.checked)}
                          className="rounded border-[#d2d2d7] text-[#0071e3]"
                        />
                        <span>Tampilkan Furigana</span>
                      </label>
                    )}
                  </div>

                  {/* Pedagogical Question Types (Strictly NO Choukai) */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b]">
                      {lang === 'ja'
                        ? '問題形式（聴解・Choukaiは自動生成対象外）'
                        : 'Jenis Soal yang Dihasilkan (Non-Choukai)'}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {PEDAGOGICAL_TYPES.map((t) => {
                        const active = selectedTypes.includes(t.id);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => togglePedagogicalType(t.id)}
                            className={`px-3 py-1.5 text-[12px] font-medium rounded-[10px] border transition-colors ${
                              active
                                ? 'bg-[#0071e3]/12 border-[#0071e3] text-[#0071e3] dark:bg-[#2997ff]/18 dark:border-[#2997ff] dark:text-[#2997ff]'
                                : 'bg-white dark:bg-[#1d1d1f] border-[#d2d2d7]/70 dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b]'
                            }`}
                          >
                            {lang === 'ja' ? t.labelJa : t.labelId}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mode A & Mode B Actions */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      disabled={generatingAi}
                      onClick={handleGenerateModeA}
                      className="apple-btn-secondary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                    >
                      <Layers className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
                      <span>
                        {lang === 'ja'
                          ? 'Mode A: 決定論的生成（コスト0）'
                          : 'Mode A: Generate Deterministik (Gratis & Cepat)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={generatingAi}
                      onClick={handleGenerateModeB}
                      className="apple-btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium disabled:opacity-50"
                    >
                      {generatingAi ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      <span>
                        {lang === 'ja'
                          ? 'Mode B: Gemini AIで文脈問題生成'
                          : 'Mode B: Generate Soal Kontekstual (Gemini AI)'}
                      </span>
                    </button>
                  </div>

                  {generatorError && (
                    <div className="flex items-center gap-2 text-[12px] text-[#dc2626] dark:text-[#ff453a] bg-[#dc2626]/10 rounded-[12px] px-3.5 py-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{generatorError}</span>
                    </div>
                  )}
                </div>

                {/* Staging Preview Queue */}
                <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245] p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d2d2d7]/60 dark:border-[#424245] pb-3">
                    <div>
                      <h3 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {lang === 'ja'
                          ? `生成プレビュー・編集キュー（${stagedQuestions.length}問）`
                          : `Antrean Preview & Edit Sebelum Simpan (${stagedQuestions.length} soal)`}
                      </h3>
                      <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        {lang === 'ja'
                          ? '生成された問題は自動公開されません。内容を確認・編集し、下書きまたは承認待ちとして保存してください。'
                          : 'Semua soal di bawah masih sementara. Periksa & edit terlebih dahulu — tidak ada soal yang dipublikasikan otomatis.'}
                      </p>
                    </div>
                    {stagedQuestions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setStagedQuestions([])}
                        className="text-[12px] text-[#dc2626] dark:text-[#ff453a] hover:underline"
                      >
                        Bersihkan Antrean
                      </button>
                    )}
                  </div>

                  {stagedQuestions.length === 0 ? (
                    <div className="py-10 text-center text-[13px] text-[#6e6e73] dark:text-[#86868b]">
                      {lang === 'ja'
                        ? '上の Mode A または Mode B ボタンをクリックして問題プレビューを作成してください。'
                        : 'Klik tombol Mode A atau Mode B di atas untuk menghasilkan draf soal ke antrean preview.'}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {stagedQuestions.map((sq, idx) => {
                        const showRuby =
                          sq.program !== 'jlpt_n4' &&
                          sq.program !== 'jft_basic_a2' &&
                          sq.hasFurigana;

                        return (
                          <div
                            key={sq.tempId}
                            className={`rounded-[16px] border p-4 space-y-3 transition-colors ${
                              sq.selected
                                ? 'bg-white dark:bg-[#1d1d1f] border-[#0071e3]/40 dark:border-[#2997ff]/40'
                                : 'bg-[#f5f5f7]/70 dark:bg-[#161617]/70 border-[#d2d2d7]/50 dark:border-[#424245] opacity-70'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateStagedItem(sq.tempId, { selected: !sq.selected })
                                  }
                                  className="text-[#0071e3] dark:text-[#2997ff]"
                                >
                                  {sq.selected ? (
                                    <CheckSquare className="w-4 h-4" />
                                  ) : (
                                    <Square className="w-4 h-4 text-[#86868b]" />
                                  )}
                                </button>
                                <span className="text-[12px] font-mono font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                                  #{idx + 1}
                                </span>
                                <span className="text-[11px] px-2 py-0.5 rounded bg-[#0071e3]/10 text-[#0071e3] dark:text-[#2997ff] font-medium">
                                  {sq.pedagogicalType}
                                </span>
                                <span className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                                  {classLabel(sq.classId, lang)} · {sq.chapterGroup}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeStagedItem(sq.tempId)}
                                className="p-1 text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a]"
                                aria-label="Remove staged question"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Live Furigana Preview */}
                            <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[12px] px-3.5 py-2.5 text-[14px] text-[#1d1d1f] dark:text-[#f5f5f7] leading-relaxed">
                              <FuriganaText text={sq.prompt} showFurigana={showRuby} />
                            </div>

                            {/* Editable Fields */}
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                              <select
                                value={sq.category}
                                onChange={(e) =>
                                  updateStagedItem(sq.tempId, {
                                    category: e.target.value as StagedGeneratedQuestion['category'],
                                  })
                                }
                                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                              >
                                {QUESTION_CATEGORIES.filter((c) => c.id !== 'listening').map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {lang === 'ja' ? c.ja : c.idLabel}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={sq.questionFormat}
                                onChange={(e) =>
                                  updateStagedItem(sq.tempId, {
                                    questionFormat: e.target.value as 'multiple_choice' | 'written',
                                  })
                                }
                                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                              >
                                <option value="multiple_choice">Pilihan Ganda</option>
                                <option value="written">Isian / Tertulis</option>
                              </select>
                              <input
                                type="text"
                                maxLength={100}
                                value={sq.chapterGroup}
                                onChange={(e) =>
                                  updateStagedItem(sq.tempId, { chapterGroup: e.target.value })
                                }
                                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                              />
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={sq.points}
                                onChange={(e) =>
                                  updateStagedItem(sq.tempId, {
                                    points: clampNum(Number(e.target.value), 1, 100),
                                  })
                                }
                                className="glass-input px-2.5 py-1.5 text-[12px] font-mono tabular-nums rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                              />
                            </div>

                            <textarea
                              rows={2}
                              maxLength={1000}
                              value={sq.prompt}
                              onChange={(e) =>
                                updateStagedItem(sq.tempId, { prompt: e.target.value })
                              }
                              className="glass-input w-full px-3 py-2 text-[13px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                            />

                            {sq.questionFormat === 'multiple_choice' && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[0, 1, 2, 3].map((oi) => (
                                  <input
                                    key={oi}
                                    type="text"
                                    maxLength={200}
                                    value={sq.options[oi] || ''}
                                    onChange={(e) => {
                                      const nextOpts = [...sq.options];
                                      nextOpts[oi] = e.target.value;
                                      updateStagedItem(sq.tempId, { options: nextOpts });
                                    }}
                                    placeholder={`Opsi ${String.fromCharCode(65 + oi)}`}
                                    className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                                  />
                                ))}
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                type="text"
                                maxLength={300}
                                value={sq.correctAnswer}
                                onChange={(e) =>
                                  updateStagedItem(sq.tempId, { correctAnswer: e.target.value })
                                }
                                placeholder="Kunci Jawaban"
                                className="glass-input px-2.5 py-1.5 text-[12px] font-medium rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                              />
                              <input
                                type="text"
                                maxLength={500}
                                value={sq.explanation}
                                onChange={(e) =>
                                  updateStagedItem(sq.tempId, { explanation: e.target.value })
                                }
                                placeholder="Penjelasan / Terjemahan Bahasa Indonesia"
                                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sticky Footer for Staging Save */}
          {activeModalTab === 'generator' && stagedQuestions.length > 0 && (
            <div className="shrink-0 px-5 sm:px-6 py-3.5 border-t border-[#d2d2d7]/60 dark:border-[#424245] bg-white dark:bg-[#1d1d1f] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-[12px]">
                {!isHead ? (
                  <label className="inline-flex items-center gap-2 text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={submitForReview}
                      onChange={(e) => setSubmitForReview(e.target.checked)}
                      className="rounded border-[#d2d2d7] text-[#0071e3]"
                    />
                    <span>
                      {lang === 'ja'
                        ? '下書きではなく管理者レビューへ提出（Pending）'
                        : 'Langsung ajukan ke Review Admin (Pending), atau biarkan unchecked untuk Draft'}
                    </span>
                  </label>
                ) : (
                  <span className="text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'ja'
                      ? '※自動公開されません：問題バンクへ「下書き (Draft)」として保存されます。'
                      : 'Disimpan sebagai Draft di Bank Soal (review & setujui secara terpisah, tidak auto-publish).'}
                  </span>
                )}
              </div>

              <button
                type="button"
                disabled={savingStaged || selectedStaged.length === 0}
                onClick={handleSaveSelectedToBank}
                className="apple-btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium disabled:opacity-40"
              >
                {savingStaged ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>
                  {lang === 'ja'
                    ? `${selectedStaged.length}問を問題バンクへ保存`
                    : `Simpan ${selectedStaged.length} Soal ke Bank Soal`}
                </span>
              </button>
            </div>
          )}
        </AppleModalSheet>
      )}
    </AnimatePresence>
  );
}
