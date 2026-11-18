import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Check, ClipboardCheck, Download, FileText, KeyRound, Pencil, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { categoryLabel, classLabel, tr, UI_TEXT } from '../i18n';
import {
  ClassId,
  CLASSES,
  LanguageMode,
  QUESTION_CATEGORIES,
  QuestionCategory,
  QuestionItem,
  Student,
  TestResult,
  TestSheet,
  TestType,
  UserProfile,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { getClassTheme } from '../utils/classTheme';
import { getTodayDateStr, getWeekKey } from '../utils/dateUtils';
import { clampArray, clampNum, clampStr, sanitizeDateStr } from '../utils/payloadGuards';
import { exportTestResultsXlsx } from '../utils/reportExport';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import { AppleModalSheet, APPLE_EASE } from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  questions: QuestionItem[];
  testSheets: TestSheet[];
  testResults: TestResult[];
  initialSheetId?: string | null;
  onRegisterPrintView: (node: React.ReactNode | null) => void;
  onSelectStudent?: (stu: Student) => void;
}

type GradingMode = 'count_batch' | 'per_question' | 'manual';

export function TestGradingView({
  lang,
  profile,
  students,
  questions,
  testSheets,
  testResults,
  initialSheetId,
  onRegisterPrintView,
  onSelectStudent,
}: Props) {
  const defaultClass: ClassId =
    profile.assignedClasses.length > 0 ? profile.assignedClasses[0] : 'hokkaido';

  const [mode, setMode] = useState<GradingMode>('count_batch');
  const [selectedClass, setSelectedClass] = useState<ClassId>(defaultClass);
  const [selectedSheetId, setSelectedSheetId] = useState<string>(initialSheetId || '');
  const [showKeyRef, setShowKeyRef] = useState<boolean>(false);

  // Mode 1: Batch "Input Jumlah Benar" (enter correct count per student)
  const [studentFilterId, setStudentFilterId] = useState<string>('all');
  const [correctCounts, setCorrectCounts] = useState<Record<string, { count: string; note: string }>>({});

  // Mode 2: Per-question ○/× check
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [outcomes, setOutcomes] = useState<boolean[]>([]);
  const [gradeNote, setGradeNote] = useState<string>('');

  // Mode 3: Manual Batch Input (without a Test Sheet)
  const [manualType, setManualType] = useState<TestType>('daily');
  const [manualDate, setManualDate] = useState<string>(getTodayDateStr());
  const [manualTitle, setManualTitle] = useState<string>('');
  const [manualCategory, setManualCategory] = useState<QuestionCategory>('vocab');
  const [manualMaxScore, setManualMaxScore] = useState<number>(100);
  const [batchScores, setBatchScores] = useState<Record<string, { score: string; note: string }>>({});

  // Edit existing score modal state
  const [editingResult, setEditingResult] = useState<TestResult | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editType, setEditType] = useState<TestType>('daily');
  const [editDate, setEditDate] = useState('');
  const [editScore, setEditScore] = useState<number>(0);
  const [editMaxScore, setEditMaxScore] = useState<number>(100);
  const [editNote, setEditNote] = useState('');

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TestResult | null>(null);
  const [resultsClassFilter, setResultsClassFilter] = useState<ClassId | 'all'>('all');

  const classTheme = getClassTheme(selectedClass);

  // Sync when navigated directly from a Test Sheet
  useEffect(() => {
    if (initialSheetId) {
      const target = testSheets.find((s) => s.id === initialSheetId);
      if (target) {
        setSelectedClass(target.classId);
      }
      setSelectedSheetId(initialSheetId);
      setMode('count_batch');
    }
  }, [initialSheetId, testSheets]);

  // Filter Test Sheets by selectedClass
  const classTestSheets = useMemo(() => {
    return testSheets
      .filter((s) => s.classId === selectedClass)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [testSheets, selectedClass]);

  // Auto-select first sheet when class changes
  useEffect(() => {
    if (classTestSheets.length > 0) {
      if (!classTestSheets.some((s) => s.id === selectedSheetId)) {
        setSelectedSheetId(classTestSheets[0].id);
      }
    } else {
      setSelectedSheetId('');
    }
  }, [classTestSheets, selectedSheetId]);

  const activeSheet = useMemo(
    () => testSheets.find((s) => s.id === selectedSheetId) || null,
    [testSheets, selectedSheetId]
  );

  const sheetQuestions = useMemo(() => {
    if (!activeSheet) return [];
    const qMap = new Map(questions.map((q) => [q.id, q]));
    return activeSheet.questionIds
      .map((id) => qMap.get(id))
      .filter((q): q is QuestionItem => Boolean(q));
  }, [activeSheet, questions]);

  const classStudents = useMemo(() => {
    return students
      .filter((s) => s.classId === selectedClass && s.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students, selectedClass]);

  const displayedCountStudents = useMemo(() => {
    if (studentFilterId === 'all') return classStudents;
    return classStudents.filter((s) => s.id === studentFilterId);
  }, [classStudents, studentFilterId]);

  // Reset filter & pre-fill existing scores when sheet or class changes
  useEffect(() => {
    setStudentFilterId('all');
    if (!activeSheet) {
      setCorrectCounts({});
      return;
    }
    const qCount = Math.max(1, sheetQuestions.length || activeSheet.questionIds.length);
    const maxPts = activeSheet.totalPoints || qCount;
    const prefill: Record<string, { count: string; note: string }> = {};
    classStudents.forEach((stu) => {
      const existing = testResults.find(
        (r) => r.sheetId === activeSheet.id && r.studentId === stu.id
      );
      if (existing) {
        const approxCorrect = Math.round((existing.earnedScore / (existing.maxScore || maxPts)) * qCount);
        prefill[stu.id] = { count: String(approxCorrect), note: existing.note || '' };
      }
    });
    setCorrectCounts(prefill);
  }, [activeSheet?.id, classStudents.length]);

  // Auto-select first student for Mode 2
  useEffect(() => {
    if (classStudents.length > 0 && !classStudents.some((s) => s.id === selectedStudentId)) {
      setSelectedStudentId(classStudents[0].id);
    }
  }, [classStudents, selectedStudentId]);

  // Load existing outcomes for Mode 2
  useEffect(() => {
    if (!activeSheet || !selectedStudentId) {
      setOutcomes([]);
      setGradeNote('');
      return;
    }
    const existing = testResults.find(
      (r) => r.sheetId === activeSheet.id && r.studentId === selectedStudentId
    );
    if (existing && existing.questionOutcomes.length === sheetQuestions.length) {
      setOutcomes([...existing.questionOutcomes]);
      setGradeNote(existing.note || '');
    } else {
      setOutcomes(sheetQuestions.map(() => true));
      setGradeNote('');
    }
  }, [activeSheet, selectedStudentId, sheetQuestions.length, testResults]);

  const maxSheetScore = useMemo(() => {
    const sum = sheetQuestions.reduce((s, q) => s + (q.points || 1), 0);
    return sum > 0 ? sum : activeSheet?.totalPoints || 1;
  }, [sheetQuestions, activeSheet]);

  const totalQuestionCount = Math.max(
    1,
    sheetQuestions.length || activeSheet?.questionIds.length || 1
  );

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  };

  // Save Batch "Input Jumlah Benar"
  const handleSaveCountBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSheet) return;

    const toSave = displayedCountStudents.filter((stu) => {
      const raw = correctCounts[stu.id]?.count;
      return raw !== undefined && raw !== '' && !isNaN(Number(raw));
    });
    if (toSave.length === 0) return;

    setSaving(true);
    const primaryCat = sheetQuestions[0]?.category || 'vocab';

    try {
      for (const stu of toSave) {
        const rawNum = Number(correctCounts[stu.id].count);
        const clampedCorrect = clampNum(rawNum, 0, totalQuestionCount);
        const pct = Math.round((clampedCorrect / totalQuestionCount) * 100);
        const earned = Math.round((clampedCorrect / totalQuestionCount) * maxSheetScore);

        const existing = testResults.find(
          (r) => r.sheetId === activeSheet.id && r.studentId === stu.id
        );

        const payload = {
          studentId: stu.id,
          studentName: clampStr(stu.name, 120),
          classId: activeSheet.classId,
          testType: activeSheet.testType,
          date: activeSheet.date,
          weekKey: activeSheet.weekKey,
          sheetId: activeSheet.id,
          testTitle: clampStr(activeSheet.title, 150),
          category: primaryCat,
          entryMode: 'answer_key' as const,
          earnedScore: clampNum(earned, 0, 1000),
          maxScore: clampNum(maxSheetScore, 1, 1000),
          scorePercent: clampNum(pct, 0, 100),
          questionOutcomes: [] as boolean[],
          wrongCategories: pct < 70 ? [primaryCat] : ([] as string[]),
          note: clampStr(correctCounts[stu.id]?.note || '', 500),
          gradedBy: profile.uid,
          gradedByName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
        };

        if (existing) {
          await updateDoc(doc(db, 'testResults', existing.id), {
            ...payload,
            updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, 'testResults'), {
            ...payload,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        await logActivity({
          actor: profile,
          actionType: existing ? 'data_update' : 'data_create',
          targetType: 'testResult',
          targetLabel: `${stu.name} — ${activeSheet.title}`,
          detail: `${earned}/${maxSheetScore} (${pct}%) [${activeSheet.testType}]`,
        });
      }

      flashToast(
        lang === 'ja'
          ? `${toSave.length}名分の点数を自動計算して保存しました`
          : `Berhasil menghitung & menyimpan nilai untuk ${toSave.length} siswa`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'testResults');
    } finally {
      setSaving(false);
    }
  };

  // Mode 2 computations
  const earnedScoreMode2 = useMemo(() => {
    return sheetQuestions.reduce((sum, q, idx) => sum + (outcomes[idx] ? q.points || 1 : 0), 0);
  }, [sheetQuestions, outcomes]);

  const scorePercentMode2 = Math.round((earnedScoreMode2 / maxSheetScore) * 100);

  const wrongCategoriesMode2 = useMemo(() => {
    const arr: string[] = [];
    sheetQuestions.forEach((q, idx) => {
      if (!outcomes[idx]) arr.push(q.category);
    });
    return arr;
  }, [sheetQuestions, outcomes]);

  const handleSavePerQuestion = async (goNext: boolean) => {
    if (!activeSheet || !selectedStudentId) return;
    const stu = classStudents.find((s) => s.id === selectedStudentId);
    if (!stu) return;

    setSaving(true);
    const existing = testResults.find(
      (r) => r.sheetId === activeSheet.id && r.studentId === stu.id
    );
    const primaryCat = sheetQuestions[0]?.category || 'vocab';

    const payload = {
      studentId: stu.id,
      studentName: clampStr(stu.name, 120),
      classId: activeSheet.classId,
      testType: activeSheet.testType,
      date: activeSheet.date,
      weekKey: activeSheet.weekKey,
      sheetId: activeSheet.id,
      testTitle: clampStr(activeSheet.title, 150),
      category: primaryCat,
      entryMode: 'answer_key' as const,
      earnedScore: clampNum(earnedScoreMode2, 0, 1000),
      maxScore: clampNum(maxSheetScore, 1, 1000),
      scorePercent: clampNum(scorePercentMode2, 0, 100),
      questionOutcomes: clampArray(outcomes, 100),
      wrongCategories: clampArray(wrongCategoriesMode2, 100),
      note: clampStr(gradeNote, 500),
      gradedBy: profile.uid,
      gradedByName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
    };

    try {
      if (existing) {
        await updateDoc(doc(db, 'testResults', existing.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'testResults'), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await logActivity({
        actor: profile,
        actionType: existing ? 'data_update' : 'data_create',
        targetType: 'testResult',
        targetLabel: `${stu.name} — ${activeSheet.title}`,
        detail: `${earnedScoreMode2}/${maxSheetScore} (${scorePercentMode2}%) [${activeSheet.testType}]`,
      });

      flashToast(`${stu.name}: ${earnedScoreMode2}/${maxSheetScore} (${scorePercentMode2}%)`);

      if (goNext) {
        const currentIndex = classStudents.findIndex((s) => s.id === stu.id);
        const nextStu = classStudents[currentIndex + 1];
        if (nextStu) setSelectedStudentId(nextStu.id);
      }
    } catch (err) {
      handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, 'testResults');
    } finally {
      setSaving(false);
    }
  };

  // Mode 3: Manual batch save
  const handleSaveManualBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = clampStr(manualTitle, 150);
    if (!cleanTitle) return;
    const cleanDate = sanitizeDateStr(manualDate, getTodayDateStr());
    const weekKey = getWeekKey(cleanDate);
    const maxSc = clampNum(manualMaxScore, 1, 1000);

    const entries = classStudents.filter((stu) => {
      const raw = batchScores[stu.id]?.score;
      return raw !== undefined && raw !== '' && !isNaN(Number(raw));
    });
    if (entries.length === 0) return;

    setSaving(true);
    try {
      for (const stu of entries) {
        const val = clampNum(Number(batchScores[stu.id].score), 0, maxSc);
        const pct = Math.round((val / maxSc) * 100);
        await addDoc(collection(db, 'testResults'), {
          studentId: stu.id,
          studentName: clampStr(stu.name, 120),
          classId: selectedClass,
          testType: manualType,
          date: cleanDate,
          weekKey,
          sheetId: '',
          testTitle: cleanTitle,
          category: manualCategory,
          entryMode: 'manual',
          earnedScore: val,
          maxScore: maxSc,
          scorePercent: pct,
          questionOutcomes: [],
          wrongCategories: pct < 70 ? [manualCategory] : [],
          note: clampStr(batchScores[stu.id]?.note || '', 500),
          gradedBy: profile.uid,
          gradedByName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        await logActivity({
          actor: profile,
          actionType: 'data_create',
          targetType: 'testResult',
          targetLabel: `${stu.name} — ${cleanTitle}`,
          detail: `${val}/${maxSc} (${pct}%) [${manualType}]`,
        });
      }
      setBatchScores({});
      setManualTitle('');
      flashToast(
        lang === 'ja'
          ? `${entries.length}名分の点数を保存しました`
          : `Berhasil menyimpan nilai untuk ${entries.length} siswa`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'testResults');
    } finally {
      setSaving(false);
    }
  };

  const openEditResult = (r: TestResult) => {
    setEditingResult(r);
    setEditTitle(r.testTitle);
    setEditType(r.testType);
    setEditDate(r.date);
    setEditScore(r.earnedScore);
    setEditMaxScore(r.maxScore);
    setEditNote(r.note || '');
  };

  const handleSaveEditResult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingResult) return;
    const cleanTitle = clampStr(editTitle, 150) || editingResult.testTitle;
    const cleanDate = sanitizeDateStr(editDate, editingResult.date);
    const maxSc = clampNum(editMaxScore, 1, 1000);
    const earned = clampNum(editScore, 0, maxSc);
    const pct = Math.round((earned / maxSc) * 100);

    setSaving(true);
    try {
      await updateDoc(doc(db, 'testResults', editingResult.id), {
        testTitle: cleanTitle,
        testType: editType,
        date: cleanDate,
        weekKey: getWeekKey(cleanDate),
        earnedScore: earned,
        maxScore: maxSc,
        scorePercent: pct,
        note: clampStr(editNote, 500),
        gradedBy: profile.uid,
        gradedByName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
        updatedAt: serverTimestamp(),
      });

      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'testResult',
        targetLabel: `${editingResult.studentName} — ${cleanTitle}`,
        detail: `${editingResult.scorePercent}% → ${pct}% (${earned}/${maxSc}) [${editType}]`,
      });

      setEditingResult(null);
      flashToast(
        lang === 'ja' ? '採点結果を更新しました' : 'Nilai siswa berhasil diperbarui'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `testResults/${editingResult.id}`);
    } finally {
      setSaving(false);
    }
  };

  const modeTabs: { id: GradingMode; label: string }[] = [
    {
      id: 'count_batch',
      label:
        lang === 'ja'
          ? '正解数を入力（一括自動計算）'
          : 'Input Jumlah Benar (Otomatis)',
    },
    {
      id: 'per_question',
      label: lang === 'ja' ? '1問ずつ ○/× 採点' : 'Cek Per Soal (○ / ×)',
    },
    {
      id: 'manual',
      label:
        lang === 'ja'
          ? '手動スコア入力（用紙なし）'
          : 'Input Nilai Manual (Tanpa Bank Soal)',
    },
  ];

  return (
    <div className="space-y-6">
      <LiquidToast message={toast} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {tr(UI_TEXT.navGrading, lang)}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'ja'
              ? 'クラスとテストを選択し、正解数を入力するだけで自動採点・学生別成績へ登録されます。'
              : 'Pilih kelas & soal ujian, lalu cukup masukkan jumlah jawaban benar — nilai otomatis terhitung dan masuk ke rekap masing-masing siswa.'}
          </p>
        </div>
        {classTheme && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7]">
            <span className={`w-2 h-2 rounded-full ${classTheme.dotColor}`} />
            <span>{classLabel(selectedClass, lang)}</span>
          </div>
        )}
      </div>

      {/* Mode Switch Segmented Control */}
      <div className="flex flex-wrap gap-1 p-1 rounded-full bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245] w-fit">
        {modeTabs.map((t) => {
          const isActive = mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setMode(t.id)}
              className={`relative px-4 py-1.5 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 ${
                isActive
                  ? 'text-white'
                  : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="gradingModePill"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  className="absolute inset-0 bg-[#0071e3] dark:bg-[#2997ff] rounded-full"
                />
              )}
              <span className="relative z-10">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Shared Class + Test Sheet Selector for count_batch & per_question */}
      {mode !== 'manual' ? (
        <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
          {/* Step 1 & 2: Class + Test Sheet */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-4">
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                {lang === 'ja' ? '1. クラスを選択' : '1. Pilih Kelas'}
              </label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value as ClassId)}
                className="w-full px-3 py-2 text-[14px] glass-input rounded-[12px]"
              >
                {CLASSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {classLabel(c.id, lang)}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-6">
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                {lang === 'ja' ? '2. テスト用紙を選択（問題・解答キー）' : '2. Pilih Soal & Kunci Jawaban'}
              </label>
              <select
                value={selectedSheetId}
                onChange={(e) => setSelectedSheetId(e.target.value)}
                className="w-full px-3 py-2 text-[14px] glass-input rounded-[12px]"
              >
                {classTestSheets.length === 0 ? (
                  <option value="">
                    {lang === 'ja'
                      ? 'このクラスのテスト用紙がまだありません'
                      : 'Belum ada lembar tes untuk kelas ini'}
                  </option>
                ) : (
                  classTestSheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.date} · {s.title} ({s.questionIds.length}{' '}
                      {lang === 'ja' ? '問' : 'soal'} / {s.totalPoints} pt)
                    </option>
                  ))
                )}
              </select>
            </div>

            {activeSheet && (
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => setShowKeyRef((v) => !v)}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-[13px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#0066cc] dark:text-[#2997ff]" />
                  <span>
                    {showKeyRef
                      ? lang === 'ja'
                        ? '解答を隠す'
                        : 'Tutup Kunci'
                      : lang === 'ja'
                      ? '解答キー'
                      : 'Lihat Kunci'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Optional Quick Answer Key Reference */}
          <AnimatePresence>
            {showKeyRef && activeSheet && sheetQuestions.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: APPLE_EASE }}
                className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-4 space-y-3"
              >
                <div className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'ja' ? '解答キー一覧' : 'Referensi Kunci Jawaban'}: {activeSheet.title}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 text-[12px]">
                  {sheetQuestions.map((q, i) => (
                    <div
                      key={q.id}
                      className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/50 dark:border-[#424245] rounded-[10px] px-2.5 py-1.5"
                    >
                      <span className="font-mono text-[#6e6e73] dark:text-[#86868b] mr-1.5">
                        Q{i + 1}:
                      </span>
                      <span className="font-semibold text-[#0066cc] dark:text-[#2997ff]">
                        {q.correctAnswer}
                      </span>
                    </div>
                  ))}
                </div>
                {sheetQuestions.some((q) => Boolean(q.audioDataUrl)) && (
                  <div className="pt-2 border-t border-[#d2d2d7]/60 dark:border-[#424245] space-y-2">
                    <div className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {lang === 'ja' ? '聴解音声 / Audio Choukai:' : 'Audio Tes Choukai:'}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {sheetQuestions.map((q, i) =>
                        q.audioDataUrl ? (
                          <div
                            key={q.id}
                            className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/50 dark:border-[#424245] rounded-[12px] p-2.5"
                          >
                            <div className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b] mb-1 truncate">
                              Q{i + 1}. {q.audioFileName || 'Choukai Audio'}
                            </div>
                            <audio controls src={q.audioDataUrl} className="w-full h-8" />
                          </div>
                        ) : null
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!activeSheet ? (
            <EmptyStateIllustration
              kind="clipboard"
              title={
                lang === 'ja'
                  ? 'テスト用紙が選択されていません'
                  : 'Belum ada lembar tes untuk kelas ini'
              }
              subtitle={
                lang === 'ja'
                  ? '「問題バンク・印刷」タブでこのクラスのテスト用紙を作成すると、ここで自動採点できます。'
                  : 'Buat lembar tes untuk kelas ini di tab Bank Soal agar bisa langsung input jumlah benar di sini.'
              }
            />
          ) : classStudents.length === 0 ? (
            <EmptyStateIllustration
              kind="users"
              title={
                lang === 'ja'
                  ? 'このクラスにまだ学生が登録されていません'
                  : 'Belum ada siswa terdaftar di kelas ini'
              }
              subtitle={
                lang === 'ja'
                  ? '「学生名簿」タブから学生を追加してください。'
                  : 'Tambahkan siswa dulu di menu Siswa.'
              }
            />
          ) : mode === 'count_batch' ? (
            /* MODE 1: Fast Batch Input Jumlah Benar */
            <form
              onSubmit={handleSaveCountBatch}
              className="space-y-4 pt-3 border-t border-[#d2d2d7]/60 dark:border-[#424245]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'ja'
                    ? `全 ${totalQuestionCount} 問中の正解数を入力 → 100%満点（${maxSheetScore}点）に自動換算して保存します`
                    : `Masukkan jumlah soal benar dari total ${totalQuestionCount} soal → nilai otomatis dihitung & masuk ke siswa`}
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'ja' ? '学生絞り込み:' : 'Pilih Siswa:'}
                  </label>
                  <select
                    value={studentFilterId}
                    onChange={(e) => setStudentFilterId(e.target.value)}
                    className="px-2.5 py-1.5 text-[12px] glass-input rounded-[10px]"
                  >
                    <option value="all">
                      {lang === 'ja'
                        ? `クラス全員 (${classStudents.length}名)`
                        : `Semua Siswa (${classStudents.length})`}
                    </option>
                    {classStudents.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="apple-table-wrap apple-scroll-x max-h-[520px] overflow-y-auto">
                <table className="w-full text-[14px] text-left border-collapse">
                  <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                    <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                      <th className="py-2.5 px-3 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[15]">
                        学生氏名 / Nama Siswa
                      </th>
                      <th className="py-2.5 px-3 font-medium w-44">
                        正解数 / Benar (/{totalQuestionCount})
                      </th>
                      <th className="py-2.5 px-3 font-medium w-36">
                        自動計算 / Nilai
                      </th>
                      <th className="py-2.5 px-3 font-medium">メモ / Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCountStudents.map((stu) => {
                      const entry = correctCounts[stu.id] || { count: '', note: '' };
                      const hasVal = entry.count !== '' && !isNaN(Number(entry.count));
                      const clamped = hasVal
                        ? clampNum(Number(entry.count), 0, totalQuestionCount)
                        : null;
                      const pct =
                        clamped !== null
                          ? Math.round((clamped / totalQuestionCount) * 100)
                          : null;
                      const pts =
                        clamped !== null
                          ? Math.round((clamped / totalQuestionCount) * maxSheetScore)
                          : null;

                      return (
                        <tr key={stu.id} className="apple-table-row">
                          <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                            {stu.name}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                min={0}
                                max={totalQuestionCount}
                                value={entry.count}
                                onChange={(e) =>
                                  setCorrectCounts((prev) => ({
                                    ...prev,
                                    [stu.id]: { ...entry, count: e.target.value },
                                  }))
                                }
                                placeholder="0"
                                className="w-24 px-2.5 py-1.5 text-[14px] font-mono tabular-nums glass-input rounded-[10px]"
                              />
                              <span className="text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                                / {totalQuestionCount}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums">
                            {pct !== null ? (
                              <span
                                className={`text-[14px] font-semibold ${
                                  pct >= 70
                                    ? 'text-[#15803d] dark:text-[#30d158]'
                                    : 'text-[#dc2626] dark:text-[#ff453a]'
                                }`}
                              >
                                {pct}%{' '}
                                <span className="text-[12px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                                  ({pts}/{maxSheetScore})
                                </span>
                              </span>
                            ) : (
                              <span className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <input
                              type="text"
                              maxLength={500}
                              value={entry.note}
                              onChange={(e) =>
                                setCorrectCounts((prev) => ({
                                  ...prev,
                                  [stu.id]: { ...entry, note: e.target.value },
                                }))
                              }
                              placeholder={lang === 'ja' ? '任意メモ' : 'Catatan opsional'}
                              className="w-full px-2.5 py-1.5 text-[12px] glass-input rounded-[10px]"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="sticky bottom-3 z-20 flex justify-end px-4 py-3 rounded-[16px] bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border border-[#d2d2d7]/60 dark:border-[#424245]">
                <button
                  type="submit"
                  disabled={saving}
                  className="apple-btn-primary inline-flex items-center gap-2 px-5 py-2 text-[14px] disabled:opacity-40 whitespace-nowrap"
                >
                  <ClipboardCheck className="w-4 h-4" />
                  <span>
                    {saving
                      ? lang === 'ja'
                        ? '保存中...'
                        : 'Menyimpan...'
                      : lang === 'ja'
                      ? '自動計算した点数を保存する'
                      : 'Hitung & Simpan Nilai ke Siswa'}
                  </span>
                </button>
              </div>
            </form>
          ) : (
            /* MODE 2: Per-Question ○/× Check */
            <div className="space-y-4 pt-3 border-t border-[#d2d2d7]/60 dark:border-[#424245]">
              <div className="max-w-sm">
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja' ? '学生を選択' : 'Pilih Siswa'}
                </label>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-[14px] glass-input rounded-[12px]"
                >
                  {classStudents.map((stu) => {
                    const graded = testResults.find(
                      (r) => r.sheetId === selectedSheetId && r.studentId === stu.id
                    );
                    return (
                      <option key={stu.id} value={stu.id}>
                        {stu.name} {graded ? `(${graded.scorePercent}%)` : '— 未採点'}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] px-4 py-3.5">
                <div>
                  <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'ja' ? '自動計算スコア' : 'Skor Otomatis'}
                  </div>
                  <div className="text-[22px] font-semibold font-mono tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {earnedScoreMode2} / {maxSheetScore}{' '}
                    <span className="text-[#0066cc] dark:text-[#2997ff] ml-1">({scorePercentMode2}%)</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOutcomes(sheetQuestions.map(() => true))}
                    className="px-3.5 py-1.5 text-[12px] font-medium bg-white dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap"
                  >
                    {lang === 'ja' ? 'すべて ○' : 'Semua Benar ○'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutcomes(sheetQuestions.map(() => false))}
                    className="px-3.5 py-1.5 text-[12px] font-medium bg-white dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap"
                  >
                    {lang === 'ja' ? 'すべて ×' : 'Semua Salah ×'}
                  </button>
                </div>
              </div>

              <div className="divide-y divide-[#d2d2d7]/60 dark:divide-[#424245] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] overflow-hidden bg-white dark:bg-[#1d1d1f]">
                {sheetQuestions.map((q, idx) => {
                  const isCorrect = outcomes[idx] ?? true;
                  return (
                    <div
                      key={q.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 apple-virtual-item"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] font-mono tabular-nums">
                          Q{idx + 1} · {categoryLabel(q.category, lang)} · {q.points} pt
                        </div>
                        <div className="text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {q.prompt}
                        </div>
                        {q.audioDataUrl && (
                          <div className="pt-1">
                            <audio controls src={q.audioDataUrl} className="h-8 max-w-xs" />
                          </div>
                        )}
                        <div className="text-[12px] text-[#0066cc] dark:text-[#2997ff] font-medium">
                          {lang === 'ja' ? '解答キー: ' : 'Kunci: '}
                          {q.correctAnswer}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            setOutcomes((prev) => prev.map((v, i) => (i === idx ? true : v)))
                          }
                          className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium rounded-full border transition-colors whitespace-nowrap ${
                            isCorrect
                              ? 'bg-[#16a34a] border-[#16a34a] text-white'
                              : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-[#d2d2d7]/60 dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b]'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{tr(UI_TEXT.correct, lang)}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setOutcomes((prev) => prev.map((v, i) => (i === idx ? false : v)))
                          }
                          className={`inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium rounded-full border transition-colors whitespace-nowrap ${
                            !isCorrect
                              ? 'bg-[#dc2626] border-[#dc2626] text-white'
                              : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-[#d2d2d7]/60 dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b]'
                          }`}
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>{tr(UI_TEXT.wrong, lang)}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="sticky bottom-3 z-20 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between px-4 py-3 rounded-[16px] bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border border-[#d2d2d7]/60 dark:border-[#424245]">
                <input
                  type="text"
                  maxLength={500}
                  value={gradeNote}
                  onChange={(e) => setGradeNote(e.target.value)}
                  placeholder={
                    lang === 'ja' ? '学生へのメモ（任意）' : 'Catatan untuk siswa ini (opsional)'
                  }
                  className="flex-1 px-3 py-2 text-[14px] glass-input rounded-[12px]"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSavePerQuestion(false)}
                    className="px-4 py-2 text-[13px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap"
                  >
                    {tr(UI_TEXT.save, lang)}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => handleSavePerQuestion(true)}
                    className="apple-btn-primary inline-flex items-center gap-2 px-5 py-2 text-[13px] whitespace-nowrap"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    <span>
                      {lang === 'ja' ? '保存して次の学生へ' : 'Simpan & Siswa Berikutnya'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* MODE 3: Manual Batch Input */
        <form
          onSubmit={handleSaveManualBatch}
          className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <select
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value as ClassId)}
              className="px-3 py-2 text-[14px] glass-input rounded-[12px]"
            >
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>

            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value as TestType)}
              className="px-3 py-2 text-[14px] glass-input rounded-[12px]"
            >
              <option value="daily">{tr(UI_TEXT.daily, lang)}</option>
              <option value="weekly">{tr(UI_TEXT.weekly, lang)}</option>
            </select>

            <select
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value as QuestionCategory)}
              className="px-3 py-2 text-[14px] glass-input rounded-[12px]"
            >
              {QUESTION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.id, lang)}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="px-3 py-2 text-[13px] font-mono tabular-nums glass-input rounded-[12px]"
            />

            <input
              type="number"
              min={1}
              max={1000}
              value={manualMaxScore}
              onChange={(e) => setManualMaxScore(Number(e.target.value))}
              placeholder="満点 / Max (100)"
              className="px-3 py-2 text-[13px] font-mono tabular-nums glass-input rounded-[12px]"
            />
          </div>

          <input
            type="text"
            required
            maxLength={150}
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder={
              lang === 'ja'
                ? 'テスト名（例: 第6課 小テスト / 会話テスト）*'
                : 'Nama Tes (mis: Tes Harian Bab 6 / Tes Percakapan) *'
            }
            className="w-full px-3.5 py-2 text-[14px] glass-input rounded-[12px]"
          />

          {classStudents.length === 0 ? (
            <EmptyStateIllustration
              kind="users"
              title={
                lang === 'ja'
                  ? 'このクラスにはまだ学生が登録されていません'
                  : 'Belum ada siswa aktif di kelas ini'
              }
            />
          ) : (
            <div className="apple-table-wrap apple-scroll-x max-h-[520px] overflow-y-auto">
              <table className="w-full text-[14px] text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                  <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    <th className="py-2.5 px-3 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[15]">
                      学生 / Siswa
                    </th>
                    <th className="py-2.5 px-3 font-medium w-36">
                      点数 / Nilai (/{manualMaxScore})
                    </th>
                    <th className="py-2.5 px-3 font-medium w-24">%</th>
                    <th className="py-2.5 px-3 font-medium">メモ / Catatan</th>
                  </tr>
                </thead>
                <tbody>
                  {classStudents.map((stu) => {
                    const entry = batchScores[stu.id] || { score: '', note: '' };
                    const pct =
                      entry.score !== '' && !isNaN(Number(entry.score))
                        ? Math.round((Number(entry.score) / (manualMaxScore || 1)) * 100)
                        : null;
                    return (
                      <tr key={stu.id} className="apple-table-row">
                        <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                          {stu.name}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="number"
                            min={0}
                            max={manualMaxScore}
                            value={entry.score}
                            onChange={(e) =>
                              setBatchScores((prev) => ({
                                ...prev,
                                [stu.id]: { ...entry, score: e.target.value },
                              }))
                            }
                            placeholder="0"
                            className="w-28 px-2.5 py-1.5 text-[14px] font-mono tabular-nums glass-input rounded-[10px]"
                          />
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {pct !== null ? `${pct}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <input
                            type="text"
                            maxLength={500}
                            value={entry.note}
                            onChange={(e) =>
                              setBatchScores((prev) => ({
                                ...prev,
                                [stu.id]: { ...entry, note: e.target.value },
                              }))
                            }
                            placeholder={lang === 'ja' ? '任意メモ' : 'Catatan opsional'}
                            className="w-full px-2.5 py-1.5 text-[12px] glass-input rounded-[10px]"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="sticky bottom-3 z-20 flex justify-end px-4 py-3 rounded-[16px] bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border border-[#d2d2d7]/60 dark:border-[#424245]">
            <button
              type="submit"
              disabled={saving || classStudents.length === 0}
              className="apple-btn-primary px-5 py-2 text-[14px] disabled:opacity-40 whitespace-nowrap"
            >
              {lang === 'ja' ? 'クラス全員の点数を保存' : 'Simpan Semua Nilai Kelas'}
            </button>
          </div>
        </form>
      )}

      {/* Recorded Test Results Log with Edit/Delete + Excel & PDF Export */}
      {(() => {
        const filteredLogResults = [...testResults]
          .filter((r) => (resultsClassFilter === 'all' ? true : r.classId === resultsClassFilter))
          .sort((a, b) => b.date.localeCompare(a.date));

        const handlePrintResultsPdf = () => {
          const node = (
            <div className="print-sheet bg-white text-black p-4 space-y-4 text-xs">
              <div className="border-b-2 border-black pb-2.5 flex items-end justify-between">
                <div>
                  <div className="text-[11px] font-semibold text-black">
                    元気アカデミー / GENKI ACADEMY
                  </div>
                  <h1 className="text-lg font-bold text-black">
                    {lang === 'id' ? 'Rekap Nilai Tes Siswa' : 'テスト成績一覧表'}
                  </h1>
                  <div className="text-[11px] text-black">
                    {classLabel(resultsClassFilter, lang)} · {filteredLogResults.length}{' '}
                    {lang === 'id' ? 'data' : '件'}
                  </div>
                </div>
                <div className="text-[11px] font-mono text-black">
                  {getTodayDateStr()}
                </div>
              </div>
              <table className="w-full text-[11px] text-left border-collapse border border-black">
                <thead>
                  <tr className="bg-neutral-100 border-b border-black">
                    <th className="p-1.5 border-r border-black">日付 / Tgl</th>
                    <th className="p-1.5 border-r border-black">クラス / Kelas</th>
                    <th className="p-1.5 border-r border-black">学生 / Siswa</th>
                    <th className="p-1.5 border-r border-black">テスト / Tes</th>
                    <th className="p-1.5 text-right">得点 / Nilai</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogResults.slice(0, 120).map((r) => (
                    <tr key={r.id} className="border-b border-black/30">
                      <td className="p-1.5 border-r border-black/40 font-mono">{r.date}</td>
                      <td className="p-1.5 border-r border-black/40">
                        {classLabel(r.classId, lang)}
                      </td>
                      <td className="p-1.5 border-r border-black/40 font-medium">
                        {r.studentName}
                      </td>
                      <td className="p-1.5 border-r border-black/40">{r.testTitle}</td>
                      <td className="p-1.5 font-mono text-right font-semibold">
                        {r.earnedScore}/{r.maxScore} ({r.scorePercent}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          onRegisterPrintView(node);
          setTimeout(() => window.print(), 100);
        };

        const executeDeleteResult = async () => {
          if (!deleteTarget) return;
          setSaving(true);
          try {
            await deleteDoc(doc(db, 'testResults', deleteTarget.id));
            await logActivity({
              actor: profile,
              actionType: 'data_delete',
              targetType: 'testResult',
              targetLabel: `${deleteTarget.studentName} — ${deleteTarget.testTitle}`,
              detail: `Deleted ${deleteTarget.scorePercent}% (${deleteTarget.date})`,
            });
            setDeleteTarget(null);
            flashToast(lang === 'ja' ? '成績を削除しました' : 'Nilai dihapus');
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, `testResults/${deleteTarget.id}`);
          } finally {
            setSaving(false);
          }
        };

        return (
          <>
            <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'id' ? 'Riwayat Nilai Terbaru' : 'テスト結果一覧'} (
                  <span className="font-mono tabular-nums">{filteredLogResults.length}</span>)
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={resultsClassFilter}
                    onChange={(e) => setResultsClassFilter(e.target.value as ClassId | 'all')}
                    className="px-2.5 py-1.5 text-[12px] glass-input rounded-[10px]"
                  >
                    <option value="all">{tr(UI_TEXT.allClasses, lang)}</option>
                    {CLASSES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {classLabel(c.id, lang)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={filteredLogResults.length === 0}
                    onClick={() =>
                      exportTestResultsXlsx({
                        results: filteredLogResults,
                        lang,
                        selectedClass: resultsClassFilter,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5 text-[#15803d] dark:text-[#30d158]" />
                    <span>{lang === 'id' ? 'Excel' : 'Excel出力'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={filteredLogResults.length === 0}
                    onClick={handlePrintResultsPdf}
                    className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'PDF / Cetak' : 'PDF出力'}</span>
                  </button>
                </div>
              </div>

              {filteredLogResults.length === 0 ? (
                <EmptyStateIllustration
                  kind="chart"
                  title={lang === 'id' ? 'Belum ada data nilai tes' : 'まだテスト結果がありません'}
                  subtitle={
                    lang === 'id'
                      ? 'Input nilai dari form di atas untuk melihat rekap nilai harian dan mingguan siswa.'
                      : '上のフォームから採点結果を登録すると一覧に表示されます。'
                  }
                />
              ) : (
                <div className="apple-table-wrap apple-scroll-x max-h-[540px] overflow-y-auto">
                  <table className="w-full text-[14px] text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                      <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        <th className="py-2.5 px-3 font-medium">
                          {lang === 'id' ? 'Tanggal' : '日付'}
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          {lang === 'id' ? 'Kelas' : 'クラス'}
                        </th>
                        <th className="py-2.5 px-3 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[15]">
                          {lang === 'id' ? 'Siswa' : '学生'}
                        </th>
                        <th className="py-2.5 px-3 font-medium">
                          {lang === 'id' ? 'Tes' : 'テスト'}
                        </th>
                        <th className="py-2.5 px-3 font-medium text-right">
                          {lang === 'id' ? 'Nilai' : '点数'}
                        </th>
                        <th className="py-2.5 px-3 text-right font-medium">
                          {lang === 'id' ? 'Aksi' : '操作'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogResults.slice(0, 40).map((r) => {
                        const rTheme = getClassTheme(r.classId);
                        return (
                          <tr key={r.id} className="apple-table-row">
                            <td className="py-2.5 px-3 font-mono text-[12px] tabular-nums text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                              {r.date}
                            </td>
                            <td className="py-2.5 px-3 text-[12px] whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {rTheme && (
                                  <span className={`w-1.5 h-1.5 rounded-full ${rTheme.dotColor}`} />
                                )}
                                <span>{classLabel(r.classId, lang)}</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5] whitespace-nowrap">
                              {(() => {
                                const stuObj = students.find((s) => s.id === r.studentId);
                                if (onSelectStudent && stuObj) {
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => onSelectStudent(stuObj)}
                                      className="text-left font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] transition-colors"
                                    >
                                      {r.studentName}
                                    </button>
                                  );
                                }
                                return r.studentName;
                              })()}
                            </td>
                            <td className="py-2.5 px-3 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                              {r.testTitle} ·{' '}
                              {r.testType === 'daily'
                                ? tr(UI_TEXT.daily, lang)
                                : tr(UI_TEXT.weekly, lang)}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-right whitespace-nowrap">
                              <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {r.earnedScore}/{r.maxScore}
                              </span>
                              <span
                                className={`ml-2 text-[12px] font-semibold ${
                                  r.scorePercent >= 70
                                    ? 'text-[#15803d] dark:text-[#30d158]'
                                    : 'text-[#dc2626] dark:text-[#ff453a]'
                                }`}
                              >
                                {r.scorePercent}%
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => openEditResult(r)}
                                  className="text-[#6e6e73] dark:text-[#86868b] hover:text-[#0066cc] dark:hover:text-[#2997ff] p-1.5 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                                  aria-label={`Edit result for ${r.studentName}`}
                                  title={lang === 'id' ? 'Edit nilai' : '点数を編集'}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(r)}
                                  className="text-[#6e6e73] dark:text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] p-1.5 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                                  aria-label={`Delete result for ${r.studentName}`}
                                  title={lang === 'id' ? 'Hapus nilai' : '削除'}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Edit Test Result Sheet */}
            <AnimatePresence>
              {editingResult && (
                <AppleModalSheet
                  open={true}
                  onClose={() => setEditingResult(null)}
                  maxWidthClass="max-w-lg"
                >
                  <form
                    onSubmit={handleSaveEditResult}
                    className="flex flex-col flex-1 min-h-0 overflow-hidden"
                  >
                    <div className="px-5 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between shrink-0">
                      <div>
                        <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {lang === 'id' ? 'Edit Nilai Siswa' : '採点結果を編集'}
                        </h3>
                        <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {editingResult.studentName} · {classLabel(editingResult.classId, lang)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditingResult(null)}
                        aria-label={tr(UI_TEXT.close, lang)}
                        className="p-1.5 rounded-full text-[#6e6e73] dark:text-[#86868b] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="p-5 flex-1 overflow-y-auto space-y-3">
                      <div>
                        <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'id' ? 'Judul Tes' : 'テスト名'}
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={150}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full px-3 py-2 text-[14px] glass-input rounded-[12px]"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                            {lang === 'id' ? 'Jenis Tes' : '種別'}
                          </label>
                          <select
                            value={editType}
                            onChange={(e) => setEditType(e.target.value as TestType)}
                            className="w-full px-3 py-2 text-[14px] glass-input rounded-[12px]"
                          >
                            <option value="daily">{tr(UI_TEXT.daily, lang)}</option>
                            <option value="weekly">{tr(UI_TEXT.weekly, lang)}</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                            {lang === 'id' ? 'Tanggal' : '日付'}
                          </label>
                          <input
                            type="date"
                            value={editDate}
                            onChange={(e) => setEditDate(e.target.value)}
                            className="w-full px-3 py-2 text-[13px] font-mono tabular-nums glass-input rounded-[12px]"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                            {lang === 'id' ? 'Skor Diperoleh' : '獲得点数'}
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={editMaxScore}
                            value={editScore}
                            onChange={(e) => setEditScore(Number(e.target.value))}
                            className="w-full px-3 py-2 text-[14px] font-mono tabular-nums glass-input rounded-[12px]"
                          />
                        </div>
                        <div>
                          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                            {lang === 'id' ? 'Skor Maksimal' : '満点'}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={editMaxScore}
                            onChange={(e) => setEditMaxScore(Number(e.target.value))}
                            className="w-full px-3 py-2 text-[14px] font-mono tabular-nums glass-input rounded-[12px]"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                          {lang === 'id' ? 'Catatan' : 'メモ'}
                        </label>
                        <input
                          type="text"
                          maxLength={500}
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          className="w-full px-3 py-2 text-[14px] glass-input rounded-[12px]"
                        />
                      </div>
                    </div>

                    <div className="px-5 py-3.5 border-t border-[#d2d2d7]/60 dark:border-[#424245] bg-white/90 dark:bg-[#1d1d1f]/90 apple-blur-overlay flex justify-end gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingResult(null)}
                        className="px-4 py-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors"
                      >
                        {tr(UI_TEXT.cancel, lang)}
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="apple-btn-primary px-5 py-2 text-[13px] disabled:opacity-50"
                      >
                        {tr(UI_TEXT.save, lang)}
                      </button>
                    </div>
                  </form>
                </AppleModalSheet>
              )}
            </AnimatePresence>

            <ConfirmDialog
              open={Boolean(deleteTarget)}
              lang={lang}
              busy={saving}
              title={lang === 'id' ? 'Hapus Nilai Tes Siswa?' : 'テスト結果を削除しますか？'}
              message={
                deleteTarget
                  ? lang === 'id'
                    ? `Nilai tes "${deleteTarget.testTitle}" milik ${deleteTarget.studentName} (${deleteTarget.scorePercent}%) akan dihapus.`
                    : `${deleteTarget.studentName} のテスト結果「${deleteTarget.testTitle}」（${deleteTarget.scorePercent}%）を削除します。`
                  : ''
              }
              onCancel={() => setDeleteTarget(null)}
              onConfirm={executeDeleteResult}
            />
          </>
        );
      })()}
    </div>
  );
}
