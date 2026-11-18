import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ChevronRight,
  Clock,
  LogIn,
  LogOut,
  MessageSquare,
  UserCog,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import {
  SkeletonLoadingShell,
  ThemeModeToggle,
  ThemePreference,
} from './components/AnimatedPrimitives';
import { AnnouncementsPanel } from './components/AnnouncementsPanel';
import {
  AppleFooter,
  AppleGlobalNav,
  AppleLocalNav,
  AppleNavTab,
} from './components/AppleGlobalNav';
import {
  APPLE_EASE,
  PullToRefreshContainer,
  runViewTransition,
  triggerHaptic,
} from './components/AppleGestures';
import { CommandPaletteModal, JumpTarget } from './components/CommandPaletteModal';
import { DailyReportForm } from './components/DailyReportForm';
import { HeadDashboard } from './components/HeadDashboard';
import { HeadJournalView } from './components/HeadJournalView';
import { ProfileSetupModal } from './components/ProfileSetupModal';
import { OfflineBanner } from './components/PWAInstallButton';
import { QuestionBankManager } from './components/QuestionBankManager';
import { RosterAndStaff } from './components/RosterAndStaff';
import { ScheduleWorkspace } from './components/ScheduleWorkspace';
import { SenseiMonitoringView } from './components/SenseiMonitoringView';
import { StudentProfileModal } from './components/StudentProfileModal';
import { TestGradingView } from './components/TestGradingView';
import { UsersRolesView } from './components/UsersRolesView';
import { WeeklyReportView } from './components/WeeklyReportView';
import {
  auth,
  db,
  handleFirestoreError,
  HEAD_EMAIL,
  inviteDocIdForEmail,
  OperationType,
  signInWithGooglePopup,
  signOutUser,
} from './firebase';
import { tr, UI_TEXT } from './i18n';
import {
  ActivityLogEntry,
  Announcement,
  AnnouncementRead,
  ClassId,
  CLASSES,
  DailyReport,
  DEFAULT_QUALITY_THRESHOLDS,
  HandledAlert,
  HeadJournalEntry,
  LanguageMode,
  QualityThresholds,
  QuestionItem,
  QuestionReviewStatus,
  ScheduleDoc,
  StaffInvite,
  Student,
  StudentProfileNote,
  TestResult,
  TestSheet,
  UserProfile,
  WeeklyReport,
} from './types';
import { getClassTheme } from './utils/classTheme';
import { getTodayDateStr } from './utils/dateUtils';
import { clampArray, clampStr } from './utils/payloadGuards';

type NavTab = AppleNavTab;

const CAMPUS_IMAGE_URL = '/src/assets/images/genki_academy_campus_1794986337681.jpg';

export default function App() {
  const shouldReduce = useReducedMotion();
  const [lang, setLang] = useState<LanguageMode>('ja');
  const [theme, setTheme] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem('genki_theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore storage failure
    }
    return 'system';
  });

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [tabHistory, setTabHistory] = useState<NavTab[]>([]);
  const [reportSubTab, setReportSubTab] = useState<'daily' | 'weekly'>('daily');
  const [bankReviewFilter, setBankReviewFilter] = useState<QuestionReviewStatus | 'all'>('all');
  const [gradingSheetId, setGradingSheetId] = useState<string | null>(null);
  const [selectedProfileStudent, setSelectedProfileStudent] = useState<Student | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSearchPalette, setShowSearchPalette] = useState(false);
  const [campusImgFailed, setCampusImgFailed] = useState(false);
  const [refreshPulse, setRefreshPulse] = useState(0);
  const [edgeSwipeX, setEdgeSwipeX] = useState(0);
  const edgeStartRef = useRef<{ x: number; y: number } | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [testSheets, setTestSheets] = useState<TestSheet[]>([]);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [scheduleDoc, setScheduleDoc] = useState<ScheduleDoc | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [announcementReads, setAnnouncementReads] = useState<AnnouncementRead[]>([]);
  const [thresholds, setThresholds] = useState<QualityThresholds>(DEFAULT_QUALITY_THRESHOLDS);
  const [handledAlerts, setHandledAlerts] = useState<HandledAlert[]>([]);
  const [studentNotes, setStudentNotes] = useState<StudentProfileNote[]>([]);
  const [headJournal, setHeadJournal] = useState<HeadJournalEntry[]>([]);
  const [staffUsers, setStaffUsers] = useState<UserProfile[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);

  const [printNode, setPrintNode] = useState<React.ReactNode | null>(null);
  const loggedSessionUidRef = useRef<string | null>(null);

  // Sync light/dark theme preference + system media query
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', isDark);
    };
    applyTheme();
    try {
      localStorage.setItem('genki_theme', theme);
    } catch {
      // ignore
    }
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [theme]);

  // Global Cmd/Ctrl+K shortcut for Command Palette Search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowSearchPalette((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 1. Auth listener & automatic profile bootstrap / invite claim
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (!fbUser) {
        setProfile(null);
        setAuthReady(true);
        return;
      }

      try {
        const userRef = doc(db, 'users', fbUser.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          const email = (fbUser.email || '').trim().toLowerCase();
          const isHeadAccount = email === HEAD_EMAIL && fbUser.emailVerified;
          const displayName = clampStr(
            fbUser.displayName || email.split('@')[0] || 'Sensei',
            100
          );

          let role: 'head' | 'teacher' = isHeadAccount ? 'head' : 'teacher';
          let status: 'active' | 'pending' = isHeadAccount ? 'active' : 'pending';
          let assignedClasses: ClassId[] = isHeadAccount
            ? ['hokkaido', 'saitama', 'nara', 'kaigo']
            : [];

          let claimedInviteId: string | null = null;
          if (!isHeadAccount && email) {
            const invId = inviteDocIdForEmail(email);
            const invRef = doc(db, 'staffInvites', invId);
            try {
              const invSnap = await getDoc(invRef);
              if (invSnap.exists()) {
                const invData = invSnap.data() as StaffInvite;
                role = invData.role;
                status = 'active';
                assignedClasses = clampArray(invData.assignedClasses || [], 4);
                claimedInviteId = invId;
              }
            } catch {
              // No invite found; stays pending
            }
          }

          await setDoc(userRef, {
            uid: fbUser.uid,
            displayName,
            fullName: displayName,
            nickname: displayName,
            avatarDataUrl: '',
            profileCompleted: isHeadAccount,
            role,
            status,
            assignedClasses: [...assignedClasses],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (email) {
            await setDoc(doc(db, 'users', fbUser.uid, 'private', 'info'), {
              email,
              updatedAt: serverTimestamp(),
            });
          }

          if (claimedInviteId) {
            try {
              await deleteDoc(doc(db, 'staffInvites', claimedInviteId));
            } catch {
              // ignore cleanup failure
            }
          }
        }
      } catch (err) {
        console.error('Auth bootstrap error:', err);
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  // 2. Live User Profile listener (immediate role change reactivity) + lastLoginAt stamp
  useEffect(() => {
    if (!authReady || !user) {
      loggedSessionUidRef.current = null;
      return;
    }
    const path = `users/${user.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', user.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
          if (data.role === 'teacher') {
            setActiveTab((prev) =>
              prev === 'dashboard' ||
              prev === 'monitoring' ||
              prev === 'journal' ||
              prev === 'users'
                ? 'report'
                : prev
            );
          }
          if (data.status === 'active' && loggedSessionUidRef.current !== user.uid) {
            loggedSessionUidRef.current = user.uid;
            updateDoc(doc(db, 'users', user.uid), {
              lastLoginAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }).catch(() => {
              // ignore non-critical telemetry write error
            });
          }
        }
      },
      (error) => handleFirestoreError(error, OperationType.GET, path)
    );
    return () => unsub();
  }, [authReady, user]);

  // 3. School Data Listeners (ONLY when authenticated & active)
  useEffect(() => {
    if (!authReady || !user || !profile || profile.status !== 'active') return;

    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        collection(db, 'students'),
        (snap) => {
          setStudents(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'students')
      )
    );

    const reportsSource =
      profile.role === 'head'
        ? collection(db, 'dailyReports')
        : query(collection(db, 'dailyReports'), where('teacherUid', '==', user.uid));

    unsubs.push(
      onSnapshot(
        reportsSource,
        (snap) => {
          setReports(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DailyReport, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'dailyReports')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'schedules', 'main'),
        (snap) => {
          if (snap.exists()) {
            setScheduleDoc({ id: snap.id, ...(snap.data() as Omit<ScheduleDoc, 'id'>) });
          } else {
            setScheduleDoc(null);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'schedules/main')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'questions'),
        (snap) => {
          setQuestions(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QuestionItem, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'questions')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'testSheets'),
        (snap) => {
          setTestSheets(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TestSheet, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'testSheets')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'testResults'),
        (snap) => {
          setTestResults(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TestResult, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'testResults')
      )
    );

    const weeklyReportsSource =
      profile.role === 'head'
        ? collection(db, 'weeklyReports')
        : query(collection(db, 'weeklyReports'), where('teacherUid', '==', user.uid));

    unsubs.push(
      onSnapshot(
        weeklyReportsSource,
        (snap) => {
          setWeeklyReports(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WeeklyReport, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'weeklyReports')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'announcements'),
        (snap) => {
          setAnnouncements(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Announcement, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'announcements')
      )
    );

    const annReadsSource =
      profile.role === 'head'
        ? collection(db, 'announcementReads')
        : query(collection(db, 'announcementReads'), where('uid', '==', user.uid));

    unsubs.push(
      onSnapshot(
        annReadsSource,
        (snap) => {
          setAnnouncementReads(
            snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AnnouncementRead, 'id'>) }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'announcementReads')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'qualitySettings', 'default'),
        (snap) => {
          if (snap.exists()) {
            const raw = snap.data() as Partial<QualityThresholds>;
            setThresholds({
              ...DEFAULT_QUALITY_THRESHOLDS,
              ...raw,
            });
          } else {
            setThresholds(DEFAULT_QUALITY_THRESHOLDS);
          }
        },
        (err) => handleFirestoreError(err, OperationType.GET, 'qualitySettings/default')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'studentNotes'),
        (snap) => {
          setStudentNotes(
            snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<StudentProfileNote, 'id'>),
            }))
          );
        },
        (err) => handleFirestoreError(err, OperationType.LIST, 'studentNotes')
      )
    );

    if (profile.role === 'head') {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => {
            setStaffUsers(snap.docs.map((d) => d.data() as UserProfile));
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'staffInvites'),
          (snap) => {
            setStaffInvites(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffInvite, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'staffInvites')
        )
      );
      unsubs.push(
        onSnapshot(
          query(collection(db, 'activityLogs'), limit(120)),
          (snap) => {
            setActivityLogs(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ActivityLogEntry, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'activityLogs')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'headJournal'),
          (snap) => {
            setHeadJournal(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<HeadJournalEntry, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'headJournal')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'handledAlerts'),
          (snap) => {
            setHandledAlerts(
              snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<HandledAlert, 'id'>) }))
            );
          },
          (err) => handleFirestoreError(err, OperationType.LIST, 'handledAlerts')
        )
      );
    } else {
      setStaffUsers([]);
      setStaffInvites([]);
      setActivityLogs([]);
      setHeadJournal([]);
      setHandledAlerts([]);
    }

    return () => unsubs.forEach((u) => u());
  }, [authReady, user, profile?.status, profile?.role]);

  // Sensei missing today's daily report gentle reminder
  const senseiMissingReportToday = useMemo(() => {
    if (!profile || profile.role !== 'teacher' || profile.status !== 'active') return false;
    const todayStr = getTodayDateStr();
    const submittedToday = reports.some((r) => r.date === todayStr);
    return !submittedToday;
  }, [profile, reports]);

  // Sensei unread feedback counts (daily + weekly)
  const unreadDailyCount = useMemo(() => {
    if (!profile || profile.role !== 'teacher') return 0;
    return reports.filter(
      (r) => r.teacherUid === profile.uid && Boolean(r.headFeedback) && r.commentReadByTeacher === false
    ).length;
  }, [profile, reports]);

  const unreadWeeklyCount = useMemo(() => {
    if (!profile || profile.role !== 'teacher') return 0;
    return weeklyReports.filter(
      (w) => w.teacherUid === profile.uid && Boolean(w.headComment) && w.commentReadByTeacher === false
    ).length;
  }, [profile, weeklyReports]);

  const totalUnreadFeedback = unreadDailyCount + unreadWeeklyCount;

  const pendingQuestionsCount = useMemo(() => {
    if (!profile || profile.role !== 'head') return 0;
    return questions.filter((q) => q.reviewStatus === 'pending').length;
  }, [profile, questions]);

  const navigateTab = useCallback(
    (
      tab: NavTab,
      opts?: {
        reportSubTab?: 'daily' | 'weekly';
        bankPending?: boolean;
        classFilter?: ClassId;
        sectionAnchor?: string;
      }
    ) => {
      runViewTransition(() => {
        setActiveTab((prev) => {
          if (prev !== tab) {
            setTabHistory((h) => [...h.slice(-8), prev]);
          }
          return tab;
        });
        if (tab === 'bank') {
          setBankReviewFilter(opts?.bankPending ? 'pending' : 'all');
        }
        if (tab === 'report' && opts?.reportSubTab) {
          setReportSubTab(opts.reportSubTab);
        }
      });
      if (opts?.sectionAnchor) {
        window.setTimeout(() => {
          const el = document.getElementById(`apple-sec-${opts.sectionAnchor}`);
          el?.scrollIntoView({ behavior: shouldReduce ? 'auto' : 'smooth', block: 'start' });
        }, 120);
      } else {
        window.scrollTo({ top: 0, behavior: shouldReduce ? 'auto' : 'smooth' });
      }
    },
    [shouldReduce]
  );

  const navigateBack = useCallback(() => {
    if (tabHistory.length === 0) return;
    const prev = tabHistory[tabHistory.length - 1];
    triggerHaptic(7);
    runViewTransition(() => {
      setTabHistory((h) => h.slice(0, -1));
      setActiveTab(prev);
    });
  }, [tabHistory]);

  const handleLogin = async () => {
    setAuthError('');
    try {
      await signInWithGooglePopup();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login gagal');
    }
  };

  const handleSearchSelect = (target: JumpTarget) => {
    if (target.kind === 'tab') {
      navigateTab(target.tab);
    } else if (target.kind === 'class') {
      navigateTab(profile?.role === 'head' ? 'dashboard' : 'roster');
    } else if (target.kind === 'student') {
      setSelectedProfileStudent(target.student);
    } else if (target.kind === 'sensei') {
      if (profile?.role === 'head') navigateTab('monitoring');
    }
  };

  if (!authReady) {
    return <SkeletonLoadingShell />;
  }

  // Unauthenticated Screen — Minimalist Apple.com Design Language
  if (!user) {
    return (
      <div className="min-h-screen bg-white dark:bg-black text-[#1d1d1f] dark:text-[#f5f5f7] flex flex-col">
        {/* Clean 44px Apple Global Nav on Login Screen */}
        <header className="apple-global-nav sticky top-0 z-40">
          <div className="max-w-[1024px] mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
              <img
                src="/assets/aistudio/images_a3530f27.jpg"
                alt=""
                className="w-5 h-5 rounded object-cover"
              />
              <span>元気アカデミー</span>
            </div>
            <div className="flex items-center gap-2">
              <ThemeModeToggle theme={theme} onChange={setTheme} lang={lang} />
              <div className="inline-flex items-center p-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/70 dark:border-[#424245]">
                {(['ja', 'id'] as LanguageMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setLang(m)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors whitespace-nowrap ${
                      lang === m
                        ? 'bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-2xs'
                        : 'text-[#6e6e73] dark:text-[#86868b]'
                    }`}
                  >
                    {m === 'ja' ? '日本語' : 'ID'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        {/* Hero Section (#ffffff light / #000000 dark) */}
        <section className="flex-1 bg-white dark:bg-black py-12 sm:py-20 px-4 sm:px-6">
          <div className="max-w-[980px] mx-auto space-y-12">
            <div className="text-center max-w-[740px] mx-auto space-y-5">
              <div className="text-[14px] font-medium text-[#6e6e73] dark:text-[#86868b]">
                元気アカデミー · {lang === 'id' ? 'Portal Akademik Resmi' : '日本語学校 公式教務システム'}
              </div>
              <h1 className="apple-hero-title text-[36px] sm:text-[52px]">
                {tr(UI_TEXT.signInTitle, lang)}
              </h1>
              <p className="text-[19px] sm:text-[22px] text-[#6e6e73] dark:text-[#86868b] leading-[1.38] font-normal">
                {tr(UI_TEXT.signInSub, lang)}
              </p>

              {authError && (
                <div className="max-w-md mx-auto text-[13px] text-[#dc2626] dark:text-[#ff453a] bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#d2d2d7] dark:border-[#424245] px-4 py-3 rounded-[14px]">
                  {authError}
                </div>
              )}

              <div className="pt-2 flex flex-wrap items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={handleLogin}
                  className="apple-btn-primary inline-flex items-center gap-2 text-[17px] px-[22px] py-[11px]"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{tr(UI_TEXT.signInBtn, lang)}</span>
                </button>
              </div>
            </div>

            {/* Clean Architectural Showcase */}
            <div className="rounded-[24px] overflow-hidden bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#d2d2d7]/60 dark:border-[#424245]/60">
              {!campusImgFailed ? (
                <div className="aspect-[16/8] w-full overflow-hidden">
                  <img
                    src={CAMPUS_IMAGE_URL}
                    alt="元気アカデミー教室 / Ruang Kelas Genki Academy"
                    referrerPolicy="no-referrer"
                    onError={() => setCampusImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-[16/7] w-full flex items-center justify-center p-10">
                  <div className="text-center space-y-2">
                    <div className="text-[28px] font-semibold tracking-[-0.02em]">
                      元気アカデミー
                    </div>
                    <div className="text-[14px] text-[#6e6e73] dark:text-[#86868b]">
                      Genki Academy Academic Portal
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Alternating Section (#f5f5f7 light / #1d1d1f dark): 4 Academy Classes */}
        <section className="bg-[#f5f5f7] dark:bg-[#1d1d1f] py-12 px-4 sm:px-6 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60">
          <div className="max-w-[980px] mx-auto space-y-6">
            <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
              {lang === 'id' ? 'Empat Kelas Terstruktur' : '開講クラス'}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {CLASSES.map((c) => {
                const cTheme = getClassTheme(c.id);
                return (
                  <div
                    key={c.id}
                    className="apple-tile bg-white dark:bg-black p-6 space-y-2 rounded-[20px]"
                  >
                    <div className="flex items-center gap-2 text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {cTheme && (
                        <span className={`w-2.5 h-2.5 rounded-full ${cTheme.dotColor} shrink-0`} />
                      )}
                      <span>{c.nameJa}</span>
                    </div>
                    <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b]">{c.nameId}</div>
                    <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] pt-1">
                      {lang === 'ja' ? c.subtitleJa : c.subtitleId}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="pt-4 border-t border-[#d2d2d7]/70 dark:border-[#424245]/70 text-[12px] text-[#6e6e73] dark:text-[#86868b] flex flex-col sm:flex-row justify-between gap-2">
              <span>Copyright © {new Date().getFullYear()} 元気アカデミー (Genki Academy).</span>
              <span>
                {lang === 'ja'
                  ? '確かな日本語教育と、きめ細かな学生指導のために。'
                  : 'Pendidikan Bahasa Jepang terstruktur untuk persiapan kerja ke Jepang.'}
              </span>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // Waiting for Profile Load
  if (!profile) {
    return <SkeletonLoadingShell />;
  }

  // Post-Login Onboarding: Upload Photo from Phone/Laptop + Full Name + Nickname
  if (profile.profileCompleted === false) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-black flex flex-col items-center justify-center p-4 sm:p-6 gap-4">
        <ProfileSetupModal lang={lang} profile={profile} mode="onboarding" />
      </div>
    );
  }

  const shownName = profile.nickname || profile.displayName;
  const avatarInitials = shownName.trim().slice(0, 2).toUpperCase();

  if (profile.status === 'pending' || profile.status === 'disabled') {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-black flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] rounded-[24px] p-7 space-y-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-[#1d1d1f] dark:bg-[#2c2c2e] text-white flex items-center justify-center font-semibold shrink-0">
              {profile.avatarDataUrl ? (
                <img
                  src={profile.avatarDataUrl}
                  alt={shownName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{avatarInitials}</span>
              )}
            </div>
            <div>
              <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]">
                {profile.status === 'pending'
                  ? tr(UI_TEXT.pendingTitle, lang)
                  : tr(UI_TEXT.disabledTitle, lang)}
              </h1>
              <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">元気アカデミー</div>
            </div>
          </div>

          <p className="text-[15px] text-[#6e6e73] dark:text-[#86868b] leading-relaxed">
            {profile.status === 'pending'
              ? tr(UI_TEXT.pendingDesc, lang)
              : '管理者によってアカウントが停止されています。/ Akun Anda dinonaktifkan oleh Kepala Sekolah.'}
          </p>

          <div className="text-[13px] font-mono text-[#1d1d1f] dark:text-[#f5f5f7] bg-[#f5f5f7] dark:bg-[#2c2c2e] p-3.5 rounded-[14px] space-y-0.5">
            <div className="font-semibold">{shownName}</div>
            {profile.fullName && profile.fullName !== shownName && (
              <div className="text-[#6e6e73] dark:text-[#86868b]">{profile.fullName}</div>
            )}
            <div className="text-[#6e6e73] dark:text-[#86868b]">{user.email}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => setShowEditProfile(true)}
              className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
            >
              <UserCog className="w-3.5 h-3.5" />
              <span>{lang === 'id' ? 'Edit Profil' : 'プロフィール編集'}</span>
            </button>
            <button
              type="button"
              onClick={signOutUser}
              className="apple-btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-[13px]"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{tr(UI_TEXT.signOut, lang)}</span>
            </button>
          </div>
        </div>

        {showEditProfile && (
          <ProfileSetupModal
            lang={lang}
            profile={profile}
            mode="edit"
            onClose={() => setShowEditProfile(false)}
          />
        )}
      </div>
    );
  }

  const isOverviewPage = activeTab === 'dashboard' || activeTab === 'monitoring';

  const localNavTitle = (() => {
    if (activeTab === 'dashboard') return lang === 'id' ? 'Dashboard' : '統括ダッシュボード';
    if (activeTab === 'monitoring') return tr(UI_TEXT.navMonitoring, lang);
    if (activeTab === 'report') return tr(UI_TEXT.navReportHub, lang);
    if (activeTab === 'bank') return tr(UI_TEXT.navQuestionBank, lang);
    if (activeTab === 'grading') return tr(UI_TEXT.navGrading, lang);
    if (activeTab === 'roster') return tr(UI_TEXT.navRoster, lang);
    if (activeTab === 'schedule')
      return profile.role === 'teacher'
        ? '私のスケジュール'
        : lang === 'id'
        ? 'Jadwal Sekolah'
        : 'スケジュール管理';
    if (activeTab === 'journal') return tr(UI_TEXT.navHeadJournal, lang);
    return tr(UI_TEXT.navUsers, lang);
  })();

  const localNavActions = (
    <div className="flex items-center gap-2 shrink-0">
      {activeTab === 'report' && (
        <div className="inline-flex items-center p-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/70 dark:border-[#424245]">
          <button
            type="button"
            onClick={() => runViewTransition(() => setReportSubTab('daily'))}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-full transition-colors ${
              reportSubTab === 'daily'
                ? 'bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-2xs'
                : 'text-[#6e6e73] dark:text-[#86868b]'
            }`}
          >
            <span>{tr(UI_TEXT.navDailyReport, lang)}</span>
            {unreadDailyCount > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-[#0071e3] text-white rounded-full tabular-nums">
                {unreadDailyCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => runViewTransition(() => setReportSubTab('weekly'))}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-full transition-colors ${
              reportSubTab === 'weekly'
                ? 'bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-2xs'
                : 'text-[#6e6e73] dark:text-[#86868b]'
            }`}
          >
            <span>{tr(UI_TEXT.navWeeklyReport, lang)}</span>
            {unreadWeeklyCount > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-[#0071e3] text-white rounded-full tabular-nums">
                {unreadWeeklyCount}
              </span>
            )}
          </button>
        </div>
      )}

      {profile.role === 'head' && activeTab !== 'schedule' && (
        <button
          type="button"
          onClick={() => navigateTab('schedule')}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-[#0066cc] dark:text-[#2997ff] hover:underline whitespace-nowrap"
        >
          <span>{lang === 'id' ? 'Jadwal Sekolah' : 'スケジュール'}</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}

      {profile.role === 'teacher' && activeTab !== 'report' && (
        <button
          type="button"
          onClick={() => navigateTab('report', { reportSubTab: 'daily' })}
          className="apple-btn-primary inline-flex items-center gap-1 px-3.5 py-1.5 text-[12px] whitespace-nowrap"
        >
          <span>{lang === 'id' ? 'Isi Laporan' : '日報を記入'}</span>
        </button>
      )}
    </div>
  );

  return (
    <>
      <div
        className={`min-h-screen flex flex-col no-print ${
          isOverviewPage ? 'bg-[#f5f5f7] dark:bg-black' : 'bg-white dark:bg-black'
        } text-[#1d1d1f] dark:text-[#f5f5f7]`}
        onTouchStart={(e) => {
          if (tabHistory.length > 0 && e.touches.length === 1 && e.touches[0].clientX <= 22) {
            edgeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          } else {
            edgeStartRef.current = null;
          }
        }}
        onTouchMove={(e) => {
          if (!edgeStartRef.current || e.touches.length !== 1) return;
          const dx = e.touches[0].clientX - edgeStartRef.current.x;
          const dy = Math.abs(e.touches[0].clientY - edgeStartRef.current.y);
          if (dx > 0 && dy < 48) {
            setEdgeSwipeX(Math.min(140, dx));
          }
        }}
        onTouchEnd={() => {
          if (edgeSwipeX > 72) {
            navigateBack();
          }
          edgeStartRef.current = null;
          setEdgeSwipeX(0);
        }}
      >
        <OfflineBanner lang={lang} />

        {/* Apple.com 44px Global Nav + Hover/Keyboard Full-Width Mega Menu */}
        <AppleGlobalNav
          lang={lang}
          onChangeLang={setLang}
          theme={theme}
          onChangeTheme={setTheme}
          profile={profile}
          activeTab={activeTab}
          totalUnreadFeedback={totalUnreadFeedback}
          pendingQuestionsCount={pendingQuestionsCount}
          onNavigate={navigateTab}
          onOpenSearch={() => setShowSearchPalette(true)}
          onOpenProfile={() => setShowEditProfile(true)}
          onSignOut={signOutUser}
        />

        {/* Local Nav Bar: scrolls with page on overview views, scroll-up sticky on data-dense views */}
        <AppleLocalNav
          title={localNavTitle}
          subtitle={
            activeTab === 'dashboard'
              ? `${shownName} · ${getTodayDateStr()}`
              : undefined
          }
          actions={localNavActions}
          stickyMode={isOverviewPage ? 'none' : 'scroll-up'}
        />

        {/* Centered Main Content Viewport (980-1200px for overview, up to 1400px for data-dense tables) */}
        <PullToRefreshContainer onRefresh={() => setRefreshPulse((n) => n + 1)}>
          <main
            style={
              !shouldReduce && edgeSwipeX > 0
                ? { transform: `translate3d(${Math.round(edgeSwipeX * 0.45)}px, 0, 0)` }
                : undefined
            }
            className={`flex-1 w-full mx-auto px-4 sm:px-6 ${
              isOverviewPage ? 'max-w-[1200px] py-8 sm:py-10 space-y-8' : 'max-w-[1400px] py-6 space-y-6'
            }`}
          >
            {/* Compact Announcements Banner for Sensei */}
            {profile.role === 'teacher' && (
              <AnnouncementsPanel
                lang={lang}
                profile={profile}
                announcements={announcements}
                announcementReads={announcementReads}
                staffUsers={staffUsers}
                compact
              />
            )}

            {/* Unread Head Feedback Notice for Sensei */}
            {profile.role === 'teacher' && totalUnreadFeedback > 0 && (
              <div className="bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] rounded-[16px] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                <div className="flex items-center gap-2 text-[#1d1d1f] dark:text-[#f5f5f7]">
                  <MessageSquare className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff] shrink-0" />
                  <span>
                    {lang === 'id'
                      ? `Ada ${totalUnreadFeedback} komentar baru dari Kepala Sekolah pada laporan Anda.`
                      : `校長からの新しいコメントが ${totalUnreadFeedback} 件あります。`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    navigateTab('report', {
                      reportSubTab: unreadDailyCount > 0 ? 'daily' : 'weekly',
                    })
                  }
                  className="apple-btn-primary px-3.5 py-1.5 text-[12px] whitespace-nowrap shrink-0"
                >
                  {lang === 'id' ? 'Lihat Komentar' : 'コメントを確認'}
                </button>
              </div>
            )}

            {/* Gentle In-App Daily Report Reminder for Sensei */}
            {senseiMissingReportToday && (activeTab !== 'report' || reportSubTab !== 'daily') && (
              <div className="bg-[#f5f5f7] dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] rounded-[16px] px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                <div className="flex items-center gap-2 text-[#1d1d1f] dark:text-[#f5f5f7]">
                  <Clock className="w-4 h-4 text-[#d97706] shrink-0" />
                  <span>
                    {lang === 'id'
                      ? `Halo ${shownName}, laporan harian (${getTodayDateStr()}) belum dikirim hari ini.`
                      : `${shownName}先生、本日（${getTodayDateStr()}）の日報がまだ提出されていません。`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigateTab('report', { reportSubTab: 'daily' })}
                  className="apple-btn-secondary px-3.5 py-1.5 text-[12px] whitespace-nowrap shrink-0"
                >
                  {lang === 'id' ? 'Isi Laporan Sekarang' : '日報を記入する'}
                </button>
              </div>
            )}

            <motion.div
              key={`${activeTab}-${refreshPulse}`}
              initial={shouldReduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, ease: APPLE_EASE }}
            >
              {activeTab === 'dashboard' && profile.role === 'head' && (
                <HeadDashboard
                  lang={lang}
                  profile={profile}
                  students={students}
                  reports={reports}
                  weeklyReports={weeklyReports}
                  testResults={testResults}
                  questions={questions}
                  staffUsers={staffUsers}
                  announcements={announcements}
                  announcementReads={announcementReads}
                  thresholds={thresholds}
                  handledAlerts={handledAlerts}
                  scheduleDoc={scheduleDoc}
                  onNavigateTab={(tab) => navigateTab(tab)}
                  onOpenPendingQuestions={() =>
                    navigateTab('bank', { bankPending: true })
                  }
                  onSelectStudent={(stu) => setSelectedProfileStudent(stu)}
                  onRegisterPrintView={(node) => setPrintNode(node)}
                />
              )}

              {activeTab === 'monitoring' && profile.role === 'head' && (
                <SenseiMonitoringView
                  lang={lang}
                  staffUsers={staffUsers}
                  students={students}
                  reports={reports}
                  weeklyReports={weeklyReports}
                  testResults={testResults}
                  questions={questions}
                  scheduleDoc={scheduleDoc}
                  thresholds={thresholds}
                />
              )}

              {activeTab === 'report' && (
                <div className="space-y-4">
                  {reportSubTab === 'daily' ? (
                    <DailyReportForm
                      lang={lang}
                      profile={profile}
                      students={students}
                      reports={reports}
                    />
                  ) : (
                    <WeeklyReportView
                      lang={lang}
                      profile={profile}
                      students={students}
                      weeklyReports={weeklyReports}
                      testResults={testResults}
                      onSelectStudent={(stu) => setSelectedProfileStudent(stu)}
                    />
                  )}
                </div>
              )}

              {activeTab === 'bank' && (
                <QuestionBankManager
                  lang={lang}
                  profile={profile}
                  questions={questions}
                  testSheets={testSheets}
                  initialReviewFilter={bankReviewFilter}
                  onStartGradingSheet={(sheetId) => {
                    setGradingSheetId(sheetId);
                    navigateTab('grading');
                  }}
                  onRegisterPrintView={(node) => setPrintNode(node)}
                />
              )}

              {activeTab === 'grading' && (
                <TestGradingView
                  lang={lang}
                  profile={profile}
                  students={students}
                  questions={questions}
                  testSheets={testSheets}
                  testResults={testResults}
                  initialSheetId={gradingSheetId}
                  onSelectStudent={(stu) => setSelectedProfileStudent(stu)}
                  onRegisterPrintView={(node) => setPrintNode(node)}
                />
              )}

              {activeTab === 'roster' && (
                <RosterAndStaff
                  lang={lang}
                  profile={profile}
                  students={students}
                  onSelectStudent={(stu) => setSelectedProfileStudent(stu)}
                  onOpenUsersPage={
                    profile.role === 'head' ? () => navigateTab('users') : undefined
                  }
                />
              )}

              {activeTab === 'schedule' && (
                <ScheduleWorkspace
                  lang={lang}
                  profile={profile}
                  scheduleDoc={scheduleDoc}
                  staffUsers={staffUsers}
                  staffInvites={staffInvites}
                  onRegisterPrintView={(node) => setPrintNode(node)}
                />
              )}

              {activeTab === 'journal' && profile.role === 'head' && (
                <HeadJournalView
                  lang={lang}
                  profile={profile}
                  entries={headJournal}
                  students={students}
                  staffUsers={staffUsers}
                  onRegisterPrintView={(node) => setPrintNode(node)}
                />
              )}

              {activeTab === 'users' && profile.role === 'head' && (
                <UsersRolesView
                  lang={lang}
                  profile={profile}
                  staffUsers={staffUsers}
                  staffInvites={staffInvites}
                  activityLogs={activityLogs}
                />
              )}
            </motion.div>
          </main>
        </PullToRefreshContainer>

        {/* Apple-style Minimalist Footer */}
        <AppleFooter lang={lang} profile={profile} onNavigate={navigateTab} />
      </div>

      {/* Student Profile Modal (Weekly Exam Primary + Daily Secondary + Attitude + Coaching Notes) */}
      {selectedProfileStudent && profile && (
        <StudentProfileModal
          student={selectedProfileStudent}
          lang={lang}
          profile={profile}
          reports={reports}
          weeklyReports={weeklyReports}
          testResults={testResults}
          studentNotes={studentNotes}
          scheduleRows={scheduleDoc?.rows || []}
          thresholds={thresholds}
          handledAlerts={handledAlerts}
          onClose={() => setSelectedProfileStudent(null)}
        />
      )}

      {/* Command Palette Search (Cmd/Ctrl+K) */}
      {profile && profile.status === 'active' && (
        <CommandPaletteModal
          open={showSearchPalette}
          lang={lang}
          profile={profile}
          students={students}
          staffUsers={staffUsers}
          onClose={() => setShowSearchPalette(false)}
          onSelect={handleSearchSelect}
        />
      )}

      {/* Edit Profile Modal */}
      {showEditProfile && profile && (
        <ProfileSetupModal
          lang={lang}
          profile={profile}
          mode="edit"
          onClose={() => setShowEditProfile(false)}
        />
      )}

      {/* Dedicated A4 Print Container */}
      {printNode && <div className="hidden print:block">{printNode}</div>}
    </>
  );
}
