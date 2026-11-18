import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel, tr, UI_TEXT } from '../i18n';
import { ClassId, CLASSES, LanguageMode, Student, UserProfile } from '../types';
import { logActivity } from '../utils/activityLog';
import { CLASS_THEMES, getClassTheme } from '../utils/classTheme';
import { clampStr } from '../utils/payloadGuards';
import { EmptyStateIllustration } from './AnimatedPrimitives';
import { AppleContextMenuTrigger, APPLE_EASE, ContextMenuItem, SwipeableMobileRow } from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  onOpenUsersPage?: () => void;
  onSelectStudent?: (stu: Student) => void;
}

export function RosterAndStaff({
  lang,
  profile,
  students,
  onOpenUsersPage,
  onSelectStudent,
}: Props) {
  const [filterClass, setFilterClass] = useState<ClassId | 'all'>('all');
  const [search, setSearch] = useState('');

  // Add Single Student
  const [stuName, setStuName] = useState('');
  const [stuCode, setStuCode] = useState('');
  const [stuClass, setStuClass] = useState<ClassId>('hokkaido');
  const [stuGoal, setStuGoal] = useState('');

  // Bulk Paste
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkClass, setBulkClass] = useState<ClassId>('hokkaido');
  const [busy, setBusy] = useState(false);

  // Confirm delete dialog
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((s) => (filterClass === 'all' ? true : s.classId === filterClass))
      .filter((s) =>
        !q ? true : s.name.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q)
      )
      .sort((a, b) => a.classId.localeCompare(b.classId) || a.name.localeCompare(b.name));
  }, [students, filterClass, search]);

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = clampStr(stuName, 120);
    if (!cleanName) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'students'), {
        name: cleanName,
        studentCode: clampStr(stuCode, 40),
        classId: stuClass,
        targetGoal: clampStr(stuGoal, 120),
        active: true,
        notes: '',
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'student',
        targetLabel: cleanName,
        detail: `Added to ${stuClass}`,
      });
      setStuName('');
      setStuCode('');
      setStuGoal('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'students');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkImport = async () => {
    const lines = bulkText
      .split(/\r?\n/)
      .map((l) => clampStr(l, 120))
      .filter(Boolean);
    if (lines.length === 0) return;
    setBusy(true);
    try {
      const batch = lines.slice(0, 60);
      for (const line of batch) {
        await addDoc(collection(db, 'students'), {
          name: line,
          studentCode: '',
          classId: bulkClass,
          targetGoal: '',
          active: true,
          notes: '',
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'student',
        targetLabel: `${batch.length} students`,
        detail: `Bulk import to ${bulkClass}`,
      });
      setBulkText('');
      setBulkOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'students');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveClass = async (stu: Student, nextClass: ClassId) => {
    try {
      await updateDoc(doc(db, 'students', stu.id), {
        classId: nextClass,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: stu.name,
        detail: `Moved ${stu.classId} → ${nextClass}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${stu.id}`);
    }
  };

  const handleToggleStudentActive = async (stu: Student) => {
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
      handleFirestoreError(err, OperationType.UPDATE, `students/${stu.id}`);
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
        detail: `Removed from ${deleteTarget.classId}`,
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
    if (profile.role === 'head') {
      items.push({
        id: 'delete',
        label: lang === 'id' ? 'Hapus Siswa' : '学生を削除',
        destructive: true,
        onSelect: () => setDeleteTarget(stu),
      });
    }
    return items;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {tr(UI_TEXT.navRoster, lang)}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'id'
              ? 'Kelola daftar siswa untuk 4 kelas (Hokkaido, Saitama, Nara, Kaigo).'
              : '4クラス（北海道・埼玉・奈良・介護）の学生名簿を管理します。'}
          </p>
        </div>

        {profile.role === 'head' && onOpenUsersPage && (
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

      {/* Student Roster Management */}
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
              <span className="font-mono tabular-nums">{students.length}</span>)
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
        <form onSubmit={handleAddStudent} className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          <input
            type="text"
            required
            value={stuName}
            onChange={(e) => setStuName(e.target.value)}
            placeholder={lang === 'id' ? 'Nama Lengkap Siswa *' : '学生氏名 *'}
            className="sm:col-span-4 glass-input px-3.5 py-2 text-[14px] rounded-[12px]"
          />
          <input
            type="text"
            value={stuCode}
            onChange={(e) => setStuCode(e.target.value)}
            placeholder={lang === 'id' ? 'Kode / NIS (opsional)' : '学籍番号（任意）'}
            className="sm:col-span-2 glass-input px-3.5 py-2 text-[13px] font-mono tabular-nums rounded-[12px]"
          />
          <select
            value={stuClass}
            onChange={(e) => setStuClass(e.target.value as ClassId)}
            className="sm:col-span-3 glass-input px-3 py-2 text-[14px] rounded-[12px]"
          >
            {CLASSES.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c.id, lang)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={stuGoal}
            onChange={(e) => setStuGoal(e.target.value)}
            placeholder={lang === 'id' ? 'Target (N4 / Kaigo)' : '目標 (JLPT N4 / 介護等)'}
            className="sm:col-span-2 glass-input px-3.5 py-2 text-[14px] rounded-[12px]"
          />
          <button
            type="submit"
            disabled={busy}
            className="sm:col-span-1 apple-btn-primary inline-flex items-center justify-center gap-1 px-3 py-2 text-[14px] disabled:opacity-50"
            aria-label={lang === 'id' ? 'Tambah siswa' : '学生を追加'}
          >
            <Plus className="w-4 h-4" />
          </button>
        </form>

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
                      ? 'Tempel daftar nama siswa (1 nama per baris)'
                      : '1行に1名ずつ学生名を貼り付けてください'}
                  </span>
                  <select
                    value={bulkClass}
                    onChange={(e) => setBulkClass(e.target.value as ClassId)}
                    className="glass-input text-[12px] px-2.5 py-1.5 rounded-[10px]"
                  >
                    {CLASSES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {classLabel(c.id, lang)}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  rows={4}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={'Budi Santoso\nSiti Rahma\nAndi Pratama'}
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
                    disabled={busy}
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
                        : CLASSES.find((c) => c.id === cid)?.nameJa}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === 'id' ? 'Cari nama siswa...' : '学生検索...'}
            className="glass-input w-full sm:w-56 px-3.5 py-1.5 text-[14px] rounded-[12px]"
          />
        </div>

        {/* Empty State or Data View */}
        {filteredStudents.length === 0 ? (
          <EmptyStateIllustration
            kind="users"
            title={
              lang === 'id'
                ? 'Belum ada siswa terdaftar untuk filter ini.'
                : '該当する学生がまだ登録されていません。'
            }
            subtitle={
              lang === 'id'
                ? 'Gunakan formulir di atas untuk menambah siswa satu per satu atau banyak sekaligus.'
                : '上のフォームから学生を1名ずつ、または一括登録で追加できます。'
            }
          />
        ) : (
          <>
            {/* Mobile Swipeable Compact List (< md) */}
            <div className="md:hidden border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] divide-y divide-[#d2d2d7]/60 dark:divide-[#424245] overflow-hidden bg-white dark:bg-[#1d1d1f]">
              {filteredStudents.map((stu) => {
                const clsTheme = CLASS_THEMES[stu.classId];
                const ctxItems = buildStudentContextItems(stu);
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
                        {profile.role === 'head' && (
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
                        <div className="min-w-0 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${clsTheme.dotColor}`} />
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
                        <div className="flex items-center gap-2">
                          {stu.studentCode && (
                            <span className="font-mono tabular-nums">{stu.studentCode}</span>
                          )}
                          {stu.targetGoal && <span>· {stu.targetGoal}</span>}
                        </div>
                        <select
                          value={stu.classId}
                          onChange={(e) => handleMoveClass(stu, e.target.value as ClassId)}
                          className="glass-input text-[12px] rounded-[8px] px-2 py-1"
                        >
                          {CLASSES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {classLabel(c.id, lang)}
                            </option>
                          ))}
                        </select>
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
                      {lang === 'id' ? 'Target' : '目標'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Status' : '状態'}
                    </th>
                    {profile.role === 'head' && (
                      <th className="py-2.5 px-3 text-right font-medium">
                        {lang === 'id' ? 'Hapus' : '削除'}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((stu) => {
                    const clsTheme = CLASS_THEMES[stu.classId];
                    const ctxItems = buildStudentContextItems(stu);
                    return (
                      <tr key={stu.id} className="apple-table-row">
                        <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                          <AppleContextMenuTrigger items={ctxItems}>
                            {onSelectStudent ? (
                              <button
                                type="button"
                                onClick={() => onSelectStudent(stu)}
                                className="text-left font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] transition-colors"
                              >
                                {stu.name}
                              </button>
                            ) : (
                              stu.name
                            )}
                          </AppleContextMenuTrigger>
                        </td>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {stu.studentCode || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${clsTheme.dotColor}`} />
                            <select
                              value={stu.classId}
                              onChange={(e) => handleMoveClass(stu, e.target.value as ClassId)}
                              className="glass-input text-[12px] rounded-[8px] px-2 py-1"
                            >
                              {CLASSES.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {classLabel(c.id, lang)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {stu.targetGoal || '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => handleToggleStudentActive(stu)}
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
                        {profile.role === 'head' && (
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
