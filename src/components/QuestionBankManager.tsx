import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertCircle,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3,
  FileText,
  FolderInput,
  FolderOpen,
  KeyRound,
  Lock,
  Plus,
  Printer,
  Save,
  Square,
  Trash2,
  Upload,
  Volume2,
  X,
  XCircle,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { categoryLabel, classLabel, tr, UI_TEXT } from '../i18n';
import {
  ClassId,
  CLASSES,
  LanguageMode,
  QUESTION_CATEGORIES,
  QuestionCategory,
  QuestionItem,
  QuestionReviewStatus,
  TestSheet,
  TestType,
  UserProfile,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { effectiveQuestionStatus } from '../utils/analyticsUtils';
import { getClassTheme } from '../utils/classTheme';
import { getTodayDateStr, getWeekKey } from '../utils/dateUtils';
import { clampArray, clampNum, clampStr, sanitizeDateStr } from '../utils/payloadGuards';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import {
  AppleContextMenuTrigger,
  AppleModalSheet,
  ContextMenuItem,
  SwipeableMobileRow,
} from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  questions: QuestionItem[];
  testSheets: TestSheet[];
  initialReviewFilter?: QuestionReviewStatus | 'all';
  onStartGradingSheet: (sheetId: string) => void;
  onRegisterPrintView: (node: React.ReactNode | null) => void;
}

const DEFAULT_GROUP = 'Umum / 一般';
const MAX_AUDIO_DATA_URL_LEN = 740000;

function normalizeGroupName(raw?: string): string {
  const trimmed = (raw || '').trim();
  return trimmed || DEFAULT_GROUP;
}

function reviewBadgeMeta(status: QuestionReviewStatus, lang: LanguageMode) {
  if (status === 'approved') {
    return {
      label: lang === 'id' ? 'Disetujui' : '承認済',
      cls: 'bg-[#16a34a]/10 text-[#15803d] dark:text-[#30d158]',
    };
  }
  if (status === 'rejected') {
    return {
      label: lang === 'id' ? 'Ditolak' : '却下',
      cls: 'bg-[#dc2626]/10 text-[#dc2626] dark:text-[#ff453a]',
    };
  }
  if (status === 'draft') {
    return {
      label: lang === 'id' ? 'Draft' : '下書き',
      cls: 'bg-[#6e6e73]/12 text-[#6e6e73] dark:text-[#86868b]',
    };
  }
  return {
    label: lang === 'id' ? 'Menunggu Review' : '承認待ち',
    cls: 'bg-[#f59e0b]/12 text-[#b45309] dark:text-[#fcd34d]',
  };
}

export function QuestionBankManager({
  lang,
  profile,
  questions,
  testSheets,
  initialReviewFilter,
  onStartGradingSheet,
  onRegisterPrintView,
}: Props) {
  const isHead = profile.role === 'head';
  // Question creation form
  const [qClass, setQClass] = useState<ClassId | 'all'>('hokkaido');
  const [qCategory, setQCategory] = useState<QuestionCategory>('vocab');
  const [qTestType, setQTestType] = useState<TestType>('daily');
  const [qFormat, setQFormat] = useState<'multiple_choice' | 'written'>('multiple_choice');
  const [qGroupSelect, setQGroupSelect] = useState<string>('Bab 1');
  const [qGroupCustom, setQGroupCustom] = useState<string>('');
  const [qPrompt, setQPrompt] = useState('');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [qAnswer, setQAnswer] = useState('');
  const [qExplanation, setQExplanation] = useState('');
  const [qPoints, setQPoints] = useState(1);
  const [saveAsDraft, setSaveAsDraft] = useState(false);

  // Choukai audio upload state
  const [qAudioDataUrl, setQAudioDataUrl] = useState('');
  const [qAudioFileName, setQAudioFileName] = useState('');
  const [audioError, setAudioError] = useState('');
  const audioInputRef = useRef<HTMLInputElement | null>(null);

  // Edit Question Modal state
  const [editingQuestion, setEditingQuestion] = useState<QuestionItem | null>(null);
  const [editClass, setEditClass] = useState<ClassId | 'all'>('hokkaido');
  const [editCategory, setEditCategory] = useState<QuestionCategory>('vocab');
  const [editTestType, setEditTestType] = useState<TestType>('daily');
  const [editFormat, setEditFormat] = useState<'multiple_choice' | 'written'>('multiple_choice');
  const [editGroup, setEditGroup] = useState<string>('Bab 1');
  const [editPrompt, setEditPrompt] = useState('');
  const [editOptA, setEditOptA] = useState('');
  const [editOptB, setEditOptB] = useState('');
  const [editOptC, setEditOptC] = useState('');
  const [editOptD, setEditOptD] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [editExplanation, setEditExplanation] = useState('');
  const [editPoints, setEditPoints] = useState(1);

  // Reject Reason Modal state
  const [rejectTarget, setRejectTarget] = useState<QuestionItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Question Bank filters & selection
  const [filterClass, setFilterClass] = useState<ClassId | 'all'>('all');
  const [filterCat, setFilterCat] = useState<QuestionCategory | 'all'>('all');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [filterReview, setFilterReview] = useState<QuestionReviewStatus | 'all'>(
    initialReviewFilter || 'all'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (initialReviewFilter) {
      setFilterReview(initialReviewFilter);
    }
  }, [initialReviewFilter]);

  // Bulk move to group state
  const [targetMoveGroup, setTargetMoveGroup] = useState<string>('');
  const [customMoveGroup, setCustomMoveGroup] = useState<string>('');

  // Quick dropdown print & group loader
  const [builderGroupPick, setBuilderGroupPick] = useState<string>('');
  const [quickPrintGroup, setQuickPrintGroup] = useState<string>('');
  const [quickPrintClass, setQuickPrintClass] = useState<ClassId>('hokkaido');

  // Test Sheet metadata
  const [sheetTitle, setSheetTitle] = useState('');
  const [sheetClass, setSheetClass] = useState<ClassId>('hokkaido');
  const [sheetType, setSheetType] = useState<TestType>('daily');
  const [sheetDate, setSheetDate] = useState(getTodayDateStr());

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [previewData, setPreviewData] = useState<{
    title: string;
    subtitle: string;
    totalPoints: number;
    questions: QuestionItem[];
    mode: 'test' | 'key';
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'question'; item: QuestionItem }
    | { kind: 'sheet'; item: TestSheet }
    | null
  >(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const existingGroups = useMemo(() => {
    const set = new Set<string>();
    questions.forEach((q) => set.add(normalizeGroupName(q.chapterGroup)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [questions]);

  const groupSelectOptions = useMemo(() => {
    const base = [
      'Bab 1',
      'Bab 2',
      'Bab 3',
      'Bab 4',
      'Bab 5',
      'Bab 6',
      'Bab 7',
      'Bab 8',
      'Choukai / 聴解',
      'Irodori',
      'Kaigo / 介護',
      'JLPT / JFT',
      DEFAULT_GROUP,
    ];
    const set = new Set<string>([...existingGroups, ...base]);
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [existingGroups]);

  const reviewCounts = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    let draft = 0;
    questions.forEach((q) => {
      const st = effectiveQuestionStatus(q);
      if (st === 'pending') pending += 1;
      else if (st === 'approved') approved += 1;
      else if (st === 'rejected') rejected += 1;
      else draft += 1;
    });
    return { total: questions.length, pending, approved, rejected, draft };
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      if (filterClass !== 'all' && q.classId !== filterClass && q.classId !== 'all') return false;
      if (filterCat !== 'all' && q.category !== filterCat) return false;
      if (filterGroup !== 'all' && normalizeGroupName(q.chapterGroup) !== filterGroup) return false;
      if (filterReview !== 'all' && effectiveQuestionStatus(q) !== filterReview) return false;
      return true;
    });
  }, [questions, filterClass, filterCat, filterGroup, filterReview]);

  const groupedQuestions = useMemo(() => {
    const map = new Map<string, QuestionItem[]>();
    filteredQuestions.forEach((q) => {
      const grp = normalizeGroupName(q.chapterGroup);
      const list = map.get(grp) || [];
      list.push(q);
      map.set(grp, list);
    });
    return Array.from(map.entries()).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [filteredQuestions]);

  // ONLY approved questions may be used in tests or quick print
  const allGroupsSummary = useMemo(() => {
    const map = new Map<string, QuestionItem[]>();
    questions
      .filter((q) => effectiveQuestionStatus(q) === 'approved')
      .forEach((q) => {
        const grp = normalizeGroupName(q.chapterGroup);
        const list = map.get(grp) || [];
        list.push(q);
        map.set(grp, list);
      });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([name, items]) => ({
        name,
        items,
        totalPoints: items.reduce((sum, q) => sum + (q.points || 1), 0),
        audioCount: items.filter((q) => Boolean(q.audioDataUrl)).length,
      }));
  }, [questions]);

  const effectiveQuickPrintGroup = useMemo(() => {
    if (quickPrintGroup && allGroupsSummary.some((g) => g.name === quickPrintGroup)) {
      return quickPrintGroup;
    }
    return allGroupsSummary[0]?.name || '';
  }, [quickPrintGroup, allGroupsSummary]);

  const selectedQuickGroupObj = useMemo(
    () => allGroupsSummary.find((g) => g.name === effectiveQuickPrintGroup) || null,
    [allGroupsSummary, effectiveQuickPrintGroup]
  );

  const selectedQuestions = useMemo(() => {
    const map = new Map(questions.map((q) => [q.id, q]));
    return selectedIds
      .map((id) => map.get(id))
      .filter((q): q is QuestionItem => Boolean(q))
      .filter((q) => effectiveQuestionStatus(q) === 'approved');
  }, [questions, selectedIds]);

  const selectedTotalPoints = useMemo(
    () => selectedQuestions.reduce((acc, q) => acc + (q.points || 1), 0),
    [selectedQuestions]
  );

  const toggleSelectQuestion = (q: QuestionItem) => {
    if (effectiveQuestionStatus(q) !== 'approved') {
      showToast(
        lang === 'id'
          ? 'Soal harus disetujui Admin dulu sebelum dipakai di ujian.'
          : '管理者が承認した問題のみテストに使用できます。'
      );
      return;
    }
    setSelectedIds((prev) =>
      prev.includes(q.id) ? prev.filter((x) => x !== q.id) : [...prev, q.id]
    );
  };

  const selectAllInGroup = (items: QuestionItem[]) => {
    const approvedIds = items
      .filter((q) => effectiveQuestionStatus(q) === 'approved')
      .map((q) => q.id);
    if (approvedIds.length === 0) {
      showToast(
        lang === 'id'
          ? 'Belum ada soal yang berstatus Disetujui di kelompok ini.'
          : 'このグループにはまだ承認済の問題がありません。'
      );
      return;
    }
    const allSelected = approvedIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !approvedIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...approvedIds])));
    }
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAudioError('');
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/') && file.type !== 'video/mp4' && file.type !== 'application/ogg') {
      setAudioError(
        lang === 'ja'
          ? '音声ファイル（MP3, M4A, WAV, OGG等）を選択してください。'
          : 'Pilih file audio yang valid (MP3, M4A, WAV, OGG).'
      );
      return;
    }

    if (file.size > 530 * 1024) {
      setAudioError(
        lang === 'ja'
          ? `ファイルサイズが大きすぎます（${Math.round(file.size / 1024)} KB）。500 KB以下のMP3/M4Aをご利用ください。`
          : `Ukuran audio terlalu besar (${Math.round(file.size / 1024)} KB). Maksimal ~500 KB (gunakan MP3/M4A terkompresi).`
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result || result.length > MAX_AUDIO_DATA_URL_LEN) {
        setAudioError(
          lang === 'ja'
            ? '音声データが上限を超えています。500 KB以下の短い音声をお試しください。'
            : 'Data audio melebihi batas penyimpanan. Gunakan file audio <= 500 KB.'
        );
        return;
      }
      setQAudioDataUrl(result);
      setQAudioFileName(clampStr(file.name, 150));
    };
    reader.onerror = () => {
      setAudioError(
        lang === 'ja' ? '音声ファイルの読み込みに失敗しました。' : 'Gagal membaca file audio.'
      );
    };
    reader.readAsDataURL(file);
  };

  const clearAudio = () => {
    setQAudioDataUrl('');
    setQAudioFileName('');
    setAudioError('');
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrompt = clampStr(qPrompt, 1000);
    const cleanAnswer = clampStr(qAnswer, 300);
    if (!cleanPrompt || !cleanAnswer) return;

    const chosenGroup =
      qGroupSelect === '__custom__'
        ? clampStr(qGroupCustom, 100) || DEFAULT_GROUP
        : clampStr(qGroupSelect, 100) || DEFAULT_GROUP;

    const options =
      qFormat === 'multiple_choice'
        ? clampArray(
            [optA, optB, optC, optD].map((o) => clampStr(o, 200)).filter(Boolean),
            6
          )
        : [];

    const initialStatus: QuestionReviewStatus = saveAsDraft
      ? 'draft'
      : isHead
      ? 'approved'
      : 'pending';
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const reviewerName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';

    setBusy(true);
    try {
      const ref = await addDoc(collection(db, 'questions'), {
        classId: qClass,
        category: qCategory,
        testType: qTestType,
        questionFormat: qFormat,
        prompt: cleanPrompt,
        options,
        correctAnswer: cleanAnswer,
        explanation: clampStr(qExplanation, 500),
        points: clampNum(qPoints, 1, 100),
        chapterGroup: chosenGroup,
        audioDataUrl: qAudioDataUrl,
        audioFileName: qAudioFileName,
        reviewStatus: initialStatus,
        reviewReason: '',
        reviewedBy: initialStatus === 'approved' ? reviewerName : '',
        reviewedAt: initialStatus === 'approved' ? nowStr : '',
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'question',
        targetLabel: cleanPrompt.slice(0, 80),
        detail: `Added [${chosenGroup}] (${initialStatus}) · ${qClass} · ${qCategory} · ${qTestType}`,
      });
      if (initialStatus === 'approved') {
        setSelectedIds((prev) => [...prev, ref.id]);
      }
      setQPrompt('');
      setOptA('');
      setOptB('');
      setOptC('');
      setOptD('');
      setQAnswer('');
      setQExplanation('');
      setQPoints(1);
      setSaveAsDraft(false);
      clearAudio();
      if (qGroupSelect === '__custom__') {
        setQGroupSelect(chosenGroup);
        setQGroupCustom('');
      }
      showToast(
        initialStatus === 'approved'
          ? lang === 'ja'
            ? `「${chosenGroup}」へ承認済問題として登録しました`
            : `Soal disetujui otomatis & disimpan ke "${chosenGroup}"`
          : initialStatus === 'draft'
          ? lang === 'ja'
            ? `「${chosenGroup}」へ下書き保存しました`
            : `Draft soal disimpan ke "${chosenGroup}"`
          : lang === 'ja'
          ? `「${chosenGroup}」へ登録しました（管理者承認後にテストで使用可能）`
          : `Soal dikirim (${chosenGroup}) & menunggu persetujuan Admin sebelum bisa dipakai ujian`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'questions');
    } finally {
      setBusy(false);
    }
  };

  const openEditQuestion = (q: QuestionItem) => {
    setEditingQuestion(q);
    setEditClass(q.classId);
    setEditCategory(q.category);
    setEditTestType(q.testType);
    setEditFormat(q.questionFormat);
    setEditGroup(normalizeGroupName(q.chapterGroup));
    setEditPrompt(q.prompt);
    setEditOptA(q.options[0] || '');
    setEditOptB(q.options[1] || '');
    setEditOptC(q.options[2] || '');
    setEditOptD(q.options[3] || '');
    setEditAnswer(q.correctAnswer);
    setEditExplanation(q.explanation || '');
    setEditPoints(q.points || 1);
  };

  const saveEditQuestion = async (approveAfterEdit: boolean) => {
    if (!editingQuestion) return;
    const cleanPrompt = clampStr(editPrompt, 1000);
    const cleanAnswer = clampStr(editAnswer, 300);
    if (!cleanPrompt || !cleanAnswer) return;

    const cleanGroup = clampStr(editGroup, 100) || DEFAULT_GROUP;
    const options =
      editFormat === 'multiple_choice'
        ? clampArray(
            [editOptA, editOptB, editOptC, editOptD].map((o) => clampStr(o, 200)).filter(Boolean),
            6
          )
        : [];

    const reviewerName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const nextStatus: QuestionReviewStatus = isHead
      ? approveAfterEdit
        ? 'approved'
        : effectiveQuestionStatus(editingQuestion)
      : 'pending';

    setBusy(true);
    try {
      await updateDoc(doc(db, 'questions', editingQuestion.id), {
        classId: editClass,
        category: editCategory,
        testType: editTestType,
        questionFormat: editFormat,
        chapterGroup: cleanGroup,
        prompt: cleanPrompt,
        options,
        correctAnswer: cleanAnswer,
        explanation: clampStr(editExplanation, 500),
        points: clampNum(editPoints, 1, 100),
        reviewStatus: nextStatus,
        ...(isHead && approveAfterEdit
          ? {
              reviewReason: '',
              reviewedBy: reviewerName,
              reviewedAt: nowStr,
            }
          : !isHead
          ? { reviewReason: '' }
          : {}),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: isHead && approveAfterEdit ? 'question_approve' : 'data_update',
        targetType: 'question',
        targetLabel: cleanPrompt.slice(0, 80),
        detail: `${isHead && approveAfterEdit ? 'Edited & approved' : 'Edited'} question [${cleanGroup}] · ${editClass}`,
      });
      setEditingQuestion(null);
      showToast(
        isHead && approveAfterEdit
          ? lang === 'id'
            ? 'Soal diperbarui & disetujui'
            : '問題を修正して承認しました'
          : !isHead
          ? lang === 'id'
            ? 'Soal diperbarui & dikirim ulang untuk review Admin'
            : '問題を更新しました（再承認待ち）'
          : lang === 'ja'
          ? '問題を更新しました'
          : 'Soal berhasil diperbarui'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `questions/${editingQuestion.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEditQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveEditQuestion(false);
  };

  const handleApproveQuestion = async (q: QuestionItem) => {
    if (!isHead) return;
    setBusy(true);
    const reviewerName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    try {
      await updateDoc(doc(db, 'questions', q.id), {
        reviewStatus: 'approved',
        reviewReason: '',
        reviewedBy: reviewerName,
        reviewedAt: nowStr,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'question_approve',
        targetType: 'question',
        targetLabel: q.prompt.slice(0, 80),
        detail: `Approved question [${normalizeGroupName(q.chapterGroup)}]`,
      });
      showToast(lang === 'id' ? 'Soal disetujui & siap dipakai ujian' : '問題を承認しました');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `questions/${q.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRejectQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHead || !rejectTarget) return;
    const cleanReason = clampStr(rejectReason, 400);
    if (!cleanReason) return;
    setBusy(true);
    const reviewerName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    try {
      await updateDoc(doc(db, 'questions', rejectTarget.id), {
        reviewStatus: 'rejected',
        reviewReason: cleanReason,
        reviewedBy: reviewerName,
        reviewedAt: nowStr,
        updatedAt: serverTimestamp(),
      });
      setSelectedIds((prev) => prev.filter((id) => id !== rejectTarget.id));
      await logActivity({
        actor: profile,
        actionType: 'question_reject',
        targetType: 'question',
        targetLabel: rejectTarget.prompt.slice(0, 80),
        detail: `Rejected: ${cleanReason}`,
      });
      setRejectTarget(null);
      setRejectReason('');
      showToast(lang === 'id' ? 'Soal ditolak dengan catatan alasan' : '問題を却下しました');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `questions/${rejectTarget.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAssignQuestionGroup = async (q: QuestionItem, nextGroupRaw: string) => {
    const cleanGroup = clampStr(nextGroupRaw, 100) || DEFAULT_GROUP;
    const ownStatus = effectiveQuestionStatus(q);
    try {
      await updateDoc(doc(db, 'questions', q.id), {
        chapterGroup: cleanGroup,
        ...(!isHead && ownStatus !== 'draft' ? { reviewStatus: 'pending' } : {}),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'question',
        targetLabel: q.prompt.slice(0, 80),
        detail: `Moved group ${normalizeGroupName(q.chapterGroup)} → ${cleanGroup}`,
      });
      showToast(
        lang === 'ja'
          ? `問題を「${cleanGroup}」に移動しました`
          : `Soal dipindahkan ke kelompok "${cleanGroup}"`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `questions/${q.id}`);
    }
  };

  const handleBulkMoveToGroup = async () => {
    if (selectedIds.length === 0) return;
    const chosen =
      targetMoveGroup === '__custom__'
        ? clampStr(customMoveGroup, 100)
        : clampStr(targetMoveGroup, 100);
    if (!chosen) return;

    setBusy(true);
    try {
      for (const id of selectedIds) {
        await updateDoc(doc(db, 'questions', id), {
          chapterGroup: chosen,
          updatedAt: serverTimestamp(),
        });
      }
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'question',
        targetLabel: `${selectedIds.length} questions`,
        detail: `Bulk organized into [${chosen}]`,
      });
      if (targetMoveGroup === '__custom__') {
        setTargetMoveGroup(chosen);
        setCustomMoveGroup('');
      }
      showToast(
        lang === 'ja'
          ? `${selectedIds.length}問を「${chosen}」に追加しました`
          : `${selectedIds.length} soal ditambahkan ke kelompok "${chosen}"`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'questions');
    } finally {
      setBusy(false);
    }
  };

  const executeConfirmedDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      if (confirmDelete.kind === 'question') {
        const id = confirmDelete.item.id;
        await deleteDoc(doc(db, 'questions', id));
        setSelectedIds((prev) => prev.filter((x) => x !== id));
        await logActivity({
          actor: profile,
          actionType: 'data_delete',
          targetType: 'question',
          targetLabel: confirmDelete.item.prompt.slice(0, 80),
          detail: `Deleted question (${confirmDelete.item.classId} · ${confirmDelete.item.category})`,
        });
      } else {
        const sheet = confirmDelete.item;
        await deleteDoc(doc(db, 'testSheets', sheet.id));
        await logActivity({
          actor: profile,
          actionType: 'data_delete',
          targetType: 'sheet',
          targetLabel: sheet.title,
          detail: `Deleted test sheet (${sheet.classId})`,
        });
      }
      setConfirmDelete(null);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        confirmDelete.kind === 'question'
          ? `questions/${confirmDelete.item.id}`
          : `testSheets/${confirmDelete.item.id}`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleLoadGroupIntoBuilder = (groupName: string) => {
    if (!groupName) return;
    const grp = allGroupsSummary.find((g) => g.name === groupName);
    if (!grp) return;
    setSelectedIds((prev) => Array.from(new Set([...prev, ...grp.items.map((q) => q.id)])));
    if (!sheetTitle.trim()) {
      setSheetTitle(groupName);
    }
    showToast(
      lang === 'ja'
        ? `「${groupName}」から ${grp.items.length}問を追加しました`
        : `${grp.items.length} soal dari "${groupName}" dimuat ke lembar tes`
    );
  };

  const handleCreateTestSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = clampStr(sheetTitle, 150);
    if (!cleanTitle || selectedQuestions.length === 0) return;

    const cleanDate = sanitizeDateStr(sheetDate, getTodayDateStr());
    const weekKey = getWeekKey(cleanDate);

    setBusy(true);
    try {
      await addDoc(collection(db, 'testSheets'), {
        title: cleanTitle,
        classId: sheetClass,
        testType: sheetType,
        date: cleanDate,
        weekKey,
        questionIds: clampArray(selectedQuestions.map((q) => q.id), 100),
        totalPoints: clampNum(selectedTotalPoints, 1, 1000),
        createdBy: profile.uid,
        createdByName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'sheet',
        targetLabel: cleanTitle,
        detail: `Created test sheet (${sheetClass} · ${selectedQuestions.length} questions · ${sheetDate})`,
      });
      setSheetTitle('');
      setSelectedIds([]);
      showToast(
        lang === 'ja'
          ? 'テスト用紙を作成しました。印刷ボタンから問題用紙・解答用紙を出力できます。'
          : 'Lembar tes dibuat! Siap dicetak atau digunakan untuk input nilai.'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'testSheets');
    } finally {
      setBusy(false);
    }
  };

  const openPrintDocument = (
    title: string,
    subtitle: string,
    sheetQs: QuestionItem[],
    totalPoints: number,
    mode: 'test' | 'key'
  ) => {
    const printNode = (
      <div className="print-sheet bg-white text-black p-6 space-y-5">
        <div className="border-b-2 border-black pb-3 flex items-end justify-between gap-4">
          <div>
            <div className="text-xs tracking-wide text-black">
              {mode === 'test'
                ? '元気アカデミー · 日本語テスト問題用紙 / LEMBAR SOAL UJIAN'
                : '元気アカデミー · 解答用紙・採点キー / KUNCI JAWABAN SENSEI'}
            </div>
            <h1 className="text-xl font-bold mt-0.5 text-black">{title}</h1>
            <div className="text-xs mt-1 font-mono text-black">{subtitle}</div>
          </div>
          {mode === 'test' && (
            <div className="text-right text-sm space-y-1 text-black">
              <div>氏名 / Nama: __________________________</div>
              <div>点数 / Nilai: _______ / {totalPoints}</div>
            </div>
          )}
        </div>

        {mode === 'test' ? (
          <div className="space-y-4">
            {sheetQs.map((q, idx) => (
              <div key={q.id} className="break-inside-avoid pb-3 border-b border-black/30">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-sm font-semibold text-black">
                    <span className="font-mono mr-2">Q{idx + 1}.</span>
                    <span className="whitespace-pre-line">{q.prompt}</span>
                  </div>
                  <span className="text-xs font-mono shrink-0 text-black">({q.points} pt)</span>
                </div>
                {q.audioDataUrl && (
                  <div className="mt-1 pl-6 text-xs font-mono text-black">
                    [聴解音声 / Audio Choukai: {q.audioFileName || 'Audio Track'}]
                  </div>
                )}
                {q.questionFormat === 'multiple_choice' && q.options.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-2 pl-6 text-sm text-black">
                    {q.options.map((opt, oi) => (
                      <div key={oi}>
                        {String.fromCharCode(65 + oi)}. {opt}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 pl-6">
                    <div className="border-b border-dashed border-black h-6 w-full" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full text-xs text-left border-collapse border border-black">
            <thead>
              <tr className="bg-neutral-100 border-b border-black">
                <th className="p-2 border-r border-black w-12">No</th>
                <th className="p-2 border-r border-black">問題 / Soal</th>
                <th className="p-2 border-r border-black">カテゴリー / Kategori</th>
                <th className="p-2 border-r border-black font-bold">正解 / Kunci Jawaban</th>
                <th className="p-2 border-r border-black w-14">配点</th>
                <th className="p-2">解説 / Catatan</th>
              </tr>
            </thead>
            <tbody>
              {sheetQs.map((q, idx) => (
                <tr key={q.id} className="border-b border-black/30">
                  <td className="p-2 border-r border-black font-mono">Q{idx + 1}</td>
                  <td className="p-2 border-r border-black">
                    {q.prompt}
                    {q.audioFileName ? ` [Audio: ${q.audioFileName}]` : ''}
                  </td>
                  <td className="p-2 border-r border-black">{categoryLabel(q.category, 'both')}</td>
                  <td className="p-2 border-r border-black font-bold text-sm">{q.correctAnswer}</td>
                  <td className="p-2 border-r border-black font-mono">{q.points}</td>
                  <td className="p-2">{q.explanation || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );

    setPreviewData({ title, subtitle, totalPoints, questions: sheetQs, mode });
    onRegisterPrintView(printNode);
  };

  const triggerPrintSheet = (sheet: TestSheet, mode: 'test' | 'key') => {
    const qMap = new Map(questions.map((q) => [q.id, q]));
    const sheetQs = sheet.questionIds
      .map((id) => qMap.get(id))
      .filter((q): q is QuestionItem => Boolean(q));
    const subtitle = `${classLabel(sheet.classId, 'both')} · ${sheet.date} (${sheet.weekKey}) · 満点/Total: ${sheet.totalPoints} pt`;
    openPrintDocument(sheet.title, subtitle, sheetQs, sheet.totalPoints, mode);
  };

  const triggerPrintGroup = (mode: 'test' | 'key') => {
    if (!selectedQuickGroupObj || selectedQuickGroupObj.items.length === 0) return;
    const today = getTodayDateStr();
    const subtitle = `${classLabel(quickPrintClass, 'both')} · ${today} · 満点/Total: ${selectedQuickGroupObj.totalPoints} pt`;
    openPrintDocument(
      selectedQuickGroupObj.name,
      subtitle,
      selectedQuickGroupObj.items,
      selectedQuickGroupObj.totalPoints,
      mode
    );
  };

  const handleSaveQuickGroupAsSheet = async () => {
    if (!selectedQuickGroupObj || selectedQuickGroupObj.items.length === 0) return;
    const today = getTodayDateStr();
    const weekKey = getWeekKey(today);
    setBusy(true);
    try {
      await addDoc(collection(db, 'testSheets'), {
        title: clampStr(selectedQuickGroupObj.name, 150),
        classId: quickPrintClass,
        testType: 'daily',
        date: today,
        weekKey,
        questionIds: clampArray(selectedQuickGroupObj.items.map((q) => q.id), 100),
        totalPoints: clampNum(selectedQuickGroupObj.totalPoints, 1, 1000),
        createdBy: profile.uid,
        createdByName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'sheet',
        targetLabel: selectedQuickGroupObj.name,
        detail: `Saved group as test sheet (${quickPrintClass} · ${selectedQuickGroupObj.items.length} questions)`,
      });
      showToast(
        lang === 'ja'
          ? `「${selectedQuickGroupObj.name}」をテスト用紙として保存しました（採点可能）`
          : `Kelompok "${selectedQuickGroupObj.name}" disimpan sebagai Lembar Tes & siap untuk input nilai`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'testSheets');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <LiquidToast message={toast} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title text-[#1d1d1f] dark:text-[#f5f5f7]">
            {tr(UI_TEXT.navQuestionBank, lang)}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'ja'
              ? '章・グループ別管理、問題編集・整理、聴解（Choukai）音声、A4印刷を講師と管理者で共同運用できます。'
              : 'Kelola soal per kelompok/bab, edit & atur kelas/level/topik, upload audio Choukai, dan cetak lembar soal bersama Sensei & Admin.'}
          </p>
        </div>
      </div>

      {/* Print Preview Modal */}
      <AnimatePresence>
        {previewData && (
          <AppleModalSheet
            open={true}
            onClose={() => {
              setPreviewData(null);
              onRegisterPrintView(null);
            }}
            maxWidthClass="max-w-4xl"
          >
            <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between gap-3">
              <div className="text-[15px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                {previewData.mode === 'test' ? tr(UI_TEXT.printTest, lang) : tr(UI_TEXT.printKey, lang)}{' '}
                — {previewData.title}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '今すぐ印刷 / PDF保存' : 'Cetak / Simpan PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewData(null);
                    onRegisterPrintView(null);
                  }}
                  className="p-2 text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#f5f5f7] dark:bg-[#000000] space-y-4">
              {previewData.questions.some((q) => Boolean(q.audioDataUrl)) && (
                <div className="rounded-[16px] p-4 space-y-2.5 bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <Volume2 className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
                    <span>
                      {lang === 'ja'
                        ? '聴解（Choukai）音声再生プレイヤー'
                        : 'Pemutar Audio Tes Choukai (untuk diputar Sensei saat ujian)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {previewData.questions.map((q, idx) =>
                      q.audioDataUrl ? (
                        <div
                          key={q.id}
                          className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[12px] p-2.5 space-y-1.5"
                        >
                          <div className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                            Q{idx + 1}. {q.audioFileName || 'Choukai Audio'}
                          </div>
                          <audio controls src={q.audioDataUrl} className="w-full h-8" />
                        </div>
                      ) : null
                    )}
                  </div>
                </div>
              )}

              <div className="bg-white text-black border border-[#d2d2d7] p-6 sm:p-8 rounded-[16px] space-y-4">
                <div className="border-b-2 border-black pb-3 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-neutral-600">
                      {previewData.mode === 'test'
                        ? '元気アカデミー · 日本語テスト問題用紙 / LEMBAR SOAL UJIAN'
                        : '元気アカデミー · 解答用紙・採点キー / KUNCI JAWABAN SENSEI'}
                    </div>
                    <h2 className="text-lg font-semibold text-black mt-0.5">{previewData.title}</h2>
                    <div className="text-xs font-mono text-neutral-600 mt-0.5">
                      {previewData.subtitle}
                    </div>
                  </div>
                  {previewData.mode === 'test' && (
                    <div className="text-xs text-neutral-800 space-y-1 font-mono tabular-nums">
                      <div>氏名 / Nama: ______________________</div>
                      <div>点数 / Nilai: _____ / {previewData.totalPoints}</div>
                    </div>
                  )}
                </div>

                {previewData.mode === 'test' ? (
                  <div className="space-y-3">
                    {previewData.questions.map((q, idx) => (
                      <div key={q.id} className="pb-3 border-b border-neutral-200">
                        <div className="flex items-start justify-between gap-3 text-sm font-medium text-black">
                          <div>
                            <span className="font-mono mr-2">Q{idx + 1}.</span>
                            <span className="whitespace-pre-line">{q.prompt}</span>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-neutral-600 shrink-0">
                            ({q.points} pt)
                          </span>
                        </div>
                        {q.audioDataUrl && (
                          <div className="mt-1 pl-6 text-xs font-mono text-neutral-700">
                            [聴解音声 / Audio Choukai: {q.audioFileName || 'Audio'}]
                          </div>
                        )}
                        {q.questionFormat === 'multiple_choice' && q.options.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2 mt-2 pl-6 text-sm text-neutral-800">
                            {q.options.map((opt, oi) => (
                              <div key={oi}>
                                {String.fromCharCode(65 + oi)}. {opt}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 pl-6 border-b border-dashed border-neutral-400 h-5" />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <table className="w-full text-xs text-left border-collapse border border-neutral-400">
                    <thead>
                      <tr className="bg-neutral-100 border-b border-neutral-400">
                        <th className="p-2 border-r border-neutral-300">No</th>
                        <th className="p-2 border-r border-neutral-300">問題 / Soal</th>
                        <th className="p-2 border-r border-neutral-300">正解 / Kunci Jawaban</th>
                        <th className="p-2 border-r border-neutral-300">配点</th>
                        <th className="p-2">解説 / Catatan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.questions.map((q, idx) => (
                        <tr key={q.id} className="border-b border-neutral-200">
                          <td className="p-2 border-r border-neutral-300 font-mono">Q{idx + 1}</td>
                          <td className="p-2 border-r border-neutral-300">{q.prompt}</td>
                          <td className="p-2 border-r border-neutral-300 font-bold text-black">
                            {q.correctAnswer}
                          </td>
                          <td className="p-2 border-r border-neutral-300 font-mono tabular-nums">{q.points}</td>
                          <td className="p-2 text-neutral-700">{q.explanation || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Edit Question Modal */}
      <AnimatePresence>
        {editingQuestion && (
          <AppleModalSheet
            open={true}
            onClose={() => setEditingQuestion(null)}
            maxWidthClass="max-w-xl"
          >
            <form
              onSubmit={handleSaveEditQuestion}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'ja' ? '問題を編集' : 'Edit Soal Bank Soal'}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="p-1.5 text-[#6e6e73] hover:text-[#1d1d1f] dark:text-[#86868b] dark:hover:text-[#f5f5f7] rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <select
                    value={editClass}
                    onChange={(e) => setEditClass(e.target.value as ClassId | 'all')}
                    className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  >
                    <option value="all">{tr(UI_TEXT.allClasses, lang)}</option>
                    {CLASSES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameJa}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as QuestionCategory)}
                    className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  >
                    {QUESTION_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {categoryLabel(cat.id, lang)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editTestType}
                    onChange={(e) => setEditTestType(e.target.value as TestType)}
                    className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  >
                    <option value="daily">{tr(UI_TEXT.daily, lang)}</option>
                    <option value="weekly">{tr(UI_TEXT.weekly, lang)}</option>
                  </select>
                  <select
                    value={editFormat}
                    onChange={(e) => setEditFormat(e.target.value as 'multiple_choice' | 'written')}
                    className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  >
                    <option value="multiple_choice">{lang === 'ja' ? '選択式' : 'Pilihan Ganda'}</option>
                    <option value="written">{lang === 'ja' ? '記述式' : 'Isian'}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'ja' ? '章・グループ（トピック）' : 'Kelompok / Topik Bab'}
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={editGroup}
                    onChange={(e) => setEditGroup(e.target.value)}
                    className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'ja' ? '問題文 *' : 'Pertanyaan / Soal *'}
                  </label>
                  <textarea
                    required
                    rows={3}
                    maxLength={1000}
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="glass-input w-full px-3 py-2 text-[14px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                </div>

                {editFormat === 'multiple_choice' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editOptA}
                      onChange={(e) => setEditOptA(e.target.value)}
                      placeholder="A."
                      className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                    <input
                      type="text"
                      value={editOptB}
                      onChange={(e) => setEditOptB(e.target.value)}
                      placeholder="B."
                      className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                    <input
                      type="text"
                      value={editOptC}
                      onChange={(e) => setEditOptC(e.target.value)}
                      placeholder="C."
                      className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                    <input
                      type="text"
                      value={editOptD}
                      onChange={(e) => setEditOptD(e.target.value)}
                      placeholder="D."
                      className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'ja' ? '正解（解答キー）*' : 'Kunci Jawaban *'}
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={300}
                      value={editAnswer}
                      onChange={(e) => setEditAnswer(e.target.value)}
                      className="glass-input w-full px-3 py-2 text-[14px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'ja' ? '配点' : 'Poin'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={editPoints}
                      onChange={(e) => setEditPoints(Number(e.target.value))}
                      className="glass-input w-full px-3 py-2 text-[14px] font-mono tabular-nums rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    />
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    maxLength={500}
                    value={editExplanation}
                    onChange={(e) => setEditExplanation(e.target.value)}
                    placeholder={lang === 'ja' ? '解説（任意）' : 'Penjelasan (opsional)'}
                    className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                </div>
              </div>

              <div className="shrink-0 apple-blur-overlay border-t border-[#d2d2d7]/60 dark:border-[#424245] px-5 sm:px-6 py-3.5 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingQuestion(null)}
                  className="apple-btn-secondary px-4 py-1.5 text-[12px]"
                >
                  {tr(UI_TEXT.cancel, lang)}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium disabled:opacity-40"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{tr(UI_TEXT.save, lang)}</span>
                </button>
                {isHead && effectiveQuestionStatus(editingQuestion) !== 'approved' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveEditQuestion(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium bg-[#16a34a] hover:bg-[#15803d] text-white rounded-full transition-colors disabled:opacity-40"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'Simpan & Setujui' : '保存して承認'}</span>
                  </button>
                )}
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Reject Reason Modal */}
      <AnimatePresence>
        {rejectTarget && (
          <AppleModalSheet
            open={true}
            onClose={() => {
              setRejectTarget(null);
              setRejectReason('');
            }}
            maxWidthClass="max-w-md"
          >
            <form
              onSubmit={handleConfirmRejectQuestion}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between gap-2">
                <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-[#dc2626] dark:text-[#ff453a]" />
                  <span>{lang === 'id' ? 'Tolak Soal' : '問題を却下する'}</span>
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setRejectTarget(null);
                    setRejectReason('');
                  }}
                  className="p-1.5 text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[12px] p-3 line-clamp-2">
                  {rejectTarget.prompt}
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Alasan penolakan singkat *' : '却下理由（講師に表示されます）*'}
                  </label>
                  <textarea
                    required
                    rows={2}
                    maxLength={400}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder={
                      lang === 'id'
                        ? 'Misal: Kunci jawaban salah / kalimat kurang jelas'
                        : '例：正解キーが不正確／選択肢が重複しています'
                    }
                    className="glass-input w-full px-3 py-2 text-[14px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                  />
                </div>
              </div>
              <div className="shrink-0 apple-blur-overlay border-t border-[#d2d2d7]/60 dark:border-[#424245] px-5 sm:px-6 py-3.5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRejectTarget(null);
                    setRejectReason('');
                  }}
                  className="apple-btn-secondary px-4 py-1.5 text-[12px]"
                >
                  {tr(UI_TEXT.cancel, lang)}
                </button>
                <button
                  type="submit"
                  disabled={busy || !rejectReason.trim()}
                  className="px-4 py-1.5 text-[12px] font-medium bg-[#dc2626] hover:bg-[#b91c1c] text-white rounded-full transition-colors disabled:opacity-40"
                >
                  {lang === 'id' ? 'Konfirmasi Tolak' : '却下を確定'}
                </button>
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Two-Column Split: Add Question + Build Test Sheet */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Add Question */}
        <form
          onSubmit={handleAddQuestion}
          className="lg:col-span-6 apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-4"
        >
          <div className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
            {lang === 'ja' ? '1. 問題バンクへ問題を追加' : '1. Tambah Soal ke Bank Soal'}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <select
              value={qClass}
              onChange={(e) => setQClass(e.target.value as ClassId | 'all')}
              className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="all">{tr(UI_TEXT.allClasses, lang)}</option>
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameJa}
                </option>
              ))}
            </select>

            <select
              value={qCategory}
              onChange={(e) => setQCategory(e.target.value as QuestionCategory)}
              className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              {QUESTION_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {lang === 'ja' ? cat.ja : cat.idLabel}
                </option>
              ))}
            </select>

            <select
              value={qTestType}
              onChange={(e) => setQTestType(e.target.value as TestType)}
              className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="daily">{tr(UI_TEXT.daily, lang)}</option>
              <option value="weekly">{tr(UI_TEXT.weekly, lang)}</option>
            </select>

            <select
              value={qFormat}
              onChange={(e) => setQFormat(e.target.value as 'multiple_choice' | 'written')}
              className="glass-input px-2.5 py-2 text-[12px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="multiple_choice">{lang === 'ja' ? '選択式 (ABCD)' : 'Pilihan Ganda'}</option>
              <option value="written">{lang === 'ja' ? '記述式' : 'Isian / Esai'}</option>
            </select>
          </div>

          <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-3.5 space-y-2">
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b]">
              {lang === 'ja'
                ? '章・グループ分け（フォルダ）'
                : 'Kelompok Soal / Bab (contoh: Bab 6, Irodori 3, Choukai 1)'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={qGroupSelect}
                onChange={(e) => setQGroupSelect(e.target.value)}
                className="glass-input px-2.5 py-2 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              >
                {groupSelectOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="__custom__">
                  {lang === 'ja' ? '+ 新しいグループ名を入力' : '+ Buat Nama Kelompok Baru...'}
                </option>
              </select>
              {qGroupSelect === '__custom__' && (
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={qGroupCustom}
                  onChange={(e) => setQGroupCustom(e.target.value)}
                  placeholder={lang === 'ja' ? '例: 第8課 漢字' : 'Nama kelompok baru (mis: Bab 8)'}
                  className="glass-input px-2.5 py-2 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
              {lang === 'ja' ? '問題文 *' : 'Pertanyaan / Soal *'}
            </label>
            <textarea
              required
              rows={2}
              maxLength={1000}
              value={qPrompt}
              onChange={(e) => setQPrompt(e.target.value)}
              placeholder={
                qCategory === 'listening'
                  ? '例: 音声を聞いて、正しい答えを選んでください。/ Dengarkan audio lalu pilih jawaban yang benar.'
                  : '例: 「食べる」のて形はどれですか。 / Apa bentuk-te dari 食べる?'
              }
              className="glass-input w-full px-3 py-2 text-[14px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>

          <div
            className={`rounded-[16px] border p-3.5 space-y-2 ${
              qCategory === 'listening'
                ? 'bg-[#0071e3]/8 dark:bg-[#2997ff]/10 border-[#0071e3]/30 dark:border-[#2997ff]/30'
                : 'bg-[#f5f5f7] dark:bg-[#161617] border-[#d2d2d7]/60 dark:border-[#424245]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                <Volume2 className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                <span>
                  {lang === 'ja'
                    ? '聴解（Choukai）音声アップロード（任意 / 500KB以下）'
                    : 'Upload Audio Tes Choukai (opsional, maks ~500 KB MP3/M4A)'}
                </span>
              </div>
              <label className="apple-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '音声を選択' : 'Pilih File Audio'}</span>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg"
                  onChange={handleAudioUpload}
                  className="hidden"
                />
              </label>
            </div>

            {audioError && <div className="text-[12px] text-[#dc2626] dark:text-[#ff453a]">{audioError}</div>}

            {qAudioDataUrl && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[12px] p-2">
                <audio controls src={qAudioDataUrl} className="flex-1 h-8" />
                <div className="flex items-center justify-between gap-2 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  <span className="truncate max-w-[140px]">{qAudioFileName}</span>
                  <button
                    type="button"
                    onClick={clearAudio}
                    className="p-1 text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] transition-colors"
                    title="Hapus audio"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {qFormat === 'multiple_choice' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={optA}
                onChange={(e) => setOptA(e.target.value)}
                placeholder="A."
                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <input
                type="text"
                value={optB}
                onChange={(e) => setOptB(e.target.value)}
                placeholder="B."
                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <input
                type="text"
                value={optC}
                onChange={(e) => setOptC(e.target.value)}
                placeholder="C."
                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
              <input
                type="text"
                value={optD}
                onChange={(e) => setOptD(e.target.value)}
                placeholder="D."
                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-3">
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '正解（解答キー）*' : 'Kunci Jawaban *'}
              </label>
              <input
                type="text"
                required
                maxLength={300}
                value={qAnswer}
                onChange={(e) => setQAnswer(e.target.value)}
                placeholder="例: B. たべて"
                className="glass-input w-full px-3 py-2 text-[14px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '配点' : 'Poin'}
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={qPoints}
                onChange={(e) => setQPoints(Number(e.target.value))}
                className="glass-input w-full px-3 py-2 text-[14px] font-mono tabular-nums rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
          </div>

          <div>
            <input
              type="text"
              maxLength={500}
              value={qExplanation}
              onChange={(e) => setQExplanation(e.target.value)}
              placeholder={
                lang === 'ja' ? '講師向け解説（任意）' : 'Penjelasan singkat untuk Sensei (opsional)'
              }
              className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-[12px]">
            <label className="inline-flex items-center gap-2 text-[#6e6e73] dark:text-[#86868b] cursor-pointer">
              <input
                type="checkbox"
                checked={saveAsDraft}
                onChange={(e) => setSaveAsDraft(e.target.checked)}
                className="rounded border-[#d2d2d7] text-[#0071e3]"
              />
              <span>
                {lang === 'id' ? 'Simpan sebagai Draft dulu' : '下書き（Draft）として保存'}
              </span>
            </label>
            {!isHead && !saveAsDraft && (
              <span className="text-[11px] text-[#b45309] dark:text-[#fcd34d]">
                {lang === 'id' ? 'Perlu approval Admin sebelum ujian' : '※登録後は管理者承認待ち'}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="apple-btn-primary w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[14px] font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'ja' ? '問題バンクに追加' : 'Simpan ke Bank Soal'}</span>
          </button>
        </form>

        {/* Right: Build Test Sheet */}
        <form
          onSubmit={handleCreateTestSheet}
          className="lg:col-span-6 apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'ja' ? '2. テスト用紙を作成（グループ選択可）' : '2. Susun Lembar Tes dari Bank Soal'}
            </div>
            <span className="text-[12px] font-mono tabular-nums text-[#0071e3] dark:text-[#2997ff] font-medium">
              {selectedQuestions.length} {lang === 'ja' ? '問' : 'soal'} · {selectedTotalPoints} pt
            </span>
          </div>

          <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-3.5 space-y-2">
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b]">
              {lang === 'ja'
                ? 'グループから一括追加（ドロップダウン）'
                : 'Pilih Kelompok Bab dari Bank Soal (Dropdown)'}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={builderGroupPick}
                onChange={(e) => setBuilderGroupPick(e.target.value)}
                className="glass-input flex-1 px-2.5 py-2 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              >
                <option value="">
                  {lang === 'ja' ? '— グループを選択 —' : '— Pilih Kelompok Bab —'}
                </option>
                {allGroupsSummary.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name} ({g.items.length} {lang === 'ja' ? '問' : 'soal'} · {g.totalPoints} pt)
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!builderGroupPick}
                onClick={() => handleLoadGroupIntoBuilder(builderGroupPick)}
                className="apple-btn-secondary px-3 py-1.5 text-[12px] disabled:opacity-40 whitespace-nowrap"
              >
                {lang === 'ja' ? 'このグループを追加' : '+ Muat Soal Kelompok'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              required
              maxLength={150}
              value={sheetTitle}
              onChange={(e) => setSheetTitle(e.target.value)}
              placeholder={
                lang === 'ja' ? 'テスト名（例: 第6課 単語小テスト）*' : 'Judul Tes (mis: Kuis Bab 6) *'
              }
              className="glass-input sm:col-span-2 px-3 py-2 text-[14px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            />
            <select
              value={sheetClass}
              onChange={(e) => setSheetClass(e.target.value as ClassId)}
              className="glass-input px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <select
                value={sheetType}
                onChange={(e) => setSheetType(e.target.value as TestType)}
                className="glass-input flex-1 px-2.5 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              >
                <option value="daily">{tr(UI_TEXT.daily, lang)}</option>
                <option value="weekly">{tr(UI_TEXT.weekly, lang)}</option>
              </select>
              <input
                type="date"
                value={sheetDate}
                onChange={(e) => setSheetDate(e.target.value)}
                className="glass-input px-2.5 py-2 text-[13px] font-mono tabular-nums rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              />
            </div>
          </div>

          <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-3 max-h-52 overflow-y-auto space-y-2">
            {selectedQuestions.length === 0 ? (
              <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] text-center py-6">
                {lang === 'ja'
                  ? '上のドロップダウンからグループを選ぶか、下の問題一覧からチェックしてください。'
                  : 'Pilih kelompok bab lewat dropdown di atas, atau centang soal di daftar Bank Soal di bawah.'}
              </div>
            ) : (
              selectedQuestions.map((q, idx) => (
                <div
                  key={q.id}
                  className="flex items-center justify-between gap-2 bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[12px] px-3 py-2 text-[12px]"
                >
                  <div className="truncate">
                    <span className="font-mono font-semibold mr-1.5 text-[#1d1d1f] dark:text-[#f5f5f7]">
                      Q{idx + 1}.
                    </span>
                    <span className="text-[#1d1d1f] dark:text-[#f5f5f7]">{q.prompt}</span>
                    {q.audioDataUrl && (
                      <span className="text-[#0071e3] dark:text-[#2997ff] font-medium ml-1.5">[Audio]</span>
                    )}
                    <span className="text-[#6e6e73] dark:text-[#86868b] ml-2">({q.correctAnswer})</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSelectQuestion(q)}
                    className="text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] shrink-0 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            type="submit"
            disabled={busy || selectedQuestions.length === 0}
            className="apple-btn-primary w-full px-4 py-2.5 text-[14px] font-medium disabled:opacity-40"
          >
            {lang === 'ja'
              ? 'テスト用紙を保存（印刷・採点可能に）'
              : 'Simpan Lembar Tes (Siap Cetak & Input Nilai)'}
          </button>
        </form>
      </div>

      {/* Quick Print Dropdown + Saved Sheets */}
      <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
        <div className="space-y-3 pb-5 border-b border-[#d2d2d7]/60 dark:border-[#424245]">
          <div>
            <div className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'ja'
                ? 'グループ別クイック印刷（ドロップダウン選択）'
                : 'Cetak Soal per Kelompok Bab (Dropdown Bank Soal)'}
            </div>
            <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
              {lang === 'ja'
                ? '問題バンクの章・グループをドロップダウンから選び、そのままA4印刷できます。'
                : 'Pilih kelompok soal yang sudah ada lewat dropdown, lalu langsung cetak Lembar Soal atau Kunci Jawaban.'}
            </p>
          </div>

          {allGroupsSummary.length === 0 ? (
            <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] py-3">
              {lang === 'ja'
                ? '問題バンクにまだグループがありません。'
                : 'Belum ada kelompok soal di Bank Soal.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-3.5">
              <div className="lg:col-span-5">
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                  {lang === 'ja' ? '印刷するグループを選択' : 'Pilih Kelompok Soal (Bab)'}
                </label>
                <select
                  value={effectiveQuickPrintGroup}
                  onChange={(e) => setQuickPrintGroup(e.target.value)}
                  className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                >
                  {allGroupsSummary.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name} — {g.items.length} {lang === 'ja' ? '問' : 'soal'} ({g.totalPoints} pt
                      {g.audioCount > 0 ? ` · ${g.audioCount} audio` : ''})
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-3">
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                  {lang === 'ja' ? '対象クラス表記' : 'Untuk Kelas'}
                </label>
                <select
                  value={quickPrintClass}
                  onChange={(e) => setQuickPrintClass(e.target.value as ClassId)}
                  className="glass-input w-full px-3 py-2 text-[13px] rounded-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                >
                  {CLASSES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {classLabel(c.id, lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="lg:col-span-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!selectedQuickGroupObj}
                  onClick={() => triggerPrintGroup('test')}
                  className="apple-btn-primary flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] font-medium disabled:opacity-40 whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{tr(UI_TEXT.printTest, lang)}</span>
                </button>
                <button
                  type="button"
                  disabled={!selectedQuickGroupObj}
                  onClick={() => triggerPrintGroup('key')}
                  className="apple-btn-secondary flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[12px] disabled:opacity-40 whitespace-nowrap"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{tr(UI_TEXT.printKey, lang)}</span>
                </button>
                <button
                  type="button"
                  disabled={busy || !selectedQuickGroupObj}
                  onClick={handleSaveQuickGroupAsSheet}
                  className="apple-btn-secondary px-3 py-2 text-[12px] disabled:opacity-40 whitespace-nowrap"
                >
                  {lang === 'ja' ? '採点用に保存' : '+ Simpan Tes'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Saved Printable Test Sheets */}
        <div className="space-y-3">
          <div className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
            {lang === 'ja'
              ? '作成済みテスト用紙（印刷 & 採点入力）'
              : 'Daftar Lembar Tes Tersimpan (Cetak & Input Nilai)'}
          </div>

          {testSheets.length === 0 ? (
            <EmptyStateIllustration
              kind="clipboard"
              title={
                lang === 'ja'
                  ? 'まだテスト用紙がありません'
                  : 'Belum ada lembar tes tersimpan'
              }
              subtitle={
                lang === 'ja'
                  ? '上の「テスト用紙を作成」から問題を選んで保存してください。'
                  : 'Susun soal di panel 2 atau klik "+ Simpan Tes" di atas.'
              }
            />
          ) : (
            <div className="divide-y divide-[#d2d2d7]/50 dark:divide-[#424245]">
              {[...testSheets]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map((sheet) => {
                  const qMap = new Map(questions.map((q) => [q.id, q]));
                  const audioCount = sheet.questionIds.filter((id) =>
                    Boolean(qMap.get(id)?.audioDataUrl)
                  ).length;
                  const clsTheme = getClassTheme(sheet.classId);

                  return (
                    <div
                      key={sheet.id}
                      className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                            clsTheme ? clsTheme.dotColor : 'bg-[#86868b]'
                          }`}
                        />
                        <div>
                          <div className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {sheet.title}
                          </div>
                          <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] font-mono tabular-nums mt-0.5">
                            <span className={clsTheme ? clsTheme.accentText : ''}>
                              {classLabel(sheet.classId, lang)}
                            </span>{' '}
                            ·{' '}
                            {sheet.testType === 'daily'
                              ? tr(UI_TEXT.daily, lang)
                              : tr(UI_TEXT.weekly, lang)}{' '}
                            · {sheet.date} · {sheet.questionIds.length} Q · {sheet.totalPoints} pt
                            {audioCount > 0 ? ` · ${audioCount} Choukai Audio` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => triggerPrintSheet(sheet, 'test')}
                          className="apple-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] whitespace-nowrap"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{tr(UI_TEXT.printTest, lang)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerPrintSheet(sheet, 'key')}
                          className="apple-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] whitespace-nowrap"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>{tr(UI_TEXT.printKey, lang)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onStartGradingSheet(sheet.id)}
                          className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium whitespace-nowrap"
                        >
                          <span>{lang === 'ja' ? '採点へ' : 'Input Nilai'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ kind: 'sheet', item: sheet })}
                          className="p-1.5 text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                          aria-label={`Delete sheet ${sheet.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Question Bank Grouped by Chapter / Bab */}
      <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'ja' ? '問題バンク一覧（章・グループ別）' : 'Daftar Bank Soal per Kelompok / Bab'} (
              <span className="font-mono tabular-nums">{filteredQuestions.length}</span>)
            </div>
            {reviewCounts.pending > 0 && (
              <button
                type="button"
                onClick={() => setFilterReview(filterReview === 'pending' ? 'all' : 'pending')}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#f59e0b]/12 text-[#b45309] dark:text-[#fcd34d] transition-opacity hover:opacity-80"
              >
                <Clock className="w-3 h-3" />
                <span className="tabular-nums">
                  {reviewCounts.pending} {lang === 'id' ? 'Menunggu Review' : '承認待ち'}
                </span>
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterReview}
              onChange={(e) => setFilterReview(e.target.value as QuestionReviewStatus | 'all')}
              className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="all">
                {lang === 'ja' ? `全ステータス (${reviewCounts.total})` : `Semua Status (${reviewCounts.total})`}
              </option>
              <option value="pending">
                {lang === 'ja' ? `承認待ち (${reviewCounts.pending})` : `Menunggu (${reviewCounts.pending})`}
              </option>
              <option value="approved">
                {lang === 'ja' ? `承認済 (${reviewCounts.approved})` : `Disetujui (${reviewCounts.approved})`}
              </option>
              <option value="rejected">
                {lang === 'ja' ? `却下 (${reviewCounts.rejected})` : `Ditolak (${reviewCounts.rejected})`}
              </option>
              <option value="draft">
                {lang === 'ja' ? `下書き (${reviewCounts.draft})` : `Draft (${reviewCounts.draft})`}
              </option>
            </select>
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="all">
                {lang === 'ja' ? '全グループ（章）' : 'Semua Kelompok / Bab'}
              </option>
              {existingGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value as ClassId | 'all')}
              className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="all">{tr(UI_TEXT.allClasses, lang)}</option>
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameJa}
                </option>
              ))}
            </select>
            <select
              value={filterCat}
              onChange={(e) => setFilterCat(e.target.value as QuestionCategory | 'all')}
              className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              <option value="all">{lang === 'ja' ? '全カテゴリー' : 'Semua Kategori'}</option>
              {QUESTION_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c.id, lang)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Bulk Assign Checked Questions */}
        {selectedIds.length > 0 && (
          <div className="bg-[#0071e3]/8 dark:bg-[#2997ff]/12 border border-[#0071e3]/30 dark:border-[#2997ff]/30 rounded-[16px] p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              <FolderInput className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff] shrink-0" />
              <span className="tabular-nums">
                {lang === 'ja'
                  ? `${selectedIds.length}問を選択中 — 指定グループへ移動・追加:`
                  : `${selectedIds.length} soal dipilih — Masukkan ke kelompok:`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={targetMoveGroup}
                onChange={(e) => setTargetMoveGroup(e.target.value)}
                className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
              >
                <option value="">
                  {lang === 'ja' ? '— 移動先グループを選択 —' : '— Pilih Kelompok Tujuan —'}
                </option>
                {groupSelectOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value="__custom__">
                  {lang === 'ja' ? '+ 新規グループ名...' : '+ Kelompok Baru...'}
                </option>
              </select>
              {targetMoveGroup === '__custom__' && (
                <input
                  type="text"
                  maxLength={100}
                  value={customMoveGroup}
                  onChange={(e) => setCustomMoveGroup(e.target.value)}
                  placeholder={lang === 'ja' ? '新しいグループ名' : 'Nama kelompok baru'}
                  className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                />
              )}
              <button
                type="button"
                disabled={
                  busy ||
                  !targetMoveGroup ||
                  (targetMoveGroup === '__custom__' && !customMoveGroup.trim())
                }
                onClick={handleBulkMoveToGroup}
                className="apple-btn-primary px-3.5 py-1.5 text-[12px] font-medium disabled:opacity-40"
              >
                {lang === 'ja' ? 'グループへ追加' : 'Masukkan ke Kelompok'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1.5 text-[12px] text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors"
              >
                {lang === 'ja' ? '選択解除' : 'Batal Pilih'}
              </button>
            </div>
          </div>
        )}

        {groupedQuestions.length === 0 ? (
          <EmptyStateIllustration
            kind="book"
            title={lang === 'ja' ? 'まだ問題がありません' : 'Belum ada soal di Bank Soal'}
            subtitle={
              lang === 'ja'
                ? '左上の「問題バンクへ問題を追加」フォームから登録してください。'
                : 'Gunakan formulir Tambah Soal di atas untuk mulai membuat bank soal.'
            }
          />
        ) : (
          <div className="space-y-4">
            {groupedQuestions.map(([groupName, groupItems]) => {
              const isCollapsed = Boolean(collapsedGroups[groupName]);
              const approvedInGroup = groupItems.filter(
                (q) => effectiveQuestionStatus(q) === 'approved'
              );
              const allInGroupChecked =
                approvedInGroup.length > 0 &&
                approvedInGroup.every((q) => selectedIds.includes(q.id));
              const groupPts = groupItems.reduce((s, q) => s + (q.points || 1), 0);
              const audioCnt = groupItems.filter((q) => Boolean(q.audioDataUrl)).length;

              return (
                <div
                  key={groupName}
                  className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[18px] overflow-hidden"
                >
                  <div className="bg-[#f5f5f7] dark:bg-[#161617] px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-[#d2d2d7]/60 dark:border-[#424245]">
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsedGroups((prev) => ({ ...prev, [groupName]: !isCollapsed }))
                      }
                      className="flex items-center gap-2 text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b] shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b] shrink-0" />
                      )}
                      <FolderOpen className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff] shrink-0" />
                      <span className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {groupName}
                      </span>
                      <span className="text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                        · {groupItems.length} {lang === 'ja' ? '問' : 'soal'} · {groupPts} pt
                        {audioCnt > 0 ? ` · ${audioCnt} audio` : ''}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => selectAllInGroup(groupItems)}
                      className="apple-btn-secondary px-3 py-1 text-[12px]"
                    >
                      {allInGroupChecked
                        ? lang === 'ja'
                          ? 'この章を解除'
                          : 'Batal Pilih Bab Ini'
                        : lang === 'ja'
                        ? '承認済を全選択'
                        : 'Pilih Semua (Disetujui)'}
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y divide-[#d2d2d7]/50 dark:divide-[#424245]">
                      {groupItems.map((q) => {
                        const checked = selectedIds.includes(q.id);
                        const clsTheme = getClassTheme(q.classId);
                        const rStatus = effectiveQuestionStatus(q);
                        const rBadge = reviewBadgeMeta(rStatus, lang);
                        const isApproved = rStatus === 'approved';
                        const canModify = isHead || q.createdBy === profile.uid;

                        const contextItems: ContextMenuItem[] = [];
                        if (isHead && rStatus !== 'approved') {
                          contextItems.push({
                            id: 'approve',
                            label: lang === 'id' ? 'Setujui Soal' : '承認する',
                            onSelect: () => handleApproveQuestion(q),
                          });
                        }
                        if (isHead && rStatus !== 'rejected') {
                          contextItems.push({
                            id: 'reject',
                            label: lang === 'id' ? 'Tolak Soal' : '却下する',
                            destructive: true,
                            onSelect: () => {
                              setRejectTarget(q);
                              setRejectReason(q.reviewReason || '');
                            },
                          });
                        }
                        if (canModify) {
                          contextItems.push({
                            id: 'edit',
                            label: lang === 'ja' ? '編集' : 'Edit Soal',
                            onSelect: () => openEditQuestion(q),
                          });
                          contextItems.push({
                            id: 'delete',
                            label: lang === 'ja' ? '削除' : 'Hapus Soal',
                            destructive: true,
                            onSelect: () => setConfirmDelete({ kind: 'question', item: q }),
                          });
                        }

                        const swipeActions =
                          canModify || (isHead && rStatus !== 'approved') ? (
                            <div className="flex items-center gap-1">
                              {isHead && rStatus !== 'approved' && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => handleApproveQuestion(q)}
                                  className="p-2 rounded-lg bg-[#16a34a] text-white"
                                  aria-label={lang === 'id' ? 'Setujui Soal' : '承認する'}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canModify && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditQuestion(q)}
                                    className="p-2 rounded-lg bg-[#0071e3] text-white"
                                    aria-label={lang === 'ja' ? '編集' : 'Edit Soal'}
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDelete({ kind: 'question', item: q })}
                                    className="p-2 rounded-lg bg-[#dc2626] text-white"
                                    aria-label="Delete question"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          ) : undefined;

                        return (
                          <SwipeableMobileRow
                            key={q.id}
                            actions={swipeActions}
                            className="bg-white dark:bg-[#1d1d1f]"
                          >
                            <AppleContextMenuTrigger items={contextItems}>
                              <div className="apple-virtual-item px-4 py-3 flex flex-col sm:flex-row sm:items-start justify-between gap-3 bg-white dark:bg-[#1d1d1f]">
                                <div className="flex items-start gap-3 flex-1 min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => toggleSelectQuestion(q)}
                                    title={
                                      isApproved
                                        ? undefined
                                        : lang === 'id'
                                        ? 'Belum disetujui Admin'
                                        : '未承認のためテストに選択不可'
                                    }
                                    className={`mt-0.5 shrink-0 ${
                                      isApproved
                                        ? 'text-[#0071e3] dark:text-[#2997ff]'
                                        : 'text-[#d2d2d7] dark:text-[#424245] cursor-not-allowed'
                                    }`}
                                  >
                                    {isApproved ? (
                                      checked ? (
                                        <CheckSquare className="w-4 h-4" />
                                      ) : (
                                        <Square className="w-4 h-4 text-[#86868b]" />
                                      )
                                    ) : (
                                      <Lock className="w-4 h-4" />
                                    )}
                                  </button>
                                  <div className="min-w-0 flex-1 space-y-1.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span
                                        className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full ${rBadge.cls}`}
                                      >
                                        {rBadge.label}
                                      </span>
                                      <span className="text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                                        {q.prompt}
                                      </span>
                                    </div>
                                    <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-[#0071e3] dark:text-[#2997ff]">
                                        {lang === 'ja' ? '正解: ' : 'Kunci: '}
                                        {q.correctAnswer}
                                      </span>
                                      <span>·</span>
                                      <span>{categoryLabel(q.category, lang)}</span>
                                      <span>·</span>
                                      <span className={clsTheme ? `font-medium ${clsTheme.accentText}` : ''}>
                                        {classLabel(q.classId, lang)}
                                      </span>
                                      <span>·</span>
                                      <span className="font-mono tabular-nums">{q.points} pt</span>
                                    </div>

                                    {rStatus === 'rejected' && q.reviewReason && (
                                      <div className="inline-flex items-center gap-1.5 text-[12px] text-[#dc2626] dark:text-[#ff453a] bg-[#dc2626]/10 rounded-[10px] px-2.5 py-1">
                                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                        <span>
                                          {lang === 'id' ? 'Alasan ditolak: ' : '却下理由: '}
                                          {q.reviewReason}
                                        </span>
                                      </div>
                                    )}

                                    {q.audioDataUrl && (
                                      <div className="flex flex-wrap items-center gap-2 pt-1">
                                        <audio
                                          controls
                                          src={q.audioDataUrl}
                                          className="h-8 max-w-xs"
                                        />
                                        <span className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                                          {q.audioFileName || 'Choukai Audio'}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 shrink-0 pl-7 sm:pl-0">
                                  {isHead && rStatus !== 'approved' && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => handleApproveQuestion(q)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#16a34a] hover:bg-[#15803d] text-white rounded-full transition-colors"
                                      title={lang === 'id' ? 'Setujui Soal' : '承認する'}
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>{lang === 'id' ? 'Setujui' : '承認'}</span>
                                    </button>
                                  )}
                                  {isHead && rStatus !== 'rejected' && (
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => {
                                        setRejectTarget(q);
                                        setRejectReason(q.reviewReason || '');
                                      }}
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-[#dc2626]/10 hover:bg-[#dc2626]/18 text-[#dc2626] dark:text-[#ff453a] rounded-full transition-colors"
                                      title={lang === 'id' ? 'Tolak Soal' : '却下'}
                                    >
                                      <XCircle className="w-3 h-3" />
                                      <span>{lang === 'id' ? 'Tolak' : '却下'}</span>
                                    </button>
                                  )}
                                  {canModify && (
                                    <>
                                      <select
                                        value={normalizeGroupName(q.chapterGroup)}
                                        onChange={(e) => handleAssignQuestionGroup(q, e.target.value)}
                                        className="glass-input px-2 py-1 text-[11px] rounded-[10px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                                        title={
                                          lang === 'ja' ? '別のグループへ移動' : 'Pindahkan ke kelompok'
                                        }
                                      >
                                        {groupSelectOptions.map((g) => (
                                          <option key={g} value={g}>
                                            {g}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        onClick={() => openEditQuestion(q)}
                                        className="text-[#6e6e73] hover:text-[#0071e3] dark:text-[#86868b] dark:hover:text-[#2997ff] p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                                        aria-label="Edit question"
                                        title={lang === 'ja' ? '編集' : 'Edit Soal'}
                                      >
                                        <Edit3 className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDelete({ kind: 'question', item: q })}
                                        className="text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                                        aria-label="Delete question"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </AppleContextMenuTrigger>
                          </SwipeableMobileRow>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        lang={lang}
        busy={busy}
        title={
          confirmDelete?.kind === 'sheet'
            ? lang === 'id'
              ? 'Hapus Lembar Tes?'
              : 'テストシートを削除しますか？'
            : lang === 'id'
            ? 'Hapus Soal dari Bank Soal?'
            : '問題を削除しますか？'
        }
        message={
          confirmDelete?.kind === 'sheet'
            ? lang === 'id'
              ? `Lembar tes "${confirmDelete.item.title}" akan dihapus.`
              : `テストシート「${confirmDelete.item.title}」を削除します。`
            : confirmDelete?.kind === 'question'
            ? lang === 'id'
              ? `Soal "${confirmDelete.item.prompt.slice(0, 80)}" akan dihapus permanen.`
              : `問題「${confirmDelete.item.prompt.slice(0, 80)}」を削除します。`
            : ''
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={executeConfirmedDelete}
      />
    </div>
  );
}
