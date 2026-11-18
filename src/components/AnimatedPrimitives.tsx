import React, { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { LanguageMode } from '../types';

export type ThemePreference = 'system' | 'light' | 'dark';

export function AnimatedCounter({
  value,
  suffix = '',
  className = '',
}: {
  value: number;
  suffix?: string;
  className?: string;
}) {
  const shouldReduce = useReducedMotion();
  const [displayVal, setDisplayVal] = useState<number>(value);

  useEffect(() => {
    if (shouldReduce) {
      setDisplayVal(value);
      return;
    }
    const startVal = 0;
    const duration = 500;
    const startTime = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayVal(Math.round(startVal + (value - startVal) * eased));
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [value, shouldReduce]);

  return (
    <span className={`tabular-nums ${className}`}>
      {displayVal}
      {suffix}
    </span>
  );
}

export function LiquidToast({ message }: { message: string }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.28, 0.11, 0.32, 1] }}
          className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none no-print"
        >
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-full bg-[#1d1d1f]/95 dark:bg-[#2c2c2e]/95 text-[#f5f5f7] apple-blur-overlay border border-white/10 shadow-lg text-[13px] font-medium max-w-[92vw]">
            <span className="w-4 h-4 rounded-full bg-[#0071e3] dark:bg-[#2997ff] flex items-center justify-center shrink-0">
              <svg viewBox="0 0 16 16" fill="none" className="w-2.5 h-2.5 text-white">
                <path
                  d="M3.5 8.5L6.5 11.5L12.5 5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="truncate">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ThemeModeToggle({
  theme,
  onChange,
  lang,
}: {
  theme: ThemePreference;
  onChange: (next: ThemePreference) => void;
  lang: LanguageMode;
}) {
  const options: { id: ThemePreference; icon: React.ReactNode; title: string }[] = [
    {
      id: 'light',
      icon: <Sun className="w-3.5 h-3.5" />,
      title: lang === 'id' ? 'Mode Terang' : 'ライトモード',
    },
    {
      id: 'system',
      icon: <Monitor className="w-3.5 h-3.5" />,
      title: lang === 'id' ? 'Ikuti Sistem' : 'システム設定',
    },
    {
      id: 'dark',
      icon: <Moon className="w-3.5 h-3.5" />,
      title: lang === 'id' ? 'Mode Gelap' : 'ダークモード',
    },
  ];

  return (
    <div
      className="inline-flex items-center p-0.5 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-[#d2d2d7]/70 dark:border-[#424245] shrink-0"
      role="group"
      aria-label="Theme mode"
    >
      {options.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            aria-label={opt.title}
            onClick={() => onChange(opt.id)}
            className={`relative p-1.5 rounded-full transition-colors whitespace-nowrap shrink-0 ${
              active
                ? 'bg-white dark:bg-[#1d1d1f] text-[#0071e3] dark:text-[#2997ff] shadow-2xs'
                : 'text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]'
            }`}
          >
            <span className="relative z-10 flex items-center justify-center">{opt.icon}</span>
          </button>
        );
      })}
    </div>
  );
}

export function EmptyStateIllustration({
  kind,
  title,
  subtitle,
  action,
}: {
  kind: 'calendar' | 'book' | 'users' | 'clipboard' | 'chart';
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-12 px-6 text-center rounded-[18px] border border-[#d2d2d7]/70 dark:border-[#424245] bg-[#f5f5f7]/60 dark:bg-[#1d1d1f] space-y-3">
      <div className="w-12 h-12 mx-auto rounded-2xl bg-white dark:bg-[#2c2c2e] border border-[#d2d2d7]/70 dark:border-[#424245] flex items-center justify-center">
        <svg viewBox="0 0 48 48" fill="none" className="w-6 h-6" aria-hidden="true">
          {kind === 'calendar' && (
            <>
              <rect
                x="8"
                y="11"
                width="32"
                height="28"
                rx="5"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
              />
              <path
                d="M16 7V13M32 7V13M8 19H40"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </>
          )}
          {kind === 'book' && (
            <>
              <path
                d="M10 12C10 9.8 11.8 8 14 8H36V36H14C11.8 36 10 37.8 10 40V12Z"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
                strokeLinejoin="round"
              />
              <path
                d="M10 36C10 34 11.8 32 14 32H36M17 16H29M17 22H25"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </>
          )}
          {kind === 'users' && (
            <>
              <circle
                cx="20"
                cy="18"
                r="6"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
              />
              <path
                d="M9 36C9 30.5 13.8 27 20 27C26.2 27 31 30.5 31 36"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </>
          )}
          {kind === 'clipboard' && (
            <>
              <rect
                x="11"
                y="10"
                width="26"
                height="30"
                rx="5"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
              />
              <path
                d="M17 21H31M17 28H26"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </>
          )}
          {kind === 'chart' && (
            <>
              <path
                d="M9 36H39"
                className="stroke-[#6e6e73] dark:stroke-[#86868b]"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              <rect x="13" y="23" width="5" height="13" rx="1.5" className="fill-[#6e6e73]/50" />
              <rect x="21.5" y="16" width="5" height="20" rx="1.5" className="fill-[#0071e3] dark:fill-[#2997ff]" />
              <rect x="30" y="11" width="5" height="25" rx="1.5" className="fill-[#6e6e73]/50" />
            </>
          )}
        </svg>
      </div>
      <div className="space-y-1 max-w-md mx-auto">
        <div className="text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{title}</div>
        {subtitle && <p className="text-[13px] text-[#6e6e73] dark:text-[#86868b]">{subtitle}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

export function SkeletonLoadingShell() {
  return (
    <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center p-6">
      <div className="rounded-[24px] border border-[#d2d2d7] dark:border-[#424245] bg-[#f5f5f7] dark:bg-[#1d1d1f] p-7 max-w-md w-full space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full skeleton-shimmer shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 rounded-md skeleton-shimmer" />
            <div className="h-3 w-48 rounded-md skeleton-shimmer" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="h-16 rounded-2xl skeleton-shimmer" />
          <div className="h-16 rounded-2xl skeleton-shimmer" />
        </div>
        <div className="h-10 rounded-full skeleton-shimmer" />
      </div>
    </div>
  );
}
