import React, { useMemo, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpDown,
  ArrowUpRight,
  Award,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  MessageSquare,
  Printer,
  RotateCcw,
  Settings2,
  ShieldAlert,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { categoryLabel, classLabel, tr, UI_TEXT } from '../i18n';
import {
  Announcement,
  AnnouncementRead,
  ApprovalStatus,
  CertificateRecord,
  ClassId,
  CLASSES,
  DailyReport,
  HandledAlert,
  LanguageMode,
  QualityThresholds,
  QuestionItem,
  ReportCard,
  ScheduleDoc,
  SchoolSettings,
  Student,
  TestResult,
  TestType,
  UserProfile,
  WeeklyReport,
} from '../types';
import { logActivity } from '../utils/activityLog';
import {
  buildWeeklyRankingRows,
  computeAtRiskAlerts,
  ComputedStudentAlert,
  effectiveQuestionStatus,
  RankingMetric,
} from '../utils/analyticsUtils';
import { CLASS_THEMES, getClassTheme } from '../utils/classTheme';
import { getTodayDateStr, getWeekKey } from '../utils/dateUtils';
import { clampNum, clampStr } from '../utils/payloadGuards';
import { checkCertificateEligibility, getStudentProgramProgress } from '../utils/programUtils';
import {
  approvalLabel,
  compileDailyExportData,
  compileWeeklyExportData,
  DailyExportBundle,
  exportDailyReportCsv,
  exportDailyReportXlsx,
  exportWeeklyReportCsv,
  exportWeeklyReportXlsx,
  ExportScopeType,
  WeeklyExportBundle,
} from '../utils/reportExport';
import { AnimatedCounter, EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import { AnnouncementsPanel } from './AnnouncementsPanel';
import { AppleModalSheet, AppleScrollReveal } from './AppleGestures';
import { WallBoardModal } from './WallBoardModal';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  reports: DailyReport[];
  weeklyReports: WeeklyReport[];
  testResults: TestResult[];
  questions: QuestionItem[];
  staffUsers: UserProfile[];
  announcements: Announcement[];
  announcementReads: AnnouncementRead[];
  thresholds: QualityThresholds;
  handledAlerts: HandledAlert[];
  scheduleDoc: ScheduleDoc | null;
  reportCards: ReportCard[];
  certificates: CertificateRecord[];
  schoolSettings: SchoolSettings;
  onNavigateTab: (
    tab:
      | 'monitoring'
      | 'report'
      | 'bank'
      | 'grading'
      | 'roster'
      | 'schedule'
      | 'journal'
      | 'users'
      | 'reportCards'
      | 'settings'
  ) => void;
  onOpenPendingQuestions: () => void;
  onSelectStudent: (stu: Student) => void;
  onRegisterPrintView: (node: React.ReactNode | null) => void;
}

const WEEKDAY_KEYWORDS: Record<number, string[]> = {
  0: ['日', 'minggu', 'sun'],
  1: ['月', 'senin', 'mon'],
  2: ['火', 'selasa', 'tue'],
  3: ['水', 'rabu', 'wed'],
  4: ['木', 'kamis', 'thu'],
  5: ['金', 'jumat', 'fri'],
  6: ['土', 'sabtu', 'sat'],
};

const CLASS_MATCHERS: Record<ClassId, string[]> = {
  hokkaido: ['hokkaido', '北海道'],
  saitama: ['saitama', '埼玉'],
  nara: ['nara', '奈良'],
  kaigo: ['kaigo', '介護'],
};

export function HeadDashboard({
  lang,
  profile,
  students,
  reports,
  weeklyReports,
  testResults,
  questions,
  staffUsers,
  announcements,
  announcementReads,
  thresholds,
  handledAlerts,
  scheduleDoc,
  reportCards,
  certificates,
  schoolSettings,
  onNavigateTab,
  onOpenPendingQuestions,
  onSelectStudent,
  onRegisterPrintView,
}: Props) {
  const today = getTodayDateStr();
  const [selectedClass, setSelectedClass] = useState<ClassId | 'all'>('all');
  const [recapPeriod, setRecapPeriod] = useState<TestType>('weekly');
  const [recapSenseiFilter, setRecapSenseiFilter] = useState<string>('all');
  const [recapDateFilter, setRecapDateFilter] = useState<string>('');
  const [reportDateFilter, setReportDateFilter] = useState<string>('');
  const [approvalFilter, setApprovalFilter] = useState<ApprovalStatus | 'all'>('all');
  const [studentSearch, setStudentSearch] = useState<string>('');
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});
  const [savingReportId, setSavingReportId] = useState<string | null>(null);
  const [reviewSavedNotice, setReviewSavedNotice] = useState<Record<string, string>>({});
  const [showAllReports, setShowAllReports] = useState<boolean>(false);

  // At-Risk Alerts & Threshold Modal state
  const [showHandledAlerts, setShowHandledAlerts] = useState(false);
  const [handlingAlertId, setHandlingAlertId] = useState<string | null>(null);
  const [handleAlertNote, setHandleAlertNote] = useState('');
  const [thresholdModalOpen, setThresholdModalOpen] = useState(false);
  const [thDraft, setThDraft] = useState<QualityThresholds>(thresholds);
  const [savingQuality, setSavingQuality] = useState(false);

  // Official Weekly Exam Ranking & Printable Wall Board state
  const [rankingWeekFilter, setRankingWeekFilter] = useState<string>('');
  const [rankingMetric, setRankingMetric] = useState<RankingMetric>('weekly_exam');
  const [rankingSortKey, setRankingSortKey] = useState<
    'default' | 'weeklyScore' | 'trendDelta' | 'attitudeScore' | 'attendanceRate' | 'combinedScore'
  >('default');
  const [rankingSortAsc, setRankingSortAsc] = useState(false);
  const [wallBoardOpen, setWallBoardOpen] = useState(false);
  const [wallClass, setWallClass] = useState<ClassId | 'all'>('all');

  // Record-keeping Export state (Daily / Weekly CSV & PDF)
  const [exportScope, setExportScope] = useState<ExportScopeType>('daily');
  const [exportDateFilter, setExportDateFilter] = useState<string>(''); // '' = all dates
  const [exportWeekFilter, setExportWeekFilter] = useState<string>(''); // '' = all weeks
  const [exportToast, setExportToast] = useState<string>('');
  const [pdfPreview, setPdfPreview] = useState<
    | { scope: 'daily'; daily: DailyExportBundle; subtitle: string }
    | { scope: 'weekly'; weekly: WeeklyExportBundle; subtitle: string }
    | null
  >(null);

  const pendingQuestionsCount = useMemo(
    () => questions.filter((q) => effectiveQuestionStatus(q) === 'pending').length,
    [questions]
  );

  // At-Risk Student Alerts (based on Weekly Exam score drop/low avg + absences + attitude)
  const allAlerts = useMemo(
    () =>
      computeAtRiskAlerts({
        students,
        testResults,
        reports,
        weeklyReports,
        thresholds,
        handledAlerts,
      }),
    [students, testResults, reports, weeklyReports, thresholds, handledAlerts]
  );

  const visibleAlerts = useMemo(() => {
    return allAlerts
      .filter((a) => (selectedClass === 'all' ? true : a.student.classId === selectedClass))
      .filter((a) => (showHandledAlerts ? true : !a.handledRecord));
  }, [allAlerts, selectedClass, showHandledAlerts]);

  const unhandledAlertsCount = useMemo(
    () => allAlerts.filter((a) => !a.handledRecord).length,
    [allAlerts]
  );

  // Report Card & Certificate Dashboard Widgets
  const waitingApprovalCardsCount = useMemo(
    () => reportCards.filter((rc) => rc.status === 'waiting_approval').length,
    [reportCards]
  );

  const unassignedCount = useMemo(
    () => students.filter((s) => !s.classId).length,
    [students]
  );

  const finishingSoonStudents = useMemo(
    () =>
      students
        .filter((s) => s.active && Boolean(s.classId))
        .map((s) => ({ student: s, prog: getStudentProgramProgress(s, today) }))
        .filter((x) => x.prog.finishingSoon30Days)
        .sort((a, b) => a.prog.daysRemaining - b.prog.daysRemaining),
    [students, today]
  );

  const readyCertificatesCount = useMemo(() => {
    const validCertStudentIds = new Set(
      certificates.filter((c) => c.status === 'valid').map((c) => c.studentId)
    );
    return students.filter((stu) => {
      if (!stu.active || !stu.classId) return false;
      if (validCertStudentIds.has(stu.id)) return false;
      const elig = checkCertificateEligibility({
        student: stu,
        allStudents: students,
        testResults,
        dailyReports: reports,
        weeklyReports,
        schoolSettings,
        qualityThresholds: thresholds,
        todayStr: today,
      });
      return elig.configured && elig.eligible;
    }).length;
  }, [students, certificates, testResults, reports, weeklyReports, schoolSettings, thresholds, today]);

  // 1. 4-Class Widget Cards (Today's Schedule + Daily Report Status + Latest Test Average)
  const todayWeekdayKeywords = WEEKDAY_KEYWORDS[new Date().getDay()] || [];
  const classCards = useMemo(() => {
    const scheduleRows = scheduleDoc?.rows || [];
    return CLASSES.map((cls) => {
      const clsStudents = students.filter((s) => s.classId === cls.id && s.active);
      const todayReport = reports.find((r) => r.classId === cls.id && r.date === today);
      const clsWeeklyResults = testResults.filter(
        (t) => t.classId === cls.id && t.testType === 'weekly'
      );
      const clsFallbackResults =
        clsWeeklyResults.length > 0
          ? clsWeeklyResults
          : testResults.filter((t) => t.classId === cls.id);
      const latestDate =
        clsFallbackResults.length > 0
          ? [...clsFallbackResults].sort((a, b) => b.date.localeCompare(a.date))[0].date
          : null;
      const latestResults = latestDate
        ? clsFallbackResults.filter((r) => r.date === latestDate)
        : [];
      const latestAvgScore =
        latestResults.length > 0
          ? Math.round(
              latestResults.reduce((s, r) => s + r.scorePercent, 0) / latestResults.length
            )
          : null;

      const matchers = CLASS_MATCHERS[cls.id];
      const todaySchedule = scheduleRows.filter((row) => {
        const dayLower = (row.day || '').trim().toLowerCase();
        const classLower = (row.className || '').trim().toLowerCase();
        if (!dayLower || !classLower) return false;
        const matchesDay = todayWeekdayKeywords.some((kw) => dayLower.includes(kw));
        const matchesClass = matchers.some((m) => classLower.includes(m));
        return matchesDay && matchesClass;
      });

      return {
        cls,
        studentCount: clsStudents.length,
        todayReport,
        latestAvgScore,
        latestDate,
        resultCount: clsFallbackResults.length,
        isOfficialWeekly: clsWeeklyResults.length > 0,
        todaySchedule,
      };
    });
  }, [students, reports, testResults, scheduleDoc, today, todayWeekdayKeywords]);

  // 2. Filtered Test Results for Recap
  const filteredResults = useMemo(() => {
    return testResults.filter((r) => {
      if (selectedClass !== 'all' && r.classId !== selectedClass) return false;
      if (r.testType !== recapPeriod) return false;
      if (recapSenseiFilter !== 'all' && r.gradedBy !== recapSenseiFilter) return false;
      if (recapDateFilter && r.date !== recapDateFilter) return false;
      return true;
    });
  }, [testResults, selectedClass, recapPeriod, recapSenseiFilter, recapDateFilter]);

  // 3. Time-series Recap (grouped by date for daily, weekKey for weekly)
  const periodSeries = useMemo(() => {
    const map = new Map<string, { sum: number; count: number; pass: number }>();
    filteredResults.forEach((r) => {
      const key = recapPeriod === 'daily' ? r.date : r.weekKey;
      const curr = map.get(key) || { sum: 0, count: 0, pass: 0 };
      curr.sum += r.scorePercent;
      curr.count += 1;
      if (r.scorePercent >= 70) curr.pass += 1;
      map.set(key, curr);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-10)
      .map(([label, stats]) => ({
        label,
        avg: Math.round(stats.sum / stats.count),
        count: stats.count,
        passRate: Math.round((stats.pass / stats.count) * 100),
      }));
  }, [filteredResults, recapPeriod]);

  // 4. Weak-Point Analysis (from wrongCategories)
  const weakPoints = useMemo(() => {
    const counts = new Map<string, number>();
    const relevant = testResults.filter((r) =>
      selectedClass === 'all' ? true : r.classId === selectedClass
    );
    relevant.forEach((r) => {
      (r.wrongCategories || []).forEach((cat) => {
        counts.set(cat, (counts.get(cat) || 0) + 1);
      });
    });
    const totalWrong = Array.from(counts.values()).reduce((a, b) => a + b, 0) || 1;
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([cat, count]) => ({
        cat,
        count,
        share: Math.round((count / totalWrong) * 100),
      }));
  }, [testResults, selectedClass]);

  // 5. Official Weekly Exam Student Ranking & Progress Summary (WEEKLY EXAM ONLY as primary)
  const baseRankingRows = useMemo(() => {
    return buildWeeklyRankingRows({
      students,
      testResults,
      weeklyReports,
      reports,
      thresholds,
      classFilter: selectedClass,
      weekFilter: rankingWeekFilter,
      metric: rankingMetric,
    });
  }, [
    students,
    testResults,
    weeklyReports,
    reports,
    thresholds,
    selectedClass,
    rankingWeekFilter,
    rankingMetric,
  ]);

  const wallBoardRows = useMemo(() => {
    return buildWeeklyRankingRows({
      students,
      testResults,
      weeklyReports,
      reports,
      thresholds,
      classFilter: wallClass,
      weekFilter: rankingWeekFilter,
      metric: rankingMetric,
    });
  }, [
    students,
    testResults,
    weeklyReports,
    reports,
    thresholds,
    wallClass,
    rankingWeekFilter,
    rankingMetric,
  ]);

  const displayedRankingRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    const filtered = baseRankingRows.filter((row) =>
      !q ? true : row.student.name.toLowerCase().includes(q)
    );
    if (rankingSortKey === 'default') return filtered;
    return [...filtered].sort((a, b) => {
      const getVal = (r: (typeof filtered)[number]): number => {
        const v = r[rankingSortKey];
        return typeof v === 'number' ? v : -9999;
      };
      const diff = getVal(b) - getVal(a);
      return rankingSortAsc ? -diff : diff;
    });
  }, [baseRankingRows, studentSearch, rankingSortKey, rankingSortAsc]);

  const toggleRankingSort = (
    key: 'weeklyScore' | 'trendDelta' | 'attitudeScore' | 'attendanceRate' | 'combinedScore'
  ) => {
    if (rankingSortKey === key) {
      setRankingSortAsc((v) => !v);
    } else {
      setRankingSortKey(key);
      setRankingSortAsc(false);
    }
  };

  const handleMarkAlertHandled = async (alert: ComputedStudentAlert) => {
    if (!alert.student.classId) return;
    setSavingQuality(true);
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const handlerName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
    try {
      await setDoc(doc(db, 'handledAlerts', alert.id), {
        studentId: alert.student.id,
        studentName: clampStr(alert.student.name, 120),
        classId: alert.student.classId,
        alertKey: alert.alertKey,
        reasonSummary: clampStr(lang === 'id' ? alert.reasonId : alert.reasonJa, 300),
        note: clampStr(handleAlertNote, 500),
        handledBy: profile.uid,
        handledByName: handlerName,
        handledAt: nowStr,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'alert_handle',
        targetType: 'alert',
        targetLabel: `${alert.student.name} (${alert.alertKey})`,
        detail: clampStr(handleAlertNote, 200) || 'Marked alert as handled',
      });
      setHandlingAlertId(null);
      setHandleAlertNote('');
      showExportToast(
        lang === 'id'
          ? `Alert untuk ${alert.student.name} ditandai sudah ditangani`
          : `${alert.student.name} のアラートを対応済にしました`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `handledAlerts/${alert.id}`);
    } finally {
      setSavingQuality(false);
    }
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingQuality(true);
    const examW = clampNum(thDraft.examWeightPercent, 0, 100);
    const attW = clampNum(thDraft.attitudeWeightPercent, 0, 100);
    try {
      await setDoc(doc(db, 'qualitySettings', 'default'), {
        minWeeklyAvgThreshold: clampNum(thDraft.minWeeklyAvgThreshold, 0, 100),
        consecutiveDropWeeks: clampNum(thDraft.consecutiveDropWeeks, 1, 6),
        maxAbsentDays: clampNum(thDraft.maxAbsentDays, 1, 30),
        minAttitudeThreshold: clampNum(Number(thDraft.minAttitudeThreshold), 1, 5),
        examWeightPercent: examW,
        attitudeWeightPercent: attW,
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'threshold_update',
        targetType: 'settings',
        targetLabel: 'Quality & Alert Thresholds',
        detail: `MinWeeklyAvg:${thDraft.minWeeklyAvgThreshold}%, Drop:${thDraft.consecutiveDropWeeks}w, Abs:${thDraft.maxAbsentDays}, Att:${thDraft.minAttitudeThreshold}`,
      });
      setThresholdModalOpen(false);
      showExportToast(
        lang === 'id' ? 'Kriteria peringatan diperbarui' : 'アラート判定基準を保存しました'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'qualitySettings/default');
    } finally {
      setSavingQuality(false);
    }
  };

  // 6. Filtered Daily Reports Feed & Approval Counts
  const { pendingCount, revisionCount, approvedCount } = useMemo(() => {
    let pending = 0;
    let revision = 0;
    let approved = 0;
    reports.forEach((r) => {
      const st = r.approvalStatus || 'pending';
      if (st === 'approved') approved += 1;
      else if (st === 'revision_needed') revision += 1;
      else pending += 1;
    });
    return { pendingCount: pending, revisionCount: revision, approvedCount: approved };
  }, [reports]);

  const filteredReports = useMemo(() => {
    return [...reports]
      .filter((r) => (selectedClass === 'all' ? true : r.classId === selectedClass))
      .filter((r) => (!reportDateFilter ? true : r.date === reportDateFilter))
      .filter((r) =>
        approvalFilter === 'all' ? true : (r.approvalStatus || 'pending') === approvalFilter
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [reports, selectedClass, reportDateFilter, approvalFilter]);

  const handleReviewReport = async (report: DailyReport, nextStatus: ApprovalStatus) => {
    setSavingReportId(report.id);
    const draft =
      feedbackDrafts[report.id] !== undefined
        ? feedbackDrafts[report.id]
        : report.headFeedback || '';
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const hasFeedbackText = draft.trim().length > 0;

    try {
      await updateDoc(doc(db, 'dailyReports', report.id), {
        approvalStatus: nextStatus,
        headFeedback: clampStr(draft, 1500),
        approvedBy: clampStr(profile.nickname || profile.displayName, 100) || 'Head',
        approvedAt: nowStr,
        commentedAt: hasFeedbackText ? nowStr : report.commentedAt || '',
        commentReadByTeacher: hasFeedbackText ? false : report.commentReadByTeacher ?? true,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'report_review',
        targetType: 'report',
        targetLabel: `${report.classId} (${report.date})`,
        detail: `${nextStatus === 'approved' ? 'Approved' : 'Returned for revision'} — ${
          report.teacherName
        }`,
      });
      const msg =
        nextStatus === 'approved'
          ? lang === 'id'
            ? 'Disimpan sebagai Disetujui (Approved)'
            : '承認済みとして保存しました'
          : lang === 'id'
          ? 'Dikembalikan untuk Revisi ke sensei'
          : '差し戻し（要修正）として送信しました';
      setReviewSavedNotice((prev) => ({ ...prev, [report.id]: msg }));
      setTimeout(() => {
        setReviewSavedNotice((prev) => {
          const next = { ...prev };
          delete next[report.id];
          return next;
        });
      }, 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `dailyReports/${report.id}`);
    } finally {
      setSavingReportId(null);
    }
  };

  // Available dates & weeks for Daily / Weekly Export dropdowns
  const availableDates = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => set.add(r.date));
    testResults.forEach((t) => set.add(t.date));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [reports, testResults]);

  const availableWeeks = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => set.add(getWeekKey(r.date)));
    testResults.forEach((t) => set.add(t.weekKey));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [reports, testResults]);

  const effectiveDailyDate = exportDateFilter;

  const dailyBundle = useMemo(
    () =>
      compileDailyExportData({
        reports,
        testResults,
        selectedClass,
        dateFilter: effectiveDailyDate,
      }),
    [reports, testResults, selectedClass, effectiveDailyDate]
  );

  const weeklyBundle = useMemo(
    () =>
      compileWeeklyExportData({
        reports,
        testResults,
        selectedClass,
        weekFilter: exportWeekFilter,
      }),
    [reports, testResults, selectedClass, exportWeekFilter]
  );

  const showExportToast = (msg: string) => {
    setExportToast(msg);
    setTimeout(() => setExportToast(''), 3500);
  };

  const renderDailyPdfSheet = (bundle: DailyExportBundle, subtitle: string) => (
    <div className="print-sheet bg-white text-black p-4 sm:p-6 space-y-5 text-xs">
      <div className="border-b-2 border-slate-900 pb-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-slate-600">
            元気アカデミー · GENKI ACADEMY — 公式記録レポート / ARSIP RESMI SEKOLAH
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            {lang === 'ja'
              ? '日次運営・学習レポート'
              : lang === 'id'
              ? 'Laporan Harian Operasional & Akademik'
              : '日次運営・学習レポート / LAPORAN HARIAN SEKOLAH'}
          </h2>
          <div className="text-[11px] font-mono text-slate-600 mt-0.5">{subtitle}</div>
        </div>
        <div className="text-[11px] text-right text-slate-700 font-mono">
          <div>
            出力日 / Tgl Cetak: <span className="font-semibold">{today}</span>
          </div>
          <div>
            作成 / Oleh: <span className="font-semibold">{profile.nickname || profile.displayName}</span>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">日報件数 / Jml Laporan</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.totalReports}{' '}
            <span className="text-[11px] font-normal text-slate-600">
              ({bundle.approvedReports} {lang === 'ja' ? '承認済' : 'disetujui'})
            </span>
          </div>
        </div>
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">平均出席率 / Rata-rata Hadir</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.avgAttendanceRate !== null ? `${bundle.avgAttendanceRate}%` : '—'}
          </div>
        </div>
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">日次テスト / Tes Harian</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.totalDailyTests} {lang === 'ja' ? '件' : 'data'}
          </div>
        </div>
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">平均点・合格率 / Rata-rata & Lulus</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.avgDailyTestScore !== null
              ? `${bundle.avgDailyTestScore}% (${bundle.dailyPassRate}%)`
              : '—'}
          </div>
        </div>
      </div>

      {/* Section 1: Teacher Daily Reports */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-black uppercase tracking-wider border-b border-black pb-1">
          1. 講師日報・承認記録 / Laporan Harian Sensei & Status Approval
        </h3>
        {bundle.reports.length === 0 ? (
          <div className="text-xs text-slate-500 border border-slate-300 p-3">
            該当する日報記録がありません / Belum ada laporan harian pada periode ini.
          </div>
        ) : (
          <table className="w-full text-[11px] text-left border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="p-1.5 border-r border-slate-300">日付 / Tgl</th>
                <th className="p-1.5 border-r border-slate-300">クラス / Kelas</th>
                <th className="p-1.5 border-r border-slate-300">講師 / Sensei</th>
                <th className="p-1.5 border-r border-slate-300 text-right">出席 / Hadir</th>
                <th className="p-1.5 border-r border-slate-300">授業進捗・課題 / Materi & Kendala</th>
                <th className="p-1.5">承認・フィードバック / Approval</th>
              </tr>
            </thead>
            <tbody>
              {bundle.reports.map((r) => (
                <tr key={r.id} className="border-b border-slate-200 align-top">
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums whitespace-nowrap">
                    {r.date}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                    {classLabel(r.classId, lang)}
                  </td>
                  <td className="p-1.5 border-r border-slate-300">{r.teacherName}</td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right whitespace-nowrap">
                    {r.presentCount}/{r.totalStudents}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 space-y-0.5">
                    <div>
                      {[
                        r.kanaProgress && `かな:${r.kanaProgress}`,
                        r.textbookUnit && `教材:${r.textbookUnit}`,
                        r.examPractice && `対策:${r.examPractice}`,
                        r.conversationTopic && `会話:${r.conversationTopic}`,
                        r.kaigoTopic && `介護:${r.kaigoTopic}`,
                      ]
                        .filter(Boolean)
                        .join(' / ') || '—'}
                    </div>
                    {r.overallComment && <div className="text-slate-700">{r.overallComment}</div>}
                    {r.issues && <div className="text-rose-800 font-medium">課題: {r.issues}</div>}
                  </td>
                  <td className="p-1.5 space-y-0.5">
                    <div className="font-semibold">{approvalLabel(r.approvalStatus, lang)}</div>
                    {r.headFeedback && <div className="text-slate-700">{r.headFeedback}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Section 2: Daily Test Results */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-black uppercase tracking-wider border-b border-black pb-1">
          2. 日次テスト成績記録 / Hasil Tes Harian Siswa
        </h3>
        {bundle.dailyTests.length === 0 ? (
          <div className="text-xs text-slate-500 border border-slate-300 p-3">
            日次テストデータがありません / Belum ada data nilai tes harian pada periode ini.
          </div>
        ) : (
          <table className="w-full text-[11px] text-left border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="p-1.5 border-r border-slate-300">日付 / Tgl</th>
                <th className="p-1.5 border-r border-slate-300">クラス / Kelas</th>
                <th className="p-1.5 border-r border-slate-300">学生名 / Siswa</th>
                <th className="p-1.5 border-r border-slate-300">テスト名 / Tes</th>
                <th className="p-1.5 border-r border-slate-300 text-right">得点 / Nilai</th>
                <th className="p-1.5">苦手分野 / Salah</th>
              </tr>
            </thead>
            <tbody>
              {bundle.dailyTests.map((t) => (
                <tr key={t.id} className="border-b border-slate-200">
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums whitespace-nowrap">
                    {t.date}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                    {classLabel(t.classId, lang)}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-medium">{t.studentName}</td>
                  <td className="p-1.5 border-r border-slate-300">{t.testTitle}</td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right font-semibold whitespace-nowrap">
                    {t.earnedScore}/{t.maxScore} ({t.scorePercent}%)
                  </td>
                  <td className="p-1.5 text-slate-700">
                    {(t.wrongCategories || []).map((c) => categoryLabel(c, lang)).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Official Seal / Signature Block */}
      <div className="pt-4 border-t border-slate-300 flex items-end justify-between text-[11px] text-slate-600">
        <div>元気アカデミー 教務管理システム / Arsip Resmi Genki Academy</div>
        <div className="flex gap-6">
          <div className="border border-slate-400 w-24 h-14 p-1 text-center flex flex-col justify-between">
            <span className="text-[10px]">校長確認印</span>
            <span className="text-[9px] text-slate-400">Kepala</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWeeklyPdfSheet = (bundle: WeeklyExportBundle, subtitle: string) => (
    <div className="print-sheet bg-white text-black p-4 sm:p-6 space-y-5 text-xs">
      <div className="border-b-2 border-slate-900 pb-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-wider text-slate-600">
            元気アカデミー · GENKI ACADEMY — 公式記録レポート / ARSIP RESMI SEKOLAH
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            {lang === 'ja'
              ? '週次総括・成績レポート'
              : lang === 'id'
              ? 'Laporan Mingguan & Rekap Akademik'
              : '週次総括・成績レポート / LAPORAN MINGGUAN SEKOLAH'}
          </h2>
          <div className="text-[11px] font-mono text-slate-600 mt-0.5">{subtitle}</div>
        </div>
        <div className="text-[11px] text-right text-slate-700 font-mono">
          <div>
            出力日 / Tgl Cetak: <span className="font-semibold">{today}</span>
          </div>
          <div>
            作成 / Oleh: <span className="font-semibold">{profile.nickname || profile.displayName}</span>
          </div>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">対象週数 / Total Minggu</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.weeksCovered.length}{' '}
            <span className="text-[11px] font-normal text-slate-600">
              ({bundle.totalReports} {lang === 'ja' ? '日報' : 'laporan'})
            </span>
          </div>
        </div>
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">平均出席率 / Rata-rata Hadir</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.avgAttendanceRate !== null ? `${bundle.avgAttendanceRate}%` : '—'}
          </div>
        </div>
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">週次テスト件数 / Tes Mingguan</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.weeklyTestsCount}{' '}
            <span className="text-[11px] font-normal text-slate-600">
              / {bundle.testResults.length} total
            </span>
          </div>
        </div>
        <div className="border border-slate-300 rounded p-2.5">
          <div className="text-[10px] text-slate-500">平均点・合格率 / Rata-rata & Lulus</div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
            {bundle.avgWeeklyScore !== null
              ? `${bundle.avgWeeklyScore}% (${bundle.weeklyPassRate}%)`
              : '—'}
          </div>
        </div>
      </div>

      {/* Table 1: Weekly Class Summary */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-black uppercase tracking-wider border-b border-black pb-1">
          1. 週次・クラス別集計 / Rekap Mingguan Per Kelas
        </h3>
        {bundle.classSummaryRows.length === 0 ? (
          <div className="text-xs text-slate-500 border border-slate-300 p-3">
            該当する週次データがありません / Belum ada data mingguan pada filter ini.
          </div>
        ) : (
          <table className="w-full text-[11px] text-left border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="p-1.5 border-r border-slate-300">週 / Minggu</th>
                <th className="p-1.5 border-r border-slate-300">クラス / Kelas</th>
                <th className="p-1.5 border-r border-slate-300 text-right">日報(承認)</th>
                <th className="p-1.5 border-r border-slate-300 text-right">出席率</th>
                <th className="p-1.5 border-r border-slate-300 text-right">日次平均</th>
                <th className="p-1.5 border-r border-slate-300 text-right">週次平均 (合格率)</th>
                <th className="p-1.5">主な苦手分野 / Titik Lemah</th>
              </tr>
            </thead>
            <tbody>
              {bundle.classSummaryRows.map((row) => (
                <tr key={`${row.weekKey}_${row.classId}`} className="border-b border-slate-200">
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums whitespace-nowrap">
                    {row.weekKey}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                    {classLabel(row.classId, lang)}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right">
                    {row.reportCount} ({row.approvedCount})
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right">
                    {row.avgAttendanceRate !== null ? `${row.avgAttendanceRate}%` : '—'}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right">
                    {row.dailyAvg !== null ? `${row.dailyAvg}% (${row.dailyTestCount})` : '—'}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right font-semibold">
                    {row.weeklyAvg !== null ? `${row.weeklyAvg}% (${row.weeklyPassRate}%)` : '—'}
                  </td>
                  <td className="p-1.5 text-slate-700">
                    {row.topWeakCategory ? categoryLabel(row.topWeakCategory, lang) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Table 2: Weak-point ranking */}
      {bundle.weakPoints.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-black uppercase tracking-wider border-b border-black pb-1">
            2. 苦手分野集計 / Analisis Titik Lemah Minggu Ini
          </h3>
          <table className="w-full text-[11px] text-left border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="p-1.5 border-r border-slate-300">カテゴリー / Kategori</th>
                <th className="p-1.5 border-r border-slate-300 text-right">誤答数 / Salah</th>
                <th className="p-1.5 text-right">割合 / Persentase</th>
              </tr>
            </thead>
            <tbody>
              {bundle.weakPoints.map((wp) => (
                <tr key={wp.cat} className="border-b border-slate-200">
                  <td className="p-1.5 border-r border-slate-300 font-medium">
                    {categoryLabel(wp.cat, lang)}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums text-right">
                    {wp.count}
                  </td>
                  <td className="p-1.5 font-mono tabular-nums text-right">{wp.share}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Table 3: Detailed Weekly & Daily Test Scores */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-black uppercase tracking-wider border-b border-black pb-1">
          3. 学生別テスト成績詳細 / Detail Nilai Tes Siswa
        </h3>
        {bundle.testResults.length === 0 ? (
          <div className="text-xs text-slate-500 border border-slate-300 p-3">
            テスト成績データがありません / Belum ada data nilai tes pada minggu ini.
          </div>
        ) : (
          <table className="w-full text-[11px] text-left border-collapse border border-slate-300">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="p-1.5 border-r border-slate-300">週 / Minggu</th>
                <th className="p-1.5 border-r border-slate-300">種別</th>
                <th className="p-1.5 border-r border-slate-300">クラス / Kelas</th>
                <th className="p-1.5 border-r border-slate-300">学生名 / Siswa</th>
                <th className="p-1.5 border-r border-slate-300">テスト名 / Tes</th>
                <th className="p-1.5 text-right">得点 / Nilai</th>
              </tr>
            </thead>
            <tbody>
              {bundle.testResults.slice(0, 80).map((t) => (
                <tr key={t.id} className="border-b border-slate-200">
                  <td className="p-1.5 border-r border-slate-300 font-mono tabular-nums whitespace-nowrap">
                    {t.weekKey}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                    {t.testType === 'weekly' ? '週次' : '日次'}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 whitespace-nowrap">
                    {classLabel(t.classId, lang)}
                  </td>
                  <td className="p-1.5 border-r border-slate-300 font-medium">{t.studentName}</td>
                  <td className="p-1.5 border-r border-slate-300">{t.testTitle}</td>
                  <td className="p-1.5 font-mono tabular-nums text-right font-semibold whitespace-nowrap">
                    {t.earnedScore}/{t.maxScore} ({t.scorePercent}%)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Official Seal / Signature Block */}
      <div className="pt-4 border-t border-slate-300 flex items-end justify-between text-[11px] text-slate-600">
        <div>元気アカデミー 教務管理システム / Arsip Resmi Genki Academy</div>
        <div className="flex gap-6">
          <div className="border border-slate-400 w-24 h-14 p-1 text-center flex flex-col justify-between">
            <span className="text-[10px]">校長確認印</span>
            <span className="text-[9px] text-slate-400">Kepala</span>
          </div>
        </div>
      </div>
    </div>
  );

  const handleExportCsv = () => {
    if (exportScope === 'daily') {
      exportDailyReportCsv({
        bundle: dailyBundle,
        lang,
        selectedClass,
        dateFilter: effectiveDailyDate,
      });
      showExportToast(
        lang === 'id'
          ? `CSV Laporan Harian diunduh (${dailyBundle.totalReports} laporan, ${dailyBundle.totalDailyTests} nilai tes)`
          : `日次レポートCSVをダウンロードしました（日報 ${dailyBundle.totalReports}件 · テスト ${dailyBundle.totalDailyTests}件）`
      );
    } else {
      exportWeeklyReportCsv({
        bundle: weeklyBundle,
        lang,
        selectedClass,
        weekFilter: exportWeekFilter,
      });
      showExportToast(
        lang === 'id'
          ? `CSV Laporan Mingguan diunduh (${weeklyBundle.weeksCovered.length} minggu, ${weeklyBundle.testResults.length} nilai tes)`
          : `週次レポートCSVをダウンロードしました（${weeklyBundle.weeksCovered.length}週 · テスト ${weeklyBundle.testResults.length}件）`
      );
    }
  };

  const handleExportXlsx = () => {
    if (exportScope === 'daily') {
      exportDailyReportXlsx({
        bundle: dailyBundle,
        lang,
        selectedClass,
        dateFilter: effectiveDailyDate,
      });
      showExportToast(
        lang === 'id'
          ? `Excel Laporan Harian diunduh (${dailyBundle.totalReports} laporan, ${dailyBundle.totalDailyTests} nilai)`
          : `日次レポートExcelをダウンロードしました（日報 ${dailyBundle.totalReports}件 · テスト ${dailyBundle.totalDailyTests}件）`
      );
    } else {
      exportWeeklyReportXlsx({
        bundle: weeklyBundle,
        lang,
        selectedClass,
        weekFilter: exportWeekFilter,
      });
      showExportToast(
        lang === 'id'
          ? `Excel Laporan Mingguan diunduh (${weeklyBundle.weeksCovered.length} minggu, ${weeklyBundle.testResults.length} nilai)`
          : `週次レポートExcelをダウンロードしました（${weeklyBundle.weeksCovered.length}週 · テスト ${weeklyBundle.testResults.length}件）`
      );
    }
  };

  const handleOpenPdfPreview = () => {
    if (exportScope === 'daily') {
      const subtitle = `${classLabel(selectedClass, lang)} · ${
        effectiveDailyDate || (lang === 'ja' ? '全日付' : 'Semua Tanggal')
      }`;
      const sheet = renderDailyPdfSheet(dailyBundle, subtitle);
      onRegisterPrintView(sheet);
      setPdfPreview({ scope: 'daily', daily: dailyBundle, subtitle });
    } else {
      const subtitle = `${classLabel(selectedClass, lang)} · ${
        exportWeekFilter || (lang === 'ja' ? '全週' : 'Semua Minggu')
      }`;
      const sheet = renderWeeklyPdfSheet(weeklyBundle, subtitle);
      onRegisterPrintView(sheet);
      setPdfPreview({ scope: 'weekly', weekly: weeklyBundle, subtitle });
    }
  };

  return (
    <div className="space-y-10">
      <LiquidToast message={exportToast} />

      {/* Apple Hero Header & Segmented Class Filter */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div className="space-y-2 max-w-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="apple-hero-title text-[32px] sm:text-[46px]">
              {tr(UI_TEXT.navDashboard, lang)}
            </h1>
            {pendingQuestionsCount > 0 && (
              <button
                type="button"
                onClick={onOpenPendingQuestions}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-[#fffbeb] dark:bg-[#2b1e08] text-[#b45309] dark:text-[#fbbf24] hover:opacity-85 transition-opacity whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {lang === 'id'
                    ? `Review Soal Pending (${pendingQuestionsCount})`
                    : `承認待ち問題 (${pendingQuestionsCount}件)`}
                </span>
              </button>
            )}
            {unassignedCount > 0 && (
              <button
                type="button"
                onClick={() => onNavigateTab('roster')}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-[#0071e3]/10 dark:bg-[#2997ff]/15 text-[#0066cc] dark:text-[#2997ff] hover:opacity-85 transition-opacity whitespace-nowrap tabular-nums"
              >
                <span>
                  {lang === 'ja'
                    ? `未配属学生 (${unassignedCount}名)`
                    : lang === 'id'
                    ? `Belum Ditempatkan (${unassignedCount})`
                    : `Unassigned / 未配属 (${unassignedCount})`}
                </span>
              </button>
            )}
          </div>
          <p className="text-[17px] leading-[1.47] text-[#6e6e73] dark:text-[#86868b]">
            {lang === 'ja'
              ? '4クラスの日報状況・週次公式成績・アラート・苦手分野を一覧で確認できます。'
              : 'Pantau laporan 4 kelas, peringkat resmi ujian mingguan, peringatan siswa, dan pengumuman.'}
          </p>
        </div>

        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-full self-start">
          {(['all', ...CLASSES.map((c) => c.id)] as const).map((cid) => {
            const active = selectedClass === cid;
            const cTheme = getClassTheme(cid);
            return (
              <button
                key={cid}
                type="button"
                onClick={() => setSelectedClass(cid)}
                className={`relative px-3.5 py-1.5 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap ${
                  active
                    ? 'text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold'
                    : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="dashClassFilterPill"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className="absolute inset-0 bg-white dark:bg-[#2c2c2e] rounded-full shadow-xs"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  {cTheme && (
                    <span className={`w-2 h-2 rounded-full ${cTheme.dotColor} shrink-0`} />
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
      </div>

      {/* School Announcements Panel */}
      <div id="apple-sec-announcements">
        <AppleScrollReveal>
          <AnnouncementsPanel
            lang={lang}
            profile={profile}
            announcements={announcements}
            announcementReads={announcementReads}
            staffUsers={staffUsers}
          />
        </AppleScrollReveal>
      </div>

      {/* At-Risk Student Alerts Card */}
      <div id="apple-sec-alerts">
        <AppleScrollReveal delay={0.04}>
          <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#1d1d1f] dark:text-[#f5f5f7] shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {lang === 'id' ? 'Peringatan Siswa Berisiko' : '要注意学生アラート'}
                  </h2>
                  {unhandledAlertsCount > 0 && (
                    <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-[#dc2626] dark:bg-[#ff453a] text-white tabular-nums">
                      {unhandledAlertsCount}
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'id'
                    ? `Otomatis mendeteksi penurunan nilai ujian mingguan (${thresholds.consecutiveDropWeeks} mgg), rata-rata <${thresholds.minWeeklyAvgThreshold}%, absen ≥${thresholds.maxAbsentDays}×, atau sikap <${thresholds.minAttitudeThreshold}/5.`
                    : `週次試験の${thresholds.consecutiveDropWeeks}週連続低下・平均${thresholds.minWeeklyAvgThreshold}%未満・欠席${thresholds.maxAbsentDays}回以上・態度${thresholds.minAttitudeThreshold}未満を自動検知。`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3.5 py-1.5 rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showHandledAlerts}
                  onChange={(e) => setShowHandledAlerts(e.target.checked)}
                />
                <span>{lang === 'id' ? 'Tampilkan Sudah Ditangani' : '対応済も表示'}</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setThDraft(thresholds);
                  setThresholdModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                <span>{lang === 'id' ? 'Atur Kriteria' : '判定基準設定'}</span>
              </button>
            </div>
          </div>

          {visibleAlerts.length === 0 ? (
            <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[16px] p-4 text-[13px] text-[#15803d] dark:text-[#4ade80] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {lang === 'id'
                  ? 'Tidak ada siswa yang memerlukan penanganan mendesak saat ini.'
                  : '現在、未対応の要注意アラートはありません。'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleAlerts.map((al) => {
                const sTheme = getClassTheme(al.student.classId);
                const isHandling = handlingAlertId === al.id;
                return (
                  <div
                    key={al.id}
                    className={`bg-[#f5f5f7] dark:bg-[#161617] rounded-[16px] p-4 border space-y-2.5 ${
                      al.handledRecord
                        ? 'border-[#d2d2d7]/50 dark:border-[#424245]/50 opacity-80'
                        : 'border-[#d2d2d7]/80 dark:border-[#424245]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onSelectStudent(al.student)}
                            className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] underline decoration-[#d2d2d7] dark:decoration-[#424245] underline-offset-4 text-left"
                          >
                            {al.student.name}
                          </button>
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                            {sTheme && <span className={`w-1.5 h-1.5 rounded-full ${sTheme.dotColor}`} />}
                            <span>{classLabel(al.student.classId, lang)}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                          <AlertTriangle
                            className={`w-3.5 h-3.5 shrink-0 ${
                              al.handledRecord
                                ? 'text-[#15803d] dark:text-[#4ade80]'
                                : al.severity === 'high'
                                ? 'text-[#dc2626] dark:text-[#ff453a]'
                                : 'text-[#b45309] dark:text-[#fbbf24]'
                            }`}
                          />
                          <span>{lang === 'id' ? al.reasonId : al.reasonJa}</span>
                        </div>
                      </div>

                      {!al.handledRecord ? (
                        <button
                          type="button"
                          onClick={() => {
                            setHandlingAlertId(isHandling ? null : al.id);
                            setHandleAlertNote('');
                          }}
                          className="apple-btn-primary px-3 py-1 text-[11px] shrink-0"
                        >
                          {lang === 'id' ? 'Tangani' : '対応済'}
                        </button>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#ecfdf5] dark:bg-[#052e16] text-[#15803d] dark:text-[#4ade80] shrink-0">
                          ✓ {lang === 'id' ? 'Ditangani' : '対応済'}
                        </span>
                      )}
                    </div>

                    {al.handledRecord && (
                      <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] bg-white dark:bg-[#1d1d1f] rounded-[10px] px-3 py-2">
                        <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {al.handledRecord.handledByName}
                        </span>{' '}
                        ({al.handledRecord.handledAt})
                        {al.handledRecord.note && `: ${al.handledRecord.note}`}
                      </div>
                    )}

                    {isHandling && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          maxLength={500}
                          value={handleAlertNote}
                          onChange={(e) => setHandleAlertNote(e.target.value)}
                          placeholder={
                            lang === 'id'
                              ? 'Catatan tindak lanjut (opsional)...'
                              : '対応メモ（任意）...'
                          }
                          className="flex-1 glass-input px-3 py-1.5 text-[12px] rounded-[10px]"
                        />
                        <button
                          type="button"
                          disabled={savingQuality}
                          onClick={() => handleMarkAlertHandled(al)}
                          className="apple-btn-primary px-3.5 py-1.5 text-[12px]"
                        >
                          {lang === 'id' ? 'Simpan' : '確定'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </AppleScrollReveal>
      </div>

      {/* Record-Keeping Export Toolbar (Daily & Weekly CSV / PDF) */}
      <AppleScrollReveal delay={0.05}>
        <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 sm:p-6 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-[16px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'ja'
                ? '記録・保管用レポート出力（CSV / PDF）'
                : 'Ekspor Arsip Laporan Harian & Mingguan (CSV / PDF)'}
            </h2>
            <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] tabular-nums">
              {exportScope === 'daily'
                ? lang === 'ja'
                  ? `対象: ${classLabel(selectedClass, lang)} · 日報 ${dailyBundle.totalReports}件 · 日次テスト ${dailyBundle.totalDailyTests}件`
                  : `Cakupan: ${classLabel(selectedClass, lang)} · ${dailyBundle.totalReports} laporan sensei · ${dailyBundle.totalDailyTests} tes harian`
                : lang === 'ja'
                ? `対象: ${classLabel(selectedClass, lang)} · ${weeklyBundle.weeksCovered.length}週 · テスト ${weeklyBundle.testResults.length}件 · 日報 ${weeklyBundle.totalReports}件`
                : `Cakupan: ${classLabel(selectedClass, lang)} · ${weeklyBundle.weeksCovered.length} minggu · ${weeklyBundle.testResults.length} tes · ${weeklyBundle.totalReports} laporan`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 bg-[#f5f5f7] dark:bg-[#161617] rounded-full shrink-0">
              <button
                type="button"
                onClick={() => setExportScope('daily')}
                className={`px-3.5 py-1.5 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  exportScope === 'daily'
                    ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                    : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                }`}
              >
                {lang === 'ja' ? '日次レポート' : 'Laporan Harian'}
              </button>
              <button
                type="button"
                onClick={() => setExportScope('weekly')}
                className={`px-3.5 py-1.5 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 ${
                  exportScope === 'weekly'
                    ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                    : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                }`}
              >
                {lang === 'ja' ? '週次レポート' : 'Laporan Mingguan'}
              </button>
            </div>

            {exportScope === 'daily' ? (
              <select
                value={effectiveDailyDate}
                onChange={(e) => setExportDateFilter(e.target.value)}
                aria-label="Daily report date scope"
                className="px-3 py-1.5 text-[12px] font-mono tabular-nums glass-input rounded-full shrink-0"
              >
                <option value="">
                  {lang === 'ja' ? '全日付 / Semua Tanggal' : 'Semua Tanggal'}
                </option>
                <option value={today}>
                  {today} ({lang === 'ja' ? '本日' : 'Hari Ini'})
                </option>
                {availableDates
                  .filter((d) => d !== today)
                  .map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
              </select>
            ) : (
              <select
                value={exportWeekFilter}
                onChange={(e) => setExportWeekFilter(e.target.value)}
                aria-label="Weekly report week scope"
                className="px-3 py-1.5 text-[12px] font-mono tabular-nums glass-input rounded-full shrink-0"
              >
                <option value="">
                  {lang === 'ja' ? '全週 / Semua Minggu' : 'Semua Minggu'}
                </option>
                {availableWeeks.map((wk) => (
                  <option key={wk} value={wk}>
                    {wk}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={handleExportXlsx}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{lang === 'id' ? 'Ekspor Excel' : 'Excel出力 (.xlsx)'}</span>
            </button>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] whitespace-nowrap shrink-0"
            >
              <span>CSV</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPdfPreview}
              className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{lang === 'id' ? 'Ekspor PDF' : 'PDFプレビュー・保存'}</span>
            </button>
          </div>
        </div>
      </AppleScrollReveal>

      {/* PDF Print Preview Modal */}
      <AnimatePresence>
        {pdfPreview && (
          <AppleModalSheet
            open={Boolean(pdfPreview)}
            onClose={() => {
              setPdfPreview(null);
              onRegisterPrintView(null);
            }}
            maxWidthClass="max-w-5xl"
          >
            <div className="px-6 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex items-center justify-between gap-3">
              <div className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                {pdfPreview.scope === 'daily'
                  ? lang === 'ja'
                    ? '日次レポート PDF プレビュー'
                    : 'Pratinjau PDF Laporan Harian'
                  : lang === 'ja'
                  ? '週次レポート PDF プレビュー'
                  : 'Pratinjau PDF Laporan Mingguan'}{' '}
                — {pdfPreview.subtitle}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] whitespace-nowrap shrink-0"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '印刷 / PDF保存' : 'Cetak / Simpan PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPdfPreview(null);
                    onRegisterPrintView(null);
                  }}
                  aria-label="Close PDF preview"
                  className="p-2 text-[#6e6e73] hover:text-[#1d1d1f] dark:text-[#86868b] dark:hover:text-[#f5f5f7] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto bg-[#f5f5f7] dark:bg-black">
              <div className="bg-white border border-[#d2d2d7] rounded-[12px] overflow-hidden">
                {pdfPreview.scope === 'daily'
                  ? renderDailyPdfSheet(pdfPreview.daily, pdfPreview.subtitle)
                  : renderWeeklyPdfSheet(pdfPreview.weekly, pdfPreview.subtitle)}
              </div>
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Report Cards & Certificates Quick Widgets */}
      <AppleScrollReveal delay={0.05}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Widget 1: Report Cards Waiting Approval */}
          <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'id'
                    ? 'Rapor Menunggu Persetujuan'
                    : '承認待ちの成績通知表'}
                </div>
                <div className="text-[30px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                  <AnimatedCounter value={waitingApprovalCardsCount} />
                  <span className="text-[14px] font-normal text-[#6e6e73] dark:text-[#86868b] ml-1">
                    {lang === 'id' ? 'rapor' : '件'}
                  </span>
                </div>
              </div>
              <span className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#0071e3] dark:text-[#2997ff] shrink-0">
                <FileText className="w-4 h-4" />
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('reportCards')}
              className="text-left text-[12px] font-medium text-[#0066cc] dark:text-[#2997ff] hover:underline"
            >
              {lang === 'id' ? 'Buka & Setujui Rapor →' : '通知表を確認・承認 →'}
            </button>
          </div>

          {/* Widget 2: Students Finishing in Next 30 Days */}
          <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'id'
                    ? 'Siswa Lulus 30 Hari ke Depan'
                    : '30日以内に修了予定の学生'}
                </div>
                <div className="text-[30px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                  <AnimatedCounter value={finishingSoonStudents.length} />
                  <span className="text-[14px] font-normal text-[#6e6e73] dark:text-[#86868b] ml-1">
                    {lang === 'id' ? 'siswa' : '名'}
                  </span>
                </div>
              </div>
              <span className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#1d1d1f] dark:text-[#f5f5f7] shrink-0">
                <Clock className="w-4 h-4" />
              </span>
            </div>
            {finishingSoonStudents.length === 0 ? (
              <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'id' ? 'Tidak ada siswa dalam 30 hari.' : '該当学生はいません。'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {finishingSoonStudents.slice(0, 4).map(({ student, prog }) => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => onSelectStudent(student)}
                    className="px-2.5 py-0.5 rounded-full text-[11px] bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] tabular-nums"
                  >
                    {student.name} ({prog.daysRemaining}d)
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Widget 3: Certificates Ready to Issue */}
          <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 flex flex-col justify-between gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'id'
                    ? 'Sertifikat Siap Diterbitkan'
                    : '発行可能な修了証書'}
                </div>
                <div className="text-[30px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7] mt-1">
                  <AnimatedCounter value={readyCertificatesCount} />
                  <span className="text-[14px] font-normal text-[#6e6e73] dark:text-[#86868b] ml-1">
                    {lang === 'id' ? 'siswa' : '名'}
                  </span>
                </div>
              </div>
              <span className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#0071e3] dark:text-[#2997ff] shrink-0">
                <Award className="w-4 h-4" />
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('reportCards')}
              className="text-left text-[12px] font-medium text-[#0066cc] dark:text-[#2997ff] hover:underline"
            >
              {lang === 'id' ? 'Terbitkan Sertifikat →' : '修了証書の発行画面へ →'}
            </button>
          </div>
        </div>
      </AppleScrollReveal>

      {/* 4-Class Apple Bento Widget Tiles (Solid surface, muted dot, large metric + concise caption) */}
      <AppleScrollReveal delay={0.06}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {classCards.map(
            ({
              cls,
              studentCount,
              todayReport,
              latestAvgScore,
              latestDate,
              resultCount,
              isOfficialWeekly,
              todaySchedule,
            }) => {
              const cTheme = CLASS_THEMES[cls.id];
              return (
                <div
                  key={cls.id}
                  className="apple-tile apple-tile-interactive border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full ${cTheme.dotColor} shrink-0`} />
                        <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                          {lang === 'id' ? cls.nameId : cls.nameJa}
                        </h2>
                      </div>
                      <span className="text-[12px] tabular-nums text-[#6e6e73] dark:text-[#86868b] shrink-0">
                        <AnimatedCounter value={studentCount} />{' '}
                        {lang === 'id' ? 'siswa' : '名'}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b] mt-1">
                      {lang === 'id' ? cls.subtitleId : cls.subtitleJa}
                    </p>
                  </div>

                  {/* Hero Metric */}
                  <div>
                    <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                      {isOfficialWeekly
                        ? lang === 'id'
                          ? 'Ujian Mingguan'
                          : '週次試験平均'
                        : lang === 'id'
                        ? 'Tes Terbaru (Ref)'
                        : '参考テスト平均'}
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-[32px] font-semibold tracking-tight tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {latestAvgScore !== null ? (
                          <AnimatedCounter value={latestAvgScore} suffix="%" />
                        ) : (
                          '—'
                        )}
                      </span>
                      {latestAvgScore !== null && (
                        <span className="text-[12px] font-mono text-[#6e6e73] dark:text-[#86868b]">
                          {latestDate?.slice(5)} · {resultCount}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Today's Schedule Strip */}
                  <div className="rounded-[14px] p-3 space-y-1.5 bg-[#f5f5f7] dark:bg-[#161617]">
                    <div className="text-[11px] font-medium text-[#6e6e73] dark:text-[#86868b] flex items-center justify-between">
                      <span>{lang === 'id' ? 'Jadwal Hari Ini' : '本日のスケジュール'}</span>
                      <span className="font-mono">{todaySchedule.length > 0 ? todaySchedule.length : ''}</span>
                    </div>
                    {todaySchedule.length === 0 ? (
                      <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        {lang === 'id' ? 'Belum ada jadwal hari ini' : '本日の登録授業なし'}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {todaySchedule.slice(0, 2).map((row) => (
                          <div
                            key={row.id}
                            className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center justify-between gap-2"
                          >
                            <span className="font-mono text-[11px] text-[#6e6e73] dark:text-[#86868b] shrink-0">
                              {row.timeSlot || '—'}
                            </span>
                            <span className="truncate font-medium">
                              {row.subject || row.teacher || '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-2.5 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50 flex items-center justify-between text-[12px]">
                    <span className="text-[#6e6e73] dark:text-[#86868b]">
                      {lang === 'id' ? 'Status Nippo' : '本日の日報'}
                    </span>
                    {todayReport ? (
                      <span className="inline-flex items-center gap-1 font-medium text-[#15803d] dark:text-[#4ade80] tabular-nums">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {lang === 'id' ? 'Terkirim' : '提出済'} ({todayReport.presentCount}/
                          {todayReport.totalStudents})
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-[#b45309] dark:text-[#fbbf24]">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{lang === 'id' ? 'Belum' : '未提出'}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            }
          )}
        </div>
      </AppleScrollReveal>

      {/* Auto-Compiled Daily & Weekly Test Recap */}
      <div id="apple-sec-recap">
        <AppleScrollReveal delay={0.08}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 8 cols: Period Trend & Monochrome + Blue Bar Chart */}
          <div className="lg:col-span-8 apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 sm:p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[19px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'ja'
                    ? '自動集計テスト推移（日次・週次）'
                    : 'Rekap Otomatis Nilai Tes (Harian & Mingguan)'}
                </h2>
                <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                  {classLabel(selectedClass, lang)} ·{' '}
                  <span className="font-mono tabular-nums">
                    <AnimatedCounter value={filteredResults.length} />
                  </span>{' '}
                  {lang === 'ja' ? '件の採点データ' : 'data nilai'}
                  {recapPeriod === 'daily' && (
                    <span className="ml-2 text-[#b45309] dark:text-[#fbbf24] font-medium">
                      ({lang === 'id' ? 'Data pendukung · non-ranking' : '補助データ・順位対象外'})
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={recapSenseiFilter}
                  onChange={(e) => setRecapSenseiFilter(e.target.value)}
                  className="glass-input px-3 py-1.5 text-[12px] rounded-full"
                  aria-label="Filter recap by sensei"
                >
                  <option value="all">{lang === 'id' ? 'Semua Sensei' : '全講師'}</option>
                  {staffUsers
                    .filter((u) => u.status === 'active')
                    .map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.nickname || u.displayName}
                      </option>
                    ))}
                </select>

                <input
                  type="date"
                  value={recapDateFilter}
                  onChange={(e) => setRecapDateFilter(e.target.value)}
                  className="glass-input px-3 py-1.5 text-[12px] font-mono rounded-full"
                />
                {recapDateFilter && (
                  <button
                    type="button"
                    onClick={() => setRecapDateFilter('')}
                    className="text-[12px] text-[#0066cc] dark:text-[#2997ff] hover:underline"
                  >
                    {lang === 'id' ? 'Reset' : 'クリア'}
                  </button>
                )}

                <div className="inline-flex p-1 bg-[#f5f5f7] dark:bg-[#161617] rounded-full">
                  <button
                    type="button"
                    onClick={() => setRecapPeriod('weekly')}
                    className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors ${
                      recapPeriod === 'weekly'
                        ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                        : 'text-[#6e6e73] dark:text-[#86868b]'
                    }`}
                  >
                    {lang === 'ja' ? '週次集計（公式）' : 'Mingguan (Resmi)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecapPeriod('daily')}
                    className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors ${
                      recapPeriod === 'daily'
                        ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                        : 'text-[#6e6e73] dark:text-[#86868b]'
                    }`}
                  >
                    {lang === 'ja' ? '日次集計（参考）' : 'Harian (Pendukung)'}
                  </button>
                </div>
              </div>
            </div>

            {periodSeries.length === 0 ? (
              <EmptyStateIllustration
                kind="chart"
                title={
                  lang === 'ja'
                    ? 'この条件のテスト結果がまだありません'
                    : 'Belum ada data nilai tes untuk periode ini'
                }
                action={
                  <button
                    type="button"
                    onClick={() => onNavigateTab('grading')}
                    className="apple-btn-primary px-5 py-2 text-[13px]"
                  >
                    {lang === 'ja' ? '点数を入力する' : 'Input Nilai Sekarang'}
                  </button>
                }
              />
            ) : (
              <div className="space-y-4">
                {/* Monochrome Gray + Single Blue Accent Bar Chart */}
                <div className="apple-scroll-x">
                  <div className="min-w-[460px] pt-2">
                    <div className="grid grid-cols-10 gap-2 items-end h-44 border-b border-[#d2d2d7]/70 dark:border-[#424245] pb-2 px-1">
                      {periodSeries.map((pt, barIdx) => (
                        <div
                          key={pt.label}
                          className="flex flex-col items-center justify-end h-full gap-1.5"
                        >
                          <span className="text-[12px] font-mono tabular-nums font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {pt.avg}%
                          </span>
                          <div className="w-full max-w-[32px] bg-[#f5f5f7] dark:bg-[#161617] rounded-t-[6px] h-32 flex items-end overflow-hidden">
                            <motion.div
                              initial={{ scaleY: 0 }}
                              animate={{ scaleY: 1 }}
                              transition={{
                                duration: 0.45,
                                delay: barIdx * 0.03,
                              }}
                              style={{
                                height: `${Math.max(8, pt.avg)}%`,
                                transformOrigin: 'bottom',
                              }}
                              className={`w-full rounded-t-[5px] ${
                                pt.avg >= 70
                                  ? 'bg-[#0071e3] dark:bg-[#2997ff]'
                                  : 'bg-[#86868b]'
                              }`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-10 gap-2 pt-2 px-1 text-center">
                      {periodSeries.map((pt) => (
                        <div
                          key={pt.label}
                          className="text-[11px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b] truncate"
                        >
                          {recapPeriod === 'daily' ? pt.label.slice(5) : pt.label}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Period Breakdown Table */}
                <div className="apple-scroll-x pt-2">
                  <table className="w-full text-[13px] text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#d2d2d7]/70 dark:border-[#424245] text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        <th className="py-2 pr-3 font-medium">
                          {recapPeriod === 'daily' ? '日付 / Tanggal' : '週 / Minggu'}
                        </th>
                        <th className="py-2 px-3 font-medium text-right">件数 / Jumlah</th>
                        <th className="py-2 px-3 font-medium text-right">平均点 / Rata-rata</th>
                        <th className="py-2 pl-3 font-medium text-right">合格率 (≥70%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#424245]/40">
                      {[...periodSeries].reverse().map((pt) => (
                        <tr
                          key={pt.label}
                          className="hover:bg-[#f5f5f7]/60 dark:hover:bg-[#2c2c2e]/40"
                        >
                          <td className="py-2.5 pr-3 font-mono tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {pt.label}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right text-[#6e6e73] dark:text-[#86868b]">
                            {pt.count}
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-right font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {pt.avg}%
                          </td>
                          <td className="py-2.5 pl-3 font-mono tabular-nums text-right text-[#6e6e73] dark:text-[#86868b]">
                            {pt.passRate}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Right 4 cols: Weak-Point Analysis (Monochrome + Accent) */}
          <div className="lg:col-span-4 apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 sm:p-6 space-y-5">
            <div>
              <h2 className="text-[19px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'ja' ? '苦手分野分析（自動集計）' : 'Analisis Titik Lemah Siswa'}
              </h2>
              <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                {lang === 'ja'
                  ? '○/×採点の不正解データから自動抽出'
                  : 'Dihitung otomatis dari soal yang salah (×)'}
              </p>
            </div>

            {weakPoints.length === 0 ? (
              <EmptyStateIllustration
                kind="clipboard"
                title={lang === 'ja' ? 'まだ誤答データがありません' : 'Belum ada data kesalahan soal'}
                subtitle={
                  lang === 'ja'
                    ? '○/×採点を行うとここに苦手カテゴリーが表示されます。'
                    : 'Data akan muncul otomatis setelah koreksi ○/×.'
                }
              />
            ) : (
              <div className="space-y-3.5">
                {weakPoints.map((wp, idx) => (
                  <div key={wp.cat} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {categoryLabel(wp.cat, lang)}
                      </span>
                      <span className="font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                        {wp.count}× ({wp.share}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#f5f5f7] dark:bg-[#161617] rounded-full overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          duration: 0.45,
                          delay: idx * 0.04,
                        }}
                        style={{
                          width: `${Math.max(8, wp.share)}%`,
                          transformOrigin: 'left',
                        }}
                        className={`h-full rounded-full ${
                          idx === 0
                            ? 'bg-[#0071e3] dark:bg-[#2997ff]'
                            : 'bg-[#86868b]'
                        }`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AppleScrollReveal>
      </div>

      {/* Official Weekly Exam Ranking & Printable Wall Board */}
      <div id="apple-sec-ranking">
        <AppleScrollReveal delay={0.1}>
        <div className="apple-table-wrap">
          <div className="px-6 py-5 border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div>
              <h2 className="text-[19px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id'
                  ? 'Peringkat Resmi Siswa (Basis: Nilai Ujian Mingguan)'
                  : '公式学生ランキング・成績サマリー（週次試験基準）'}
              </h2>
              <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                {lang === 'id'
                  ? 'Klik nama siswa untuk membuka Profil Lengkap. Tes harian ditampilkan hanya sebagai referensi.'
                  : '学生名をクリックすると詳細プロフィールを開きます。日次テストは参考表示のみで順位には使用されません。'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={rankingWeekFilter}
                onChange={(e) => setRankingWeekFilter(e.target.value)}
                className="glass-input px-3 py-1.5 text-[12px] font-mono rounded-full"
              >
                <option value="">
                  {lang === 'id' ? 'Semua Minggu (Rata²)' : '全週平均（公式）'}
                </option>
                {availableWeeks.map((wk) => (
                  <option key={wk} value={wk}>
                    {wk}
                  </option>
                ))}
              </select>

              <select
                value={rankingMetric}
                onChange={(e) => {
                  setRankingMetric(e.target.value as RankingMetric);
                  setRankingSortKey('default');
                }}
                className="glass-input px-3 py-1.5 text-[12px] rounded-full"
              >
                <option value="weekly_exam">
                  {lang === 'id' ? 'Skor Ujian Mingguan' : '週次試験スコア'}
                </option>
                <option value="attitude">
                  {lang === 'id' ? 'Nilai Sikap' : '学習態度評価'}
                </option>
                <option value="combined">
                  {lang === 'id'
                    ? `Gabungan (${thresholds.examWeightPercent}%/${thresholds.attitudeWeightPercent}%)`
                    : `総合 (${thresholds.examWeightPercent}%/${thresholds.attitudeWeightPercent}%)`}
                </option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setRankingSortKey('default');
                  setRankingSortAsc(false);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
              >
                <span>{lang === 'id' ? 'Tertinggi Dulu' : '高得点順'}</span>
              </button>

              <input
                type="text"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
                placeholder={lang === 'ja' ? '学生検索...' : 'Cari nama siswa...'}
                className="w-40 sm:w-44 px-3.5 py-1.5 text-[12px] glass-input rounded-full"
              />

              <button
                type="button"
                onClick={() => {
                  setWallClass(selectedClass);
                  setWallBoardOpen(true);
                }}
                className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] whitespace-nowrap"
              >
                <Award className="w-3.5 h-3.5" />
                <span>
                  {lang === 'id' ? 'Cetak Papan Peringkat' : '成績掲示ボード印刷'}
                </span>
              </button>
            </div>
          </div>

          {displayedRankingRows.length === 0 ? (
            <div className="p-6">
              <EmptyStateIllustration
                kind="users"
                title={lang === 'ja' ? '学生データがまだありません' : 'Belum ada data siswa'}
              />
            </div>
          ) : (
            <div className="apple-scroll-x max-h-[560px] overflow-y-auto">
              <table className="w-full text-[14px] text-left border-collapse min-w-[760px]">
                <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                  <tr className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    <th className="py-3 px-4 font-medium w-14 text-center">#</th>
                    <th className="py-3 px-4 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[15]">
                      {lang === 'id' ? 'Siswa' : '学生'}
                    </th>
                    <th className="py-3 px-4 font-medium">
                      {lang === 'id' ? 'Kelas' : 'クラス'}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => toggleRankingSort('weeklyScore')}
                        className="inline-flex items-center gap-1 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                      >
                        <span>
                          {lang === 'id' ? 'Ujian Mingguan (Resmi)' : '週次試験（公式）'}
                        </span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => toggleRankingSort('trendDelta')}
                        className="inline-flex items-center gap-1 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                      >
                        <span>{lang === 'id' ? 'Tren' : '前回比'}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => toggleRankingSort('attitudeScore')}
                        className="inline-flex items-center gap-1 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                      >
                        <span>{lang === 'id' ? 'Sikap' : '態度'}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => toggleRankingSort('attendanceRate')}
                        className="inline-flex items-center gap-1 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                      >
                        <span>{lang === 'id' ? 'Kehadiran' : '出席率'}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => toggleRankingSort('combinedScore')}
                        className="inline-flex items-center gap-1 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                      >
                        <span>{lang === 'id' ? 'Gabungan' : '総合'}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-3 px-4 font-medium text-right text-[11px]">
                      {lang === 'id' ? 'Harian (Ref)' : '日次(参考)'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedRankingRows.map((row) => {
                    const sTheme = getClassTheme(row.student.classId);
                    const isTop3 = row.rank <= 3;
                    return (
                      <tr key={row.student.id} className="apple-table-row">
                        {/* Plain Rank Number: subtle bold weight for top 3, NO medals or colored badges */}
                        <td
                          className={`py-2.5 px-4 text-center font-mono tabular-nums text-[14px] ${
                            isTop3
                              ? 'font-bold text-[#1d1d1f] dark:text-[#f5f5f7]'
                              : 'font-normal text-[#6e6e73] dark:text-[#86868b]'
                          }`}
                        >
                          {row.rank}
                        </td>
                        <td className="py-2.5 px-4 sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                          <button
                            type="button"
                            onClick={() => onSelectStudent(row.student)}
                            className="text-left font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] transition-colors"
                          >
                            {row.student.name}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-[13px] text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {sTheme && <span className={`w-2 h-2 rounded-full ${sTheme.dotColor}`} />}
                            <span>{classLabel(row.student.classId, lang)}</span>
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right">
                          {row.weeklyScore !== null ? (
                            <span
                              className={`font-semibold ${
                                row.weeklyScore >= thresholds.minWeeklyAvgThreshold
                                  ? 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                                  : 'text-[#dc2626] dark:text-[#ff453a]'
                              }`}
                            >
                              {row.weeklyScore}%
                            </span>
                          ) : (
                            <span className="text-[#6e6e73] dark:text-[#86868b]">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-[13px]">
                          {row.trendDelta !== null ? (
                            <span
                              className={`inline-flex items-center gap-0.5 font-medium ${
                                row.trendDelta > 0
                                  ? 'text-[#15803d] dark:text-[#4ade80]'
                                  : row.trendDelta < 0
                                  ? 'text-[#dc2626] dark:text-[#ff453a]'
                                  : 'text-[#6e6e73] dark:text-[#86868b]'
                              }`}
                            >
                              {row.trendDelta > 0 ? (
                                <ArrowUpRight className="w-3 h-3" />
                              ) : row.trendDelta < 0 ? (
                                <ArrowDownRight className="w-3 h-3" />
                              ) : null}
                              <span>
                                {row.trendDelta > 0 ? `+${row.trendDelta}%` : `${row.trendDelta}%`}
                              </span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-[#6e6e73] dark:text-[#86868b]">
                          {row.attitudeScore !== null ? `${row.attitudeScore}/5` : '—'}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-[#6e6e73] dark:text-[#86868b]">
                          {row.attendanceRate !== null ? `${row.attendanceRate}%` : '—'}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold text-[#0071e3] dark:text-[#2997ff]">
                          {row.combinedScore !== null ? `${row.combinedScore}%` : '—'}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-right text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                          {row.dailySecondaryAvg !== null ? `${row.dailySecondaryAvg}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AppleScrollReveal>
      </div>

      {/* Daily Teacher Reports Approval & Feedback Feed */}
      <AppleScrollReveal delay={0.12}>
        <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[19px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'ja'
                  ? '日報チェック・承認・フィードバック（校長専用）'
                  : 'Cek, Persetujuan & Feedback Laporan Sensei'}
              </h2>
              <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
                {lang === 'ja'
                  ? `未承認の日報: ${pendingCount}件（講師は自分の日報のみ閲覧可能です）`
                  : `Menunggu approval: ${pendingCount} laporan (Sensei hanya dapat melihat laporannya sendiri)`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#f5f5f7] dark:bg-[#161617] rounded-full">
                {(['all', 'pending', 'revision_needed', 'approved'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setApprovalFilter(st)}
                    className={`px-3 py-1 text-[12px] font-medium rounded-full transition-colors whitespace-nowrap shrink-0 ${
                      approvalFilter === st
                        ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs'
                        : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
                    }`}
                  >
                    {st === 'all'
                      ? `${lang === 'ja' ? 'すべて' : 'Semua'} (${reports.length})`
                      : st === 'pending'
                      ? `${tr(UI_TEXT.statusPending, lang)} (${pendingCount})`
                      : st === 'revision_needed'
                      ? `${tr(UI_TEXT.statusRevision, lang)} (${revisionCount})`
                      : `${tr(UI_TEXT.statusApproved, lang)} (${approvedCount})`}
                  </button>
                ))}
              </div>

              <input
                type="date"
                value={reportDateFilter}
                onChange={(e) => setReportDateFilter(e.target.value)}
                className="px-3 py-1.5 text-[12px] font-mono tabular-nums glass-input rounded-full"
              />
              {reportDateFilter && (
                <button
                  type="button"
                  onClick={() => setReportDateFilter('')}
                  className="text-[12px] text-[#0066cc] dark:text-[#2997ff] hover:underline whitespace-nowrap shrink-0"
                >
                  {lang === 'ja' ? '全日付' : 'Semua Tgl'}
                </button>
              )}
            </div>
          </div>

          {filteredReports.length === 0 ? (
            <EmptyStateIllustration
              kind="clipboard"
              title={
                lang === 'ja' ? '該当する日報がありません' : 'Belum ada laporan harian yang sesuai'
              }
            />
          ) : (
            <div className="divide-y divide-[#d2d2d7]/60 dark:divide-[#424245]/60">
              {(showAllReports ? filteredReports : filteredReports.slice(0, 20)).map((r) => {
                const status = r.approvalStatus || 'pending';
                const draftVal =
                  feedbackDrafts[r.id] !== undefined
                    ? feedbackDrafts[r.id]
                    : r.headFeedback || '';
                const isBusy = savingReportId === r.id;
                const rTheme = CLASS_THEMES[r.classId];

                return (
                  <div key={r.id} className="py-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]">
                          <span className={`w-2 h-2 rounded-full ${rTheme.dotColor}`} />
                          <span>{classLabel(r.classId, lang)}</span>
                        </span>
                        <span
                          className={`text-[12px] font-medium ${
                            status === 'approved'
                              ? 'text-[#15803d] dark:text-[#4ade80]'
                              : status === 'revision_needed'
                              ? 'text-[#dc2626] dark:text-[#ff453a]'
                              : 'text-[#b45309] dark:text-[#fbbf24]'
                          }`}
                        >
                          {status === 'approved'
                            ? `✓ ${tr(UI_TEXT.statusApproved, lang)}`
                            : status === 'revision_needed'
                            ? `! ${tr(UI_TEXT.statusRevision, lang)}`
                            : `• ${tr(UI_TEXT.statusPending, lang)}`}
                        </span>
                      </div>
                      <div className="text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                        {r.date} · {r.teacherName} · {tr(UI_TEXT.present, lang)} {r.presentCount}/
                        {r.totalStudents} · {lang === 'ja' ? '雰囲気' : 'Suasana'} {r.atmosphere}/5
                      </div>
                    </div>

                    <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] space-x-3">
                      {r.kanaProgress && <span>かな: {r.kanaProgress}</span>}
                      {r.textbookUnit && <span>教材: {r.textbookUnit}</span>}
                      {r.examPractice && <span>対策: {r.examPractice}</span>}
                      {r.conversationTopic && <span>会話: {r.conversationTopic}</span>}
                      {r.kaigoTopic && <span>介護: {r.kaigoTopic}</span>}
                      {r.homework && <span>宿題: {r.homework}</span>}
                    </div>

                    <p className="text-[14px] text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-pre-line">
                      {r.overallComment}
                    </p>

                    {r.issues && (
                      <div className="inline-flex items-start gap-2 text-[12px] text-[#991b1b] dark:text-[#fca5a5] bg-[#fef2f2] dark:bg-[#2c1517] rounded-[12px] px-3 py-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>{r.issues}</span>
                      </div>
                    )}

                    {r.studentNotes && r.studentNotes.length > 0 && (
                      <div className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#f5f5f7] dark:bg-[#161617] rounded-[12px] p-3 space-y-1">
                        {r.studentNotes.map((sn, i) => (
                          <div key={i}>
                            <span className="font-semibold">{sn.studentName}:</span> {sn.note}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Head Approval & Feedback Controls */}
                    <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[16px] p-4 space-y-3">
                      <div className="flex items-center justify-between text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          <MessageSquare className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                          <span>
                            {lang === 'ja'
                              ? `${r.teacherName} 先生へのフィードバック`
                              : `Feedback untuk ${r.teacherName}`}
                          </span>
                        </span>
                        {r.approvedAt && (
                          <span className="font-mono text-[11px]">
                            {r.approvedBy} · {r.approvedAt}
                          </span>
                        )}
                      </div>

                      <textarea
                        rows={2}
                        maxLength={1500}
                        value={draftVal}
                        onChange={(e) =>
                          setFeedbackDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        placeholder={
                          lang === 'ja'
                            ? '先生へのコメント・アドバイスや修正指示を入力してください...'
                            : 'Tulis feedback, apresiasi, atau catatan perbaikan untuk sensei...'
                        }
                        className="w-full px-3.5 py-2 text-[14px] glass-input rounded-[12px]"
                      />

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[12px] font-medium text-[#15803d] dark:text-[#4ade80]">
                          {reviewSavedNotice[r.id] || ''}
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleReviewReport(r, 'revision_needed')}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                              status === 'revision_needed'
                                ? 'bg-[#dc2626] border-[#dc2626] text-white'
                                : 'border-[#d2d2d7] dark:border-[#424245] text-[#dc2626] dark:text-[#ff453a] hover:bg-white dark:hover:bg-[#2c2c2e]'
                            }`}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>
                              {lang === 'ja' ? '差し戻し（要修正）' : 'Kembalikan untuk Revisi'}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleReviewReport(r, 'approved')}
                            className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>
                              {lang === 'ja' ? '承認する (Approved)' : 'Setujui (Approved)'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filteredReports.length > 20 && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setShowAllReports((prev) => !prev)}
                className="px-4 py-2 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] whitespace-nowrap"
              >
                {showAllReports
                  ? lang === 'ja'
                    ? '最新20件のみ表示'
                    : 'Tampilkan 20 terbaru'
                  : lang === 'ja'
                  ? `すべて表示 (${filteredReports.length}件)`
                  : `Tampilkan semua (${filteredReports.length} laporan)`}
              </button>
            </div>
          )}
        </div>
      </AppleScrollReveal>

      {/* Threshold Configuration Modal */}
      <AnimatePresence>
        {thresholdModalOpen && (
          <AppleModalSheet
            open={thresholdModalOpen}
            onClose={() => setThresholdModalOpen(false)}
            maxWidthClass="max-w-md"
          >
            <form onSubmit={handleSaveThresholds} className="p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'id'
                    ? 'Pengaturan Kriteria Peringatan & Bobot'
                    : 'アラート判定基準・総合スコア配分'}
                </h3>
                <button
                  type="button"
                  onClick={() => setThresholdModalOpen(false)}
                  className="p-1.5 rounded-full text-[#6e6e73] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[12px]">
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Batas Min Rata² Mingguan (%)' : '週次平均 警告ライン (%)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={thDraft.minWeeklyAvgThreshold}
                    onChange={(e) =>
                      setThDraft((p) => ({
                        ...p,
                        minWeeklyAvgThreshold: Number(e.target.value),
                      }))
                    }
                    className="w-full glass-input px-3 py-2 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Turun Berturut-turut (Mgg)' : '連続低下 検知週数'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={thDraft.consecutiveDropWeeks}
                    onChange={(e) =>
                      setThDraft((p) => ({
                        ...p,
                        consecutiveDropWeeks: Number(e.target.value),
                      }))
                    }
                    className="w-full glass-input px-3 py-2 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Maks Absen (Hari)' : '欠席回数 警告基準'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={thDraft.maxAbsentDays}
                    onChange={(e) =>
                      setThDraft((p) => ({
                        ...p,
                        maxAbsentDays: Number(e.target.value),
                      }))
                    }
                    className="w-full glass-input px-3 py-2 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Batas Min Sikap (1–5)' : '態度スコア 警告ライン (1-5)'}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={1}
                    max={5}
                    value={thDraft.minAttitudeThreshold}
                    onChange={(e) =>
                      setThDraft((p) => ({
                        ...p,
                        minAttitudeThreshold: Number(e.target.value),
                      }))
                    }
                    className="w-full glass-input px-3 py-2 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Bobot Ujian Mingguan (%)' : '総合配分: 週次試験 (%)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={thDraft.examWeightPercent}
                    onChange={(e) =>
                      setThDraft((p) => ({
                        ...p,
                        examWeightPercent: Number(e.target.value),
                      }))
                    }
                    className="w-full glass-input px-3 py-2 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                    {lang === 'id' ? 'Bobot Sikap (%)' : '総合配分: 学習態度 (%)'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={thDraft.attitudeWeightPercent}
                    onChange={(e) =>
                      setThDraft((p) => ({
                        ...p,
                        attitudeWeightPercent: Number(e.target.value),
                      }))
                    }
                    className="w-full glass-input px-3 py-2 font-mono rounded-[10px]"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setThresholdModalOpen(false)}
                  className="px-4 py-2 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                >
                  {tr(UI_TEXT.cancel, lang)}
                </button>
                <button
                  type="submit"
                  disabled={savingQuality}
                  className="apple-btn-primary px-5 py-2 text-[12px] disabled:opacity-50"
                >
                  {tr(UI_TEXT.save, lang)}
                </button>
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Printable Wall Board Modal */}
      <WallBoardModal
        open={wallBoardOpen}
        lang={lang}
        rows={wallBoardRows}
        classFilter={wallClass}
        weekFilter={rankingWeekFilter}
        weekOptions={availableWeeks}
        metric={rankingMetric}
        thresholds={thresholds}
        onChangeClass={setWallClass}
        onChangeWeek={setRankingWeekFilter}
        onChangeMetric={setRankingMetric}
        onRegisterPrintView={onRegisterPrintView}
        onClose={() => setWallBoardOpen(false)}
      />
    </div>
  );
}
