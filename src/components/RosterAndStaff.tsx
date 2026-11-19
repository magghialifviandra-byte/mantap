import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertCircle,
  Check,
  Edit3,
  GripVertical,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel, tr, UI_TEXT } from '../i18n';
import {
  ClassId,
  CLASSES,
  LanguageMode,
  ProgramDurationMonths,
  Student,
  UserProfile,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { getClassTheme } from '../utils/classTheme';
import { getTodayDateStr } from '../utils/dateUtils';
import { clampStr } from '../utils/payloadGuards';
import { calculateProgramEndDate, getStudentProgramProgress } from '../utils/programUtils';
import { importStudentsBatch } from '../utils/studentImport';
import { EmptyStateIllustration } from './AnimatedPrimitives';
import {
  AppleContextMenuTrigger,
  APPLE_EASE,
  ContextMenuItem,
  SwipeableMobileRow,
} from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  onOpenUsersPage?: () => void;
  onSelectStudent?: (stu: Student) => void;
}

interface PendingMoveUndo {
  message: string;
  items: { id: string; name: string; prevClassId: ClassId | '' }[];
  targetClassId: ClassId | '';
}

function summarizeStudentNames(names: string[], maxItems = 6): string {
  if (names.length <= maxItems) return names.join(', ');
  return `${names.slice(0, maxItems).join(', ')} (+${names.length - maxItems})`;
}

export function RosterAndStaff({
  lang,
  profile,
  students,
  onOpenUsersPage,
  onSelectStudent,
}: Props) {
  const isHead = profile.role === 'head';
  const today = getTodayDateStr();

  const senseiDefaultClass: ClassId = profile.assignedClasses?.[0] || 'hokkaido';

  const [filterClass, setFilterClass] = useState<ClassId | 'all'>('all');
  const [search, setSearch] = useState('');

  // Add Single Student
  const [stuName, setStuName] = useState('');
  const [stuCode, setStuCode] = useState('');
  const [stuClass, setStuClass] = useState<ClassId | ''>(isHead ? '' : senseiDefaultClass);
  const [stuGoal, setStuGoal] = useState('');
  const [stuProgramMonths, setStuProgramMonths] = useState<'' | '2' | '4' | '6'>(
    isHead ? '' : '6'
  );
  const [stuStartDate, setStuStartDate] = useState<string>(isHead ? '' : today);
  const [stuEndDate, setStuEndDate] = useState<string>(
    isHead ? '' : calculateProgramEndDate(today, 6)
  );

  // Inline program editing (Head Admin only)
  const [editingProgId, setEditingProgId] = useState<string | null>(null);
  const [progMonthsDraft, setProgMonthsDraft] = useState<ProgramDurationMonths>(6);
  const [progStartDraft, setProgStartDraft] = useState<string>('');
  const [progEndDraft, setProgEndDraft] = useState<string>('');

  // Bulk Paste Import
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkClass, setBulkClass] = useState<ClassId | ''>(isHead ? '' : senseiDefaultClass);

  // Selection, Bulk Class Assignment & Bulk Program Settings (Admin only)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTargetClass, setBulkTargetClass] = useState<ClassId>('hokkaido');
  const [bulkProgMonths, setBulkProgMonths] = useState<ProgramDurationMonths>(6);
  const [bulkProgStartDate, setBulkProgStartDate] = useState<string>(today);
  const [bulkProgEndDate, setBulkProgEndDate] = useState<string>(() =>
    calculateProgramEndDate(today, 6)
  );
  const [confirmBulkMove, setConfirmBulkMove] = useState<{
    targetClassId: ClassId;
    targets: Student[];
  } | null>(null);

  // Desktop Drag & Drop
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dragOverClass, setDragOverClass] = useState<ClassId | null>(null);

  // Feedback, Error & Undo
  const [busy, setBusy] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState('');
  const [undoMove, setUndoMove] = useState<PendingMoveUndo | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // Confirm delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);

  // Prune selectedIds if students are deleted
  useEffect(() => {
    const existingIds = new Set(students.map((s) => s.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (existingIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [students]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current !== null) {
        window.clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const showTempStatus = (msg: string) => {
    setErrorNotice('');
    setStatusNotice(msg);
    window.setTimeout(() => {
      setStatusNotice((curr) => (curr === msg ? '' : curr));
    }, 4500);
  };

  const triggerMoveUndoBanner = (payload: PendingMoveUndo) => {
    setErrorNotice('');
    setUndoMove(payload);
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
    undoTimerRef.current = window.setTimeout(() => {
      setUndoMove(null);
      undoTimerRef.current = null;
    }, 8000);
  };

  // Unassigned students (Admin only)
  const allUnassignedStudents = useMemo(() => {
    if (!isHead) return [];
    return students
      .filter((s) => !s.classId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [students, isHead]);

  const filteredUnassignedStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allUnassignedStudents;
    return allUnassignedStudents.filter(
      (s) => s.name.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q)
    );
  }, [allUnassignedStudents, search]);

  // Assigned roster students
  const assignedStudents = useMemo(() => {
    return students.filter((s) => Boolean(s.classId));
  }, [students]);

  const filteredAssignedStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignedStudents
      .filter((s) => (filterClass === 'all' ? true : s.classId === filterClass))
      .filter((s) =>
        !q ? true : s.name.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q)
      )
      .sort((a, b) => a.classId.localeCompare(b.classId) || a.name.localeCompare(b.name));
  }, [assignedStudents, filterClass, search]);

  const classCounts = useMemo(() => {
    const counts: Record<ClassId, number> = {
      hokkaido: 0,
      saitama: 0,
      nara: 0,
      kaigo: 0,
    };
    assignedStudents.forEach((s) => {
      if (s.classId && s.classId in counts) {
        counts[s.classId as ClassId] += 1;
      }
    });
    return counts;
  }, [assignedStudents]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectGroup = (group: Student[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      group.forEach((s) => {
        if (checked) next.add(s.id);
        else next.delete(s.id);
      });
      return next;
    });
  };

  const allUnassignedSelected =
    filteredUnassignedStudents.length > 0 &&
    filteredUnassignedStudents.every((s) => selectedIds.has(s.id));

  const allAssignedSelected =
    filteredAssignedStudents.length > 0 &&
    filteredAssignedStudents.every((s) => selectedIds.has(s.id));

  const selectedStudentsList = useMemo(
    () => students.filter((s) => selectedIds.has(s.id)),
    [students, selectedIds]
  );

  // Add Single Student
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = clampStr(stuName, 120);
    if (!cleanName) return;
    if (!isHead && (!stuClass || !(profile.assignedClasses || []).includes(stuClass as ClassId))) {
      setErrorNotice(
        lang === 'id'
          ? 'Pilih kelas yang Anda ampu terlebih dahulu.'
          : '担当クラスを選択してください。'
      );
      return;
    }
    setBusy(true);
    setErrorNotice('');
    try {
      const hasProg = stuProgramMonths !== '' && /^\d{4}-\d{2}-\d{2}$/.test(stuStartDate);
      const monthsNum = hasProg
        ? (Number(stuProgramMonths) as ProgramDurationMonths)
        : undefined;
      const calcEnd =
        hasProg && monthsNum
          ? isHead && /^\d{4}-\d{2}-\d{2}$/.test(stuEndDate)
            ? stuEndDate
            : calculateProgramEndDate(stuStartDate, monthsNum)
          : undefined;
      if (hasProg && (!calcEnd || calcEnd < stuStartDate)) {
        setErrorNotice(
          lang === 'id'
            ? 'Tanggal selesai belajar tidak boleh lebih awal dari tanggal mulai.'
            : '終了日は開始日以降の日付を指定してください。'
        );
        setBusy(false);
        return;
      }

      await addDoc(collection(db, 'students'), {
        name: cleanName,
        studentCode: clampStr(stuCode, 40),
        classId: stuClass,
        targetGoal: clampStr(stuGoal, 120),
        active: true,
        notes: '',
        ...(hasProg && monthsNum && calcEnd
          ? {
              programMonths: monthsNum,
              programStartDate: stuStartDate,
              programEndDate: calcEnd,
            }
          : {}),
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'student',
        targetLabel: cleanName,
        detail: `Added to ${stuClass || 'Unassigned'}${
          hasProg && monthsNum ? ` (${monthsNum}m, ${stuStartDate}〜${calcEnd})` : ''
        }`,
      });
      setStuName('');
      setStuCode('');
      setStuGoal('');
      showTempStatus(
        lang === 'id' ? `${cleanName} ditambahkan.` : `${cleanName} を登録しました。`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'students');
    } finally {
      setBusy(false);
    }
  };

  // Single inline program edit (Admin only)
  const handleSaveProgramDuration = async (stu: Student) => {
    if (!isHead) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(progStartDraft) || !/^\d{4}-\d{2}-\d{2}$/.test(progEndDraft)) {
      setErrorNotice(
        lang === 'id'
          ? 'Masukkan tanggal mulai dan tanggal selesai yang valid.'
          : '有効な開始日と終了日を入力してください。'
      );
      return;
    }
    if (progEndDraft < progStartDraft) {
      setErrorNotice(
        lang === 'id'
          ? 'Tanggal selesai belajar tidak boleh lebih awal dari tanggal mulai.'
          : '終了日は開始日以降の日付を指定してください。'
      );
      return;
    }
    setBusy(true);
    setErrorNotice('');
    const prevSummary =
      stu.programMonths && stu.programStartDate
        ? `${stu.programMonths}m (${stu.programStartDate} 〜 ${stu.programEndDate || '-'})`
        : 'Not set';
    try {
      await updateDoc(doc(db, 'students', stu.id), {
        programMonths: progMonthsDraft,
        programStartDate: progStartDraft,
        programEndDate: progEndDraft,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: stu.name,
        detail: `Program: ${prevSummary} → ${progMonthsDraft}m (${progStartDraft} 〜 ${progEndDraft})`,
      });
      setEditingProgId(null);
      showTempStatus(
        lang === 'id'
          ? `Masa belajar ${stu.name} diperbarui (${progStartDraft} 〜 ${progEndDraft})`
          : `${stu.name} の受講期間を更新しました（${progStartDraft} 〜 ${progEndDraft}）`
      );
    } catch (err) {
      console.error('Save program duration failed:', err);
      setErrorNotice(
        lang === 'id'
          ? 'Gagal menyimpan masa belajar. Silakan coba lagi.'
          : '受講期間の保存に失敗しました。もう一度お試しください。'
      );
    } finally {
      setBusy(false);
    }
  };

  // Reused & Fixed Idempotent Bulk Import
  const handleBulkImport = async () => {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => clampStr(l, 120))
      .filter(Boolean);
    if (lines.length === 0) return;
    if (!isHead && (!bulkClass || !(profile.assignedClasses || []).includes(bulkClass as ClassId))) {
      setErrorNotice(
        lang === 'id'
          ? 'Anda hanya dapat mengimpor ke kelas yang Anda ampu.'
          : '担当クラスのみ選択できます。'
      );
      return;
    }
    setBusy(true);
    setErrorNotice('');
    try {
      const res = await importStudentsBatch({
        names: lines,
        classId: bulkClass,
        actor: profile,
        existingStudents: students,
      });
      setBulkText('');
      setBulkOpen(false);
      showTempStatus(
        lang === 'ja'
          ? `${res.addedCount}名を追加しました（重複スキップ: ${res.skippedCount}名）`
          : lang === 'id'
          ? `${res.addedCount} siswa ditambahkan (${res.skippedCount} duplikat dilewati)`
          : `${res.addedCount} added (${res.skippedCount} skipped)`
      );
    } catch (err) {
      console.error('Bulk import failed:', err);
      setErrorNotice(
        lang === 'id'
          ? 'Gagal mengimpor siswa. Data yang Anda ketik tetap tersimpan.'
          : '一括登録に失敗しました。入力内容は保持されています。'
      );
    } finally {
      setBusy(false);
    }
  };

  // Move students (1 or many) preserving all existing data + Undo + Activity Log
  const executeClassMove = async (targets: Student[], targetClassId: ClassId) => {
    if (!isHead || targets.length === 0) return;
    const movable = targets.filter((s) => s.classId !== targetClassId);
    if (movable.length === 0) {
      showTempStatus(
        lang === 'id'
          ? 'Siswa yang dipilih sudah berada di kelas tersebut.'
          : '選択された学生はすでに該当クラスに所属しています。'
      );
      return;
    }

    setBusy(true);
    setErrorNotice('');
    try {
      const CHUNK = 400;
      for (let i = 0; i < movable.length; i += CHUNK) {
        const chunk = movable.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        chunk.forEach((stu) => {
          batch.update(doc(db, 'students', stu.id), {
            classId: targetClassId,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      const fromSummary = Array.from(
        new Set(movable.map((s) => (s.classId ? s.classId : 'Unassigned')))
      ).join('/');
      const namesList = movable.map((s) => s.name);

      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel:
          movable.length === 1
            ? movable[0].name
            : `${movable.length} students → ${targetClassId}`,
        detail: `Class move [${fromSummary} → ${targetClassId}]: ${summarizeStudentNames(
          namesList
        )}`,
      });

      const targetLabelStr = classLabel(targetClassId, lang);
      const msg =
        lang === 'ja'
          ? `${movable.length}名を${targetLabelStr}へ移動しました`
          : lang === 'id'
          ? `${movable.length} siswa dipindahkan ke ${targetLabelStr}`
          : `${movable.length} students moved to ${targetLabelStr}`;

      triggerMoveUndoBanner({
        message: msg,
        items: movable.map((s) => ({
          id: s.id,
          name: s.name,
          prevClassId: s.classId,
        })),
        targetClassId,
      });

      // Clear selection only after confirmed save
      setSelectedIds((prev) => {
        const next = new Set(prev);
        movable.forEach((s) => next.delete(s.id));
        return next;
      });
      setConfirmBulkMove(null);
    } catch (err) {
      // NEVER lose selection when save fails
      console.error('Class assignment batch failed:', err);
      setConfirmBulkMove(null);
      setErrorNotice(
        lang === 'id'
          ? 'Gagal memindahkan kelas. Pilihan siswa Anda tetap dipertahankan—silakan coba lagi.'
          : 'クラス移動の保存に失敗しました。選択状態は維持されていますので再試行してください。'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUndoLastMove = async () => {
    if (!undoMove || !isHead) return;
    const payload = undoMove;
    setUndoMove(null);
    setBusy(true);
    setErrorNotice('');
    try {
      const CHUNK = 400;
      for (let i = 0; i < payload.items.length; i += CHUNK) {
        const chunk = payload.items.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        chunk.forEach((item) => {
          batch.update(doc(db, 'students', item.id), {
            classId: item.prevClassId,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: `Undo move (${payload.items.length} students)`,
        detail: `Reverted move from ${payload.targetClassId || 'Unassigned'}: ${summarizeStudentNames(
          payload.items.map((x) => x.name)
        )}`,
      });
      showTempStatus(
        lang === 'id'
          ? `Perubahan untuk ${payload.items.length} siswa dibatalkan.`
          : `${payload.items.length}名のクラス移動を元に戻しました。`
      );
    } catch (err) {
      console.error('Undo class move failed:', err);
      setErrorNotice(
        lang === 'id'
          ? 'Gagal membatalkan pemindahan kelas.'
          : 'クラス移動の取り消しに失敗しました。'
      );
    } finally {
      setBusy(false);
    }
  };

  // Bulk Move button click (>10 confirmation guard)
  const handleBulkMoveApply = () => {
    if (!isHead || selectedStudentsList.length === 0) return;
    const movable = selectedStudentsList.filter((s) => s.classId !== bulkTargetClass);
    if (movable.length === 0) {
      showTempStatus(
        lang === 'id'
          ? 'Semua siswa terpilih sudah ada di kelas tujuan.'
          : '選択された学生はすでに移動先クラスにいます。'
      );
      return;
    }
    if (movable.length > 10) {
      setConfirmBulkMove({ targetClassId: bulkTargetClass, targets: movable });
      return;
    }
    void executeClassMove(movable, bulkTargetClass);
  };

  // Bulk Set Program Length, Start Date & End Date (Admin only)
  const handleBulkSetProgram = async () => {
    if (!isHead || selectedStudentsList.length === 0) return;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(bulkProgStartDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(bulkProgEndDate)
    ) {
      setErrorNotice(
        lang === 'id'
          ? 'Masukkan tanggal mulai dan tanggal selesai yang valid.'
          : '有効な開始日と終了日を入力してください。'
      );
      return;
    }
    if (bulkProgEndDate < bulkProgStartDate) {
      setErrorNotice(
        lang === 'id'
          ? 'Tanggal selesai belajar tidak boleh lebih awal dari tanggal mulai.'
          : '終了日は開始日以降の日付を指定してください。'
      );
      return;
    }

    setBusy(true);
    setErrorNotice('');
    try {
      const targets = selectedStudentsList;
      const CHUNK = 400;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk = targets.slice(i, i + CHUNK);
        const batch = writeBatch(db);
        chunk.forEach((stu) => {
          batch.update(doc(db, 'students', stu.id), {
            programMonths: bulkProgMonths,
            programStartDate: bulkProgStartDate,
            programEndDate: bulkProgEndDate,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      const prevSummary = Array.from(
        new Set(
          targets.map((s) =>
            s.programMonths && s.programStartDate
              ? `${s.programMonths}m(${s.programStartDate}〜${s.programEndDate || '-'})`
              : 'Not set'
          )
        )
      ).join(', ');

      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: `${targets.length} students program → ${bulkProgMonths}m`,
        detail: `Program [${prevSummary} → ${bulkProgMonths}m ${bulkProgStartDate}〜${bulkProgEndDate}]: ${summarizeStudentNames(
          targets.map((s) => s.name)
        )}`,
      });

      showTempStatus(
        lang === 'ja'
          ? `${targets.length}名の受講期間を ${bulkProgMonths}か月（${bulkProgStartDate} 〜 ${bulkProgEndDate}）に設定しました`
          : lang === 'id'
          ? `Masa belajar ${targets.length} siswa diatur ke ${bulkProgMonths} bulan (${bulkProgStartDate} 〜 ${bulkProgEndDate})`
          : `${targets.length} student(s) program set to ${bulkProgMonths}m (${bulkProgStartDate} 〜 ${bulkProgEndDate})`
      );
      setSelectedIds(new Set());
    } catch (err) {
      // Never lose selection on failure
      console.error('Bulk program update failed:', err);
      setErrorNotice(
        lang === 'id'
          ? 'Gagal menyimpan pengaturan program. Pilihan siswa tetap dipertahankan.'
          : '受講期間の一括保存に失敗しました。選択状態は維持されています。'
      );
    } finally {
      setBusy(false);
    }
  };

  // Drag-and-drop handlers (Desktop Admin only)
  const handleDragStartStudent = (e: React.DragEvent, stu: Student) => {
    if (!isHead) return;
    const idsToDrag =
      selectedIds.has(stu.id) && selectedIds.size > 0
        ? Array.from(selectedIds)
        : [stu.id];
    setDraggedIds(idsToDrag);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idsToDrag.join(','));
  };

  const handleDropOnClass = (e: React.DragEvent, targetClassId: ClassId) => {
    e.preventDefault();
    setDragOverClass(null);
    if (!isHead) return;
    const raw = e.dataTransfer.getData('text/plain');
    const ids = draggedIds.length > 0 ? draggedIds : raw.split(',').filter(Boolean);
    setDraggedIds([]);
    if (ids.length === 0) return;
    const targetStudents = students.filter((s) => ids.includes(s.id));
    const movable = targetStudents.filter((s) => s.classId !== targetClassId);
    if (movable.length === 0) return;
    if (movable.length > 10) {
      setConfirmBulkMove({ targetClassId, targets: movable });
      return;
    }
    void executeClassMove(movable, targetClassId);
  };

  const handleToggleStudentActive = async (stu: Student) => {
    setErrorNotice('');
    try {
      await updateDoc(doc(db, 'students', stu.id), {
        active: !stu.active,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: stu.name,
        detail: !stu.active ? 'Status → Active' : 'Status → Inactive',
      });
    } catch (err) {
      console.error('Toggle active failed:', err);
      setErrorNotice(
        lang === 'id' ? 'Gagal mengubah status siswa.' : '在籍状態の変更に失敗しました。'
      );
    }
  };

  const executeDeleteStudent = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'students', deleteTarget.id));
      await logActivity({
        actor: profile,
        actionType: 'data_delete',
        targetType: 'student',
        targetLabel: deleteTarget.name,
        detail: `Removed from ${deleteTarget.classId || 'Unassigned'}`,
      });
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `students/${deleteTarget.id}`);
    } finally {
      setBusy(false);
    }
  };

  const buildStudentContextItems = (stu: Student): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (onSelectStudent) {
      items.push({
        id: 'profile',
        label: lang === 'id' ? 'Lihat Profil Siswa' : '学生プロフィールを見る',
        onSelect: () => onSelectStudent(stu),
      });
    }
    items.push({
      id: 'toggle',
      label: stu.active
        ? lang === 'id'
          ? 'Tandai Nonaktif'
          : '休学/卒業にする'
        : lang === 'id'
        ? 'Aktifkan Kembali'
        : '在籍中に戻す',
      onSelect: () => void handleToggleStudentActive(stu),
    });
    if (isHead) {
      items.push({
        id: 'delete',
        label: lang === 'id' ? 'Hapus Siswa' : '学生を削除',
        destructive: true,
        onSelect: () => setDeleteTarget(stu),
      });
    }
    return items;
  };

  const notSetBadge = (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7]/70 dark:border-[#424245]">
      {lang === 'ja' ? '未設定' : lang === 'id' ? 'Belum diatur' : 'Not set'}
    </span>
  );

  const singleClassOptions: { value: ClassId | ''; label: string }[] = isHead
    ? [
        { value: '', label: classLabel('', lang) },
        ...CLASSES.map((c) => ({ value: c.id as ClassId, label: classLabel(c.id, lang) })),
      ]
    : (profile.assignedClasses || []).map((cid) => ({
        value: cid,
        label: classLabel(cid, lang),
      }));

  return (
    <div className="space-y-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">{tr(UI_TEXT.navRoster, lang)}</h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'id'
              ? 'Kelola daftar siswa untuk 4 kelas (Hokkaido, Saitama, Nara, Kaigo).'
              : '4クラス（北海道・埼玉・奈良・介護）の学生名簿を管理します。'}
          </p>
        </div>

        {isHead && onOpenUsersPage && (
          <button
            type="button"
            onClick={onOpenUsersPage}
            className="apple-btn-secondary inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] whitespace-nowrap shrink-0"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{tr(UI_TEXT.navUsers, lang)}</span>
          </button>
        )}
      </div>

      {/* Transient Confirmation / Undo / Error Banners */}
      <AnimatePresence>
        {errorNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="bg-[#fef2f2] dark:bg-[#2c1517] border border-[#fecaca] dark:border-[#7f1d1d] text-[#991b1b] dark:text-[#fca5a5] rounded-[14px] px-4 py-3 text-[13px] flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorNotice('')}
              className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}

        {undoMove && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#0071e3]/40 dark:border-[#2997ff]/40 rounded-[14px] px-4 py-3 text-[13px] flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
              <Check className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff] shrink-0" />
              <span>{undoMove.message}</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleUndoLastMove()}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-[#0071e3] dark:bg-[#2997ff] text-white hover:opacity-90 disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{lang === 'id' ? 'Urungkan' : '元に戻す'}</span>
            </button>
          </motion.div>
        )}

        {!undoMove && statusNotice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] rounded-[14px] px-4 py-2.5 text-[13px] flex items-center gap-2 text-[#1d1d1f] dark:text-[#f5f5f7]"
          >
            <Check className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff] shrink-0" />
            <span>{statusNotice}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PART 2.1: Admin-Only UNASSIGNED / 未配属 Section at Top */}
      {isHead && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: APPLE_EASE }}
          className="apple-tile border border-[#d2d2d7]/70 dark:border-[#424245]/80 p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'ja'
                  ? '未配属学生 (Unassigned)'
                  : lang === 'id'
                  ? 'Siswa Belum Ditempatkan'
                  : 'Unassigned / 未配属'}
              </h2>
              <span className="px-2.5 py-0.5 text-[12px] font-mono font-semibold tabular-nums rounded-full bg-[#0071e3]/10 dark:bg-[#2997ff]/15 text-[#0066cc] dark:text-[#2997ff]">
                {allUnassignedStudents.length}
              </span>
            </div>

            {filteredUnassignedStudents.length > 0 && (
              <label className="inline-flex items-center gap-2 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allUnassignedSelected}
                  onChange={(e) => toggleSelectGroup(filteredUnassignedStudents, e.target.checked)}
                  className="w-4 h-4 accent-[#0071e3] rounded"
                />
                <span>
                  {lang === 'ja'
                    ? '未配属をすべて選択'
                    : lang === 'id'
                    ? 'Pilih Semua'
                    : 'Select all'}
                </span>
              </label>
            )}
          </div>

          {allUnassignedStudents.length === 0 ? (
            <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] bg-[#f5f5f7] dark:bg-[#161617] rounded-[12px] px-4 py-3">
              {lang === 'ja'
                ? '未配属の学生はいません。全員にクラスが割り当てられています。'
                : lang === 'id'
                ? 'Tidak ada siswa tanpa kelas. Semua siswa telah ditempatkan ke kelas.'
                : 'No unassigned students.'}
            </div>
          ) : filteredUnassignedStudents.length === 0 ? (
            <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] bg-[#f5f5f7] dark:bg-[#161617] rounded-[12px] px-4 py-3">
              {lang === 'id'
                ? 'Tidak ada siswa tanpa kelas yang cocok dengan pencarian.'
                : '検索条件に一致する未配属学生がいません。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[320px] overflow-y-auto pr-1">
              {filteredUnassignedStudents.map((stu) => {
                const isSelected = selectedIds.has(stu.id);
                const prog = getStudentProgramProgress(stu, today);
                return (
                  <div
                    key={stu.id}
                    draggable
                    onDragStart={(e) => handleDragStartStudent(e, stu)}
                    onDragEnd={() => {
                      setDraggedIds([]);
                      setDragOverClass(null);
                    }}
                    className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-[12px] border transition-colors ${
                      isSelected
                        ? 'bg-[#0071e3]/8 dark:bg-[#2997ff]/12 border-[#0071e3]/60 dark:border-[#2997ff]/60'
                        : 'bg-[#f5f5f7] dark:bg-[#161617] border-[#d2d2d7]/60 dark:border-[#424245]/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectId(stu.id)}
                        aria-label={`Select ${stu.name}`}
                        className="w-4 h-4 accent-[#0071e3] rounded shrink-0"
                      />
                      <span
                        className="hidden md:inline-flex text-[#86868b] cursor-grab active:cursor-grabbing shrink-0"
                        title={
                          lang === 'id'
                            ? 'Seret ke kartu kelas di bawah'
                            : 'クラスカードへドラッグ'
                        }
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0">
                        {onSelectStudent ? (
                          <button
                            type="button"
                            onClick={() => onSelectStudent(stu)}
                            className="text-left text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] truncate block max-w-full"
                          >
                            {stu.name}
                          </button>
                        ) : (
                          <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                            {stu.name}
                          </div>
                        )}
                        <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b] flex items-center gap-1.5 mt-0.5">
                          {prog.isConfigured && prog.valid ? (
                            <span className="font-mono tabular-nums">
                              {prog.programMonths}m · {prog.startDate}
                            </span>
                          ) : (
                            notSetBadge
                          )}
                        </div>
                      </div>
                    </div>

                    <select
                      value=""
                      aria-label={`Assign class for ${stu.name}`}
                      onChange={(e) => {
                        const target = e.target.value as ClassId;
                        if (target) void executeClassMove([stu], target);
                      }}
                      className="glass-input text-[11px] rounded-[8px] px-2 py-1 shrink-0 max-w-[116px]"
                    >
                      <option value="">{lang === 'id' ? '+ Kelas' : '+ クラス'}</option>
                      {CLASSES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {classLabel(c.id, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {/* Desktop Drag-and-Drop Class Targets (hidden on phones < md) */}
          <div className="hidden md:block pt-2 border-t border-[#d2d2d7]/50 dark:border-[#424245]/60 space-y-2">
            <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
              {lang === 'ja'
                ? 'ドラッグ＆ドロップで学生（またはチェックしたグループ）をクラスへ配属できます'
                : lang === 'id'
                ? 'Seret & lepas siswa (atau grup terpilih) ke kartu kelas di bawah ini'
                : 'Drag student(s) onto a class card below to assign'}
            </div>
            <div className="grid grid-cols-4 gap-3">
              {CLASSES.map((cls) => {
                const cTheme = getClassTheme(cls.id);
                const isOver = dragOverClass === cls.id;
                return (
                  <div
                    key={cls.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragOverClass !== cls.id) setDragOverClass(cls.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverClass === cls.id) setDragOverClass(null);
                    }}
                    onDrop={(e) => handleDropOnClass(e, cls.id)}
                    className={`rounded-[14px] px-3.5 py-3 border transition-all flex items-center justify-between gap-2 ${
                      isOver
                        ? 'border-[#0071e3] dark:border-[#2997ff] bg-[#0071e3]/10 dark:bg-[#2997ff]/15 ring-2 ring-[#0071e3]/30'
                        : 'border-[#d2d2d7]/70 dark:border-[#424245]/70 bg-[#f5f5f7] dark:bg-[#161617]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {cTheme && (
                        <span className={`w-2 h-2 rounded-full shrink-0 ${cTheme.dotColor}`} />
                      )}
                      <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                        {lang === 'id' ? cls.nameId : cls.nameJa}
                      </span>
                    </div>
                    <span className="text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b] shrink-0">
                      {classCounts[cls.id]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* Main Class Roster Management */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: APPLE_EASE }}
        className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
            <Users className="w-4 h-4 text-[#0066cc] dark:text-[#2997ff]" />
            <span>
              {lang === 'id' ? 'Daftar Siswa' : '学生名簿'} (
              <span className="font-mono tabular-nums">{assignedStudents.length}</span>)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            className="px-3.5 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap"
          >
            {lang === 'id' ? 'Tambah Banyak Sekaligus' : '一括登録（コピペ）'}
          </button>
        </div>

        {/* Add single student */}
        <form onSubmit={handleAddStudent} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-3">
            <input
              type="text"
              required
              value={stuName}
              onChange={(e) => setStuName(e.target.value)}
              placeholder={lang === 'id' ? 'Nama Lengkap Siswa *' : '学生氏名 *'}
              className="w-full glass-input px-3.5 py-2 text-[14px] rounded-[12px]"
            />
          </div>
          <div className="sm:col-span-2">
            <input
              type="text"
              value={stuCode}
              onChange={(e) => setStuCode(e.target.value)}
              placeholder={lang === 'id' ? 'Kode / NIS' : '学籍番号'}
              className="w-full glass-input px-3 py-2 text-[13px] font-mono tabular-nums rounded-[12px]"
            />
          </div>
          <div className="sm:col-span-2">
            <select
              value={stuClass}
              onChange={(e) => setStuClass(e.target.value as ClassId | '')}
              className="w-full glass-input px-2.5 py-2 text-[13px] rounded-[12px]"
            >
              {singleClassOptions.map((opt) => (
                <option key={opt.value || 'unassigned'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className={isHead ? 'sm:col-span-1' : 'sm:col-span-2'}>
            <select
              value={stuProgramMonths}
              onChange={(e) => {
                const nextM = e.target.value as '' | '2' | '4' | '6';
                setStuProgramMonths(nextM);
                if (nextM) {
                  const baseStart = /^\d{4}-\d{2}-\d{2}$/.test(stuStartDate)
                    ? stuStartDate
                    : today;
                  if (!stuStartDate) setStuStartDate(baseStart);
                  setStuEndDate(
                    calculateProgramEndDate(baseStart, Number(nextM) as ProgramDurationMonths)
                  );
                } else {
                  setStuEndDate('');
                }
              }}
              aria-label={lang === 'id' ? 'Durasi program' : '受講期間'}
              className="w-full glass-input px-2 py-2 text-[13px] rounded-[12px]"
            >
              <option value="">{lang === 'id' ? 'Belum' : '未設定'}</option>
              <option value="2">{lang === 'id' ? '2 Bln' : '2か月'}</option>
              <option value="4">{lang === 'id' ? '4 Bln' : '4か月'}</option>
              <option value="6">{lang === 'id' ? '6 Bln' : '6か月'}</option>
            </select>
          </div>
          <label className="sm:col-span-2 block space-y-0.5">
            <span className="block text-[10px] font-medium text-[#6e6e73] dark:text-[#86868b] px-1">
              {lang === 'id' ? 'Tgl Mulai' : '開始日'}
            </span>
            <input
              type="date"
              value={stuStartDate}
              onChange={(e) => {
                const nextS = e.target.value;
                setStuStartDate(nextS);
                if (stuProgramMonths !== '' && /^\d{4}-\d{2}-\d{2}$/.test(nextS)) {
                  setStuEndDate(
                    calculateProgramEndDate(
                      nextS,
                      Number(stuProgramMonths) as ProgramDurationMonths
                    )
                  );
                }
              }}
              aria-label={lang === 'id' ? 'Tanggal mulai' : '開始日'}
              className="w-full glass-input px-2.5 py-2 text-[13px] font-mono tabular-nums rounded-[12px]"
            />
          </label>
          {isHead && (
            <label className="sm:col-span-2 block space-y-0.5">
              <span className="block text-[10px] font-medium text-[#6e6e73] dark:text-[#86868b] px-1">
                {lang === 'id' ? 'Tgl Selesai' : '終了日'}
              </span>
              <input
                type="date"
                value={stuEndDate}
                min={stuStartDate || undefined}
                onChange={(e) => setStuEndDate(e.target.value)}
                aria-label={lang === 'id' ? 'Tanggal selesai' : '終了日'}
                className="w-full glass-input px-2.5 py-2 text-[13px] font-mono tabular-nums rounded-[12px]"
              />
            </label>
          )}
          <div className={isHead ? 'sm:col-span-10' : 'sm:col-span-1'}>
            <input
              type="text"
              value={stuGoal}
              onChange={(e) => setStuGoal(e.target.value)}
              placeholder={lang === 'id' ? 'Target (N4/Kaigo)' : '目標 (N4/介護)'}
              className="w-full glass-input px-2.5 py-2 text-[13px] rounded-[12px]"
            />
          </div>
          <button
            type="submit"
            disabled={busy || (!isHead && singleClassOptions.length === 0)}
            className={`${isHead ? 'sm:col-span-2' : 'sm:col-span-1'} apple-btn-primary inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[14px] disabled:opacity-50`}
            aria-label={lang === 'id' ? 'Tambah siswa' : '学生を追加'}
          >
            <Plus className="w-4 h-4" />
            {isHead && (
              <span className="text-[13px]">{lang === 'id' ? 'Tambah' : '追加'}</span>
            )}
          </button>
        </form>

        {/* Idempotent Bulk Paste Import */}
        <AnimatePresence initial={false}>
          {bulkOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {lang === 'id'
                      ? 'Tempel daftar nama siswa (1 nama per baris · duplikat dilewati otomatis)'
                      : '1行に1名ずつ学生名を貼り付けてください（重複名は自動スキップ）'}
                  </span>
                  <select
                    value={bulkClass}
                    onChange={(e) => setBulkClass(e.target.value as ClassId | '')}
                    className="glass-input text-[12px] px-2.5 py-1.5 rounded-[10px]"
                  >
                    {singleClassOptions.map((opt) => (
                      <option key={opt.value || 'unassigned'} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'BUDI SANTOSO\nSITI RAHMA\nANDI PRATAMA'}
                  className="glass-input w-full px-3.5 py-2 text-[14px] rounded-[12px]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkOpen(false)}
                    className="px-3.5 py-1.5 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] bg-white dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors"
                  >
                    {tr(UI_TEXT.cancel, lang)}
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkImport}
                    disabled={busy || !bulkText.trim()}
                    className="apple-btn-primary px-4 py-1.5 text-[12px] disabled:opacity-50"
                  >
                    {lang === 'id' ? 'Simpan Semua' : '一括登録実行'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Filter & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#d2d2d7]/60 dark:border-[#424245]">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-full bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245]">
            {(['all', ...CLASSES.map((c) => c.id)] as const).map((cid) => {
              const active = filterClass === cid;
              const clsTheme = getClassTheme(cid);
              return (
                <button
                  key={cid}
                  type="button"
                  onClick={() => setFilterClass(cid)}
                  className={`relative px-3.5 py-1.5 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                    active
                      ? 'text-white'
                      : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="rosterClassPill"
                      transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                      className="absolute inset-0 rounded-full bg-[#0071e3] dark:bg-[#2997ff]"
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">
                    {clsTheme && !active && (
                      <span className={`w-1.5 h-1.5 rounded-full ${clsTheme.dotColor}`} />
                    )}
                    <span>
                      {cid === 'all'
                        ? tr(UI_TEXT.allClasses, lang)
                        : lang === 'id'
                        ? CLASSES.find((c) => c.id === cid)?.nameId
                        : CLASSES.find((c) => c.id === cid)?.nameJa}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {isHead && filteredAssignedStudents.length > 0 && (
              <label className="md:hidden inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={allAssignedSelected}
                  onChange={(e) => toggleSelectGroup(filteredAssignedStudents, e.target.checked)}
                  className="w-4 h-4 accent-[#0071e3] rounded"
                />
                <span>{lang === 'id' ? 'Pilih' : '全選択'}</span>
              </label>
            )}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'id' ? 'Cari nama siswa...' : '学生検索...'}
              className="glass-input flex-1 sm:w-56 px-3.5 py-1.5 text-[14px] rounded-[12px]"
            />
          </div>
        </div>

        {/* Empty State or Data View */}
        {filteredAssignedStudents.length === 0 ? (
          <EmptyStateIllustration
            kind="users"
            title={
              lang === 'id'
                ? 'Belum ada siswa di kelas ini untuk filter ini.'
                : '該当クラスの学生がまだいません。'
            }
            subtitle={
              isHead
                ? lang === 'id'
                  ? 'Pindahkan siswa dari daftar "Siswa Belum Ditempatkan" di atas atau tambah siswa baru.'
                  : '上の「未配属学生」セクションから移動するか、新しい学生を追加してください。'
                : lang === 'id'
                ? 'Gunakan formulir di atas untuk menambah siswa ke kelas Anda.'
                : '上のフォームから担当クラスの学生を追加できます。'
            }
          />
        ) : (
          <>
            {/* Mobile Swipeable Compact List (< md) — Checkboxes + bottom action bar, no drag-and-drop */}
            <div className="md:hidden border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] divide-y divide-[#d2d2d7]/60 dark:divide-[#424245] overflow-hidden bg-white dark:bg-[#1d1d1f]">
              {filteredAssignedStudents.map((stu) => {
                const clsTheme = getClassTheme(stu.classId);
                const ctxItems = buildStudentContextItems(stu);
                const prog = getStudentProgramProgress(stu, today);
                const isSelected = selectedIds.has(stu.id);
                return (
                  <SwipeableMobileRow
                    key={stu.id}
                    className="apple-virtual-item bg-white dark:bg-[#1d1d1f]"
                    actions={
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleToggleStudentActive(stu)}
                          className="px-2.5 py-1.5 rounded-full text-[11px] font-medium bg-[#0071e3] text-white whitespace-nowrap"
                        >
                          {stu.active
                            ? lang === 'id'
                              ? 'Nonaktif'
                              : '休学'
                            : lang === 'id'
                            ? 'Aktif'
                            : '在籍'}
                        </button>
                        {isHead && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(stu)}
                            aria-label={`Delete ${stu.name}`}
                            className="p-2 rounded-full bg-[#dc2626] text-white"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    }
                  >
                    <AppleContextMenuTrigger items={ctxItems} className="px-3.5 py-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex items-center gap-2.5">
                          {isHead && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectId(stu.id)}
                              aria-label={`Select ${stu.name}`}
                              className="w-4 h-4 accent-[#0071e3] rounded shrink-0"
                            />
                          )}
                          {clsTheme && (
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${clsTheme.dotColor}`}
                            />
                          )}
                          {onSelectStudent ? (
                            <button
                              type="button"
                              onClick={() => onSelectStudent(stu)}
                              className="text-left text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] truncate"
                            >
                              {stu.name}
                            </button>
                          ) : (
                            <span className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                              {stu.name}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleStudentActive(stu)}
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
                            stu.active
                              ? 'bg-[#16a34a]/10 text-[#15803d] dark:text-[#30d158]'
                              : 'bg-[#6e6e73]/12 text-[#6e6e73] dark:text-[#86868b]'
                          }`}
                        >
                          {stu.active
                            ? lang === 'id'
                              ? 'Aktif'
                              : '在籍中'
                            : lang === 'id'
                            ? 'Nonaktif'
                            : '休学/卒業'}
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        <div className="flex flex-wrap items-center gap-2">
                          {stu.studentCode && (
                            <span className="font-mono tabular-nums">{stu.studentCode}</span>
                          )}
                          {stu.targetGoal && <span>· {stu.targetGoal}</span>}
                          {prog.isConfigured && prog.valid ? (
                            <span className="font-mono tabular-nums text-[#0066cc] dark:text-[#2997ff]">
                              · {prog.programMonths}
                              {lang === 'id' ? 'Bln' : 'か月'} ({prog.startDate} 〜 {prog.endDate})
                            </span>
                          ) : (
                            notSetBadge
                          )}
                        </div>
                        {isHead ? (
                          <select
                            value={stu.classId}
                            onChange={(e) =>
                              void executeClassMove([stu], e.target.value as ClassId)
                            }
                            className="glass-input text-[12px] rounded-[8px] px-2 py-1"
                          >
                            {CLASSES.map((c) => (
                              <option key={c.id} value={c.id}>
                                {classLabel(c.id, lang)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[12px] font-medium">
                            {classLabel(stu.classId, lang)}
                          </span>
                        )}
                      </div>
                    </AppleContextMenuTrigger>
                  </SwipeableMobileRow>
                );
              })}
            </div>

            {/* Desktop Data Table (>= md) */}
            <div className="hidden md:block apple-table-wrap apple-scroll-x max-h-[600px] overflow-y-auto">
              <table className="w-full text-[14px] text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                  <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {isHead && (
                      <th className="py-2.5 px-3 w-10">
                        <input
                          type="checkbox"
                          checked={allAssignedSelected}
                          onChange={(e) =>
                            toggleSelectGroup(filteredAssignedStudents, e.target.checked)
                          }
                          aria-label={lang === 'id' ? 'Pilih semua siswa' : '表示中の学生をすべて選択'}
                          className="w-4 h-4 accent-[#0071e3] rounded"
                        />
                      </th>
                    )}
                    <th className="py-2.5 px-3 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[15]">
                      {lang === 'id' ? 'Nama' : '氏名'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Kode' : '番号'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Kelas' : 'クラス'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Durasi Program' : 'プログラム期間'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Tanggal Mulai' : '開始日'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Tanggal Selesai' : '終了日'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Target' : '目標'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Status' : '状態'}
                    </th>
                    {isHead && (
                      <th className="py-2.5 px-3 text-right font-medium">
                        {lang === 'id' ? 'Hapus' : '削除'}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignedStudents.map((stu) => {
                    const clsTheme = getClassTheme(stu.classId);
                    const ctxItems = buildStudentContextItems(stu);
                    const prog = getStudentProgramProgress(stu, today);
                    const isEditingProg = editingProgId === stu.id;
                    const isSelected = selectedIds.has(stu.id);

                    return (
                      <tr
                        key={stu.id}
                        draggable={isHead}
                        onDragStart={(e) => handleDragStartStudent(e, stu)}
                        onDragEnd={() => {
                          setDraggedIds([]);
                          setDragOverClass(null);
                        }}
                        className={`apple-table-row ${
                          isSelected ? 'bg-[#0071e3]/5 dark:bg-[#2997ff]/10' : ''
                        }`}
                      >
                        {isHead && (
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectId(stu.id)}
                              aria-label={`Select ${stu.name}`}
                              className="w-4 h-4 accent-[#0071e3] rounded"
                            />
                          </td>
                        )}
                        <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                          <AppleContextMenuTrigger items={ctxItems}>
                            <div className="flex items-center gap-1.5">
                              {isHead && (
                                <GripVertical className="w-3.5 h-3.5 text-[#86868b] cursor-grab shrink-0" />
                              )}
                              {onSelectStudent ? (
                                <button
                                  type="button"
                                  onClick={() => onSelectStudent(stu)}
                                  className="text-left font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] transition-colors"
                                >
                                  {stu.name}
                                </button>
                              ) : (
                                <span>{stu.name}</span>
                              )}
                            </div>
                          </AppleContextMenuTrigger>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {stu.studentCode || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="inline-flex items-center gap-1.5">
                            {clsTheme && (
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${clsTheme.dotColor}`}
                              />
                            )}
                            {isHead ? (
                              <select
                                value={stu.classId}
                                onChange={(e) =>
                                  void executeClassMove([stu], e.target.value as ClassId)
                                }
                                className="glass-input text-[12px] rounded-[8px] px-2 py-1"
                              >
                                {CLASSES.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {classLabel(c.id, lang)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {classLabel(stu.classId, lang)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Program Length Column */}
                        <td className="py-2.5 px-3 text-[12px]">
                          {isEditingProg && isHead ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={progMonthsDraft}
                                onChange={(e) => {
                                  const nextM = Number(e.target.value) as ProgramDurationMonths;
                                  setProgMonthsDraft(nextM);
                                  const autoEnd = calculateProgramEndDate(progStartDraft, nextM);
                                  if (autoEnd) setProgEndDraft(autoEnd);
                                }}
                                className="glass-input text-[11px] rounded-[6px] px-1.5 py-1"
                              >
                                <option value={2}>2{lang === 'id' ? ' Bln' : 'か月'}</option>
                                <option value={4}>4{lang === 'id' ? ' Bln' : 'か月'}</option>
                                <option value={6}>6{lang === 'id' ? ' Bln' : 'か月'}</option>
                              </select>
                            </div>
                          ) : stu.programMonths ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                                {stu.programMonths}
                                {lang === 'id' ? ' Bulan' : 'か月'}
                              </span>
                              {prog.isConfigured && prog.valid && (
                                <span className="text-[11px] text-[#0066cc] dark:text-[#2997ff] tabular-nums">
                                  {prog.isCompleted
                                    ? lang === 'id'
                                      ? '· Selesai'
                                      : '· 修了'
                                    : lang === 'id'
                                    ? `· Bln ${prog.currentMonth}/${prog.totalMonths}`
                                    : `· ${prog.currentMonth}/${prog.totalMonths}か月目`}
                                </span>
                              )}
                            </div>
                          ) : (
                            notSetBadge
                          )}
                        </td>

                        {/* Start Date Column */}
                        <td className="py-2.5 px-3 text-[12px]">
                          {isEditingProg && isHead ? (
                            <input
                              type="date"
                              value={progStartDraft}
                              onChange={(e) => {
                                const nextS = e.target.value;
                                setProgStartDraft(nextS);
                                const autoEnd = calculateProgramEndDate(nextS, progMonthsDraft);
                                if (autoEnd) setProgEndDraft(autoEnd);
                              }}
                              aria-label={lang === 'id' ? 'Tanggal mulai' : '開始日'}
                              className="glass-input text-[11px] font-mono tabular-nums rounded-[6px] px-1.5 py-1"
                            />
                          ) : stu.programStartDate ? (
                            <span className="font-mono tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {stu.programStartDate}
                            </span>
                          ) : (
                            notSetBadge
                          )}
                        </td>

                        {/* End Date / Study Period Completion Column (+ inline Save/Edit control for Head) */}
                        <td className="py-2.5 px-3 text-[12px]">
                          {isEditingProg && isHead ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                value={progEndDraft}
                                min={progStartDraft || undefined}
                                onChange={(e) => setProgEndDraft(e.target.value)}
                                aria-label={lang === 'id' ? 'Tanggal selesai' : '終了日'}
                                className="glass-input text-[11px] font-mono tabular-nums rounded-[6px] px-1.5 py-1"
                              />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleSaveProgramDuration(stu)}
                                className="p-1 rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white"
                                aria-label="Save program"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingProgId(null)}
                                className="p-1 rounded-full border border-[#d2d2d7] dark:border-[#424245]"
                                aria-label="Cancel edit program"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {prog.endDate ? (
                                <div>
                                  <div className="font-mono tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
                                    {prog.endDate}
                                  </div>
                                  {prog.isConfigured && prog.valid && (
                                    <div className="text-[10px] tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                                      {prog.isCompleted
                                        ? lang === 'id'
                                          ? 'Selesai'
                                          : '修了済'
                                        : lang === 'id'
                                        ? `Sisa ${prog.daysRemaining} hr`
                                        : `残り${prog.daysRemaining}日`}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                notSetBadge
                              )}
                              {isHead && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextM = (stu.programMonths as ProgramDurationMonths) || 6;
                                    const nextS = stu.programStartDate || today;
                                    const nextE =
                                      stu.programEndDate || calculateProgramEndDate(nextS, nextM);
                                    setProgMonthsDraft(nextM);
                                    setProgStartDraft(nextS);
                                    setProgEndDraft(nextE);
                                    setEditingProgId(stu.id);
                                  }}
                                  className="p-1 text-[#6e6e73] hover:text-[#0066cc] dark:text-[#86868b] dark:hover:text-[#2997ff]"
                                  title={
                                    lang === 'id'
                                      ? 'Ubah masa belajar & tanggal selesai'
                                      : '受講期間・終了日を編集'
                                  }
                                >
                                  <Edit3 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {stu.targetGoal || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => void handleToggleStudentActive(stu)}
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium transition-colors whitespace-nowrap ${
                              stu.active
                                ? 'bg-[#16a34a]/10 text-[#15803d] dark:text-[#30d158]'
                                : 'bg-[#6e6e73]/12 text-[#6e6e73] dark:text-[#86868b]'
                            }`}
                          >
                            {stu.active
                              ? lang === 'id'
                                ? 'Aktif'
                                : '在籍中'
                              : lang === 'id'
                              ? 'Nonaktif'
                              : '休学/卒業'}
                          </button>
                        </td>
                        {isHead && (
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(stu)}
                              className="text-[#6e6e73] dark:text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] p-1 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                              aria-label={`Delete ${stu.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </motion.div>

      {/* PART 2.2 & 2.3: Sticky Compact Selection Action Bar (Admin Only) */}
      <AnimatePresence>
        {isHead && selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: APPLE_EASE }}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-[1040px] no-print"
          >
            <div className="bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border border-[#d2d2d7] dark:border-[#424245] rounded-[20px] px-4 py-3 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Count & Clear */}
              <div className="flex items-center justify-between lg:justify-start gap-3">
                <div className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                  <span className="px-2.5 py-0.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white text-[12px]">
                    {selectedIds.size}
                  </span>
                  <span>
                    {lang === 'ja'
                      ? '名を選択中'
                      : lang === 'id'
                      ? 'siswa dipilih'
                      : 'selected'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-[12px] text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] inline-flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{lang === 'id' ? 'Batal Pilih' : '解除'}</span>
                </button>
              </div>

              {/* Bulk Actions: Move to Class & Set Program */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Move to Class */}
                <div className="flex flex-wrap items-center gap-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full px-2.5 py-1 border border-[#d2d2d7]/60 dark:border-[#424245]">
                  <span className="text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] pl-1">
                    {lang === 'ja'
                      ? 'クラス移動:'
                      : lang === 'id'
                      ? 'Pindah ke:'
                      : 'Move to:'}
                  </span>
                  <select
                    value={bulkTargetClass}
                    onChange={(e) => setBulkTargetClass(e.target.value as ClassId)}
                    className="bg-transparent text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none py-0.5 pr-1"
                  >
                    {CLASSES.map((c) => (
                      <option
                        key={c.id}
                        value={c.id}
                        className="bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      >
                        {classLabel(c.id, lang)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleBulkMoveApply}
                    className="apple-btn-primary px-3 py-1 text-[12px] disabled:opacity-50 whitespace-nowrap"
                  >
                    {lang === 'ja' ? '適用' : lang === 'id' ? 'Terapkan' : 'Apply'}
                  </button>
                </div>

                {/* Set Program Length, Start Date & End Date */}
                <div className="flex flex-wrap items-center gap-1.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full px-2.5 py-1 border border-[#d2d2d7]/60 dark:border-[#424245]">
                  <span className="text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] pl-1">
                    {lang === 'ja'
                      ? '期間設定:'
                      : lang === 'id'
                      ? 'Masa Belajar:'
                      : 'Set program:'}
                  </span>
                  <select
                    value={bulkProgMonths}
                    onChange={(e) => {
                      const nextM = Number(e.target.value) as ProgramDurationMonths;
                      setBulkProgMonths(nextM);
                      const autoEnd = calculateProgramEndDate(bulkProgStartDate, nextM);
                      if (autoEnd) setBulkProgEndDate(autoEnd);
                    }}
                    className="bg-transparent text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none py-0.5"
                  >
                    <option value={2} className="bg-white dark:bg-[#1d1d1f]">
                      2{lang === 'id' ? ' Bln' : 'か月'}
                    </option>
                    <option value={4} className="bg-white dark:bg-[#1d1d1f]">
                      4{lang === 'id' ? ' Bln' : 'か月'}
                    </option>
                    <option value={6} className="bg-white dark:bg-[#1d1d1f]">
                      6{lang === 'id' ? ' Bln' : 'か月'}
                    </option>
                  </select>
                  <input
                    type="date"
                    value={bulkProgStartDate}
                    onChange={(e) => {
                      const nextS = e.target.value;
                      setBulkProgStartDate(nextS);
                      const autoEnd = calculateProgramEndDate(nextS, bulkProgMonths);
                      if (autoEnd) setBulkProgEndDate(autoEnd);
                    }}
                    aria-label={lang === 'id' ? 'Tanggal mulai program' : '開始日'}
                    className="bg-transparent text-[12px] font-mono tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none py-0.5"
                  />
                  <span className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                    〜
                  </span>
                  <input
                    type="date"
                    value={bulkProgEndDate}
                    min={bulkProgStartDate || undefined}
                    onChange={(e) => setBulkProgEndDate(e.target.value)}
                    aria-label={lang === 'id' ? 'Tanggal selesai program' : '終了日'}
                    className="bg-transparent text-[12px] font-mono tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none py-0.5"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleBulkSetProgram()}
                    className="apple-btn-primary px-3 py-1 text-[12px] disabled:opacity-50 whitespace-nowrap"
                  >
                    {lang === 'ja' ? '適用' : lang === 'id' ? 'Terapkan' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirm Bulk Move (> 10 students) */}
      <ConfirmDialog
        open={Boolean(confirmBulkMove)}
        lang={lang}
        busy={busy}
        title={
          lang === 'id'
            ? 'Konfirmasi Pemindahan Banyak Siswa'
            : '多数学生のクラス移動確認'
        }
        message={
          confirmBulkMove
            ? lang === 'id'
              ? `Pindahkan ${confirmBulkMove.targets.length} siswa sekaligus ke ${classLabel(
                  confirmBulkMove.targetClassId,
                  lang
                )}?`
              : `${confirmBulkMove.targets.length}名の学生をまとめて ${classLabel(
                  confirmBulkMove.targetClassId,
                  lang
                )} へ移動しますか？`
            : ''
        }
        onCancel={() => setConfirmBulkMove(null)}
        onConfirm={() => {
          if (confirmBulkMove) {
            void executeClassMove(confirmBulkMove.targets, confirmBulkMove.targetClassId);
          }
        }}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        busy={busy}
        title={lang === 'id' ? 'Hapus Data Siswa?' : '学生データを削除しますか？'}
        message={
          deleteTarget
            ? lang === 'id'
              ? `Siswa "${deleteTarget.name}" (${classLabel(deleteTarget.classId, lang)}) akan dihapus dari daftar.`
              : `「${deleteTarget.name}」（${classLabel(deleteTarget.classId, lang)}）を名簿から削除します。`
            : ''
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDeleteStudent}
      />
    </div>
  );
}
