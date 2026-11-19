import React, { useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Calendar,
  CalendarCheck,
  Download,
  Edit3,
  Eye,
  FileText,
  MessageSquarePlus,
  Printer,
  Save,
  Star,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel } from '../i18n';
import {
  CertificateRecord,
  DailyReport,
  HandledAlert,
  LanguageMode,
  ProgramDurationMonths,
  QualityThresholds,
  ReportCard,
  ScheduleRow,
  SchoolSettings,
  Student,
  StudentProfileNote,
  TestResult,
  UserProfile,
  WeeklyReport,
} from '../types';
import { logActivity } from '../utils/activityLog';
import {
  computeAtRiskAlerts,
  formatTimestamp,
  getOfficialWeeklyScoreByWeek,
  getStudentAttendanceSummary,
  getStudentAttitudeHistory,
  isStudentAccessibleToUser,
  parseTimestampMs,
} from '../utils/analyticsUtils';
import { getClassTheme } from '../utils/classTheme';
import { getTodayDateStr } from '../utils/dateUtils';
import { clampStr } from '../utils/payloadGuards';
import { downloadElementAsPdf } from '../utils/pdfExport';
import { calculateProgramEndDate, getStudentProgramProgress } from '../utils/programUtils';
import { AppleModalSheet } from './AppleGestures';
import { CertificateDocument } from './CertificateDocument';
import { ReportCardDocument } from './ReportCardDocument';

interface Props {
  student: Student | null;
  lang: LanguageMode;
  profile: UserProfile;
  reports: DailyReport[];
  weeklyReports: WeeklyReport[];
  testResults: TestResult[];
  studentNotes: StudentProfileNote[];
  scheduleRows: ScheduleRow[];
  thresholds: QualityThresholds;
  handledAlerts: HandledAlert[];
  reportCards: ReportCard[];
  certificates: CertificateRecord[];
  schoolSettings: SchoolSettings;
  onRegisterPrintView?: (node: React.ReactNode | null) => void;
  onClose: () => void;
}

export function StudentProfileModal({
  student,
  lang,
  profile,
  reports,
  weeklyReports,
  testResults,
  studentNotes,
  scheduleRows,
  thresholds,
  handledAlerts,
  reportCards,
  certificates,
  schoolSettings,
  onRegisterPrintView,
  onClose,
}: Props) {
  const today = getTodayDateStr();
  const [newNote, setNewNote] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [editingProgram, setEditingProgram] = useState(false);
  const [progMonthsDraft, setProgMonthsDraft] = useState<ProgramDurationMonths>(6);
  const [progStartDraft, setProgStartDraft] = useState(today);
  const [progEndDraft, setProgEndDraft] = useState(() => calculateProgramEndDate(today, 6));
  const [progError, setProgError] = useState('');
  const [previewDoc, setPreviewDoc] = useState<
    | { kind: 'reportCard'; card: ReportCard }
    | { kind: 'certificate'; cert: CertificateRecord }
    | null
  >(null);
  const previewSheetRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);

  const canAccess = useMemo(() => {
    if (!student) return false;
    return isStudentAccessibleToUser(student, profile, scheduleRows);
  }, [student, profile, scheduleRows]);

  const programProgress = useMemo(
    () => (student ? getStudentProgramProgress(student, today) : null),
    [student, today]
  );

  const studentReportCards = useMemo(() => {
    if (!student) return [];
    return reportCards
      .filter((rc) => rc.studentId === student.id)
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || b.version - a.version);
  }, [student, reportCards]);

  const studentCertificates = useMemo(() => {
    if (!student) return [];
    return certificates
      .filter((c) => c.studentId === student.id)
      .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || b.version - a.version);
  }, [student, certificates]);

  const weeklyHistory = useMemo(
    () => (student ? getOfficialWeeklyScoreByWeek(student.id, testResults) : []),
    [student, testResults]
  );

  const officialWeeklyOverall = useMemo(() => {
    if (!student) return null;
    const weeklyOnly = testResults.filter(
      (r) => r.studentId === student.id && r.testType === 'weekly'
    );
    if (weeklyOnly.length === 0) return null;
    return Math.round(
      weeklyOnly.reduce((s, r) => s + r.scorePercent, 0) / weeklyOnly.length
    );
  }, [student, testResults]);

  const secondaryDailyResults = useMemo(() => {
    if (!student) return [];
    return testResults
      .filter((r) => r.studentId === student.id && r.testType === 'daily')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12);
  }, [student, testResults]);

  const attitudeHistory = useMemo(
    () => (student ? getStudentAttitudeHistory(student.id, weeklyReports) : []),
    [student, weeklyReports]
  );

  const attendanceSummary = useMemo(() => {
    if (!student || !student.classId) {
      return { absentCount: 0, lateCount: 0, classReportDays: 0, attendanceRate: null };
    }
    const clsReports = reports.filter((r) => r.classId === student.classId);
    return getStudentAttendanceSummary(student.name, clsReports);
  }, [student, reports]);

  const activeAlerts = useMemo(() => {
    if (!student) return [];
    return computeAtRiskAlerts({
      students: [student],
      testResults,
      reports,
      weeklyReports,
      thresholds,
      handledAlerts,
    });
  }, [student, testResults, reports, weeklyReports, thresholds, handledAlerts]);

  const notesTimeline = useMemo(() => {
    if (!student) return [];
    const items: {
      id: string;
      source: 'coaching' | 'weekly' | 'daily';
      authorName: string;
      dateLabel: string;
      sortMs: number;
      text: string;
      canDelete: boolean;
      rawCoachingId?: string;
    }[] = [];

    studentNotes
      .filter((n) => n.studentId === student.id)
      .forEach((n) => {
        items.push({
          id: `coach-${n.id}`,
          source: 'coaching',
          authorName: n.authorName,
          dateLabel: formatTimestamp(n.createdAt),
          sortMs: parseTimestampMs(n.createdAt),
          text: n.note,
          canDelete: profile.role === 'head' || n.authorUid === profile.uid,
          rawCoachingId: n.id,
        });
      });

    weeklyReports.forEach((wr) => {
      const entry = (wr.studentEntries || []).find((se) => se.studentId === student.id);
      if (entry && (entry.comment || entry.progressNote)) {
        const combined = [entry.progressNote, entry.comment].filter(Boolean).join(' — ');
        items.push({
          id: `wr-${wr.id}`,
          source: 'weekly',
          authorName: wr.teacherName,
          dateLabel: wr.weekKey,
          sortMs: parseTimestampMs(wr.updatedAt) || parseTimestampMs(wr.createdAt),
          text: combined,
          canDelete: false,
        });
      }
    });

    reports.forEach((dr) => {
      (dr.studentNotes || [])
        .filter((sn) => sn.studentId === student.id || sn.studentName === student.name)
        .forEach((sn, idx) => {
          items.push({
            id: `dr-${dr.id}-${idx}`,
            source: 'daily',
            authorName: dr.teacherName,
            dateLabel: dr.date,
            sortMs: parseTimestampMs(dr.createdAt),
            text: sn.note,
            canDelete: false,
          });
        });
    });

    return items.sort((a, b) => b.sortMs - a.sortMs || b.dateLabel.localeCompare(a.dateLabel));
  }, [student, studentNotes, weeklyReports, reports, profile.role, profile.uid]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!student || !canAccess) return;
    const clean = clampStr(newNote, 1000);
    if (!clean) return;
    setBusy(true);
    try {
      await addDoc(collection(db, 'studentNotes'), {
        studentId: student.id,
        classId: student.classId,
        authorUid: profile.uid,
        authorName: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
        authorRole: profile.role,
        note: clean,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_create',
        targetType: 'student',
        targetLabel: student.name,
        detail: `Added coaching note: ${clean.slice(0, 60)}`,
      });
      setNewNote('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'studentNotes');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteNote = async (noteId: string) => {
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'studentNotes', noteId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `studentNotes/${noteId}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveTargetGoal = async () => {
    if (!student || !canAccess) return;
    const cleanGoal = clampStr(goalDraft, 120);
    setBusy(true);
    try {
      await updateDoc(doc(db, 'students', student.id), {
        targetGoal: cleanGoal,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: student.name,
        detail: `Updated exam target → ${cleanGoal || '(empty)'}`,
      });
      setEditingGoal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${student.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProgramDuration = async () => {
    if (!student || profile.role !== 'head') return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(progStartDraft) || !/^\d{4}-\d{2}-\d{2}$/.test(progEndDraft)) {
      setProgError(
        lang === 'id'
          ? 'Masukkan tanggal mulai dan tanggal selesai yang valid.'
          : '有効な開始日と終了日を入力してください。'
      );
      return;
    }
    if (progEndDraft < progStartDraft) {
      setProgError(
        lang === 'id'
          ? 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.'
          : '終了日は開始日以降の日付を指定してください。'
      );
      return;
    }
    setProgError('');
    setBusy(true);
    const prevSummary =
      student.programMonths && student.programStartDate
        ? `${student.programMonths}m (${student.programStartDate} 〜 ${student.programEndDate || '-'})`
        : 'Not set';
    try {
      await updateDoc(doc(db, 'students', student.id), {
        programMonths: progMonthsDraft,
        programStartDate: progStartDraft,
        programEndDate: progEndDraft,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'student',
        targetLabel: student.name,
        detail: `Program: ${prevSummary} → ${progMonthsDraft}m (${progStartDraft} 〜 ${progEndDraft})`,
      });
      setEditingProgram(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${student.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handlePrintPreview = () => {
    if (!previewDoc || !onRegisterPrintView) return;
    if (previewDoc.kind === 'reportCard') {
      onRegisterPrintView(
        <ReportCardDocument card={previewDoc.card} settings={schoolSettings} />
      );
    } else {
      onRegisterPrintView(
        <>
          <style>{`@media print { @page { size: A4 landscape; margin: 6mm; } }`}</style>
          <CertificateDocument certificate={previewDoc.cert} settings={schoolSettings} />
        </>
      );
    }
    window.setTimeout(() => window.print(), 120);
  };

  const handleDownloadPreviewPdf = async () => {
    if (!previewDoc || !previewSheetRef.current || !student) return;
    setBusy(true);
    try {
      const sheetEl = previewSheetRef.current.firstElementChild as HTMLElement | null;
      if (!sheetEl) return;
      if (previewDoc.kind === 'reportCard') {
        await downloadElementAsPdf(
          sheetEl,
          `${student.name}_${previewDoc.card.periodLabel}`,
          'portrait'
        );
      } else {
        await downloadElementAsPdf(
          sheetEl,
          `${previewDoc.cert.certificateNumber}_${student.name}`,
          'landscape'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const sTheme = student ? getClassTheme(student.classId) : null;
  const latestAttitude = attitudeHistory[attitudeHistory.length - 1] || null;

  return (
    <AnimatePresence>
      {student && (
        <AppleModalSheet open={Boolean(student)} onClose={onClose} maxWidthClass="max-w-4xl">
          <div className="overflow-y-auto flex-1 min-h-0">
            {/* Clean Apple Header (scrolls with profile content) */}
            <div className="px-6 py-5 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-[24px] sm:text-[28px] font-semibold tracking-[-0.02em] leading-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {student.name}
                  </h2>
                  {student.studentCode && (
                    <span className="px-2.5 py-0.5 text-[12px] font-mono rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                      {student.studentCode}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {sTheme && <span className={`w-2 h-2 rounded-full ${sTheme.dotColor}`} />}
                    <span>{classLabel(student.classId, lang)}</span>
                  </span>
                </div>

                {/* Exam Target Goal */}
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#6e6e73] dark:text-[#86868b]">
                  <Award className="w-3.5 h-3.5 shrink-0" />
                  <span>{lang === 'id' ? 'Target Ujian:' : '受験目標:'}</span>
                  {editingGoal ? (
                    <div className="inline-flex items-center gap-1.5">
                      <input
                        type="text"
                        maxLength={120}
                        value={goalDraft}
                        onChange={(e) => setGoalDraft(e.target.value)}
                        className="glass-input px-2.5 py-1 text-[12px] rounded-[8px] w-44"
                        placeholder="JLPT N4 / JFT A2"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={handleSaveTargetGoal}
                        className="p-1.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white"
                      >
                        <Save className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingGoal(false)}
                        className="p-1.5 rounded-full border border-[#d2d2d7] dark:border-[#424245]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {student.targetGoal || (lang === 'id' ? 'Belum ditetapkan' : '未設定')}
                      </span>
                      {canAccess && (
                        <button
                          type="button"
                          onClick={() => {
                            setGoalDraft(student.targetGoal || '');
                            setEditingGoal(true);
                          }}
                          className="p-1 text-[#0066cc] dark:text-[#2997ff] hover:opacity-75"
                          title={lang === 'id' ? 'Ubah target' : '目標を編集'}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-2 text-[#6e6e73] hover:text-[#1d1d1f] dark:text-[#86868b] dark:hover:text-[#f5f5f7] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                aria-label="Close student profile"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!canAccess ? (
              <div className="p-8 text-center text-[14px] text-[#dc2626] dark:text-[#ff453a]">
                {lang === 'id'
                  ? 'Anda hanya dapat melihat profil siswa di kelas yang Anda ajar.'
                  : '担当クラスの学生プロフィールのみ閲覧できます。'}
              </div>
            ) : (
              <div className="p-6 space-y-6">
              {/* Program Duration & Progress Indicator */}
              {programProgress && (
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[18px] p-4 space-y-2.5 border border-[#d2d2d7]/50 dark:border-[#424245]/60">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <Calendar className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
                      <span>
                        {lang === 'id' ? 'Durasi Program Studi' : '受講プログラム期間'}
                      </span>
                    </div>
                    {profile.role === 'head' && !editingProgram && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextMonths = (student.programMonths as ProgramDurationMonths) || 6;
                          const nextStart = student.programStartDate || today;
                          const nextEnd =
                            student.programEndDate || calculateProgramEndDate(nextStart, nextMonths);
                          setProgMonthsDraft(nextMonths);
                          setProgStartDraft(nextStart);
                          setProgEndDraft(nextEnd);
                          setProgError('');
                          setEditingProgram(true);
                        }}
                        className="inline-flex items-center gap-1 text-[12px] font-medium text-[#0066cc] dark:text-[#2997ff] hover:underline"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>{lang === 'id' ? 'Ubah Masa Belajar' : '受講期間を編集'}</span>
                      </button>
                    )}
                  </div>

                  {editingProgram && profile.role === 'head' ? (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b]">
                            {lang === 'id' ? 'Durasi Program' : 'コース期間'}
                          </span>
                          <select
                            value={progMonthsDraft}
                            onChange={(e) => {
                              const nextM = Number(e.target.value) as ProgramDurationMonths;
                              setProgMonthsDraft(nextM);
                              const autoEnd = calculateProgramEndDate(progStartDraft, nextM);
                              if (autoEnd) setProgEndDraft(autoEnd);
                              setProgError('');
                            }}
                            className="w-full glass-input px-3 py-1.5 text-[13px] rounded-[10px]"
                          >
                            <option value={2}>{lang === 'id' ? '2 Bulan' : '2か月コース'}</option>
                            <option value={4}>{lang === 'id' ? '4 Bulan' : '4か月コース'}</option>
                            <option value={6}>{lang === 'id' ? '6 Bulan' : '6か月コース'}</option>
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b]">
                            {lang === 'id' ? 'Tanggal Mulai' : '開始日'}
                          </span>
                          <input
                            type="date"
                            value={progStartDraft}
                            onChange={(e) => {
                              const nextS = e.target.value;
                              setProgStartDraft(nextS);
                              const autoEnd = calculateProgramEndDate(nextS, progMonthsDraft);
                              if (autoEnd) setProgEndDraft(autoEnd);
                              setProgError('');
                            }}
                            className="w-full glass-input px-3 py-1.5 text-[13px] font-mono tabular-nums rounded-[10px]"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="block text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b]">
                            {lang === 'id' ? 'Tanggal Selesai (Masa Belajar)' : '終了日（修了予定日）'}
                          </span>
                          <input
                            type="date"
                            value={progEndDraft}
                            min={progStartDraft || undefined}
                            onChange={(e) => {
                              setProgEndDraft(e.target.value);
                              setProgError('');
                            }}
                            className="w-full glass-input px-3 py-1.5 text-[13px] font-mono tabular-nums rounded-[10px]"
                          />
                        </label>
                      </div>
                      {progError && (
                        <div className="text-[12px] text-[#dc2626] dark:text-[#ff453a]">
                          {progError}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={handleSaveProgramDuration}
                          className="apple-btn-primary px-3.5 py-1.5 text-[12px] inline-flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" />
                          <span>{lang === 'id' ? 'Simpan' : '保存'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProgram(false);
                            setProgError('');
                          }}
                          className="px-3 py-1.5 text-[12px] rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b]"
                        >
                          {lang === 'id' ? 'Batal' : 'キャンセル'}
                        </button>
                      </div>
                    </div>
                  ) : programProgress.isConfigured && programProgress.valid ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                        <div className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] tabular-nums">
                          {programProgress.programMonths}{lang === 'id' ? ' Bulan' : 'か月プログラム'}{' '}
                          <span className="text-[#6e6e73] dark:text-[#86868b] font-mono text-[12px] ml-1.5">
                            ({lang === 'id' ? 'Masa belajar:' : '受講期間:'} {programProgress.startDate} 〜{' '}
                            {programProgress.endDate})
                          </span>
                        </div>
                        <div className="text-[12px] font-semibold tabular-nums text-[#0071e3] dark:text-[#2997ff]">
                          {programProgress.isCompleted
                            ? lang === 'id'
                              ? 'Program Selesai'
                              : 'プログラム修了'
                            : programProgress.isUpcoming
                            ? lang === 'id'
                              ? `Mulai ${programProgress.startDate}`
                              : `開始予定 ${programProgress.startDate}`
                            : lang === 'id'
                            ? `Bulan ${programProgress.currentMonth} dari ${programProgress.totalMonths} · Sisa ${programProgress.daysRemaining} hari`
                            : `${programProgress.totalMonths}か月中 ${programProgress.currentMonth}か月目 · 残り${programProgress.daysRemaining}日`}
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[#d2d2d7]/60 dark:bg-[#2c2c2e] overflow-hidden">
                        <div
                          style={{ width: `${programProgress.progressPercent}%` }}
                          className="h-full rounded-full bg-[#0071e3] dark:bg-[#2997ff] transition-all duration-300"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                      {lang === 'id'
                        ? 'Durasi program (2/4/6 bulan), tanggal mulai & tanggal selesai belum diatur oleh Admin.'
                        : '受講期間（2/4/6か月）および開始日・終了日がまだ設定されていません。'}
                    </div>
                  )}
                </div>
              )}

              {/* Active Alerts Strip */}
              {activeAlerts.length > 0 && (
                <div className="space-y-2">
                  {activeAlerts.map((al) => (
                    <div
                      key={al.id}
                      className={`rounded-[14px] px-4 py-3 border text-[13px] flex flex-wrap items-center justify-between gap-2 ${
                        al.handledRecord
                          ? 'bg-[#f5f5f7] dark:bg-[#161617] border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7]'
                          : 'bg-[#fef2f2] dark:bg-[#2c1517] border-[#fecaca] dark:border-[#7f1d1d] text-[#991b1b] dark:text-[#fca5a5]'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-medium">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{lang === 'id' ? al.reasonId : al.reasonJa}</span>
                      </div>
                      {al.handledRecord && (
                        <span className="text-[12px] text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                          {lang === 'id' ? 'Ditangani' : '対応済'} ({al.handledRecord.handledByName})
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 4 Apple Bento KPI Tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[18px] p-4">
                  <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'id' ? 'Ujian Mingguan (Resmi)' : '週次試験平均（公式）'}
                  </div>
                  <div className="text-[28px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                    {officialWeeklyOverall !== null ? `${officialWeeklyOverall}%` : '—'}
                  </div>
                </div>
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[18px] p-4">
                  <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'id' ? 'Sikap Terbaru' : '最新態度評価'}
                  </div>
                  <div className="text-[28px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                    {latestAttitude ? `${latestAttitude.attitudeScore}/5` : '—'}
                  </div>
                </div>
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[18px] p-4">
                  <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'id' ? 'Tingkat Kehadiran' : '出席率'}
                  </div>
                  <div className="text-[28px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                    {attendanceSummary.attendanceRate !== null
                      ? `${attendanceSummary.attendanceRate}%`
                      : '—'}
                  </div>
                </div>
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[18px] p-4">
                  <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    {lang === 'id' ? 'Absen / Terlambat' : '欠席 / 遅刻'}
                  </div>
                  <div className="text-[28px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                    {attendanceSummary.absentCount} / {attendanceSummary.lateCount}
                  </div>
                </div>
              </div>

              {/* Official Weekly Exam History Chart (Monochrome + Single Blue Accent) */}
              <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[20px] p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <TrendingUp className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
                    <span>
                      {lang === 'id'
                        ? 'Riwayat Nilai Ujian Mingguan (Skor Resmi)'
                        : '週次試験 成績推移（公式スコア）'}
                    </span>
                  </div>
                  <span className="text-[12px] tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                    {weeklyHistory.length} {lang === 'id' ? 'minggu' : '週分'}
                  </span>
                </div>

                {weeklyHistory.length === 0 ? (
                  <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] py-4 text-center">
                    {lang === 'id'
                      ? 'Belum ada data nilai Ujian Mingguan.'
                      : '週次試験の記録がまだありません。'}
                  </div>
                ) : (
                  <div className="flex items-end gap-2.5 h-36 pt-4 pb-1 border-b border-[#d2d2d7]/70 dark:border-[#424245] overflow-x-auto">
                    {weeklyHistory.slice(-10).map((wk) => (
                      <div
                        key={wk.weekKey}
                        className="flex-1 min-w-[44px] flex flex-col items-center justify-end h-full gap-1.5"
                      >
                        <span className="text-[12px] font-medium tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {wk.avgScore}%
                        </span>
                        <div className="w-full max-w-[28px] bg-[#d2d2d7]/40 dark:bg-[#2c2c2e] rounded-t-[6px] h-20 flex items-end overflow-hidden">
                          <div
                            style={{ height: `${Math.max(8, wk.avgScore)}%` }}
                            className={`w-full rounded-t-[5px] ${
                              wk.avgScore >= 70
                                ? 'bg-[#0071e3] dark:bg-[#2997ff]'
                                : 'bg-[#86868b]'
                            }`}
                          />
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b] truncate max-w-full">
                          {wk.weekKey.slice(5)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Attitude Score History & Supporting Daily Test Results */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Attitude History */}
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[20px] p-4 space-y-3">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <Star className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b]" />
                    <span>
                      {lang === 'id' ? 'Riwayat Penilaian Sikap (1–5)' : '学習態度の推移（1〜5）'}
                    </span>
                  </div>
                  {attitudeHistory.length === 0 ? (
                    <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] py-3">
                      {lang === 'id'
                        ? 'Belum ada penilaian sikap dari Laporan Mingguan.'
                        : '週報からの態度評価はまだありません。'}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                      {[...attitudeHistory].reverse().map((ah) => (
                        <div
                          key={ah.weekKey}
                          className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[12px] p-3 text-[12px] space-y-1"
                        >
                          <div className="flex items-center justify-between font-mono tabular-nums">
                            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {ah.weekKey}
                            </span>
                            <span className="font-semibold text-[#0071e3] dark:text-[#2997ff]">
                              {ah.attitudeScore} / 5
                            </span>
                          </div>
                          {(ah.subAttendance ||
                            ah.subDiscipline ||
                            ah.subEffort ||
                            ah.subCooperation) && (
                            <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b] flex flex-wrap gap-2">
                              <span>
                                {lang === 'id' ? 'Hadir' : '出席'}: {ah.subAttendance ?? '-'}
                              </span>
                              <span>
                                {lang === 'id' ? 'Disiplin' : '規律'}: {ah.subDiscipline ?? '-'}
                              </span>
                              <span>
                                {lang === 'id' ? 'Usaha' : '意欲'}: {ah.subEffort ?? '-'}
                              </span>
                              <span>
                                {lang === 'id' ? 'Kerjasama' : '協調'}: {ah.subCooperation ?? '-'}
                              </span>
                            </div>
                          )}
                          {ah.attitudeNote && (
                            <div className="text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {ah.attitudeNote}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Secondary Supporting Daily Test Scores (never used for ranking) */}
                <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[20px] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <BookOpen className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b]" />
                      <span>
                        {lang === 'id'
                          ? 'Tes Harian (Data Pendukung)'
                          : '日次小テスト（参考データ）'}
                      </span>
                    </div>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                      {lang === 'id' ? 'Non-Ranking' : '順位対象外'}
                    </span>
                  </div>
                  {secondaryDailyResults.length === 0 ? (
                    <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] py-3">
                      {lang === 'id'
                        ? 'Belum ada catatan tes harian.'
                        : '日次小テストの記録はありません。'}
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {secondaryDailyResults.map((dr) => (
                        <div
                          key={dr.id}
                          className="flex items-center justify-between gap-2 bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[12px] px-3 py-2 text-[12px]"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                              {dr.testTitle}
                            </div>
                            <div className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                              {dr.date}
                            </div>
                          </div>
                          <span className="font-mono tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] shrink-0">
                            {dr.scorePercent}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Attendance Note & Sensei/Admin Notes Timeline */}
              <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[20px] p-4 space-y-3">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  <CalendarCheck className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b]" />
                  <span>
                    {lang === 'id'
                      ? 'Catatan Sensei, Laporan & Pembinaan'
                      : '指導メモ・報告書コメント履歴'}
                  </span>
                </div>

                <form onSubmit={handleAddNote} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required
                    maxLength={1000}
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={
                      lang === 'id'
                        ? 'Tambah catatan pembinaan / observasi siswa...'
                        : '学生への指導メモ・所見を追加...'
                    }
                    className="flex-1 glass-input px-3.5 py-2 text-[13px] rounded-[12px]"
                  />
                  <button
                    type="submit"
                    disabled={busy || !newNote.trim()}
                    className="apple-btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 text-[12px] disabled:opacity-40 shrink-0"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'Tambah Catatan' : 'メモ追加'}</span>
                  </button>
                </form>

                {notesTimeline.length === 0 ? (
                  <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] py-2">
                    {lang === 'id'
                      ? 'Belum ada catatan pembinaan atau komentar laporan.'
                      : 'まだ指導メモ・コメントはありません。'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {notesTimeline.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[12px] p-3 text-[13px] flex items-start justify-between gap-3"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {item.authorName}
                            </span>
                            <span className="px-2 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                              {item.source === 'coaching'
                                ? lang === 'id'
                                  ? 'Catatan Profil'
                                  : '個別メモ'
                                : item.source === 'weekly'
                                ? lang === 'id'
                                  ? 'Mingguan'
                                  : '週報'
                                : lang === 'id'
                                ? 'Harian'
                                : '日報'}
                            </span>
                            <span className="font-mono text-[#6e6e73] dark:text-[#86868b]">
                              {item.dateLabel}
                            </span>
                          </div>
                          <div className="text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-line">
                            {item.text}
                          </div>
                        </div>
                        {item.canDelete && item.rawCoachingId && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleDeleteNote(item.rawCoachingId!)}
                            className="p-1.5 text-[#6e6e73] hover:text-[#dc2626] dark:text-[#86868b] dark:hover:text-[#ff453a] shrink-0"
                            aria-label="Delete note"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Documents Section: Report Cards & Certificates */}
              <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[20px] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <FileText className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
                    <span>
                      {lang === 'id'
                        ? 'Dokumen Resmi (Rapor & Sertifikat)'
                        : '書類・成績通知表・修了証書'}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                    {studentReportCards.length + studentCertificates.length}{' '}
                    {lang === 'id' ? 'dokumen' : '件'}
                  </span>
                </div>

                {studentReportCards.length === 0 && studentCertificates.length === 0 ? (
                  <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] py-2">
                    {lang === 'id'
                      ? 'Belum ada rapor atau sertifikat yang diterbitkan untuk siswa ini.'
                      : 'この学生の成績通知表・修了証書はまだ作成されていません。'}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {studentCertificates.map((cert) => (
                      <div
                        key={cert.id}
                        className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[12px] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {lang === 'id' ? 'Sertifikat Kelulusan' : '修了証書'} ({cert.programMonths}
                              {lang === 'id' ? ' Bln' : 'か月'})
                            </span>
                            <span className="font-mono text-[11px] text-[#0066cc] dark:text-[#2997ff]">
                              {cert.certificateNumber}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                cert.status === 'valid'
                                  ? 'bg-[#16a34a]/10 text-[#15803d] dark:text-[#30d158]'
                                  : cert.status === 'revoked'
                                  ? 'bg-[#dc2626]/10 text-[#dc2626] dark:text-[#ff453a]'
                                  : 'bg-[#6e6e73]/12 text-[#6e6e73] dark:text-[#86868b]'
                              }`}
                            >
                              {cert.status === 'valid'
                                ? lang === 'id'
                                  ? 'Sah'
                                  : '有効'
                                : cert.status === 'revoked'
                                ? lang === 'id'
                                  ? 'Dicabut'
                                  : '失効'
                                : lang === 'id'
                                ? 'Diganti'
                                : '再発行済'}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                            {lang === 'id' ? 'Terbit:' : '発行日:'} {cert.issueDate} · v{cert.version}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewDoc({ kind: 'certificate', cert })}
                          className="apple-btn-secondary inline-flex items-center gap-1 px-3 py-1 text-[11px]"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{lang === 'id' ? 'Lihat / PDF' : 'プレビュー・PDF'}</span>
                        </button>
                      </div>
                    ))}

                    {studentReportCards.map((rc) => (
                      <div
                        key={rc.id}
                        className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[12px] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {rc.periodType === 'final'
                                ? lang === 'id'
                                  ? 'Rapor Akhir'
                                  : '最終成績通知表'
                                : lang === 'id'
                                ? 'Rapor'
                                : '成績通知表'}{' '}
                              · {rc.periodLabel}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                              {rc.status === 'finalized'
                                ? lang === 'id'
                                  ? 'Final'
                                  : '確定済'
                                : rc.status === 'waiting_approval'
                                ? lang === 'id'
                                  ? 'Menunggu ACC'
                                  : '承認待ち'
                                : rc.status === 'superseded'
                                ? lang === 'id'
                                  ? 'Riwayat Lama'
                                  : '旧版'
                                : lang === 'id'
                                ? 'Draf'
                                : '下書き'}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                            {rc.overallCombinedAvg !== null ? `${rc.overallCombinedAvg}% (${rc.overallGradeLabel})` : '—'} · {rc.issueDate} · v{rc.version}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewDoc({ kind: 'reportCard', card: rc })}
                          className="apple-btn-secondary inline-flex items-center gap-1 px-3 py-1 text-[11px]"
                        >
                          <Eye className="w-3 h-3" />
                          <span>{lang === 'id' ? 'Lihat / PDF' : 'プレビュー・PDF'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          </div>

          {/* Inline Document Preview Overlay inside Student Profile Modal */}
          {previewDoc && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] rounded-[20px] max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
                <div className="px-5 py-3.5 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {previewDoc.kind === 'reportCard'
                      ? `${previewDoc.card.studentName} — ${previewDoc.card.periodLabel}`
                      : `${previewDoc.cert.certificateNumber} — ${previewDoc.cert.studentName}`}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handleDownloadPreviewPdf}
                      className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{lang === 'id' ? 'Unduh PDF' : 'PDF保存'}</span>
                    </button>
                    {onRegisterPrintView && (
                      <button
                        type="button"
                        onClick={handlePrintPreview}
                        className="apple-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>{lang === 'id' ? 'Cetak' : '印刷'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(null)}
                      className="p-1.5 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-[#6e6e73]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="p-4 sm:p-6 overflow-auto bg-[#f5f5f7] dark:bg-black flex justify-center">
                  <div ref={previewSheetRef} className="shadow-lg">
                    {previewDoc.kind === 'reportCard' ? (
                      <ReportCardDocument card={previewDoc.card} settings={schoolSettings} />
                    ) : (
                      <CertificateDocument
                        certificate={previewDoc.cert}
                        settings={schoolSettings}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </AppleModalSheet>
      )}
    </AnimatePresence>
  );
}
