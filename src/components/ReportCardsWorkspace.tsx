import React, { useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  AlertTriangle,
  Award,
  Check,
  CheckCircle2,
  Download,
  FileArchive,
  FileSpreadsheet,
  FileText,
  History,
  Lock,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Unlock,
  X,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel } from '../i18n';
import {
  CertificateRecord,
  CLASSES,
  ClassId,
  DailyReport,
  LanguageMode,
  ProgramDurationMonths,
  QualityThresholds,
  ReportCard,
  ReportCardPeriodType,
  ReportCardStatus,
  SchoolSettings,
  Student,
  TestResult,
  UserProfile,
  WeeklyReport,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { getClassTheme } from '../utils/classTheme';
import { getTodayDateStr } from '../utils/dateUtils';
import { clampStr } from '../utils/payloadGuards';
import {
  downloadElementAsPdf,
  exportBatchPdfsZip,
  exportReportCardsSummaryExcel,
} from '../utils/pdfExport';
import {
  checkCertificateEligibility,
  computeReportCardMetrics,
  getAvailablePeriodsForProgram,
  getStudentProgramProgress,
} from '../utils/programUtils';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import { AppleModalSheet } from './AppleGestures';
import { CertificateDocument } from './CertificateDocument';
import { ReportCardDocument } from './ReportCardDocument';

interface ReportCardsWorkspaceProps {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  staffUsers: UserProfile[];
  testResults: TestResult[];
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  reportCards: ReportCard[];
  certificates: CertificateRecord[];
  schoolSettings: SchoolSettings;
  thresholds: QualityThresholds;
  onRegisterPrintView: (node: React.ReactNode | null) => void;
}

function buildSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export const ReportCardsWorkspace: React.FC<ReportCardsWorkspaceProps> = ({
  lang,
  profile,
  students,
  staffUsers,
  testResults,
  dailyReports,
  weeklyReports,
  reportCards,
  certificates,
  schoolSettings,
  thresholds,
  onRegisterPrintView,
}) => {
  const isHead = profile.role === 'head';
  const today = getTodayDateStr();

  const [subTab, setSubTab] = useState<'reportCards' | 'certificates'>('reportCards');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  // Report Card Filters
  const [classFilter, setClassFilter] = useState<ClassId | 'all'>(
    isHead ? 'all' : profile.assignedClasses[0] || 'all'
  );
  const [programFilter, setProgramFilter] = useState<'all' | '2' | '4' | '6'>('all');
  const [senseiFilter, setSenseiFilter] = useState<string>('all');
  const [periodType, setPeriodType] = useState<ReportCardPeriodType>('monthly');
  const [periodMonth, setPeriodMonth] = useState<number>(1);
  const [search, setSearch] = useState('');

  // Report Card Editor Modal state
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [senseiCommentDraft, setSenseiCommentDraft] = useState('');
  const [headCommentDraft, setHeadCommentDraft] = useState('');
  const [issueDateDraft, setIssueDateDraft] = useState(today);
  const [unlockModalCard, setUnlockModalCard] = useState<ReportCard | null>(null);
  const [unlockReasonDraft, setUnlockReasonDraft] = useState('');

  // Offscreen Batch Capture Staging
  const [batchRenderCards, setBatchRenderCards] = useState<ReportCard[]>([]);
  const [batchRenderCerts, setBatchRenderCerts] = useState<CertificateRecord[]>([]);
  const batchStageRef = useRef<HTMLDivElement | null>(null);
  const singleReportRef = useRef<HTMLDivElement | null>(null);
  const singleCertRef = useRef<HTMLDivElement | null>(null);

  // Certificate Filters & Modals (Admin only)
  const [certClassFilter, setCertClassFilter] = useState<ClassId | 'all'>('all');
  const [certProgramFilter, setCertProgramFilter] = useState<'all' | '2' | '4' | '6'>('all');
  const [certSearch, setCertSearch] = useState('');
  const [overrideTarget, setOverrideTarget] = useState<{
    student: Student;
    reasonsJa: string[];
    reasonsId: string[];
  } | null>(null);
  const [overrideNoteDraft, setOverrideNoteDraft] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<CertificateRecord | null>(null);
  const [revokeReasonDraft, setRevokeReasonDraft] = useState('');
  const [previewCert, setPreviewCert] = useState<CertificateRecord | null>(null);

  const showNotice = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3600);
  };

  // Accessible students scoped strictly by role (unassigned students are excluded until assigned a class)
  const accessibleStudents = useMemo(() => {
    const allowed = new Set(profile.assignedClasses || []);
    return students.filter((s): s is Student & { classId: ClassId } => {
      if (!s.active || !s.classId) return false;
      if (isHead) return true;
      return allowed.has(s.classId);
    });
  }, [students, isHead, profile.assignedClasses]);

  // Sensei dropdown options
  const senseiOptions = useMemo(() => {
    return staffUsers.filter((u) => u.status === 'active' && u.role === 'teacher');
  }, [staffUsers]);

  // Helper: find active (non-superseded) ReportCard for (student, periodType, periodMonth)
  const activeCardByKey = useMemo(() => {
    const map = new Map<string, ReportCard>();
    reportCards.forEach((rc) => {
      if (rc.status === 'superseded') return;
      const key = `${rc.studentId}_${rc.periodType}_${rc.periodMonth}`;
      const existing = map.get(key);
      if (!existing || rc.version > existing.version) {
        map.set(key, rc);
      }
    });
    return map;
  }, [reportCards]);

  // Filtered students for Report Cards table
  const reportRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const senseiClasses =
      senseiFilter !== 'all'
        ? new Set(staffUsers.find((u) => u.uid === senseiFilter)?.assignedClasses || [])
        : null;

    return accessibleStudents
      .filter((s) => (classFilter === 'all' ? true : s.classId === classFilter))
      .filter((s) => (programFilter === 'all' ? true : String(s.programMonths || '') === programFilter))
      .filter((s) => (!senseiClasses ? true : senseiClasses.has(s.classId)))
      .filter((s) =>
        !q ? true : s.name.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q)
      )
      .sort((a, b) => a.classId.localeCompare(b.classId) || a.name.localeCompare(b.name))
      .map((student) => {
        const progress = getStudentProgramProgress(student, today);
        const effMonth =
          periodType === 'midterm'
            ? progress.programMonths === 6
              ? 3
              : 2
            : periodType === 'final'
              ? 0
              : periodMonth;

        let periodValid = false;
        if (progress.isConfigured && progress.valid && progress.programMonths) {
          const avail = getAvailablePeriodsForProgram(progress.programMonths);
          if (periodType === 'monthly') periodValid = avail.monthlyNumbers.includes(periodMonth);
          else if (periodType === 'midterm') periodValid = avail.hasMidterm;
          else periodValid = true;
        }

        const key = `${student.id}_${periodType}_${effMonth}`;
        const existingCard = activeCardByKey.get(key) || null;
        const computed =
          periodValid
            ? computeReportCardMetrics({
                student,
                allStudents: students,
                testResults,
                dailyReports,
                weeklyReports,
                periodType,
                periodMonth: effMonth,
                schoolSettings,
                qualityThresholds: thresholds,
                staffUsers,
              })
            : null;

        return {
          student,
          progress,
          periodValid,
          effMonth,
          existingCard,
          computed,
        };
      });
  }, [
    accessibleStudents,
    classFilter,
    programFilter,
    senseiFilter,
    staffUsers,
    search,
    today,
    periodType,
    periodMonth,
    activeCardByKey,
    students,
    testResults,
    dailyReports,
    weeklyReports,
    schoolSettings,
    thresholds,
  ]);

  const activeRow = useMemo(() => {
    if (!activeStudentId) return null;
    return reportRows.find((r) => r.student.id === activeStudentId) || null;
  }, [activeStudentId, reportRows]);

  const activeStudentVersionHistory = useMemo(() => {
    if (!activeRow) return [];
    return reportCards
      .filter(
        (rc) =>
          rc.studentId === activeRow.student.id &&
          rc.periodType === periodType &&
          rc.periodMonth === activeRow.effMonth
      )
      .sort((a, b) => b.version - a.version);
  }, [activeRow, reportCards, periodType]);

  const selectedModalCard: ReportCard | null = useMemo(() => {
    if (!activeRow) return null;
    if (activeCardId) {
      const found = reportCards.find((rc) => rc.id === activeCardId);
      if (found) return found;
    }
    if (activeRow.existingCard) {
      // If still draft or waiting_approval, reflect live comments draft in preview
      if (activeRow.existingCard.status !== 'finalized' && activeRow.existingCard.status !== 'superseded') {
        return {
          ...activeRow.existingCard,
          senseiComment: senseiCommentDraft,
          headComment: headCommentDraft,
          issueDate: issueDateDraft || activeRow.existingCard.issueDate,
        };
      }
      return activeRow.existingCard;
    }
    if (!activeRow.computed) return null;
    const c = activeRow.computed;
    return {
      id: 'preview',
      studentId: activeRow.student.id,
      studentName: activeRow.student.name,
      studentCode: activeRow.student.studentCode || '',
      classId: activeRow.student.classId,
      programMonths: c.programMonths,
      programStartDate: c.programStartDate,
      programEndDate: c.programEndDate,
      periodType: c.periodType,
      periodMonth: c.periodMonth,
      periodLabel: c.periodLabel,
      periodStartDate: c.periodStartDate,
      periodEndDate: c.periodEndDate,
      issueDate: issueDateDraft || today,
      version: 1,
      status: 'draft',
      senseiComment: senseiCommentDraft,
      headComment: headCommentDraft,
      monthlyRows: c.monthlyRows,
      categoryRows: c.categoryRows,
      weeklySeries: c.weeklySeries,
      cumulativeWeeklyAvg: c.cumulativeWeeklyAvg,
      attendanceTotalDays: c.attendanceTotalDays,
      attendancePresentDays: c.attendancePresentDays,
      attendanceAbsentDays: c.attendanceAbsentDays,
      attendanceLateDays: c.attendanceLateDays,
      attendanceRate: c.attendanceRate,
      attitudeAvg: c.attitudeAvg,
      attitudeSubAttendance: c.attitudeSubAttendance,
      attitudeSubDiscipline: c.attitudeSubDiscipline,
      attitudeSubEffort: c.attitudeSubEffort,
      attitudeSubCooperation: c.attitudeSubCooperation,
      attitudeGradeLabel: c.attitudeGradeLabel,
      overallCombinedAvg: c.overallCombinedAvg,
      overallGradeLabel: c.overallGradeLabel,
      gradeScaleMode: schoolSettings.gradeScaleMode,
      classRank: c.classRank,
      classSize: c.classSize,
      senseiName: c.senseiName,
      headMasterName: schoolSettings.headMasterName || '',
      submittedByUid: '',
      submittedByName: '',
      submittedAt: '',
      finalizedByUid: '',
      finalizedByName: '',
      finalizedAt: '',
      unlockedByName: '',
      unlockedReason: '',
      supersededById: '',
      createdBy: profile.uid,
    };
  }, [
    activeRow,
    activeCardId,
    reportCards,
    senseiCommentDraft,
    headCommentDraft,
    issueDateDraft,
    today,
    schoolSettings,
    profile.uid,
  ]);

  const openStudentModal = (row: (typeof reportRows)[number]) => {
    setActiveStudentId(row.student.id);
    setActiveCardId(row.existingCard?.id || null);
    setSenseiCommentDraft(row.existingCard?.senseiComment || '');
    setHeadCommentDraft(row.existingCard?.headComment || '');
    setIssueDateDraft(row.existingCard?.issueDate || today);
  };

  const buildPersistPayload = (
    row: (typeof reportRows)[number],
    status: ReportCardStatus,
    overrides?: Partial<ReportCard>
  ) => {
    const c = row.computed!;
    const existing = row.existingCard;
    const myName = clampStr(profile.nickname || profile.displayName, 100) || 'Staff';
    const nowIso = new Date().toISOString().slice(0, 16).replace('T', ' ');

    return {
      studentId: row.student.id,
      studentName: clampStr(row.student.name, 120),
      studentCode: clampStr(row.student.studentCode || '', 40),
      classId: row.student.classId,
      programMonths: c.programMonths,
      programStartDate: c.programStartDate,
      programEndDate: c.programEndDate,
      periodType: c.periodType,
      periodMonth: c.periodMonth,
      periodLabel: clampStr(c.periodLabel, 80),
      periodStartDate: c.periodStartDate,
      periodEndDate: c.periodEndDate,
      issueDate: issueDateDraft || today,
      version: overrides?.version ?? existing?.version ?? 1,
      status,
      senseiComment: clampStr(
        overrides?.senseiComment ?? senseiCommentDraft,
        2000
      ),
      headComment: clampStr(
        isHead ? (overrides?.headComment ?? headCommentDraft) : (existing?.headComment || ''),
        2000
      ),
      monthlyRows: c.monthlyRows,
      categoryRows: c.categoryRows,
      weeklySeries: c.weeklySeries,
      cumulativeWeeklyAvg: c.cumulativeWeeklyAvg,
      attendanceTotalDays: c.attendanceTotalDays,
      attendancePresentDays: c.attendancePresentDays,
      attendanceAbsentDays: c.attendanceAbsentDays,
      attendanceLateDays: c.attendanceLateDays,
      attendanceRate: c.attendanceRate,
      attitudeAvg: c.attitudeAvg,
      attitudeSubAttendance: c.attitudeSubAttendance,
      attitudeSubDiscipline: c.attitudeSubDiscipline,
      attitudeSubEffort: c.attitudeSubEffort,
      attitudeSubCooperation: c.attitudeSubCooperation,
      attitudeGradeLabel: c.attitudeGradeLabel,
      overallCombinedAvg: c.overallCombinedAvg,
      overallGradeLabel: c.overallGradeLabel,
      gradeScaleMode: schoolSettings.gradeScaleMode,
      classRank: c.classRank,
      classSize: c.classSize,
      senseiName: clampStr(c.senseiName, 100),
      headMasterName: clampStr(schoolSettings.headMasterName || '', 100),
      submittedByUid:
        status === 'waiting_approval' || status === 'finalized'
          ? existing?.submittedByUid || profile.uid
          : existing?.submittedByUid || '',
      submittedByName:
        status === 'waiting_approval' || status === 'finalized'
          ? existing?.submittedByName || myName
          : existing?.submittedByName || '',
      submittedAt:
        status === 'waiting_approval' || status === 'finalized'
          ? existing?.submittedAt || nowIso
          : existing?.submittedAt || '',
      finalizedByUid: status === 'finalized' ? profile.uid : '',
      finalizedByName: status === 'finalized' ? myName : '',
      finalizedAt: status === 'finalized' ? nowIso : '',
      unlockedByName: overrides?.unlockedByName ?? existing?.unlockedByName ?? '',
      unlockedReason: overrides?.unlockedReason ?? existing?.unlockedReason ?? '',
      supersededById: overrides?.supersededById ?? existing?.supersededById ?? '',
    };
  };

  const handleSaveReportCard = async (nextStatus: ReportCardStatus) => {
    if (!activeRow || !activeRow.computed) return;
    if (
      (nextStatus === 'waiting_approval' || nextStatus === 'finalized') &&
      !senseiCommentDraft.trim()
    ) {
      showNotice(
        lang === 'ja'
          ? '提出・確定の前に担任コメントを入力してください。'
          : 'Komentar wali kelas wajib diisi sebelum dikirim atau difinalisasi.'
      );
      return;
    }
    if (nextStatus === 'finalized' && !isHead) return;

    setBusy(true);
    try {
      const existing = activeRow.existingCard;
      const payload = buildPersistPayload(activeRow, nextStatus);
      const targetId =
        existing && existing.status !== 'superseded'
          ? existing.id
          : buildSafeDocId(`rc_${activeRow.student.id}_${periodType}${activeRow.effMonth}`);

      if (existing && existing.status !== 'superseded') {
        await updateDoc(doc(db, 'reportCards', targetId), {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'reportCards', targetId), {
          ...payload,
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setActiveCardId(targetId);

      await logActivity({
        actor: profile,
        actionType:
          nextStatus === 'finalized'
            ? 'report_card_finalize'
            : nextStatus === 'waiting_approval'
              ? 'report_card_submit'
              : 'report_card_draft',
        targetType: 'reportCard',
        targetLabel: `${activeRow.student.name} (${payload.periodLabel})`,
        detail: `Status -> ${nextStatus}`,
      });

      showNotice(
        nextStatus === 'finalized'
          ? lang === 'ja'
            ? '通知表を承認・確定（ロック）しました'
            : 'Rapor difinalisasi & dikunci'
          : nextStatus === 'waiting_approval'
            ? lang === 'ja'
              ? '承認申請を送信しました'
              : 'Rapor dikirim untuk persetujuan'
            : lang === 'ja'
              ? '下書きを保存しました'
              : 'Draft rapor disimpan'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'reportCards');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlockCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockModalCard || !isHead) return;
    const reason = clampStr(unlockReasonDraft, 300);
    if (!reason) return;
    setBusy(true);
    try {
      const actorName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
      await updateDoc(doc(db, 'reportCards', unlockModalCard.id), {
        status: 'draft',
        unlockedByName: actorName,
        unlockedReason: reason,
        finalizedByUid: '',
        finalizedByName: '',
        finalizedAt: '',
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'report_card_unlock',
        targetType: 'reportCard',
        targetLabel: `${unlockModalCard.studentName} (${unlockModalCard.periodLabel})`,
        detail: `Unlocked: ${reason}`,
      });
      setUnlockModalCard(null);
      setUnlockReasonDraft('');
      showNotice(lang === 'ja' ? '通知表のロックを解除しました' : 'Kunci rapor dibuka');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `reportCards/${unlockModalCard.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleReissueReportCard = async () => {
    if (!activeRow || !activeRow.computed || !activeRow.existingCard || !isHead) return;
    const oldCard = activeRow.existingCard;
    setBusy(true);
    try {
      const newId = buildSafeDocId(`rc_${activeRow.student.id}_${periodType}${activeRow.effMonth}`);
      const payload = buildPersistPayload(activeRow, 'draft', {
        version: oldCard.version + 1,
        senseiComment: oldCard.senseiComment,
        headComment: oldCard.headComment,
        unlockedByName: '',
        unlockedReason: '',
        supersededById: '',
      });

      const batch = writeBatch(db);
      batch.update(doc(db, 'reportCards', oldCard.id), {
        status: 'superseded',
        supersededById: newId,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'reportCards', newId), {
        ...payload,
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      await logActivity({
        actor: profile,
        actionType: 'report_card_reissue',
        targetType: 'reportCard',
        targetLabel: `${activeRow.student.name} (${payload.periodLabel})`,
        detail: `Reissued v${oldCard.version + 1}; v${oldCard.version} marked Superseded`,
      });

      setActiveCardId(newId);
      setSenseiCommentDraft(oldCard.senseiComment);
      setHeadCommentDraft(oldCard.headComment);
      showNotice(
        lang === 'ja'
          ? `第${oldCard.version + 1}版を下書き作成しました（旧版は履歴保存）`
          : `Versi v${oldCard.version + 1} dibuat (versi lama ditandai Superseded)`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'reportCards');
    } finally {
      setBusy(false);
    }
  };

  // Bulk Actions for Report Cards
  const handleBulkGenerateDrafts = async () => {
    const targets = reportRows.filter((r) => r.periodValid && r.computed && !r.existingCard);
    if (targets.length === 0) {
      showNotice(
        lang === 'ja'
          ? '新規作成対象の学生がいません。'
          : 'Tidak ada siswa baru yang perlu dibuatkan draft.'
      );
      return;
    }
    setBusy(true);
    try {
      const batch = writeBatch(db);
      targets.forEach((row) => {
        const cardId = buildSafeDocId(`rc_${row.student.id}_${periodType}${row.effMonth}`);
        const c = row.computed!;
        batch.set(doc(db, 'reportCards', cardId), {
          studentId: row.student.id,
          studentName: clampStr(row.student.name, 120),
          studentCode: clampStr(row.student.studentCode || '', 40),
          classId: row.student.classId,
          programMonths: c.programMonths,
          programStartDate: c.programStartDate,
          programEndDate: c.programEndDate,
          periodType: c.periodType,
          periodMonth: c.periodMonth,
          periodLabel: clampStr(c.periodLabel, 80),
          periodStartDate: c.periodStartDate,
          periodEndDate: c.periodEndDate,
          issueDate: today,
          version: 1,
          status: 'draft',
          senseiComment: '',
          headComment: '',
          monthlyRows: c.monthlyRows,
          categoryRows: c.categoryRows,
          weeklySeries: c.weeklySeries,
          cumulativeWeeklyAvg: c.cumulativeWeeklyAvg,
          attendanceTotalDays: c.attendanceTotalDays,
          attendancePresentDays: c.attendancePresentDays,
          attendanceAbsentDays: c.attendanceAbsentDays,
          attendanceLateDays: c.attendanceLateDays,
          attendanceRate: c.attendanceRate,
          attitudeAvg: c.attitudeAvg,
          attitudeSubAttendance: c.attitudeSubAttendance,
          attitudeSubDiscipline: c.attitudeSubDiscipline,
          attitudeSubEffort: c.attitudeSubEffort,
          attitudeSubCooperation: c.attitudeSubCooperation,
          attitudeGradeLabel: c.attitudeGradeLabel,
          overallCombinedAvg: c.overallCombinedAvg,
          overallGradeLabel: c.overallGradeLabel,
          gradeScaleMode: schoolSettings.gradeScaleMode,
          classRank: c.classRank,
          classSize: c.classSize,
          senseiName: clampStr(c.senseiName, 100),
          headMasterName: clampStr(schoolSettings.headMasterName || '', 100),
          submittedByUid: '',
          submittedByName: '',
          submittedAt: '',
          finalizedByUid: '',
          finalizedByName: '',
          finalizedAt: '',
          unlockedByName: '',
          unlockedReason: '',
          supersededById: '',
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();

      await logActivity({
        actor: profile,
        actionType: 'report_card_draft',
        targetType: 'reportCard',
        targetLabel: `${classLabel(classFilter, lang)} (${targets.length}名)`,
        detail: `Bulk generated ${targets.length} drafts (${periodType})`,
      });
      showNotice(
        lang === 'ja'
          ? `${targets.length}名分の下書きを一括生成しました`
          : `${targets.length} draft rapor berhasil dibuat`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'reportCards');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkFinalize = async () => {
    if (!isHead) return;
    const targets = reportRows.filter(
      (r) =>
        r.existingCard &&
        r.existingCard.status === 'waiting_approval' &&
        r.existingCard.senseiComment.trim().length > 0
    );
    if (targets.length === 0) {
      showNotice(
        lang === 'ja'
          ? '「承認待ち」の通知表がありません。'
          : 'Tidak ada rapor berstatus Menunggu Persetujuan.'
      );
      return;
    }
    setBusy(true);
    try {
      const batch = writeBatch(db);
      const actorName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
      const nowIso = new Date().toISOString().slice(0, 16).replace('T', ' ');
      targets.forEach((row) => {
        batch.update(doc(db, 'reportCards', row.existingCard!.id), {
          status: 'finalized',
          finalizedByUid: profile.uid,
          finalizedByName: actorName,
          finalizedAt: nowIso,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      await logActivity({
        actor: profile,
        actionType: 'report_card_finalize',
        targetType: 'reportCard',
        targetLabel: `Bulk (${targets.length})`,
        detail: `Bulk finalized ${targets.length} report cards`,
      });
      showNotice(
        lang === 'ja'
          ? `${targets.length}件の通知表を一括確定しました`
          : `${targets.length} rapor difinalisasi`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'reportCards');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkPrintCards = () => {
    const printableCards = reportRows
      .map((r) => r.existingCard)
      .filter((c): c is ReportCard => Boolean(c));
    if (printableCards.length === 0) {
      showNotice(
        lang === 'ja'
          ? '印刷可能な通知表がまだ作成されていません。先に「一括下書き作成」を実行してください。'
          : 'Belum ada rapor yang dibuat untuk filter ini.'
      );
      return;
    }
    onRegisterPrintView(
      <div>
        {printableCards.map((c) => (
          <div key={c.id} className="print-page-break">
            <ReportCardDocument card={c} settings={schoolSettings} />
          </div>
        ))}
      </div>
    );
    window.setTimeout(() => window.print(), 160);
  };

  const handleBatchZipCards = async () => {
    const printableCards = reportRows
      .map((r) => r.existingCard)
      .filter((c): c is ReportCard => Boolean(c));
    if (printableCards.length === 0) {
      showNotice(
        lang === 'ja'
          ? 'ZIP出力対象の通知表がありません。先に下書きを作成してください。'
          : 'Belum ada rapor untuk diunduh sebagai ZIP.'
      );
      return;
    }
    setBatchRenderCards(printableCards);
    setZipProgress({ done: 0, total: printableCards.length });
    await new Promise((r) => setTimeout(r, 250));

    try {
      const container = batchStageRef.current;
      if (!container) return;
      const items = printableCards
        .map((c) => {
          const el = container.querySelector<HTMLElement>(`[data-batch-rc="${c.id}"]`);
          if (!el) return null;
          const safeName = `${c.studentCode || c.studentId}_${c.studentName}_${c.periodType}`.replace(
            /[^a-zA-Z0-9_\-\u3040-\u30ff\u4e00-\u9faf]/g,
            '_'
          );
          return {
            filename: safeName,
            element: el,
            orientation: 'portrait' as const,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      await exportBatchPdfsZip(
        items,
        `report_cards_${classFilter}_${today}.zip`,
        (done, total) => setZipProgress({ done, total })
      );
      showNotice(
        lang === 'ja'
          ? `${items.length}件のPDFをZIPでダウンロードしました`
          : `ZIP berisi ${items.length} PDF diunduh`
      );
    } finally {
      setBatchRenderCards([]);
      setZipProgress(null);
    }
  };

  // ==================== CERTIFICATES SECTION (Admin Only) ====================
  const certRows = useMemo(() => {
    if (!isHead) return [];
    const q = certSearch.trim().toLowerCase();
    return students
      .filter((s): s is Student & { classId: ClassId } => s.active && Boolean(s.classId))
      .filter((s) => (certClassFilter === 'all' ? true : s.classId === certClassFilter))
      .filter((s) =>
        certProgramFilter === 'all' ? true : String(s.programMonths || '') === certProgramFilter
      )
      .filter((s) =>
        !q ? true : s.name.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q)
      )
      .sort((a, b) => a.classId.localeCompare(b.classId) || a.name.localeCompare(b.name))
      .map((student) => {
        const elig = checkCertificateEligibility({
          student,
          allStudents: students,
          testResults,
          dailyReports,
          weeklyReports,
          schoolSettings,
          qualityThresholds: thresholds,
          todayStr: today,
        });
        const stuCerts = certificates
          .filter((c) => c.studentId === student.id)
          .sort((a, b) => b.version - a.version);
        const activeCert = stuCerts.find((c) => c.status === 'valid') || stuCerts[0] || null;
        return { student, elig, stuCerts, activeCert };
      });
  }, [
    isHead,
    students,
    certClassFilter,
    certProgramFilter,
    certSearch,
    testResults,
    dailyReports,
    weeklyReports,
    schoolSettings,
    thresholds,
    today,
    certificates,
  ]);

  const issueCertificateInternal = async (params: {
    student: Student;
    overrideUsed: boolean;
    overrideNote: string;
    oldCertToSupersede?: CertificateRecord | null;
  }): Promise<CertificateRecord | null> => {
    const { student, overrideUsed, overrideNote, oldCertToSupersede } = params;
    if (!student.classId) return null;
    const assignedClassId: ClassId = student.classId;
    const elig = checkCertificateEligibility({
      student,
      allStudents: students,
      testResults,
      dailyReports,
      weeklyReports,
      schoolSettings,
      qualityThresholds: thresholds,
      todayStr: today,
    });
    if (!elig.configured || !elig.metrics.programMonths) return null;

    const year = new Date().getFullYear();
    const schoolCode = (schoolSettings.schoolCode || 'GA').toUpperCase();
    const counterId = `cert_${year}`;
    const counterRef = doc(db, 'counters', counterId);
    const actorName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';

    let mintedCertNumber = '';
    const newVersion = oldCertToSupersede ? oldCertToSupersede.version + 1 : 1;

    await runTransaction(db, async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const prevSeq = counterSnap.exists() ? Number(counterSnap.data().lastSeq || 0) : 0;
      const nextSeq = prevSeq + 1;
      mintedCertNumber = `${schoolCode}-${year}-${String(nextSeq).padStart(4, '0')}`;

      tx.set(counterRef, {
        year,
        lastSeq: nextSeq,
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      });

      if (oldCertToSupersede) {
        tx.update(doc(db, 'certificates', oldCertToSupersede.id), {
          status: 'superseded',
          supersededById: mintedCertNumber,
          updatedAt: serverTimestamp(),
        });
        tx.update(doc(db, 'certificateVerifications', oldCertToSupersede.certificateNumber), {
          status: 'revoked',
          updatedAt: serverTimestamp(),
        });
      }

      const certData = {
        certificateNumber: mintedCertNumber,
        studentId: student.id,
        studentName: clampStr(student.name, 120),
        studentCode: clampStr(student.studentCode || '', 40),
        classId: assignedClassId,
        programMonths: elig.metrics.programMonths!,
        programStartDate: elig.metrics.startDate,
        programEndDate: elig.metrics.endDate,
        completionDate: elig.metrics.endDate,
        issueDate: today,
        version: newVersion,
        status: 'valid' as const,
        finalAvg: elig.metrics.finalAvg,
        attendanceRate: elig.metrics.attendanceRate,
        attitudeAvg: elig.metrics.attitudeAvg,
        overallGradeLabel: elig.metrics.overallGradeLabel || '—',
        overrideUsed,
        overrideNote: clampStr(overrideNote, 400),
        revokeReason: '',
        revokedAt: '',
        revokedByName: '',
        supersededById: '',
        issuedByUid: profile.uid,
        issuedByName: actorName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      tx.set(doc(db, 'certificates', mintedCertNumber), certData);
      tx.set(doc(db, 'certificateVerifications', mintedCertNumber), {
        certificateNumber: mintedCertNumber,
        studentName: clampStr(student.name, 120),
        programLabel: `日本語学習プログラム（${elig.metrics.programMonths}か月）`,
        completionDate: elig.metrics.endDate,
        issueDate: today,
        schoolNameJa: clampStr(schoolSettings.schoolNameJa, 120),
        status: 'valid',
        updatedAt: serverTimestamp(),
      });
    });

    await logActivity({
      actor: profile,
      actionType: oldCertToSupersede
        ? 'certificate_reissue'
        : overrideUsed
          ? 'certificate_override'
          : 'certificate_issue',
      targetType: 'certificate',
      targetLabel: `${student.name} (${mintedCertNumber})`,
      detail: oldCertToSupersede
        ? `Reissued v${newVersion}; superseded ${oldCertToSupersede.certificateNumber}`
        : overrideUsed
          ? `Override note: ${clampStr(overrideNote, 200)}`
          : 'Eligible criteria met; issued certificate',
    });

    return {
      id: mintedCertNumber,
      certificateNumber: mintedCertNumber,
      studentId: student.id,
      studentName: student.name,
      studentCode: student.studentCode || '',
      classId: assignedClassId,
      programMonths: elig.metrics.programMonths,
      programStartDate: elig.metrics.startDate,
      programEndDate: elig.metrics.endDate,
      completionDate: elig.metrics.endDate,
      issueDate: today,
      version: newVersion,
      status: 'valid',
      finalAvg: elig.metrics.finalAvg,
      attendanceRate: elig.metrics.attendanceRate,
      attitudeAvg: elig.metrics.attitudeAvg,
      overallGradeLabel: elig.metrics.overallGradeLabel || '—',
      overrideUsed,
      overrideNote,
      revokeReason: '',
      revokedAt: '',
      revokedByName: '',
      supersededById: '',
      issuedByUid: profile.uid,
      issuedByName: actorName,
    };
  };

  const handleIssueCertClick = async (row: (typeof certRows)[number]) => {
    if (!row.elig.configured) return;
    if (!row.elig.eligible) {
      setOverrideTarget({
        student: row.student,
        reasonsJa: row.elig.reasonsJa,
        reasonsId: row.elig.reasonsId,
      });
      setOverrideNoteDraft('');
      return;
    }
    setBusy(true);
    try {
      const created = await issueCertificateInternal({
        student: row.student,
        overrideUsed: false,
        overrideNote: '',
        oldCertToSupersede: row.activeCert?.status === 'valid' ? row.activeCert : null,
      });
      if (created) {
        setPreviewCert(created);
        showNotice(
          lang === 'ja'
            ? `修了証書 ${created.certificateNumber} を発行しました`
            : `Sertifikat ${created.certificateNumber} diterbitkan`
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'certificates');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmOverrideIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideTarget || !overrideNoteDraft.trim()) return;
    const row = certRows.find((r) => r.student.id === overrideTarget.student.id);
    setBusy(true);
    try {
      const created = await issueCertificateInternal({
        student: overrideTarget.student,
        overrideUsed: true,
        overrideNote: overrideNoteDraft.trim(),
        oldCertToSupersede: row?.activeCert?.status === 'valid' ? row.activeCert : null,
      });
      setOverrideTarget(null);
      setOverrideNoteDraft('');
      if (created) {
        setPreviewCert(created);
        showNotice(
          lang === 'ja'
            ? `例外承認にて修了証書 ${created.certificateNumber} を発行しました`
            : `Sertifikat ${created.certificateNumber} diterbitkan (override)`
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'certificates');
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeTarget || !revokeReasonDraft.trim()) return;
    setBusy(true);
    try {
      const actorName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
      const nowIso = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const batch = writeBatch(db);
      batch.update(doc(db, 'certificates', revokeTarget.id), {
        status: 'revoked',
        revokeReason: clampStr(revokeReasonDraft, 400),
        revokedAt: nowIso,
        revokedByName: actorName,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(db, 'certificateVerifications', revokeTarget.certificateNumber), {
        status: 'revoked',
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      await logActivity({
        actor: profile,
        actionType: 'certificate_revoke',
        targetType: 'certificate',
        targetLabel: `${revokeTarget.studentName} (${revokeTarget.certificateNumber})`,
        detail: `Revoked: ${clampStr(revokeReasonDraft, 200)}`,
      });
      setRevokeTarget(null);
      setRevokeReasonDraft('');
      showNotice(lang === 'ja' ? '修了証書を無効化しました' : 'Sertifikat dibatalkan (Revoked)');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `certificates/${revokeTarget.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkIssueEligibleCerts = async () => {
    const eligibleTargets = certRows.filter(
      (r) => r.elig.eligible && (!r.activeCert || r.activeCert.status !== 'valid')
    );
    if (eligibleTargets.length === 0) {
      showNotice(
        lang === 'ja'
          ? '未発行の条件達成者がいません。'
          : 'Tidak ada siswa yang memenuhi syarat dan belum memiliki sertifikat.'
      );
      return;
    }
    setBusy(true);
    let count = 0;
    try {
      for (const r of eligibleTargets) {
        await issueCertificateInternal({
          student: r.student,
          overrideUsed: false,
          overrideNote: '',
        });
        count += 1;
      }
      showNotice(
        lang === 'ja'
          ? `${count}名に修了証書を発行しました`
          : `${count} sertifikat berhasil diterbitkan`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'certificates');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkPrintCerts = () => {
    const validCerts = certRows
      .map((r) => r.activeCert)
      .filter((c): c is CertificateRecord => Boolean(c && c.status === 'valid'));
    if (validCerts.length === 0) {
      showNotice(
        lang === 'ja' ? '有効な修了証書がありません。' : 'Tidak ada sertifikat aktif untuk dicetak.'
      );
      return;
    }
    onRegisterPrintView(
      <div>
        <style>{`@media print { @page { size: A4 landscape; margin: 6mm; } }`}</style>
        {validCerts.map((c) => (
          <div key={c.id} className="print-page-break">
            <CertificateDocument certificate={c} settings={schoolSettings} />
          </div>
        ))}
      </div>
    );
    window.setTimeout(() => window.print(), 180);
  };

  const handleBatchZipCerts = async () => {
    const validCerts = certRows
      .map((r) => r.activeCert)
      .filter((c): c is CertificateRecord => Boolean(c && c.status === 'valid'));
    if (validCerts.length === 0) {
      showNotice(
        lang === 'ja' ? '有効な修了証書がありません。' : 'Tidak ada sertifikat aktif.'
      );
      return;
    }
    setBatchRenderCerts(validCerts);
    setZipProgress({ done: 0, total: validCerts.length });
    await new Promise((r) => setTimeout(r, 350));
    try {
      const container = batchStageRef.current;
      if (!container) return;
      const items = validCerts
        .map((c) => {
          const el = container.querySelector<HTMLElement>(`[data-batch-cert="${c.id}"]`);
          if (!el) return null;
          return {
            filename: `${c.certificateNumber}_${c.studentName}`.replace(
              /[^a-zA-Z0-9_\-\u3040-\u30ff\u4e00-\u9faf]/g,
              '_'
            ),
            element: el,
            orientation: 'landscape' as const,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      await exportBatchPdfsZip(
        items,
        `certificates_${certClassFilter}_${today}.zip`,
        (done, total) => setZipProgress({ done, total })
      );
      showNotice(
        lang === 'ja'
          ? `${items.length}枚の修了証書PDFをZIP出力しました`
          : `ZIP berisi ${items.length} sertifikat diunduh`
      );
    } finally {
      setBatchRenderCerts([]);
      setZipProgress(null);
    }
  };

  const statusBadge = (status: ReportCardStatus | null) => {
    if (!status) {
      return (
        <span className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
          {lang === 'ja' ? '未作成' : 'Belum dibuat'}
        </span>
      );
    }
    if (status === 'finalized') {
      return (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[#15803d] dark:text-[#4ade80]">
          <Lock className="w-3 h-3" />
          <span>{lang === 'ja' ? '確定済' : 'Final'}</span>
        </span>
      );
    }
    if (status === 'waiting_approval') {
      return (
        <span className="text-[12px] font-medium text-[#b45309] dark:text-[#fbbf24]">
          {lang === 'ja' ? '承認待ち' : 'Menunggu Persetujuan'}
        </span>
      );
    }
    return (
      <span className="text-[12px] font-medium text-[#0071e3] dark:text-[#2997ff]">
        {lang === 'ja' ? '下書き' : 'Draft'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <LiquidToast message={toast} />

      {/* Header + Sub-Tab Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {lang === 'ja' ? '成績通知表・修了証書' : 'Rapor & Sertifikat Kelulusan'}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'ja'
              ? '週次テスト公式点・出席・学習態度を自動集計し、通知表（A4縦）および修了証書（A4横）を発行します。'
              : 'Rekap otomatis nilai ujian mingguan resmi, absensi, dan sikap untuk rapor (A4) & sertifikat.'}
          </p>
        </div>

        {isHead && (
          <div className="inline-flex p-1 rounded-full bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/60 dark:border-[#424245]">
            <button
              type="button"
              onClick={() => setSubTab('reportCards')}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
                subTab === 'reportCards'
                  ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-2xs'
                  : 'text-[#6e6e73] dark:text-[#86868b]'
              }`}
            >
              {lang === 'ja' ? '成績通知表' : 'Rapor (Tsuuchihyou)'}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('certificates')}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
                subTab === 'certificates'
                  ? 'bg-white dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-2xs'
                  : 'text-[#6e6e73] dark:text-[#86868b]'
              }`}
            >
              {lang === 'ja' ? '修了証書' : 'Sertifikat Kelulusan'}
            </button>
          </div>
        )}
      </div>

      {/* ==================== TAB 1: REPORT CARDS ==================== */}
      {subTab === 'reportCards' && (
        <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
          {/* Filters */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 text-[13px]">
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value as ClassId | 'all')}
              className="glass-input px-3 py-2 rounded-[12px]"
            >
              {isHead && <option value="all">{lang === 'ja' ? '全クラス' : 'Semua Kelas'}</option>}
              {CLASSES.filter(
                (c) => isHead || (profile.assignedClasses || []).includes(c.id)
              ).map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>

            <select
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value as 'all' | '2' | '4' | '6')}
              className="glass-input px-3 py-2 rounded-[12px]"
            >
              <option value="all">{lang === 'ja' ? '全コース (2/4/6か月)' : 'Semua Durasi'}</option>
              <option value="2">2か月 / 2 Bulan</option>
              <option value="4">4か月 / 4 Bulan</option>
              <option value="6">6か月 / 6 Bulan</option>
            </select>

            {isHead && (
              <select
                value={senseiFilter}
                onChange={(e) => setSenseiFilter(e.target.value)}
                className="glass-input px-3 py-2 rounded-[12px]"
              >
                <option value="all">{lang === 'ja' ? '全担任' : 'Semua Sensei'}</option>
                {senseiOptions.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.nickname || u.displayName}
                  </option>
                ))}
              </select>
            )}

            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as ReportCardPeriodType)}
              className="glass-input px-3 py-2 rounded-[12px]"
            >
              <option value="monthly">{lang === 'ja' ? '月次通知表' : 'Bulanan'}</option>
              <option value="midterm">{lang === 'ja' ? '中間通知表 (4・6か月)' : 'Tengah Program'}</option>
              <option value="final">{lang === 'ja' ? '最終成績通知表' : 'Rapor Akhir'}</option>
            </select>

            {periodType === 'monthly' && (
              <select
                value={periodMonth}
                onChange={(e) => setPeriodMonth(Number(e.target.value))}
                className="glass-input px-3 py-2 rounded-[12px]"
              >
                {[1, 2, 3, 4, 5, 6].map((m) => (
                  <option key={m} value={m}>
                    {lang === 'ja' ? `第${m}か月` : `Bulan ${m}`}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#6e6e73] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === 'ja' ? '学生検索...' : 'Cari siswa...'}
                className="w-full glass-input pl-8 pr-3 py-2 rounded-[12px]"
              />
            </div>
          </div>

          {/* Bulk Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50">
            <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
              {zipProgress
                ? `PDF生成中: ${zipProgress.done} / ${zipProgress.total}...`
                : lang === 'ja'
                  ? `対象学生 ${reportRows.length}名（週次テストのみ公式スコア使用）`
                  : `${reportRows.length} siswa (skor resmi hanya dari ujian mingguan)`}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleBulkGenerateDrafts}
                className="apple-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '一括下書き作成' : 'Buat Draft Kelas'}</span>
              </button>

              {isHead && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleBulkFinalize}
                  className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '一括確定' : 'Finalisasi Semua'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleBulkPrintCards}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '一括印刷' : 'Cetak Semua'}</span>
              </button>

              <button
                type="button"
                disabled={Boolean(zipProgress)}
                onClick={handleBatchZipCards}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
              >
                <FileArchive className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '一括PDF (ZIP)' : 'ZIP PDF'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  exportReportCardsSummaryExcel({
                    cards: reportRows
                      .map((r) => r.existingCard)
                      .filter((c): c is ReportCard => Boolean(c)),
                    certificates,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
            </div>
          </div>

          {/* Table */}
          {reportRows.length === 0 ? (
            <EmptyStateIllustration
              kind="clipboard"
              title={lang === 'ja' ? '該当する学生がいません' : 'Tidak ada siswa sesuai filter'}
            />
          ) : (
            <div className="apple-table-wrap apple-scroll-x">
              <table className="w-full text-[13px] text-left border-collapse min-w-[780px]">
                <thead className="bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245] text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  <tr>
                    <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '学生' : 'Siswa'}</th>
                    <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '受講コース' : 'Program'}</th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      {lang === 'ja' ? '週次平均' : 'Ujian Mingguan'}
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      {lang === 'ja' ? '出席率' : 'Hadir'}
                    </th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      {lang === 'ja' ? '態度' : 'Sikap'}
                    </th>
                    <th className="py-2.5 px-3 font-medium text-center">
                      {lang === 'ja' ? '総合評価' : 'Nilai'}
                    </th>
                    <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '状態' : 'Status'}</th>
                    <th className="py-2.5 px-3 font-medium text-right">
                      {lang === 'ja' ? '操作' : 'Aksi'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row) => {
                    const clsTheme = getClassTheme(row.student.classId);
                    const card = row.existingCard;
                    const metrics = row.computed;
                    const avgDisplay = card
                      ? card.cumulativeWeeklyAvg
                      : metrics?.cumulativeWeeklyAvg ?? null;
                    const attRateDisplay = card
                      ? card.attendanceRate
                      : metrics?.attendanceRate ?? null;
                    const attitudeDisplay = card
                      ? card.attitudeAvg
                      : metrics?.attitudeAvg ?? null;
                    const gradeDisplay = card
                      ? card.overallGradeLabel
                      : metrics?.overallGradeLabel || '—';

                    return (
                      <tr key={row.student.id} className="apple-table-row">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {row.student.name}
                          </div>
                          <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b] flex items-center gap-1.5">
                            {clsTheme && <span className={`w-1.5 h-1.5 rounded-full ${clsTheme.dotColor}`} />}
                            <span>{classLabel(row.student.classId, lang)}</span>
                            {row.student.studentCode ? <span>· {row.student.studentCode}</span> : null}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-[12px] tabular-nums">
                          {row.progress.isConfigured && row.progress.valid ? (
                            <div>
                              <span className="font-medium">{row.progress.programMonths}か月</span>
                              <span className="text-[#6e6e73] dark:text-[#86868b] block text-[11px]">
                                Month {row.progress.currentMonth} of {row.progress.totalMonths}
                              </span>
                            </div>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">
                              {lang === 'ja' ? '期間未設定' : 'Belum diatur'}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {avgDisplay !== null ? `${avgDisplay}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {attRateDisplay !== null ? `${attRateDisplay}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {attitudeDisplay !== null ? `${attitudeDisplay.toFixed(1)}` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold">
                          {row.periodValid ? gradeDisplay : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          {!row.progress.isConfigured ? (
                            <span className="text-[11px] text-[#6e6e73]">—</span>
                          ) : !row.periodValid ? (
                            <span className="text-[11px] text-[#6e6e73]">
                              {lang === 'ja' ? '対象外' : 'Tidak berlaku'}
                            </span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {statusBadge(card?.status || null)}
                              {card && card.version > 1 && (
                                <span className="text-[10px] font-mono text-[#6e6e73]">
                                  v{card.version}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {row.periodValid && (
                            <button
                              type="button"
                              onClick={() => openStudentModal(row)}
                              className="apple-btn-secondary px-3 py-1 text-[12px]"
                            >
                              {card
                                ? lang === 'ja'
                                  ? '編集・プレビュー'
                                  : 'Edit & Pratinjau'
                                : lang === 'ja'
                                  ? '作成・確認'
                                  : 'Buat Rapor'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB 2: CERTIFICATES (ADMIN ONLY) ==================== */}
      {subTab === 'certificates' && isHead && (
        <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-[13px]">
            <select
              value={certClassFilter}
              onChange={(e) => setCertClassFilter(e.target.value as ClassId | 'all')}
              className="glass-input px-3 py-2 rounded-[12px]"
            >
              <option value="all">{lang === 'ja' ? '全クラス' : 'Semua Kelas'}</option>
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>
            <select
              value={certProgramFilter}
              onChange={(e) => setCertProgramFilter(e.target.value as 'all' | '2' | '4' | '6')}
              className="glass-input px-3 py-2 rounded-[12px]"
            >
              <option value="all">{lang === 'ja' ? '全コース' : 'Semua Durasi'}</option>
              <option value="2">2か月</option>
              <option value="4">4か月</option>
              <option value="6">6か月</option>
            </select>
            <div className="sm:col-span-2 relative">
              <Search className="w-3.5 h-3.5 text-[#6e6e73] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={certSearch}
                onChange={(e) => setCertSearch(e.target.value)}
                placeholder={lang === 'ja' ? '学生検索...' : 'Cari siswa...'}
                className="w-full glass-input pl-8 pr-3 py-2 rounded-[12px]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50">
            <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
              {zipProgress
                ? `PDF生成中: ${zipProgress.done} / ${zipProgress.total}...`
                : lang === 'ja'
                  ? `授与基準: 最終平均 ≥ ${schoolSettings.certMinFinalAvg}% · 出席率 ≥ ${schoolSettings.certMinAttendanceRate}% · 態度 ≥ ${schoolSettings.certMinAttitudeScore.toFixed(1)}`
                  : `Syarat: Rata² ≥ ${schoolSettings.certMinFinalAvg}% · Hadir ≥ ${schoolSettings.certMinAttendanceRate}% · Sikap ≥ ${schoolSettings.certMinAttitudeScore.toFixed(1)}`}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleBulkIssueEligibleCerts}
                className="apple-btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
              >
                <Award className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '条件達成者へ一括発行' : 'Terbitkan Semua yg Memenuhi'}</span>
              </button>
              <button
                type="button"
                onClick={handleBulkPrintCerts}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245]"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '一括印刷' : 'Cetak Semua'}</span>
              </button>
              <button
                type="button"
                disabled={Boolean(zipProgress)}
                onClick={handleBatchZipCerts}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245]"
              >
                <FileArchive className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '一括PDF (ZIP)' : 'ZIP PDF'}</span>
              </button>
            </div>
          </div>

          <div className="apple-table-wrap apple-scroll-x">
            <table className="w-full text-[13px] text-left border-collapse min-w-[820px]">
              <thead className="bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245] text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                <tr>
                  <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '学生' : 'Siswa'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '受講期間' : 'Periode'}</th>
                  <th className="py-2.5 px-3 font-medium text-right">{lang === 'ja' ? '平均 / 出席 / 態度' : 'Nilai / Hadir / Sikap'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '授与資格' : 'Kelayakan'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'ja' ? '証書番号' : 'No. Sertifikat'}</th>
                  <th className="py-2.5 px-3 font-medium text-right">{lang === 'ja' ? '操作' : 'Aksi'}</th>
                </tr>
              </thead>
              <tbody>
                {certRows.map((row) => {
                  const cert = row.activeCert;
                  return (
                    <tr key={row.student.id} className="apple-table-row">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold">{row.student.name}</div>
                        <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                          {classLabel(row.student.classId, lang)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[12px] tabular-nums">
                        {row.elig.configured ? (
                          <>
                            <span>{row.elig.metrics.programMonths}か月</span>
                            <span className="block text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                              {row.elig.metrics.startDate} 〜 {row.elig.metrics.endDate}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[12px]">
                        {row.elig.metrics.finalAvg ?? '—'}% · {row.elig.metrics.attendanceRate ?? '—'}% ·{' '}
                        {row.elig.metrics.attitudeAvg !== null
                          ? row.elig.metrics.attitudeAvg.toFixed(1)
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-[12px]">
                        {row.elig.eligible ? (
                          <span className="inline-flex items-center gap-1 text-[#15803d] dark:text-[#4ade80] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{lang === 'ja' ? '資格達成' : 'Memenuhi Syarat'}</span>
                          </span>
                        ) : (
                          <div className="text-amber-700 dark:text-amber-400 text-[11px] space-y-0.5">
                            {(lang === 'ja' ? row.elig.reasonsJa : row.elig.reasonsId).map((rs, idx) => (
                              <div key={idx}>• {rs}</div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[12px]">
                        {cert ? (
                          <div>
                            <span className="font-semibold">{cert.certificateNumber}</span>
                            <span
                              className={`block text-[10px] ${
                                cert.status === 'valid'
                                  ? 'text-[#15803d] dark:text-[#4ade80]'
                                  : 'text-[#dc2626] dark:text-[#ff453a]'
                              }`}
                            >
                              {cert.status === 'valid'
                                ? `Valid (v${cert.version})`
                                : cert.status === 'revoked'
                                  ? 'Revoked'
                                  : 'Superseded'}
                            </span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {cert && cert.status === 'valid' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setPreviewCert(cert)}
                                className="apple-btn-secondary px-3 py-1 text-[11px]"
                              >
                                {lang === 'ja' ? '表示 / PDF' : 'Lihat / PDF'}
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleIssueCertClick(row)}
                                className="px-2.5 py-1 text-[11px] rounded-full border border-[#d2d2d7] dark:border-[#424245]"
                                title={lang === 'ja' ? '再発行 (新版)' : 'Terbitkan Versi Baru'}
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRevokeTarget(cert);
                                  setRevokeReasonDraft('');
                                }}
                                className="px-2.5 py-1 text-[11px] rounded-full text-[#dc2626] dark:text-[#ff453a] border border-[#fecaca] dark:border-[#7f1d1d]"
                              >
                                {lang === 'ja' ? '取消' : 'Cabut'}
                              </button>
                            </>
                          ) : row.elig.configured ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleIssueCertClick(row)}
                              className="apple-btn-primary px-3 py-1 text-[11px]"
                            >
                              {row.elig.eligible
                                ? lang === 'ja'
                                  ? '証書発行'
                                  : 'Terbitkan'
                                : lang === 'ja'
                                  ? '例外発行'
                                  : 'Override & Terbitkan'}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================== MODAL 1: REPORT CARD EDITOR & PREVIEW ==================== */}
      <AnimatePresence>
        {activeRow && selectedModalCard && (
          <AppleModalSheet
            open={Boolean(activeRow)}
            onClose={() => {
              setActiveStudentId(null);
              setActiveCardId(null);
            }}
            maxWidthClass="max-w-6xl"
          >
            <div className="flex flex-col max-h-[90vh]">
              {/* Top Modal Header */}
              <div className="px-5 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold">
                    {activeRow.student.name} — {selectedModalCard.periodLabel}
                  </h2>
                  <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    v{selectedModalCard.version} · {statusBadge(selectedModalCard.status)}
                    {selectedModalCard.unlockedReason && (
                      <span className="ml-2 text-amber-600">
                        (ロック解除理由: {selectedModalCard.unlockedReason})
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!singleReportRef.current) return;
                      const sheet = singleReportRef.current.firstElementChild as HTMLElement | null;
                      if (!sheet) return;
                      await downloadElementAsPdf(
                        sheet,
                        `${selectedModalCard.studentName}_${selectedModalCard.periodType}_v${selectedModalCard.version}.pdf`,
                        'portrait'
                      );
                    }}
                    className="apple-btn-secondary inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRegisterPrintView(
                        <ReportCardDocument card={selectedModalCard} settings={schoolSettings} />
                      );
                      window.setTimeout(() => window.print(), 140);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245]"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? '印刷' : 'Cetak'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveStudentId(null);
                      setActiveCardId(null);
                    }}
                    className="p-1.5 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Split Body: Editor Controls (Left) + Live A4 Document Preview (Right) */}
              <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-5 p-5">
                <div className="lg:col-span-4 space-y-4">
                  {/* Issue Date */}
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'ja' ? '発行日' : 'Tanggal Terbit'}
                    </label>
                    <input
                      type="date"
                      disabled={
                        selectedModalCard.status === 'finalized' ||
                        selectedModalCard.status === 'superseded'
                      }
                      value={issueDateDraft}
                      onChange={(e) => setIssueDateDraft(e.target.value)}
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px] disabled:opacity-60"
                    />
                  </div>

                  {/* Sensei Comment */}
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'ja' ? '担任からのコメント *（提出前に必須）' : 'Catatan Wali Kelas *'}
                    </label>
                    <textarea
                      rows={5}
                      maxLength={2000}
                      disabled={
                        selectedModalCard.status === 'finalized' ||
                        selectedModalCard.status === 'superseded'
                      }
                      value={senseiCommentDraft}
                      onChange={(e) => setSenseiCommentDraft(e.target.value)}
                      placeholder={
                        lang === 'ja'
                          ? '学生の学習姿勢・伸びた点・今後の課題などを記入...'
                          : 'Tulis perkembangan belajar & masukan personal untuk siswa...'
                      }
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px] disabled:opacity-60"
                    />
                  </div>

                  {/* Head Master Comment */}
                  <div>
                    <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                      {lang === 'ja' ? '校長からのコメント（管理者入力）' : 'Catatan Kepala Sekolah'}
                    </label>
                    <textarea
                      rows={4}
                      maxLength={2000}
                      disabled={
                        !isHead ||
                        selectedModalCard.status === 'finalized' ||
                        selectedModalCard.status === 'superseded'
                      }
                      value={headCommentDraft}
                      onChange={(e) => setHeadCommentDraft(e.target.value)}
                      placeholder={
                        isHead
                          ? lang === 'ja'
                            ? '校長所見を入力（任意）...'
                            : 'Catatan kepala sekolah (opsional)...'
                          : lang === 'ja'
                            ? '校長のみ入力できます'
                            : 'Diisi oleh Kepala Sekolah'
                      }
                      className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px] disabled:opacity-60"
                    />
                  </div>

                  {/* Workflow Action Buttons */}
                  <div className="space-y-2 pt-2">
                    {selectedModalCard.status !== 'finalized' &&
                    selectedModalCard.status !== 'superseded' ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSaveReportCard('draft')}
                          className="w-full apple-btn-secondary py-2 text-[13px]"
                        >
                          {lang === 'ja' ? '下書き保存' : 'Simpan Draft'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSaveReportCard('waiting_approval')}
                          className="w-full apple-btn-primary inline-flex items-center justify-center gap-1.5 py-2 text-[13px]"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{lang === 'ja' ? '承認へ提出' : 'Kirim untuk Persetujuan'}</span>
                        </button>
                        {isHead && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleSaveReportCard('finalized')}
                            className="w-full py-2 text-[13px] font-medium rounded-full bg-[#15803d] text-white hover:opacity-90"
                          >
                            {lang === 'ja' ? '承認・確定（ロック）' : 'Setujui & Finalisasi'}
                          </button>
                        )}
                      </>
                    ) : (
                      isHead &&
                      selectedModalCard.status === 'finalized' && (
                        <div className="space-y-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setUnlockModalCard(selectedModalCard);
                              setUnlockReasonDraft('');
                            }}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium rounded-full border border-amber-500 text-amber-700 dark:text-amber-400"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            <span>{lang === 'ja' ? '編集ロック解除' : 'Buka Kunci (Log)'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleReissueReportCard()}
                            className="w-full apple-btn-secondary inline-flex items-center justify-center gap-1.5 py-2 text-[13px]"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>
                              {lang === 'ja'
                                ? `新版を作成 (v${selectedModalCard.version + 1})`
                                : `Terbitkan Versi Baru (v${selectedModalCard.version + 1})`}
                            </span>
                          </button>
                        </div>
                      )
                    )}
                  </div>

                  {/* Version History */}
                  {activeStudentVersionHistory.length > 0 && (
                    <div className="pt-3 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#6e6e73]">
                        <History className="w-3.5 h-3.5" />
                        <span>{lang === 'ja' ? '発行履歴' : 'Riwayat Versi'}</span>
                      </div>
                      <div className="space-y-1">
                        {activeStudentVersionHistory.map((vCard) => (
                          <button
                            key={vCard.id}
                            type="button"
                            onClick={() => setActiveCardId(vCard.id)}
                            className={`w-full text-left px-3 py-1.5 rounded-[10px] text-[12px] flex items-center justify-between ${
                              selectedModalCard.id === vCard.id
                                ? 'bg-[#0071e3]/10 text-[#0071e3] dark:text-[#2997ff] font-medium'
                                : 'bg-[#f5f5f7] dark:bg-[#161617]'
                            }`}
                          >
                            <span>v{vCard.version} · {vCard.issueDate}</span>
                            <span className="text-[11px]">{vCard.status}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Live A4 Portrait Preview */}
                <div className="lg:col-span-8 bg-[#f5f5f7] dark:bg-[#161617] rounded-[18px] p-4 overflow-x-auto flex justify-center">
                  <div ref={singleReportRef} className="shadow-md">
                    <ReportCardDocument card={selectedModalCard} settings={schoolSettings} />
                  </div>
                </div>
              </div>
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* ==================== MODAL 2: UNLOCK REASON ==================== */}
      <AnimatePresence>
        {unlockModalCard && (
          <AppleModalSheet
            open={Boolean(unlockModalCard)}
            onClose={() => setUnlockModalCard(null)}
            maxWidthClass="max-w-md"
          >
            <form onSubmit={handleUnlockCard} className="p-6 space-y-4">
              <h3 className="text-[17px] font-semibold">
                {lang === 'ja' ? '確定済み通知表のロック解除' : 'Buka Kunci Rapor Final'}
              </h3>
              <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'ja'
                  ? '解除理由は操作ログに記録されます。'
                  : 'Alasan pembukaan kunci akan dicatat di log aktivitas.'}
              </p>
              <input
                type="text"
                required
                maxLength={300}
                value={unlockReasonDraft}
                onChange={(e) => setUnlockReasonDraft(e.target.value)}
                placeholder={lang === 'ja' ? '修正理由を入力 *' : 'Alasan edit wajib diisi *'}
                className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUnlockModalCard(null)}
                  className="px-4 py-1.5 text-[12px] rounded-full border border-[#d2d2d7]"
                >
                  {lang === 'ja' ? 'キャンセル' : 'Batal'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="apple-btn-primary px-4 py-1.5 text-[12px]"
                >
                  {lang === 'ja' ? 'ロック解除' : 'Buka Kunci'}
                </button>
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* ==================== MODAL 3: CERTIFICATE OVERRIDE ==================== */}
      <AnimatePresence>
        {overrideTarget && (
          <AppleModalSheet
            open={Boolean(overrideTarget)}
            onClose={() => setOverrideTarget(null)}
            maxWidthClass="max-w-md"
          >
            <form onSubmit={handleConfirmOverrideIssue} className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'ja' ? '修了条件未達 — 例外発行確認' : 'Syarat Belum Terpenuhi (Override)'}
                </h3>
              </div>
              <div className="text-[12px] bg-[#f5f5f7] dark:bg-[#161617] rounded-[12px] p-3 space-y-1">
                <p className="font-semibold">{overrideTarget.student.name}</p>
                {(lang === 'ja' ? overrideTarget.reasonsJa : overrideTarget.reasonsId).map((r, i) => (
                  <p key={i} className="text-amber-700 dark:text-amber-400">
                    • {r}
                  </p>
                ))}
              </div>
              <div>
                <label className="block text-[12px] font-medium mb-1">
                  {lang === 'ja' ? '例外承認の理由（必須・ログ記録）*' : 'Catatan Override Wajib *'}
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={400}
                  value={overrideNoteDraft}
                  onChange={(e) => setOverrideNoteDraft(e.target.value)}
                  placeholder={lang === 'ja' ? '承認理由を記入...' : 'Tuliskan alasan pengecualian...'}
                  className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="px-4 py-1.5 text-[12px] rounded-full border border-[#d2d2d7]"
                >
                  {lang === 'ja' ? 'キャンセル' : 'Batal'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="apple-btn-primary px-4 py-1.5 text-[12px]"
                >
                  {lang === 'ja' ? '例外として発行' : 'Tetap Terbitkan'}
                </button>
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* ==================== MODAL 4: CERTIFICATE REVOKE ==================== */}
      <AnimatePresence>
        {revokeTarget && (
          <AppleModalSheet
            open={Boolean(revokeTarget)}
            onClose={() => setRevokeTarget(null)}
            maxWidthClass="max-w-md"
          >
            <form onSubmit={handleRevokeCertificate} className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-[#dc2626]">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="text-[17px] font-semibold">
                  {lang === 'ja' ? '修了証書を無効化 (Revoke)' : 'Cabut Sertifikat'}
                </h3>
              </div>
              <p className="text-[13px] text-[#6e6e73]">
                {revokeTarget.studentName} · <span className="font-mono">{revokeTarget.certificateNumber}</span>
              </p>
              <input
                type="text"
                required
                maxLength={400}
                value={revokeReasonDraft}
                onChange={(e) => setRevokeReasonDraft(e.target.value)}
                placeholder={lang === 'ja' ? '取消理由を入力 *' : 'Alasan pencabutan *'}
                className="w-full glass-input px-3 py-2 text-[13px] rounded-[12px]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRevokeTarget(null)}
                  className="px-4 py-1.5 text-[12px] rounded-full border border-[#d2d2d7]"
                >
                  {lang === 'ja' ? 'キャンセル' : 'Batal'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 text-[12px] rounded-full bg-[#dc2626] text-white font-medium"
                >
                  {lang === 'ja' ? '無効化を実行' : 'Cabut Sertifikat'}
                </button>
              </div>
            </form>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* ==================== MODAL 5: CERTIFICATE PREVIEW (A4 LANDSCAPE) ==================== */}
      <AnimatePresence>
        {previewCert && (
          <AppleModalSheet
            open={Boolean(previewCert)}
            onClose={() => setPreviewCert(null)}
            maxWidthClass="max-w-6xl"
          >
            <div className="flex flex-col max-h-[90vh]">
              <div className="px-5 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold">
                    修了証書 — {previewCert.studentName} ({previewCert.certificateNumber})
                  </h2>
                  <p className="text-[12px] text-[#6e6e73]">
                    A4 Landscape · QR Verification Active
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const sheet = singleCertRef.current?.firstElementChild as HTMLElement | null;
                      if (!sheet) return;
                      await downloadElementAsPdf(
                        sheet,
                        `${previewCert.certificateNumber}_${previewCert.studentName}.pdf`,
                        'landscape'
                      );
                    }}
                    className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px]"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRegisterPrintView(
                        <div>
                          <style>{`@media print { @page { size: A4 landscape; margin: 6mm; } }`}</style>
                          <CertificateDocument
                            certificate={previewCert}
                            settings={schoolSettings}
                          />
                        </div>
                      );
                      window.setTimeout(() => window.print(), 180);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245]"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>{lang === 'ja' ? '印刷' : 'Cetak'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewCert(null)}
                    className="p-1.5 rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto bg-[#f5f5f7] dark:bg-[#161617] p-5 flex justify-center">
                <div ref={singleCertRef} className="shadow-md">
                  <CertificateDocument certificate={previewCert} settings={schoolSettings} />
                </div>
              </div>
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>

      {/* Offscreen DOM staging container for batch ZIP PDF rendering */}
      {(batchRenderCards.length > 0 || batchRenderCerts.length > 0) && (
        <div
          ref={batchStageRef}
          aria-hidden="true"
          style={{ position: 'fixed', left: '-10000px', top: 0, zIndex: -1 }}
        >
          {batchRenderCards.map((c) => (
            <div key={c.id} data-batch-rc={c.id}>
              <ReportCardDocument card={c} settings={schoolSettings} />
            </div>
          ))}
          {batchRenderCerts.map((cert) => (
            <div key={cert.id} data-batch-cert={cert.id}>
              <CertificateDocument certificate={cert} settings={schoolSettings} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
