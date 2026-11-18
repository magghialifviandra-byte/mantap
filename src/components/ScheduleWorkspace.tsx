import React, { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  FileSpreadsheet,
  GripVertical,
  Lock,
  Plus,
  Printer,
  Save,
  Trash2,
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { LanguageMode, ScheduleDoc, ScheduleRow, StaffInvite, UserProfile } from '../types';
import { logActivity } from '../utils/activityLog';
import { CLASS_THEMES, detectClassIdFromText } from '../utils/classTheme';
import { downloadBlankScheduleCsv, downloadBlankScheduleXlsx } from '../utils/dateUtils';
import { clampArray, clampStr } from '../utils/payloadGuards';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import { AppleContextMenuTrigger, APPLE_EASE, ContextMenuItem } from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  scheduleDoc: ScheduleDoc | null;
  staffUsers: UserProfile[];
  staffInvites: StaffInvite[];
  onRegisterPrintView: (node: React.ReactNode | null) => void;
}

interface SenseiOption {
  value: string; // "uid:<uid>" | "invite:<name>" | "legacy:<name>"
  uid: string;
  label: string;
  sublabel?: string;
}

function makeEmptyRow(index: number): ScheduleRow {
  return {
    id: `row_${Date.now()}_${index}`,
    day: '',
    timeSlot: '',
    className: '',
    teacher: '',
    teacherUid: '',
    subject: '',
    room: '',
    note: '',
  };
}

function parseTimeRangeMinutes(slot: string): [number, number] | null {
  const matches = slot.match(/(\d{1,2})[:.](\d{2})/g);
  if (!matches || matches.length === 0) return null;
  const toMins = (m: string) => {
    const [h, min] = m.split(/[:.]/).map(Number);
    return h * 60 + min;
  };
  const start = toMins(matches[0]);
  const end = matches.length >= 2 ? toMins(matches[1]) : start + 45;
  return [start, Math.max(start + 1, end)];
}

function timesOverlap(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ra = parseTimeRangeMinutes(na);
  const rb = parseTimeRangeMinutes(nb);
  if (ra && rb) {
    return ra[0] < rb[1] && rb[0] < ra[1];
  }
  return false;
}

function normalizeDayKey(day: string): string {
  const d = day.trim().toLowerCase();
  if (!d) return '';
  if (d.includes('月') || d.includes('senin') || d.includes('mon')) return 'mon';
  if (d.includes('火') || d.includes('selasa') || d.includes('tue')) return 'tue';
  if (d.includes('水') || d.includes('rabu') || d.includes('wed')) return 'wed';
  if (d.includes('木') || d.includes('kamis') || d.includes('thu')) return 'thu';
  if (d.includes('金') || d.includes('jumat') || d.includes('fri')) return 'fri';
  if (d.includes('土') || d.includes('sabtu') || d.includes('sat')) return 'sat';
  if (d.includes('日') || d.includes('minggu') || d.includes('sun')) return 'sun';
  return d;
}

export function ScheduleWorkspace({
  lang,
  profile,
  scheduleDoc,
  staffUsers,
  staffInvites,
  onRegisterPrintView,
}: Props) {
  const isHead = profile.role === 'head';

  const [title, setTitle] = useState('授業スケジュール表 / Jadwal Pelajaran Sekolah');
  const [periodLabel, setPeriodLabel] = useState('');
  const [rows, setRows] = useState<ScheduleRow[]>(() =>
    Array.from({ length: 8 }, (_, i) => makeEmptyRow(i))
  );
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // Drag-and-drop state
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Confirm dialogs before row deletion or clearing
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'row'; index: number; label: string }
    | { kind: 'clear_all' }
    | null
  >(null);

  useEffect(() => {
    if (scheduleDoc) {
      setTitle(scheduleDoc.title || '授業スケジュール表 / Jadwal Pelajaran Sekolah');
      setPeriodLabel(scheduleDoc.periodLabel || '');
      setRows(
        scheduleDoc.rows && scheduleDoc.rows.length > 0
          ? scheduleDoc.rows.map((r) => ({ ...r, teacherUid: r.teacherUid || '' }))
          : Array.from({ length: 8 }, (_, i) => makeEmptyRow(i))
      );
    }
  }, [scheduleDoc]);

  // Active staff + pending invited teachers for Head's Sensei dropdown selector
  const senseiOptions = useMemo<SenseiOption[]>(() => {
    const activeStaff = staffUsers
      .filter((u) => u.status === 'active')
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'teacher' ? -1 : 1;
        return (a.nickname || a.displayName).localeCompare(b.nickname || b.displayName);
      });

    const opts: SenseiOption[] = activeStaff.map((u) => {
      const shown = u.nickname || u.displayName;
      const roleNote = u.role === 'head' ? (lang === 'id' ? 'Admin' : '管理者') : 'Sensei';
      return {
        value: `uid:${u.uid}`,
        uid: u.uid,
        label: shown,
        sublabel:
          u.fullName && u.fullName !== shown ? `${u.fullName} · ${roleNote}` : roleNote,
      };
    });

    const knownNames = new Set(
      activeStaff.flatMap((u) =>
        [u.displayName, u.nickname, u.fullName]
          .filter(Boolean)
          .map((n) => n!.trim().toLowerCase())
      )
    );

    staffInvites.forEach((inv) => {
      if (!knownNames.has(inv.displayName.trim().toLowerCase())) {
        opts.push({
          value: `invite:${inv.displayName}`,
          uid: '',
          label: inv.displayName,
          sublabel: lang === 'id' ? 'Diundang (belum login)' : '招待中・未ログイン',
        });
      }
    });

    return opts;
  }, [staffUsers, staffInvites, lang]);

  // Double-booking detection (same Sensei, same Day, overlapping Time)
  const { conflictedRowIds, conflictSummaries } = useMemo(() => {
    const ids = new Set<string>();
    const summaries: string[] = [];
    const seenPairs = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const a = rows[i];
      const senseiA = a.teacherUid || a.teacher.trim().toLowerCase();
      const dayA = normalizeDayKey(a.day);
      if (!senseiA || !dayA || !a.timeSlot.trim()) continue;

      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j];
        const senseiB = b.teacherUid || b.teacher.trim().toLowerCase();
        const dayB = normalizeDayKey(b.day);
        if (!senseiB || !dayB || !b.timeSlot.trim()) continue;

        if (senseiA === senseiB && dayA === dayB && timesOverlap(a.timeSlot, b.timeSlot)) {
          ids.add(a.id);
          ids.add(b.id);
          const key = `${senseiA}_${dayA}_${a.timeSlot}_${b.timeSlot}`;
          if (!seenPairs.has(key)) {
            seenPairs.add(key);
            summaries.push(
              `${a.teacher || 'Sensei'} (${a.day} ${a.timeSlot}${
                b.timeSlot !== a.timeSlot ? ` & ${b.timeSlot}` : ''
              })`
            );
          }
        }
      }
    }

    return { conflictedRowIds: ids, conflictSummaries: summaries };
  }, [rows]);

  // Sensei read-only view: strictly filter to entries assigned to this logged-in Sensei
  const myScheduleRows = useMemo(() => {
    const norm = (s: string | undefined) => (s || '').trim().toLowerCase();
    const myNames = new Set(
      [profile.displayName, profile.nickname, profile.fullName].map(norm).filter(Boolean)
    );

    return rows.filter((row) => {
      if (row.teacherUid) {
        return row.teacherUid === profile.uid;
      }
      const rowTeacher = norm(row.teacher);
      return Boolean(rowTeacher) && myNames.has(rowTeacher);
    });
  }, [rows, profile.uid, profile.displayName, profile.nickname, profile.fullName]);

  const updateCell = (index: number, field: keyof ScheduleRow, value: string) => {
    setRows((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, [field]: value } : row))
    );
  };

  const getRowSenseiSelectValue = (row: ScheduleRow): string => {
    if (row.teacherUid) {
      const byUid = senseiOptions.find((o) => o.uid === row.teacherUid);
      if (byUid) return byUid.value;
      return `uid:${row.teacherUid}`;
    }
    if (row.teacher) {
      const norm = row.teacher.trim().toLowerCase();
      const byName = senseiOptions.find((o) => o.label.trim().toLowerCase() === norm);
      if (byName) return byName.value;
      return `legacy:${row.teacher}`;
    }
    return '';
  };

  const handleAssignSensei = (index: number, selectedValue: string) => {
    if (!isHead) return;
    setRows((prev) =>
      prev.map((row, idx) => {
        if (idx !== index) return row;
        if (!selectedValue) {
          return { ...row, teacherUid: '', teacher: '' };
        }
        const matched = senseiOptions.find((o) => o.value === selectedValue);
        if (matched) {
          return { ...row, teacherUid: matched.uid, teacher: matched.label };
        }
        if (selectedValue.startsWith('legacy:')) {
          return { ...row, teacherUid: '', teacher: selectedValue.slice(7) };
        }
        if (selectedValue.startsWith('uid:')) {
          return { ...row, teacherUid: selectedValue.slice(4) };
        }
        return row;
      })
    );
  };

  const addRow = () => {
    if (!isHead || rows.length >= 80) return;
    setRows((prev) => [...prev, makeEmptyRow(prev.length)]);
  };

  const moveRow = (index: number, dir: -1 | 1) => {
    if (!isHead) return;
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[target];
      next[target] = temp;
      return next;
    });
  };

  const handleReorderDrop = (fromIdx: number, toIdx: number) => {
    if (!isHead || fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    setRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const executeConfirmedDelete = () => {
    if (!confirmDelete || !isHead) return;
    if (confirmDelete.kind === 'row') {
      setRows((prev) => prev.filter((_, idx) => idx !== confirmDelete.index));
    } else {
      setRows(Array.from({ length: 8 }, (_, i) => makeEmptyRow(i)));
    }
    setConfirmDelete(null);
  };

  const handleSave = async () => {
    if (!isHead) return;
    setSaving(true);
    const cleanRows = clampArray(
      rows.map((r, i) => ({
        id: clampStr(r.id || `row_${i}`, 60) || `row_${i}`,
        day: clampStr(r.day, 40),
        timeSlot: clampStr(r.timeSlot, 40),
        className: clampStr(r.className, 60),
        teacher: clampStr(r.teacher, 80),
        teacherUid: clampStr(r.teacherUid || '', 128),
        subject: clampStr(r.subject, 120),
        room: clampStr(r.room, 40),
        note: clampStr(r.note, 120),
      })),
      80
    );

    const payload = {
      title: clampStr(title, 150) || '授業スケジュール表 / Jadwal Pelajaran',
      periodLabel: clampStr(periodLabel, 100),
      rows: cleanRows,
      updatedBy: profile.uid,
      createdAt: scheduleDoc?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(doc(db, 'schedules', 'main'), payload);
      const nonEmptyCount = cleanRows.filter(
        (r) => r.day || r.timeSlot || r.className || r.teacher || r.subject
      ).length;
      await logActivity({
        actor: profile,
        actionType: 'schedule_update',
        targetType: 'schedule',
        targetLabel: payload.title,
        detail: `${nonEmptyCount} rows saved${
          conflictSummaries.length > 0 ? ` (${conflictSummaries.length} overlap warning)` : ''
        }`,
      });
      setToast(
        lang === 'id'
          ? 'Jadwal disimpan & otomatis muncul di akun Sensei terkait'
          : 'スケジュールを保存し、各講師の「私のスケジュール」に反映しました'
      );
      setTimeout(() => setToast(''), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'schedules/main');
    } finally {
      setSaving(false);
    }
  };

  const handlePrint = (rowsToPrint: ScheduleRow[], customHeading?: string) => {
    const printableRows =
      rowsToPrint.length > 0 ? rowsToPrint : Array.from({ length: 12 }, (_, i) => makeEmptyRow(i));
    const node = (
      <div className="print-sheet bg-white text-black p-4 space-y-4">
        <div className="border-b-2 border-black pb-2.5 flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-black">
              元気アカデミー / GENKI ACADEMY
            </div>
            <h1 className="text-lg font-bold text-black">
              {customHeading || title || '授業スケジュール表 / Jadwal Pelajaran'}
            </h1>
            <p className="text-xs text-black mt-0.5">
              {periodLabel
                ? `期間 / Periode: ${periodLabel}`
                : '期間 / Periode: ________________________'}
            </p>
          </div>
          <div className="text-xs font-mono text-black">
            {isHead ? '北海道 · 埼玉 · 奈良 · 介護' : profile.nickname || profile.displayName}
          </div>
        </div>
        <table className="w-full text-xs text-left border-collapse border border-black">
          <thead>
            <tr className="bg-neutral-100 border-b border-black">
              <th className="p-2 border-r border-black w-24">曜日 / Hari</th>
              <th className="p-2 border-r border-black w-28">時間 / Jam</th>
              <th className="p-2 border-r border-black w-28">クラス / Kelas</th>
              <th className="p-2 border-r border-black w-28">講師 / Sensei</th>
              <th className="p-2 border-r border-black">科目・教材 / Materi</th>
              <th className="p-2 border-r border-black w-20">教室 / Ruang</th>
              <th className="p-2 w-28">備考 / Catatan</th>
            </tr>
          </thead>
          <tbody>
            {printableRows.map((r) => (
              <tr key={r.id} className="border-b border-black/40">
                <td className="p-2.5 border-r border-black">{r.day || '\u00A0'}</td>
                <td className="p-2.5 border-r border-black font-mono">{r.timeSlot || '\u00A0'}</td>
                <td className="p-2.5 border-r border-black">{r.className || '\u00A0'}</td>
                <td className="p-2.5 border-r border-black">{r.teacher || '\u00A0'}</td>
                <td className="p-2.5 border-r border-black">{r.subject || '\u00A0'}</td>
                <td className="p-2.5 border-r border-black">{r.room || '\u00A0'}</td>
                <td className="p-2.5">{r.note || '\u00A0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    onRegisterPrintView(node);
    setTimeout(() => window.print(), 100);
  };

  const handleExportCurrentXlsx = (sourceRows: ScheduleRow[], fileName = 'school_schedule.xlsx') => {
    const wb = XLSX.utils.book_new();
    const header = [
      '曜日 / Hari',
      '時間割 / Jam',
      'クラス / Kelas',
      '担当講師 / Sensei',
      '科目・教材 / Materi',
      '教室 / Ruangan',
      '備考 / Catatan',
    ];
    const body = sourceRows.map((r) => [
      r.day,
      r.timeSlot,
      r.className,
      r.teacher,
      r.subject,
      r.room,
      r.note,
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = [
      { wch: 16 },
      { wch: 18 },
      { wch: 20 },
      { wch: 22 },
      { wch: 28 },
      { wch: 16 },
      { wch: 28 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, fileName);
  };

  // ====================================================================
  // SENSEI READ-ONLY VIEW: "私のスケジュール" (Strictly own assigned rows)
  // ====================================================================
  if (!isHead) {
    const shownName = profile.nickname || profile.displayName;
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="apple-compact-title">私のスケジュール</h1>
            <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1 flex flex-wrap items-center gap-2">
              <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{shownName}</span>
              <span aria-hidden="true">·</span>
              <span>
                {lang === 'id'
                  ? 'Jadwal Mengajar Saya · Hanya Baca (diatur oleh Kepala Sekolah)'
                  : '担当授業一覧（閲覧専用・管理者のみ編集可）'}
              </span>
            </p>
          </div>

          {myScheduleRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleExportCurrentXlsx(myScheduleRows, `my_schedule_${shownName}.xlsx`)
                }
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#15803d] dark:text-[#30d158]" />
                <span>{lang === 'id' ? 'Ekspor Excel' : 'Excel出力'}</span>
              </button>
              <button
                type="button"
                onClick={() => handlePrint(myScheduleRows, `私のスケジュール — ${shownName}`)}
                className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{lang === 'id' ? 'Cetak / PDF' : 'A4印刷 / PDF保存'}</span>
              </button>
            </div>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: APPLE_EASE }}
          className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#d2d2d7]/60 dark:border-[#424245] text-[12px] text-[#6e6e73] dark:text-[#86868b]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px]">
                {title}
              </span>
              {periodLabel && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/50 dark:border-[#424245]">
                    {periodLabel}
                  </span>
                </>
              )}
            </div>
            <div className="inline-flex items-center gap-1.5 text-[#6e6e73] dark:text-[#86868b]">
              <Lock className="w-3.5 h-3.5" />
              <span>
                {lang === 'id' ? 'Hanya Baca · Total jadwal Anda: ' : '閲覧専用 · 担当件数: '}
                <span className="font-mono tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {myScheduleRows.length}
                </span>
              </span>
            </div>
          </div>

          {myScheduleRows.length === 0 ? (
            <EmptyStateIllustration
              kind="calendar"
              title={
                lang === 'id'
                  ? 'Belum ada jadwal yang ditugaskan kepada Anda.'
                  : '現在、あなたに割り当てられたスケジュールはありません。'
              }
              subtitle={
                lang === 'id'
                  ? 'Jadwal akan muncul otomatis di sini setelah Admin memilih nama Anda pada tabel jadwal.'
                  : '管理者がスケジュール表であなたを担当講師に割り当てると、ここに自動表示されます。'
              }
            />
          ) : (
            <div className="apple-table-wrap apple-scroll-x">
              <table className="w-full text-[14px] text-left border-collapse min-w-[680px]">
                <thead className="bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                  <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    <th className="py-2.5 px-3 font-medium w-28 sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[5]">
                      {lang === 'id' ? 'Hari' : '曜日'}
                    </th>
                    <th className="py-2.5 px-3 font-medium w-32">
                      {lang === 'id' ? 'Jam' : '時間'}
                    </th>
                    <th className="py-2.5 px-3 font-medium w-40">
                      {lang === 'id' ? 'Kelas' : 'クラス'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">
                      {lang === 'id' ? 'Materi' : '科目・教材'}
                    </th>
                    <th className="py-2.5 px-3 font-medium w-28">
                      {lang === 'id' ? 'Ruang' : '教室'}
                    </th>
                    <th className="py-2.5 px-3 font-medium w-40">
                      {lang === 'id' ? 'Catatan' : '備考'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {myScheduleRows.map((row) => {
                    const clsId = detectClassIdFromText(row.className);
                    const clsTheme = clsId ? CLASS_THEMES[clsId] : null;
                    return (
                      <tr key={row.id} className="apple-table-row">
                        <td className="py-3 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                          {row.day || '—'}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">
                          {row.timeSlot || '—'}
                        </td>
                        <td className="py-3 px-3">
                          {row.className ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {clsTheme && (
                                <span className={`w-1.5 h-1.5 rounded-full ${clsTheme.dotColor}`} />
                              )}
                              <span>{row.className}</span>
                            </span>
                          ) : (
                            <span className="text-[#6e6e73] dark:text-[#86868b]">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {row.subject || '—'}
                        </td>
                        <td className="py-3 px-3 text-[#6e6e73] dark:text-[#86868b]">
                          {row.room || '—'}
                        </td>
                        <td className="py-3 px-3 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {row.note || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // ====================================================================
  // HEAD (ADMIN) FULL EDITABLE SCHEDULE VIEW
  // ====================================================================
  return (
    <div className="space-y-6">
      <LiquidToast message={toast} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {lang === 'id' ? 'Jadwal Sekolah (Edit & Cetak)' : 'スケジュール管理・印刷'}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'id'
              ? 'Seret baris untuk mengatur urutan, pilih Sensei per baris, lalu simpan. Peringatan muncul jika ada Sensei bentrok jadwal.'
              : 'ドラッグ＆ドロップで並べ替え、各行の講師を選択して保存すると「私のスケジュール」に自動反映されます。'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handlePrint(rows)}
            className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[13px] whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>{lang === 'id' ? 'PDF / Cetak (A4)' : 'A4印刷 / PDF保存'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleExportCurrentXlsx(rows)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-[#15803d] dark:text-[#30d158]" />
            <span>{lang === 'id' ? 'Ekspor Excel' : 'Excel書き出し'}</span>
          </button>

          <button
            type="button"
            onClick={downloadBlankScheduleXlsx}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{lang === 'id' ? 'Template Kosong' : '白紙Excel'}</span>
          </button>

          <button
            type="button"
            onClick={downloadBlankScheduleCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-full hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap shrink-0"
          >
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Double-booking warning banner */}
      {conflictSummaries.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: APPLE_EASE }}
          className="rounded-[16px] p-4 border border-[#f59e0b]/40 bg-[#f59e0b]/10 text-[#92400e] dark:text-[#fcd34d] flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-[#d97706] dark:text-[#fbbf24] shrink-0 mt-0.5" />
          <div className="space-y-1 text-[13px]">
            <div className="font-semibold">
              {lang === 'id'
                ? 'Peringatan Jadwal Bentrok (Double-Booked Sensei):'
                : '警告：同じ曜日・時間帯に重複して割り当てられている講師がいます'}
            </div>
            <div className="opacity-90">
              {conflictSummaries.join(' · ')}
            </div>
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: APPLE_EASE }}
        className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5"
      >
        {/* Title & Period Header */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
              {lang === 'id' ? 'Judul Jadwal' : 'スケジュール表タイトル'}
            </label>
            <input
              type="text"
              value={title}
              maxLength={150}
              onChange={(e) => setTitle(e.target.value)}
              className="glass-input w-full px-3.5 py-2 text-[14px] rounded-[12px]"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
              {lang === 'id' ? 'Periode / Minggu' : '期間・週（例: 2026年11月第3週）'}
            </label>
            <input
              type="text"
              value={periodLabel}
              maxLength={100}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder={lang === 'id' ? 'Contoh: 18–22 Nov 2026' : '例: 2026年11月18日〜22日'}
              className="glass-input w-full px-3.5 py-2 text-[14px] rounded-[12px]"
            />
          </div>
        </div>

        {/* Editable Spreadsheet Grid with Drag-and-Drop + Sensei Selector */}
        <div className="apple-table-wrap apple-scroll-x max-h-[620px] overflow-y-auto">
          <table className="w-full text-[14px] text-left border-collapse min-w-[940px]">
            <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
              <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                <th className="py-2.5 px-2 w-9 text-center" aria-label="Drag handle" />
                <th className="py-2.5 px-2.5 font-medium w-28">
                  {lang === 'id' ? 'Hari' : '曜日'}
                </th>
                <th className="py-2.5 px-2.5 font-medium w-32">
                  {lang === 'id' ? 'Jam' : '時間'}
                </th>
                <th className="py-2.5 px-2.5 font-medium w-36">
                  {lang === 'id' ? 'Kelas' : 'クラス'}
                </th>
                <th className="py-2.5 px-2.5 font-medium w-48">
                  {lang === 'id' ? 'Sensei' : '講師'}
                </th>
                <th className="py-2.5 px-2.5 font-medium">
                  {lang === 'id' ? 'Materi' : '科目・教材'}
                </th>
                <th className="py-2.5 px-2.5 font-medium w-24">
                  {lang === 'id' ? 'Ruang' : '教室'}
                </th>
                <th className="py-2.5 px-2.5 font-medium w-36">
                  {lang === 'id' ? 'Catatan' : '備考'}
                </th>
                <th className="py-2.5 px-2 font-medium w-24 text-right">
                  {lang === 'id' ? 'Aksi' : '操作'}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const selectVal = getRowSenseiSelectValue(row);
                const isLegacy = selectVal.startsWith('legacy:');
                const isUnknownUid =
                  selectVal.startsWith('uid:') &&
                  !senseiOptions.some((o) => o.value === selectVal);
                const hasConflict = conflictedRowIds.has(row.id);
                const isDragging = dragIndex === idx;
                const isDropTarget = dragOverIndex === idx && dragIndex !== idx;
                const clsId = detectClassIdFromText(row.className);
                const clsTheme = clsId ? CLASS_THEMES[clsId] : null;

                const rowLabel =
                  [row.day, row.timeSlot, row.className, row.teacher].filter(Boolean).join(' · ') ||
                  `#${idx + 1}`;
                const ctxItems: ContextMenuItem[] = [
                  ...(idx > 0
                    ? [
                        {
                          id: 'up',
                          label: lang === 'id' ? 'Pindah ke Atas' : '上へ移動',
                          onSelect: () => moveRow(idx, -1),
                        },
                      ]
                    : []),
                  ...(idx < rows.length - 1
                    ? [
                        {
                          id: 'down',
                          label: lang === 'id' ? 'Pindah ke Bawah' : '下へ移動',
                          onSelect: () => moveRow(idx, 1),
                        },
                      ]
                    : []),
                  ...(selectVal
                    ? [
                        {
                          id: 'clear_sensei',
                          label: lang === 'id' ? 'Kosongkan Sensei' : '講師割り当て解除',
                          onSelect: () => handleAssignSensei(idx, ''),
                        },
                      ]
                    : []),
                  {
                    id: 'delete',
                    label: lang === 'id' ? 'Hapus Baris' : '行を削除',
                    destructive: true,
                    onSelect: () =>
                      setConfirmDelete({ kind: 'row', index: idx, label: rowLabel }),
                  },
                ];

                return (
                  <tr
                    key={row.id}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(idx);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) {
                        handleReorderDrop(dragIndex, idx);
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`apple-table-row transition-all duration-150 ${
                      isDragging
                        ? 'opacity-65 scale-[1.01] bg-[#f5f5f7] dark:bg-[#2c2c2e] shadow-md'
                        : isDropTarget
                        ? 'bg-[#0071e3]/10 dark:bg-[#2997ff]/15 border-t-2 border-t-[#0071e3] dark:border-t-[#2997ff]'
                        : hasConflict
                        ? 'bg-[#f59e0b]/10 dark:bg-[#f59e0b]/15'
                        : ''
                    }`}
                  >
                    <td className="p-1 text-center">
                      <AppleContextMenuTrigger items={ctxItems}>
                        <span
                          className="inline-flex items-center justify-center p-1 text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] cursor-grab active:cursor-grabbing"
                          title={
                            lang === 'id'
                              ? 'Seret untuk pindah baris / Klik kanan untuk opsi'
                              : 'ドラッグして行を移動／右クリックで操作'
                          }
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </span>
                      </AppleContextMenuTrigger>
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={row.day}
                        maxLength={40}
                        onChange={(e) => updateCell(idx, 'day', e.target.value)}
                        placeholder="月 / Senin"
                        className="w-full px-2 py-1.5 text-[12px] border border-transparent hover:border-[#d2d2d7] dark:hover:border-[#424245] focus:border-[#0071e3] dark:focus:border-[#2997ff] focus:outline-none rounded-[8px] bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73]/70 dark:placeholder:text-[#86868b]/70"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={row.timeSlot}
                        maxLength={40}
                        onChange={(e) => updateCell(idx, 'timeSlot', e.target.value)}
                        placeholder="08:30 - 10:00"
                        className="w-full px-2 py-1.5 text-[12px] font-mono tabular-nums border border-transparent hover:border-[#d2d2d7] dark:hover:border-[#424245] focus:border-[#0071e3] dark:focus:border-[#2997ff] focus:outline-none rounded-[8px] bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73]/70 dark:placeholder:text-[#86868b]/70"
                      />
                    </td>
                    <td className="p-1.5">
                      <div className="flex items-center gap-1.5">
                        {clsTheme && (
                          <span className={`w-2 h-2 rounded-full shrink-0 ${clsTheme.dotColor}`} />
                        )}
                        <input
                          type="text"
                          value={row.className}
                          maxLength={60}
                          onChange={(e) => updateCell(idx, 'className', e.target.value)}
                          placeholder="北海道 / Hokkaido"
                          className="w-full px-2 py-1.5 text-[12px] border border-transparent hover:border-[#d2d2d7] dark:hover:border-[#424245] focus:border-[#0071e3] dark:focus:border-[#2997ff] focus:outline-none rounded-[8px] bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73]/70 dark:placeholder:text-[#86868b]/70"
                        />
                      </div>
                    </td>
                    <td className="p-1.5">
                      <div className="flex items-center gap-1">
                        <select
                          value={selectVal}
                          onChange={(e) => handleAssignSensei(idx, e.target.value)}
                          aria-label={`Sensei selector row ${idx + 1}`}
                          className={`glass-input w-full px-2 py-1.5 text-[12px] rounded-[8px] ${
                            hasConflict ? '!border-[#d97706]' : ''
                          }`}
                        >
                          <option value="">
                            {lang === 'id' ? '— Pilih Sensei —' : '— 講師を選択 —'}
                          </option>
                          {isLegacy && <option value={selectVal}>{row.teacher}</option>}
                          {isUnknownUid && (
                            <option value={selectVal}>{row.teacher || row.teacherUid}</option>
                          )}
                          {senseiOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                              {opt.sublabel ? ` (${opt.sublabel})` : ''}
                            </option>
                          ))}
                        </select>
                        {hasConflict && (
                          <span
                            title={
                              lang === 'id'
                                ? 'Sensei bentrok di jam ini'
                                : 'この時間帯に重複あり'
                            }
                            className="text-[#d97706] dark:text-[#fbbf24] shrink-0"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={row.subject}
                        maxLength={120}
                        onChange={(e) => updateCell(idx, 'subject', e.target.value)}
                        placeholder="みんなの日本語 L6"
                        className="w-full px-2 py-1.5 text-[12px] border border-transparent hover:border-[#d2d2d7] dark:hover:border-[#424245] focus:border-[#0071e3] dark:focus:border-[#2997ff] focus:outline-none rounded-[8px] bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73]/70 dark:placeholder:text-[#86868b]/70"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={row.room}
                        maxLength={40}
                        onChange={(e) => updateCell(idx, 'room', e.target.value)}
                        placeholder="Room A"
                        className="w-full px-2 py-1.5 text-[12px] border border-transparent hover:border-[#d2d2d7] dark:hover:border-[#424245] focus:border-[#0071e3] dark:focus:border-[#2997ff] focus:outline-none rounded-[8px] bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73]/70 dark:placeholder:text-[#86868b]/70"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={row.note}
                        maxLength={120}
                        onChange={(e) => updateCell(idx, 'note', e.target.value)}
                        className="w-full px-2 py-1.5 text-[12px] border border-transparent hover:border-[#d2d2d7] dark:hover:border-[#424245] focus:border-[#0071e3] dark:focus:border-[#2997ff] focus:outline-none rounded-[8px] bg-transparent text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73]/70 dark:placeholder:text-[#86868b]/70"
                      />
                    </td>
                    <td className="p-1.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => moveRow(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-30"
                        title="Up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRow(idx, 1)}
                        disabled={idx === rows.length - 1}
                        className="p-1 text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] disabled:opacity-30"
                        title="Down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            kind: 'row',
                            index: idx,
                            label: rowLabel,
                          })
                        }
                        className="p-1 text-[#6e6e73] dark:text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a]"
                        title={lang === 'id' ? 'Hapus baris' : '行を削除'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-[16px] bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border border-[#d2d2d7]/60 dark:border-[#424245]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'id' ? 'Tambah Baris' : '行を追加'}</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete({ kind: 'clear_all' })}
              className="px-4 py-1.5 text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors whitespace-nowrap"
            >
              {lang === 'id' ? 'Kosongkan Semua' : '空欄に戻す'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="apple-btn-primary inline-flex items-center gap-2 px-5 py-2 text-[14px] disabled:opacity-50 whitespace-nowrap"
          >
            <Save className="w-4 h-4" />
            <span>
              {saving
                ? lang === 'id'
                  ? 'Menyimpan...'
                  : '保存中...'
                : lang === 'id'
                ? 'Simpan Jadwal'
                : 'スケジュールを保存する'}
            </span>
          </button>
        </div>
      </motion.div>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        lang={lang}
        title={
          confirmDelete?.kind === 'clear_all'
            ? lang === 'id'
              ? 'Kosongkan Semua Baris Jadwal?'
              : 'スケジュールをすべて空欄に戻しますか？'
            : lang === 'id'
            ? 'Hapus Baris Jadwal?'
            : 'このスケジュール行を削除しますか？'
        }
        message={
          confirmDelete?.kind === 'clear_all'
            ? lang === 'id'
              ? 'Semua isi tabel jadwal akan direset menjadi baris kosong (belum tersimpan sampai Anda klik Simpan).'
              : '表の内容をすべて白紙に戻します。'
            : confirmDelete?.kind === 'row'
            ? lang === 'id'
              ? `Baris "${confirmDelete.label}" akan dihapus dari tabel jadwal.`
              : `行「${confirmDelete.label}」を削除します。`
            : ''
        }
        onCancel={() => setConfirmDelete(null)}
        onConfirm={executeConfirmedDelete}
      />
    </div>
  );
}
