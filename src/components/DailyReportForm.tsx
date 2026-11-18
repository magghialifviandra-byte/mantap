import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { AlertCircle, Check, CheckCircle2, Clock, Edit3, MessageSquare, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel, tr, UI_TEXT } from '../i18n';
import {
  ApprovalStatus,
  ClassId,
  CLASSES,
  DailyReport,
  LanguageMode,
  Student,
  StudentNote,
  UserProfile,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { CLASS_THEMES, getClassTheme } from '../utils/classTheme';
import { getTodayDateStr } from '../utils/dateUtils';
import { clampArray, clampNum, clampStr, sanitizeDateStr } from '../utils/payloadGuards';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  reports: DailyReport[];
}

const ATMOSPHERE_LABELS: { score: number; ja: string; id: string }[] = [
  { score: 1, ja: '1 要注意', id: '1 Perlu Perhatian' },
  { score: 2, ja: '2 やや静か', id: '2 Kurang Aktif' },
  { score: 3, ja: '3 普通', id: '3 Cukup Baik' },
  { score: 4, ja: '4 良好', id: '4 Aktif' },
  { score: 5, ja: '5 非常に活発', id: '5 Sangat Antusias' },
];

export function DailyReportForm({ lang, profile, students, reports }: Props) {
  const defaultClass: ClassId =
    profile.assignedClasses.length > 0 ? profile.assignedClasses[0] : 'hokkaido';

  const [editingId, setEditingId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(getTodayDateStr());
  const [classId, setClassId] = useState<ClassId>(defaultClass);
  const [teacherName, setTeacherName] = useState<string>(profile.displayName);

  const [absentNames, setAbsentNames] = useState<string[]>([]);
  const [lateNames, setLateNames] = useState<string[]>([]);
  const [manualTotal, setManualTotal] = useState<number>(0);

  // Class-specific adaptive fields
  const [kanaProgress, setKanaProgress] = useState<string>('');
  const [textbookUnit, setTextbookUnit] = useState<string>('');
  const [examPractice, setExamPractice] = useState<string>('');
  const [conversationTopic, setConversationTopic] = useState<string>('');
  const [kaigoTopic, setKaigoTopic] = useState<string>('');

  // Common fields
  const [homework, setHomework] = useState<string>('');
  const [atmosphere, setAtmosphere] = useState<number>(4);
  const [issues, setIssues] = useState<string>('');
  const [tomorrowPlan, setTomorrowPlan] = useState<string>('');
  const [overallComment, setOverallComment] = useState<string>('');
  const [studentNotes, setStudentNotes] = useState<StudentNote[]>([]);

  // Individual note builder
  const [noteStudentId, setNoteStudentId] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState<string>('');
  const [formError, setFormError] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<ApprovalStatus | 'all'>('all');

  const classStudents = useMemo(
    () => students.filter((s) => s.classId === classId && s.active),
    [students, classId]
  );

  useEffect(() => {
    if (!editingId) {
      setManualTotal(classStudents.length);
      setAbsentNames([]);
      setLateNames([]);
    }
  }, [classId, classStudents.length, editingId]);

  const totalCount = classStudents.length > 0 ? classStudents.length : manualTotal;
  const presentCount = Math.max(0, totalCount - absentNames.length);

  const toggleAttendanceFlag = (studentName: string, type: 'absent' | 'late') => {
    if (type === 'absent') {
      setAbsentNames((prev) =>
        prev.includes(studentName) ? prev.filter((n) => n !== studentName) : [...prev, studentName]
      );
      setLateNames((prev) => prev.filter((n) => n !== studentName));
    } else {
      setLateNames((prev) =>
        prev.includes(studentName) ? prev.filter((n) => n !== studentName) : [...prev, studentName]
      );
      setAbsentNames((prev) => prev.filter((n) => n !== studentName));
    }
  };

  const addStudentNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    const stu = classStudents.find((s) => s.id === noteStudentId);
    const entry: StudentNote = {
      studentId: stu ? stu.id : 'custom',
      studentName: stu ? stu.name : noteStudentId || '学生 / Siswa',
      note: clampStr(trimmed, 300),
    };
    setStudentNotes((prev) => clampArray([...prev, entry], 40));
    setNoteText('');
    setNoteStudentId('');
  };

  const resetForm = () => {
    setEditingId(null);
    setDate(getTodayDateStr());
    setTeacherName(profile.displayName);
    setAbsentNames([]);
    setLateNames([]);
    setManualTotal(classStudents.length);
    setKanaProgress('');
    setTextbookUnit('');
    setExamPractice('');
    setConversationTopic('');
    setKaigoTopic('');
    setHomework('');
    setAtmosphere(4);
    setIssues('');
    setTomorrowPlan('');
    setOverallComment('');
    setStudentNotes([]);
    setFormError('');
  };

  const loadForEdit = (r: DailyReport) => {
    setEditingId(r.id);
    setDate(r.date);
    setClassId(r.classId);
    setTeacherName(r.teacherName);
    setManualTotal(r.totalStudents);
    setAbsentNames(r.absentNames || []);
    setLateNames(r.lateNames || []);
    setKanaProgress(r.kanaProgress || '');
    setTextbookUnit(r.textbookUnit || '');
    setExamPractice(r.examPractice || '');
    setConversationTopic(r.conversationTopic || '');
    setKaigoTopic(r.kaigoTopic || '');
    setHomework(r.homework || '');
    setAtmosphere(r.atmosphere || 4);
    setIssues(r.issues || '');
    setTomorrowPlan(r.tomorrowPlan || '');
    setOverallComment(r.overallComment || '');
    setStudentNotes(r.studentNotes || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const cleanComment = clampStr(overallComment, 2000);
    if (!cleanComment) {
      setFormError(
        lang === 'ja'
          ? 'クラス全体コメントを入力してください。'
          : lang === 'id'
          ? 'Mohon isi komentar umum kelas.'
          : 'クラス全体コメントを入力してください / Mohon isi komentar umum kelas.'
      );
      return;
    }

    setSaving(true);
    const cleanDate = sanitizeDateStr(date, getTodayDateStr());
    const cleanTotal = clampNum(totalCount, 0, 200);
    const cleanPresent = clampNum(presentCount, 0, cleanTotal || 200);

    const existingEditing = editingId ? reports.find((r) => r.id === editingId) : null;

    const payload = {
      date: cleanDate,
      classId,
      teacherUid: existingEditing ? existingEditing.teacherUid : profile.uid,
      teacherName: clampStr(teacherName || profile.displayName, 100) || 'Sensei',
      totalStudents: cleanTotal,
      presentCount: cleanPresent,
      absentNames: clampArray(
        absentNames.map((n) => clampStr(n, 100)).filter(Boolean),
        60
      ),
      lateNames: clampArray(
        lateNames.map((n) => clampStr(n, 100)).filter(Boolean),
        60
      ),
      kanaProgress: clampStr(kanaProgress, 200),
      textbookUnit: clampStr(textbookUnit, 200),
      examPractice: clampStr(examPractice, 300),
      conversationTopic: clampStr(conversationTopic, 300),
      kaigoTopic: clampStr(kaigoTopic, 300),
      homework: clampStr(homework, 300),
      atmosphere: clampNum(atmosphere, 1, 5),
      issues: clampStr(issues, 1000),
      tomorrowPlan: clampStr(tomorrowPlan, 500),
      overallComment: cleanComment,
      studentNotes: clampArray(
        studentNotes.map((sn) => ({
          studentId: clampStr(sn.studentId, 128),
          studentName: clampStr(sn.studentName, 120),
          note: clampStr(sn.note, 300),
        })),
        40
      ),
      approvalStatus: 'pending' as const,
      headFeedback: existingEditing ? existingEditing.headFeedback || '' : '',
      approvedBy: existingEditing ? existingEditing.approvedBy || '' : '',
      approvedAt: existingEditing ? existingEditing.approvedAt || '' : '',
    };

    try {
      if (editingId) {
        const ref = doc(db, 'dailyReports', editingId);
        await updateDoc(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
        await logActivity({
          actor: profile,
          actionType: 'data_update',
          targetType: 'report',
          targetLabel: `${classId} (${cleanDate})`,
          detail: 'Updated daily report',
        });
        setSavedToast(
          lang === 'id'
            ? 'Laporan diperbarui & dikirim ulang untuk approval'
            : '日報を更新し、承認待ちに戻しました'
        );
      } else {
        await addDoc(collection(db, 'dailyReports'), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logActivity({
          actor: profile,
          actionType: 'data_create',
          targetType: 'report',
          targetLabel: `${classId} (${cleanDate})`,
          detail: `Submitted daily report (${cleanPresent}/${cleanTotal} present)`,
        });
        setSavedToast(
          lang === 'id'
            ? 'Laporan dikirim ke Kepala Sekolah (menunggu approval)'
            : '日報を校長へ提出しました（承認待ち）'
        );
      }
      resetForm();
      setTimeout(() => setSavedToast(''), 3500);
    } catch (err) {
      handleFirestoreError(err, editingId ? OperationType.UPDATE : OperationType.CREATE, 'dailyReports');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkFeedbackRead = async (report: DailyReport) => {
    try {
      await updateDoc(doc(db, 'dailyReports', report.id), {
        commentReadByTeacher: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `dailyReports/${report.id}`);
    }
  };

  const myAllReports = useMemo(() => {
    const filtered =
      profile.role === 'head'
        ? reports
        : reports.filter((r) => r.teacherUid === profile.uid);
    return [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  }, [reports, profile]);

  const revisionNeededReports = useMemo(
    () => myAllReports.filter((r) => (r.approvalStatus || 'pending') === 'revision_needed'),
    [myAllReports]
  );

  const historyCounts = useMemo(() => {
    let pending = 0;
    let revision = 0;
    let approved = 0;
    myAllReports.forEach((r) => {
      const st = r.approvalStatus || 'pending';
      if (st === 'approved') approved += 1;
      else if (st === 'revision_needed') revision += 1;
      else pending += 1;
    });
    return { total: myAllReports.length, pending, revision, approved };
  }, [myAllReports]);

  const myRecentReports = useMemo(() => {
    return myAllReports
      .filter((r) =>
        historyFilter === 'all' ? true : (r.approvalStatus || 'pending') === historyFilter
      )
      .slice(0, 24);
  }, [myAllReports, historyFilter]);

  const editingReport = useMemo(
    () => (editingId ? reports.find((r) => r.id === editingId) || null : null),
    [editingId, reports]
  );

  const activeClassTheme = getClassTheme(classId);

  return (
    <div className="space-y-6">
      <LiquidToast message={savedToast} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {tr(UI_TEXT.navDailyReport, lang)}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'ja'
              ? '授業終了後、2分以内で入力できる日報フォームです。'
              : 'Formulir cepat laporan harian kelas (selesai dalam < 2 menit di HP atau PC).'}
          </p>
        </div>
        {activeClassTheme && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-medium bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7]">
            <span className={`w-2 h-2 rounded-full ${activeClassTheme.dotColor}`} />
            <span>{classLabel(classId, lang)}</span>
          </div>
        )}
      </div>

      {/* Per-Class Today Daily Report Status (Submitted vs Missing) */}
      {(() => {
        const todayStr = getTodayDateStr();
        const myTodayReports = reports.filter((r) => r.date === todayStr);
        const targetClasses =
          profile.role === 'teacher' && profile.assignedClasses.length > 0
            ? profile.assignedClasses
            : CLASSES.map((c) => c.id);
        const missingMyClasses = targetClasses.filter(
          (cid) => !myTodayReports.some((r) => r.classId === cid)
        );

        return (
          <div className="apple-tile p-4 sm:p-5 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id'
                  ? `Status Laporan Hari Ini (${todayStr})`
                  : `本日の日報提出状況（${todayStr}）`}
              </span>
              {profile.role === 'teacher' && missingMyClasses.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {lang === 'id'
                      ? 'Pengingat: Mohon kirim laporan hari ini setelah kelas selesai.'
                      : 'リマインダー：本日の授業後、未提出クラスの日報をご提出ください。'}
                  </span>
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {CLASSES.map((c) => {
                const submitted = myTodayReports.some((r) => r.classId === c.id);
                const cTheme = CLASS_THEMES[c.id];
                const isSelected = classId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      if (!editingId) setClassId(c.id);
                    }}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-[14px] border text-[12px] transition-colors text-left ${
                      isSelected
                        ? 'bg-white dark:bg-[#2c2c2e] border-[#0071e3] dark:border-[#2997ff] text-[#1d1d1f] dark:text-[#f5f5f7]'
                        : 'bg-[#f5f5f7] dark:bg-[#161617] border-[#d2d2d7]/50 dark:border-[#424245]/60 text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#ececf0] dark:hover:bg-[#2c2c2e]'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 font-medium truncate">
                      <span className={`w-2 h-2 rounded-full ${cTheme.dotColor} shrink-0`} />
                      <span className="truncate">{lang === 'id' ? c.nameId : c.nameJa}</span>
                    </span>
                    {submitted ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{lang === 'id' ? 'Sudah' : '提出済'}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/12 text-amber-700 dark:text-amber-400 shrink-0">
                        <Clock className="w-3 h-3" />
                        <span>{lang === 'id' ? 'Belum' : '未提出'}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Returned for Revision Action Banner */}
      {revisionNeededReports.length > 0 && (
        <div className="apple-tile p-4 sm:p-5 border border-[#dc2626]/30 dark:border-[#ff453a]/35 space-y-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#dc2626] dark:text-[#ff453a]">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              {lang === 'ja'
                ? `差し戻し・要修正の日報が ${revisionNeededReports.length}件 あります`
                : `${revisionNeededReports.length} Laporan Dikembalikan untuk Revisi oleh Kepala Sekolah`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {revisionNeededReports.map((rev) => (
              <div
                key={rev.id}
                className="rounded-[16px] bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] p-3.5 flex flex-col justify-between gap-2.5"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {classLabel(rev.classId, lang)}
                    </span>
                    <span className="font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                      {rev.date}
                    </span>
                  </div>
                  <div className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#dc2626]/6 border border-[#dc2626]/20 dark:border-[#ff453a]/25 rounded-[12px] p-2.5 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5 text-[#dc2626] dark:text-[#ff453a]">
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>
                        {lang === 'ja'
                          ? `校長フィードバック${rev.approvedBy ? ` (${rev.approvedBy})` : ''}:`
                          : `Catatan Kepala Sekolah${rev.approvedBy ? ` (${rev.approvedBy})` : ''}:`}
                      </span>
                    </div>
                    <div className="whitespace-pre-line text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {rev.headFeedback ||
                        (lang === 'ja'
                          ? '内容を確認して修正・再提出してください。'
                          : 'Mohon tinjau kembali isi laporan dan kirim ulang.')}
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => loadForEdit(rev)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-[#dc2626] dark:bg-[#ff453a] text-white rounded-full hover:opacity-90 whitespace-nowrap shrink-0 transition-opacity"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? '修正して再提出' : 'Revisi & Kirim Ulang'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="apple-tile p-5 sm:p-6 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-6 relative"
      >
        {editingId && (
          <div className="bg-amber-500/10 border border-amber-500/25 rounded-[14px] px-4 py-3 space-y-2 text-[13px] text-amber-800 dark:text-amber-300">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {editingReport?.approvalStatus === 'revision_needed'
                  ? lang === 'ja'
                    ? '差し戻し日報を修正中（保存すると「承認待ち」として再提出されます）'
                    : 'Merevisi Laporan yang Dikembalikan (setelah disimpan akan dikirim ulang untuk approval)'
                  : lang === 'ja'
                  ? '既存の日報を編集中'
                  : 'Sedang mengubah laporan'}
              </span>
              <button
                type="button"
                onClick={resetForm}
                className="text-[12px] font-medium text-[#0066cc] dark:text-[#2997ff] hover:underline whitespace-nowrap shrink-0"
              >
                {tr(UI_TEXT.cancel, lang)}
              </button>
            </div>
            {editingReport?.headFeedback && (
              <div className="text-[12px] bg-white/80 dark:bg-[#161617]/80 border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[10px] p-2.5 text-[#1d1d1f] dark:text-[#f5f5f7]">
                <span className="font-semibold">
                  {lang === 'ja' ? '校長フィードバック: ' : 'Catatan Kepala: '}
                </span>
                <span className="whitespace-pre-line">{editingReport.headFeedback}</span>
              </div>
            )}
          </div>
        )}

        {/* Row 1: Class, Date, Teacher */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'ja' ? 'クラス' : 'Kelas'}
            </label>
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value as ClassId)}
              disabled={Boolean(editingId)}
              className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
            >
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'ja' ? '日付' : 'Tanggal'}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={Boolean(editingId)}
              className="w-full px-3.5 py-2.5 text-[14px] font-mono tabular-nums rounded-[12px] glass-input"
              required
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'ja' ? '担当講師名' : 'Nama Sensei'}
            </label>
            <input
              type="text"
              value={teacherName}
              onChange={(e) => setTeacherName(e.target.value)}
              maxLength={100}
              className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
              required
            />
          </div>
        </div>

        {/* Attendance Section */}
        <div className="pt-5 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'ja' ? '出欠状況' : 'Kehadiran Siswa'}
            </span>
            <span className="text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
              {tr(UI_TEXT.present, lang)}: {presentCount} / {totalCount} · {tr(UI_TEXT.absent, lang)}:{' '}
              {absentNames.length} · {tr(UI_TEXT.late, lang)}: {lateNames.length}
            </span>
          </div>

          {classStudents.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245] p-3.5 rounded-[14px]">
              <div>
                <label className="block text-[12px] text-[#6e6e73] dark:text-[#86868b] mb-1">
                  {lang === 'ja'
                    ? '在籍人数（名簿未登録のため手入力）'
                    : 'Total Siswa (input manual karena belum ada daftar siswa)'}
                </label>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={manualTotal}
                  onChange={(e) => setManualTotal(Number(e.target.value))}
                  className="w-32 px-3 py-2 text-[14px] font-mono tabular-nums rounded-[12px] glass-input"
                />
              </div>
              <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] flex items-center">
                {lang === 'ja'
                  ? '「学生名簿」で名簿を登録するとワンタップで欠席・遅刻を選択できます。'
                  : 'Tambahkan daftar siswa di menu Siswa agar bisa tap absen otomatis.'}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {classStudents.map((stu) => {
                const isAbsent = absentNames.includes(stu.name);
                const isLate = lateNames.includes(stu.name);
                return (
                  <div
                    key={stu.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-[12px] bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245]/60"
                  >
                    <span className="text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                      {stu.name}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleAttendanceFlag(stu.name, 'absent')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-[8px] border transition-colors ${
                          isAbsent
                            ? 'bg-[#dc2626] dark:bg-[#ff453a] border-transparent text-white'
                            : 'bg-white dark:bg-[#2c2c2e] border-[#d2d2d7] dark:border-[#424245] text-[#6e6e73] dark:text-[#f5f5f7]/80'
                        }`}
                      >
                        {lang === 'ja' ? '欠' : 'Absen'}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleAttendanceFlag(stu.name, 'late')}
                        className={`px-2.5 py-1 text-[11px] font-medium rounded-[8px] border transition-colors ${
                          isLate
                            ? 'bg-amber-600 border-transparent text-white'
                            : 'bg-white dark:bg-[#2c2c2e] border-[#d2d2d7] dark:border-[#424245] text-[#6e6e73] dark:text-[#f5f5f7]/80'
                        }`}
                      >
                        {lang === 'ja' ? '遅' : 'Telat'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Adaptive Class-Specific Lesson Fields */}
        <div className="pt-5 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-4">
          <div className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            {classLabel(classId, lang)} — {lang === 'ja' ? '本日の授業内容' : 'Materi Hari Ini'}
          </div>

          {classId === 'hokkaido' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja' ? 'ひらがな・カタカナ進捗' : 'Kemajuan Hiragana & Katakana'}
                </label>
                <input
                  type="text"
                  value={kanaProgress}
                  onChange={(e) => setKanaProgress(e.target.value)}
                  placeholder="例: カタカナ定着確認完了 / Katakana sudah lancar"
                  maxLength={200}
                  className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja'
                    ? 'みんなの日本語（課・ページ）'
                    : 'Minna no Nihongo (Bab & Halaman)'}
                </label>
                <input
                  type="text"
                  value={textbookUnit}
                  onChange={(e) => setTextbookUnit(e.target.value)}
                  placeholder="例: 第6課 p.52-55 / Bab 6 hal. 52-55"
                  maxLength={200}
                  className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                />
              </div>
            </div>
          )}

          {classId === 'saitama' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja' ? 'いろどり進捗（課・ページ）' : 'Buku Irodori (Bab / Topik)'}
                </label>
                <input
                  type="text"
                  value={textbookUnit}
                  onChange={(e) => setTextbookUnit(e.target.value)}
                  placeholder="例: 入門 L10 トピック2 / Irodori Bab 10"
                  maxLength={200}
                  className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja' ? 'JLPT / JFT 毎日対策内容' : 'Latihan Harian JLPT / JFT'}
                </label>
                <input
                  type="text"
                  value={examPractice}
                  onChange={(e) => setExamPractice(e.target.value)}
                  placeholder="例: N4文字語彙ドリル20問・聴解問題"
                  maxLength={300}
                  className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                />
              </div>
            </div>
          )}

          {classId === 'nara' && (
            <div>
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                {lang === 'ja' ? '会話テーマ・ロールプレイ内容' : 'Topik Percakapan & Roleplay'}
              </label>
              <input
                type="text"
                value={conversationTopic}
                onChange={(e) => setConversationTopic(e.target.value)}
                placeholder="例: 職場での報連相・敬語ロールプレイ / Keigo & Hourensou di tempat kerja"
                maxLength={300}
                className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
              />
            </div>
          )}

          {classId === 'kaigo' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja' ? '介護日本語・専門語彙テーマ' : 'Kosakata & Materi Kaigo'}
                </label>
                <input
                  type="text"
                  value={kaigoTopic}
                  onChange={(e) => setKaigoTopic(e.target.value)}
                  placeholder="例: 移乗・食事介助の声かけ / Kosakata bantuan makan & pindah tempat"
                  maxLength={300}
                  className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                  {lang === 'ja' ? '特定技能面接・実技練習' : 'Latihan Wawancara / Praktik SSW'}
                </label>
                <input
                  type="text"
                  value={examPractice}
                  onChange={(e) => setExamPractice(e.target.value)}
                  placeholder="例: 志望動機・介護現場マナー練習"
                  maxLength={300}
                  className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                />
              </div>
            </div>
          )}
        </div>

        {/* Homework, Atmosphere, Plan */}
        <div className="pt-5 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'ja' ? '宿題・課題' : 'PR / Tugas'}
            </label>
            <input
              type="text"
              value={homework}
              onChange={(e) => setHomework(e.target.value)}
              placeholder="例: 漢字ワークp.14 / Latihan Kanji hal. 14"
              maxLength={300}
              className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'ja' ? '明日の予定' : 'Rencana Besok'}
            </label>
            <input
              type="text"
              value={tomorrowPlan}
              onChange={(e) => setTomorrowPlan(e.target.value)}
              placeholder="例: 第7課導入・単語小テスト / Bab 7 & Kuis Kosakata"
              maxLength={500}
              className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
            />
          </div>
        </div>

        {/* Atmosphere 1-5 Segmented Control */}
        <div className="space-y-2">
          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b]">
            {lang === 'ja' ? 'クラスの雰囲気・集中度 (1〜5)' : 'Suasana & Fokus Kelas (1-5)'}
          </label>
          <div className="inline-flex flex-wrap gap-1.5 p-1 bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[14px]">
            {ATMOSPHERE_LABELS.map((item) => {
              const active = atmosphere === item.score;
              return (
                <button
                  key={item.score}
                  type="button"
                  onClick={() => setAtmosphere(item.score)}
                  className={`px-3 py-1.5 text-[12px] font-medium rounded-[10px] transition-colors ${
                    active
                      ? 'bg-[#0071e3] dark:bg-[#2997ff] text-white'
                      : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  {lang === 'ja' ? item.ja : item.id}
                </button>
              );
            })}
          </div>
        </div>

        {/* Teacher Comments & Issues */}
        <div className="pt-5 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                {lang === 'ja' ? 'クラス全体コメント・総評（必須）' : 'Komentar Umum Kelas (Wajib)'}
              </label>
              <textarea
                value={overallComment}
                onChange={(e) => setOverallComment(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={
                  lang === 'ja'
                    ? '今日の授業の反応、理解度、良かった点や課題などを自由にご記入ください。'
                    : 'Tulis ringkasan kondisi kelas hari ini, pemahaman siswa, dan catatan penting lainnya.'
                }
                className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
                required
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
                {lang === 'ja'
                  ? '特記事項・問題点（任意）'
                  : 'Kendala / Hal yang Perlu Perhatian (Opsional)'}
              </label>
              <textarea
                value={issues}
                onChange={(e) => setIssues(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder={
                  lang === 'ja'
                    ? '生活態度、体調不良、フォローが必要な点があれば入力してください。'
                    : 'Misal: siswa sakit, keterlambatan berulang, atau materi yang sulit dipahami.'
                }
                className="w-full px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
              />
            </div>
          </div>

          {/* Optional Individual Student Comments */}
          <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245] rounded-[16px] p-4 space-y-3">
            <div className="text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'ja' ? '個別学生コメント（任意）' : 'Catatan Siswa Individual (Opsional)'}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              {classStudents.length > 0 ? (
                <select
                  value={noteStudentId}
                  onChange={(e) => setNoteStudentId(e.target.value)}
                  className="sm:w-52 px-3 py-2 text-[13px] rounded-[12px] glass-input"
                >
                  <option value="">
                    {lang === 'ja' ? '学生を選択...' : 'Pilih siswa...'}
                  </option>
                  {classStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={noteStudentId}
                  onChange={(e) => setNoteStudentId(e.target.value)}
                  placeholder={lang === 'ja' ? '学生名' : 'Nama siswa'}
                  className="sm:w-52 px-3 py-2 text-[13px] rounded-[12px] glass-input"
                />
              )}

              <input
                type="text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                maxLength={300}
                placeholder={
                  lang === 'ja'
                    ? '例：発音が良くなった／助詞の復習が必要'
                    : 'Contoh: Pelafalan bagus / perlu latihan partikel lagi'
                }
                className="flex-1 px-3 py-2 text-[13px] rounded-[12px] glass-input"
              />
              <button
                type="button"
                onClick={addStudentNote}
                className="apple-btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[12px] whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '追加' : 'Tambah'}</span>
              </button>
            </div>

            {studentNotes.length > 0 && (
              <ul className="divide-y divide-[#d2d2d7]/50 dark:divide-[#424245] bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-[12px]">
                {studentNotes.map((sn, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]"
                  >
                    <div>
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {sn.studentName}
                      </span>
                      <span className="mx-2 text-[#d2d2d7] dark:text-[#424245]">·</span>
                      <span className="text-[#6e6e73] dark:text-[#86868b]">{sn.note}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStudentNotes((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-[#6e6e73] hover:text-[#dc2626] dark:hover:text-[#ff453a] p-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {formError && (
          <div className="text-[13px] text-[#dc2626] dark:text-[#ff453a] bg-[#dc2626]/8 border border-[#dc2626]/25 px-3.5 py-2.5 rounded-[12px]">
            {formError}
          </div>
        )}

        {/* Sticky Blurred Footer Action Bar */}
        <div className="sticky bottom-0 z-20 -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 px-5 sm:px-6 py-3.5 bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border-t border-[#d2d2d7]/60 dark:border-[#424245] rounded-b-[24px] flex items-center justify-end gap-3">
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-[13px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
            >
              {tr(UI_TEXT.cancel, lang)}
            </button>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="submit"
            disabled={saving}
            className="apple-btn-primary px-6 py-2.5 text-[14px] disabled:opacity-50"
          >
            {saving
              ? lang === 'ja'
                ? '送信中...'
                : 'Menyimpan...'
              : editingId
              ? lang === 'ja'
                ? '日報を更新する'
                : 'Perbarui Laporan'
              : lang === 'ja'
              ? '日報を提出する'
              : 'Kirim Laporan Harian'}
          </motion.button>
        </div>
      </form>

      {/* Recent Reports & Head Feedback */}
      <div className="space-y-3.5 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
            {lang === 'ja'
              ? '自分の提出済み日報・承認状況・フィードバック'
              : 'Riwayat Laporan Saya, Status Approval & Feedback Kepala'}
          </h2>

          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full">
            {(['all', 'revision_needed', 'pending', 'approved'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setHistoryFilter(st)}
                className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  historyFilter === st
                    ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                    : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                }`}
              >
                {st === 'all'
                  ? `${lang === 'ja' ? 'すべて' : 'Semua'} (${historyCounts.total})`
                  : st === 'revision_needed'
                  ? `${tr(UI_TEXT.statusRevision, lang)} (${historyCounts.revision})`
                  : st === 'pending'
                  ? `${tr(UI_TEXT.statusPending, lang)} (${historyCounts.pending})`
                  : `${tr(UI_TEXT.statusApproved, lang)} (${historyCounts.approved})`}
              </button>
            ))}
          </div>
        </div>

        {myRecentReports.length === 0 ? (
          <EmptyStateIllustration
            kind="clipboard"
            title={
              historyCounts.total === 0
                ? lang === 'ja'
                  ? 'まだ日報が提出されていません'
                  : 'Belum ada laporan harian yang dikirim'
                : lang === 'ja'
                ? 'このステータスの日報はありません'
                : 'Tidak ada laporan dengan status ini'
            }
            subtitle={
              historyCounts.total === 0
                ? lang === 'ja'
                  ? '上のフォームから最初の日報を提出してください。'
                  : 'Kirim laporan pertama melalui formulir di atas.'
                : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myRecentReports.map((r) => {
              const status = r.approvalStatus || 'pending';
              const canTeacherEdit =
                profile.role === 'head' ||
                (r.teacherUid === profile.uid && status !== 'approved');
              const rTheme = CLASS_THEMES[r.classId];

              return (
                <div
                  key={r.id}
                  className="apple-tile apple-virtual-item p-5 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        <span className={`w-2 h-2 rounded-full ${rTheme.dotColor}`} />
                        <span>{classLabel(r.classId, lang)}</span>
                      </div>
                      <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] font-mono tabular-nums mt-0.5">
                        {r.date} · {r.teacherName} · {tr(UI_TEXT.present, lang)} {r.presentCount}/
                        {r.totalStudents}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          status === 'approved'
                            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                            : status === 'revision_needed'
                            ? 'bg-[#dc2626]/10 text-[#dc2626] dark:text-[#ff453a]'
                            : 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {status === 'approved'
                          ? tr(UI_TEXT.statusApproved, lang)
                          : status === 'revision_needed'
                          ? tr(UI_TEXT.statusRevision, lang)
                          : tr(UI_TEXT.statusPending, lang)}
                      </span>
                      {canTeacherEdit && (
                        <button
                          type="button"
                          onClick={() => loadForEdit(r)}
                          className={`inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium rounded-full border whitespace-nowrap shrink-0 transition-colors ${
                            status === 'revision_needed'
                              ? 'bg-[#dc2626] dark:bg-[#ff453a] border-transparent text-white hover:opacity-90'
                              : 'border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                          }`}
                        >
                          {status === 'revision_needed' ? (
                            <RotateCcw className="w-3 h-3" />
                          ) : (
                            <Edit3 className="w-3 h-3" />
                          )}
                          <span>
                            {status === 'revision_needed'
                              ? lang === 'ja'
                                ? '修正して再提出'
                                : 'Revisi'
                              : tr(UI_TEXT.edit, lang)}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  <p className="text-[14px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-line leading-relaxed">
                    {r.overallComment}
                  </p>

                  {r.issues && (
                    <div className="text-[12px] text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-[12px] px-3 py-2">
                      {lang === 'ja' ? '要注意: ' : 'Catatan: '}
                      {r.issues}
                    </div>
                  )}

                  {(r.headFeedback || r.approvedAt) && (() => {
                    const isUnread =
                      Boolean(r.headFeedback) &&
                      r.commentReadByTeacher === false &&
                      r.teacherUid === profile.uid;
                    return (
                      <div
                        className={`text-[12px] rounded-[12px] px-3.5 py-2.5 space-y-1.5 border ${
                          status === 'revision_needed'
                            ? 'text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#dc2626]/6 border-[#dc2626]/25'
                            : isUnread
                            ? 'text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#0071e3]/8 border-[#0071e3]/35 dark:border-[#2997ff]/40'
                            : 'text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#f5f5f7] dark:bg-[#161617] border-[#d2d2d7]/60 dark:border-[#424245]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                            <span>
                              {lang === 'ja'
                                ? `校長からのコメント${r.approvedBy ? ` (${r.approvedBy})` : ''}`
                                : `Komentar Kepala Sekolah${r.approvedBy ? ` (${r.approvedBy})` : ''}`}
                            </span>
                            {isUnread && (
                              <span className="px-2 py-0.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white text-[10px] font-semibold">
                                {lang === 'id' ? 'Belum Dibaca' : '未読'}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            {(r.commentedAt || r.approvedAt) && (
                              <span className="font-mono text-[11px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                                {r.commentedAt || r.approvedAt}
                              </span>
                            )}
                            {isUnread && (
                              <button
                                type="button"
                                onClick={() => handleMarkFeedbackRead(r)}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] hover:opacity-90 text-white text-[11px] font-medium"
                              >
                                <Check className="w-3 h-3" />
                                <span>{lang === 'id' ? 'Tandai Dibaca' : '既読にする'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                        {r.headFeedback ? (
                          <div className="whitespace-pre-line leading-relaxed text-[#6e6e73] dark:text-[#f5f5f7]/85">
                            {r.headFeedback}
                          </div>
                        ) : (
                          <div className="text-[#6e6e73] dark:text-[#86868b]">
                            {status === 'approved'
                              ? lang === 'ja'
                                ? '承認されました（コメントなし）。'
                                : 'Laporan disetujui oleh Kepala Sekolah.'
                              : lang === 'ja'
                              ? '修正依頼が出されています。内容を確認して再提出してください。'
                              : 'Dikembalikan untuk revisi. Mohon periksa kembali isi laporan.'}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
