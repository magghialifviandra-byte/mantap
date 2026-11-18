import React, { useState } from 'react';
import { Download, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { LanguageMode } from '../types';
import { AppleModalSheet } from './AppleGestures';

interface Props {
  lang: LanguageMode;
}

export function PWAInstallButton({ lang }: Props) {
  const { canInstall, isIOS, isInstalled, promptInstall } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || (!canInstall && !isIOS)) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (canInstall ? promptInstall() : setShowIOSGuide(true))}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/70 dark:border-[#424245] text-[#0066cc] dark:text-[#2997ff] text-[11px] font-medium hover:bg-[#ececf0] dark:hover:bg-[#3a3a3c] transition-colors whitespace-nowrap shrink-0"
        title={lang === 'id' ? 'Pasang Aplikasi ke Layar Utama' : 'アプリをホーム画面に追加'}
      >
        <Smartphone className="w-3 h-3" />
        <Download className="w-2.5 h-2.5" />
        <span>{lang === 'id' ? 'Pasang App' : 'アプリ追加'}</span>
      </button>

      <AnimatePresence>
        {showIOSGuide && (
          <AppleModalSheet open={showIOSGuide} onClose={() => setShowIOSGuide(false)} maxWidthClass="max-w-sm">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[16px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {lang === 'id' ? 'Pasang di iPhone / iPad' : 'iPhone / iPad に追加'}
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 text-[#6e6e73] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-[13px] text-[#6e6e73] dark:text-[#86868b] space-y-2.5 leading-relaxed">
                <li className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-[#0066cc] dark:text-[#2997ff]">
                    1.
                  </span>
                  <span>
                    {lang === 'id' ? 'Ketuk tombol Bagikan' : 'Safari下部の共有ボタン'}{' '}
                    <Share className="inline w-3.5 h-3.5 text-[#0071e3] dark:text-[#2997ff] mx-0.5" />
                    {lang === 'ja' ? 'をタップ' : ''}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-[#0066cc] dark:text-[#2997ff]">
                    2.
                  </span>
                  <span>
                    {lang === 'id'
                      ? 'Pilih "Tambah ke Layar Utama" (Add to Home Screen)'
                      : '「ホーム画面に追加」を選択してください'}
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-[#0066cc] dark:text-[#2997ff]">
                    3.
                  </span>
                  <span>
                    {lang === 'id'
                      ? 'Ketuk "Tambah" di pojok kanan atas'
                      : '右上の「追加」をタップして完了です'}
                  </span>
                </li>
              </ol>
            </div>
          </AppleModalSheet>
        )}
      </AnimatePresence>
    </>
  );
}

export function OfflineBanner({ lang }: Props) {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="bg-[#1d1d1f] dark:bg-[#2c2c2e] text-[#f5f5f7] text-[12px] font-medium py-1.5 px-4 text-center flex items-center justify-center gap-2 border-b border-[#424245] no-print">
      <WifiOff className="w-3.5 h-3.5 text-[#f59e0b] shrink-0" />
      <span>
        {lang === 'id'
          ? 'Sedang offline — data yang sudah dibuka tetap bisa dilihat.'
          : 'オフライン中です — 読み込み済みデータは引き続き閲覧できます。'}
      </span>
    </div>
  );
}
