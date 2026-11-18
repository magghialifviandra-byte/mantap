import * as XLSX from 'xlsx';
import { categoryLabel, classLabel } from '../i18n';
import {
  ClassId,
  CLASSES,
  DailyReport,
  HeadJournalEntry,
  LanguageMode,
  TestResult,
} from '../types';
import { WeeklyRankingRow } from './analyticsUtils';
import { getWeekKey } from './dateUtils';

export type ExportScopeType = 'daily' | 'weekly';

export interface CsvSection {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
}

function escapeCsvCell(val: unknown): string {
  const raw = val === null || val === undefined ? '' : String(val);
  const clean = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/[",\n]/.test(clean)) {
    return `"${clean.replace(/"/g, '""')}"`;
  }
  return clean;
}

export function downloadCsvSections(filename: string, sections: CsvSection[]): void {
  const lines: string[] = [];

  sections.forEach((sec, idx) => {
    if (idx > 0) lines.push('');
    if (sec.title) {
      lines.push(escapeCsvCell(sec.title));
    }
    lines.push(sec.headers.map(escapeCsvCell).join(','));
    sec.rows.forEach((row) => {
      lines.push(row.map(escapeCsvCell).join(','));
    });
  });

  const csvContent = `\uFEFF${lines.join('\n')}\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function approvalLabel(status: DailyReport['approvalStatus'] | undefined, lang: LanguageMode): string {
  const s = status || 'pending';
  if (s === 'approved') {
    return lang === 'ja' ? '承認済' : lang === 'id' ? 'Disetujui' : '承認済 / Disetujui';
  }
  if (s === 'revision_needed') {
    return lang === 'ja' ? '要修正' : lang === 'id' ? 'Perlu Revisi' : '要修正 / Perlu Revisi';
  }
  return lang === 'ja' ? '承認待ち' : lang === 'id' ? 'Menunggu Approval' : '承認待ち / Menunggu';
}

function formatLessonSummary(r: DailyReport): string {
  const parts: string[] = [];
  if (r.kanaProgress) parts.push(`かな: ${r.kanaProgress}`);
  if (r.textbookUnit) parts.push(`教材: ${r.textbookUnit}`);
  if (r.examPractice) parts.push(`対策: ${r.examPractice}`);
  if (r.conversationTopic) parts.push(`会話: ${r.conversationTopic}`);
  if (r.kaigoTopic) parts.push(`介護: ${r.kaigoTopic}`);
  return parts.join(' | ') || '—';
}

export interface DailyExportBundle {
  reports: DailyReport[];
  dailyTests: TestResult[];
  totalReports: number;
  approvedReports: number;
  revisionReports: number;
  pendingReports: number;
  avgAttendanceRate: number | null;
  totalDailyTests: number;
  avgDailyTestScore: number | null;
  dailyPassRate: number | null;
}

export function compileDailyExportData(params: {
  reports: DailyReport[];
  testResults: TestResult[];
  selectedClass: ClassId | 'all';
  dateFilter: string; // '' = all dates, or YYYY-MM-DD
}): DailyExportBundle {
  const { reports, testResults, selectedClass, dateFilter } = params;

  const filteredReports = reports
    .filter((r) => (selectedClass === 'all' ? true : r.classId === selectedClass))
    .filter((r) => (!dateFilter ? true : r.date === dateFilter))
    .sort((a, b) => b.date.localeCompare(a.date) || a.classId.localeCompare(b.classId));

  const dailyTests = testResults
    .filter((t) => t.testType === 'daily')
    .filter((t) => (selectedClass === 'all' ? true : t.classId === selectedClass))
    .filter((t) => (!dateFilter ? true : t.date === dateFilter))
    .sort((a, b) => b.date.localeCompare(a.date) || a.classId.localeCompare(b.classId) || a.studentName.localeCompare(b.studentName));

  const approvedReports = filteredReports.filter((r) => (r.approvalStatus || 'pending') === 'approved').length;
  const revisionReports = filteredReports.filter((r) => (r.approvalStatus || 'pending') === 'revision_needed').length;
  const pendingReports = filteredReports.filter((r) => (r.approvalStatus || 'pending') === 'pending').length;

  const attendanceRatios = filteredReports
    .filter((r) => r.totalStudents > 0)
    .map((r) => (r.presentCount / r.totalStudents) * 100);
  const avgAttendanceRate =
    attendanceRatios.length > 0
      ? Math.round(attendanceRatios.reduce((s, v) => s + v, 0) / attendanceRatios.length)
      : null;

  const avgDailyTestScore =
    dailyTests.length > 0
      ? Math.round(dailyTests.reduce((s, t) => s + t.scorePercent, 0) / dailyTests.length)
      : null;

  const dailyPassRate =
    dailyTests.length > 0
      ? Math.round((dailyTests.filter((t) => t.scorePercent >= 70).length / dailyTests.length) * 100)
      : null;

  return {
    reports: filteredReports,
    dailyTests,
    totalReports: filteredReports.length,
    approvedReports,
    revisionReports,
    pendingReports,
    avgAttendanceRate,
    totalDailyTests: dailyTests.length,
    avgDailyTestScore,
    dailyPassRate,
  };
}

export function exportDailyReportCsv(params: {
  bundle: DailyExportBundle;
  lang: LanguageMode;
  selectedClass: ClassId | 'all';
  dateFilter: string;
}): void {
  const { bundle, lang, selectedClass, dateFilter } = params;
  const dateTag = dateFilter || 'all-dates';
  const classTag = selectedClass;

  const reportHeaders = [
    '日付 / Tanggal',
    '週 / Minggu',
    'クラス / Kelas',
    '担当講師 / Sensei',
    '出席人数 / Hadir',
    '総人数 / Total Siswa',
    '出席率(%) / Kehadiran(%)',
    '欠席者 / Tidak Hadir',
    '遅刻者 / Terlambat',
    '授業進捗 / Materi Kelas',
    '宿題 / Homework',
    'クラス雰囲気(1-5) / Suasana',
    '課題・注意点 / Kendala',
    '明日の予定 / Rencana Besok',
    '総合所見 / Catatan Umum',
    '個別学生メモ / Catatan Siswa',
    '承認ステータス / Status Approval',
    '校長フィードバック / Feedback Kepala',
    '承認者 / Disetujui Oleh',
    '承認日時 / Waktu Approval',
  ];

  const reportRows = bundle.reports.map((r) => {
    const rate = r.totalStudents > 0 ? Math.round((r.presentCount / r.totalStudents) * 100) : 0;
    const stuNotes = (r.studentNotes || []).map((sn) => `${sn.studentName}: ${sn.note}`).join(' | ');
    return [
      r.date,
      getWeekKey(r.date),
      classLabel(r.classId, lang),
      r.teacherName,
      r.presentCount,
      r.totalStudents,
      `${rate}%`,
      (r.absentNames || []).join('; '),
      (r.lateNames || []).join('; '),
      formatLessonSummary(r),
      r.homework || '',
      r.atmosphere,
      r.issues || '',
      r.tomorrowPlan || '',
      r.overallComment || '',
      stuNotes,
      approvalLabel(r.approvalStatus, lang),
      r.headFeedback || '',
      r.approvedBy || '',
      r.approvedAt || '',
    ];
  });

  const testHeaders = [
    '日付 / Tanggal',
    '週 / Minggu',
    'クラス / Kelas',
    '学生名 / Nama Siswa',
    'テスト名 / Judul Tes',
    'カテゴリー / Kategori',
    '採点方法 / Mode',
    '得点 / Skor',
    '満点 / Maks',
    '正答率(%) / Nilai(%)',
    '合否(>=70%) / Status',
    '苦手カテゴリー / Salah',
    '担当講師 / Penilai',
    '備考 / Catatan',
  ];

  const testRows = bundle.dailyTests.map((t) => [
    t.date,
    t.weekKey,
    classLabel(t.classId, lang),
    t.studentName,
    t.testTitle,
    t.category ? categoryLabel(t.category, lang) : '—',
    t.entryMode === 'answer_key' ? '採点キー / Kunci Jawaban' : '手動入力 / Manual',
    t.earnedScore,
    t.maxScore,
    `${t.scorePercent}%`,
    t.scorePercent >= 70 ? '合格 / Lulus' : '要フォロー / Remedial',
    (t.wrongCategories || []).map((c) => categoryLabel(c, lang)).join('; '),
    t.gradedByName,
    t.note || '',
  ]);

  downloadCsvSections(`genki-academy-daily-report_${classTag}_${dateTag}.csv`, [
    {
      title: `元気アカデミー 日次レポート / Laporan Harian (${classLabel(selectedClass, lang)} | ${dateFilter || '全期間 / Semua Tanggal'})`,
      headers: reportHeaders,
      rows: reportRows,
    },
    {
      title: '日次テスト成績記録 / Rekapan Nilai Tes Harian',
      headers: testHeaders,
      rows: testRows,
    },
  ]);
}

export interface WeeklyClassSummaryRow {
  weekKey: string;
  classId: ClassId;
  reportCount: number;
  approvedCount: number;
  avgAttendanceRate: number | null;
  avgAtmosphere: number | null;
  dailyTestCount: number;
  dailyAvg: number | null;
  weeklyTestCount: number;
  weeklyAvg: number | null;
  weeklyPassRate: number | null;
  topWeakCategory: string | null;
}

export interface WeeklyExportBundle {
  weeksCovered: string[];
  classSummaryRows: WeeklyClassSummaryRow[];
  reports: DailyReport[];
  testResults: TestResult[];
  weakPoints: { cat: string; count: number; share: number }[];
  totalReports: number;
  avgAttendanceRate: number | null;
  weeklyTestsCount: number;
  avgWeeklyScore: number | null;
  weeklyPassRate: number | null;
}

export function compileWeeklyExportData(params: {
  reports: DailyReport[];
  testResults: TestResult[];
  selectedClass: ClassId | 'all';
  weekFilter: string; // '' = all weeks, or e.g. '2026-W46'
}): WeeklyExportBundle {
  const { reports, testResults, selectedClass, weekFilter } = params;

  const filteredReports = reports
    .filter((r) => (selectedClass === 'all' ? true : r.classId === selectedClass))
    .filter((r) => (!weekFilter ? true : getWeekKey(r.date) === weekFilter))
    .sort((a, b) => b.date.localeCompare(a.date) || a.classId.localeCompare(b.classId));

  const filteredTests = testResults
    .filter((t) => (selectedClass === 'all' ? true : t.classId === selectedClass))
    .filter((t) => (!weekFilter ? true : t.weekKey === weekFilter))
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey) || b.date.localeCompare(a.date) || a.classId.localeCompare(b.classId));

  const weekSet = new Set<string>();
  filteredReports.forEach((r) => weekSet.add(getWeekKey(r.date)));
  filteredTests.forEach((t) => weekSet.add(t.weekKey));
  const weeksCovered = Array.from(weekSet).sort((a, b) => b.localeCompare(a));

  const targetClasses = selectedClass === 'all' ? CLASSES.map((c) => c.id) : [selectedClass];
  const classSummaryRows: WeeklyClassSummaryRow[] = [];

  weeksCovered.forEach((wk) => {
    targetClasses.forEach((cid) => {
      const wkReports = filteredReports.filter((r) => getWeekKey(r.date) === wk && r.classId === cid);
      const wkTests = filteredTests.filter((t) => t.weekKey === wk && t.classId === cid);
      if (wkReports.length === 0 && wkTests.length === 0) return;

      const dailyTs = wkTests.filter((t) => t.testType === 'daily');
      const weeklyTs = wkTests.filter((t) => t.testType === 'weekly');

      const attRatios = wkReports.filter((r) => r.totalStudents > 0).map((r) => (r.presentCount / r.totalStudents) * 100);
      const avgAtt =
        attRatios.length > 0 ? Math.round(attRatios.reduce((s, v) => s + v, 0) / attRatios.length) : null;
      const avgAtm =
        wkReports.length > 0
          ? Number((wkReports.reduce((s, r) => s + (r.atmosphere || 0), 0) / wkReports.length).toFixed(1))
          : null;

      const avgPct = (arr: TestResult[]) =>
        arr.length > 0 ? Math.round(arr.reduce((s, r) => s + r.scorePercent, 0) / arr.length) : null;

      const weakMap = new Map<string, number>();
      wkTests.forEach((t) => (t.wrongCategories || []).forEach((c) => weakMap.set(c, (weakMap.get(c) || 0) + 1)));
      const topWeak = Array.from(weakMap.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

      classSummaryRows.push({
        weekKey: wk,
        classId: cid,
        reportCount: wkReports.length,
        approvedCount: wkReports.filter((r) => (r.approvalStatus || 'pending') === 'approved').length,
        avgAttendanceRate: avgAtt,
        avgAtmosphere: avgAtm,
        dailyTestCount: dailyTs.length,
        dailyAvg: avgPct(dailyTs),
        weeklyTestCount: weeklyTs.length,
        weeklyAvg: avgPct(weeklyTs),
        weeklyPassRate:
          weeklyTs.length > 0
            ? Math.round((weeklyTs.filter((t) => t.scorePercent >= 70).length / weeklyTs.length) * 100)
            : null,
        topWeakCategory: topWeak,
      });
    });
  });

  // Global weak points for this weekly scope
  const weakCounts = new Map<string, number>();
  filteredTests.forEach((t) => {
    (t.wrongCategories || []).forEach((c) => weakCounts.set(c, (weakCounts.get(c) || 0) + 1));
  });
  const totalWrong = Array.from(weakCounts.values()).reduce((a, b) => a + b, 0) || 1;
  const weakPoints = Array.from(weakCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([cat, count]) => ({
      cat,
      count,
      share: Math.round((count / totalWrong) * 100),
    }));

  const attAll = filteredReports
    .filter((r) => r.totalStudents > 0)
    .map((r) => (r.presentCount / r.totalStudents) * 100);
  const avgAttendanceRate =
    attAll.length > 0 ? Math.round(attAll.reduce((s, v) => s + v, 0) / attAll.length) : null;

  const weeklyOnly = filteredTests.filter((t) => t.testType === 'weekly');
  const targetForScore = weeklyOnly.length > 0 ? weeklyOnly : filteredTests;
  const avgWeeklyScore =
    targetForScore.length > 0
      ? Math.round(targetForScore.reduce((s, t) => s + t.scorePercent, 0) / targetForScore.length)
      : null;
  const weeklyPassRate =
    targetForScore.length > 0
      ? Math.round((targetForScore.filter((t) => t.scorePercent >= 70).length / targetForScore.length) * 100)
      : null;

  return {
    weeksCovered,
    classSummaryRows,
    reports: filteredReports,
    testResults: filteredTests,
    weakPoints,
    totalReports: filteredReports.length,
    avgAttendanceRate,
    weeklyTestsCount: weeklyOnly.length,
    avgWeeklyScore,
    weeklyPassRate,
  };
}

export function exportWeeklyReportCsv(params: {
  bundle: WeeklyExportBundle;
  lang: LanguageMode;
  selectedClass: ClassId | 'all';
  weekFilter: string;
}): void {
  const { bundle, lang, selectedClass, weekFilter } = params;
  const weekTag = weekFilter || 'all-weeks';

  const summaryHeaders = [
    '週 / Minggu',
    'クラス / Kelas',
    '提出日報数 / Jml Laporan',
    '承認済日報 / Disetujui',
    '平均出席率(%) / Rata-rata Hadir(%)',
    '平均雰囲気 / Rata-rata Suasana',
    '日次テスト件数 / Tes Harian',
    '日次平均点(%) / Rata-rata Harian(%)',
    '週次テスト件数 / Tes Mingguan',
    '週次平均点(%) / Rata-rata Mingguan(%)',
    '週次合格率(>=70%) / Kelulusan(%)',
    '主な苦手分野 / Titik Lemah Utama',
  ];

  const summaryRows = bundle.classSummaryRows.map((row) => [
    row.weekKey,
    classLabel(row.classId, lang),
    row.reportCount,
    row.approvedCount,
    row.avgAttendanceRate !== null ? `${row.avgAttendanceRate}%` : '—',
    row.avgAtmosphere !== null ? `${row.avgAtmosphere}/5` : '—',
    row.dailyTestCount,
    row.dailyAvg !== null ? `${row.dailyAvg}%` : '—',
    row.weeklyTestCount,
    row.weeklyAvg !== null ? `${row.weeklyAvg}%` : '—',
    row.weeklyPassRate !== null ? `${row.weeklyPassRate}%` : '—',
    row.topWeakCategory ? categoryLabel(row.topWeakCategory, lang) : '—',
  ]);

  const testHeaders = [
    '週 / Minggu',
    '日付 / Tanggal',
    '種別 / Jenis Tes',
    'クラス / Kelas',
    '学生名 / Nama Siswa',
    'テスト名 / Judul Tes',
    'カテゴリー / Kategori',
    '得点 / Skor',
    '満点 / Maks',
    '正答率(%) / Nilai(%)',
    '合否 / Status',
    '苦手カテゴリー / Salah',
    '担当講師 / Penilai',
  ];

  const testRows = bundle.testResults.map((t) => [
    t.weekKey,
    t.date,
    t.testType === 'weekly' ? '週次 / Mingguan' : '日次 / Harian',
    classLabel(t.classId, lang),
    t.studentName,
    t.testTitle,
    t.category ? categoryLabel(t.category, lang) : '—',
    t.earnedScore,
    t.maxScore,
    `${t.scorePercent}%`,
    t.scorePercent >= 70 ? '合格 / Lulus' : '要フォロー / Remedial',
    (t.wrongCategories || []).map((c) => categoryLabel(c, lang)).join('; '),
    t.gradedByName,
  ]);

  const reportHeaders = [
    '週 / Minggu',
    '日付 / Tanggal',
    'クラス / Kelas',
    '担当講師 / Sensei',
    '出席 / Hadir',
    '授業進捗 / Materi',
    '課題・注意点 / Kendala',
    '承認ステータス / Status',
    '校長フィードバック / Feedback',
  ];

  const reportRows = bundle.reports.map((r) => [
    getWeekKey(r.date),
    r.date,
    classLabel(r.classId, lang),
    r.teacherName,
    `${r.presentCount}/${r.totalStudents}`,
    formatLessonSummary(r),
    r.issues || '',
    approvalLabel(r.approvalStatus, lang),
    r.headFeedback || '',
  ]);

  downloadCsvSections(`genki-academy-weekly-report_${selectedClass}_${weekTag}.csv`, [
    {
      title: `元気アカデミー 週次総括サマリー / Ringkasan Mingguan (${classLabel(selectedClass, lang)} | ${weekFilter || '全週 / Semua Minggu'})`,
      headers: summaryHeaders,
      rows: summaryRows,
    },
    {
      title: '週次・日次テスト成績明細 / Detail Nilai Tes Minggu Ini',
      headers: testHeaders,
      rows: testRows,
    },
    {
      title: '該当週の日報記録 / Catatan Laporan Sensei Minggu Ini',
      headers: reportHeaders,
      rows: reportRows,
    },
  ]);
}

export function exportDailyReportXlsx(params: {
  bundle: DailyExportBundle;
  lang: LanguageMode;
  selectedClass: ClassId | 'all';
  dateFilter: string;
}) {
  const { bundle, lang, selectedClass, dateFilter } = params;
  const dateTag = dateFilter || 'all-dates';
  const wb = XLSX.utils.book_new();

  const summaryRows = [
    ['元気アカデミー 日次運営・成績レポート', `${classLabel(selectedClass, lang)} | ${dateFilter || '全日付 / Semua Tanggal'}`],
    [],
    ['項目 / Metrik', '値 / Nilai'],
    ['提出日報数 / Total Laporan', bundle.totalReports],
    ['承認済日報 / Disetujui', bundle.approvedReports],
    ['要修正日報 / Revisi', bundle.revisionReports],
    ['承認待ち日報 / Menunggu', bundle.pendingReports],
    ['平均出席率 / Rata-rata Kehadiran', bundle.avgAttendanceRate !== null ? `${bundle.avgAttendanceRate}%` : '—'],
    ['日次テスト受験件数 / Total Tes Harian', bundle.totalDailyTests],
    ['日次テスト平均点 / Rata-rata Tes Harian', bundle.avgDailyTestScore !== null ? `${bundle.avgDailyTestScore}%` : '—'],
    ['日次テスト合格率(>=70%) / Tingkat Kelulusan', bundle.dailyPassRate !== null ? `${bundle.dailyPassRate}%` : '—'],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 42 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  const reportHeaders = [
    '日付 / Tanggal',
    'クラス / Kelas',
    '担当講師 / Sensei',
    '出席 / Hadir',
    '在籍 / Total',
    '出席率(%)',
    '欠席者 / Absen',
    '遅刻者 / Telat',
    '授業進捗 / Materi',
    '宿題 / PR',
    '雰囲気(1-5)',
    '全体コメント / Komentar',
    '課題・注意点 / Kendala',
    '承認ステータス / Status',
    '校長フィードバック / Feedback',
    '承認者 / Disetujui Oleh',
  ];
  const reportRows = bundle.reports.map((r) => [
    r.date,
    classLabel(r.classId, lang),
    r.teacherName,
    r.presentCount,
    r.totalStudents,
    r.totalStudents > 0 ? `${Math.round((r.presentCount / r.totalStudents) * 100)}%` : '—',
    (r.absentNames || []).join('; '),
    (r.lateNames || []).join('; '),
    formatLessonSummary(r),
    r.homework || '',
    r.atmosphere,
    r.overallComment || '',
    r.issues || '',
    approvalLabel(r.approvalStatus, lang),
    r.headFeedback || '',
    r.approvedBy || '',
  ]);
  const wsReports = XLSX.utils.aoa_to_sheet([reportHeaders, ...reportRows]);
  wsReports['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 22 }, { wch: 22 }, { wch: 32 }, { wch: 22 }, { wch: 12 }, { wch: 36 },
    { wch: 28 }, { wch: 20 }, { wch: 28 }, { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, wsReports, 'DailyReports');

  const testHeaders = [
    '日付 / Tanggal',
    'クラス / Kelas',
    '学生名 / Nama Siswa',
    'テスト名 / Judul Tes',
    'カテゴリー / Kategori',
    '得点 / Skor',
    '満点 / Maks',
    '正答率(%) / Nilai(%)',
    '合否 / Status',
    '苦手カテゴリー / Salah',
    '担当講師 / Penilai',
    'メモ / Catatan',
  ];
  const testRows = bundle.dailyTests.map((t) => [
    t.date,
    classLabel(t.classId, lang),
    t.studentName,
    t.testTitle,
    t.category ? categoryLabel(t.category, lang) : '—',
    t.earnedScore,
    t.maxScore,
    `${t.scorePercent}%`,
    t.scorePercent >= 70 ? '合格 / Lulus' : '要フォロー / Remedial',
    (t.wrongCategories || []).map((c) => categoryLabel(c, lang)).join('; '),
    t.gradedByName,
    t.note || '',
  ]);
  const wsTests = XLSX.utils.aoa_to_sheet([testHeaders, ...testRows]);
  wsTests['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 28 }, { wch: 18 }, { wch: 10 },
    { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 26 }, { wch: 18 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTests, 'DailyTests');

  XLSX.writeFile(wb, `genki-academy-daily-report_${selectedClass}_${dateTag}.xlsx`);
}

export function exportWeeklyReportXlsx(params: {
  bundle: WeeklyExportBundle;
  lang: LanguageMode;
  selectedClass: ClassId | 'all';
  weekFilter: string;
}) {
  const { bundle, lang, selectedClass, weekFilter } = params;
  const weekTag = weekFilter || 'all-weeks';
  const wb = XLSX.utils.book_new();

  const summaryHeaders = [
    '週 / Minggu',
    'クラス / Kelas',
    '提出日報数 / Jml Laporan',
    '承認済日報 / Disetujui',
    '平均出席率(%) / Rata-rata Hadir(%)',
    '平均雰囲気 / Rata-rata Suasana',
    '日次テスト件数 / Tes Harian',
    '日次平均点(%) / Rata-rata Harian(%)',
    '週次テスト件数 / Tes Mingguan',
    '週次平均点(%) / Rata-rata Mingguan(%)',
    '週次合格率(>=70%) / Kelulusan(%)',
    '主な苦手分野 / Titik Lemah Utama',
  ];
  const summaryRows = bundle.classSummaryRows.map((row) => [
    row.weekKey,
    classLabel(row.classId, lang),
    row.reportCount,
    row.approvedCount,
    row.avgAttendanceRate !== null ? `${row.avgAttendanceRate}%` : '—',
    row.avgAtmosphere !== null ? `${row.avgAtmosphere}/5` : '—',
    row.dailyTestCount,
    row.dailyAvg !== null ? `${row.dailyAvg}%` : '—',
    row.weeklyTestCount,
    row.weeklyAvg !== null ? `${row.weeklyAvg}%` : '—',
    row.weeklyPassRate !== null ? `${row.weeklyPassRate}%` : '—',
    row.topWeakCategory ? categoryLabel(row.topWeakCategory, lang) : '—',
  ]);
  const wsSummary = XLSX.utils.aoa_to_sheet([summaryHeaders, ...summaryRows]);
  wsSummary['!cols'] = summaryHeaders.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, wsSummary, 'WeeklySummary');

  const testHeaders = [
    '週 / Minggu',
    '日付 / Tanggal',
    '種別 / Jenis Tes',
    'クラス / Kelas',
    '学生名 / Nama Siswa',
    'テスト名 / Judul Tes',
    'カテゴリー / Kategori',
    '得点 / Skor',
    '満点 / Maks',
    '正答率(%) / Nilai(%)',
    '合否 / Status',
    '苦手カテゴリー / Salah',
    '担当講師 / Penilai',
  ];
  const testRows = bundle.testResults.map((t) => [
    t.weekKey,
    t.date,
    t.testType === 'weekly' ? '週次 / Mingguan' : '日次 / Harian',
    classLabel(t.classId, lang),
    t.studentName,
    t.testTitle,
    t.category ? categoryLabel(t.category, lang) : '—',
    t.earnedScore,
    t.maxScore,
    `${t.scorePercent}%`,
    t.scorePercent >= 70 ? '合格 / Lulus' : '要フォロー / Remedial',
    (t.wrongCategories || []).map((c) => categoryLabel(c, lang)).join('; '),
    t.gradedByName,
  ]);
  const wsTests = XLSX.utils.aoa_to_sheet([testHeaders, ...testRows]);
  wsTests['!cols'] = testHeaders.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(wb, wsTests, 'TestScores');

  const reportHeaders = [
    '週 / Minggu',
    '日付 / Tanggal',
    'クラス / Kelas',
    '担当講師 / Sensei',
    '出席 / Hadir',
    '授業進捗 / Materi',
    '課題・注意点 / Kendala',
    '承認ステータス / Status',
    '校長フィードバック / Feedback',
  ];
  const reportRows = bundle.reports.map((r) => [
    getWeekKey(r.date),
    r.date,
    classLabel(r.classId, lang),
    r.teacherName,
    `${r.presentCount}/${r.totalStudents}`,
    formatLessonSummary(r),
    r.issues || '',
    approvalLabel(r.approvalStatus, lang),
    r.headFeedback || '',
  ]);
  const wsReports = XLSX.utils.aoa_to_sheet([reportHeaders, ...reportRows]);
  wsReports['!cols'] = reportHeaders.map(() => ({ wch: 22 }));
  XLSX.utils.book_append_sheet(wb, wsReports, 'DailyReports');

  XLSX.writeFile(wb, `genki-academy-weekly-report_${selectedClass}_${weekTag}.xlsx`);
}

export function exportTestResultsXlsx(params: {
  results: TestResult[];
  lang: LanguageMode;
  selectedClass: ClassId | 'all';
}) {
  const { results, lang, selectedClass } = params;
  const wb = XLSX.utils.book_new();
  const sorted = [...results].sort((a, b) => b.date.localeCompare(a.date));

  const headers = [
    '日付 / Tanggal',
    '週 / Minggu',
    '種別 / Jenis',
    'クラス / Kelas',
    '学生名 / Nama Siswa',
    'テスト名 / Judul Tes',
    'カテゴリー / Kategori',
    '得点 / Skor',
    '満点 / Maks',
    '正答率(%) / Nilai(%)',
    '合否 / Status',
    '苦手分野 / Salah',
    '採点者 / Penilai',
    'メモ / Catatan',
  ];
  const rows = sorted.map((t) => [
    t.date,
    t.weekKey,
    t.testType === 'weekly' ? '週次 / Mingguan' : '日次 / Harian',
    classLabel(t.classId, lang),
    t.studentName,
    t.testTitle,
    t.category ? categoryLabel(t.category, lang) : '—',
    t.earnedScore,
    t.maxScore,
    `${t.scorePercent}%`,
    t.scorePercent >= 70 ? '合格 / Lulus' : '要フォロー / Remedial',
    (t.wrongCategories || []).map((c) => categoryLabel(c, lang)).join('; '),
    t.gradedByName,
    t.note || '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 13 }, { wch: 11 }, { wch: 16 }, { wch: 20 }, { wch: 24 }, { wch: 28 },
    { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 24 },
    { wch: 18 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'TestResults');
  XLSX.writeFile(wb, `genki-academy-test-results_${selectedClass}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportWallBoardXlsx(params: {
  rows: WeeklyRankingRow[];
  lang: LanguageMode;
  classFilter: ClassId | 'all';
  weekLabel: string;
}) {
  const { rows, lang, classFilter, weekLabel } = params;
  const wb = XLSX.utils.book_new();
  const headers = [
    '順位 / Rank',
    '学生名 / Nama Siswa',
    '学籍番号 / Kode',
    'クラス / Kelas',
    '週次試験(%) / Ujian Mingguan',
    '前回比 / Tren',
    '態度評価(1-5) / Sikap',
    '出席率(%) / Kehadiran',
    '総合スコア / Gabungan',
    '日次参考平均(%) / Harian(Sekunder)',
  ];
  const dataRows = rows.map((r) => [
    r.rank,
    r.student.name,
    r.student.studentCode || '—',
    classLabel(r.student.classId, lang),
    r.weeklyScore !== null ? `${r.weeklyScore}%` : '—',
    r.trendDelta !== null ? `${r.trendDelta > 0 ? '+' : ''}${r.trendDelta}%` : '—',
    r.attitudeScore !== null ? `${r.attitudeScore}/5` : '—',
    r.attendanceRate !== null ? `${r.attendanceRate}%` : '—',
    r.combinedScore !== null ? `${r.combinedScore}%` : '—',
    r.dailySecondaryAvg !== null ? `${r.dailySecondaryAvg}%` : '—',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([
    [`元気アカデミー 成績掲示・ランキング (${classLabel(classFilter, lang)} · ${weekLabel})`],
    [],
    headers,
    ...dataRows,
  ]);
  ws['!cols'] = [
    { wch: 12 }, { wch: 24 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
    { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Ranking');
  const tag = weekLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  XLSX.writeFile(wb, `genki-academy-ranking_${classFilter}_${tag}.xlsx`);
}

export function exportHeadJournalXlsx(params: {
  entries: HeadJournalEntry[];
  lang: LanguageMode;
}) {
  const { entries, lang } = params;
  const wb = XLSX.utils.book_new();
  const catNames: Record<string, string> = {
    decision: lang === 'id' ? 'Keputusan' : '決定事項',
    meeting: lang === 'id' ? 'Rapat' : '会議',
    incident: lang === 'id' ? 'Insiden' : '事案',
    idea: lang === 'id' ? 'Ide' : 'アイデア',
    evaluation: lang === 'id' ? 'Evaluasi' : '評価',
    todo: lang === 'id' ? 'To-Do' : 'To-Do',
  };
  const headers = [
    '日付 / Tanggal',
    'ピン / Pin',
    'カテゴリー / Kategori',
    'タイトル / Judul',
    '内容 / Isi Catatan',
    '関連クラス / Kelas',
    '関連講師 / Sensei',
    '関連学生 / Siswa',
    'To-Do進捗 / Checklist',
    '添付 / Lampiran',
  ];
  const rows = entries.map((e) => [
    e.date,
    e.pinned ? '📌' : '',
    catNames[e.category] || e.category,
    e.title,
    e.content,
    e.relatedClassId ? classLabel(e.relatedClassId, lang) : '—',
    e.relatedTeacherName || '—',
    e.relatedStudentName || '—',
    (e.todoItems || [])
      .map((t) => `[${t.done ? '✓' : ' '}] ${t.text}${t.dueDate ? ` (${t.dueDate})` : ''}`)
      .join(' | ') || '—',
    e.attachmentName || '—',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 13 }, { wch: 6 }, { wch: 14 }, { wch: 28 }, { wch: 48 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 36 }, { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'HeadJournal');
  XLSX.writeFile(wb, `genki-academy-head-journal_${new Date().toISOString().slice(0, 10)}.xlsx`);
}


