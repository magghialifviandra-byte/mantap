import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Globe,
  LogOut,
  Menu,
  Search,
  UserCog,
  X,
} from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { classLabel } from '../i18n';
import { ClassId, CLASSES, LanguageMode, UserProfile } from '../types';
import { CLASS_THEMES } from '../utils/classTheme';
import { ThemeModeToggle, ThemePreference } from './AnimatedPrimitives';
import { triggerHaptic } from './AppleGestures';
import { PWAInstallButton } from './PWAInstallButton';

export type AppleNavTab =
  | 'dashboard'
  | 'monitoring'
  | 'report'
  | 'bank'
  | 'grading'
  | 'roster'
  | 'schedule'
  | 'journal'
  | 'users';

export interface MegaMenuLink {
  id: string;
  label: string;
  dotColor?: string;
  badgeCount?: number;
  onSelect: () => void;
}

export interface MegaMenuSection {
  id: 'dashboard' | 'classes' | 'reports' | 'bank' | 'schedule' | 'admin';
  label: string;
  exploreHeading: string;
  primaryLinks: MegaMenuLink[];
  quickLinksHeading: string;
  quickLinks: MegaMenuLink[];
}

interface GlobalNavProps {
  lang: LanguageMode;
  onChangeLang: (next: LanguageMode) => void;
  theme: ThemePreference;
  onChangeTheme: (next: ThemePreference) => void;
  profile: UserProfile;
  activeTab: AppleNavTab;
  totalUnreadFeedback?: number;
  pendingQuestionsCount?: number;
  onNavigate: (
    tab: AppleNavTab,
    opts?: { reportSubTab?: 'daily' | 'weekly'; bankPending?: boolean; classFilter?: ClassId; sectionAnchor?: string }
  ) => void;
  onOpenSearch: () => void;
  onOpenProfile: () => void;
  onSignOut: () => void;
}

export function AppleGlobalNav({
  lang,
  onChangeLang,
  theme,
  onChangeTheme,
  profile,
  activeTab,
  totalUnreadFeedback = 0,
  pendingQuestionsCount = 0,
  onNavigate,
  onOpenSearch,
  onOpenProfile,
  onSignOut,
}: GlobalNavProps) {
  const isHead = profile.role === 'head';
  const shouldReduce = useReducedMotion();

  const [openMenuId, setOpenMenuId] = useState<MegaMenuSection['id'] | null>(null);
  const [displayedMenuId, setDisplayedMenuId] = useState<MegaMenuSection['id'] | null>(null);
  const [contentFadeKey, setContentFadeKey] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileExpandedId, setMobileExpandedId] = useState<MegaMenuSection['id'] | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const panelFirstLinkRef = useRef<HTMLButtonElement | null>(null);
  const openedViaKeyboardRef = useRef(false);
  const headerRef = useRef<HTMLElement | null>(null);

  // Sync --nav-height CSS variable to the real rendered height of the Global Nav
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const syncHeight = () => {
      const h = Math.round(el.getBoundingClientRect().height) || 44;
      document.documentElement.style.setProperty('--nav-height', `${h}px`);
    };
    syncHeight();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(syncHeight);
      ro.observe(el);
      return () => {
        ro.disconnect();
        document.documentElement.style.setProperty('--nav-height', '44px');
      };
    }
    window.addEventListener('resize', syncHeight);
    return () => {
      window.removeEventListener('resize', syncHeight);
      document.documentElement.style.setProperty('--nav-height', '44px');
    };
  }, []);

  const clearTimers = () => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const closeAll = useCallback((returnFocus = false) => {
    clearTimers();
    setOpenMenuId(null);
    setAccountOpen(false);
    if (returnFocus) {
      window.setTimeout(() => {
        lastTriggerRef.current?.focus();
      }, 20);
    }
  }, []);

  // Lock page scroll while desktop mega menu or mobile full-screen overlay is open
  useEffect(() => {
    const isAnyOverlayOpen = Boolean(openMenuId) || mobileOpen;
    if (isAnyOverlayOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
    return undefined;
  }, [openMenuId, mobileOpen]);

  // Esc key closes open menu and returns focus
  useEffect(() => {
    if (!openMenuId && !mobileOpen && !accountOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMobileOpen(false);
        closeAll(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openMenuId, mobileOpen, accountOpen, closeAll]);

  const sections = useMemo<MegaMenuSection[]>(() => {
    const navigateAndClose = (
      tab: AppleNavTab,
      opts?: { reportSubTab?: 'daily' | 'weekly'; bankPending?: boolean; classFilter?: ClassId; sectionAnchor?: string }
    ) => {
      triggerHaptic(6);
      setMobileOpen(false);
      closeAll(false);
      onNavigate(tab, opts);
    };

    const classLinks: MegaMenuLink[] = CLASSES.map((cls) => ({
      id: `cls-${cls.id}`,
      label: classLabel(cls.id, lang),
      dotColor: CLASS_THEMES[cls.id].dotColor,
      onSelect: () =>
        navigateAndClose(isHead ? 'dashboard' : 'roster', { classFilter: cls.id }),
    }));

    if (isHead) {
      return [
        {
          id: 'dashboard',
          label: lang === 'id' ? 'Dashboard' : 'ダッシュボード',
          exploreHeading: lang === 'id' ? 'Jelajahi Dashboard' : 'ダッシュボード',
          primaryLinks: [
            {
              id: 'dash-overview',
              label: lang === 'id' ? 'Ringkasan Utama' : '統括オーバービュー',
              onSelect: () => navigateAndClose('dashboard'),
            },
            {
              id: 'dash-recap',
              label: lang === 'id' ? 'Rekap Harian & Mingguan' : '日報・週報サマリー',
              onSelect: () => navigateAndClose('dashboard', { sectionAnchor: 'recap' }),
            },
            {
              id: 'dash-wallboard',
              label: lang === 'id' ? 'Peringkat Resmi & Papan Dinding' : '公式ランキング・掲示用ボード',
              onSelect: () => navigateAndClose('dashboard', { sectionAnchor: 'ranking' }),
            },
          ],
          quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
          quickLinks: [
            {
              id: 'ql-weekly-rep',
              label: lang === 'id' ? 'Laporan Mingguan' : '週報管理',
              onSelect: () => navigateAndClose('report', { reportSubTab: 'weekly' }),
            },
            {
              id: 'ql-weekly-exam',
              label: lang === 'id' ? 'Input Nilai Ujian Mingguan' : '週次テスト採点入力',
              onSelect: () => navigateAndClose('grading'),
            },
            {
              id: 'ql-students',
              label: lang === 'id' ? 'Daftar Siswa' : '学生名簿',
              onSelect: () => navigateAndClose('roster'),
            },
            {
              id: 'ql-monitoring',
              label: lang === 'id' ? 'Monitoring Sensei' : '講師モニタリング',
              onSelect: () => navigateAndClose('monitoring'),
            },
          ],
        },
        {
          id: 'classes',
          label: lang === 'id' ? 'Kelas' : 'クラス',
          exploreHeading: lang === 'id' ? 'Pilih Kelas' : 'クラス一覧',
          primaryLinks: classLinks,
          quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
          quickLinks: [
            {
              id: 'ql-cls-roster',
              label: lang === 'id' ? 'Daftar Siswa & Target' : '学生名簿・目標',
              onSelect: () => navigateAndClose('roster'),
            },
            {
              id: 'ql-cls-schedule',
              label: lang === 'id' ? 'Jadwal Mingguan' : '学校スケジュール',
              onSelect: () => navigateAndClose('schedule'),
            },
            {
              id: 'ql-cls-daily',
              label: lang === 'id' ? 'Laporan Harian' : '日報',
              onSelect: () => navigateAndClose('report', { reportSubTab: 'daily' }),
            },
            {
              id: 'ql-cls-weekly',
              label: lang === 'id' ? 'Laporan Mingguan' : '週報',
              onSelect: () => navigateAndClose('report', { reportSubTab: 'weekly' }),
            },
          ],
        },
        {
          id: 'reports',
          label: lang === 'id' ? 'Laporan' : '日報・週報',
          exploreHeading: lang === 'id' ? 'Sistem Laporan' : '報告管理',
          primaryLinks: [
            {
              id: 'rep-daily',
              label: lang === 'id' ? 'Laporan Harian (Nippo)' : '日報 (Nippo)',
              onSelect: () => navigateAndClose('report', { reportSubTab: 'daily' }),
            },
            {
              id: 'rep-weekly',
              label: lang === 'id' ? 'Laporan Mingguan & Sikap' : '週報・学習態度評価',
              onSelect: () => navigateAndClose('report', { reportSubTab: 'weekly' }),
            },
            {
              id: 'rep-recap',
              label: lang === 'id' ? 'Rekap & Ekspor PDF/Excel' : '総括レポート・出力',
              onSelect: () => navigateAndClose('dashboard', { sectionAnchor: 'recap' }),
            },
          ],
          quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
          quickLinks: [
            {
              id: 'ql-rep-mon',
              label: lang === 'id' ? 'Kalender Kepatuhan Sensei' : '提出カレンダー確認',
              onSelect: () => navigateAndClose('monitoring'),
            },
            {
              id: 'ql-rep-alerts',
              label: lang === 'id' ? 'Peringatan Siswa Berisiko' : '要注意学生アラート',
              onSelect: () => navigateAndClose('dashboard', { sectionAnchor: 'alerts' }),
            },
          ],
        },
        {
          id: 'bank',
          label: lang === 'id' ? 'Bank Soal' : '問題・採点',
          exploreHeading: lang === 'id' ? 'Bank Soal & Ujian' : '問題バンク・テスト',
          primaryLinks: [
            {
              id: 'bank-all',
              label: lang === 'id' ? 'Kelola Bank Soal & Audio' : '問題バンク一覧・聴解音声',
              onSelect: () => navigateAndClose('bank'),
            },
            {
              id: 'bank-pending',
              label: lang === 'id' ? 'Menunggu Review Admin' : '承認待ち問題レビュー',
              badgeCount: pendingQuestionsCount,
              onSelect: () => navigateAndClose('bank', { bankPending: true }),
            },
            {
              id: 'bank-grade',
              label: lang === 'id' ? 'Input Nilai & Koreksi Tes' : '採点・成績入力',
              onSelect: () => navigateAndClose('grading'),
            },
          ],
          quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
          quickLinks: [
            {
              id: 'ql-bank-rank',
              label: lang === 'id' ? 'Peringkat Ujian Mingguan' : '週次テスト公式順位',
              onSelect: () => navigateAndClose('dashboard', { sectionAnchor: 'ranking' }),
            },
            {
              id: 'ql-bank-roster',
              label: lang === 'id' ? 'Profil Siswa' : '学生詳細プロフィール',
              onSelect: () => navigateAndClose('roster'),
            },
          ],
        },
        {
          id: 'admin',
          label: lang === 'id' ? 'Admin' : '管理',
          exploreHeading: lang === 'id' ? 'Kontrol Kepala Sekolah' : '管理者メニュー',
          primaryLinks: [
            {
              id: 'adm-mon',
              label: lang === 'id' ? 'Monitoring Sensei' : '講師モニタリング',
              onSelect: () => navigateAndClose('monitoring'),
            },
            {
              id: 'adm-users',
              label: lang === 'id' ? 'Pengguna, Peran & Log Aktivitas' : 'ユーザー・権限・操作ログ',
              onSelect: () => navigateAndClose('users'),
            },
            {
              id: 'adm-journal',
              label: lang === 'id' ? 'Catatan Kepala Sekolah (Privat)' : '校長ノート（非公開）',
              onSelect: () => navigateAndClose('journal'),
            },
          ],
          quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
          quickLinks: [
            {
              id: 'ql-adm-ann',
              label: lang === 'id' ? 'Pengumuman Sekolah' : '全体お知らせ配信',
              onSelect: () => navigateAndClose('dashboard', { sectionAnchor: 'announcements' }),
            },
            {
              id: 'ql-adm-sched',
              label: lang === 'id' ? 'Kelola Jadwal & Beban Mengajar' : 'スケジュール管理',
              onSelect: () => navigateAndClose('schedule'),
            },
          ],
        },
      ];
    }

    // Sensei (Teacher) Role-based Mega Menus
    return [
      {
        id: 'reports',
        label: lang === 'id' ? 'Laporan' : '日報・週報',
        exploreHeading: lang === 'id' ? 'Laporan Pengajar' : '講師レポート',
        primaryLinks: [
          {
            id: 't-rep-daily',
            label: lang === 'id' ? 'Laporan Harian (Nippo)' : '日報を入力・確認',
            onSelect: () => navigateAndClose('report', { reportSubTab: 'daily' }),
          },
          {
            id: 't-rep-weekly',
            label: lang === 'id' ? 'Laporan Mingguan & Sikap' : '週報・学習態度を入力',
            badgeCount: totalUnreadFeedback,
            onSelect: () => navigateAndClose('report', { reportSubTab: 'weekly' }),
          },
        ],
        quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
        quickLinks: [
          {
            id: 't-ql-sched',
            label: '私のスケジュール',
            onSelect: () => navigateAndClose('schedule'),
          },
          {
            id: 't-ql-roster',
            label: lang === 'id' ? 'Daftar & Profil Siswa' : '学生名簿・プロフィール',
            onSelect: () => navigateAndClose('roster'),
          },
        ],
      },
      {
        id: 'classes',
        label: lang === 'id' ? 'Kelas' : 'クラス',
        exploreHeading: lang === 'id' ? 'Kelas Akademi' : '担当・在籍クラス',
        primaryLinks: classLinks,
        quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
        quickLinks: [
          {
            id: 't-cls-roster',
            label: lang === 'id' ? 'Profil & Catatan Siswa' : '学生名簿',
            onSelect: () => navigateAndClose('roster'),
          },
          {
            id: 't-cls-grade',
            label: lang === 'id' ? 'Input Nilai Tes' : '採点・成績入力',
            onSelect: () => navigateAndClose('grading'),
          },
        ],
      },
      {
        id: 'bank',
        label: lang === 'id' ? 'Bank Soal' : '問題・採点',
        exploreHeading: lang === 'id' ? 'Bank Soal & Penilaian' : '問題バンク・採点',
        primaryLinks: [
          {
            id: 't-bank-main',
            label: lang === 'id' ? 'Bank Soal & Audio Choukai' : '問題バンク・聴解音声',
            onSelect: () => navigateAndClose('bank'),
          },
          {
            id: 't-bank-grade',
            label: lang === 'id' ? 'Input Nilai Ujian Mingguan / Harian' : 'テスト採点・成績入力',
            onSelect: () => navigateAndClose('grading'),
          },
        ],
        quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
        quickLinks: [
          {
            id: 't-ql-weekly',
            label: lang === 'id' ? 'Sinkron ke Laporan Mingguan' : '週報と連携',
            onSelect: () => navigateAndClose('report', { reportSubTab: 'weekly' }),
          },
        ],
      },
      {
        id: 'schedule',
        label: '私のスケジュール',
        exploreHeading: lang === 'id' ? 'Jadwal Mengajar' : '担当スケジュール',
        primaryLinks: [
          {
            id: 't-sched-my',
            label: '私のスケジュール (My Schedule)',
            onSelect: () => navigateAndClose('schedule'),
          },
        ],
        quickLinksHeading: lang === 'id' ? 'Tautan Cepat' : 'クイックリンク',
        quickLinks: [
          {
            id: 't-sched-rep',
            label: lang === 'id' ? 'Isi Laporan Hari Ini' : '本日の日報を記入',
            onSelect: () => navigateAndClose('report', { reportSubTab: 'daily' }),
          },
        ],
      },
    ];
  }, [isHead, lang, pendingQuestionsCount, totalUnreadFeedback, onNavigate, closeAll]);

  const activeSection = useMemo(
    () => sections.find((s) => s.id === (openMenuId || displayedMenuId)) || null,
    [sections, openMenuId, displayedMenuId]
  );

  // Move focus into first link if opened via keyboard click
  useEffect(() => {
    if (openMenuId && openedViaKeyboardRef.current) {
      const t = window.setTimeout(() => {
        panelFirstLinkRef.current?.focus();
      }, 90);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [openMenuId, contentFadeKey]);

  const handleTriggerEnter = (id: MegaMenuSection['id'], btn: HTMLButtonElement | null) => {
    clearTimers();
    if (btn) lastTriggerRef.current = btn;
    if (openMenuId === id) return;
    if (openMenuId) {
      // Crossfade immediately without closing when already open
      openedViaKeyboardRef.current = false;
      setDisplayedMenuId(id);
      setOpenMenuId(id);
      setContentFadeKey((k) => k + 1);
      return;
    }
    hoverOpenTimerRef.current = window.setTimeout(() => {
      openedViaKeyboardRef.current = false;
      setDisplayedMenuId(id);
      setOpenMenuId(id);
      setContentFadeKey((k) => k + 1);
    }, 100);
  };

  const handleNavAreaLeave = () => {
    clearTimers();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setOpenMenuId(null);
    }, 140);
  };

  const handleNavAreaEnter = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const handleTriggerClick = (id: MegaMenuSection['id'], btn: HTMLButtonElement) => {
    clearTimers();
    lastTriggerRef.current = btn;
    openedViaKeyboardRef.current = true;
    setAccountOpen(false);
    if (openMenuId === id) {
      setOpenMenuId(null);
    } else {
      setDisplayedMenuId(id);
      setOpenMenuId(id);
      setContentFadeKey((k) => k + 1);
    }
  };

  // ArrowUp / ArrowDown navigation inside mega menu panel
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-mega-link="true"]')
    );
    if (focusables.length === 0) return;
    const idx = focusables.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    const nextIdx =
      e.key === 'ArrowDown'
        ? idx < focusables.length - 1
          ? idx + 1
          : 0
        : idx > 0
        ? idx - 1
        : focusables.length - 1;
    focusables[nextIdx]?.focus();
  };

  const isSectionActive = (id: MegaMenuSection['id']): boolean => {
    if (id === 'dashboard') return activeTab === 'dashboard';
    if (id === 'reports') return activeTab === 'report';
    if (id === 'bank') return activeTab === 'bank' || activeTab === 'grading';
    if (id === 'schedule') return activeTab === 'schedule';
    if (id === 'classes') return activeTab === 'roster';
    if (id === 'admin')
      return activeTab === 'monitoring' || activeTab === 'users' || activeTab === 'journal';
    return false;
  };

  const shownName = profile.nickname || profile.displayName;
  const initials = shownName.trim().slice(0, 2).toUpperCase();

  return (
    <div
      className="sticky top-0 z-40 w-full no-print"
      onMouseLeave={handleNavAreaLeave}
      onMouseEnter={handleNavAreaEnter}
    >
      {/* 44px Apple Global Nav Bar */}
      <header
        ref={headerRef}
        className={`apple-global-nav relative z-10 w-full ${
          openMenuId ? 'is-menu-open' : ''
        }`}
      >
        <div className="max-w-[1024px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
          {/* Brand Wordmark */}
          <button
            type="button"
            onClick={() => {
              closeAll(false);
              onNavigate(isHead ? 'dashboard' : 'report');
            }}
            className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
            aria-label="元気アカデミー / Genki Academy"
          >
            <img
              src="/assets/aistudio/images_a3530f27.jpg"
              alt=""
              className="w-5 h-5 rounded object-cover"
            />
            <span>元気アカデミー</span>
          </button>

          {/* Desktop Top-Level Mega Menu Triggers (12px text, 0.8 -> 1 opacity on hover) */}
          <nav
            aria-label="Global navigation"
            className="hidden md:flex items-center justify-center gap-7"
          >
            {sections.map((sec) => {
              const isOpen = openMenuId === sec.id;
              const isCurr = isSectionActive(sec.id);
              const badge =
                (sec.id === 'bank' && isHead && pendingQuestionsCount > 0
                  ? pendingQuestionsCount
                  : 0) ||
                (sec.id === 'reports' && !isHead && totalUnreadFeedback > 0
                  ? totalUnreadFeedback
                  : 0);

              return (
                <button
                  key={sec.id}
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`mega-panel-${sec.id}`}
                  onMouseEnter={(e) => handleTriggerEnter(sec.id, e.currentTarget)}
                  onClick={(e) => handleTriggerClick(sec.id, e.currentTarget)}
                  className={`relative py-2.5 text-[12px] font-normal whitespace-nowrap shrink-0 transition-opacity duration-200 ${
                    isOpen || isCurr
                      ? 'opacity-100 text-[#1d1d1f] dark:text-[#f5f5f7] font-medium'
                      : 'opacity-80 hover:opacity-100 text-[#1d1d1f] dark:text-[#f5f5f7]'
                  }`}
                >
                  <span>{sec.label}</span>
                  {badge > 0 && (
                    <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] align-middle" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Utility Actions (Search, PWA, Theme, Language, Account, Mobile Menu) */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                closeAll(false);
                onOpenSearch();
              }}
              className="p-2 text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition-colors rounded-full"
              aria-label={lang === 'id' ? 'Cari (Cmd/Ctrl+K)' : '検索 (Cmd/Ctrl+K)'}
              title="Cmd/Ctrl + K"
            >
              <Search className="w-4 h-4" />
            </button>

            <div className="hidden lg:block">
              <PWAInstallButton lang={lang} />
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <ThemeModeToggle theme={theme} onChange={onChangeTheme} lang={lang} />
              <button
                type="button"
                onClick={() => onChangeLang(lang === 'ja' ? 'id' : 'ja')}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[#1d1d1f]/80 dark:text-[#f5f5f7]/80 hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
                title={lang === 'ja' ? 'Switch to Indonesian' : '日本語に切替'}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '日本語' : 'ID'}</span>
              </button>
            </div>

            {/* Profile Popover Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  setAccountOpen((v) => !v);
                }}
                aria-expanded={accountOpen}
                aria-label={lang === 'id' ? 'Menu Akun' : 'アカウントメニュー'}
                className="w-7 h-7 rounded-full overflow-hidden bg-[#1d1d1f] dark:bg-[#2c2c2e] text-white text-[11px] font-semibold flex items-center justify-center hover:opacity-85 transition-opacity"
              >
                {profile.avatarDataUrl ? (
                  <img
                    src={profile.avatarDataUrl}
                    alt={shownName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </button>

              {accountOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-[16px] bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] shadow-xl py-1.5 z-50">
                  <div className="px-3.5 py-2 border-b border-[#d2d2d7]/60 dark:border-[#424245]/60">
                    <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                      {shownName}
                    </div>
                    <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                      {isHead
                        ? lang === 'id'
                          ? 'Kepala Sekolah / Admin'
                          : '校長・管理者'
                        : lang === 'id'
                        ? 'Sensei / Pengajar'
                        : '講師'}
                    </div>
                  </div>

                  <div className="sm:hidden px-3.5 py-2 border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 flex items-center justify-between gap-2">
                    <ThemeModeToggle theme={theme} onChange={onChangeTheme} lang={lang} />
                    <button
                      type="button"
                      onClick={() => onChangeLang(lang === 'ja' ? 'id' : 'ja')}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7]"
                    >
                      {lang === 'ja' ? '日本語 → ID' : 'ID → 日本語'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      onOpenProfile();
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-left"
                  >
                    <UserCog className="w-3.5 h-3.5 text-[#6e6e73] dark:text-[#86868b]" />
                    <span>{lang === 'id' ? 'Edit Profil' : 'プロフィール編集'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      onSignOut();
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2 text-[13px] text-[#dc2626] dark:text-[#ff453a] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-left"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>{lang === 'id' ? 'Keluar' : 'ログアウト'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Mobile Hamburger Button (44px target) */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic(6);
                setMobileOpen((v) => !v);
              }}
              aria-expanded={mobileOpen}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="md:hidden w-10 h-10 -mr-2 flex items-center justify-center text-[#1d1d1f] dark:text-[#f5f5f7]"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Desktop Full-Width Mega Menu Dropdown Panel (continuous solid-translucent piece with nav bar) */}
        <div
          id={activeSection ? `mega-panel-${activeSection.id}` : undefined}
          onKeyDown={handlePanelKeyDown}
          style={{
            backgroundColor: 'var(--apple-nav-solid)',
            borderBottom: openMenuId ? '1px solid var(--apple-hairline-subtle)' : 'none',
          }}
          className={`hidden md:block absolute left-0 right-0 top-[var(--nav-height,44px)] z-10 apple-expandable shadow-sm ${
            openMenuId ? 'is-open pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <div className="apple-expandable-inner">
            {activeSection && (
              <div
                key={contentFadeKey}
                className="max-w-[980px] mx-auto px-6 pt-10 pb-12 grid grid-cols-12 gap-10"
              >
                {/* Primary Column: 28px weight-600 links */}
                <div className="col-span-7 space-y-3">
                  <div className="text-[12px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                    {activeSection.exploreHeading}
                  </div>
                  <ul className="space-y-2.5">
                    {activeSection.primaryLinks.map((lnk, idx) => (
                      <li
                        key={lnk.id}
                        style={
                          shouldReduce
                            ? undefined
                            : {
                                animation: `megaLinkRise 280ms cubic-bezier(0.28, 0.11, 0.32, 1) ${
                                  40 + idx * 40
                                }ms both`,
                              }
                        }
                      >
                        <button
                          ref={idx === 0 ? panelFirstLinkRef : undefined}
                          data-mega-link="true"
                          type="button"
                          onClick={lnk.onSelect}
                          className="group inline-flex items-center gap-3 text-left text-[26px] lg:text-[28px] font-semibold tracking-[-0.02em] leading-[1.15] text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] focus:outline-none focus-visible:text-[#0066cc] transition-colors duration-150"
                        >
                          {lnk.dotColor && (
                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${lnk.dotColor}`} />
                          )}
                          <span>{lnk.label}</span>
                          {lnk.badgeCount !== undefined && lnk.badgeCount > 0 && (
                            <span className="text-[13px] font-medium text-[#0066cc] dark:text-[#2997ff] tabular-nums">
                              ({lnk.badgeCount})
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Secondary Narrower Column: Quick Links (14px) */}
                <div className="col-span-5 space-y-3">
                  <div className="text-[12px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                    {activeSection.quickLinksHeading}
                  </div>
                  <ul className="space-y-2">
                    {activeSection.quickLinks.map((lnk, idx) => (
                      <li
                        key={lnk.id}
                        style={
                          shouldReduce
                            ? undefined
                            : {
                                animation: `megaLinkRise 260ms cubic-bezier(0.28, 0.11, 0.32, 1) ${
                                  80 + idx * 38
                                }ms both`,
                              }
                        }
                      >
                        <button
                          data-mega-link="true"
                          type="button"
                          onClick={lnk.onSelect}
                          className="text-left text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] focus:outline-none focus-visible:text-[#0066cc] transition-colors duration-150"
                        >
                          {lnk.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Blurred + Dimmed Full-Screen Backdrop Below Global Nav (fades over 300ms) */}
      <div
        aria-hidden="true"
        onClick={() => closeAll(false)}
        style={{ backgroundColor: 'var(--apple-overlay-bg)' }}
        className={`hidden md:block fixed inset-x-0 top-[var(--nav-height,44px)] bottom-0 z-0 apple-blur-overlay transition-opacity duration-300 ${
          openMenuId ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Mobile Full-Screen Overlay Accordion Menu */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 top-[var(--nav-height,44px)] z-10 bg-white/95 dark:bg-[#161617]/95 apple-blur-overlay overflow-y-auto px-6 py-6 space-y-2"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          {sections.map((sec) => {
            const expanded = mobileExpandedId === sec.id;
            return (
              <div
                key={sec.id}
                className="border-b border-[#d2d2d7]/60 dark:border-[#424245]/60 pb-2"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    triggerHaptic(5);
                    setMobileExpandedId((cur) => (cur === sec.id ? null : sec.id));
                  }}
                  className="w-full py-3 flex items-center justify-between text-left text-[24px] font-semibold tracking-[-0.02em] text-[#1d1d1f] dark:text-[#f5f5f7]"
                >
                  <span>{sec.label}</span>
                  <ChevronDown
                    className={`w-5 h-5 text-[#6e6e73] transition-transform duration-300 ${
                      expanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                <div className={`apple-expandable ${expanded ? 'is-open' : ''}`}>
                  <div className="apple-expandable-inner">
                    <div className="pb-4 pl-1 space-y-3">
                      <ul className="space-y-2">
                        {sec.primaryLinks.map((lnk, idx) => (
                          <li
                            key={lnk.id}
                            style={
                              shouldReduce || !expanded
                                ? undefined
                                : {
                                    animation: `megaLinkRise 240ms cubic-bezier(0.28, 0.11, 0.32, 1) ${
                                      idx * 40
                                    }ms both`,
                                  }
                            }
                          >
                            <button
                              type="button"
                              onClick={lnk.onSelect}
                              className="inline-flex items-center gap-2.5 text-left text-[17px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] active:text-[#0071e3]"
                            >
                              {lnk.dotColor && (
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${lnk.dotColor}`}
                                />
                              )}
                              <span>{lnk.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                      {sec.quickLinks.length > 0 && (
                        <div className="pt-1 space-y-1.5">
                          <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                            {sec.quickLinksHeading}
                          </div>
                          {sec.quickLinks.map((lnk) => (
                            <button
                              key={lnk.id}
                              type="button"
                              onClick={lnk.onSelect}
                              className="block text-left text-[14px] text-[#6e6e73] dark:text-[#86868b] hover:text-[#0066cc]"
                            >
                              {lnk.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-4 flex flex-wrap items-center justify-between gap-3">
            <PWAInstallButton lang={lang} />
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onOpenProfile();
              }}
              className="text-[14px] font-medium text-[#0066cc] dark:text-[#2997ff]"
            >
              {lang === 'id' ? 'Edit Profil' : 'プロフィール編集'}
            </button>
          </div>
        </div>
      )}

      {/* Keyframe helper for staggered mega-menu reveal */}
      <style>{`
        @keyframes megaLinkRise {
          from { opacity: 0; transform: translate3d(0, 8px, 0); }
          to { opacity: 1; transform: translate3d(0, 0, 0); }
        }
      `}</style>
    </div>
  );
}

/**
 * Apple Local Nav Bar below the Global Nav:
 * - stickyMode="none": non-sticky section header on overview pages (scrolls away cleanly).
 * - stickyMode="scroll-up": 48px translucent bar pinned at var(--nav-height) on data-dense pages,
 *   hiding on scroll down and revealing smoothly on scroll up, with hairline border only once scrolled.
 */
export function AppleLocalNav({
  title,
  subtitle,
  actions,
  stickyMode = 'none',
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  stickyMode?: 'none' | 'scroll-up';
}) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const lastScrollYRef = useRef(0);

  useEffect(() => {
    const initialY = typeof window !== 'undefined' ? window.scrollY : 0;
    lastScrollYRef.current = initialY;
    setIsScrolled(initialY > 4);
    setIsVisible(true);

    if (stickyMode !== 'scroll-up') return;

    const onScroll = () => {
      const y = window.scrollY;
      setIsScrolled(y > 4);

      if (y <= 48) {
        setIsVisible(true);
        lastScrollYRef.current = y;
        return;
      }

      const delta = y - lastScrollYRef.current;
      if (delta > 8) {
        setIsVisible(false);
        lastScrollYRef.current = y;
      } else if (delta < -8) {
        setIsVisible(true);
        lastScrollYRef.current = y;
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [stickyMode, title]);

  useEffect(() => {
    const activeHeight = stickyMode === 'scroll-up' && isVisible ? '48px' : '0px';
    document.documentElement.style.setProperty('--local-nav-height', activeHeight);
    return () => {
      document.documentElement.style.setProperty('--local-nav-height', '0px');
    };
  }, [stickyMode, isVisible]);

  return (
    <div
      className={`apple-local-nav w-full no-print ${
        stickyMode === 'scroll-up'
          ? `is-sticky-scroll-up ${isScrolled ? 'is-scrolled' : ''} ${
              isVisible ? '' : 'is-hidden'
            }`
          : 'is-static'
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-full flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="text-[18px] sm:text-[20px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
            {title}
          </h2>
          {subtitle && (
            <span className="hidden sm:inline text-[12px] text-[#6e6e73] dark:text-[#86868b] truncate">
              {subtitle}
            </span>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Apple.com-style minimalist Footer (#f5f5f7 light / #1d1d1f dark, 12px gray text, hairline dividers)
 */
export function AppleFooter({
  lang,
  profile,
  onNavigate,
}: {
  lang: LanguageMode;
  profile: UserProfile;
  onNavigate: (
    tab: AppleNavTab,
    opts?: { reportSubTab?: 'daily' | 'weekly'; bankPending?: boolean; classFilter?: ClassId }
  ) => void;
}) {
  const isHead = profile.role === 'head';
  return (
    <footer className="bg-[#f5f5f7] dark:bg-[#1d1d1f] text-[#6e6e73] dark:text-[#86868b] text-[12px] border-t border-[#d2d2d7]/60 dark:border-[#424245]/60 no-print mt-12">
      <div className="max-w-[1024px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <div className="space-y-2">
            <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'id' ? 'Kelas' : 'クラス'}
            </div>
            <ul className="space-y-1.5">
              {CLASSES.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate(isHead ? 'dashboard' : 'roster', { classFilter: c.id })}
                    className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                  >
                    {classLabel(c.id, lang)}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'id' ? 'Laporan' : '報告管理'}
            </div>
            <ul className="space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('report', { reportSubTab: 'daily' })}
                  className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                >
                  {lang === 'id' ? 'Laporan Harian' : '日報'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('report', { reportSubTab: 'weekly' })}
                  className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                >
                  {lang === 'id' ? 'Laporan Mingguan' : '週報'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('schedule')}
                  className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                >
                  {isHead ? (lang === 'id' ? 'Jadwal Sekolah' : 'スケジュール') : '私のスケジュール'}
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {lang === 'id' ? 'Akademik' : '教務・評価'}
            </div>
            <ul className="space-y-1.5">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('bank')}
                  className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                >
                  {lang === 'id' ? 'Bank Soal' : '問題バンク'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('grading')}
                  className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                >
                  {lang === 'id' ? 'Input Nilai & Koreksi' : '採点・成績'}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigate('roster')}
                  className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                >
                  {lang === 'id' ? 'Daftar Siswa' : '学生名簿'}
                </button>
              </li>
            </ul>
          </div>

          {isHead && (
            <div className="space-y-2">
              <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id' ? 'Administrasi' : '管理者'}
              </div>
              <ul className="space-y-1.5">
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('monitoring')}
                    className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                  >
                    {lang === 'id' ? 'Monitoring Sensei' : '講師モニタリング'}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('journal')}
                    className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                  >
                    {lang === 'id' ? 'Catatan Kepala Sekolah' : '校長ノート'}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => onNavigate('users')}
                    className="hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:underline text-left"
                  >
                    {lang === 'id' ? 'Pengguna & Peran' : 'ユーザー・権限'}
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-[#d2d2d7]/80 dark:border-[#424245]/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            Copyright © {new Date().getFullYear()} 元気アカデミー (Genki Academy).{' '}
            {lang === 'id' ? 'Seluruh hak cipta dilindungi.' : 'All rights reserved.'}
          </div>
          <div>
            {lang === 'ja'
              ? '日本語教育・送り出し機関 教務管理システム'
              : 'Sistem Akademik Pendidikan Bahasa Jepang'}
          </div>
        </div>
      </div>
    </footer>
  );
}
