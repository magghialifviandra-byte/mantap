import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Check, Eye, Megaphone, Pin, Plus, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Announcement, AnnouncementRead, LanguageMode, UserProfile } from '../types';
import { logActivity } from '../utils/activityLog';
import { formatTimestamp, parseTimestampMs } from '../utils/analyticsUtils';
import { clampStr } from '../utils/payloadGuards';
import { APPLE_EASE } from './AppleGestures';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  announcements: Announcement[];
  announcementReads: AnnouncementRead[];
  staffUsers: UserProfile[];
  compact?: boolean;
}

export function AnnouncementsPanel({
  lang,
  profile,
  announcements,
  announcementReads,
  staffUsers,
  compact = false,
}: Props) {
  const isHead = profile.role === 'head';
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [pinned, setPinned] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedReadersId, setExpandedReadersId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt);
    });
  }, [announcements]);

  const myReadIds = useMemo(() => {
    const set = new Set<string>();
    announcementReads.forEach((r) => {
      if (r.uid === profile.uid) set.add(r.annId);
    });
    return set;
  }, [announcementReads, profile.uid]);

  const readersByAnn = useMemo(() => {
    const map = new Map<string, AnnouncementRead[]>();
    announcementReads.forEach((r) => {
      const arr = map.get(r.annId) || [];
      arr.push(r);
      map.set(r.annId, arr);
    });
    return map;
  }, [announcementReads]);

  const activeStaffCount = useMemo(
    () => staffUsers.filter((u) => u.status === 'active').length,
    [staffUsers]
  );

  const unreadCount = useMemo(
    () => sortedAnnouncements.filter((a) => !myReadIds.has(a.id)).length,
    [sortedAnnouncements, myReadIds]
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isHead) return;
    const cleanTitle = clampStr(title, 200);
    const cleanMsg = clampStr(message, 2500);
    if (!cleanTitle || !cleanMsg) return;

    setBusy(true);
    try {
      const ref = await addDoc(collection(db, 'announcements'), {
        title: cleanTitle,
        message: cleanMsg,
        pinned,
        createdBy: profile.uid,
        createdByName: clampStr(profile.nickname || profile.displayName, 100) || 'Admin',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'announcementReads', `${ref.id}_${profile.uid}`), {
        annId: ref.id,
        uid: profile.uid,
        name: clampStr(profile.nickname || profile.displayName, 100) || 'Admin',
        readAt: serverTimestamp(),
      });
      await logActivity({
        actor: profile,
        actionType: 'announcement_create',
        targetType: 'announcement',
        targetLabel: cleanTitle,
        detail: `${pinned ? '[Pinned] ' : ''}${cleanMsg.slice(0, 80)}`,
      });
      setTitle('');
      setMessage('');
      setPinned(true);
      setComposerOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'announcements');
    } finally {
      setBusy(false);
    }
  };

  const handleMarkRead = async (ann: Announcement) => {
    const readId = `${ann.id}_${profile.uid}`;
    try {
      await setDoc(doc(db, 'announcementReads', readId), {
        annId: ann.id,
        uid: profile.uid,
        name: clampStr(profile.nickname || profile.displayName, 100) || 'Sensei',
        readAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `announcementReads/${readId}`);
    }
  };

  const handleTogglePin = async (ann: Announcement) => {
    if (!isHead) return;
    try {
      await updateDoc(doc(db, 'announcements', ann.id), {
        pinned: !ann.pinned,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `announcements/${ann.id}`);
    }
  };

  const executeDelete = async () => {
    if (!isHead || !deleteTarget) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'announcements', deleteTarget.id));
      await logActivity({
        actor: profile,
        actionType: 'data_delete',
        targetType: 'announcement',
        targetLabel: deleteTarget.title,
        detail: 'Deleted announcement',
      });
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `announcements/${deleteTarget.id}`);
    } finally {
      setBusy(false);
    }
  };

  if (!isHead && sortedAnnouncements.length === 0) {
    return null;
  }

  const displayed = showAll
    ? sortedAnnouncements
    : sortedAnnouncements.slice(0, compact ? 2 : 4);

  return (
    <div className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/60 rounded-[22px] p-5 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center text-[#1d1d1f] dark:text-[#f5f5f7] shrink-0">
            <Megaphone className="w-4 h-4" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                {lang === 'id' ? 'Pengumuman Sekolah' : '学校からのお知らせ'}
              </h2>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-[#0071e3] dark:bg-[#2997ff] text-white tabular-nums">
                  {unreadCount} {lang === 'id' ? 'Belum Dibaca' : '未読'}
                </span>
              )}
            </div>
            <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b]">
              {isHead
                ? lang === 'id'
                  ? 'Bagikan informasi penting ke semua Sensei dan pantau status baca.'
                  : '全講師への連絡事項を掲示し、既読状況を確認できます。'
                : lang === 'id'
                ? 'Informasi resmi dari Kepala Sekolah.'
                : '校長・管理者からの連絡事項です。'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {sortedAnnouncements.length > (compact ? 2 : 4) && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="px-3.5 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
            >
              {showAll
                ? lang === 'id'
                  ? 'Ringkas'
                  : '折りたたむ'
                : lang === 'id'
                ? `Lihat Semua (${sortedAnnouncements.length})`
                : `すべて表示 (${sortedAnnouncements.length})`}
            </button>
          )}
          {isHead && (
            <button
              type="button"
              onClick={() => setComposerOpen((v) => !v)}
              className="apple-btn-primary inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px]"
            >
              {composerOpen ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>
                {composerOpen
                  ? lang === 'id'
                    ? 'Tutup'
                    : '閉じる'
                  : lang === 'id'
                  ? 'Buat Pengumuman'
                  : 'お知らせを投稿'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Admin Composer */}
      <AnimatePresence initial={false}>
        {isHead && composerOpen && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: APPLE_EASE }}
            onSubmit={handleCreate}
            className="overflow-hidden"
          >
            <div className="bg-[#f5f5f7] dark:bg-[#161617] border border-[#d2d2d7]/70 dark:border-[#424245] rounded-[16px] p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={lang === 'id' ? 'Judul Pengumuman *' : 'お知らせタイトル *'}
                  className="sm:col-span-9 glass-input px-3.5 py-2 text-[14px] rounded-[12px]"
                />
                <label className="sm:col-span-3 inline-flex items-center gap-2 text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(e) => setPinned(e.target.checked)}
                    className="rounded border-[#d2d2d7] text-[#0071e3]"
                  />
                  <Pin className="w-3.5 h-3.5 text-[#6e6e73] dark:text-[#86868b]" />
                  <span>{lang === 'id' ? 'Sematkan (Pin)' : '上部に固定'}</span>
                </label>
              </div>
              <textarea
                required
                rows={3}
                maxLength={2500}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  lang === 'id'
                    ? 'Isi pesan pengumuman untuk seluruh Sensei...'
                    : '全講師へのお知らせ内容を入力してください...'
                }
                className="w-full glass-input px-3.5 py-2.5 text-[14px] rounded-[12px]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setComposerOpen(false)}
                  className="px-4 py-1.5 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-white dark:hover:bg-[#2c2c2e]"
                >
                  {lang === 'id' ? 'Batal' : 'キャンセル'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="apple-btn-primary px-5 py-1.5 text-[12px] disabled:opacity-50"
                >
                  {lang === 'id' ? 'Terbitkan Pengumuman' : '公開する'}
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Announcements List */}
      {sortedAnnouncements.length === 0 ? (
        <div className="text-[13px] text-[#6e6e73] dark:text-[#86868b] py-2">
          {lang === 'id' ? 'Belum ada pengumuman sekolah.' : 'まだお知らせはありません。'}
        </div>
      ) : (
        <div className="divide-y divide-[#d2d2d7]/60 dark:divide-[#424245]/60">
          {displayed.map((ann) => {
            const isRead = myReadIds.has(ann.id);
            const readers = readersByAnn.get(ann.id) || [];
            const showReaders = expandedReadersId === ann.id;
            return (
              <div key={ann.id} className="py-3.5 first:pt-1 last:pb-1 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isRead && (
                        <span
                          className="w-2 h-2 rounded-full bg-[#0071e3] dark:bg-[#2997ff] shrink-0"
                          aria-label="Unread"
                        />
                      )}
                      {ann.pinned && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#86868b]">
                          <Pin className="w-2.5 h-2.5" />
                          <span>{lang === 'id' ? 'Disematkan' : '固定'}</span>
                        </span>
                      )}
                      <h3 className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {ann.title}
                      </h3>
                    </div>
                    <div className="text-[12px] text-[#6e6e73] dark:text-[#86868b] tabular-nums">
                      {ann.createdByName} · {formatTimestamp(ann.createdAt)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {!isRead ? (
                      <button
                        type="button"
                        onClick={() => handleMarkRead(ann)}
                        className="apple-btn-primary inline-flex items-center gap-1 px-3 py-1 text-[12px]"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>{lang === 'id' ? 'Tandai Dibaca' : '既読にする'}</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b]">
                        <Check className="w-3.5 h-3.5" />
                        <span>{lang === 'id' ? 'Sudah Dibaca' : '既読済'}</span>
                      </span>
                    )}

                    {isHead && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExpandedReadersId(showReaders ? null : ann.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium rounded-full border border-[#d2d2d7] dark:border-[#424245] text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e]"
                          title={lang === 'id' ? 'Lihat pembaca' : '既読者一覧'}
                        >
                          <Eye className="w-3 h-3 text-[#6e6e73] dark:text-[#86868b]" />
                          <span className="tabular-nums">
                            {readers.length}
                            {activeStaffCount > 0 ? `/${activeStaffCount}` : ''}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleTogglePin(ann)}
                          className={`p-1.5 rounded-full border transition-colors ${
                            ann.pinned
                              ? 'border-[#0071e3] dark:border-[#2997ff] text-[#0071e3] dark:text-[#2997ff]'
                              : 'border-[#d2d2d7] dark:border-[#424245] text-[#6e6e73] dark:text-[#86868b]'
                          }`}
                          title={lang === 'id' ? 'Pin / Unpin' : '固定切替'}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(ann)}
                          className="p-1.5 text-[#6e6e73] hover:text-[#dc2626] dark:text-[#86868b] dark:hover:text-[#ff453a] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                          aria-label={`Delete announcement ${ann.title}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <p className="text-[14px] text-[#1d1d1f]/85 dark:text-[#f5f5f7]/85 whitespace-pre-line leading-relaxed">
                  {ann.message}
                </p>

                {isHead && showReaders && (
                  <div className="pt-2 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50 text-[12px] text-[#6e6e73] dark:text-[#86868b] space-y-1.5">
                    <div className="font-medium">
                      {lang === 'id' ? 'Sudah dibaca oleh:' : '既読スタッフ:'} ({readers.length})
                    </div>
                    {readers.length === 0 ? (
                      <div>
                        {lang === 'id' ? 'Belum ada yang menandai dibaca.' : 'まだ既読者はいません。'}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {readers.map((r) => (
                          <span
                            key={r.id}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] text-[12px]"
                          >
                            <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                              {r.name}
                            </span>
                            <span className="tabular-nums text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                              {formatTimestamp(r.readAt).slice(5)}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        busy={busy}
        title={lang === 'id' ? 'Hapus Pengumuman?' : 'お知らせを削除しますか？'}
        message={
          deleteTarget
            ? lang === 'id'
              ? `Pengumuman "${deleteTarget.title}" akan dihapus.`
              : `お知らせ「${deleteTarget.title}」を削除します。`
            : ''
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={executeDelete}
      />
    </div>
  );
}
