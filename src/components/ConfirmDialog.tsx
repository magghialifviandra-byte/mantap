import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { LanguageMode } from '../types';
import { AppleModalSheet } from './AppleGestures';

interface Props {
  open: boolean;
  lang: LanguageMode;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  lang,
  title,
  message,
  confirmLabel,
  cancelLabel,
  isDestructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const resolvedCancel =
    cancelLabel || (lang === 'ja' ? 'キャンセル' : lang === 'id' ? 'Batal' : 'キャンセル / Batal');
  const resolvedConfirm =
    confirmLabel ||
    (isDestructive
      ? lang === 'ja'
        ? '削除する'
        : lang === 'id'
        ? 'Hapus'
        : '削除 / Hapus'
      : lang === 'ja'
      ? '確定する'
      : lang === 'id'
      ? 'Konfirmasi'
      : '確定 / Konfirmasi');

  return (
    <AnimatePresence>
      {open && (
        <AppleModalSheet
          open={open}
          onClose={() => !busy && onCancel()}
          maxWidthClass="max-w-md"
          ariaLabelledBy="confirm-dialog-title"
        >
          <div className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isDestructive
                      ? 'bg-[#dc2626]/10 text-[#dc2626] dark:text-[#ff453a]'
                      : 'bg-[#0071e3]/10 text-[#0071e3] dark:text-[#2997ff]'
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h2
                  id="confirm-dialog-title"
                  className="text-[17px] font-semibold tracking-[-0.015em] text-[#1d1d1f] dark:text-[#f5f5f7]"
                >
                  {title}
                </h2>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                aria-label="Close"
                className="p-1.5 text-[#6e6e73] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] rounded-full hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-[14px] text-[#6e6e73] dark:text-[#86868b] leading-relaxed whitespace-pre-line">
              {message}
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={onCancel}
                className="apple-btn-secondary px-4 py-2 text-[13px] whitespace-nowrap shrink-0"
              >
                {resolvedCancel}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onConfirm}
                className={`px-5 py-2 text-[13px] font-medium text-white rounded-full whitespace-nowrap shrink-0 disabled:opacity-50 transition-colors ${
                  isDestructive
                    ? 'bg-[#dc2626] hover:bg-[#b91c1c]'
                    : 'bg-[#0071e3] hover:bg-[#0077ed]'
                }`}
              >
                {busy ? (lang === 'ja' ? '処理中...' : 'Memproses...') : resolvedConfirm}
              </button>
            </div>
          </div>
        </AppleModalSheet>
      )}
    </AnimatePresence>
  );
}
