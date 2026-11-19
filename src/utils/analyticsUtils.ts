import {
  AlertTypeKey,
  ClassId,
  CLASSES,
  DailyReport,
  DEFAULT_QUALITY_THRESHOLDS,
  HandledAlert,
  QualityThresholds,
  QuestionItem,
  QuestionReviewStatus,
  ScheduleRow,
  Student,
  TestResult,
  UserProfile,
  WeeklyReport,
} from '../types';
import { getWeekKey } from './dateUtils';

export function effectiveQuestionStatus(q: QuestionItem): QuestionReviewStatus {
  return q.reviewStatus || 'approved';
}

export function parseTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof ts === 'object' && ts !== null) {
    if ('toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
      return (ts as { toMillis: () => number }).toMillis();
    }
    if ('seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
      return (ts as { seconds: number }).seconds * 1000;
    }
  }
  return 0;
}

export function formatTimestamp(ts: unknown): string {
  const ms = parseTimestampMs(ts);
  if (!ms) return '—';
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function formatLocalDateFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Given an ISO weekKey like "2026-W46", returns the Sunday YYYY-MM-DD end of that ISO week.
 */
export function getWeekEndDateStr(weekKey: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return '9999-12-31';
  const year = Number(match[1]);
  const week = Number(match[2]);
  const simple = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = simple.getUTCDay() || 7;
  const isoMonday = new Date(simple.getTime());
  isoMonday.setUTCDate(simple.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  const isoSunday = new Date(isoMonday.getTime());
  isoSunday.setUTCDate(isoMonday.getUTCDate() + 6);
  return isoSunday.toISOString().slice(0, 10);
}

/**
 * Returns recent N ISO week keys ending with currentWeekKey (oldest -> newest)
 */
export function getRecentWeekKeys(count: number, baseDateStr?: string): string[] {
  const now = baseDateStr ? new Date(`${baseDateStr}T12:00:00Z`) : new Date();
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 7 * 86400000);
    keys.push(getWeekKey(d.toISOString().slice(0, 10)));
  }
  return Array.from(new Set(keys));
}

/**
 * Parses a schedule time slot like "09:00 - 10:30" into duration hours. Defaults to 0.75h if single/unparseable.
 */
export function parseTimeSlotHours(slot: string): number {
  const matches = (slot || '').match(/(\d{1,2})[:.](\d{2})/g);
  if (!matches || matches.length < 2) return slot.trim() ? 0.75 : 0;
  const toMins = (m: string) => {
    const [h, min] = m.split(/[:.]/).map(Number);
    return h * 60 + min;
  };
  const start = toMins(matches[0]);
  const end = toMins(matches[1]);
  const diff = end - start;
  if (diff <= 0 || diff > 720) return 0.75;
  return Number((diff / 60).toFixed(2));
}

export function doesRowMatchSensei(row: ScheduleRow, sensei: UserProfile): boolean {
  if (row.teacherUid && row.teacherUid === sensei.uid) return true;
  const rowTeacher = (row.teacher || '').trim().toLowerCase();
  if (!rowTeacher) return false;
  const candidates = [sensei.displayName, sensei.nickname, sensei.fullName]
    .filter(Boolean)
    .map((s) => s!.trim().toLowerCase());
  return candidates.includes(rowTeacher);
}

export function computeSenseiTeachingLoadHours(sensei: UserProfile, rows: ScheduleRow[]): {
  hoursPerWeek: number;
  sessionCount: number;
} {
  const matched = rows.filter((r) => doesRowMatchSensei(r, sensei));
  const hours = matched.reduce((sum, r) => sum + parseTimeSlotHours(r.timeSlot), 0);
  return {
    hoursPerWeek: Number(hours.toFixed(1)),
    sessionCount: matched.length,
  };
}

export type ComplianceState = 'submitted' | 'late' | 'draft' | 'missing';

export function getDailyReportCompliance(report: DailyReport | undefined): ComplianceState {
  if (!report) return 'missing';
  const createdMs = parseTimestampMs(report.createdAt);
  if (createdMs > 0) {
    const createdDate = formatLocalDateFromMs(createdMs);
    if (createdDate > report.date) return 'late';
  }
  return 'submitted';
}

export function getWeeklyReportCompliance(report: WeeklyReport | undefined): ComplianceState {
  if (!report) return 'missing';
  if (report.status === 'draft') return 'draft';
  const submittedDate = (report.submittedAt || '').slice(0, 10);
  const weekEnd = getWeekEndDateStr(report.weekKey);
  if (submittedDate && submittedDate > weekEnd) return 'late';
  return 'submitted';
}

export type ExamInputStatus = 'complete' | 'partial' | 'missing';

export function getWeeklyExamInputStatus(params: {
  classId: ClassId;
  weekKey: string;
  students: Student[];
  testResults: TestResult[];
}): { status: ExamInputStatus; entered: number; total: number } {
  const { classId, weekKey, students, testResults } = params;
  const activeStudents = students.filter((s) => s.classId === classId && s.active);
  const total = activeStudents.length;
  if (total === 0) return { status: 'missing', entered: 0, total: 0 };

  const activeIds = new Set(activeStudents.map((s) => s.id));
  const enteredIds = new Set(
    testResults
      .filter(
        (r) =>
          r.testType === 'weekly' &&
          r.classId === classId &&
          r.weekKey === weekKey &&
          activeIds.has(r.studentId)
      )
      .map((r) => r.studentId)
  );
  const entered = enteredIds.size;
  if (entered === 0) return { status: 'missing', entered, total };
  if (entered >= total) return { status: 'complete', entered, total };
  return { status: 'partial', entered, total };
}

/**
 * SCORE SOURCE RULE: Weekly exam (testType === 'weekly') ONLY.
 */
export function getOfficialWeeklyScoreByWeek(
  studentId: string,
  testResults: TestResult[]
): { weekKey: string; avgScore: number; count: number; latestDate: string; latestTitle: string }[] {
  const weekly = testResults.filter(
    (r) => r.studentId === studentId && r.testType === 'weekly'
  );
  const byWeek = new Map<string, { sum: number; count: number; latestDate: string; latestTitle: string }>();
  weekly.forEach((r) => {
    const cur = byWeek.get(r.weekKey) || {
      sum: 0,
      count: 0,
      latestDate: r.date,
      latestTitle: r.testTitle,
    };
    cur.sum += r.scorePercent;
    cur.count += 1;
    if (r.date >= cur.latestDate) {
      cur.latestDate = r.date;
      cur.latestTitle = r.testTitle;
    }
    byWeek.set(r.weekKey, cur);
  });
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, stats]) => ({
      weekKey,
      avgScore: Math.round(stats.sum / stats.count),
      count: stats.count,
      latestDate: stats.latestDate,
      latestTitle: stats.latestTitle,
    }));
}

export function getStudentAttendanceSummary(studentName: string, reports: DailyReport[]) {
  let absentCount = 0;
  let lateCount = 0;
  let classReportDays = 0;

  reports.forEach((r) => {
    const abs = (r.absentNames || []).includes(studentName);
    const late = (r.lateNames || []).includes(studentName);
    if (abs) absentCount += 1;
    if (late) lateCount += 1;
    classReportDays += 1;
  });

  const attendanceRate =
    classReportDays > 0
      ? Math.max(0, Math.round(((classReportDays - absentCount) / classReportDays) * 100))
      : null;

  return { absentCount, lateCount, classReportDays, attendanceRate };
}

export interface StudentAttitudeHistoryItem {
  weekKey: string;
  attitudeScore: number;
  subAttendance?: number;
  subDiscipline?: number;
  subEffort?: number;
  subCooperation?: number;
  attitudeNote?: string;
  progressNote: string;
  comment: string;
  teacherName: string;
}

export function getStudentAttitudeHistory(
  studentId: string,
  weeklyReports: WeeklyReport[]
): StudentAttitudeHistoryItem[] {
  const items: StudentAttitudeHistoryItem[] = [];
  weeklyReports.forEach((wr) => {
    const entry = (wr.studentEntries || []).find((se) => se.studentId === studentId);
    if (entry && entry.attitudeScore > 0) {
      items.push({
        weekKey: wr.weekKey,
        attitudeScore: entry.attitudeScore,
        subAttendance: entry.subAttendance,
        subDiscipline: entry.subDiscipline,
        subEffort: entry.subEffort,
        subCooperation: entry.subCooperation,
        attitudeNote: entry.attitudeNote,
        progressNote: entry.progressNote,
        comment: entry.comment,
        teacherName: wr.teacherName,
      });
    }
  });
  return items.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
}

export function computeClassWeeklySummary(
  classId: ClassId,
  testResults: TestResult[],
  minWeeklyAvgThreshold: number
) {
  const weekly = testResults.filter((r) => r.classId === classId && r.testType === 'weekly');
  const byWeek = new Map<string, { sum: number; count: number }>();
  weekly.forEach((r) => {
    const cur = byWeek.get(r.weekKey) || { sum: 0, count: 0 };
    cur.sum += r.scorePercent;
    cur.count += 1;
    byWeek.set(r.weekKey, cur);
  });
  const series = Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, v]) => ({ weekKey, avg: Math.round(v.sum / v.count), count: v.count }));

  const latest = series[series.length - 1] || null;
  const prev = series[series.length - 2] || null;
  const overallAvg =
    weekly.length > 0
      ? Math.round(weekly.reduce((s, r) => s + r.scorePercent, 0) / weekly.length)
      : null;
  const delta = latest && prev ? latest.avg - prev.avg : null;
  const needsAttention =
    (latest !== null && latest.avg < minWeeklyAvgThreshold) || (delta !== null && delta <= -5);

  return {
    classId,
    series: series.slice(-6),
    latestWeek: latest?.weekKey || null,
    latestAvg: latest?.avg ?? null,
    prevAvg: prev?.avg ?? null,
    delta,
    overallAvg,
    totalResults: weekly.length,
    needsAttention,
  };
}

export interface ComputedStudentAlert {
  id: string; // deterministic `${studentId}_${alertKey}`
  student: Student;
  alertKey: AlertTypeKey;
  reasonJa: string;
  reasonId: string;
  severity: 'high' | 'medium';
  metricValue: string;
  handledRecord: HandledAlert | null;
}

export function computeAtRiskAlerts(params: {
  students: Student[];
  testResults: TestResult[];
  reports: DailyReport[];
  weeklyReports: WeeklyReport[];
  thresholds?: QualityThresholds;
  handledAlerts?: HandledAlert[];
}): ComputedStudentAlert[] {
  const {
    students,
    testResults,
    reports,
    weeklyReports,
    thresholds = DEFAULT_QUALITY_THRESHOLDS,
    handledAlerts = [],
  } = params;

  const handledMap = new Map(handledAlerts.map((h) => [h.id, h]));
  const alerts: ComputedStudentAlert[] = [];

  students
    .filter((s) => s.active && Boolean(s.classId))
    .forEach((stu) => {
      const weeklyByWeek = getOfficialWeeklyScoreByWeek(stu.id, testResults);
      const classReports = reports.filter((r) => r.classId === stu.classId);
      const att = getStudentAttendanceSummary(stu.name, classReports);
      const attHistory = getStudentAttitudeHistory(stu.id, weeklyReports);

      // 1. Consecutive score drops (weekly exam only)
      const neededDropSteps = Math.max(1, thresholds.consecutiveDropWeeks);
      if (weeklyByWeek.length >= neededDropSteps + 1) {
        const recent = weeklyByWeek.slice(-(neededDropSteps + 1));
        let strictlyDropping = true;
        for (let i = 1; i < recent.length; i++) {
          if (recent[i].avgScore >= recent[i - 1].avgScore) {
            strictlyDropping = false;
            break;
          }
        }
        if (strictlyDropping) {
          const id = `${stu.id}_score_drop`;
          const trail = recent.map((x) => `${x.avgScore}%`).join(' → ');
          alerts.push({
            id,
            student: stu,
            alertKey: 'score_drop',
            severity: 'high',
            metricValue: trail,
            reasonJa: `週次テストが${neededDropSteps}週連続で低下 (${trail})`,
            reasonId: `Nilai tes mingguan turun ${neededDropSteps} minggu berturut-turut (${trail})`,
            handledRecord: handledMap.get(id) || null,
          });
        }
      }

      // 2. Low weekly exam average (< threshold)
      const allWeekly = testResults.filter(
        (r) => r.studentId === stu.id && r.testType === 'weekly'
      );
      if (allWeekly.length > 0) {
        const weeklyAvg = Math.round(
          allWeekly.reduce((s, r) => s + r.scorePercent, 0) / allWeekly.length
        );
        if (weeklyAvg < thresholds.minWeeklyAvgThreshold) {
          const id = `${stu.id}_low_avg`;
          alerts.push({
            id,
            student: stu,
            alertKey: 'low_avg',
            severity: weeklyAvg < thresholds.minWeeklyAvgThreshold - 15 ? 'high' : 'medium',
            metricValue: `${weeklyAvg}%`,
            reasonJa: `週次テスト平均が基準未満 (${weeklyAvg}% < ${thresholds.minWeeklyAvgThreshold}%)`,
            reasonId: `Rata-rata tes mingguan di bawah batas (${weeklyAvg}% < ${thresholds.minWeeklyAvgThreshold}%)`,
            handledRecord: handledMap.get(id) || null,
          });
        }
      }

      // 3. Frequent absences (>= threshold)
      if (att.absentCount >= thresholds.maxAbsentDays) {
        const id = `${stu.id}_frequent_absence`;
        alerts.push({
          id,
          student: stu,
          alertKey: 'frequent_absence',
          severity: att.absentCount >= thresholds.maxAbsentDays + 2 ? 'high' : 'medium',
          metricValue: `${att.absentCount}`,
          reasonJa: `欠席回数が規定以上 (${att.absentCount}回 / 基準 ${thresholds.maxAbsentDays}回)`,
          reasonId: `Sering absen (${att.absentCount} hari / batas ${thresholds.maxAbsentDays} hari)`,
          handledRecord: handledMap.get(id) || null,
        });
      }

      // 4. Low attitude score (< threshold)
      if (attHistory.length > 0) {
        const latestAtt = attHistory[attHistory.length - 1];
        const avgAtt = Number(
          (attHistory.reduce((s, a) => s + a.attitudeScore, 0) / attHistory.length).toFixed(1)
        );
        if (latestAtt.attitudeScore < thresholds.minAttitudeThreshold || avgAtt < thresholds.minAttitudeThreshold) {
          const id = `${stu.id}_low_attitude`;
          alerts.push({
            id,
            student: stu,
            alertKey: 'low_attitude',
            severity: latestAtt.attitudeScore <= 2 ? 'high' : 'medium',
            metricValue: `${latestAtt.attitudeScore}/5`,
            reasonJa: `学習態度評価が低下 (最新 ${latestAtt.attitudeScore}/5 · 平均 ${avgAtt}/5)`,
            reasonId: `Nilai sikap belajar rendah (terbaru ${latestAtt.attitudeScore}/5 · rata-rata ${avgAtt}/5)`,
            handledRecord: handledMap.get(id) || null,
          });
        }
      }
    });

  return alerts.sort((a, b) => {
    const aHandled = a.handledRecord ? 1 : 0;
    const bHandled = b.handledRecord ? 1 : 0;
    if (aHandled !== bHandled) return aHandled - bHandled;
    if (a.severity !== b.severity) return a.severity === 'high' ? -1 : 1;
    return a.student.name.localeCompare(b.student.name);
  });
}

export type RankingMetric = 'weekly_exam' | 'attitude' | 'combined';

export interface WeeklyRankingRow {
  rank: number;
  student: Student;
  weeklyScore: number | null; // selected week or overall weekly avg
  previousWeeklyScore: number | null;
  trendDelta: number | null;
  attitudeScore: number | null; // 1-5 scale
  attendanceRate: number | null; // %
  absentCount: number;
  combinedScore: number | null;
  sortValue: number;
  dailySecondaryAvg: number | null;
  lastTestTitle: string;
}

export function buildWeeklyRankingRows(params: {
  students: Student[];
  testResults: TestResult[];
  weeklyReports: WeeklyReport[];
  reports: DailyReport[];
  thresholds: QualityThresholds;
  classFilter: ClassId | 'all';
  weekFilter: string; // '' = latest/overall weekly average
  metric: RankingMetric;
}): WeeklyRankingRow[] {
  const {
    students,
    testResults,
    weeklyReports,
    reports,
    thresholds,
    classFilter,
    weekFilter,
    metric,
  } = params;

  const examW = Math.max(0, thresholds.examWeightPercent);
  const attW = Math.max(0, thresholds.attitudeWeightPercent);
  const weightSum = examW + attW || 1;

  // Determine ordered weeks across all weekly results so "previous week" can be looked up
  const allWeekKeys = Array.from(
    new Set(testResults.filter((r) => r.testType === 'weekly').map((r) => r.weekKey))
  ).sort((a, b) => a.localeCompare(b));
  const targetWeekIdx = weekFilter ? allWeekKeys.indexOf(weekFilter) : allWeekKeys.length - 1;
  const prevWeekKey = targetWeekIdx > 0 ? allWeekKeys[targetWeekIdx - 1] : null;

  const filteredStudents = students.filter(
    (s) => s.active && Boolean(s.classId) && (classFilter === 'all' ? true : s.classId === classFilter)
  );

  const rows: WeeklyRankingRow[] = filteredStudents.map((stu) => {
    const stuWeekly = testResults.filter(
      (r) => r.studentId === stu.id && r.testType === 'weekly'
    );
    const stuDaily = testResults.filter(
      (r) =>
        r.studentId === stu.id &&
        r.testType === 'daily' &&
        (!weekFilter ? true : r.weekKey === weekFilter)
    );
    const targetWeekly = weekFilter
      ? stuWeekly.filter((r) => r.weekKey === weekFilter)
      : stuWeekly;
    const prevWeekly = prevWeekKey
      ? stuWeekly.filter((r) => r.weekKey === prevWeekKey)
      : [];

    const avgArr = (arr: TestResult[]) =>
      arr.length > 0 ? Math.round(arr.reduce((s, r) => s + r.scorePercent, 0) / arr.length) : null;

    const weeklyScore = avgArr(targetWeekly);
    const previousWeeklyScore = avgArr(prevWeekly);

    // If no weekFilter, compare student's latest 2 weekly exam weeks
    let trendDelta: number | null = null;
    if (weekFilter) {
      if (weeklyScore !== null && previousWeeklyScore !== null) {
        trendDelta = weeklyScore - previousWeeklyScore;
      }
    } else {
      const history = getOfficialWeeklyScoreByWeek(stu.id, testResults);
      if (history.length >= 2) {
        trendDelta = history[history.length - 1].avgScore - history[history.length - 2].avgScore;
      }
    }

    const attHistory = getStudentAttitudeHistory(stu.id, weeklyReports).filter((a) =>
      !weekFilter ? true : a.weekKey === weekFilter
    );
    const attitudeScore =
      attHistory.length > 0
        ? Number(
            (attHistory.reduce((s, a) => s + a.attitudeScore, 0) / attHistory.length).toFixed(1)
          )
        : null;

    const scopedDailyReports = reports.filter(
      (r) => r.classId === stu.classId && (!weekFilter ? true : getWeekKey(r.date) === weekFilter)
    );
    const attSummary = getStudentAttendanceSummary(stu.name, scopedDailyReports);

    const combinedScore =
      weeklyScore !== null || attitudeScore !== null
        ? Math.round(
            (((weeklyScore ?? 0) * (weeklyScore !== null ? examW : 0)) +
              (((attitudeScore ?? 0) / 5) * 100 * (attitudeScore !== null ? attW : 0))) /
              ((weeklyScore !== null ? examW : 0) + (attitudeScore !== null ? attW : 0) || weightSum)
          )
        : null;

    const dailySecondaryAvg = avgArr(stuDaily);
    const latestRes = [...targetWeekly].sort((a, b) => b.date.localeCompare(a.date))[0];

    let sortValue = -1;
    if (metric === 'weekly_exam') {
      sortValue = weeklyScore ?? -1;
    } else if (metric === 'attitude') {
      sortValue = attitudeScore !== null ? attitudeScore * 20 : -1;
    } else {
      sortValue = combinedScore ?? -1;
    }

    return {
      rank: 0,
      student: stu,
      weeklyScore,
      previousWeeklyScore,
      trendDelta,
      attitudeScore,
      attendanceRate: attSummary.attendanceRate,
      absentCount: attSummary.absentCount,
      combinedScore,
      sortValue,
      dailySecondaryAvg,
      lastTestTitle: latestRes?.testTitle || '',
    };
  });

  // Sort highest score first, tiebreak by weeklyScore then name
  rows.sort((a, b) => {
    if (b.sortValue !== a.sortValue) return b.sortValue - a.sortValue;
    const bw = b.weeklyScore ?? -1;
    const aw = a.weeklyScore ?? -1;
    if (bw !== aw) return bw - aw;
    return a.student.name.localeCompare(b.student.name);
  });

  return rows.map((r, i) => ({
    ...r,
    rank: i + 1,
  }));
}

export function getClassSenseiNames(classId: ClassId, staffUsers: UserProfile[]): string[] {
  return staffUsers
    .filter((u) => u.status === 'active' && (u.assignedClasses || []).includes(classId))
    .map((u) => u.nickname || u.displayName);
}

export function isStudentAccessibleToUser(
  stu: Student,
  profile: UserProfile,
  scheduleRows: ScheduleRow[]
): boolean {
  if (profile.role === 'head') return true;
  if (!stu.classId) return false;
  if ((profile.assignedClasses || []).includes(stu.classId)) return true;
  const classInfo = CLASSES.find((c) => c.id === stu.classId);
  const classNames = [stu.classId, classInfo?.nameJa || '', classInfo?.nameId || ''].map((x) =>
    x.toLowerCase()
  );
  return scheduleRows.some(
    (r) =>
      doesRowMatchSensei(r, profile) &&
      classNames.some((cn) => cn && (r.className || '').toLowerCase().includes(cn))
  );
}
