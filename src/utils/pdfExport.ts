import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { CertificateRecord, CLASSES, ReportCard } from '../types';
import { getTodayDateStr } from './dateUtils';

export type PdfOrientation = 'portrait' | 'landscape';

/**
 * Captures a rendered DOM sheet element into a crisp A4 PDF Blob.
 */
export async function generatePdfBlobFromElement(
  element: HTMLElement,
  orientation: PdfOrientation = 'portrait'
): Promise<Blob> {
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: element.scrollWidth || (orientation === 'landscape' ? 1123 : 794),
  });

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = orientation === 'landscape' ? 297 : 210;
  const pageHeight = orientation === 'landscape' ? 210 : 297;

  const imgData = canvas.toDataURL('image/png');
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Tolerance so 1-page layouts never spill by 1-2mm onto a blank 2nd page
  if (imgHeight <= pageHeight + 3) {
    const fittedHeight = Math.min(imgHeight, pageHeight);
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, fittedHeight, undefined, 'FAST');
  } else {
    // Up to 2 pages cleanly for multi-month final reports
    let heightLeft = imgHeight;
    let position = 0;
    let pageCount = 0;
    while (heightLeft > 2 && pageCount < 2) {
      if (pageCount > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
      position -= pageHeight;
      pageCount += 1;
    }
  }

  return pdf.output('blob');
}

export async function downloadElementAsPdf(
  element: HTMLElement,
  filename: string,
  orientation: PdfOrientation = 'portrait'
): Promise<void> {
  const blob = await generatePdfBlobFromElement(element, orientation);
  triggerBlobDownload(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface BatchZipItem {
  filename: string;
  element: HTMLElement;
  orientation: PdfOrientation;
}

export async function exportBatchPdfsZip(
  items: BatchZipItem[],
  zipFilename: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const zip = new JSZip();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const blob = await generatePdfBlobFromElement(item.element, item.orientation);
    zip.file(item.filename.endsWith('.pdf') ? item.filename : `${item.filename}.pdf`, blob);
    if (onProgress) onProgress(i + 1, items.length);
  }
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(zipBlob, zipFilename.endsWith('.zip') ? zipFilename : `${zipFilename}.zip`);
}

export function exportReportCardsSummaryExcel(params: {
  cards: ReportCard[];
  certificates: CertificateRecord[];
  filename?: string;
}): void {
  const { cards, certificates, filename = `genki_report_cards_${getTodayDateStr()}.xlsx` } = params;

  const certByStudent = new Map<string, CertificateRecord>();
  certificates
    .filter((c) => c.status === 'valid')
    .forEach((c) => {
      const prev = certByStudent.get(c.studentId);
      if (!prev || c.version > prev.version) {
        certByStudent.set(c.studentId, c);
      }
    });

  const rows = cards.map((card) => {
    const cls = CLASSES.find((c) => c.id === card.classId);
    const cert = certByStudent.get(card.studentId);
    const statusLabel =
      card.status === 'finalized'
        ? '確定 / Final'
        : card.status === 'waiting_approval'
          ? '承認待ち / Menunggu'
          : card.status === 'superseded'
            ? '旧版 / Superseded'
            : '下書き / Draft';

    return {
      '学籍番号 / ID': card.studentCode || '—',
      '学生氏名 / Nama Siswa': card.studentName,
      'クラス / Kelas': cls?.nameJa || card.classId,
      '受講期間 / Program': `${card.programMonths}か月 (${card.programStartDate} 〜 ${card.programEndDate})`,
      '対象期間 / Periode': card.periodLabel,
      'バージョン / Ver': `v${card.version}`,
      '状態 / Status': statusLabel,
      '累計週次テスト平均 / Rata-rata Ujian (%)': card.cumulativeWeeklyAvg ?? '—',
      '出席率 / Kehadiran (%)': card.attendanceRate ?? '—',
      '出席日数 / Hadir': card.attendancePresentDays,
      '欠席日数 / Absen': card.attendanceAbsentDays,
      '遅刻日数 / Terlambat': card.attendanceLateDays,
      '態度評価 / Sikap (1-5)': card.attitudeAvg ?? '—',
      '総合スコア / Skor Akhir': card.overallCombinedAvg ?? '—',
      '総合評価 / Predikat': card.overallGradeLabel || '—',
      '修了証番号 / No. Sertifikat': cert?.certificateNumber || '—',
      '発行日 / Tanggal Terbit': card.issueDate,
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
    { wch: 22 },
    { wch: 10 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 22 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'ReportCards_Summary');
  XLSX.writeFile(wb, filename);
}
