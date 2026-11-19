import React from 'react';
import { CLASSES, ClassId, ReportCard, SchoolSettings } from '../types';

interface ReportCardDocumentProps {
  card: ReportCard;
  settings: SchoolSettings;
  id?: string;
  className?: string;
}

const MUTED_CLASS_DOT: Record<ClassId, string> = {
  hokkaido: '#4b6584',
  saitama: '#4a6b5d',
  nara: '#68597a',
  kaigo: '#7a6354',
};

function formatNum(val: number | null | undefined, suffix = ''): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '—';
  return `${val}${suffix}`;
}

export const ReportCardDocument: React.FC<ReportCardDocumentProps> = ({
  card,
  settings,
  id,
  className = '',
}) => {
  const showId = settings.showIdSubtitleOnReportCard;
  const cls = CLASSES.find((c) => c.id === card.classId);
  const titleJa = card.periodType === 'final' ? '最終成績通知表' : '成績通知表';
  const titleId =
    card.periodType === 'final' ? 'LAPORAN HASIL BELAJAR AKHIR' : 'RAPOR HASIL BELAJAR';

  // Monochrome SVG chart coordinates (width 680, height 104)
  const chartW = 680;
  const chartH = 104;
  const padL = 32;
  const padR = 18;
  const padT = 14;
  const padB = 22;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const pts = card.weeklySeries || [];
  const svgPoints = pts.map((pt, idx) => {
    const x = pts.length === 1 ? padL + plotW / 2 : padL + (idx / (pts.length - 1)) * plotW;
    const clamped = Math.max(0, Math.min(100, pt.score));
    const y = padT + plotH - (clamped / 100) * plotH;
    return { x, y, weekKey: pt.weekKey, score: pt.score };
  });
  const polylineStr = svgPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <article
      id={id}
      style={{
        fontFamily: '"Noto Sans JP", "Plus Jakarta Sans", sans-serif',
        backgroundColor: '#ffffff',
        color: '#111111',
        width: '794px',
        minHeight: '1122px',
        padding: '36px 42px 32px 42px',
        boxSizing: 'border-box',
      }}
      className={`mx-auto text-[#111111] bg-white select-text ${className}`}
    >
      {/* Header */}
      <header className="pb-3 border-b-2 border-[#1f3a56]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {settings.showLogo && settings.logoDataUrl ? (
              <img
                src={settings.logoDataUrl}
                alt={settings.schoolNameJa}
                className="h-11 w-11 object-contain"
              />
            ) : null}
            <div>
              <p className="text-[13px] font-bold tracking-wide text-[#111111]">
                {settings.schoolNameJa}
              </p>
              {settings.schoolNameEn && (
                <p className="text-[9.5px] tracking-[0.08em] text-[#555555]">
                  {settings.schoolNameEn}
                </p>
              )}
            </div>
          </div>

          <div className="text-right">
            <h1 className="text-[22px] font-bold tracking-[0.18em] text-[#111111] leading-tight">
              {titleJa}
            </h1>
            {showId && (
              <p className="text-[9.5px] tracking-[0.12em] text-[#555555] mt-0.5">{titleId}</p>
            )}
          </div>
        </div>

        {/* Metadata Table */}
        <table className="w-full mt-3 border-collapse text-[11px]">
          <tbody>
            <tr>
              <th className="w-[15%] border border-[#c8c8cc] bg-[#f7f7f8] px-2.5 py-1.5 text-left font-semibold">
                氏名{showId ? <span className="block text-[9px] font-normal text-[#666]">Nama Siswa</span> : null}
              </th>
              <td className="w-[35%] border border-[#c8c8cc] px-2.5 py-1.5 font-bold text-[12.5px]">
                {card.studentName}
              </td>
              <th className="w-[15%] border border-[#c8c8cc] bg-[#f7f7f8] px-2.5 py-1.5 text-left font-semibold">
                学籍番号{showId ? <span className="block text-[9px] font-normal text-[#666]">ID Siswa</span> : null}
              </th>
              <td className="w-[35%] border border-[#c8c8cc] px-2.5 py-1.5 tabular-nums">
                {card.studentCode || '—'}
              </td>
            </tr>
            <tr>
              <th className="border border-[#c8c8cc] bg-[#f7f7f8] px-2.5 py-1.5 text-left font-semibold">
                クラス{showId ? <span className="block text-[9px] font-normal text-[#666]">Kelas</span> : null}
              </th>
              <td className="border border-[#c8c8cc] px-2.5 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    style={{ backgroundColor: MUTED_CLASS_DOT[card.classId] || '#555' }}
                    className="inline-block w-2 h-2 rounded-full"
                  />
                  <span>{cls?.nameJa || card.classId}</span>
                  {showId && cls?.nameId ? (
                    <span className="text-[10px] text-[#555]">({cls.nameId})</span>
                  ) : null}
                </span>
              </td>
              <th className="border border-[#c8c8cc] bg-[#f7f7f8] px-2.5 py-1.5 text-left font-semibold">
                受講コース{showId ? <span className="block text-[9px] font-normal text-[#666]">Program</span> : null}
              </th>
              <td className="border border-[#c8c8cc] px-2.5 py-1.5 tabular-nums">
                {card.programMonths}か月コース（{card.programStartDate} 〜 {card.programEndDate}）
              </td>
            </tr>
            <tr>
              <th className="border border-[#c8c8cc] bg-[#f7f7f8] px-2.5 py-1.5 text-left font-semibold">
                対象期間{showId ? <span className="block text-[9px] font-normal text-[#666]">Periode</span> : null}
              </th>
              <td className="border border-[#c8c8cc] px-2.5 py-1.5 tabular-nums">
                {card.periodLabel}（{card.periodStartDate} 〜 {card.periodEndDate}）
              </td>
              <th className="border border-[#c8c8cc] bg-[#f7f7f8] px-2.5 py-1.5 text-left font-semibold">
                発行日{showId ? <span className="block text-[9px] font-normal text-[#666]">Tanggal Terbit</span> : null}
              </th>
              <td className="border border-[#c8c8cc] px-2.5 py-1.5 tabular-nums">
                {card.issueDate}
                {card.version > 1 ? ` （第${card.version}版）` : ''}
              </td>
            </tr>
          </tbody>
        </table>
      </header>

      {/* 1. 学習の記録 */}
      <section className="mt-3.5 print-avoid-break">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-[12.5px] font-bold border-l-[3px] border-[#1f3a56] pl-2">
            1. 学習の記録
            {showId && (
              <span className="ml-2 text-[10px] font-normal text-[#555]">
                Catatan Pembelajaran (Ujian Mingguan Resmi)
              </span>
            )}
          </h2>
          <span className="text-[10px] text-[#555]">
            {card.gradeScaleMode === 'letter' ? '評価基準: A / B / C / D' : '評価基準: 5段階 (5〜1)'}
          </span>
        </div>

        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-[#f7f7f8]">
              <th className="border border-[#c8c8cc] px-2.5 py-1 text-left font-semibold">
                期間 {showId ? '/ Bulan' : ''}
              </th>
              <th className="border border-[#c8c8cc] px-2.5 py-1 text-right font-semibold">
                受験回数 {showId ? '/ Ujian' : ''}
              </th>
              <th className="border border-[#c8c8cc] px-2.5 py-1 text-right font-semibold">
                週次テスト平均 {showId ? '/ Rata-rata Bulan' : ''}
              </th>
              <th className="border border-[#c8c8cc] px-2.5 py-1 text-right font-semibold">
                累計平均 {showId ? '/ Kumulatif' : ''}
              </th>
              <th className="border border-[#c8c8cc] px-2.5 py-1 text-center font-semibold w-[14%]">
                評価 {showId ? '/ Nilai' : ''}
              </th>
            </tr>
          </thead>
          <tbody>
            {card.monthlyRows.map((row) => (
              <tr key={row.monthNumber}>
                <td className="border border-[#c8c8cc] px-2.5 py-1">{row.label}</td>
                <td className="border border-[#c8c8cc] px-2.5 py-1 text-right tabular-nums">
                  {row.examCount > 0 ? `${row.examCount}回` : '—'}
                </td>
                <td className="border border-[#c8c8cc] px-2.5 py-1 text-right tabular-nums font-medium">
                  {formatNum(row.weeklyAvg, '%')}
                </td>
                <td className="border border-[#c8c8cc] px-2.5 py-1 text-right tabular-nums">
                  {formatNum(row.cumulativeAvg, '%')}
                </td>
                <td className="border border-[#c8c8cc] px-2.5 py-1 text-center font-bold">
                  {row.grade || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Category breakdown only if categories exist */}
        {card.categoryRows && card.categoryRows.length > 0 && (
          <table className="w-full border-collapse text-[10.5px] mt-2">
            <thead>
              <tr className="bg-[#f7f7f8]">
                <th className="border border-[#c8c8cc] px-2.5 py-1 text-left font-semibold">
                  分野別成績 {showId ? '/ Rincian per Bidang' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2.5 py-1 text-right font-semibold w-[18%]">
                  受験数 {showId ? '/ Jumlah' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2.5 py-1 text-right font-semibold w-[22%]">
                  平均点 {showId ? '/ Rata-rata' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {card.categoryRows.map((cat) => (
                <tr key={cat.categoryId}>
                  <td className="border border-[#c8c8cc] px-2.5 py-1">
                    {cat.labelJa}
                    {showId ? (
                      <span className="text-[9.5px] text-[#555] ml-1.5">({cat.labelId})</span>
                    ) : null}
                  </td>
                  <td className="border border-[#c8c8cc] px-2.5 py-1 text-right tabular-nums">
                    {cat.examCount}
                  </td>
                  <td className="border border-[#c8c8cc] px-2.5 py-1 text-right tabular-nums font-medium">
                    {cat.avgScore}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Small Monochrome Weekly Scores Line Chart */}
        <div className="mt-2 border border-[#c8c8cc] px-3 py-1.5 bg-white">
          <div className="flex items-center justify-between text-[9.5px] text-[#444] mb-0.5">
            <span>
              週次テスト推移 {showId ? '/ Grafik Perkembangan Nilai Mingguan' : ''}
            </span>
            <span className="tabular-nums">
              累計平均 / Kumulatif: {formatNum(card.cumulativeWeeklyAvg, '%')}
            </span>
          </div>
          {svgPoints.length > 0 ? (
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full h-[86px] block">
              {/* Grid lines */}
              {[0, 50, 75, 100].map((val) => {
                const y = padT + plotH - (val / 100) * plotH;
                return (
                  <g key={val}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={chartW - padR}
                      y2={y}
                      stroke="#e2e2e6"
                      strokeWidth="1"
                      strokeDasharray={val === 0 || val === 100 ? undefined : '2,2'}
                    />
                    <text x={padL - 5} y={y + 3} fontSize="8" fill="#666" textAnchor="end">
                      {val}
                    </text>
                  </g>
                );
              })}
              {/* Polyline */}
              {svgPoints.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#111111"
                  strokeWidth="1.75"
                  points={polylineStr}
                />
              )}
              {/* Data points */}
              {svgPoints.map((pt, i) => (
                <g key={pt.weekKey}>
                  <circle cx={pt.x} cy={pt.y} r="3" fill="#111111" />
                  <text
                    x={pt.x}
                    y={Math.max(9, pt.y - 6)}
                    fontSize="8.5"
                    fontWeight="600"
                    fill="#111111"
                    textAnchor="middle"
                  >
                    {pt.score}
                  </text>
                  {(svgPoints.length <= 10 || i % 2 === 0 || i === svgPoints.length - 1) && (
                    <text
                      x={pt.x}
                      y={chartH - 5}
                      fontSize="7.5"
                      fill="#555"
                      textAnchor="middle"
                    >
                      {pt.weekKey.replace(/^\d{4}-/, '')}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          ) : (
            <p className="text-[10px] text-[#777] py-3 text-center">
              対象期間の週次テストデータがありません / Belum ada data ujian mingguan
            </p>
          )}
        </div>
      </section>

      {/* 2. 出欠の記録 & 3. 学習態度 */}
      <div className="grid grid-cols-1 gap-3 mt-3 print-avoid-break">
        <section>
          <h2 className="text-[12.5px] font-bold border-l-[3px] border-[#1f3a56] pl-2 mb-1">
            2. 出欠の記録
            {showId && (
              <span className="ml-2 text-[10px] font-normal text-[#555]">Catatan Kehadiran</span>
            )}
          </h2>
          <table className="w-full border-collapse text-[11px] text-center">
            <thead>
              <tr className="bg-[#f7f7f8]">
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  授業日数 {showId ? '/ Hari Belajar' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  出席 {showId ? '/ Hadir' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  欠席 {showId ? '/ Absen' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  遅刻 {showId ? '/ Terlambat' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  出席率 {showId ? '/ Persentase' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="tabular-nums">
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {card.attendanceTotalDays > 0 ? `${card.attendanceTotalDays}日` : '—'}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {card.attendanceTotalDays > 0 ? `${card.attendancePresentDays}日` : '—'}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {card.attendanceTotalDays > 0 ? `${card.attendanceAbsentDays}日` : '—'}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {card.attendanceTotalDays > 0 ? `${card.attendanceLateDays}日` : '—'}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5 font-bold">
                  {formatNum(card.attendanceRate, '%')}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="text-[12.5px] font-bold border-l-[3px] border-[#1f3a56] pl-2 mb-1">
            3. 学習態度・生活態度
            {showId && (
              <span className="ml-2 text-[10px] font-normal text-[#555]">
                Sikap Belajar & Kedisiplinan (Skala 1–5)
              </span>
            )}
          </h2>
          <table className="w-full border-collapse text-[11px] text-center">
            <thead>
              <tr className="bg-[#f7f7f8]">
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  出欠・時間厳守 {showId ? '/ Ketepatan Waktu' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  規律・礼儀 {showId ? '/ Tata Tertib' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  学習意欲 {showId ? '/ Usaha' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  協調性 {showId ? '/ Kerja Sama' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold">
                  態度平均 {showId ? '/ Rata-rata' : ''}
                </th>
                <th className="border border-[#c8c8cc] px-2 py-1 font-semibold w-[13%]">
                  評価 {showId ? '/ Nilai' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="tabular-nums">
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {formatNum(card.attitudeSubAttendance)}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {formatNum(card.attitudeSubDiscipline)}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {formatNum(card.attitudeSubEffort)}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5">
                  {formatNum(card.attitudeSubCooperation)}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5 font-medium">
                  {card.attitudeAvg !== null ? `${card.attitudeAvg.toFixed(1)} / 5.0` : '—'}
                </td>
                <td className="border border-[#c8c8cc] px-2 py-1.5 font-bold">
                  {card.attitudeGradeLabel || '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {/* 4. 総合評価 */}
      <section className="mt-3 print-avoid-break">
        <h2 className="text-[12.5px] font-bold border-l-[3px] border-[#1f3a56] pl-2 mb-1">
          4. 総合評価
          {showId && (
            <span className="ml-2 text-[10px] font-normal text-[#555]">Evaluasi Keseluruhan</span>
          )}
        </h2>
        <div className="border border-[#c8c8cc] grid grid-cols-3 divide-x divide-[#c8c8cc] text-center">
          <div className="py-2 px-3">
            <p className="text-[10px] text-[#555]">
              総合スコア {showId ? '/ Skor Akhir' : ''}
            </p>
            <p className="text-[18px] font-bold tabular-nums mt-0.5">
              {formatNum(card.overallCombinedAvg, '%')}
            </p>
          </div>
          <div className="py-2 px-3 bg-[#f7f7f8]">
            <p className="text-[10px] text-[#555]">
              総合評価 {showId ? '/ Predikat Akhir' : ''}
            </p>
            <p className="text-[20px] font-bold mt-0.5">{card.overallGradeLabel || '—'}</p>
          </div>
          <div className="py-2 px-3">
            <p className="text-[10px] text-[#555]">
              クラス順位 {showId ? '/ Peringkat Kelas' : ''}
            </p>
            <p className="text-[16px] font-semibold tabular-nums mt-0.5">
              {settings.showRankOnReportCard && card.classRank !== null
                ? `${card.classRank}位 / ${card.classSize}名`
                : '非表示'}
            </p>
          </div>
        </div>
      </section>

      {/* 5. Comments */}
      <section className="mt-3 space-y-2.5 print-avoid-break">
        <div>
          <h3 className="text-[11.5px] font-bold mb-1">
            担任からのコメント
            {showId && (
              <span className="ml-2 text-[9.5px] font-normal text-[#555]">Catatan Wali Kelas</span>
            )}
          </h3>
          <div className="border border-[#c8c8cc] px-3 py-2 min-h-[62px] text-[11px] leading-[1.55] whitespace-pre-wrap break-words bg-white">
            {card.senseiComment.trim() || '—'}
          </div>
        </div>

        <div>
          <h3 className="text-[11.5px] font-bold mb-1">
            校長からのコメント
            {showId && (
              <span className="ml-2 text-[9.5px] font-normal text-[#555]">Catatan Kepala Sekolah</span>
            )}
          </h3>
          <div className="border border-[#c8c8cc] px-3 py-2 min-h-[54px] text-[11px] leading-[1.55] whitespace-pre-wrap break-words bg-white">
            {card.headComment.trim() || '—'}
          </div>
        </div>
      </section>

      {/* Footer Signature & Hanko Seal Row */}
      <footer className="mt-4 pt-3 border-t border-[#c8c8cc] flex items-end justify-between gap-4 print-avoid-break">
        <div className="text-[10.5px] text-[#333] leading-relaxed">
          <p className="font-semibold text-[#111]">{settings.schoolNameJa}</p>
          <p className="tabular-nums">発行日 / Tanggal: {card.issueDate}</p>
        </div>

        <div className="flex items-stretch gap-3">
          {/* Sensei Seal */}
          <div className="border border-[#c8c8cc] px-3 py-1.5 min-w-[168px] flex items-center justify-between gap-3">
            <div>
              <p className="text-[9.5px] text-[#555]">担任 {showId ? '/ Wali Kelas' : ''}</p>
              <p className="text-[11px] font-semibold mt-0.5">{card.senseiName || '—'}</p>
            </div>
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              {settings.showHanko && settings.senseiHankoDataUrl ? (
                <img
                  src={settings.senseiHankoDataUrl}
                  alt="担任印"
                  className="w-10 h-10 object-contain"
                />
              ) : (
                <span className="w-9 h-9 rounded-full border border-dashed border-[#aaa] flex items-center justify-center text-[10px] text-[#777]">
                  印
                </span>
              )}
            </div>
          </div>

          {/* Head Master Seal */}
          <div className="border border-[#c8c8cc] px-3 py-1.5 min-w-[168px] flex items-center justify-between gap-3">
            <div>
              <p className="text-[9.5px] text-[#555]">校長 {showId ? '/ Kepala Sekolah' : ''}</p>
              <p className="text-[11px] font-semibold mt-0.5">
                {card.headMasterName || settings.headMasterName || '—'}
              </p>
            </div>
            <div className="w-10 h-10 flex items-center justify-center shrink-0">
              {settings.showHanko && settings.headHankoDataUrl ? (
                <img
                  src={settings.headHankoDataUrl}
                  alt="校長印"
                  className="w-10 h-10 object-contain"
                />
              ) : (
                <span className="w-9 h-9 rounded-full border border-dashed border-[#aaa] flex items-center justify-center text-[10px] text-[#777]">
                  印
                </span>
              )}
            </div>
          </div>
        </div>
      </footer>
    </article>
  );
};
