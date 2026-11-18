import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  BookLock,
  CheckSquare,
  Download,
  Edit3,
  FileText,
  Paperclip,
  Pin,
  Plus,
  Printer,
  Search,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel, tr, UI_TEXT } from '../i18n';
import {
  ClassId,
  CLASSES,
  HeadJournalCategory,
  HeadJournalEntry,
  JournalTodoItem,
  LanguageMode,
  Student,
  UserProfile,
} from '../types';
import { CLASS_THEMES } from '../utils/classTheme';
import { getTodayDateStr } from '../utils/dateUtils';
import { clampStr, sanitizeDateStr } from '../utils/payloadGuards';
import { exportHeadJournalXlsx } from '../utils/reportExport';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import { AppleModalSheet } from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  entries: HeadJournalEntry[];
  students: Student[];
  staffUsers: UserProfile[];
  onRegisterPrintView: (node: React.ReactNode | null) => void;
}

const CATEGORIES: {
  id: HeadJournalCategory;
  ja: string;
  idLabel: string;
  badgeCls: string;
}[] = [
  {
    id: 'decision',
    ja: '決定事項',
    idLabel: 'Keputusan',
    badgeCls: 'bg-[#0071e3]/10 border-transparent text-[#0066cc] dark:text-[#2997ff]',
  },
  {
    id: 'meeting',
    ja: '会議',
    idLabel: 'Rapat',
    badgeCls: 'bg-[#6e6e73]/12 border-transparent text-[#1d1d1f] dark:text-[#f5f5f7]',
  },
  {
    id: 'incident',
    ja: '事案・対応',
    idLabel: 'Insiden',
    badgeCls: 'bg-[#dc2626]/10 border-transparent text-[#dc2626] dark:text-[#ff453a]',
  },
  {
    id: 'idea',
    ja: 'アイデア',
    idLabel: 'Ide',
    badgeCls: 'bg-amber-500/12 border-transparent text-amber-700 dark:text-amber-400',
  },
  {
    id: 'evaluation',
    ja: '評価・所見',
    idLabel: 'Evaluasi',
    badgeCls: 'bg-emerald-500/12 border-transparent text-emerald-700 dark:text-emerald-400',
  },
  {
    id: 'todo',
    ja: 'To-Do',
    idLabel: 'To-Do',
    badgeCls: 'bg-[#6e6e73]/12 border-transparent text-[#6e6e73] dark:text-[#f5f5f7]/80',
  },
];

const MAX_ATTACHMENT_DATA_URL_LEN = 245000;

export function HeadJournalView({
  lang,
  profile,
  entries,
  students,
  staffUsers,
  onRegisterPrintView,
}: Props) {
  const isHead = profile.role === 'head';
  const today = getTodayDateStr();

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<HeadJournalCategory | 'all'>('all');
  const [dateFilter, setDateFilter] = useState('');

  // Form / Modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<HeadJournalEntry | null>(null);
  const [date, setDate] = useState(today);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<HeadJournalCategory>('decision');
  const [content, setContent] = useState('');
  const [relatedClassId, setRelatedClassId] = useState<ClassId | ''>('');
  const [relatedTeacherUid, setRelatedTeacherUid] = useState('');
  const [relatedStudentId, setRelatedStudentId] = useState('');
  const [attachmentName, setAttachmentName] = useState('');
  const [attachmentDataUrl, setAttachmentDataUrl] = useState('');
  const [pinned, setPinned] = useState(false);
  const [todoItems, setTodoItems] = useState<JournalTodoItem[]>([]);
  const [todoDraftText, setTodoDraftText] = useState('');
  const [todoDraftDue, setTodoDraftDue] = useState('');

  // Preview attachment / Delete / Print states
  const [previewAttachment, setPreviewAttachment] = useState<{
    name: string;
    dataUrl: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HeadJournalEntry | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const flashToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const resetForm = () => {
    setEditingEntry(null);
    setDate(today);
    setTitle('');
    setCategory('decision');
    setContent('');
    setRelatedClassId('');
    setRelatedTeacherUid('');
    setRelatedStudentId('');
    setAttachmentName('');
    setAttachmentDataUrl('');
    setPinned(false);
    setTodoItems([]);
    setTodoDraftText('');
    setTodoDraftDue('');
  };

  const openCreateForm = () => {
    resetForm();
    setFormOpen(true);
  };

  const openEditForm = (entry: HeadJournalEntry) => {
    setEditingEntry(entry);
    setDate(entry.date);
    setTitle(entry.title);
    setCategory(entry.category);
    setContent(entry.content);
    setRelatedClassId(entry.relatedClassId || '');
    setRelatedTeacherUid(entry.relatedTeacherUid || '');
    setRelatedStudentId(entry.relatedStudentId || '');
    setAttachmentName(entry.attachmentName || '');
    setAttachmentDataUrl(entry.attachmentDataUrl || '');
    setPinned(Boolean(entry.pinned));
    setTodoItems(entry.todoItems || []);
    setTodoDraftText('');
    setTodoDraftDue('');
    setFormOpen(true);
  };

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...entries]
      .filter((e) => (categoryFilter === 'all' ? true : e.category === categoryFilter))
      .filter((e) => (!dateFilter ? true : e.date === dateFilter))
      .filter((e) => {
        if (!q) return true;
        return (
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q) ||
          (e.relatedTeacherName || '').toLowerCase().includes(q) ||
          (e.relatedStudentName || '').toLowerCase().includes(q) ||
          (e.todoItems || []).some((t) => t.text.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.date.localeCompare(a.date);
      });
  }, [entries, categoryFilter, dateFilter, search]);

  const activeTeachers = useMemo(
    () =>
      staffUsers
        .filter((u) => u.status === 'active')
        .sort((a, b) => (a.nickname || a.displayName).localeCompare(b.nickname || b.displayName)),
    [staffUsers]
  );

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name)),
    [students]
  );

  const handleAttachmentFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 175 * 1024) {
      flashToast(
        lang === 'id'
          ? 'Ukuran lampiran terlalu besar (maks ~170 KB agar tersimpan aman).'
          : '添付ファイルが大きすぎます（上限 約170KB）。'
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result.length > MAX_ATTACHMENT_DATA_URL_LEN) {
        flashToast(
          lang === 'id'
            ? 'Data lampiran melebihi batas penyimpanan (245 KB).'
            : '添付データが上限を超えています。'
        );
        return;
      }
      setAttachmentName(clampStr(file.name, 150));
      setAttachmentDataUrl(result);
    };
    reader.readAsDataURL(file);
  };

  const handleAddTodoItem = () => {
    const clean = clampStr(todoDraftText, 200);
    if (!clean) return;
    if (todoItems.length >= 20) {
      flashToast(lang === 'id' ? 'Maksimal 20 item To-Do per catatan.' : 'To-Doは最大20件までです。');
      return;
    }
    setTodoItems((prev) => [
      ...prev,
      {
        id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: clean,
        dueDate: todoDraftDue ? sanitizeDateStr(todoDraftDue, '') : '',
        done: false,
      },
    ]);
    setTodoDraftText('');
    setTodoDraftDue('');
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHead) return;
    const cleanTitle = clampStr(title, 150);
    if (!cleanTitle) return;

    const teacherObj = activeTeachers.find((t) => t.uid === relatedTeacherUid);
    const stuObj = sortedStudents.find((s) => s.id === relatedStudentId);

    const payload = {
      date: sanitizeDateStr(date, today),
      title: cleanTitle,
      category,
      content: clampStr(content, 4000),
      relatedClassId: relatedClassId || '',
      relatedTeacherUid: clampStr(relatedTeacherUid, 128),
      relatedTeacherName: clampStr(
        teacherObj ? teacherObj.nickname || teacherObj.displayName : '',
        100
      ),
      relatedStudentId: clampStr(relatedStudentId, 128),
      relatedStudentName: clampStr(stuObj ? stuObj.name : '', 120),
      attachmentName: clampStr(attachmentName, 150),
      attachmentDataUrl:
        attachmentDataUrl.length <= MAX_ATTACHMENT_DATA_URL_LEN ? attachmentDataUrl : '',
      pinned,
      todoItems: todoItems.slice(0, 20).map((t) => ({
        id: clampStr(t.id, 64) || `td-${Date.now()}`,
        text: clampStr(t.text, 200),
        dueDate: t.dueDate ? clampStr(t.dueDate, 10) : '',
        done: Boolean(t.done),
      })),
    };

    setBusy(true);
    try {
      if (editingEntry) {
        await updateDoc(doc(db, 'headJournal', editingEntry.id), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        flashToast(lang === 'id' ? 'Catatan diperbarui' : 'ノートを更新しました');
      } else {
        await addDoc(collection(db, 'headJournal'), {
          ...payload,
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        flashToast(lang === 'id' ? 'Catatan baru disimpan' : '新しいノートを保存しました');
      }
      setFormOpen(false);
      resetForm();
    } catch (err) {
      handleFirestoreError(
        err,
        editingEntry ? OperationType.UPDATE : OperationType.CREATE,
        editingEntry ? `headJournal/${editingEntry.id}` : 'headJournal'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePin = async (entry: HeadJournalEntry) => {
    if (!isHead) return;
    try {
      await updateDoc(doc(db, 'headJournal', entry.id), {
        pinned: !entry.pinned,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `headJournal/${entry.id}`);
    }
  };

  const handleToggleTodoInline = async (entry: HeadJournalEntry, todoId: string) => {
    if (!isHead) return;
    const nextTodos = (entry.todoItems || []).map((t) =>
      t.id === todoId ? { ...t, done: !t.done } : t
    );
    try {
      await updateDoc(doc(db, 'headJournal', entry.id), {
        todoItems: nextTodos,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `headJournal/${entry.id}`);
    }
  };

  const executeDelete = async () => {
    if (!isHead || !deleteTarget) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'headJournal', deleteTarget.id));
      setDeleteTarget(null);
      flashToast(lang === 'id' ? 'Catatan dihapus' : 'ノートを削除しました');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `headJournal/${deleteTarget.id}`);
    } finally {
      setBusy(false);
    }
  };

  const renderJournalPdfSheet = (list: HeadJournalEntry[]) => (
    <div className="print-sheet bg-white text-black p-4 sm:p-6 space-y-5 text-xs">
      <div className="border-b-2 border-black pb-3 flex items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-black/70">
            元気アカデミー · GENKI ACADEMY — 校長専有記録（極秘）
          </div>
          <h2 className="text-lg font-bold text-black mt-0.5">
            {lang === 'id' ? 'Catatan Pribadi Kepala Sekolah' : '校長ノート（経営・指導記録）'}
          </h2>
          <div className="text-[11px] font-mono tabular-nums text-black/70 mt-0.5">
            {list.length} {lang === 'id' ? 'catatan' : '件'} · {today}
          </div>
        </div>
        <div className="text-[11px] font-mono text-right text-black/80">
          {profile.nickname || profile.displayName}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="border border-black/25 p-4 text-black/60">
          {lang === 'id' ? 'Tidak ada catatan untuk dicetak.' : '該当する記録がありません。'}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((entry) => {
            const cat = CATEGORIES.find((c) => c.id === entry.category);
            return (
              <div
                key={entry.id}
                className="border border-black/25 rounded-lg p-3 space-y-1.5 break-inside-avoid"
              >
                <div className="flex items-center justify-between gap-2 border-b border-black/15 pb-1">
                  <div className="font-bold text-sm text-black">
                    {entry.pinned ? '[PIN] ' : ''}
                    {entry.title}
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-black/70 shrink-0">
                    {entry.date} · {cat ? (lang === 'id' ? cat.idLabel : cat.ja) : entry.category}
                  </div>
                </div>
                {(entry.relatedClassId || entry.relatedTeacherName || entry.relatedStudentName) && (
                  <div className="text-[11px] text-black/70 flex flex-wrap gap-3">
                    {entry.relatedClassId && (
                      <span>
                        {lang === 'id' ? 'Kelas' : 'クラス'}: {classLabel(entry.relatedClassId, lang)}
                      </span>
                    )}
                    {entry.relatedTeacherName && (
                      <span>Sensei: {entry.relatedTeacherName}</span>
                    )}
                    {entry.relatedStudentName && (
                      <span>
                        {lang === 'id' ? 'Siswa' : '学生'}: {entry.relatedStudentName}
                      </span>
                    )}
                  </div>
                )}
                {entry.content && (
                  <p className="text-xs text-black whitespace-pre-line leading-relaxed">
                    {entry.content}
                  </p>
                )}
                {entry.todoItems && entry.todoItems.length > 0 && (
                  <div className="pt-1 space-y-0.5 text-[11px]">
                    {entry.todoItems.map((td) => (
                      <div key={td.id} className="font-mono">
                        [{td.done ? 'x' : ' '}] {td.text}
                        {td.dueDate ? ` (Due: ${td.dueDate})` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (!isHead) {
    return null;
  }

  return (
    <div className="space-y-6">
      <LiquidToast message={toast} />

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
            <BookLock className="w-3 h-3 text-[#6e6e73] dark:text-[#86868b]" />
            <span>
              {lang === 'id'
                ? 'Privat · Hanya Dapat Diakses Admin'
                : '管理者専用・完全非公開ジャーナル'}
            </span>
          </div>
          <h1 className="apple-compact-title">
            {tr(UI_TEXT.navHeadJournal, lang)}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'id'
              ? 'Catat keputusan sekolah, hasil rapat, insiden, evaluasi, ide, dan daftar tugas kepala sekolah.'
              : '決定事項・会議メモ・事案対応・アイデア・評価・To-Doを校長専用スペースに記録します。'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={filteredEntries.length === 0}
            onClick={() =>
              exportHeadJournalXlsx({ entries: filteredEntries, lang })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] disabled:opacity-40 whitespace-nowrap transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-[#6e6e73] dark:text-[#86868b]" />
            <span>{lang === 'id' ? 'Excel' : 'Excel出力'}</span>
          </button>

          <button
            type="button"
            disabled={filteredEntries.length === 0}
            onClick={() => {
              onRegisterPrintView(renderJournalPdfSheet(filteredEntries));
              setPdfOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] disabled:opacity-40 whitespace-nowrap transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-[#6e6e73] dark:text-[#86868b]" />
            <span>{lang === 'id' ? 'PDF' : 'PDF印刷'}</span>
          </button>

          <motion.button
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={openCreateForm}
            className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'id' ? 'Tulis Catatan Baru' : '新規ノート作成'}</span>
          </motion.button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="apple-tile p-4 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-[#86868b] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                lang === 'id'
                  ? 'Cari judul, isi catatan, nama siswa atau sensei...'
                  : 'タイトル・本文・学生名・講師名で検索...'
              }
              className="w-full glass-input pl-9 pr-3.5 py-2 text-[14px] rounded-[12px]"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="glass-input px-3 py-2 text-[12px] font-mono rounded-[12px]"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="text-[12px] text-[#0066cc] dark:text-[#2997ff] hover:underline"
              >
                {lang === 'id' ? 'Reset' : 'クリア'}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
              categoryFilter === 'all'
                ? 'bg-[#0071e3] dark:bg-[#2997ff] text-white'
                : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            {lang === 'id' ? 'Semua' : 'すべて'} ({entries.length})
          </button>
          {CATEGORIES.map((cat) => {
            const count = entries.filter((e) => e.category === cat.id).length;
            const active = categoryFilter === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                  active
                    ? 'bg-[#0071e3] dark:bg-[#2997ff] text-white'
                    : `${cat.badgeCls} hover:opacity-85`
                }`}
              >
                {lang === 'id' ? cat.idLabel : cat.ja} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Timeline List */}
      {filteredEntries.length === 0 ? (
        <div className="apple-tile p-8 border border-[#d2d2d7]/60 dark:border-[#424245]/60">
          <EmptyStateIllustration
            kind="clipboard"
            title={
              lang === 'id'
                ? 'Belum ada catatan kepala sekolah'
                : 'まだ校長ノートがありません'
            }
            subtitle={
              lang === 'id'
                ? 'Klik tombol "Tulis Catatan Baru" untuk mulai menyimpan keputusan, rapat, evaluasi, dan To-Do pribadi.'
                : '「新規ノート作成」から決定事項・会議記録・To-Doを追加できます。'
            }
            action={
              <button
                type="button"
                onClick={openCreateForm}
                className="apple-btn-primary px-4 py-2 text-[13px]"
              >
                {lang === 'id' ? 'Buat Catatan Pertama' : '最初のノートを作成'}
              </button>
            }
          />
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredEntries.map((entry) => {
            const catMeta = CATEGORIES.find((c) => c.id === entry.category);
            const cTheme = entry.relatedClassId ? CLASS_THEMES[entry.relatedClassId] : null;
            const totalTodos = (entry.todoItems || []).length;
            const doneTodos = (entry.todoItems || []).filter((t) => t.done).length;

            return (
              <motion.div
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`apple-tile apple-virtual-item p-5 space-y-3 border ${
                  entry.pinned
                    ? 'border-[#0071e3]/45 dark:border-[#2997ff]/45'
                    : 'border-[#d2d2d7]/60 dark:border-[#424245]/60'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.pinned && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#0071e3]/10 text-[#0066cc] dark:text-[#2997ff]">
                          <Pin className="w-2.5 h-2.5" />
                          <span>{lang === 'id' ? 'Disematkan' : 'ピン留め'}</span>
                        </span>
                      )}
                      {catMeta && (
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${catMeta.badgeCls}`}
                        >
                          {lang === 'id' ? catMeta.idLabel : catMeta.ja}
                        </span>
                      )}
                      <span className="font-mono tabular-nums text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        {entry.date}
                      </span>
                    </div>
                    <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                      {entry.title}
                    </h2>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTogglePin(entry)}
                      className={`p-2 rounded-full border transition-colors ${
                        entry.pinned
                          ? 'bg-[#0071e3]/10 border-[#0071e3]/35 text-[#0066cc] dark:text-[#2997ff]'
                          : 'border-[#d2d2d7]/70 dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                      }`}
                      title={lang === 'id' ? 'Pin / Unpin' : 'ピン留め切替'}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditForm(entry)}
                      className="p-2 rounded-full border border-[#d2d2d7]/70 dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b] hover:text-[#0066cc] dark:hover:text-[#2997ff] transition-colors"
                      title={tr(UI_TEXT.edit, lang)}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(entry)}
                      className="p-2 rounded-full border border-[#d2d2d7]/70 dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] transition-colors"
                      title={tr(UI_TEXT.delete, lang)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Linked Tags */}
                {(entry.relatedClassId ||
                  entry.relatedTeacherName ||
                  entry.relatedStudentName) && (
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    {entry.relatedClassId && cTheme && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] font-medium">
                        <span className={`w-1.5 h-1.5 rounded-full ${cTheme.dotColor}`} />
                        <span>{classLabel(entry.relatedClassId, lang)}</span>
                      </span>
                    )}
                    {entry.relatedTeacherName && (
                      <span className="px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#f5f5f7]/80 font-medium">
                        Sensei: {entry.relatedTeacherName}
                      </span>
                    )}
                    {entry.relatedStudentName && (
                      <span className="px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#f5f5f7]/80 font-medium">
                        {lang === 'id' ? 'Siswa:' : '学生:'} {entry.relatedStudentName}
                      </span>
                    )}
                  </div>
                )}

                {entry.content && (
                  <p className="text-[14px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-line leading-relaxed">
                    {entry.content}
                  </p>
                )}

                {/* Inline Checklist */}
                {totalTodos > 0 && (
                  <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245] rounded-[14px] p-3 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[#6e6e73] dark:text-[#86868b]">
                      <span>To-Do Checklist</span>
                      <span className="font-mono tabular-nums">
                        {doneTodos}/{totalTodos}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(entry.todoItems || []).map((td) => (
                        <button
                          key={td.id}
                          type="button"
                          onClick={() => handleToggleTodoInline(entry, td.id)}
                          className="w-full flex items-center justify-between gap-3 text-left text-[12px] px-2.5 py-1.5 rounded-[10px] hover:bg-white dark:hover:bg-[#2c2c2e] transition-colors"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {td.done ? (
                              <CheckSquare className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff] shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-[#86868b] shrink-0" />
                            )}
                            <span
                              className={
                                td.done
                                  ? 'line-through text-[#86868b]'
                                  : 'text-[#1d1d1f] dark:text-[#f5f5f7] font-medium'
                              }
                            >
                              {td.text}
                            </span>
                          </span>
                          {td.dueDate && (
                            <span className="font-mono tabular-nums text-[11px] text-[#6e6e73] dark:text-[#86868b] shrink-0">
                              {td.dueDate}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Attachment */}
                {entry.attachmentDataUrl && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewAttachment({
                          name: entry.attachmentName || 'Lampiran',
                          dataUrl: entry.attachmentDataUrl,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] rounded-full text-[#0066cc] dark:text-[#2997ff] transition-colors"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>{entry.attachmentName || 'Attachment'}</span>
                    </button>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Journal Entry Modal */}
      <AnimatePresence>
        {formOpen && (
          <AppleModalSheet
            open={true}
            onClose={() => setFormOpen(false)}
            maxWidthClass="max-w-2xl"
          >
            <form
              onSubmit={handleSaveEntry}
              className="flex flex-col flex-1 min-h-0 overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between shrink-0">
                <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {editingEntry
                    ? lang === 'id'
                      ? 'Edit Catatan Kepala Sekolah'
                      : '校長ノートを編集'
                    : lang === 'id'
                    ? 'Tulis Catatan Kepala Sekolah'
                    : '新規校長ノート作成'}
                </h3>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  aria-label={tr(UI_TEXT.close, lang)}
                  className="p-1.5 rounded-full text-[#6e6e73] dark:text-[#86868b] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 flex-1 overflow-y-auto space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-4">
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'id' ? 'Tanggal' : '日付'}
                    </label>
                    <input
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full glass-input px-3 py-2 text-[13px] font-mono tabular-nums rounded-[12px]"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'id' ? 'Kategori' : 'カテゴリー'}
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as HeadJournalCategory)}
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {lang === 'id' ? c.idLabel : c.ja}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-3 flex items-end pb-2">
                    <label className="inline-flex items-center gap-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pinned}
                        onChange={(e) => setPinned(e.target.checked)}
                        className="rounded border-[#d2d2d7] dark:border-[#424245] text-[#0071e3] focus:ring-[#0071e3]"
                      />
                      <Pin className="w-3.5 h-3.5 text-[#b45309] dark:text-[#f59e0b]" />
                      <span>{lang === 'id' ? 'Sematkan' : 'ピン留め'}</span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Judul Catatan *' : 'タイトル *'}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={150}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={
                      lang === 'id'
                        ? 'Contoh: Evaluasi kurikulum N4 & penyesuaian jadwal'
                        : '例: N4カリキュラム見直し・講師面談メモ'
                    }
                    className="w-full glass-input px-3.5 py-2 text-[14px] rounded-[12px]"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Isi Catatan' : '内容・詳細'}
                  </label>
                  <textarea
                    rows={4}
                    maxLength={4000}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                      lang === 'id'
                        ? 'Tuliskan detail keputusan, ringkasan rapat, atau catatan evaluasi...'
                        : '決定事項、会議内容、指導方針などを自由にご記入ください...'
                    }
                    className="w-full glass-input px-3.5 py-2 text-[14px] rounded-[12px]"
                  />
                </div>

                {/* Optional Relations */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'id' ? 'Terkait Kelas (Opsional)' : '関連クラス（任意）'}
                    </label>
                    <select
                      value={relatedClassId}
                      onChange={(e) => setRelatedClassId(e.target.value as ClassId | '')}
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
                    >
                      <option value="">—</option>
                      {CLASSES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {classLabel(c.id, lang)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'id' ? 'Terkait Sensei (Opsional)' : '関連講師（任意）'}
                    </label>
                    <select
                      value={relatedTeacherUid}
                      onChange={(e) => setRelatedTeacherUid(e.target.value)}
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
                    >
                      <option value="">—</option>
                      {activeTeachers.map((t) => (
                        <option key={t.uid} value={t.uid}>
                          {t.nickname || t.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'id' ? 'Terkait Siswa (Opsional)' : '関連学生（任意）'}
                    </label>
                    <select
                      value={relatedStudentId}
                      onChange={(e) => setRelatedStudentId(e.target.value)}
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
                    >
                      <option value="">—</option>
                      {sortedStudents.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({classLabel(s.classId, lang)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* To-Do Checklist Builder */}
                <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-3.5 space-y-2.5">
                  <div className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    To-Do Checklist (<span className="tabular-nums">{todoItems.length}/20</span>)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      maxLength={200}
                      value={todoDraftText}
                      onChange={(e) => setTodoDraftText(e.target.value)}
                      placeholder={
                        lang === 'id' ? 'Tambah item tugas...' : 'タスク内容を追加...'
                      }
                      className="flex-1 min-w-[180px] glass-input px-3 py-1.5 text-[13px] rounded-[10px]"
                    />
                    <input
                      type="date"
                      value={todoDraftDue}
                      onChange={(e) => setTodoDraftDue(e.target.value)}
                      className="glass-input px-3 py-1.5 text-[12px] font-mono tabular-nums rounded-[10px]"
                    />
                    <button
                      type="button"
                      onClick={handleAddTodoItem}
                      className="px-3.5 py-1.5 text-[12px] font-medium bg-[#1d1d1f] dark:bg-[#f5f5f7] text-white dark:text-[#1d1d1f] rounded-full hover:opacity-90 transition-opacity"
                    >
                      + {lang === 'id' ? 'Tambah' : '追加'}
                    </button>
                  </div>

                  {todoItems.length > 0 && (
                    <div className="space-y-1">
                      {todoItems.map((td) => (
                        <div
                          key={td.id}
                          className="flex items-center justify-between gap-2 text-[13px] bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/50 dark:border-[#424245] rounded-[10px] px-3 py-1.5"
                        >
                          <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={td.done}
                              onChange={() =>
                                setTodoItems((prev) =>
                                  prev.map((x) =>
                                    x.id === td.id ? { ...x, done: !x.done } : x
                                  )
                                )
                              }
                              className="rounded border-[#d2d2d7] dark:border-[#424245] text-[#0071e3]"
                            />
                            <span
                              className={
                                td.done
                                  ? 'line-through text-[#6e6e73] dark:text-[#86868b]'
                                  : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                              }
                            >
                              {td.text}
                            </span>
                            {td.dueDate && (
                              <span className="font-mono tabular-nums text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                                ({td.dueDate})
                              </span>
                            )}
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setTodoItems((prev) => prev.filter((x) => x.id !== td.id))
                            }
                            aria-label="Remove task"
                            className="text-[#6e6e73] dark:text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] p-0.5 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Attachment Upload */}
                <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[16px] p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[12px]">
                    <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {lang === 'id'
                        ? 'Lampiran File / Gambar (Maks ~170 KB)'
                        : '添付ファイル・画像（約170KBまで）'}
                    </div>
                    <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                      {attachmentName || (lang === 'id' ? 'Belum ada file dipilih' : '未選択')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {attachmentDataUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setAttachmentName('');
                          setAttachmentDataUrl('');
                        }}
                        className="px-3 py-1.5 text-[12px] font-medium text-[#dc2626] dark:text-[#ff453a] bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                      >
                        {lang === 'id' ? 'Hapus' : '削除'}
                      </button>
                    )}
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] rounded-full cursor-pointer text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#ececf0] dark:hover:bg-[#2c2c2e] transition-colors">
                      <Upload className="w-3.5 h-3.5 text-[#0066cc] dark:text-[#2997ff]" />
                      <span>{lang === 'id' ? 'Pilih File' : 'ファイル選択'}</span>
                      <input
                        type="file"
                        accept="image/*,.pdf,.txt,.csv,.doc,.docx"
                        onChange={handleAttachmentFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-[#d2d2d7]/60 dark:border-[#424245] bg-white/90 dark:bg-[#1d1d1f]/90 apple-blur-overlay flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="px-4 py-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors"
                >
                  {tr(UI_TEXT.cancel, lang)}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="apple-btn-primary px-5 py-2 text-[13px] disabled:opacity-50"
                >
                  {tr(UI_TEXT.save, lang)}
                </button>
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Attachment Preview Modal */}
      <AnimatePresence>
        {previewAttachment && (
          <AppleModalSheet
            open={true}
            onClose={() => setPreviewAttachment(null)}
            maxWidthClass="max-w-2xl"
          >
            <div className="px-5 py-3.5 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between gap-3 shrink-0">
              <div className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                {previewAttachment.name}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={previewAttachment.dataUrl}
                  download={previewAttachment.name}
                  className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{lang === 'id' ? 'Unduh' : '保存'}</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(null)}
                  aria-label={tr(UI_TEXT.close, lang)}
                  className="p-1.5 rounded-full text-[#6e6e73] dark:text-[#86868b] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-5 overflow-auto flex items-center justify-center bg-[#f5f5f7] dark:bg-[#161617]">
              {previewAttachment.dataUrl.startsWith('data:image/') ? (
                <img
                  src={previewAttachment.dataUrl}
                  alt={previewAttachment.name}
                  className="max-w-full max-h-[68vh] rounded-[12px] object-contain"
                />
              ) : (
                <div className="text-center space-y-3 py-8">
                  <Paperclip className="w-10 h-10 mx-auto text-[#6e6e73] dark:text-[#86868b]" />
                  <div className="text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {previewAttachment.name}
                  </div>
                  <a
                    href={previewAttachment.dataUrl}
                    download={previewAttachment.name}
                    className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'Unduh File Lampiran' : 'ファイルをダウンロード'}</span>
                  </a>
                </div>
              )}
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* PDF Print Preview Modal */}
      <AnimatePresence>
        {pdfOpen && (
          <AppleModalSheet
            open={true}
            onClose={() => {
              setPdfOpen(false);
              onRegisterPrintView(null);
            }}
            maxWidthClass="max-w-4xl"
          >
            <div className="px-5 py-3.5 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between gap-3 shrink-0">
              <div className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id' ? 'Pratinjau PDF Catatan Kepala Sekolah' : '校長ノート PDF プレビュー'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[12px]"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{lang === 'id' ? 'Cetak / Simpan PDF' : '印刷 / PDF保存'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPdfOpen(false);
                    onRegisterPrintView(null);
                  }}
                  aria-label={tr(UI_TEXT.close, lang)}
                  className="p-1.5 rounded-full text-[#6e6e73] dark:text-[#86868b] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-6 overflow-y-auto bg-[#f5f5f7] dark:bg-[#161617]">
              <div className="bg-white border border-[#d2d2d7] rounded-[12px] overflow-hidden">
                {renderJournalPdfSheet(filteredEntries)}
              </div>
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        busy={busy}
        title={lang === 'id' ? 'Hapus Catatan Kepala Sekolah?' : 'このノートを削除しますか？'}
        message={
          deleteTarget
            ? lang === 'id'
              ? `Catatan "${deleteTarget.title}" (${deleteTarget.date}) akan dihapus permanen.`
              : `「${deleteTarget.title}」（${deleteTarget.date}）を完全に削除します。`
            : ''
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      />
    </div>
  );
}
