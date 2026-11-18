import React, { useMemo, useState } from 'react';
import { Award, Download, Printer, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { classLabel } from '../i18n';
import { ClassId, CLASSES, LanguageMode, QualityThresholds } from '../types';
import { RankingMetric, WeeklyRankingRow } from '../utils/analyticsUtils';
import { getTodayDateStr } from '../utils/dateUtils';
import { exportWallBoardXlsx } from '../utils/reportExport';
import { AppleModalSheet } from './AppleGestures';

interface Props {
  open: boolean;
  lang: LanguageMode;
  rows: WeeklyRankingRow[];
  classFilter: ClassId | 'all';
  weekFilter: string;
  weekOptions: string[];
  metric: RankingMetric;
  thresholds: QualityThresholds;
  onChangeClass: (c: ClassId | 'all') => void;
  onChangeWeek: (w: string) => void;
  onChangeMetric: (m: RankingMetric) => void;
  onRegisterPrintView: (node: React.ReactNode | null) => void;
  onClose: () => void;
}

export function WallBoardModal({
  open,
  lang,
  rows,
  classFilter,
  weekFilter,
  weekOptions,
  metric,
  thresholds,
  onChangeClass,
  onChangeWeek,
  onChangeMetric,
  onRegisterPrintView,
  onClose,
}: Props) {
  const [paperSize, setPaperSize] = useState<'A4' | 'A3'>('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [topN, setTopN] = useState<number>(0);
  const [showTrend, setShowTrend] = useState(true);
  const [showAttitude, setShowAttitude] = useState(true);
  const [showAttendance, setShowAttendance] = useState(true);
  const [showClassBadge, setShowClassBadge] = useState(true);

  const displayedRows = useMemo(() => {
    return topN > 0 ? rows.slice(0, topN) : rows;
  }, [rows, topN]);

  const weekLabel =
    weekFilter || (lang === 'id' ? 'Keseluruhan / Terbaru' : '全期間・最新平均');

  const metricLabel =
    metric === 'weekly_exam'
      ? lang === 'id'
        ? 'Skor Ujian Mingguan (Resmi)'
        : '週次試験スコア順（公式）'
      : metric === 'attitude'
      ? lang === 'id'
        ? 'Penilaian Sikap'
        : '学習態度評価順'
      : lang === 'id'
      ? `Skor Gabungan (${thresholds.examWeightPercent}% Ujian + ${thresholds.attitudeWeightPercent}% Sikap)`
      : `総合スコア（試験${thresholds.examWeightPercent}% + 態度${thresholds.attitudeWeightPercent}%）`;

  const buildSheetNode = () => (
    <div className="print-sheet bg-white text-black p-6 sm:p-8 space-y-6">
      <style>{`@media print { @page { size: ${paperSize} ${orientation}; margin: 12mm; } }`}</style>

      {/* Pure White/Black Official Print Header */}
      <div className="border-b-2 border-black pb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold tracking-widest text-neutral-700 uppercase">
            元気アカデミー · GENKI ACADEMY — {paperSize} {orientation.toUpperCase()}
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-black mt-1 tracking-tight">
            {lang === 'id' ? 'PAPAN PERINGKAT AKADEMIK' : '成績優秀者ランキング掲示ボード'}
          </h1>
          <div className="text-sm font-medium text-neutral-800 mt-1">
            {classLabel(classFilter, lang)} · {weekLabel} · {metricLabel}
          </div>
        </div>
        <div className="text-xs text-right text-neutral-700 tabular-nums">
          <div>
            {lang === 'id' ? 'Dicetak:' : '発行日:'} {getTodayDateStr()}
          </div>
          <div>
            {lang === 'id' ? 'Basis Skor Resmi:' : '公式評価基準:'}{' '}
            {lang === 'id' ? 'Ujian Mingguan' : '週次試験'}
          </div>
        </div>
      </div>

      {/* Pure Monochrome Clean Table (Top 3 subtle bold weight, no medals/colors) */}
      <table className="w-full text-sm text-left border-collapse border border-black">
        <thead>
          <tr className="border-b-2 border-black bg-neutral-100 text-black text-xs">
            <th className="py-2.5 px-3 font-semibold w-16 text-center">
              {lang === 'id' ? 'Peringkat' : '順位'}
            </th>
            <th className="py-2.5 px-3 font-semibold">
              {lang === 'id' ? 'Nama Siswa' : '学生氏名'}
            </th>
            {showClassBadge && (
              <th className="py-2.5 px-3 font-semibold">
                {lang === 'id' ? 'Kelas' : 'クラス'}
              </th>
            )}
            <th className="py-2.5 px-3 font-semibold text-right">
              {lang === 'id' ? 'Ujian Mingguan' : '週次試験'}
            </th>
            {showTrend && (
              <th className="py-2.5 px-3 font-semibold text-right">
                {lang === 'id' ? 'Tren' : '前回比'}
              </th>
            )}
            {showAttitude && (
              <th className="py-2.5 px-3 font-semibold text-right">
                {lang === 'id' ? 'Sikap' : '態度'}
              </th>
            )}
            {showAttendance && (
              <th className="py-2.5 px-3 font-semibold text-right">
                {lang === 'id' ? 'Hadir' : '出席率'}
              </th>
            )}
            {metric === 'combined' && (
              <th className="py-2.5 px-3 font-semibold text-right">
                {lang === 'id' ? 'Gabungan' : '総合'}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {displayedRows.map((row) => {
            const isTop3 = row.rank <= 3;
            return (
              <tr key={row.student.id} className="border-b border-neutral-300 bg-white">
                <td
                  className={`py-2.5 px-3 text-center tabular-nums text-sm ${
                    isTop3 ? 'font-bold text-black' : 'font-normal text-neutral-700'
                  }`}
                >
                  {row.rank}
                </td>
                <td className="py-2.5 px-3">
                  <div className={`${isTop3 ? 'font-bold' : 'font-semibold'} text-base text-black`}>
                    {row.student.name}
                  </div>
                  {row.student.studentCode && (
                    <div className="text-[11px] font-mono text-neutral-600">
                      {row.student.studentCode}
                    </div>
                  )}
                </td>
                {showClassBadge && (
                  <td className="py-2.5 px-3 text-xs font-medium text-black whitespace-nowrap">
                    {classLabel(row.student.classId, lang)}
                  </td>
                )}
                <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-base text-right text-black">
                  {row.weeklyScore !== null ? `${row.weeklyScore}%` : '—'}
                </td>
                {showTrend && (
                  <td className="py-2.5 px-3 font-mono tabular-nums font-medium text-right text-xs text-black">
                    {row.trendDelta !== null
                      ? row.trendDelta > 0
                        ? `+${row.trendDelta}%`
                        : `${row.trendDelta}%`
                      : '—'}
                  </td>
                )}
                {showAttitude && (
                  <td className="py-2.5 px-3 font-mono tabular-nums text-right text-black">
                    {row.attitudeScore !== null ? `${row.attitudeScore}/5` : '—'}
                  </td>
                )}
                {showAttendance && (
                  <td className="py-2.5 px-3 font-mono tabular-nums text-right text-black">
                    {row.attendanceRate !== null ? `${row.attendanceRate}%` : '—'}
                  </td>
                )}
                {metric === 'combined' && (
                  <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-right text-black">
                    {row.combinedScore !== null ? `${row.combinedScore}%` : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="pt-3 flex items-center justify-between text-[11px] text-neutral-700 border-t border-neutral-400">
        <span>
          元気アカデミー 教務部 · {displayedRows.length}{' '}
          {lang === 'id' ? 'siswa ditampilkan' : '名掲載'}
        </span>
        <span>
          {lang === 'id'
            ? '* Peringkat disusun berdasarkan skor resmi Ujian Mingguan.'
            : '※ ランキングは週次試験の公式スコアに基づいて集計されています。'}
        </span>
      </div>
    </div>
  );

  const handleClose = () => {
    onRegisterPrintView(null);
    onClose();
  };

  const handlePrint = () => {
    onRegisterPrintView(buildSheetNode());
    setTimeout(() => window.print(), 80);
  };

  return (
    <AnimatePresence>
      {open && (
        <AppleModalSheet open={open} onClose={handleClose} maxWidthClass="max-w-6xl">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-[#d2d2d7]/60 dark:border-[#424245] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Award className="w-5 h-5 text-[#6e6e73] dark:text-[#86868b]" />
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'id'
                    ? 'Cetak Papan Peringkat Dinding'
                    : '成績掲示ボード印刷 (A4 / A3)'}
                </h2>
                <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'id'
                    ? 'Format bersih untuk ditempel di papan pengumuman kelas.'
                    : '教室掲示用に最適化されたランキング表を印刷・Excel出力します。'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  exportWallBoardXlsx({
                    rows: displayedRows,
                    lang,
                    classFilter,
                    weekLabel,
                  })
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Excel</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px]"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>{lang === 'id' ? 'Cetak / PDF' : '印刷 / PDF保存'}</span>
              </button>
              <button
                type="button"
                onClick={handleClose}
                aria-label="Close modal"
                className="p-1.5 rounded-full text-[#6e6e73] hover:text-[#1d1d1f] dark:text-[#86868b] dark:hover:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Settings Controls */}
          <div className="px-6 py-3 border-b border-[#d2d2d7]/60 dark:border-[#424245] bg-[#f5f5f7] dark:bg-[#161617] flex flex-wrap items-center gap-2.5 text-[12px]">
            <select
              value={classFilter}
              onChange={(e) => onChangeClass(e.target.value as ClassId | 'all')}
              className="glass-input px-3 py-1.5 rounded-[10px]"
            >
              <option value="all">{lang === 'id' ? 'Semua Kelas' : '全4クラス'}</option>
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>

            <select
              value={weekFilter}
              onChange={(e) => onChangeWeek(e.target.value)}
              className="glass-input px-3 py-1.5 rounded-[10px] font-mono"
            >
              <option value="">
                {lang === 'id' ? 'Rata-rata Semua Minggu' : '全週平均（公式）'}
              </option>
              {weekOptions.map((wk) => (
                <option key={wk} value={wk}>
                  {wk}
                </option>
              ))}
            </select>

            <select
              value={metric}
              onChange={(e) => onChangeMetric(e.target.value as RankingMetric)}
              className="glass-input px-3 py-1.5 rounded-[10px]"
            >
              <option value="weekly_exam">
                {lang === 'id' ? 'Skor Ujian Mingguan' : '週次試験スコア'}
              </option>
              <option value="attitude">{lang === 'id' ? 'Skor Sikap' : '学習態度'}</option>
              <option value="combined">{lang === 'id' ? 'Gabungan' : '総合スコア'}</option>
            </select>

            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="glass-input px-3 py-1.5 rounded-[10px]"
            >
              <option value={0}>{lang === 'id' ? 'Semua Siswa' : '全員表示'}</option>
              <option value={3}>Top 3</option>
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
            </select>

            <select
              value={`${paperSize}_${orientation}`}
              onChange={(e) => {
                const [p, o] = e.target.value.split('_');
                setPaperSize(p as 'A4' | 'A3');
                setOrientation(o as 'portrait' | 'landscape');
              }}
              className="glass-input px-3 py-1.5 rounded-[10px] font-mono"
            >
              <option value="A4_portrait">A4 Portrait</option>
              <option value="A4_landscape">A4 Landscape</option>
              <option value="A3_portrait">A3 Portrait</option>
              <option value="A3_landscape">A3 Landscape</option>
            </select>

            <div className="flex flex-wrap items-center gap-3 ml-auto text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showClassBadge}
                  onChange={(e) => setShowClassBadge(e.target.checked)}
                />
                <span>{lang === 'id' ? 'Kelas' : 'クラス'}</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTrend}
                  onChange={(e) => setShowTrend(e.target.checked)}
                />
                <span>{lang === 'id' ? 'Tren' : '前回比'}</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAttitude}
                  onChange={(e) => setShowAttitude(e.target.checked)}
                />
                <span>{lang === 'id' ? 'Sikap' : '態度'}</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAttendance}
                  onChange={(e) => setShowAttendance(e.target.checked)}
                />
                <span>{lang === 'id' ? 'Hadir' : '出席'}</span>
              </label>
            </div>
          </div>

          {/* Sheet Preview */}
          <div className="p-4 sm:p-6 overflow-y-auto bg-[#f5f5f7] dark:bg-black">
            <div className="bg-white border border-[#d2d2d7] rounded-[12px] overflow-hidden">
              {buildSheetNode()}
            </div>
          </div>
        </AppleModalSheet>
      )}
    </AnimatePresence>
  );
}
