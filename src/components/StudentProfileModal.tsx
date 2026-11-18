import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  BookOpen,
  CalendarCheck,
  Edit3,
  MessageSquarePlus,
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
  DailyReport,
  HandledAlert,
  LanguageMode,
  QualityThresholds,
  ScheduleRow,
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
import { CLASS_THEMES } from '../utils/classTheme';
import { clampStr } from '../utils/payloadGuards';
import { AppleModalSheet } from './AppleGestures';

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
  onClose,
}: Props) {
  const [newNote, setNewNote] = useState('');
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const canAccess = useMemo(() => {
    if (!student) return false;
    return isStudentAccessibleToUser(student, profile, scheduleRows);
  }, [student, profile, scheduleRows]);

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
    if (!student) return { absentCount: 0, lateCount: 0, classReportDays: 0, attendanceRate: null };
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

  const sTheme = student ? CLASS_THEMES[student.classId] : null;
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
                  {sTheme && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]">
                      <span className={`w-2 h-2 rounded-full ${sTheme.dotColor}`} />
                      <span>{classLabel(student.classId, lang)}</span>
                    </span>
                  )}
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
            </div>
          )}
          </div>
        </AppleModalSheet>
      )}
    </AnimatePresence>
  );
}
