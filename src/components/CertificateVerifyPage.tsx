import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { CheckCircle2, ShieldAlert, Search, Award } from 'lucide-react';
import { db } from '../firebase';
import { CertificateVerificationDoc } from '../types';

interface CertificateVerifyPageProps {
  certNumber: string;
}

export const CertificateVerifyPage: React.FC<CertificateVerifyPageProps> = ({ certNumber }) => {
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<CertificateVerificationDoc | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let active = true;
    const cleanId = certNumber.trim();
    if (!cleanId || !/^[a-zA-Z0-9_-]{1,128}$/.test(cleanId)) {
      setLoading(false);
      setErrorMsg('無効な証書番号形式です / Format nomor sertifikat tidak valid.');
      return;
    }

    getDoc(doc(db, 'certificateVerifications', cleanId))
      .then((snap) => {
        if (!active) return;
        if (snap.exists()) {
          setRecord(snap.data() as CertificateVerificationDoc);
        } else {
          setRecord(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setErrorMsg('認証情報の取得に失敗しました / Gagal memuat status sertifikat.');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [certNumber]);

  const isValid = record?.status === 'valid';

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-[#000000] text-[#1d1d1f] dark:text-[#f5f5f7] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg rounded-[24px] bg-white dark:bg-[#1d1d1f] border border-black/10 dark:border-white/10 p-7 sm:p-9">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-[#0071e3]/10 dark:bg-[#2997ff]/15 text-[#0071e3] dark:text-[#2997ff] flex items-center justify-center">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              修了証書 オンライン認証
            </h1>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
              Verifikasi Sertifikat Resmi · Certificate Verification
            </p>
          </div>
        </div>

        {loading ? (
          <div className="py-10 text-center space-y-2">
            <div className="w-7 h-7 border-2 border-[#0071e3] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-[#6e6e73] dark:text-[#86868b]">
              確認中... / Memverifikasi...
            </p>
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#161617] p-5 text-center space-y-2">
            <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto" />
            <p className="text-sm font-medium">{errorMsg}</p>
          </div>
        ) : !record ? (
          <div className="rounded-2xl bg-[#f5f5f7] dark:bg-[#161617] p-6 text-center space-y-2">
            <Search className="w-8 h-8 text-[#6e6e73] mx-auto" />
            <p className="text-base font-semibold">該当する証書が見つかりません</p>
            <p className="text-xs text-[#6e6e73] dark:text-[#86868b]">
              Sertifikat dengan nomor <span className="font-mono font-semibold">{certNumber}</span> tidak ditemukan.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div
              className={`rounded-2xl p-4 flex items-center gap-3 border ${
                isValid
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/50 text-rose-800 dark:text-rose-300'
              }`}
            >
              {isValid ? (
                <CheckCircle2 className="w-6 h-6 shrink-0" />
              ) : (
                <ShieldAlert className="w-6 h-6 shrink-0" />
              )}
              <div>
                <p className="text-sm font-bold">
                  {isValid ? '有効 / Valid' : '無効・取消済 / Revoked'}
                </p>
                <p className="text-xs opacity-85">
                  {isValid
                    ? 'この修了証書は学校により正式に発行されています。'
                    : 'この証書は管理者により無効化（取消または再発行済）されています。'}
                </p>
              </div>
            </div>

            <dl className="divide-y divide-black/5 dark:divide-white/10 text-sm">
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-[#6e6e73] dark:text-[#86868b]">証書番号 / No. Sertifikat</dt>
                <dd className="font-mono font-semibold tabular-nums">{record.certificateNumber}</dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-[#6e6e73] dark:text-[#86868b]">氏名 / Nama Siswa</dt>
                <dd className="font-semibold text-right">{record.studentName}</dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-[#6e6e73] dark:text-[#86868b]">プログラム / Program</dt>
                <dd className="font-medium text-right">{record.programLabel}</dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-[#6e6e73] dark:text-[#86868b]">修了日 / Tgl Selesai</dt>
                <dd className="font-medium tabular-nums">{record.completionDate}</dd>
              </div>
              <div className="py-3 flex justify-between gap-4">
                <dt className="text-[#6e6e73] dark:text-[#86868b]">発行機関 / Sekolah</dt>
                <dd className="font-medium text-right">{record.schoolNameJa}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-black/5 dark:border-white/10 flex justify-between items-center text-xs text-[#6e6e73] dark:text-[#86868b]">
          <span>Public Verification Portal</span>
          <a
            href="/"
            className="text-[#0071e3] dark:text-[#2997ff] font-medium hover:underline"
          >
            ポータルへ / Masuk Portal →
          </a>
        </div>
      </div>
    </div>
  );
};
