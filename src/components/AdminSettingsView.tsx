import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Award, Check, Image as ImageIcon, Scale, Settings, Stamp, Trash2 } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CertificateSecondLanguage,
  GradeScaleMode,
  LanguageMode,
  QualityThresholds,
  SchoolSettings,
  UserProfile,
} from '../types';
import { logActivity } from '../utils/activityLog';
import { clampNum, clampStr } from '../utils/payloadGuards';
import { LiquidToast } from './AnimatedPrimitives';

interface AdminSettingsViewProps {
  lang: LanguageMode;
  profile: UserProfile;
  schoolSettings: SchoolSettings;
  thresholds: QualityThresholds;
}

const MAX_IMAGE_LEN = 175000;

async function compressBrandImage(file: File, maxDim = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        // Prefer PNG to keep transparency for logos/hanko/signatures; fallback to WebP/JPEG if large
        let out = canvas.toDataURL('image/png');
        if (out.length > MAX_IMAGE_LEN) {
          let q = 0.85;
          out = canvas.toDataURL('image/webp', q);
          while (out.length > MAX_IMAGE_LEN && q > 0.3) {
            q -= 0.15;
            out = canvas.toDataURL('image/webp', q);
          }
        }
        if (out.length > MAX_IMAGE_LEN) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          out = canvas.toDataURL('image/jpeg', 0.72);
        }
        resolve(out);
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}

export const AdminSettingsView: React.FC<AdminSettingsViewProps> = ({
  lang,
  profile,
  schoolSettings,
  thresholds,
}) => {
  const [draft, setDraft] = useState<SchoolSettings>(schoolSettings);
  const [examW, setExamW] = useState<number>(thresholds.examWeightPercent);
  const [attW, setAttW] = useState<number>(thresholds.attitudeWeightPercent);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    setDraft(schoolSettings);
  }, [schoolSettings]);

  useEffect(() => {
    setExamW(thresholds.examWeightPercent);
    setAttW(thresholds.attitudeWeightPercent);
  }, [thresholds]);

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'logoDataUrl' | 'headHankoDataUrl' | 'senseiHankoDataUrl' | 'headSignatureDataUrl',
    maxDim: number
  ) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg(
        lang === 'ja' ? '画像ファイルを選択してください。' : 'Pilih file gambar yang valid.'
      );
      return;
    }
    try {
      const dataUrl = await compressBrandImage(file, maxDim);
      if (dataUrl.length > MAX_IMAGE_LEN) {
        setErrorMsg(
          lang === 'ja'
            ? '画像サイズが大きすぎます。より小さい画像をお試しください。'
            : 'Ukuran gambar terlalu besar.'
        );
        return;
      }
      setDraft((prev) => ({ ...prev, [field]: dataUrl }));
    } catch {
      setErrorMsg(lang === 'ja' ? '画像の読み込みに失敗しました。' : 'Gagal memproses gambar.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    // Validate descending cutoffs
    if (
      !(
        draft.level5Min > draft.level4Min &&
        draft.level4Min > draft.level3Min &&
        draft.level3Min > draft.level2Min
      )
    ) {
      setErrorMsg(
        lang === 'ja'
          ? '5段階評価の境界点は 5 > 4 > 3 > 2 の順に設定してください。'
          : 'Batas nilai skala 5 harus berurutan menurun (5 > 4 > 3 > 2).'
      );
      return;
    }
    if (!(draft.letterAMin > draft.letterBMin && draft.letterBMin > draft.letterCMin)) {
      setErrorMsg(
        lang === 'ja'
          ? 'A/B/C/D評価の境界点は A > B > C の順に設定してください。'
          : 'Batas nilai huruf harus berurutan menurun (A > B > C).'
      );
      return;
    }

    const cleanSchoolCode =
      clampStr(draft.schoolCode.toUpperCase().replace(/[^A-Z0-9_-]/g, ''), 12) || 'GA';

    setSaving(true);
    try {
      await setDoc(doc(db, 'schoolSettings', 'default'), {
        schoolNameJa: clampStr(draft.schoolNameJa, 120) || '元気アカデミー日本語学校',
        schoolNameEn: clampStr(draft.schoolNameEn, 160),
        schoolCode: cleanSchoolCode,
        logoDataUrl: draft.logoDataUrl || '',
        showLogo: Boolean(draft.showLogo),
        headMasterName: clampStr(draft.headMasterName, 100),
        headHankoDataUrl: draft.headHankoDataUrl || '',
        senseiHankoDataUrl: draft.senseiHankoDataUrl || '',
        showHanko: Boolean(draft.showHanko),
        headSignatureDataUrl: draft.headSignatureDataUrl || '',
        showSignature: Boolean(draft.showSignature),
        gradeScaleMode: draft.gradeScaleMode,
        level5Min: clampNum(draft.level5Min, 0, 100),
        level4Min: clampNum(draft.level4Min, 0, 100),
        level3Min: clampNum(draft.level3Min, 0, 100),
        level2Min: clampNum(draft.level2Min, 0, 100),
        letterAMin: clampNum(draft.letterAMin, 0, 100),
        letterBMin: clampNum(draft.letterBMin, 0, 100),
        letterCMin: clampNum(draft.letterCMin, 0, 100),
        showRankOnReportCard: Boolean(draft.showRankOnReportCard),
        showIdSubtitleOnReportCard: Boolean(draft.showIdSubtitleOnReportCard),
        certSecondLanguage: draft.certSecondLanguage,
        certShowScores: Boolean(draft.certShowScores),
        certMinFinalAvg: clampNum(draft.certMinFinalAvg, 0, 100),
        certMinAttendanceRate: clampNum(draft.certMinAttendanceRate, 0, 100),
        certMinAttitudeScore: clampNum(Number(draft.certMinAttitudeScore), 1, 5),
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      });

      const cleanExamW = clampNum(examW, 0, 100);
      const cleanAttW = clampNum(attW, 0, 100);
      if (
        cleanExamW !== thresholds.examWeightPercent ||
        cleanAttW !== thresholds.attitudeWeightPercent
      ) {
        await setDoc(doc(db, 'qualitySettings', 'default'), {
          minWeeklyAvgThreshold: thresholds.minWeeklyAvgThreshold,
          consecutiveDropWeeks: thresholds.consecutiveDropWeeks,
          maxAbsentDays: thresholds.maxAbsentDays,
          minAttitudeThreshold: thresholds.minAttitudeThreshold,
          examWeightPercent: cleanExamW,
          attitudeWeightPercent: cleanAttW,
          updatedBy: profile.uid,
          updatedAt: serverTimestamp(),
        });
      }

      await logActivity({
        actor: profile,
        actionType: 'school_settings_update',
        targetType: 'settings',
        targetLabel: 'Report Card & Certificate Settings',
        detail: `Scale: ${draft.gradeScaleMode}, Weight: ${cleanExamW}/${cleanAttW}, CertMin: ${draft.certMinFinalAvg}%/${draft.certMinAttendanceRate}%/${draft.certMinAttitudeScore}`,
      });

      setToast(
        lang === 'ja' ? '通知表・修了証書設定を保存しました' : 'Pengaturan rapor & sertifikat disimpan'
      );
      setTimeout(() => setToast(''), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'schoolSettings/default');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <LiquidToast message={toast} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="apple-compact-title">
            {lang === 'ja' ? '通知表・修了証書 設定' : 'Pengaturan Rapor & Sertifikat'}
          </h1>
          <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] mt-1">
            {lang === 'ja'
              ? '評価基準・配分ウエイト・学校ロゴ/印影・修了要件を管理します（管理者専用）。'
              : 'Atur skala nilai, bobot, logo & stempel sekolah, serta syarat kelulusan sertifikat (Khusus Admin).'}
          </p>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[14px] px-4 py-3 text-[13px] bg-[#fef2f2] dark:bg-[#2c1517] border border-[#fecaca] dark:border-[#7f1d1d] text-[#991b1b] dark:text-[#fca5a5]">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSaveAll} className="space-y-6">
        {/* 1. Grade Scale & Weighting */}
        <section className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5 text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            <Scale className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
            <span>
              {lang === 'ja'
                ? '評価基準・総合スコア配分'
                : 'Skala Nilai & Bobot Evaluasi Akhir'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[13px]">
            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1.5 font-medium">
                {lang === 'ja' ? '評価表記方式' : 'Format Skala Nilai'}
              </label>
              <select
                value={draft.gradeScaleMode}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, gradeScaleMode: e.target.value as GradeScaleMode }))
                }
                className="w-full glass-input px-3 py-2 rounded-[12px]"
              >
                <option value="five_level">
                  {lang === 'ja' ? '5段階評価 (5, 4, 3, 2, 1)' : '5 Tingkat (5, 4, 3, 2, 1)'}
                </option>
                <option value="letter">
                  {lang === 'ja' ? '段階評価 (A, B, C, D)' : 'Huruf (A, B, C, D)'}
                </option>
              </select>
            </div>

            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1.5 font-medium">
                {lang === 'ja' ? '週次試験ウエイト (%)' : 'Bobot Ujian Mingguan (%)'}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={examW}
                onChange={(e) => setExamW(Number(e.target.value))}
                className="w-full glass-input px-3 py-2 font-mono tabular-nums rounded-[12px]"
              />
            </div>

            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1.5 font-medium">
                {lang === 'ja' ? '学習態度ウエイト (%)' : 'Bobot Sikap Belajar (%)'}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={attW}
                onChange={(e) => setAttW(Number(e.target.value))}
                className="w-full glass-input px-3 py-2 font-mono tabular-nums rounded-[12px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50">
            {/* 5-Level Ranges */}
            <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[16px] p-4 space-y-3">
              <div className="text-[13px] font-semibold">
                {lang === 'ja' ? '5段階評価 スコア下限 (%)' : 'Batas Skor Skala 5 Tingkat (%)'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[12px]">
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">5 (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.level5Min}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, level5Min: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">4 (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.level4Min}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, level4Min: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">3 (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.level3Min}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, level3Min: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">2 (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.level2Min}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, level2Min: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'ja'
                  ? `${draft.level2Min}% 未満は「1」になります。`
                  : `Skor di bawah ${draft.level2Min}% bernilai "1".`}
              </p>
            </div>

            {/* Letter Ranges */}
            <div className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[16px] p-4 space-y-3">
              <div className="text-[13px] font-semibold">
                {lang === 'ja' ? 'A〜D 段階評価 スコア下限 (%)' : 'Batas Skor Huruf A–D (%)'}
              </div>
              <div className="grid grid-cols-3 gap-2.5 text-[12px]">
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">A (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.letterAMin}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, letterAMin: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">B (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.letterBMin}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, letterBMin: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
                <div>
                  <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">C (≥)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.letterCMin}
                    onChange={(e) =>
                      setDraft((p) => ({ ...p, letterCMin: Number(e.target.value) }))
                    }
                    className="w-full glass-input px-2.5 py-1.5 font-mono rounded-[10px]"
                  />
                </div>
              </div>
              <p className="text-[11px] text-[#6e6e73] dark:text-[#86868b]">
                {lang === 'ja'
                  ? `${draft.letterCMin}% 未満は「D」になります。`
                  : `Skor di bawah ${draft.letterCMin}% bernilai "D".`}
              </p>
            </div>
          </div>
        </section>

        {/* 2. Certificate Conditions & Document Display */}
        <section className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5 text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            <Award className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
            <span>
              {lang === 'ja'
                ? '修了証書の授与条件・帳票表示設定'
                : 'Syarat Sertifikat & Tampilan Dokumen'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-[13px]">
            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '最低最終テスト平均 (%)' : 'Min. Rata-rata Ujian Akhir (%)'}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.certMinFinalAvg}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, certMinFinalAvg: Number(e.target.value) }))
                }
                className="w-full glass-input px-3 py-2 font-mono rounded-[12px]"
              />
            </div>
            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '最低出席率 (%)' : 'Min. Kehadiran (%)'}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={draft.certMinAttendanceRate}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, certMinAttendanceRate: Number(e.target.value) }))
                }
                className="w-full glass-input px-3 py-2 font-mono rounded-[12px]"
              />
            </div>
            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '最低態度平均 (1.0〜5.0)' : 'Min. Rata-rata Sikap (1–5)'}
              </label>
              <input
                type="number"
                step="0.1"
                min={1}
                max={5}
                value={draft.certMinAttitudeScore}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, certMinAttitudeScore: Number(e.target.value) }))
                }
                className="w-full glass-input px-3 py-2 font-mono rounded-[12px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#d2d2d7]/50 dark:border-[#424245]/50 text-[13px]">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.showRankOnReportCard}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, showRankOnReportCard: e.target.checked }))
                }
              />
              <span>
                {lang === 'ja'
                  ? '通知表にクラス順位を表示する（既定: オフ）'
                  : 'Tampilkan peringkat kelas pada rapor (default: nonaktif)'}
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.showIdSubtitleOnReportCard}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, showIdSubtitleOnReportCard: e.target.checked }))
                }
              />
              <span>
                {lang === 'ja'
                  ? '通知表の見出し下にインドネシア語訳を表示する'
                  : 'Tampilkan terjemahan Bahasa Indonesia di bawah judul Jepang pada rapor'}
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.certShowScores}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, certShowScores: e.target.checked }))
                }
              />
              <span>
                {lang === 'ja'
                  ? '修了証書に最終平均・評価を表示する'
                  : 'Cantumkan nilai akhir & predikat di sertifikat'}
              </span>
            </label>

            <div className="flex items-center gap-3">
              <span className="text-[#6e6e73] dark:text-[#86868b] whitespace-nowrap">
                {lang === 'ja' ? '修了証書 第2言語:' : 'Bahasa kedua sertifikat:'}
              </span>
              <select
                value={draft.certSecondLanguage}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    certSecondLanguage: e.target.value as CertificateSecondLanguage,
                  }))
                }
                className="glass-input px-3 py-1.5 rounded-[10px] text-[13px]"
              >
                <option value="none">{lang === 'ja' ? '日本語のみ' : 'Jepang Saja'}</option>
                <option value="id">Bahasa Indonesia</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </section>

        {/* 3. School Identity, Logo, Hanko Seals & Signature */}
        <section className="apple-tile border border-[#d2d2d7]/60 dark:border-[#424245]/80 p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2.5 text-[17px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
            <Stamp className="w-4 h-4 text-[#0071e3] dark:text-[#2997ff]" />
            <span>
              {lang === 'ja'
                ? '学校情報・ロゴ・印影（はんこ）・校長署名'
                : 'Identitas Sekolah, Logo, Stempel (Hanko) & Tanda Tangan'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[13px]">
            <div className="sm:col-span-2">
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '学校名（日本語）*' : 'Nama Sekolah (Jepang) *'}
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={draft.schoolNameJa}
                onChange={(e) => setDraft((p) => ({ ...p, schoolNameJa: e.target.value }))}
                className="w-full glass-input px-3 py-2 rounded-[12px]"
              />
            </div>
            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '学校コード (証書番号用)' : 'Kode Sekolah (No. Sertifikat)'}
              </label>
              <input
                type="text"
                required
                maxLength={12}
                value={draft.schoolCode}
                onChange={(e) => setDraft((p) => ({ ...p, schoolCode: e.target.value }))}
                placeholder="GA"
                className="w-full glass-input px-3 py-2 font-mono uppercase rounded-[12px]"
              />
            </div>
            <div>
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '校長氏名' : 'Nama Kepala Sekolah'}
              </label>
              <input
                type="text"
                maxLength={100}
                value={draft.headMasterName}
                onChange={(e) => setDraft((p) => ({ ...p, headMasterName: e.target.value }))}
                className="w-full glass-input px-3 py-2 rounded-[12px]"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <label className="block text-[#6e6e73] dark:text-[#86868b] mb-1">
                {lang === 'ja' ? '学校名（英語表記・任意）' : 'Nama Sekolah (Inggris / Opsional)'}
              </label>
              <input
                type="text"
                maxLength={160}
                value={draft.schoolNameEn}
                onChange={(e) => setDraft((p) => ({ ...p, schoolNameEn: e.target.value }))}
                className="w-full glass-input px-3 py-2 rounded-[12px]"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-5 pt-1 text-[13px]">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.showLogo}
                onChange={(e) => setDraft((p) => ({ ...p, showLogo: e.target.checked }))}
              />
              <span>{lang === 'ja' ? 'ロゴを表示' : 'Tampilkan Logo'}</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.showHanko}
                onChange={(e) => setDraft((p) => ({ ...p, showHanko: e.target.checked }))}
              />
              <span>{lang === 'ja' ? '印影（はんこ）を表示' : 'Tampilkan Stempel (Hanko)'}</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.showSignature}
                onChange={(e) => setDraft((p) => ({ ...p, showSignature: e.target.checked }))}
              />
              <span>{lang === 'ja' ? '校長署名画像を表示' : 'Tampilkan Tanda Tangan'}</span>
            </label>
          </div>

          {/* 4 Upload Boxes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(
              [
                {
                  key: 'logoDataUrl',
                  label: lang === 'ja' ? '学校ロゴ' : 'Logo Sekolah',
                  maxDim: 320,
                },
                {
                  key: 'headHankoDataUrl',
                  label: lang === 'ja' ? '校長印 (はんこ)' : 'Hanko Kepala Sekolah',
                  maxDim: 220,
                },
                {
                  key: 'senseiHankoDataUrl',
                  label: lang === 'ja' ? '担任印 (はんこ)' : 'Hanko Wali Kelas',
                  maxDim: 220,
                },
                {
                  key: 'headSignatureDataUrl',
                  label: lang === 'ja' ? '校長署名画像' : 'Tanda Tangan Kepala',
                  maxDim: 360,
                },
              ] as const
            ).map((item) => {
              const val = draft[item.key];
              return (
                <div
                  key={item.key}
                  className="bg-[#f5f5f7] dark:bg-[#161617] rounded-[16px] p-4 flex flex-col items-center justify-between gap-3 text-center"
                >
                  <div className="text-[12px] font-semibold">{item.label}</div>
                  <div className="w-20 h-20 rounded-[12px] bg-white border border-[#d2d2d7] flex items-center justify-center overflow-hidden p-1.5">
                    {val ? (
                      <img src={val} alt={item.label} className="max-w-full max-h-full object-contain" />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-[#86868b]" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="apple-btn-secondary px-3 py-1 text-[11px] cursor-pointer">
                      <span>{lang === 'ja' ? '選択' : 'Unggah'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleImageUpload(e, item.key, item.maxDim)}
                      />
                    </label>
                    {val && (
                      <button
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, [item.key]: '' }))}
                        className="p-1 text-[#dc2626] dark:text-[#ff453a]"
                        aria-label={`Remove ${item.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="apple-btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-[14px] disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            <span>
              {saving
                ? lang === 'ja'
                  ? '保存中...'
                  : 'Menyimpan...'
                : lang === 'ja'
                  ? 'すべての設定を保存'
                  : 'Simpan Semua Pengaturan'}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};
