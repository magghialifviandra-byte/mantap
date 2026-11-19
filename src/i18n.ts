import { ClassId, CLASSES, LanguageMode, QUESTION_CATEGORIES, QuestionCategory } from './types';

export interface BiText {
  ja: string;
  id: string;
}

export const UI_TEXT = {
  appName: { ja: '元気アカデミー', id: 'Genki Academy' },
  navDashboard: { ja: '統括ダッシュボード', id: 'Dashboard Kepala' },
  navMonitoring: { ja: '講師モニタリング', id: 'Monitoring Sensei' },
  navReportHub: { ja: '日報・週報', id: 'Laporan Harian & Mingguan' },
  navDailyReport: { ja: '日報入力', id: 'Laporan Harian' },
  navWeeklyReport: { ja: '週報入力', id: 'Laporan Mingguan' },
  navQuestionBank: { ja: '問題バンク・印刷', id: 'Bank Soal & Cetak' },
  navGrading: { ja: '採点・成績入力', id: 'Input Nilai & Koreksi' },
  navRoster: { ja: '学生名簿', id: 'Daftar Siswa' },
  navHeadJournal: { ja: '校長ノート', id: 'Catatan Kepala Sekolah' },
  navUsers: { ja: 'ユーザー・権限', id: 'Pengguna & Peran' },
  btnSchedule: { ja: 'スケジュール', id: 'Jadwal' },
  statusPending: { ja: '承認待ち', id: 'Menunggu Approval' },
  statusApproved: { ja: '承認済み', id: 'Disetujui (Approved)' },
  statusRevision: { ja: '差し戻し（要修正）', id: 'Dikembalikan untuk Revisi' },
  signInTitle: { ja: '元気アカデミー 教務・日報ポータル', id: 'Portal Akademik & Laporan Genki Academy' },
  signInSub: {
    ja: '各講師・校長はそれぞれのGoogleアカウントでログインしてください。',
    id: 'Setiap sensei & kepala sekolah masuk menggunakan akun Google masing-masing.',
  },
  signInBtn: { ja: 'Googleでログイン', id: 'Masuk dengan Google' },
  signOut: { ja: 'ログアウト', id: 'Keluar' },
  pendingTitle: { ja: 'アカウント承認待ち', id: 'Menunggu Persetujuan Kepala Sekolah' },
  pendingDesc: {
    ja: 'ログインは完了しました。校長があなたのアカウントと担当クラスを有効化するまでお待ちください。',
    id: 'Login berhasil. Mohon tunggu Kepala Sekolah mengaktifkan akun dan kelas Anda.',
  },
  disabledTitle: { ja: 'アカウント停止中', id: 'Akun Dinonaktifkan' },
  allClasses: { ja: '全4クラス', id: 'Semua 4 Kelas' },
  daily: { ja: '日次テスト', id: 'Tes Harian' },
  weekly: { ja: '週次テスト', id: 'Tes Mingguan' },
  save: { ja: '保存する', id: 'Simpan' },
  cancel: { ja: 'キャンセル', id: 'Batal' },
  close: { ja: '閉じる', id: 'Tutup' },
  edit: { ja: '編集', id: 'Ubah' },
  delete: { ja: '削除', id: 'Hapus' },
  printTest: { ja: '問題用紙を印刷', id: 'Cetak Soal Siswa' },
  printKey: { ja: '解答用紙を印刷', id: 'Cetak Kunci Jawaban' },
  correct: { ja: '正解 ○', id: 'Benar ○' },
  wrong: { ja: '不正解 ×', id: 'Salah ×' },
  present: { ja: '出席', id: 'Hadir' },
  absent: { ja: '欠席', id: 'Absen' },
  late: { ja: '遅刻', id: 'Terlambat' },
  headRole: { ja: '校長（管理者）', id: 'Kepala Sekolah' },
  teacherRole: { ja: '講師', id: 'Sensei / Pengajar' },
} as const;

export function tr(pair: BiText, lang: LanguageMode): string {
  if (lang === 'ja') return pair.ja;
  if (lang === 'id') return pair.id;
  return `${pair.ja} / ${pair.id}`;
}

export function classLabel(classId: ClassId | 'all' | '', lang: LanguageMode): string {
  if (classId === 'all') {
    return tr(UI_TEXT.allClasses, lang);
  }
  if (classId === '') {
    return tr({ ja: '未配属', id: 'Belum Ditempatkan' }, lang);
  }
  const found = CLASSES.find((c) => c.id === classId);
  if (!found) return classId;
  if (lang === 'ja') return found.nameJa;
  if (lang === 'id') return found.nameId;
  return `${found.nameJa} (${found.nameId})`;
}

export function categoryLabel(category: string, lang: LanguageMode): string {
  const found = QUESTION_CATEGORIES.find((c) => c.id === (category as QuestionCategory));
  if (!found) return category;
  if (lang === 'ja') return found.ja;
  if (lang === 'id') return found.idLabel;
  return `${found.ja} / ${found.idLabel}`;
}
