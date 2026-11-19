import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Award,
  BookLock,
  BookOpen,
  Calendar,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Search,
  Settings,
  ShieldCheck,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { classLabel } from '../i18n';
import { ClassId, CLASSES, LanguageMode, Student, UserProfile } from '../types';
import { CLASS_THEMES, getClassTheme } from '../utils/classTheme';

export type JumpTarget =
  | {
      kind: 'tab';
      tab:
        | 'dashboard'
        | 'monitoring'
        | 'report'
        | 'reportCards'
        | 'bank'
        | 'grading'
        | 'roster'
        | 'schedule'
        | 'journal'
        | 'users'
        | 'settings';
    }
  | { kind: 'class'; classId: ClassId }
  | { kind: 'student'; student: Student }
  | { kind: 'sensei'; sensei: UserProfile };

interface Props {
  open: boolean;
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  staffUsers: UserProfile[];
  onClose: () => void;
  onSelect: (target: JumpTarget) => void;
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  target: JumpTarget;
  searchKeywords: string;
  classDot?: string;
}

export function CommandPaletteModal({
  open,
  lang,
  profile,
  students,
  staffUsers,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const allItems = useMemo<PaletteItem[]>(() => {
    const isHead = profile.role === 'head';
    const items: PaletteItem[] = [];

    // 1. Pages (Role-aware)
    if (isHead) {
      items.push({
        id: 'page-dashboard',
        group: lang === 'id' ? 'Halaman' : 'ページ',
        label: lang === 'id' ? 'Dashboard Kepala Sekolah' : '統括ダッシュボード',
        sublabel: 'Head Dashboard',
        icon: <LayoutDashboard className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
        target: { kind: 'tab', tab: 'dashboard' },
        searchKeywords: 'dashboard 統括 head kepala laporan',
      });
    }
    items.push({
      id: 'page-report',
      group: lang === 'id' ? 'Halaman' : 'ページ',
      label: lang === 'id' ? 'Laporan Harian (Nippo)' : '日報',
      sublabel: 'Daily Report',
      icon: <FileText className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
      target: { kind: 'tab', tab: 'report' },
      searchKeywords: 'report nippo 日報 laporan',
    });
    items.push({
      id: 'page-schedule',
      group: lang === 'id' ? 'Halaman' : 'ページ',
      label: isHead
        ? lang === 'id'
          ? 'Jadwal Sekolah (Edit & Cetak)'
          : 'スケジュール管理'
        : '私のスケジュール (My Schedule)',
      sublabel: isHead ? 'Schedule Editor' : 'Read-only Schedule',
      icon: <Calendar className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
      target: { kind: 'tab', tab: 'schedule' },
      searchKeywords: 'schedule jadwal スケジュール 私のスケジュール',
    });
    items.push({
      id: 'page-bank',
      group: lang === 'id' ? 'Halaman' : 'ページ',
      label: lang === 'id' ? 'Bank Soal & Cetak Ujian' : '問題バンク',
      sublabel: 'Question Bank & Choukai Audio',
      icon: <BookOpen className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
      target: { kind: 'tab', tab: 'bank' },
      searchKeywords: 'bank soal mondai choukai 問題バンク 聴解',
    });
    items.push({
      id: 'page-grading',
      group: lang === 'id' ? 'Halaman' : 'ページ',
      label: lang === 'id' ? 'Input & Rekap Nilai' : '採点・成績入力',
      sublabel: 'Test Grading & Export',
      icon: <ClipboardCheck className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
      target: { kind: 'tab', tab: 'grading' },
      searchKeywords: 'grading nilai test score 採点 成績',
    });
    items.push({
      id: 'page-roster',
      group: lang === 'id' ? 'Halaman' : 'ページ',
      label: lang === 'id' ? 'Daftar Siswa' : '学生名簿',
      sublabel: `${students.length} ${lang === 'id' ? 'siswa' : '名'}`,
      icon: <Users className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
      target: { kind: 'tab', tab: 'roster' },
      searchKeywords: 'roster student siswa 名簿 学生',
    });
    items.push({
      id: 'page-reportCards',
      group: lang === 'id' ? 'Halaman' : 'ページ',
      label: lang === 'id' ? 'Rapor & Sertifikat Kelulusan' : '成績通知表・修了証書',
      sublabel: 'Report Cards & Certificates',
      icon: <Award className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />,
      target: { kind: 'tab', tab: 'reportCards' },
      searchKeywords: 'report card rapor sertifikat certificate 成績通知表 修了証書',
    });
    if (isHead) {
      items.push({
        id: 'page-monitoring',
        group: lang === 'id' ? 'Halaman' : 'ページ',
        label: lang === 'id' ? 'Monitoring Sensei' : '講師モニタリング',
        sublabel: 'Compliance & Quality Control',
        icon: <Activity className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
        target: { kind: 'tab', tab: 'monitoring' },
        searchKeywords: 'monitoring sensei kepatuhan load compliance 講師モニタリング 品質',
      });
      items.push({
        id: 'page-journal',
        group: lang === 'id' ? 'Halaman' : 'ページ',
        label: lang === 'id' ? 'Catatan Kepala Sekolah (Privat)' : '校長ノート（非公開）',
        sublabel: 'Head Master Journal',
        icon: <BookLock className="w-4 h-4 text-amber-600 dark:text-amber-400" />,
        target: { kind: 'tab', tab: 'journal' },
        searchKeywords: 'journal catatan kepala sekolah todo 校長ノート メモ',
      });
      items.push({
        id: 'page-users',
        group: lang === 'id' ? 'Halaman' : 'ページ',
        label: lang === 'id' ? 'Pengguna & Peran + Log Aktivitas' : 'ユーザー・権限・操作ログ',
        sublabel: 'Users / Roles (Admin)',
        icon: <ShieldCheck className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
        target: { kind: 'tab', tab: 'users' },
        searchKeywords: 'users roles admin sensei log ユーザー 権限 ログ',
      });
      items.push({
        id: 'page-settings',
        group: lang === 'id' ? 'Halaman' : 'ページ',
        label: lang === 'id' ? 'Pengaturan Rapor & Sertifikat' : '通知表・修了証書設定',
        sublabel: 'School Branding, Scale & Seals',
        icon: <Settings className="w-4 h-4 text-[#1e3a5f] dark:text-sky-300" />,
        target: { kind: 'tab', tab: 'settings' },
        searchKeywords: 'settings pengaturan grade scale hanko logo 設定 通知表 修了証書 印鑑',
      });
    }

    // 2. Classes
    CLASSES.forEach((cls) => {
      const count = students.filter((s) => s.classId === cls.id && s.active).length;
      const clsTheme = CLASS_THEMES[cls.id];
      items.push({
        id: `class-${cls.id}`,
        group: lang === 'id' ? 'Kelas' : 'クラス',
        label: classLabel(cls.id, lang),
        sublabel: `${cls.subtitleJa} · ${count} ${lang === 'id' ? 'siswa' : '名'}`,
        icon: <GraduationCap className={`w-4 h-4 ${clsTheme.accentText}`} />,
        target: { kind: 'class', classId: cls.id },
        searchKeywords: `${cls.id} ${cls.nameJa} ${cls.nameId} ${cls.subtitleJa} ${cls.subtitleId}`,
        classDot: clsTheme.dotColor,
      });
    });

    // 3. Sensei / Staff (for Head)
    if (isHead) {
      staffUsers.forEach((u) => {
        const name = u.nickname || u.displayName;
        items.push({
          id: `sensei-${u.uid}`,
          group: lang === 'id' ? 'Sensei & Admin' : '講師・管理者',
          label: name,
          sublabel: `${u.fullName && u.fullName !== name ? `${u.fullName} · ` : ''}${
            u.role === 'head' ? (lang === 'id' ? 'Admin' : '校長・管理者') : 'Sensei'
          }`,
          icon: <UserCheck className="w-4 h-4 text-sky-600 dark:text-sky-300" />,
          target: { kind: 'sensei', sensei: u },
          searchKeywords: `${name} ${u.fullName || ''} ${u.displayName} ${u.role} sensei admin`,
        });
      });
    }

    // 4. Students (Unassigned students visible to Admin only)
    students.forEach((stu) => {
      if (!stu.classId && !isHead) return;
      const clsTheme = getClassTheme(stu.classId);
      items.push({
        id: `stu-${stu.id}`,
        group: lang === 'id' ? 'Siswa' : '学生',
        label: stu.name,
        sublabel: `${classLabel(stu.classId, lang)}${stu.studentCode ? ` · ${stu.studentCode}` : ''}`,
        icon: <Users className="w-4 h-4 text-slate-600 dark:text-slate-300" />,
        target: { kind: 'student', student: stu },
        searchKeywords: `${stu.name} ${stu.studentCode} ${stu.classId || 'unassigned'} ${stu.targetGoal || ''}`,
        classDot: clsTheme?.dotColor,
      });
    });

    return items;
  }, [lang, profile.role, students, staffUsers]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allItems.slice(0, 24);
    return allItems
      .filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          (it.sublabel || '').toLowerCase().includes(q) ||
          it.searchKeywords.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [allItems, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(Math.max(filteredItems.length - 1, 0), i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && filteredItems[activeIdx]) {
        e.preventDefault();
        onSelect(filteredItems[activeIdx].target);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filteredItems, activeIdx, onClose, onSelect]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 apple-blur-overlay flex items-start justify-center pt-[10vh] p-4 no-print"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.28, 0.11, 0.32, 1] }}
            className="bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] rounded-[20px] max-w-xl w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-[#d2d2d7]/70 dark:border-[#424245]/70">
              <Search className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  lang === 'id'
                    ? 'Cari kelas, siswa, sensei, atau halaman...'
                    : 'クラス・学生・講師・ページを検索...'
                }
                className="flex-1 bg-transparent text-[15px] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder:text-[#6e6e73] dark:placeholder:text-[#86868b] focus:outline-none"
              />
              <span className="hidden sm:inline text-[11px] font-mono text-[#6e6e73] dark:text-[#86868b] border border-[#d2d2d7] dark:border-[#424245] rounded-md px-1.5 py-0.5">
                ESC
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close search"
                className="p-1.5 text-[#6e6e73] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-2 space-y-0.5">
              {filteredItems.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[#6e6e73] dark:text-[#86868b]">
                  {lang === 'id'
                    ? 'Tidak ada hasil yang cocok.'
                    : '該当する結果が見つかりませんでした。'}
                </div>
              ) : (
                filteredItems.map((item, idx) => {
                  const active = idx === activeIdx;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => {
                        onSelect(item.target);
                        onClose();
                      }}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-[12px] text-left transition-colors ${
                        active
                          ? 'bg-[#0071e3] dark:bg-[#2997ff] text-white'
                          : 'text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span
                          className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${
                            active
                              ? 'bg-white/15 text-white'
                              : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
                          }`}
                        >
                          {item.icon}
                        </span>
                        <div className="min-w-0">
                          <div className="text-[14px] font-medium truncate flex items-center gap-1.5">
                            {item.classDot && (
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  active ? 'bg-white' : item.classDot
                                }`}
                              />
                            )}
                            <span className="truncate">{item.label}</span>
                          </div>
                          {item.sublabel && (
                            <div
                              className={`text-[12px] truncate ${
                                active ? 'text-white/80' : 'text-[#6e6e73] dark:text-[#86868b]'
                              }`}
                            >
                              {item.sublabel}
                            </div>
                          )}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] shrink-0 ${
                          active ? 'text-white/80' : 'text-[#6e6e73] dark:text-[#86868b]'
                        }`}
                      >
                        {item.group}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
