import React, { useRef, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Camera, Check, Trash2, UserCheck, X } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { LanguageMode, UserProfile } from '../types';
import { clampStr } from '../utils/payloadGuards';
import { AppleModalSheet } from './AppleGestures';

interface Props {
  lang: LanguageMode;
  profile: UserProfile;
  mode: 'onboarding' | 'edit';
  onClose?: () => void;
  onCompleted?: () => void;
}

const MAX_AVATAR_DATA_URL_LEN = 175000;

async function resizeAvatarFileToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const targetSize = 240;
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetSize, targetSize);
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > MAX_AVATAR_DATA_URL_LEN && quality > 0.35) {
          quality -= 0.12;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}

export function ProfileSetupModal({ lang, profile, mode, onClose, onCompleted }: Props) {
  const [fullName, setFullName] = useState(profile.fullName || profile.displayName || '');
  const [nickname, setNickname] = useState(profile.nickname || profile.displayName || '');
  const [avatarDataUrl, setAvatarDataUrl] = useState(profile.avatarDataUrl || '');
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhotoError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPhotoError(
        lang === 'ja'
          ? '画像ファイル（JPG, PNG, WEBP等）を選択してください。'
          : 'Pilih file gambar yang valid (JPG, PNG, WEBP).'
      );
      return;
    }
    try {
      const compressed = await resizeAvatarFileToJpeg(file);
      if (compressed.length > MAX_AVATAR_DATA_URL_LEN) {
        setPhotoError(
          lang === 'ja'
            ? '画像のサイズが大きすぎます。別の写真をお選びください。'
            : 'Ukuran gambar masih terlalu besar. Pilih foto lain.'
        );
        return;
      }
      setAvatarDataUrl(compressed);
    } catch {
      setPhotoError(
        lang === 'ja' ? '画像の読み込みに失敗しました。' : 'Gagal memproses foto profil.'
      );
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanFull = clampStr(fullName, 120);
    const cleanNick = clampStr(nickname, 80) || cleanFull;
    if (!cleanFull) return;

    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        fullName: cleanFull,
        nickname: cleanNick,
        displayName: clampStr(cleanNick, 100),
        avatarDataUrl: avatarDataUrl || '',
        profileCompleted: true,
        updatedAt: serverTimestamp(),
      });
      onCompleted?.();
      onClose?.();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSkipOnboarding = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', profile.uid), {
        profileCompleted: true,
        updatedAt: serverTimestamp(),
      });
      onCompleted?.();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
    } finally {
      setSaving(false);
    }
  };

  const initials = (nickname || fullName || profile.displayName || 'G')
    .trim()
    .slice(0, 2)
    .toUpperCase();

  const innerContent = (
    <div className="p-6 sm:p-7 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b]">
            元気アカデミー · {lang === 'ja' ? '教職員プロフィール' : 'Profil Pengajar / Staf'}
          </div>
          <h2 className="text-[22px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-[-0.02em] mt-0.5">
            {mode === 'onboarding'
              ? lang === 'ja'
                ? 'プロフィール初期設定'
                : 'Lengkapi Profil Anda'
              : lang === 'ja'
              ? 'プロフィール編集'
              : 'Edit Profil'}
          </h2>
          <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'ja'
              ? '写真・氏名・呼び名を設定してください（後からいつでも変更できます）。'
              : 'Unggah foto dari HP/laptop, isi nama lengkap & nama panggilan (bisa diubah kapan saja).'}
          </p>
        </div>

        {mode === 'edit' && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[#6e6e73] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="flex items-center gap-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[16px] p-3.5">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-[#1d1d1f] dark:bg-black text-white flex items-center justify-center text-lg font-semibold shrink-0">
            {avatarDataUrl ? (
              <img
                src={avatarDataUrl}
                alt="Foto Profil"
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="apple-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] cursor-pointer">
                <Camera className="w-3.5 h-3.5" />
                <span>{lang === 'ja' ? '写真を選択 (HP/PC)' : 'Pilih Foto (HP/Laptop)'}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </label>
              {avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => {
                    setAvatarDataUrl('');
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-[#dc2626] dark:text-[#ff453a] hover:underline"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{lang === 'ja' ? '削除' : 'Hapus'}</span>
                </button>
              )}
            </div>
            {photoError ? (
              <div className="text-[11px] text-[#dc2626] dark:text-[#ff453a]">{photoError}</div>
            ) : (
              <div className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'ja'
                  ? '自動リサイズして保存されます'
                  : 'Foto otomatis dikompres agar ringan'}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
            {lang === 'ja' ? '氏名（フルネーム）*' : 'Nama Lengkap *'}
          </label>
          <input
            type="text"
            required
            maxLength={120}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={lang === 'ja' ? '例: ブディ・サントソ' : 'Contoh: Budi Santoso'}
            className="glass-input w-full px-3.5 py-2.5 text-[14px] rounded-[12px]"
          />
        </div>

        <div>
          <label className="block text-[12px] font-medium text-[#6e6e73] dark:text-[#86868b] mb-1">
            {lang === 'ja'
              ? '呼び名・先生名（日報や名簿に表示）*'
              : 'Nama Panggilan / Nama Sensei (tampil di laporan) *'}
          </label>
          <input
            type="text"
            required
            maxLength={80}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder={lang === 'ja' ? '例: ブディ先生' : 'Contoh: Budi Sensei / ブディ先生'}
            className="glass-input w-full px-3.5 py-2.5 text-[14px] rounded-[12px]"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          {mode === 'onboarding' ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleSkipOnboarding}
              className="px-3.5 py-2 text-[13px] font-medium text-[#0066cc] dark:text-[#2997ff] hover:underline"
            >
              {lang === 'ja' ? 'あとで設定' : 'Lewati dulu'}
            </button>
          ) : (
            onClose && (
              <button
                type="button"
                onClick={onClose}
                className="apple-btn-secondary px-4 py-2 text-[13px]"
              >
                {lang === 'ja' ? 'キャンセル' : 'Batal'}
              </button>
            )
          )}

          <button
            type="submit"
            disabled={saving}
            className="apple-btn-primary inline-flex items-center gap-1.5 px-5 py-2 text-[14px] disabled:opacity-50"
          >
            {mode === 'onboarding' ? <UserCheck className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            <span>
              {saving
                ? lang === 'ja'
                  ? '保存中...'
                  : 'Menyimpan...'
                : mode === 'onboarding'
                ? lang === 'ja'
                  ? '保存して進む'
                  : 'Simpan & Lanjutkan'
                : lang === 'ja'
                ? '変更を保存'
                : 'Simpan Profil'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );

  if (mode === 'edit') {
    return (
      <AppleModalSheet open onClose={() => onClose?.()} maxWidthClass="max-w-md">
        {innerContent}
      </AppleModalSheet>
    );
  }

  return (
    <div className="max-w-md w-full bg-white dark:bg-[#1d1d1f] border border-[#d2d2d7]/70 dark:border-[#424245] rounded-[24px]">
      {innerContent}
    </div>
  );
}
