import * as XLSX from 'xlsx';

export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getWeekKey(dateStr: string): string {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    return '2026-W01';
  }
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function downloadBlankScheduleXlsx(): void {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Completely empty row-based schedule template
  const listHeaders = [
    [
      '曜日 / Hari',
      '日付 / Tanggal',
      '時間割 / Jam',
      'クラス / Kelas',
      '担当講師 / Sensei',
      '科目・教材 / Materi',
      '教室 / Ruangan',
      '備考 / Catatan',
    ],
  ];
  const emptyRows = Array.from({ length: 24 }, () => ['', '', '', '', '', '', '', '']);
  const wsList = XLSX.utils.aoa_to_sheet([...listHeaders, ...emptyRows]);
  wsList['!cols'] = [
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 22 },
    { wch: 28 },
    { wch: 16 },
    { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, wsList, 'Schedule_List');

  // Sheet 2: Completely empty weekly timetable grid (Mon–Sat x Time Slots)
  const gridHeaders = [
    [
      '時間 / Jam',
      'クラス / Kelas',
      '月 / Senin',
      '火 / Selasa',
      '水 / Rabu',
      '木 / Kamis',
      '金 / Jumat',
      '土 / Sabtu',
    ],
  ];
  const gridRows = Array.from({ length: 20 }, () => ['', '', '', '', '', '', '', '']);
  const wsGrid = XLSX.utils.aoa_to_sheet([...gridHeaders, ...gridRows]);
  wsGrid['!cols'] = [
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, wsGrid, 'Weekly_Grid');

  XLSX.writeFile(wb, 'school_blank_schedule_template.xlsx');
}

export function downloadBlankScheduleCsv(): void {
  const header =
    '曜日 / Hari,日付 / Tanggal,時間割 / Jam,クラス / Kelas,担当講師 / Sensei,科目・教材 / Materi,教室 / Ruangan,備考 / Catatan';
  const emptyLines = Array.from({ length: 20 }, () => ',,,,,,,').join('\n');
  const csvContent = `\uFEFF${header}\n${emptyLines}\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', 'school_blank_schedule_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
