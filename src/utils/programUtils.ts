import {
  CLASSES,
  ClassId,
  DailyReport,
  DEFAULT_QUALITY_THRESHOLDS,
  DEFAULT_SCHOOL_SETTINGS,
  ProgramDurationMonths,
  QualityThresholds,
  QUESTION_CATEGORIES,
  ReportCardCategoryRow,
  ReportCardMonthRow,
  ReportCardPeriodType,
  ReportCardWeeklyPoint,
  SchoolSettings,
  Student,
  TestResult,
  UserProfile,
  WeeklyReport,
} from '../types';
import { getWeekEndDateStr } from './analyticsUtils';
import { getTodayDateStr } from './dateUtils';

function parseDateParts(dateStr: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysToDateStr(dateStr: string, days: number): string {
  const parts = parseDateParts(dateStr);
  if (!parts) return dateStr;
  const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + days));
  return formatUtcDate(dt);
}

/**
 * Adds N months to startDate and subtracts 1 day so e.g. 2026-04-01 + 2 months => 2026-05-31.
 * Avoids JS Date end-of-month rollover bugs (e.g. Jan 31 + 1 month => Feb 28).
 */
export function calculateProgramEndDate(startDate: string, months: ProgramDurationMonths): string {
  const parts = parseDateParts(startDate);
  if (!parts) return '';
  const targetMonthIndex = parts.m - 1 + months;
  const targetYear = parts.y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(parts.d, lastDayOfTargetMonth);
  const anniversary = new Date(Date.UTC(targetYear, targetMonth, clampedDay));
  anniversary.setUTCDate(anniversary.getUTCDate() - 1);
  return formatUtcDate(anniversary);
}

export function getMonthDateRange(
  programStartDate: string,
  programMonths: ProgramDurationMonths,
  monthNumber: number
): { startDate: string; endDate: string } {
  const m = Math.max(1, Math.min(programMonths, monthNumber));
  const fullEnd = calculateProgramEndDate(programStartDate, programMonths);
  const startDate =
    m === 1 ? programStartDate : addDaysToDateStr(calculateProgramEndDate(programStartDate, (m - 1) as ProgramDurationMonths), 1);
  const rawEnd = calculateProgramEndDate(programStartDate, m as ProgramDurationMonths);
  const endDate = m === programMonths ? fullEnd : rawEnd;
  return { startDate, endDate };
}

export function diffDaysInclusive(startStr: string, endStr: string): number {
  const a = parseDateParts(startStr);
  const b = parseDateParts(endStr);
  if (!a || !b) return 0;
  const msA = Date.UTC(a.y, a.m - 1, a.d);
  const msB = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((msB - msA) / 86400000);
}

export interface StudentProgramProgress {
  isConfigured: boolean;
  valid: boolean;
  errorMessage: string;
  programMonths: ProgramDurationMonths | null;
  startDate: string;
  endDate: string;
  currentMonth: number;
  totalMonths: number;
  daysElapsed: number;
  totalDays: number;
  daysRemaining: number;
  progressPercent: number;
  isUpcoming: boolean;
  isCompleted: boolean;
  finishingSoon30Days: boolean;
}

export function getStudentProgramProgress(
  student: Student,
  todayStr: string = getTodayDateStr()
): StudentProgramProgress {
  const months = student.programMonths;
  const startDate = (student.programStartDate || '').trim();
  if (!months || ![2, 4, 6].includes(months) || !parseDateParts(startDate)) {
    return {
      isConfigured: false,
      valid: false,
      errorMessage: '未設定 / Belum diatur',
      programMonths: null,
      startDate: '',
      endDate: '',
      currentMonth: 0,
      totalMonths: 0,
      daysElapsed: 0,
      totalDays: 0,
      daysRemaining: 0,
      progressPercent: 0,
      isUpcoming: false,
      isCompleted: false,
      finishingSoon30Days: false,
    };
  }

  const typedMonths = months as ProgramDurationMonths;
  const computedEnd = calculateProgramEndDate(startDate, typedMonths);
  const endDate =
    student.programEndDate && parseDateParts(student.programEndDate) && student.programEndDate >= startDate
      ? student.programEndDate
      : computedEnd;

  if (!endDate || endDate < startDate) {
    return {
      isConfigured: true,
      valid: false,
      errorMessage: '終了日が開始日より前です / Tanggal selesai tidak valid',
      programMonths: typedMonths,
      startDate,
      endDate,
      currentMonth: 0,
      totalMonths: typedMonths,
      daysElapsed: 0,
      totalDays: 0,
      daysRemaining: 0,
      progressPercent: 0,
      isUpcoming: false,
      isCompleted: false,
      finishingSoon30Days: false,
    };
  }

  const totalDays = Math.max(1, diffDaysInclusive(startDate, endDate) + 1);
  const isUpcoming = todayStr < startDate;
  const isCompleted = todayStr >= endDate;

  const rawElapsed = isUpcoming ? 0 : Math.min(totalDays, diffDaysInclusive(startDate, todayStr) + 1);
  const daysRemaining = isCompleted ? 0 : Math.max(0, diffDaysInclusive(todayStr, endDate));
  const progressPercent = isUpcoming ? 0 : isCompleted ? 100 : Math.min(99, Math.round((rawElapsed / totalDays) * 100));

  let currentMonth = 1;
  if (isCompleted) {
    currentMonth = typedMonths;
  } else if (!isUpcoming) {
    for (let m = 1; m <= typedMonths; m++) {
      const range = getMonthDateRange(startDate, typedMonths, m);
      if (todayStr <= range.endDate) {
        currentMonth = m;
        break;
      }
      currentMonth = m;
    }
  }

  const finishingSoon30Days = !isCompleted && !isUpcoming && daysRemaining >= 0 && daysRemaining <= 30;

  return {
    isConfigured: true,
    valid: true,
    errorMessage: '',
    programMonths: typedMonths,
    startDate,
    endDate,
    currentMonth,
    totalMonths: typedMonths,
    daysElapsed: rawElapsed,
    totalDays,
    daysRemaining,
    progressPercent,
    isUpcoming,
    isCompleted,
    finishingSoon30Days,
  };
}

export function getAvailablePeriodsForProgram(programMonths: ProgramDurationMonths): {
  monthlyNumbers: number[];
  hasMidterm: boolean;
  midtermMonth: number | null;
  hasFinal: boolean;
} {
  const monthlyNumbers = Array.from({ length: programMonths }, (_, i) => i + 1);
  const hasMidterm = programMonths === 4 || programMonths === 6;
  const midtermMonth = programMonths === 6 ? 3 : programMonths === 4 ? 2 : null;
  return {
    monthlyNumbers,
    hasMidterm,
    midtermMonth,
    hasFinal: true,
  };
}

export function getWeekStartDateStr(weekKey: string): string {
  const endStr = getWeekEndDateStr(weekKey);
  if (endStr === '9999-12-31') return '0000-01-01';
  return addDaysToDateStr(endStr, -6);
}

export function computeGradeLabel(
  scorePercent: number | null,
  settings: SchoolSettings = DEFAULT_SCHOOL_SETTINGS
): string {
  if (scorePercent === null || !Number.isFinite(scorePercent)) return '—';
  if (settings.gradeScaleMode === 'letter') {
    if (scorePercent >= settings.letterAMin) return 'A';
    if (scorePercent >= settings.letterBMin) return 'B';
    if (scorePercent >= settings.letterCMin) return 'C';
    return 'D';
  }
  if (scorePercent >= settings.level5Min) return '5';
  if (scorePercent >= settings.level4Min) return '4';
  if (scorePercent >= settings.level3Min) return '3';
  if (scorePercent >= settings.level2Min) return '2';
  return '1';
}

export function computeAttitudeGradeLabel(
  attitudeAvg: number | null,
  settings: SchoolSettings = DEFAULT_SCHOOL_SETTINGS
): string {
  if (attitudeAvg === null || !Number.isFinite(attitudeAvg)) return '—';
  const pct = (attitudeAvg / 5) * 100;
  return computeGradeLabel(pct, settings);
}

export function getPeriodWindow(params: {
  programMonths: ProgramDurationMonths;
  programStartDate: string;
  programEndDate: string;
  periodType: ReportCardPeriodType;
  periodMonth: number;
}): {
  periodType: ReportCardPeriodType;
  periodMonth: number;
  periodStartDate: string;
  periodEndDate: string;
  periodLabel: string;
  effectiveEndMonth: number;
} {
  const { programMonths, programStartDate, programEndDate, periodType, periodMonth } = params;
  if (periodType === 'midterm' && (programMonths === 4 || programMonths === 6)) {
    const midMonth = programMonths === 6 ? 3 : 2;
    const range = getMonthDateRange(programStartDate, programMonths, midMonth);
    return {
      periodType: 'midterm',
      periodMonth: midMonth,
      periodStartDate: programStartDate,
      periodEndDate: range.endDate,
      periodLabel: `中間評価（第${midMonth}か月終了時点）`,
      effectiveEndMonth: midMonth,
    };
  }
  if (periodType === 'final') {
    return {
      periodType: 'final',
      periodMonth: 0,
      periodStartDate: programStartDate,
      periodEndDate: programEndDate,
      periodLabel: `最終評価（全${programMonths}か月修了）`,
      effectiveEndMonth: programMonths,
    };
  }
  const clampedMonth = Math.max(1, Math.min(programMonths, periodMonth || 1));
  const range = getMonthDateRange(programStartDate, programMonths, clampedMonth);
  return {
    periodType: 'monthly',
    periodMonth: clampedMonth,
    periodStartDate: range.startDate,
    periodEndDate: range.endDate,
    periodLabel: `第${clampedMonth}か月（月次）`,
    effectiveEndMonth: clampedMonth,
  };
}

export interface ComputedReportMetrics {
  programMonths: ProgramDurationMonths;
  programStartDate: string;
  programEndDate: string;
  periodType: ReportCardPeriodType;
  periodMonth: number;
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  monthlyRows: ReportCardMonthRow[];
  categoryRows: ReportCardCategoryRow[];
  weeklySeries: ReportCardWeeklyPoint[];
  cumulativeWeeklyAvg: number | null;
  periodWeeklyAvg: number | null;
  attendanceTotalDays: number;
  attendancePresentDays: number;
  attendanceAbsentDays: number;
  attendanceLateDays: number;
  attendanceRate: number | null;
  attitudeAvg: number | null;
  attitudeSubAttendance: number | null;
  attitudeSubDiscipline: number | null;
  attitudeSubEffort: number | null;
  attitudeSubCooperation: number | null;
  attitudeGradeLabel: string;
  overallCombinedAvg: number | null;
  overallGradeLabel: string;
  classRank: number | null;
  classSize: number;
  senseiName: string;
}

function computeSingleStudentPeriodCore(params: {
  student: Student;
  programMonths: ProgramDurationMonths;
  programStartDate: string;
  programEndDate: string;
  periodStartDate: string;
  periodEndDate: string;
  effectiveEndMonth: number;
  testResults: TestResult[];
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  schoolSettings: SchoolSettings;
  qualityThresholds: QualityThresholds;
}) {
  const {
    student,
    programMonths,
    programStartDate,
    periodStartDate,
    periodEndDate,
    effectiveEndMonth,
    testResults,
    dailyReports,
    weeklyReports,
    schoolSettings,
    qualityThresholds,
  } = params;

  // OFFICIAL SCORE SOURCE RULE: weekly exams ONLY (testType === 'weekly')
  const studentWeeklyExams = testResults.filter(
    (r) =>
      r.studentId === student.id &&
      r.testType === 'weekly' &&
      r.date >= programStartDate &&
      r.date <= periodEndDate
  );

  // Per-month averages & cumulative averages up to each month
  const monthlyRows: ReportCardMonthRow[] = [];
  for (let m = 1; m <= effectiveEndMonth; m++) {
    const mRange = getMonthDateRange(programStartDate, programMonths, m);
    const inMonth = studentWeeklyExams.filter(
      (r) => r.date >= mRange.startDate && r.date <= mRange.endDate
    );
    const cumUpToM = studentWeeklyExams.filter(
      (r) => r.date >= programStartDate && r.date <= mRange.endDate
    );
    const weeklyAvg =
      inMonth.length > 0
        ? Math.round(inMonth.reduce((s, r) => s + r.scorePercent, 0) / inMonth.length)
        : null;
    const cumulativeAvg =
      cumUpToM.length > 0
        ? Math.round(cumUpToM.reduce((s, r) => s + r.scorePercent, 0) / cumUpToM.length)
        : null;
    monthlyRows.push({
      monthNumber: m,
      label: `第${m}か月`,
      weeklyAvg,
      cumulativeAvg,
      grade: computeGradeLabel(weeklyAvg, schoolSettings),
      examCount: inMonth.length,
    });
  }

  // Exams within the selected report period window
  const periodExams = studentWeeklyExams.filter(
    (r) => r.date >= periodStartDate && r.date <= periodEndDate
  );
  const periodWeeklyAvg =
    periodExams.length > 0
      ? Math.round(periodExams.reduce((s, r) => s + r.scorePercent, 0) / periodExams.length)
      : null;

  const cumulativeWeeklyAvg =
    studentWeeklyExams.length > 0
      ? Math.round(studentWeeklyExams.reduce((s, r) => s + r.scorePercent, 0) / studentWeeklyExams.length)
      : null;

  // Category breakdown from weekly exams in the period (only valid QUESTION_CATEGORIES)
  const validCatMap = new Map(QUESTION_CATEGORIES.map((c) => [c.id as string, c]));
  const catBuckets = new Map<string, { sum: number; count: number }>();
  periodExams.forEach((r) => {
    const catKey = (r.category || '').trim();
    if (validCatMap.has(catKey)) {
      const prev = catBuckets.get(catKey) || { sum: 0, count: 0 };
      prev.sum += r.scorePercent;
      prev.count += 1;
      catBuckets.set(catKey, prev);
    }
  });
  const categoryRows: ReportCardCategoryRow[] = Array.from(catBuckets.entries()).map(([catId, b]) => {
    const meta = validCatMap.get(catId)!;
    return {
      categoryId: catId,
      labelJa: meta.ja,
      labelId: meta.idLabel,
      avgScore: Math.round(b.sum / b.count),
      examCount: b.count,
    };
  });

  // Monochrome weekly score trend across start..periodEnd
  const byWeek = new Map<string, { sum: number; count: number }>();
  studentWeeklyExams.forEach((r) => {
    const prev = byWeek.get(r.weekKey) || { sum: 0, count: 0 };
    prev.sum += r.scorePercent;
    prev.count += 1;
    byWeek.set(r.weekKey, prev);
  });
  const weeklySeries: ReportCardWeeklyPoint[] = Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, v]) => ({
      weekKey,
      score: Math.round(v.sum / v.count),
    }));

  // Attendance inside period window
  const periodReports = dailyReports.filter(
    (r) => r.classId === student.classId && r.date >= periodStartDate && r.date <= periodEndDate
  );
  let absentDays = 0;
  let lateDays = 0;
  periodReports.forEach((r) => {
    if ((r.absentNames || []).includes(student.name)) absentDays += 1;
    if ((r.lateNames || []).includes(student.name)) lateDays += 1;
  });
  const totalDays = periodReports.length;
  const presentDays = Math.max(0, totalDays - absentDays);
  const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : null;

  // Attitude from weeklyReports overlapping [periodStartDate, periodEndDate]
  const attScores: number[] = [];
  const subAttArr: number[] = [];
  const subDiscArr: number[] = [];
  const subEffortArr: number[] = [];
  const subCoopArr: number[] = [];

  weeklyReports.forEach((wr) => {
    if (wr.classId !== student.classId) return;
    const wkStart = getWeekStartDateStr(wr.weekKey);
    const wkEnd = getWeekEndDateStr(wr.weekKey);
    if (wkEnd < periodStartDate || wkStart > periodEndDate) return;
    const entry = (wr.studentEntries || []).find((e) => e.studentId === student.id);
    if (entry && entry.attitudeScore > 0) {
      attScores.push(entry.attitudeScore);
      if (entry.subAttendance && entry.subAttendance > 0) subAttArr.push(entry.subAttendance);
      if (entry.subDiscipline && entry.subDiscipline > 0) subDiscArr.push(entry.subDiscipline);
      if (entry.subEffort && entry.subEffort > 0) subEffortArr.push(entry.subEffort);
      if (entry.subCooperation && entry.subCooperation > 0) subCoopArr.push(entry.subCooperation);
    }
  });

  const avg5 = (arr: number[]): number | null =>
    arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;

  const attitudeAvg = avg5(attScores);
  const attitudeSubAttendance = avg5(subAttArr);
  const attitudeSubDiscipline = avg5(subDiscArr);
  const attitudeSubEffort = avg5(subEffortArr);
  const attitudeSubCooperation = avg5(subCoopArr);
  const attitudeGradeLabel = computeAttitudeGradeLabel(attitudeAvg, schoolSettings);

  // Combined weighted score using qualityThresholds weights
  const academicScoreUsed = periodWeeklyAvg ?? cumulativeWeeklyAvg;
  const examW = Math.max(0, qualityThresholds.examWeightPercent);
  const attW = Math.max(0, qualityThresholds.attitudeWeightPercent);

  let overallCombinedAvg: number | null = null;
  if (academicScoreUsed !== null && attitudeAvg !== null) {
    const denom = examW + attW || 1;
    overallCombinedAvg = Math.round(
      (academicScoreUsed * examW + (attitudeAvg / 5) * 100 * attW) / denom
    );
  } else if (academicScoreUsed !== null) {
    overallCombinedAvg = academicScoreUsed;
  } else if (attitudeAvg !== null) {
    overallCombinedAvg = Math.round((attitudeAvg / 5) * 100);
  }

  const overallGradeLabel = computeGradeLabel(overallCombinedAvg, schoolSettings);

  return {
    monthlyRows,
    categoryRows,
    weeklySeries,
    cumulativeWeeklyAvg,
    periodWeeklyAvg,
    attendanceTotalDays: totalDays,
    attendancePresentDays: presentDays,
    attendanceAbsentDays: absentDays,
    attendanceLateDays: lateDays,
    attendanceRate,
    attitudeAvg,
    attitudeSubAttendance,
    attitudeSubDiscipline,
    attitudeSubEffort,
    attitudeSubCooperation,
    attitudeGradeLabel,
    overallCombinedAvg,
    overallGradeLabel,
  };
}

export function resolveClassSenseiName(classId: ClassId, staffUsers: UserProfile[]): string {
  const names = staffUsers
    .filter((u) => u.status === 'active' && u.role === 'teacher' && (u.assignedClasses || []).includes(classId))
    .map((u) => u.fullName || u.nickname || u.displayName);
  if (names.length > 0) return names.join(' / ');
  const anyAssigned = staffUsers
    .filter((u) => u.status === 'active' && (u.assignedClasses || []).includes(classId))
    .map((u) => u.fullName || u.nickname || u.displayName);
  return anyAssigned.join(' / ') || '担当講師';
}

export function computeReportCardMetrics(params: {
  student: Student;
  allStudents: Student[];
  testResults: TestResult[];
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  periodType: ReportCardPeriodType;
  periodMonth: number;
  schoolSettings?: SchoolSettings;
  qualityThresholds?: QualityThresholds;
  staffUsers?: UserProfile[];
}): ComputedReportMetrics | null {
  const {
    student,
    allStudents,
    testResults,
    dailyReports,
    weeklyReports,
    periodType,
    periodMonth,
    schoolSettings = DEFAULT_SCHOOL_SETTINGS,
    qualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
    staffUsers = [],
  } = params;

  const stuClassId = student.classId;
  const prog = getStudentProgramProgress(student);
  if (!stuClassId || !prog.isConfigured || !prog.valid || !prog.programMonths) {
    return null;
  }

  const win = getPeriodWindow({
    programMonths: prog.programMonths,
    programStartDate: prog.startDate,
    programEndDate: prog.endDate,
    periodType,
    periodMonth,
  });

  const core = computeSingleStudentPeriodCore({
    student,
    programMonths: prog.programMonths,
    programStartDate: prog.startDate,
    programEndDate: prog.endDate,
    periodStartDate: win.periodStartDate,
    periodEndDate: win.periodEndDate,
    effectiveEndMonth: win.effectiveEndMonth,
    testResults,
    dailyReports,
    weeklyReports,
    schoolSettings,
    qualityThresholds,
  });

  // Compute class rank among active classmates who have a valid combined score
  const classmates = allStudents.filter((s) => s.active && s.classId === stuClassId);
  const scoredPeers = classmates
    .map((mate) => {
      if (mate.id === student.id) {
        return { id: mate.id, score: core.overallCombinedAvg };
      }
      const mateProg = getStudentProgramProgress(mate);
      const mateStart = mateProg.valid ? mateProg.startDate : prog.startDate;
      const mateEnd = win.periodEndDate;
      const mateCore = computeSingleStudentPeriodCore({
        student: mate,
        programMonths: prog.programMonths!,
        programStartDate: mateStart,
        programEndDate: prog.endDate,
        periodStartDate: win.periodStartDate,
        periodEndDate: mateEnd,
        effectiveEndMonth: win.effectiveEndMonth,
        testResults,
        dailyReports,
        weeklyReports,
        schoolSettings,
        qualityThresholds,
      });
      return { id: mate.id, score: mateCore.overallCombinedAvg };
    })
    .filter((p) => p.score !== null)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  let classRank: number | null = null;
  if (core.overallCombinedAvg !== null) {
    const idx = scoredPeers.findIndex((p) => p.id === student.id);
    if (idx !== -1) {
      // Standard competition ranking (1, 1, 3)
      let rank = idx + 1;
      for (let i = idx - 1; i >= 0; i--) {
        if (scoredPeers[i].score === core.overallCombinedAvg) rank = i + 1;
        else break;
      }
      classRank = rank;
    }
  }

  return {
    programMonths: prog.programMonths,
    programStartDate: prog.startDate,
    programEndDate: prog.endDate,
    periodType: win.periodType,
    periodMonth: win.periodMonth,
    periodLabel: win.periodLabel,
    periodStartDate: win.periodStartDate,
    periodEndDate: win.periodEndDate,
    ...core,
    classRank,
    classSize: classmates.length,
    senseiName: resolveClassSenseiName(stuClassId, staffUsers),
  };
}

export interface CertificateEligibilityResult {
  configured: boolean;
  eligible: boolean;
  reasonsJa: string[];
  reasonsId: string[];
  metrics: {
    programMonths: ProgramDurationMonths | null;
    startDate: string;
    endDate: string;
    finalAvg: number | null;
    attendanceRate: number | null;
    attitudeAvg: number | null;
    overallGradeLabel: string;
  };
}

export function checkCertificateEligibility(params: {
  student: Student;
  allStudents: Student[];
  testResults: TestResult[];
  dailyReports: DailyReport[];
  weeklyReports: WeeklyReport[];
  schoolSettings?: SchoolSettings;
  qualityThresholds?: QualityThresholds;
  todayStr?: string;
}): CertificateEligibilityResult {
  const {
    student,
    allStudents,
    testResults,
    dailyReports,
    weeklyReports,
    schoolSettings = DEFAULT_SCHOOL_SETTINGS,
    qualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
    todayStr = getTodayDateStr(),
  } = params;

  const prog = getStudentProgramProgress(student, todayStr);
  if (!prog.isConfigured || !prog.valid || !prog.programMonths) {
    return {
      configured: false,
      eligible: false,
      reasonsJa: ['受講期間（2/4/6か月）および開始日が未設定です。'],
      reasonsId: ['Durasi program (2/4/6 bulan) dan tanggal mulai belum diatur.'],
      metrics: {
        programMonths: null,
        startDate: '',
        endDate: '',
        finalAvg: null,
        attendanceRate: null,
        attitudeAvg: null,
        overallGradeLabel: '—',
      },
    };
  }

  const finalMetrics = computeReportCardMetrics({
    student,
    allStudents,
    testResults,
    dailyReports,
    weeklyReports,
    periodType: 'final',
    periodMonth: 0,
    schoolSettings,
    qualityThresholds,
  });

  const finalAvg = finalMetrics?.cumulativeWeeklyAvg ?? null;
  const attendanceRate = finalMetrics?.attendanceRate ?? null;
  const attitudeAvg = finalMetrics?.attitudeAvg ?? null;
  const overallGradeLabel = finalMetrics?.overallGradeLabel ?? '—';

  const reasonsJa: string[] = [];
  const reasonsId: string[] = [];

  if (!prog.isCompleted) {
    reasonsJa.push(`プログラム未修了（修了予定日: ${prog.endDate} · 残り${prog.daysRemaining}日）`);
    reasonsId.push(`Program belum selesai (selesai: ${prog.endDate} · sisa ${prog.daysRemaining} hari)`);
  }
  if (finalAvg === null) {
    reasonsJa.push(`週次テストの成績データがありません（最低基準 ${schoolSettings.certMinFinalAvg}%）`);
    reasonsId.push(`Belum ada nilai ujian mingguan (minimal ${schoolSettings.certMinFinalAvg}%)`);
  } else if (finalAvg < schoolSettings.certMinFinalAvg) {
    reasonsJa.push(`最終テスト平均が基準未満（${finalAvg}% < ${schoolSettings.certMinFinalAvg}%）`);
    reasonsId.push(`Rata-rata ujian akhir di bawah batas (${finalAvg}% < ${schoolSettings.certMinFinalAvg}%)`);
  }
  if (attendanceRate === null) {
    reasonsJa.push(`出席記録データがありません（最低基準 ${schoolSettings.certMinAttendanceRate}%）`);
    reasonsId.push(`Belum ada data absensi (minimal ${schoolSettings.certMinAttendanceRate}%)`);
  } else if (attendanceRate < schoolSettings.certMinAttendanceRate) {
    reasonsJa.push(`出席率が基準未満（${attendanceRate}% < ${schoolSettings.certMinAttendanceRate}%）`);
    reasonsId.push(`Kehadiran di bawah batas (${attendanceRate}% < ${schoolSettings.certMinAttendanceRate}%)`);
  }
  if (attitudeAvg === null) {
    reasonsJa.push(`学習態度の評価データがありません（最低基準 ${schoolSettings.certMinAttitudeScore.toFixed(1)}）`);
    reasonsId.push(`Belum ada nilai sikap mingguan (minimal ${schoolSettings.certMinAttitudeScore.toFixed(1)})`);
  } else if (attitudeAvg < schoolSettings.certMinAttitudeScore) {
    reasonsJa.push(`学習態度平均が基準未満（${attitudeAvg.toFixed(1)} < ${schoolSettings.certMinAttitudeScore.toFixed(1)}）`);
    reasonsId.push(`Rata-rata sikap di bawah batas (${attitudeAvg.toFixed(1)} < ${schoolSettings.certMinAttitudeScore.toFixed(1)})`);
  }

  return {
    configured: true,
    eligible: reasonsJa.length === 0,
    reasonsJa,
    reasonsId,
    metrics: {
      programMonths: prog.programMonths,
      startDate: prog.startDate,
      endDate: prog.endDate,
      finalAvg,
      attendanceRate,
      attitudeAvg,
      overallGradeLabel,
    },
  };
}

export function getClassNamePair(classId: ClassId): { ja: string; id: string } {
  const found = CLASSES.find((c) => c.id === classId);
  return {
    ja: found?.nameJa || classId,
    id: found?.nameId || classId,
  };
}
