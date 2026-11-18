import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { classLabel } from '../i18n';
import {
  CLASSES,
  DailyReport,
  LanguageMode,
  QualityThresholds,
  QuestionItem,
  ScheduleDoc,
  Student,
  TestResult,
  UserProfile,
  WeeklyReport,
} from '../types';
import {
  computeClassWeeklySummary,
  computeSenseiTeachingLoadHours,
  effectiveQuestionStatus,
  formatTimestamp,
  getDailyReportCompliance,
  getRecentWeekKeys,
  getWeeklyExamInputStatus,
  getWeeklyReportCompliance,
  parseTimestampMs,
} from '../utils/analyticsUtils';
import { CLASS_THEMES } from '../utils/classTheme';
import { getTodayDateStr, getWeekKey } from '../utils/dateUtils';
import { EmptyStateIllustration } from './AnimatedPrimitives';
import { AppleScrollReveal } from './AppleGestures';

interface Props {
  lang: LanguageMode;
  staffUsers: UserProfile[];
  students: Student[];
  reports: DailyReport[];
  weeklyReports: WeeklyReport[];
  testResults: TestResult[];
  questions: QuestionItem[];
  scheduleDoc: ScheduleDoc | null;
  thresholds: QualityThresholds;
}

function getRecentDays(count: number): string[] {
  const days: string[] = [];
  const base = new Date(`${getTodayDateStr()}T12:00:00Z`);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function SenseiMonitoringView({
  lang,
  staffUsers,
  students,
  reports,
  weeklyReports,
  testResults,
  questions,
  scheduleDoc,
  thresholds,
}: Props) {
  const [includeAdmins, setIncludeAdmins] = useState(false);

  const scheduleRows = scheduleDoc?.rows || [];
  const recentDays = useMemo(() => getRecentDays(10), []);
  const recentWeeks = useMemo(() => getRecentWeekKeys(6), []);
  const currentWeek = getWeekKey(getTodayDateStr());

  const monitoredUsers = useMemo(() => {
    return staffUsers
      .filter((u) => u.status === 'active' && (includeAdmins ? true : u.role === 'teacher'))
      .sort((a, b) => (a.nickname || a.displayName).localeCompare(b.nickname || b.displayName));
  }, [staffUsers, includeAdmins]);

  const classSummaries = useMemo(
    () =>
      CLASSES.map((cls) => ({
        cls,
        summary: computeClassWeeklySummary(
          cls.id,
          testResults,
          thresholds.minWeeklyAvgThreshold
        ),
      })),
    [testResults, thresholds.minWeeklyAvgThreshold]
  );

  const senseiMetrics = useMemo(() => {
    return monitoredUsers.map((sensei) => {
      const teachingLoad = computeSenseiTeachingLoadHours(sensei, scheduleRows);

      const senseiQuestions = questions.filter((q) => q.createdBy === sensei.uid);
      const qCounts = {
        total: senseiQuestions.length,
        approved: senseiQuestions.filter((q) => effectiveQuestionStatus(q) === 'approved').length,
        pending: senseiQuestions.filter((q) => effectiveQuestionStatus(q) === 'pending').length,
        draft: senseiQuestions.filter((q) => effectiveQuestionStatus(q) === 'draft').length,
        rejected: senseiQuestions.filter((q) => effectiveQuestionStatus(q) === 'rejected').length,
      };
      const latestQuestion = [...senseiQuestions].sort(
        (a, b) => parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt)
      )[0];

      const senseiScores = testResults.filter((r) => r.gradedBy === sensei.uid);
      const latestScore = [...senseiScores].sort(
        (a, b) =>
          parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt) ||
          b.date.localeCompare(a.date)
      )[0];

      const dailyCells = recentDays.map((dayStr) => {
        const dayReports = reports.filter(
          (r) => r.teacherUid === sensei.uid && r.date === dayStr
        );
        if (dayReports.length === 0) {
          const dow = new Date(`${dayStr}T12:00:00Z`).getUTCDay();
          const isWeekend = dow === 0 || dow === 6;
          return { dayStr, state: isWeekend ? ('weekend' as const) : ('missing' as const) };
        }
        const hasLate = dayReports.some((r) => getDailyReportCompliance(r) === 'late');
        return { dayStr, state: hasLate ? ('late' as const) : ('submitted' as const) };
      });

      const weeklyCells = recentWeeks.map((wk) => {
        const wkReports = weeklyReports.filter(
          (r) => r.teacherUid === sensei.uid && r.weekKey === wk
        );
        if (wkReports.length === 0) {
          return { wk, state: 'missing' as const };
        }
        const states = wkReports.map((r) => getWeeklyReportCompliance(r));
        if (states.includes('submitted')) return { wk, state: 'submitted' as const };
        if (states.includes('late')) return { wk, state: 'late' as const };
        return { wk, state: 'draft' as const };
      });

      return {
        sensei,
        teachingLoad,
        qCounts,
        latestQuestion,
        latestScore,
        dailyCells,
        weeklyCells,
      };
    });
  }, [
    monitoredUsers,
    scheduleRows,
    questions,
    testResults,
    recentDays,
    reports,
    recentWeeks,
    weeklyReports,
  ]);

  return (
    <div className="space-y-10">
      {/* Apple Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-2 max-w-2xl">
          <h1 className="apple-hero-title text-[32px] sm:text-[42px]">
            {lang === 'id' ? 'Monitoring Sensei.' : '講師モニタリング。'}
          </h1>
          <p className="text-[17px] leading-[1.47] text-[#6e6e73] dark:text-[#86868b]">
            {lang === 'id'
              ? 'Kepatuhan laporan, input ujian mingguan, jam mengajar, dan kontribusi bank soal.'
              : '日報・週報の提出状況、週次試験入力完了率、担当授業時間、問題貢献数を一覧で確認。'}
          </p>
        </div>

        <label className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-full bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] cursor-pointer text-[#1d1d1f] dark:text-[#f5f5f7] self-start sm:self-auto">
          <input
            type="checkbox"
            checked={includeAdmins}
            onChange={(e) => setIncludeAdmins(e.target.checked)}
            className="rounded border-[#d2d2d7] text-[#0071e3]"
          />
          <span>{lang === 'id' ? 'Sertakan Akun Admin' : '管理者アカウントも含める'}</span>
        </label>
      </div>

      {/* 1. Class Weekly Exam Summary & Trend Bento (Weekly Exam ONLY) */}
      <AppleScrollReveal>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[19px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            <TrendingUp className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
            <h2>
              {lang === 'id'
                ? 'Ringkasan Kelas & Tren Ujian Mingguan'
                : 'クラス別 週次試験サマリー・推移（公式スコア）'}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {classSummaries.map(({ cls, summary }) => {
              const cTheme = CLASS_THEMES[cls.id];
              return (
                <div
                  key={cls.id}
                  className="apple-tile apple-tile-interactive border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[24px] p-5 space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${cTheme.dotColor}`} />
                      <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] text-[15px]">
                        {lang === 'id' ? cls.nameId : cls.nameJa}
                      </span>
                    </div>
                    {summary.needsAttention && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a]">
                        <AlertTriangle className="w-3 h-3" />
                        <span>{lang === 'id' ? 'Perlu Perhatian' : '要注目'}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                        {lang === 'id' ? 'Rata² Ujian Mingguan' : '最新週次平均'}
                      </div>
                      <div className="text-[32px] font-semibold tracking-tight tabular-nums leading-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {summary.latestAvg !== null ? `${summary.latestAvg}%` : '—'}
                      </div>
                    </div>
                    {summary.delta !== null && (
                      <div
                        className={`inline-flex items-center gap-0.5 text-[12px] font-mono font-semibold px-2.5 py-1 rounded-full ${
                          summary.delta >= 0
                            ? 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#0071e3] dark:text-[#2997ff]'
                            : 'bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a]'
                        }`}
                      >
                        {summary.delta >= 0 ? (
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        ) : (
                          <ArrowDownRight className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {summary.delta > 0 ? `+${summary.delta}%` : `${summary.delta}%`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Monochrome + Single Blue Accent Mini Trend Bars */}
                  {summary.series.length > 0 && (
                    <div className="flex items-end gap-1.5 h-10 pt-1">
                      {summary.series.map((pt, i) => (
                        <div
                          key={pt.weekKey}
                          className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end"
                        >
                          <div
                            style={{ height: `${Math.max(12, pt.avg)}%` }}
                            title={`${pt.weekKey}: ${pt.avg}%`}
                            className={`w-full rounded-t-[4px] ${
                              i === summary.series.length - 1
                                ? 'bg-[#0071e3] dark:bg-[#2997ff]'
                                : 'bg-[#d2d2d7] dark:bg-[#424245]'
                            }`}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[12px] tabular-nums text-[#6e6e73] dark:text-[#86868b] flex items-center justify-between pt-2.5 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50">
                    <span>
                      {lang === 'id' ? 'Rata² Total:' : '通算平均:'}{' '}
                      {summary.overallAvg !== null ? `${summary.overallAvg}%` : '—'}
                    </span>
                    <span className="font-mono">{summary.latestWeek || '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AppleScrollReveal>

      {/* 2. Weekly Exam Input Status (Per Class x Recent Weeks) */}
      <AppleScrollReveal delay={0.05}>
        <div className="apple-table-wrap">
          <div className="px-6 py-5 border-b border-[#d2d2d7]/60 dark:border-[#424245]/60">
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
              <span>
                {lang === 'id'
                  ? 'Status Kelengkapan Input Nilai Ujian Mingguan'
                  : 'クラス別 週次試験スコア入力状況'}
              </span>
            </h2>
            <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-0.5">
              {lang === 'id'
                ? 'Menunjukkan apakah seluruh siswa aktif pada kelas tersebut sudah diinput nilai ujian mingguannya.'
                : '各クラス・各週の在籍学生全員分の週次試験点数が入力されているか確認します。'}
            </p>
          </div>

          <div className="apple-scroll-x">
            <table className="w-full text-[14px] text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="bg-[#f5f5f7]/80 dark:bg-[#161617]/80 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  <th className="py-3 px-5 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[5]">
                    {lang === 'id' ? 'Kelas' : 'クラス'}
                  </th>
                  {recentWeeks.slice(-4).map((wk) => (
                    <th key={wk} className="py-3 px-4 font-mono font-medium text-center">
                      {wk} {wk === currentWeek ? '·' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLASSES.map((cls) => {
                  const cTheme = CLASS_THEMES[cls.id];
                  return (
                    <tr key={cls.id} className="apple-table-row">
                      <td className="py-3 px-5 font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5] whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${cTheme.dotColor}`} />
                          <span>{classLabel(cls.id, lang)}</span>
                        </span>
                      </td>
                      {recentWeeks.slice(-4).map((wk) => {
                        const res = getWeeklyExamInputStatus({
                          classId: cls.id,
                          weekKey: wk,
                          students,
                          testResults,
                        });
                        const badgeCls =
                          res.status === 'complete'
                            ? 'bg-[#ecfdf5] dark:bg-[#052e16] text-[#15803d] dark:text-[#4ade80]'
                            : res.status === 'partial'
                            ? 'bg-[#fffbeb] dark:bg-[#2b1e08] text-[#b45309] dark:text-[#fbbf24]'
                            : 'bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a]';
                        const label =
                          res.status === 'complete'
                            ? lang === 'id'
                              ? 'Lengkap'
                              : '完了'
                            : res.status === 'partial'
                            ? lang === 'id'
                              ? 'Sebagian'
                              : '一部入力'
                            : lang === 'id'
                            ? 'Belum'
                            : '未入力';
                        return (
                          <td key={wk} className="py-3 px-4 text-center">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[12px] font-medium tabular-nums ${badgeCls}`}
                            >
                              <span>{label}</span>
                              <span>
                                ({res.entered}/{res.total})
                              </span>
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </AppleScrollReveal>

      {/* 3. Per-Sensei Activity, Teaching Load & Question Contributions */}
      <AppleScrollReveal delay={0.08}>
        <div className="apple-table-wrap">
          <div className="px-6 py-5 border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'id'
                ? 'Aktivitas Terbaru, Jam Mengajar & Kontribusi Bank Soal'
                : '講師別 アクティビティ・担当授業数・問題バンク貢献'}
            </h2>
          </div>

          {senseiMetrics.length === 0 ? (
            <div className="p-6">
              <EmptyStateIllustration
                kind="users"
                title={
                  lang === 'id'
                    ? 'Belum ada akun Sensei aktif'
                    : '有効な講師アカウントがまだありません'
                }
              />
            </div>
          ) : (
            <div className="apple-scroll-x">
              <table className="w-full text-[14px] text-left border-collapse min-w-[820px]">
                <thead>
                  <tr className="bg-[#f5f5f7]/80 dark:bg-[#161617]/80 text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                    <th className="py-3 px-5 font-medium sticky left-0 bg-[#f5f5f7] dark:bg-[#161617] z-[5]">
                      Sensei
                    </th>
                    <th className="py-3 px-4 font-medium">
                      {lang === 'id' ? 'Login Terakhir' : '最終ログイン'}
                    </th>
                    <th className="py-3 px-4 font-medium">
                      {lang === 'id' ? 'Input Nilai Terakhir' : '最終採点入力'}
                    </th>
                    <th className="py-3 px-4 font-medium">
                      {lang === 'id' ? 'Tambah Soal Terakhir' : '最終問題登録'}
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      {lang === 'id' ? 'Beban Mengajar' : '週間授業時間'}
                    </th>
                    <th className="py-3 px-5 font-medium">
                      {lang === 'id' ? 'Kontribusi Soal' : '問題バンク貢献'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {senseiMetrics.map(
                    ({ sensei, teachingLoad, qCounts, latestQuestion, latestScore }) => {
                      const sName = sensei.nickname || sensei.displayName;
                      return (
                        <tr key={sensei.uid} className="apple-table-row">
                          <td className="py-3 px-5 sticky left-0 bg-white dark:bg-[#1d1d1f] z-[5]">
                            <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {sName}
                            </div>
                            <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                              {(sensei.assignedClasses || [])
                                .map((cid) => classLabel(cid, lang))
                                .join(', ') || '—'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-[13px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                            {formatTimestamp(sensei.lastLoginAt)}
                          </td>
                          <td className="py-3 px-4 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {latestScore ? (
                              <div>
                                <div className="font-mono tabular-nums text-[12px]">
                                  {formatTimestamp(latestScore.createdAt) !== '—'
                                    ? formatTimestamp(latestScore.createdAt)
                                    : latestScore.date}
                                </div>
                                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] truncate max-w-[140px]">
                                  {latestScore.studentName} ({latestScore.scorePercent}%)
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-4 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                            {latestQuestion ? (
                              <div>
                                <div className="font-mono tabular-nums text-[12px]">
                                  {formatTimestamp(latestQuestion.createdAt)}
                                </div>
                                <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] truncate max-w-[140px]">
                                  {latestQuestion.prompt}
                                </div>
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono tabular-nums text-right whitespace-nowrap">
                            <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {teachingLoad.hoursPerWeek} {lang === 'id' ? 'jam' : '時間'}
                            </span>
                            <span className="text-[#6e6e73] dark:text-[#86868b] ml-1 text-[12px]">
                              ({teachingLoad.sessionCount} {lang === 'id' ? 'sesi' : 'コマ'})
                            </span>
                          </td>
                          <td className="py-3 px-5">
                            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
                              <span className="px-2 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                                <BookOpen className="w-2.5 h-2.5 inline mr-1" />
                                {qCounts.total}
                              </span>
                              <span className="px-2 py-0.5 rounded-full bg-[#ecfdf5] dark:bg-[#052e16] text-[#15803d] dark:text-[#4ade80]">
                                ✓ {qCounts.approved}
                              </span>
                              {qCounts.pending > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-[#fffbeb] dark:bg-[#2b1e08] text-[#b45309] dark:text-[#fbbf24]">
                                  {qCounts.pending}
                                </span>
                              )}
                              {qCounts.rejected > 0 && (
                                <span className="px-2 py-0.5 rounded-full bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a]">
                                  ✕ {qCounts.rejected}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </AppleScrollReveal>

      {/* 4. Report Compliance Calendar (Daily 10 days + Weekly 6 weeks) */}
      <AppleScrollReveal delay={0.1}>
        <div className="apple-table-wrap">
          <div className="px-6 py-5 border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
              <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id'
                  ? 'Kalender Kepatuhan Laporan (Harian & Mingguan)'
                  : '日報・週報 提出カレンダー'}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#ecfdf5] dark:bg-[#052e16] text-[#15803d] dark:text-[#4ade80] font-medium">
                {lang === 'id' ? 'Tepat Waktu' : '提出済'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#fffbeb] dark:bg-[#2b1e08] text-[#b45309] dark:text-[#fbbf24] font-medium">
                {lang === 'id' ? 'Terlambat' : '遅延'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a] font-medium">
                {lang === 'id' ? 'Belum / Alpha' : '未提出'}
              </span>
            </div>
          </div>

          {senseiMetrics.length > 0 && (
            <div className="divide-y divide-[#d2d2d7]/60 dark:divide-[#424245]/60">
              {/* Daily Calendar */}
              <div className="p-5 sm:p-6 space-y-3">
                <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#6e6e73] dark:text-[#86868b]" />
                  <span>
                    {lang === 'id' ? 'Laporan Harian (10 Hari Terakhir)' : '日報（直近10日間）'}
                  </span>
                </div>
                <div className="apple-scroll-x">
                  <table className="w-full text-[13px] text-left border-collapse min-w-[660px]">
                    <thead>
                      <tr className="border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 text-[#6e6e73] dark:text-[#86868b]">
                        <th className="py-2 pr-3 font-medium sticky left-0 bg-white dark:bg-[#1d1d1f]">
                          Sensei
                        </th>
                        {recentDays.map((d) => (
                          <th key={d} className="py-2 px-1.5 font-mono text-[11px] text-center">
                            {d.slice(5)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#424245]/40">
                      {senseiMetrics.map(({ sensei, dailyCells }) => (
                        <tr key={sensei.uid}>
                          <td className="py-2.5 pr-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap sticky left-0 bg-white dark:bg-[#1d1d1f]">
                            {sensei.nickname || sensei.displayName}
                          </td>
                          {dailyCells.map((c) => (
                            <td key={c.dayStr} className="py-2.5 px-1.5 text-center">
                              {c.state === 'weekend' ? (
                                <span className="inline-block w-6 h-6 leading-6 rounded-[6px] text-[11px] text-[#6e6e73] dark:text-[#86868b] bg-[#f5f5f7] dark:bg-[#2c2c2e]">
                                  —
                                </span>
                              ) : c.state === 'submitted' ? (
                                <span
                                  title={`${c.dayStr}: Submitted`}
                                  className="inline-block w-6 h-6 leading-6 rounded-[6px] text-[11px] font-semibold bg-[#ecfdf5] dark:bg-[#052e16] text-[#15803d] dark:text-[#4ade80]"
                                >
                                  ✓
                                </span>
                              ) : c.state === 'late' ? (
                                <span
                                  title={`${c.dayStr}: Late`}
                                  className="inline-block w-6 h-6 leading-6 rounded-[6px] text-[11px] font-semibold bg-[#fffbeb] dark:bg-[#2b1e08] text-[#b45309] dark:text-[#fbbf24]"
                                >
                                  !
                                </span>
                              ) : (
                                <span
                                  title={`${c.dayStr}: Missing`}
                                  className="inline-block w-6 h-6 leading-6 rounded-[6px] text-[11px] font-semibold bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a]"
                                >
                                  ×
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Weekly Calendar */}
              <div className="p-5 sm:p-6 space-y-3">
                <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'id' ? 'Laporan Mingguan (6 Minggu Terakhir)' : '週報（直近6週間）'}
                </div>
                <div className="apple-scroll-x">
                  <table className="w-full text-[13px] text-left border-collapse min-w-[580px]">
                    <thead>
                      <tr className="border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 text-[#6e6e73] dark:text-[#86868b]">
                        <th className="py-2 pr-3 font-medium sticky left-0 bg-white dark:bg-[#1d1d1f]">
                          Sensei
                        </th>
                        {recentWeeks.map((wk) => (
                          <th key={wk} className="py-2 px-2 font-mono text-[11px] text-center">
                            {wk}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#d2d2d7]/40 dark:divide-[#424245]/40">
                      {senseiMetrics.map(({ sensei, weeklyCells }) => (
                        <tr key={sensei.uid}>
                          <td className="py-2.5 pr-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap sticky left-0 bg-white dark:bg-[#1d1d1f]">
                            {sensei.nickname || sensei.displayName}
                          </td>
                          {weeklyCells.map((c) => (
                            <td key={c.wk} className="py-2.5 px-2 text-center">
                              <span
                                className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                                  c.state === 'submitted'
                                    ? 'bg-[#ecfdf5] dark:bg-[#052e16] text-[#15803d] dark:text-[#4ade80]'
                                    : c.state === 'late'
                                    ? 'bg-[#fffbeb] dark:bg-[#2b1e08] text-[#b45309] dark:text-[#fbbf24]'
                                    : c.state === 'draft'
                                    ? 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
                                    : 'bg-[#fef2f2] dark:bg-[#2c1517] text-[#dc2626] dark:text-[#ff453a]'
                                }`}
                              >
                                {c.state === 'submitted'
                                  ? lang === 'id'
                                    ? 'Kirim'
                                    : '済'
                                  : c.state === 'late'
                                  ? lang === 'id'
                                    ? 'Telat'
                                    : '遅'
                                  : c.state === 'draft'
                                  ? 'Draft'
                                  : lang === 'id'
                                  ? 'Kosong'
                                  : '未'}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </AppleScrollReveal>
    </div>
  );
}
