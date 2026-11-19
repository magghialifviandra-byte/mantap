import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Activity,
  Check,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { motion } from 'motion/react';
import { db, handleFirestoreError, inviteDocIdForEmail, OperationType } from '../firebase';
import { tr, UI_TEXT } from '../i18n';
import {
  ActivityActionType,
  ActivityLogEntry,
  ClassId,
  CLASSES,
  LanguageMode,
  StaffInvite,
  UserProfile,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { CLASS_THEMES } from '../utils/classTheme';
import { clampArray, clampStr } from '../utils/payloadGuards';
import { EmptyStateIllustration, LiquidToast } from './AnimatedPrimitives';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  staffUsers: UserProfile[];
  staffInvites: StaffInvite[];
  activityLogs: ActivityLogEntry[];
}

function formatLogTimestamp(ts: unknown): string {
  if (!ts) return '—';
  if (
    typeof ts === 'object' &&
    ts !== null &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    const d = (ts as { toDate: () => Date }).toDate();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
      2,
      '0'
    )}`;
  }
  return '—';
}

function actionLabel(actionType: ActivityActionType, lang: LanguageMode): string {
  const map: Record<ActivityActionType, { ja: string; id: string }> = {
    role_change: { ja: '権限変更', id: 'Ubah Peran' },
    user_add: { ja: 'ユーザー追加', id: 'Tambah Pengguna' },
    user_remove: { ja: 'ユーザー削除', id: 'Hapus Pengguna' },
    schedule_update: { ja: 'スケジュール更新', id: 'Update Jadwal' },
    data_create: { ja: 'データ登録', id: 'Tambah Data' },
    data_update: { ja: 'データ更新', id: 'Ubah Data' },
    data_delete: { ja: 'データ削除', id: 'Hapus Data' },
    report_review: { ja: '日報承認・差戻', id: 'Review Laporan' },
    question_approve: { ja: '問題承認', id: 'Setujui Soal' },
    question_reject: { ja: '問題却下', id: 'Tolak Soal' },
    announcement_create: { ja: 'お知らせ投稿', id: 'Buat Pengumuman' },
    weekly_report_submit: { ja: '週報提出', id: 'Kirim Laporan Mingguan' },
    alert_handle: { ja: 'アラート対応', id: 'Tangani Peringatan' },
    threshold_update: { ja: '基準値更新', id: 'Update Ambang Batas' },
    report_card_draft: { ja: '通知表下書き作成', id: 'Buat Draf Rapor' },
    report_card_submit: { ja: '通知表提出', id: 'Ajukan Rapor' },
    report_card_finalize: { ja: '通知表確定', id: 'Finalisasi Rapor' },
    report_card_unlock: { ja: '通知表ロック解除', id: 'Buka Kunci Rapor' },
    report_card_reissue: { ja: '通知表再発行', id: 'Terbitkan Ulang Rapor' },
    certificate_issue: { ja: '修了証書発行', id: 'Terbitkan Sertifikat' },
    certificate_override: { ja: '修了証書例外承認', id: 'Override Sertifikat' },
    certificate_revoke: { ja: '修了証書失効', id: 'Cabut Sertifikat' },
    certificate_reissue: { ja: '修了証書再発行', id: 'Terbitkan Ulang Sertifikat' },
    school_settings_update: { ja: '通知表・証書設定更新', id: 'Update Pengaturan Sekolah' },
  };
  const entry = map[actionType];
  return entry ? (lang === 'id' ? entry.id : entry.ja) : actionType;
}

export function UsersRolesView({
  lang,
  profile,
  staffUsers,
  staffInvites,
  activityLogs,
}: Props) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'teacher' | 'head'>('teacher');
  const [inviteClasses, setInviteClasses] = useState<ClassId[]>(['hokkaido']);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [logFilter, setLogFilter] = useState<ActivityActionType | 'all'>('all');
  const [confirmState, setConfirmState] = useState<
    | { kind: 'user'; user: UserProfile }
    | { kind: 'invite'; invite: StaffInvite }
    | null
  >(null);

  const activeAdminCount = useMemo(
    () => staffUsers.filter((u) => u.role === 'head' && u.status === 'active').length,
    [staffUsers]
  );

  const sortedUsers = useMemo(() => {
    return [...staffUsers].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'head' ? -1 : 1;
      return (a.nickname || a.displayName).localeCompare(b.nickname || b.displayName);
    });
  }, [staffUsers]);

  const filteredLogs = useMemo(() => {
    const sorted = [...activityLogs].sort((a, b) => {
      const ta =
        typeof a.createdAt === 'object' && a.createdAt && 'toMillis' in a.createdAt
          ? (a.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      const tb =
        typeof b.createdAt === 'object' && b.createdAt && 'toMillis' in b.createdAt
          ? (b.createdAt as { toMillis: () => number }).toMillis()
          : 0;
      return tb - ta;
    });
    return sorted
      .filter((l) => (logFilter === 'all' ? true : l.actionType === logFilter))
      .slice(0, 60);
  }, [activityLogs, logFilter]);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  const toggleClassInList = (list: ClassId[], cid: ClassId): ClassId[] =>
    list.includes(cid) ? list.filter((c) => c !== cid) : [...list, cid];

  const isLastProtectedAdmin = (u: UserProfile) =>
    u.role === 'head' && u.status === 'active' && activeAdminCount <= 1;

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanEmail = clampStr(inviteEmail, 200).toLowerCase();
    const cleanName = clampStr(inviteName, 100);
    if (!cleanEmail || !cleanName) return;

    setBusy(true);
    const docId = inviteDocIdForEmail(cleanEmail);
    try {
      await setDoc(doc(db, 'staffInvites', docId), {
        email: cleanEmail,
        displayName: cleanName,
        role: inviteRole,
        assignedClasses: clampArray(inviteClasses, 4),
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'user_add',
        targetType: 'user',
        targetLabel: `${cleanName} (${cleanEmail})`,
        detail: `Invited as ${inviteRole === 'head' ? 'Admin' : 'Sensei'}`,
      });
      setInviteEmail('');
      setInviteName('');
      flashNotice(
        lang === 'id'
          ? `${cleanName} ditambahkan ke daftar pengguna & siap dipilih di Jadwal.`
          : `${cleanName} を登録しました（スケジュール講師選択にも即時反映されます）。`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `staffInvites/${docId}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (u: UserProfile, nextRole: 'head' | 'teacher') => {
    setErrorMsg('');
    if (u.role === nextRole) return;
    if (isLastProtectedAdmin(u) && nextRole !== 'head') {
      setErrorMsg(
        lang === 'id'
          ? 'Tidak dapat menurunkan peran admin terakhir yang masih aktif.'
          : '最後のアクティブな管理者をSenseiに変更することはできません。'
      );
      return;
    }

    try {
      await updateDoc(doc(db, 'users', u.uid), {
        role: nextRole,
        updatedAt: serverTimestamp(),
      });
      const uLabel = u.nickname || u.displayName;
      await logActivity({
        actor: profile,
        actionType: 'role_change',
        targetType: 'user',
        targetLabel: uLabel,
        detail: `${u.role === 'head' ? 'Admin' : 'Sensei'} → ${
          nextRole === 'head' ? 'Admin' : 'Sensei'
        }`,
      });
      flashNotice(
        lang === 'id'
          ? `Peran ${uLabel} diubah menjadi ${nextRole === 'head' ? 'Admin' : 'Sensei'}.`
          : `${uLabel} の権限を ${nextRole === 'head' ? '管理者' : '講師'} に変更しました。`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.uid}`);
    }
  };

  const handleStatusChange = async (u: UserProfile, nextStatus: 'active' | 'disabled') => {
    setErrorMsg('');
    if (isLastProtectedAdmin(u) && nextStatus !== 'active') {
      setErrorMsg(
        lang === 'id'
          ? 'Tidak dapat menonaktifkan admin terakhir yang masih aktif.'
          : '最後のアクティブな管理者を停止することはできません。'
      );
      return;
    }

    try {
      await updateDoc(doc(db, 'users', u.uid), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      const uLabel = u.nickname || u.displayName;
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'user',
        targetLabel: uLabel,
        detail: `Status → ${nextStatus}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.uid}`);
    }
  };

  const handleToggleUserClass = async (u: UserProfile, cid: ClassId) => {
    const nextClasses = toggleClassInList(u.assignedClasses || [], cid);
    try {
      await updateDoc(doc(db, 'users', u.uid), {
        assignedClasses: nextClasses,
        updatedAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'data_update',
        targetType: 'user',
        targetLabel: u.nickname || u.displayName,
        detail: `Classes: ${nextClasses.join(', ') || 'none'}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.uid}`);
    }
  };

  const executeConfirmedDelete = async () => {
    if (!confirmState) return;
    setBusy(true);
    setErrorMsg('');
    try {
      if (confirmState.kind === 'user') {
        const target = confirmState.user;
        if (isLastProtectedAdmin(target)) {
          setErrorMsg(
            lang === 'id'
              ? 'Tidak dapat menghapus admin terakhir yang masih aktif.'
              : '最後のアクティブな管理者は削除できません。'
          );
          setConfirmState(null);
          return;
        }
        try {
          await deleteDoc(doc(db, 'users', target.uid, 'private', 'info'));
        } catch {
          // private doc might not exist
        }
        await deleteDoc(doc(db, 'users', target.uid));
        const uLabel = target.nickname || target.displayName;
        await logActivity({
          actor: profile,
          actionType: 'user_remove',
          targetType: 'user',
          targetLabel: uLabel,
          detail: `Removed ${target.role === 'head' ? 'Admin' : 'Sensei'} account`,
        });
        flashNotice(
          lang === 'id' ? `Pengguna ${uLabel} dihapus.` : `${uLabel} を削除しました。`
        );
      } else {
        const inv = confirmState.invite;
        await deleteDoc(doc(db, 'staffInvites', inv.id));
        await logActivity({
          actor: profile,
          actionType: 'user_remove',
          targetType: 'user',
          targetLabel: `${inv.displayName} (${inv.email})`,
          detail: 'Removed pending invite',
        });
        flashNotice(
          lang === 'id'
            ? `Undangan ${inv.displayName} dihapus.`
            : `${inv.displayName} の招待を取り消しました。`
        );
      }
      setConfirmState(null);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        confirmState.kind === 'user'
          ? `users/${confirmState.user.uid}`
          : `staffInvites/${confirmState.invite.id}`
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <LiquidToast message={notice} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {tr(UI_TEXT.navUsers, lang)}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'id'
              ? 'Kelola Sensei & Admin, ubah peran secara instan, dan pantau log aktivitas sistem.'
              : '講師・管理者の追加・削除・権限切替（即時反映）と、管理者専用の操作ログを確認できます。'}
          </p>
        </div>

        <div className="flex items-center gap-3 text-[12px] font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b] bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] px-3.5 py-2 rounded-full">
          <span>
            {lang === 'id' ? 'Admin Aktif' : '有効管理者'}:{' '}
            <strong className="text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold">
              {activeAdminCount}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {lang === 'id' ? 'Total Akun' : '登録アカウント'}:{' '}
            <strong className="text-[#1d1d1f] dark:text-[#f5f5f7] font-semibold">
              {staffUsers.length}
            </strong>
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[16px] px-4 py-3 border border-[#dc2626]/30 dark:border-[#ff453a]/35 bg-[#dc2626]/8 text-[#dc2626] dark:text-[#ff453a] text-[13px] font-medium flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 1. Add User / Invite Form */}
      <div className="apple-tile p-5 sm:p-6 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-5">
        <div className="flex items-center gap-2 text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
          <UserPlus className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b]" />
          <span>
            {lang === 'id'
              ? 'Tambah Pengguna Baru (Sensei / Admin)'
              : '新規ユーザー追加（講師・管理者）'}
          </span>
        </div>

        <form
          onSubmit={handleCreateInvite}
          className="rounded-[18px] bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/50 dark:border-[#424245]/60 p-4 space-y-3.5"
        >
          <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
            {lang === 'id'
              ? 'Daftarkan email Google pengguna beserta perannya. Nama langsung muncul di pilihan Sensei pada Jadwal dan akun otomatis aktif saat login.'
              : 'Googleメールアドレスと権限を登録すると、スケジュールの講師選択肢に即時追加され、本人の初回ログイン時に自動有効化されます。'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="sensei@gmail.com"
              className="px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
            />
            <input
              type="text"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder={lang === 'id' ? 'Nama Lengkap / Panggilan' : '氏名・呼び名'}
              className="px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'teacher' | 'head')}
              className="px-3.5 py-2.5 text-[14px] rounded-[12px] glass-input"
            >
              <option value="teacher">{tr(UI_TEXT.teacherRole, lang)}</option>
              <option value="head">{tr(UI_TEXT.headRole, lang)}</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'id' ? 'Kelas:' : '担当クラス:'}
              </span>
              {CLASSES.map((c) => {
                const selected = inviteClasses.includes(c.id);
                const cTheme = CLASS_THEMES[c.id];
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setInviteClasses((prev) => toggleClassInList(prev, c.id))}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-full border whitespace-nowrap transition-colors ${
                      selected
                        ? 'bg-[#0071e3] dark:bg-[#2997ff] border-transparent text-white'
                        : 'bg-white dark:bg-[#1d1d1f] border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]'
                    }`}
                  >
                    {!selected && (
                      <span className={`w-1.5 h-1.5 rounded-full ${cTheme.dotColor} shrink-0`} />
                    )}
                    <span>{lang === 'id' ? c.nameId : c.nameJa}</span>
                  </button>
                );
              })}
            </div>
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="submit"
              disabled={busy}
              className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-[13px] whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{lang === 'id' ? 'Tambah Pengguna' : 'ユーザーを追加'}</span>
            </motion.button>
          </div>
        </form>

        {/* Registered Users Table */}
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              <UserCheck className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b]" />
              <span>
                {lang === 'id'
                  ? 'Daftar Sensei & Admin Terdaftar'
                  : '登録済み講師・管理者一覧'}
              </span>
            </div>
            <span className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
              {lang === 'id'
                ? 'Perubahan peran berlaku seketika'
                : '権限変更は即座に各画面へ反映されます'}
            </span>
          </div>

          {sortedUsers.length === 0 ? (
            <EmptyStateIllustration
              kind="users"
              title={
                lang === 'id'
                  ? 'Belum ada pengguna terdaftar'
                  : 'まだ登録されたユーザーがいません'
              }
            />
          ) : (
            <div className="apple-table-wrap">
              <div className="apple-scroll-x max-h-[540px]">
                <table className="w-full text-[13px] text-left border-collapse min-w-[780px]">
                  <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                    <tr className="text-[11px] uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b]">
                      <th className="sticky left-0 z-[15] bg-[#f5f5f7] dark:bg-[#161617] py-2.5 pl-4 pr-4 font-semibold">
                        {lang === 'id' ? 'Nama' : '氏名'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold">
                        {lang === 'id' ? 'Peran' : '権限'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold">
                        {lang === 'id' ? 'Status' : '状態'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold">
                        {lang === 'id' ? 'Kelas' : '担当クラス'}
                      </th>
                      <th className="py-2.5 pl-3 pr-4 font-semibold text-right">
                        {lang === 'id' ? 'Aksi' : '操作'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedUsers.map((u) => {
                      const uName = u.nickname || u.displayName;
                      const uInitials = uName.trim().slice(0, 2).toUpperCase();
                      const protectedLastAdmin = isLastProtectedAdmin(u);

                      return (
                        <tr key={u.uid} className="apple-table-row group">
                          <td className="sticky left-0 z-[5] bg-white dark:bg-[#1d1d1f] group-hover:bg-[#f5f5f7] dark:group-hover:bg-[#161617] py-2.5 pl-4 pr-4 transition-colors">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full overflow-hidden bg-[#1d1d1f] dark:bg-[#2c2c2e] text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
                                {u.avatarDataUrl ? (
                                  <img
                                    src={u.avatarDataUrl}
                                    alt={uName}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span>{uInitials}</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate flex items-center gap-1.5">
                                  <span>{uName}</span>
                                  {u.uid === profile.uid && (
                                    <span className="text-[11px] font-normal text-[#6e6e73] dark:text-[#86868b]">
                                      ({lang === 'id' ? 'Anda' : '自分'})
                                    </span>
                                  )}
                                </div>
                                {u.fullName && u.fullName !== uName && (
                                  <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b] truncate">
                                    {u.fullName}
                                  </div>
                                )}
                                {Boolean(u.lastLoginAt) && (
                                  <div className="text-[10px] font-mono tabular-nums text-[#86868b] truncate">
                                    {lang === 'id' ? 'Login terakhir: ' : '最終ログイン: '}
                                    {formatLogTimestamp(u.lastLoginAt)}
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={u.role}
                              disabled={protectedLastAdmin}
                              title={
                                protectedLastAdmin
                                  ? lang === 'id'
                                    ? 'Admin terakhir tidak dapat diturunkan'
                                    : '最後の管理者は変更不可'
                                  : undefined
                              }
                              onChange={(e) =>
                                handleRoleChange(u, e.target.value as 'head' | 'teacher')
                              }
                              className="text-[12px] px-2.5 py-1.5 rounded-[10px] glass-input disabled:opacity-50"
                            >
                              <option value="teacher">{tr(UI_TEXT.teacherRole, lang)}</option>
                              <option value="head">{tr(UI_TEXT.headRole, lang)}</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-[12px] font-medium whitespace-nowrap">
                            {u.status === 'active' ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-400">
                                {lang === 'id' ? 'Aktif' : '有効'}
                              </span>
                            ) : u.status === 'pending' ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-500/12 text-amber-700 dark:text-amber-400">
                                {lang === 'id' ? 'Menunggu' : '承認待ち'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#dc2626]/10 text-[#dc2626] dark:text-[#ff453a]">
                                {lang === 'id' ? 'Nonaktif' : '停止中'}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-wrap gap-1">
                              {CLASSES.map((c) => {
                                const assigned = (u.assignedClasses || []).includes(c.id);
                                const cTheme = CLASS_THEMES[c.id];
                                return (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => handleToggleUserClass(u, c.id)}
                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-medium rounded-full border whitespace-nowrap transition-colors ${
                                      assigned
                                        ? 'bg-[#0071e3] dark:bg-[#2997ff] border-transparent text-white'
                                        : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-[#d2d2d7]/70 dark:border-[#424245] text-[#6e6e73] dark:text-[#f5f5f7]/80 hover:text-[#1d1d1f] dark:hover:text-white'
                                    }`}
                                  >
                                    {!assigned && (
                                      <span className={`w-1.5 h-1.5 rounded-full ${cTheme.dotColor}`} />
                                    )}
                                    <span>{c.nameJa.replace('クラス', '')}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-2.5 pl-3 pr-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {u.status !== 'active' ? (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(u, 'active')}
                                  className="inline-flex items-center gap-1 px-3 py-1 text-[12px] font-medium bg-emerald-600 text-white rounded-full hover:bg-emerald-700 transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>{lang === 'id' ? 'Aktifkan' : '承認・有効化'}</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={protectedLastAdmin}
                                  onClick={() => handleStatusChange(u, 'disabled')}
                                  className="px-3 py-1 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] disabled:opacity-40 transition-colors"
                                >
                                  {lang === 'id' ? 'Nonaktifkan' : '停止'}
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={protectedLastAdmin}
                                onClick={() => setConfirmState({ kind: 'user', user: u })}
                                title={
                                  protectedLastAdmin
                                    ? lang === 'id'
                                      ? 'Admin terakhir dilindungi'
                                      : '最後の管理者は削除不可'
                                    : lang === 'id'
                                    ? 'Hapus pengguna'
                                    : 'ユーザーを削除'
                                }
                                className="p-1.5 text-[#6e6e73] dark:text-[#86868b] hover:text-[#dc2626] dark:hover:text-[#ff453a] rounded-full hover:bg-[#dc2626]/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Pending Invites List */}
        {staffInvites.length > 0 && (
          <div className="pt-4 border-t border-[#d2d2d7]/60 dark:border-[#424245] space-y-2.5">
            <div className="text-[12px] font-semibold text-[#6e6e73] dark:text-[#86868b]">
              {lang === 'id'
                ? 'Undangan Menunggu Login Pertama:'
                : '初回ログイン待ちの招待済みユーザー:'}
            </div>
            <div className="flex flex-wrap gap-2 text-[12px]">
              {staffInvites.map((inv) => (
                <div
                  key={inv.id}
                  className="inline-flex items-center gap-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/60 dark:border-[#424245] rounded-full px-3.5 py-1.5 text-[#1d1d1f] dark:text-[#f5f5f7]"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff]" />
                  <span className="font-medium">{inv.displayName}</span>
                  <span className="text-[#6e6e73] dark:text-[#86868b] font-mono">{inv.email}</span>
                  <span className="text-[#6e6e73] dark:text-[#86868b]">
                    · {inv.role === 'head' ? (lang === 'id' ? 'Admin' : '管理者') : 'Sensei'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmState({ kind: 'invite', invite: inv })}
                    className="text-[#6e6e73] hover:text-[#dc2626] dark:hover:text-[#ff453a] p-0.5 transition-colors"
                    aria-label={`Remove invite ${inv.displayName}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Admin-Only Activity Log */}
      <div className="apple-tile p-5 sm:p-6 border border-[#d2d2d7]/60 dark:border-[#424245]/60 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-[#6e6e73] dark:text-[#86868b]" />
            <div>
              <h2 className="text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                {lang === 'id'
                  ? 'Log Aktivitas Sistem (Khusus Admin)'
                  : '操作ログ・変更履歴（管理者専用）'}
              </h2>
              <p className="text-[12px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'id'
                  ? 'Mencatat siapa yang mengubah peran, jadwal, soal, nilai, dan laporan.'
                  : '権限・スケジュール・問題バンク・採点・日報の登録／編集／削除履歴を自動記録します。'}
              </p>
            </div>
          </div>

          <select
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value as ActivityActionType | 'all')}
            aria-label="Filter activity log"
            className="px-3 py-1.5 text-[12px] rounded-[10px] glass-input"
          >
            <option value="all">{lang === 'id' ? 'Semua Aktivitas' : 'すべての操作'}</option>
            <option value="role_change">{actionLabel('role_change', lang)}</option>
            <option value="user_add">{actionLabel('user_add', lang)}</option>
            <option value="user_remove">{actionLabel('user_remove', lang)}</option>
            <option value="schedule_update">{actionLabel('schedule_update', lang)}</option>
            <option value="report_review">{actionLabel('report_review', lang)}</option>
            <option value="weekly_report_submit">{actionLabel('weekly_report_submit', lang)}</option>
            <option value="question_approve">{actionLabel('question_approve', lang)}</option>
            <option value="question_reject">{actionLabel('question_reject', lang)}</option>
            <option value="announcement_create">{actionLabel('announcement_create', lang)}</option>
            <option value="alert_handle">{actionLabel('alert_handle', lang)}</option>
            <option value="threshold_update">{actionLabel('threshold_update', lang)}</option>
            <option value="data_create">{actionLabel('data_create', lang)}</option>
            <option value="data_update">{actionLabel('data_update', lang)}</option>
            <option value="data_delete">{actionLabel('data_delete', lang)}</option>
            <option value="report_card_draft">{actionLabel('report_card_draft', lang)}</option>
            <option value="report_card_submit">{actionLabel('report_card_submit', lang)}</option>
            <option value="report_card_finalize">{actionLabel('report_card_finalize', lang)}</option>
            <option value="report_card_unlock">{actionLabel('report_card_unlock', lang)}</option>
            <option value="report_card_reissue">{actionLabel('report_card_reissue', lang)}</option>
            <option value="certificate_issue">{actionLabel('certificate_issue', lang)}</option>
            <option value="certificate_override">{actionLabel('certificate_override', lang)}</option>
            <option value="certificate_revoke">{actionLabel('certificate_revoke', lang)}</option>
            <option value="certificate_reissue">{actionLabel('certificate_reissue', lang)}</option>
            <option value="school_settings_update">{actionLabel('school_settings_update', lang)}</option>
          </select>
        </div>

        {filteredLogs.length === 0 ? (
          <EmptyStateIllustration
            kind="clipboard"
            title={
              lang === 'id'
                ? 'Belum ada catatan aktivitas pada filter ini'
                : '該当する操作履歴はまだありません'
            }
          />
        ) : (
          <div className="apple-table-wrap">
            <div className="apple-scroll-x max-h-[460px]">
              <table className="w-full text-[12px] text-left border-collapse min-w-[680px]">
                <thead className="sticky top-0 z-10 bg-[#f5f5f7] dark:bg-[#161617] border-b border-[#d2d2d7]/70 dark:border-[#424245]">
                  <tr className="text-[11px] uppercase tracking-wider text-[#6e6e73] dark:text-[#86868b]">
                    <th className="py-2.5 pl-4 pr-3 font-semibold">
                      {lang === 'id' ? 'Waktu' : '日時'}
                    </th>
                    <th className="py-2.5 px-3 font-semibold">
                      {lang === 'id' ? 'Pelaku' : '操作者'}
                    </th>
                    <th className="py-2.5 px-3 font-semibold">
                      {lang === 'id' ? 'Aksi' : '種別'}
                    </th>
                    <th className="py-2.5 px-3 font-semibold">
                      {lang === 'id' ? 'Target' : '対象'}
                    </th>
                    <th className="py-2.5 pl-3 pr-4 font-semibold">
                      {lang === 'id' ? 'Detail' : '詳細'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="apple-table-row">
                      <td className="py-2.5 pl-4 pr-3 font-mono tabular-nums text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                        {formatLogTimestamp(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7] whitespace-nowrap">
                        {log.actorName}
                      </td>
                      <td className="py-2.5 px-3 text-[#0066cc] dark:text-[#2997ff] font-medium whitespace-nowrap">
                        {actionLabel(log.actionType, lang)}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {log.targetLabel}
                      </td>
                      <td className="py-2.5 pl-3 pr-4 text-[#6e6e73] dark:text-[#86868b]">
                        {log.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog for User / Invite Removal */}
      <ConfirmDialog
        open={Boolean(confirmState)}
        lang={lang}
        busy={busy}
        title={
          confirmState?.kind === 'user'
            ? lang === 'id'
              ? 'Hapus Akun Pengguna?'
              : 'ユーザーアカウントを削除しますか？'
            : lang === 'id'
            ? 'Hapus Undangan Pengguna?'
            : 'ユーザー招待を取り消しますか？'
        }
        message={
          confirmState?.kind === 'user'
            ? lang === 'id'
              ? `Akun "${confirmState.user.nickname || confirmState.user.displayName}" akan dihapus dari sistem.`
              : `「${confirmState.user.nickname || confirmState.user.displayName}」のアカウントを削除します。この操作は取り消せません。`
            : confirmState?.kind === 'invite'
            ? lang === 'id'
              ? `Undangan untuk "${confirmState.invite.displayName}" (${confirmState.invite.email}) akan dihapus.`
              : `「${confirmState.invite.displayName}」(${confirmState.invite.email}) の招待を取り消します。`
            : ''
        }
        onCancel={() => setConfirmState(null)}
        onConfirm={executeConfirmedDelete}
      />
    </div>
  );
}
