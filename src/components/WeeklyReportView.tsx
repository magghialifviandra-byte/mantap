import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileCheck2,
  MessageSquare,
  Save,
  Send,
  Star,
} from 'lucide-react';
import { motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { classLabel } from '../i18n';
import {
  ClassId,
  CLASSES,
  LanguageMode,
  Student,
  TestResult,
  UserProfile,
  WeeklyReport,
  WeeklyStudentEntry,
} from '../types';
import { logActivity } from '../utils/activityLog';
import {
  getRecentWeekKeys,
  getWeekEndDateStr,
  getWeeklyReportCompliance,
} from '../utils/analyticsUtils';
import { CLASS_THEMES, getClassTheme } from '../utils/classTheme';
import { getTodayDateStr, getWeekKey } from '../utils/dateUtils';
import { clampArray, clampNum, clampStr, sanitizeWeekKey } from '../utils/payloadGuards';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  students: Student[];
  weeklyReports: WeeklyReport[];
  testResults: TestResult[];
  onSelectStudent?: (stu: Student) => void;
}

const DEFAULT_SUB = 4;

export function WeeklyReportView({
  lang,
  profile,
  students,
  weeklyReports,
  testResults,
  onSelectStudent,
}: Props) {
  const isHead = profile.role === 'head';
  const currentWeek = getWeekKey(getTodayDateStr());
  const defaultClass: ClassId =
    profile.assignedClasses.length > 0 ? profile.assignedClasses[0] : 'hokkaido';

  const [selectedWeek, setSelectedWeek] = useState<string>(currentWeek);
  const [selectedClass, setSelectedClass] = useState<ClassId>(defaultClass);

  // Weekly narrative fields
  const [summaryTaught, setSummaryTaught] = useState('');
  const [classProgress, setClassProgress] = useState('');
  const [issues, setIssues] = useState('');
  const [nextWeekPlan, setNextWeekPlan] = useState('');

  // Per-student entries state (progress, comment, attitude + sub-scores) + inline weekly exam score drafts
  const [entriesMap, setEntriesMap] = useState<Record<string, WeeklyStudentEntry>>({});
  const [examScoreDrafts, setExamScoreDrafts] = useState<Record<string, string>>({});
  const [expandedAttitudeStudent, setExpandedAttitudeStudent] = useState<string | null>(null);

  // Admin list filters & feedback drafts
  const [filterClass, setFilterClass] = useState<ClassId | 'all'>('all');
  const [filterSensei, setFilterSensei] = useState<string>('all');
  const [filterWeek, setFilterWeek] = useState<string>('all');
  const [headCommentDrafts, setHeadCommentDrafts] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const weekOptions = useMemo(() => {
    const recent = getRecentWeekKeys(8);
    const fromData = weeklyReports.map((w) => w.weekKey);
    return Array.from(new Set([...recent, ...fromData, currentWeek])).sort((a, b) =>
      b.localeCompare(a)
    );
  }, [weeklyReports, currentWeek]);

  const classStudents = useMemo(
    () =>
      students
        .filter((s) => s.classId === selectedClass && s.active)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [students, selectedClass]
  );

  // Existing report for selectedClass + selectedWeek (owned by current user or any teacher if head)
  const existingReport = useMemo(() => {
    const mine = weeklyReports.find(
      (r) =>
        r.classId === selectedClass &&
        r.weekKey === selectedWeek &&
        r.teacherUid === profile.uid
    );
    if (mine) return mine;
    if (isHead) {
      return (
        weeklyReports.find(
          (r) => r.classId === selectedClass && r.weekKey === selectedWeek
        ) || null
      );
    }
    return null;
  }, [weeklyReports, selectedClass, selectedWeek, profile.uid, isHead]);

  // Official weekly exam score map for selectedClass + selectedWeek from /testResults (Single Source of Truth)
  const officialExamByStudent = useMemo(() => {
    const map = new Map<string, TestResult>();
    testResults
      .filter(
        (r) =>
          r.testType === 'weekly' &&
          r.classId === selectedClass &&
          r.weekKey === selectedWeek
      )
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((r) => {
        if (!map.has(r.studentId)) map.set(r.studentId, r);
      });
    return map;
  }, [testResults, selectedClass, selectedWeek]);

  // Hydrate editor whenever selectedClass, selectedWeek, or existingReport changes
  useEffect(() => {
    if (existingReport) {
      setSummaryTaught(existingReport.summaryTaught || '');
      setClassProgress(existingReport.classProgress || '');
      setIssues(existingReport.issues || '');
      setNextWeekPlan(existingReport.nextWeekPlan || '');
    } else {
      setSummaryTaught('');
      setClassProgress('');
      setIssues('');
      setNextWeekPlan('');
    }

    const nextEntries: Record<string, WeeklyStudentEntry> = {};
    const nextScores: Record<string, string> = {};
    classStudents.forEach((stu) => {
      const prevEntry = existingReport?.studentEntries?.find((se) => se.studentId === stu.id);
      nextEntries[stu.id] = {
        studentId: stu.id,
        studentName: stu.name,
        progressNote: prevEntry?.progressNote || '',
        comment: prevEntry?.comment || '',
        attitudeScore: prevEntry?.attitudeScore || DEFAULT_SUB,
        subAttendance: prevEntry?.subAttendance ?? DEFAULT_SUB,
        subDiscipline: prevEntry?.subDiscipline ?? DEFAULT_SUB,
        subEffort: prevEntry?.subEffort ?? DEFAULT_SUB,
        subCooperation: prevEntry?.subCooperation ?? DEFAULT_SUB,
        attitudeNote: prevEntry?.attitudeNote || '',
      };
      const existingExam = officialExamByStudent.get(stu.id);
      nextScores[stu.id] = existingExam ? String(existingExam.scorePercent) : '';
    });
    setEntriesMap(nextEntries);
    setExamScoreDrafts(nextScores);
  }, [existingReport?.id, selectedClass, selectedWeek, classStudents.length, officialExamByStudent]);

  const updateStudentEntry = (studentId: string, patch: Partial<WeeklyStudentEntry>) => {
    setEntriesMap((prev) => {
      const base = prev[studentId] || {
        studentId,
        studentName: classStudents.find((s) => s.id === studentId)?.name || '',
        progressNote: '',
        comment: '',
        attitudeScore: DEFAULT_SUB,
        subAttendance: DEFAULT_SUB,
        subDiscipline: DEFAULT_SUB,
        subEffort: DEFAULT_SUB,
        subCooperation: DEFAULT_SUB,
        attitudeNote: '',
      };
      const updated = { ...base, ...patch };
      if (
        patch.subAttendance !== undefined ||
        patch.subDiscipline !== undefined ||
        patch.subEffort !== undefined ||
        patch.subCooperation !== undefined
      ) {
        const avg = Number(
          (
            ((updated.subAttendance ?? 4) +
              (updated.subDiscipline ?? 4) +
              (updated.subEffort ?? 4) +
              (updated.subCooperation ?? 4)) /
            4
          ).toFixed(1)
        );
        updated.attitudeScore = Math.max(1, Math.min(5, Math.round(avg)));
      }
      return { ...prev, [studentId]: updated };
    });
  };

  // Sync changed inline Weekly Exam Scores directly to /testResults (no double entry!)
  const syncWeeklyExamScoresToTestResults = async (): Promise<number> => {
    let syncedCount = 0;
    const weekDate = getWeekEndDateStr(selectedWeek);
    const graderName = clampStr(profile.nickname || profile.displayName, 100) || 'Sensei';

    for (const stu of classStudents) {
      const raw = (examScoreDrafts[stu.id] ?? '').trim();
      if (raw === '') continue;
      const numeric = Number(raw);
      if (Number.isNaN(numeric)) continue;
      const cleanScore = clampNum(numeric, 0, 100);
      const existing = officialExamByStudent.get(stu.id);

      if (existing) {
        if (existing.scorePercent !== cleanScore) {
          await updateDoc(doc(db, 'testResults', existing.id), {
            earnedScore: cleanScore,
            maxScore: 100,
            scorePercent: cleanScore,
            gradedBy: profile.uid,
            gradedByName: graderName,
            updatedAt: serverTimestamp(),
          });
          await logActivity({
            actor: profile,
            actionType: 'data_update',
            targetType: 'testResult',
            targetLabel: `${stu.name} (${selectedWeek})`,
            detail: `Updated weekly exam score from Weekly Report: ${existing.scorePercent}% → ${cleanScore}%`,
          });
          syncedCount += 1;
        }
      } else {
        await addDoc(collection(db, 'testResults'), {
          studentId: stu.id,
          studentName: clampStr(stu.name, 120),
          classId: selectedClass,
          testType: 'weekly',
          date: weekDate,
          weekKey: sanitizeWeekKey(selectedWeek, currentWeek),
          sheetId: '',
          testTitle: `週次試験 / Ujian Mingguan (${selectedWeek})`,
          category: 'jlpt_jft',
          entryMode: 'manual',
          earnedScore: cleanScore,
          maxScore: 100,
          scorePercent: cleanScore,
          questionOutcomes: [],
          wrongCategories: [],
          note: '',
          gradedBy: profile.uid,
          gradedByName: graderName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logActivity({
          actor: profile,
          actionType: 'data_create',
          targetType: 'testResult',
          targetLabel: `${stu.name} (${selectedWeek})`,
          detail: `Entered weekly exam score via Weekly Report: ${cleanScore}%`,
        });
        syncedCount += 1;
      }
    }
    return syncedCount;
  };

  const handleSaveReport = async (nextStatus: 'draft' | 'submitted') => {
    const cleanSummary = clampStr(summaryTaught, 2000);
    if (nextStatus === 'submitted' && !cleanSummary) {
      showToast(
        lang === 'id'
          ? 'Mohon isi Ringkasan Materi yang Diajarkan sebelum kirim.'
          : '提出前に「今週の指導内容サマリー」をご入力ください。'
      );
      return;
    }

    setBusy(true);
    const cleanWeek = sanitizeWeekKey(selectedWeek, currentWeek);
    const ownerUid = existingReport ? existingReport.teacherUid : profile.uid;
    const ownerName = existingReport
      ? existingReport.teacherName
      : clampStr(profile.nickname || profile.displayName, 100) || 'Sensei';
    const reportId = existingReport?.id || `${cleanWeek}_${selectedClass}_${ownerUid}`;
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');

    const entriesList: WeeklyStudentEntry[] = classStudents.map((stu) => {
      const e = entriesMap[stu.id];
      return {
        studentId: stu.id,
        studentName: clampStr(stu.name, 120),
        progressNote: clampStr(e?.progressNote || '', 300),
        comment: clampStr(e?.comment || '', 400),
        attitudeScore: clampNum(e?.attitudeScore ?? DEFAULT_SUB, 1, 5),
        subAttendance: clampNum(e?.subAttendance ?? DEFAULT_SUB, 1, 5),
        subDiscipline: clampNum(e?.subDiscipline ?? DEFAULT_SUB, 1, 5),
        subEffort: clampNum(e?.subEffort ?? DEFAULT_SUB, 1, 5),
        subCooperation: clampNum(e?.subCooperation ?? DEFAULT_SUB, 1, 5),
        attitudeNote: clampStr(e?.attitudeNote || '', 300),
      };
    });

    try {
      const syncedScores = await syncWeeklyExamScoresToTestResults();

      const payload = {
        weekKey: cleanWeek,
        classId: selectedClass,
        teacherUid: ownerUid,
        teacherName: ownerName,
        status: nextStatus,
        submittedAt:
          nextStatus === 'submitted'
            ? existingReport?.submittedAt || nowStr
            : existingReport?.submittedAt || '',
        summaryTaught: cleanSummary,
        classProgress: clampStr(classProgress, 2000),
        issues: clampStr(issues, 1500),
        nextWeekPlan: clampStr(nextWeekPlan, 1500),
        studentEntries: clampArray(entriesList, 80),
        headComment: existingReport?.headComment || '',
        headCommentBy: existingReport?.headCommentBy || '',
        headCommentAt: existingReport?.headCommentAt || '',
        commentReadByTeacher: existingReport?.commentReadByTeacher ?? true,
        updatedAt: serverTimestamp(),
      };

      if (existingReport) {
        await updateDoc(doc(db, 'weeklyReports', reportId), payload);
      } else {
        await setDoc(doc(db, 'weeklyReports', reportId), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      if (nextStatus === 'submitted') {
        await logActivity({
          actor: profile,
          actionType: 'weekly_report_submit',
          targetType: 'weeklyReport',
          targetLabel: `${selectedClass} (${cleanWeek})`,
          detail: `Submitted weekly report (${entriesList.length} students${
            syncedScores > 0 ? `, ${syncedScores} exam scores synced` : ''
          })`,
        });
      }

      showToast(
        nextStatus === 'submitted'
          ? lang === 'id'
            ? `Laporan Mingguan ${cleanWeek} berhasil dikirim!${
                syncedScores > 0 ? ` (${syncedScores} nilai ujian tersinkron)` : ''
              }`
            : `週報 (${cleanWeek}) を提出しました${
                syncedScores > 0 ? `（週次テスト ${syncedScores}名分を同期）` : ''
              }`
          : lang === 'id'
          ? `Draft Laporan Mingguan ${cleanWeek} disimpan`
          : `週報 (${cleanWeek}) を下書き保存しました`
      );
    } catch (err) {
      handleFirestoreError(
        err,
        existingReport ? OperationType.UPDATE : OperationType.CREATE,
        `weeklyReports/${reportId}`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveHeadComment = async (wr: WeeklyReport) => {
    if (!isHead) return;
    const draft = clampStr(
      headCommentDrafts[wr.id] !== undefined ? headCommentDrafts[wr.id] : wr.headComment || '',
      1500
    );
    setBusy(true);
    const nowStr = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const headName = clampStr(profile.nickname || profile.displayName, 100) || 'Admin';
    try {
      await updateDoc(doc(db, 'weeklyReports', wr.id), {
        headComment: draft,
        headCommentBy: headName,
        headCommentAt: nowStr,
        commentReadByTeacher: false,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'weeklyReport',
        targetLabel: `${wr.classId} (${wr.weekKey})`,
        detail: `Admin commented on weekly report by ${wr.teacherName}`,
      });
      showToast(lang === 'id' ? 'Komentar disimpan & dikirim ke Sensei' : 'コメントを保存しました');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `weeklyReports/${wr.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleMarkCommentRead = async (wr: WeeklyReport) => {
    try {
      await updateDoc(doc(db, 'weeklyReports', wr.id), {
        commentReadByTeacher: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `weeklyReports/${wr.id}`);
    }
  };

  const senseiNames = useMemo(() => {
    const map = new Map<string, string>();
    weeklyReports.forEach((r) => map.set(r.teacherUid, r.teacherName));
    return Array.from(map.entries());
  }, [weeklyReports]);

  const visibleReports = useMemo(() => {
    return [...weeklyReports]
      .filter((r) => (isHead ? true : r.teacherUid === profile.uid))
      .filter((r) => (filterClass === 'all' ? true : r.classId === filterClass))
      .filter((r) => (filterWeek === 'all' ? true : r.weekKey === filterWeek))
      .filter((r) => (filterSensei === 'all' ? true : r.teacherUid === filterSensei))
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey) || a.classId.localeCompare(b.classId));
  }, [weeklyReports, isHead, profile.uid, filterClass, filterWeek, filterSensei]);

  // Sensei weekly due status across assigned classes
  const senseiMissingCurrentWeek = useMemo(() => {
    if (isHead) return [];
    const targetClasses =
      profile.assignedClasses.length > 0 ? profile.assignedClasses : CLASSES.map((c) => c.id);
    return targetClasses.filter(
      (cid) =>
        !weeklyReports.some(
          (r) =>
            r.classId === cid &&
            r.weekKey === currentWeek &&
            r.teacherUid === profile.uid &&
            r.status === 'submitted'
        )
    );
  }, [isHead, profile.assignedClasses, profile.uid, weeklyReports, currentWeek]);

  const activeTheme = getClassTheme(selectedClass);

  return (
    <div className="space-y-6">
      <LiquidToast message={toast} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {lang === 'id'
              ? 'Laporan Mingguan & Penilaian Sikap'
              : '週報（週次報告書）・学習態度評価'}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'id'
              ? 'Satu laporan per kelas per minggu. Nilai Ujian Mingguan tersinkron langsung dengan data nilai resmi.'
              : '週次テスト成績（自動同期）と学習態度（1〜5）をまとめて報告できます。'}
          </p>
        </div>
        {activeTheme && (
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-medium bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7]">
            <span className={`w-2 h-2 rounded-full ${activeTheme.dotColor}`} />
            <span>
              {classLabel(selectedClass, lang)} · {selectedWeek}
            </span>
          </div>
        )}
      </div>

      {/* Sensei Weekly Due Reminder */}
      {!isHead && senseiMissingCurrentWeek.length > 0 && (
        <div className="rounded-[16px] px-4 py-3 border border-amber-500/30 bg-amber-500/8 flex flex-wrap items-center justify-between gap-3 text-[12px]">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
            <Clock className="w-4 h-4 shrink-0" />
            <span>
              {lang === 'id'
                ? `Pengingat Minggu ${currentWeek}: Laporan mingguan belum dikirim untuk ${senseiMissingCurrentWeek
                    .map((cid) => classLabel(cid, lang))
                    .join(', ')}.`
                : `今週（${currentWeek}）の週報が未提出です：${senseiMissingCurrentWeek
                    .map((cid) => classLabel(cid, lang))
                    .join('・')}`}
            </span>
          </div>
        </div>
      )}

      {/* Editor Form */}
      <div className="apple-tile p-5 sm:p-6 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-6 relative">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'id' ? 'Minggu (ISO)' : '対象週'}
              </label>
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(e.target.value)}
                className="glass-input px-3.5 py-2 text-[13px] font-mono rounded-[12px]"
              >
                {weekOptions.map((wk) => (
                  <option key={wk} value={wk}>
                    {wk} {wk === currentWeek ? (lang === 'id' ? '(Minggu Ini)' : '(今週)') : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'id' ? 'Kelas' : 'クラス'}
              </label>
              <select
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value as ClassId)}
                className="glass-input px-3.5 py-2 text-[13px] rounded-[12px]"
              >
                {CLASSES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {classLabel(c.id, lang)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-[12px]">
            {existingReport ? (
              (() => {
                const comp = getWeeklyReportCompliance(existingReport);
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-medium ${
                      comp === 'submitted'
                        ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                        : comp === 'late'
                        ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]'
                    }`}
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    <span>
                      {comp === 'submitted'
                        ? lang === 'id'
                          ? 'Sudah Dikirim'
                          : '提出済'
                        : comp === 'late'
                        ? lang === 'id'
                          ? 'Dikirim Terlambat'
                          : '遅延提出'
                        : lang === 'id'
                        ? 'Draft Tersimpan'
                        : '下書き'}
                    </span>
                  </span>
                );
              })()
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-medium bg-[#dc2626]/10 text-[#dc2626] dark:text-[#ff453a]">
                <Clock className="w-3.5 h-3.5" />
                <span>{lang === 'id' ? 'Belum Dibuat' : '未提出'}</span>
              </span>
            )}
          </div>
        </div>

        {/* Narrative Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60">
          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'id'
                ? '1. Materi / Bab / Halaman yang Diajarkan Minggu Ini *'
                : '1. 今週の指導内容サマリー（課・ページ・トピック）*'}
            </label>
            <textarea
              rows={3}
              maxLength={2000}
              value={summaryTaught}
              onChange={(e) => setSummaryTaught(e.target.value)}
              placeholder={
                lang === 'id'
                  ? 'Contoh: Minna no Nihongo Bab 8-9 (hal 64-78), latihan kaiwa & kanji 20 huruf'
                  : '例：みんなの日本語 第8〜9課 (p.64-78)、助詞テスト、会話ロールプレイ'
              }
              className="w-full glass-input px-3.5 py-2.5 text-[14px] rounded-[12px]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'id'
                ? '2. Perkembangan & Pencapaian Kelas Secara Umum'
                : '2. クラス全体の進捗・習得状況'}
            </label>
            <textarea
              rows={3}
              maxLength={2000}
              value={classProgress}
              onChange={(e) => setClassProgress(e.target.value)}
              placeholder={
                lang === 'id'
                  ? 'Bagaimana respon dan pemahaman siswa secara keseluruhan minggu ini...'
                  : 'クラス全体の理解度・定着状況をご記入ください...'
              }
              className="w-full glass-input px-3.5 py-2.5 text-[14px] rounded-[12px]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'id'
                ? '3. Kendala / Siswa yang Butuh Perhatian'
                : '3. 課題・フォローが必要な事項'}
            </label>
            <textarea
              rows={2}
              maxLength={1500}
              value={issues}
              onChange={(e) => setIssues(e.target.value)}
              placeholder={
                lang === 'id'
                  ? 'Kesulitan materi, kehadiran, atau disiplin...'
                  : '授業運営上の課題や欠席・態度の注意点など'
              }
              className="w-full glass-input px-3.5 py-2.5 text-[14px] rounded-[12px]"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1.5">
              {lang === 'id' ? '4. Rencana Minggu Depan' : '4. 来週の指導予定'}
            </label>
            <textarea
              rows={2}
              maxLength={1500}
              value={nextWeekPlan}
              onChange={(e) => setNextWeekPlan(e.target.value)}
              placeholder={
                lang === 'id'
                  ? 'Target bab & jadwal evaluasi minggu depan...'
                  : '次週の教材範囲・試験計画など'
              }
              className="w-full glass-input px-3.5 py-2.5 text-[14px] rounded-[12px]"
            />
          </div>
        </div>

        {/* Per-Student Table */}
        <div className="space-y-3 pt-5 border-t border-[#d2d2d7]/60 dark:border-[#424245]/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id'
                  ? 'Evaluasi Siswa: Nilai Ujian Mingguan (Resmi) & Sikap (1–5)'
                  : '学生別評価：週次試験成績（公式）＆ 学習態度（1〜5）'}
              </h2>
              <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'id'
                  ? 'Nilai Ujian Mingguan tersinkron otomatis dengan Input Nilai — tidak perlu input dua kali.'
                  : '週次試験の点数は採点画面と自動連携（二重入力不要）。変更時は自動保存されます。'}
              </p>
            </div>
            <span className="text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
              {classStudents.length} {lang === 'id' ? 'siswa' : '名'}
            </span>
          </div>

          {classStudents.length === 0 ? (
            <EmptyStateIllustration
              kind="users"
              title={
                lang === 'id'
                  ? 'Belum ada siswa aktif di kelas ini.'
                  : 'このクラスに在籍中の学生がまだいません。'
              }
            />
          ) : (
            <div className="space-y-2">
              {classStudents.map((stu) => {
                const entry = entriesMap[stu.id] || {
                  studentId: stu.id,
                  studentName: stu.name,
                  progressNote: '',
                  comment: '',
                  attitudeScore: DEFAULT_SUB,
                  subAttendance: DEFAULT_SUB,
                  subDiscipline: DEFAULT_SUB,
                  subEffort: DEFAULT_SUB,
                  subCooperation: DEFAULT_SUB,
                  attitudeNote: '',
                };
                const isExpanded = expandedAttitudeStudent === stu.id;
                const scoreVal = examScoreDrafts[stu.id] ?? '';
                const numericScore = scoreVal !== '' ? Number(scoreVal) : null;

                return (
                  <div
                    key={stu.id}
                    className="apple-virtual-item bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245]/60 rounded-[14px] px-3.5 py-2.5 space-y-2.5"
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-center">
                      <div className="lg:col-span-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectStudent?.(stu)}
                          className={`text-[13px] font-semibold text-left truncate ${
                            onSelectStudent
                              ? 'text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0066cc] dark:hover:text-[#2997ff] hover:underline underline-offset-2'
                              : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                          }`}
                        >
                          {stu.name}
                        </button>
                        {stu.studentCode && (
                          <span className="text-[11px] font-mono tabular-nums text-[#86868b] shrink-0">
                            {stu.studentCode}
                          </span>
                        )}
                      </div>

                      <div className="lg:col-span-2 flex items-center gap-1.5">
                        <label className="text-[11px] text-[#6e6e73] dark:text-[#86868b] shrink-0">
                          {lang === 'id' ? 'Ujian(%)' : '週次(%)'}
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={scoreVal}
                          onChange={(e) =>
                            setExamScoreDrafts((prev) => ({
                              ...prev,
                              [stu.id]: e.target.value,
                            }))
                          }
                          placeholder="0-100"
                          className={`w-full glass-input px-2.5 py-1.5 text-[12px] font-mono tabular-nums rounded-[10px] ${
                            numericScore !== null && !Number.isNaN(numericScore)
                              ? numericScore >= 70
                                ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                                : 'text-[#dc2626] dark:text-[#ff453a] font-semibold'
                              : ''
                          }`}
                        />
                      </div>

                      <div className="lg:col-span-3 flex items-center gap-1.5">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() =>
                                updateStudentEntry(stu.id, { attitudeScore: n })
                              }
                              className={`w-7 h-7 rounded-[8px] text-[12px] font-mono font-semibold border transition-colors ${
                                entry.attitudeScore === n
                                  ? 'bg-[#0071e3] dark:bg-[#2997ff] border-transparent text-white'
                                  : 'bg-white dark:bg-[#2c2c2e] border-[#d2d2d7] dark:border-[#424245] text-[#6e6e73] dark:text-[#f5f5f7]/80'
                              }`}
                              title={lang === 'id' ? `Sikap ${n}/5` : `態度 ${n}/5`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedAttitudeStudent(isExpanded ? null : stu.id)
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium bg-white dark:bg-[#2c2c2e] border border-[#d2d2d7] dark:border-[#424245] text-[#6e6e73] dark:text-[#f5f5f7] rounded-[8px] shrink-0 hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors"
                          title={lang === 'id' ? 'Detail sub-skor sikap' : '項目別評価'}
                        >
                          <Star className="w-3 h-3 text-[#6e6e73] dark:text-[#86868b]" />
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                      </div>

                      <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          maxLength={300}
                          value={entry.progressNote}
                          onChange={(e) =>
                            updateStudentEntry(stu.id, { progressNote: e.target.value })
                          }
                          placeholder={
                            lang === 'id' ? 'Catatan progres...' : '学習進捗メモ...'
                          }
                          className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px]"
                        />
                        <input
                          type="text"
                          maxLength={400}
                          value={entry.comment}
                          onChange={(e) =>
                            updateStudentEntry(stu.id, { comment: e.target.value })
                          }
                          placeholder={
                            lang === 'id' ? 'Komentar pribadi...' : '個別コメント...'
                          }
                          className="glass-input px-2.5 py-1.5 text-[12px] rounded-[10px]"
                        />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="pt-2.5 border-t border-[#d2d2d7]/50 dark:border-[#424245] grid grid-cols-2 sm:grid-cols-5 gap-2 text-[12px]">
                        {(
                          [
                            { key: 'subAttendance', ja: '出席姿勢', idLabel: 'Kehadiran' },
                            { key: 'subDiscipline', ja: '規律・マナー', idLabel: 'Disiplin' },
                            { key: 'subEffort', ja: '学習意欲', idLabel: 'Usaha' },
                            { key: 'subCooperation', ja: '協調性', idLabel: 'Kerjasama' },
                          ] as const
                        ).map((sub) => (
                          <div key={sub.key} className="space-y-1">
                            <label className="block text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                              {lang === 'id' ? sub.idLabel : sub.ja}
                            </label>
                            <select
                              value={entry[sub.key] ?? DEFAULT_SUB}
                              onChange={(e) =>
                                updateStudentEntry(stu.id, {
                                  [sub.key]: Number(e.target.value),
                                })
                              }
                              className="w-full glass-input px-2 py-1 text-[12px] font-mono rounded-[8px]"
                            >
                              {[5, 4, 3, 2, 1].map((v) => (
                                <option key={v} value={v}>
                                  {v} / 5
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                        <div className="col-span-2 sm:col-span-1 space-y-1">
                          <label className="block text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                            {lang === 'id' ? 'Catatan Sikap' : '態度メモ'}
                          </label>
                          <input
                            type="text"
                            maxLength={300}
                            value={entry.attitudeNote || ''}
                            onChange={(e) =>
                              updateStudentEntry(stu.id, { attitudeNote: e.target.value })
                            }
                            placeholder={lang === 'id' ? 'Singkat...' : '一言...'}
                            className="w-full glass-input px-2 py-1 text-[12px] rounded-[8px]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky Blurred Save Draft vs Submit Actions */}
        <div className="sticky bottom-0 z-20 -mx-5 sm:-mx-6 -mb-5 sm:-mb-6 px-5 sm:px-6 py-3.5 bg-white/95 dark:bg-[#1d1d1f]/95 apple-blur-overlay border-t border-[#d2d2d7]/60 dark:border-[#424245] rounded-b-[24px] flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => handleSaveReport('draft')}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{lang === 'id' ? 'Simpan Draft' : '下書き保存'}</span>
          </button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            type="button"
            disabled={busy}
            onClick={() => handleSaveReport('submitted')}
            className="apple-btn-primary inline-flex items-center gap-1.5 px-5 py-2 text-[13px] disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{lang === 'id' ? 'Kirim Laporan Mingguan' : '週報を提出する'}</span>
          </motion.button>
        </div>
      </div>

      {/* Weekly Reports Archive & Admin Commenting */}
      <div className="apple-tile p-5 sm:p-6 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
              {isHead
                ? lang === 'id'
                  ? 'Daftar Laporan Mingguan Sensei & Komentar Admin'
                  : '講師週報一覧・校長コメント管理'
                : lang === 'id'
                ? 'Riwayat Laporan Mingguan Saya & Komentar Kepala'
                : '提出済み週報履歴・校長コメント'}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filterClass}
              onChange={(e) => setFilterClass(e.target.value as ClassId | 'all')}
              className="glass-input px-3 py-1.5 text-[12px] rounded-[10px]"
            >
              <option value="all">{lang === 'id' ? 'Semua Kelas' : '全クラス'}</option>
              {CLASSES.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c.id, lang)}
                </option>
              ))}
            </select>
            <select
              value={filterWeek}
              onChange={(e) => setFilterWeek(e.target.value)}
              className="glass-input px-3 py-1.5 text-[12px] font-mono rounded-[10px]"
            >
              <option value="all">{lang === 'id' ? 'Semua Minggu' : '全週'}</option>
              {weekOptions.map((wk) => (
                <option key={wk} value={wk}>
                  {wk}
                </option>
              ))}
            </select>
            {isHead && (
              <select
                value={filterSensei}
                onChange={(e) => setFilterSensei(e.target.value)}
                className="glass-input px-3 py-1.5 text-[12px] rounded-[10px]"
              >
                <option value="all">{lang === 'id' ? 'Semua Sensei' : '全講師'}</option>
                {senseiNames.map(([uid, name]) => (
                  <option key={uid} value={uid}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {visibleReports.length === 0 ? (
          <EmptyStateIllustration
            kind="clipboard"
            title={
              lang === 'id'
                ? 'Belum ada laporan mingguan yang tersimpan'
                : '該当する週報がまだありません'
            }
          />
        ) : (
          <div className="space-y-3.5">
            {visibleReports.map((wr) => {
              const comp = getWeeklyReportCompliance(wr);
              const wTheme = CLASS_THEMES[wr.classId];
              const avgAttitude =
                wr.studentEntries.length > 0
                  ? (
                      wr.studentEntries.reduce((s, e) => s + (e.attitudeScore || 0), 0) /
                      wr.studentEntries.length
                    ).toFixed(1)
                  : '—';
              const isUnread =
                Boolean(wr.headComment) &&
                wr.commentReadByTeacher === false &&
                wr.teacherUid === profile.uid;
              const commentDraft =
                headCommentDrafts[wr.id] !== undefined
                  ? headCommentDrafts[wr.id]
                  : wr.headComment || '';

              return (
                <div
                  key={wr.id}
                  className="apple-virtual-item rounded-[18px] bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-white dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7]">
                        <span className={`w-2 h-2 rounded-full ${wTheme.dotColor}`} />
                        <span>{classLabel(wr.classId, lang)}</span>
                      </span>
                      <span className="font-mono tabular-nums text-[12px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {wr.weekKey}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium ${
                          comp === 'submitted'
                            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                            : comp === 'late'
                            ? 'bg-amber-500/12 text-amber-700 dark:text-amber-400'
                            : 'bg-black/5 dark:bg-white/10 text-[#6e6e73] dark:text-[#86868b]'
                        }`}
                      >
                        {comp === 'submitted'
                          ? lang === 'id'
                            ? 'Submitted'
                            : '提出済'
                          : comp === 'late'
                          ? lang === 'id'
                            ? 'Terlambat'
                            : '遅延提出'
                          : lang === 'id'
                          ? 'Draft'
                          : '下書き'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b]">
                      <span>{wr.teacherName}</span>
                      <span>·</span>
                      <span>
                        {lang === 'id' ? 'Sikap Rata²:' : '平均態度:'} {avgAttitude}/5
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClass(wr.classId);
                          setSelectedWeek(wr.weekKey);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="text-[#0066cc] dark:text-[#2997ff] hover:underline font-sans font-medium"
                      >
                        {lang === 'id' ? 'Muat ke Editor' : '開く'}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    <div>
                      <div className="text-[11px] font-semibold text-[#6e6e73] dark:text-[#86868b] mb-0.5">
                        {lang === 'id' ? 'Materi Minggu Ini:' : '今週の指導内容:'}
                      </div>
                      <div className="whitespace-pre-line">{wr.summaryTaught || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold text-[#6e6e73] dark:text-[#86868b] mb-0.5">
                        {lang === 'id' ? 'Perkembangan Kelas:' : 'クラス進捗:'}
                      </div>
                      <div className="whitespace-pre-line">{wr.classProgress || '—'}</div>
                    </div>
                    {wr.issues && (
                      <div className="md:col-span-2 text-[12px] text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-[12px] px-3 py-2">
                        <span className="font-semibold">
                          {lang === 'id' ? 'Kendala: ' : '課題: '}
                        </span>
                        {wr.issues}
                      </div>
                    )}
                  </div>

                  {/* Teacher view of Admin comment OR Admin comment box */}
                  {isHead ? (
                    <div className="pt-2.5 border-t border-[#d2d2d7]/60 dark:border-[#424245] space-y-2">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                          <MessageSquare className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                          <span>
                            {lang === 'id'
                              ? `Komentar Kepala untuk ${wr.teacherName}`
                              : `${wr.teacherName}先生へのコメント`}
                          </span>
                        </span>
                        {wr.headCommentAt && (
                          <span className="font-mono text-[11px] text-[#86868b]">
                            {wr.headCommentBy} · {wr.headCommentAt}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          maxLength={1500}
                          value={commentDraft}
                          onChange={(e) =>
                            setHeadCommentDrafts((prev) => ({
                              ...prev,
                              [wr.id]: e.target.value,
                            }))
                          }
                          placeholder={
                            lang === 'id'
                              ? 'Tulis komentar atau arahan untuk sensei...'
                              : '先生へのアドバイス・コメントを入力...'
                          }
                          className="flex-1 glass-input px-3 py-1.5 text-[13px] rounded-[10px]"
                        />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleSaveHeadComment(wr)}
                          className="apple-btn-primary px-4 py-1.5 text-[12px] disabled:opacity-50 shrink-0"
                        >
                          {lang === 'id' ? 'Kirim Komentar' : 'コメント保存'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    wr.headComment && (
                      <div
                        className={`text-[12px] rounded-[12px] px-3.5 py-2.5 border space-y-1 ${
                          isUnread
                            ? 'bg-[#0071e3]/8 border-[#0071e3]/35 dark:border-[#2997ff]/40 text-[#1d1d1f] dark:text-[#f5f5f7]'
                            : 'bg-white dark:bg-[#1d1d1f] border-[#d2d2d7]/60 dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                          <span className="inline-flex items-center gap-1.5">
                            <MessageSquare className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                            <span>
                              {lang === 'id'
                                ? `Komentar Kepala (${wr.headCommentBy})`
                                : `校長コメント (${wr.headCommentBy})`}
                            </span>
                            {isUnread && (
                              <span className="px-2 py-0.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white text-[10px] font-semibold">
                                {lang === 'id' ? 'Belum Dibaca' : '未読'}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                              {wr.headCommentAt}
                            </span>
                            {isUnread && (
                              <button
                                type="button"
                                onClick={() => handleMarkCommentRead(wr)}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white text-[11px] font-medium"
                              >
                                <Check className="w-3 h-3" />
                                <span>{lang === 'id' ? 'Tandai Dibaca' : '既読にする'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="whitespace-pre-line text-[#6e6e73] dark:text-[#f5f5f7]/85">
                          {wr.headComment}
                        </div>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
