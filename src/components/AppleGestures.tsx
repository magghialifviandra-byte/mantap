import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  AnimatePresence,
  motion,
  PanInfo,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';

export const APPLE_EASE: [number, number, number, number] = [0.28, 0.11, 0.32, 1];

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Trigger a subtle 5–10ms haptic tap on supported touch devices.
 * Respects prefers-reduced-motion and fails silently if unsupported.
 */
export function triggerHaptic(ms = 7): void {
  if (prefersReducedMotion()) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  } catch {
    // ignore unsupported environments
  }
}

/**
 * Uses the View Transitions API with a graceful fallback to direct callback
 * (or immediate swap under prefers-reduced-motion).
 */
export function runViewTransition(callback: () => void): void {
  if (prefersReducedMotion()) {
    callback();
    return;
  }
  const docWithVT = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  if (typeof docWithVT.startViewTransition === 'function') {
    try {
      docWithVT.startViewTransition(() => {
        callback();
      });
      return;
    } catch {
      // fallback below
    }
  }
  callback();
}

/**
 * Scroll-reveal wrapper for overview pages (Dashboard, Monitoring, Recap, Student Profile).
 * Fades in and rises 24px over 650ms with Apple easing, once per element.
 */
export function AppleScrollReveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const shouldReduce = useReducedMotion();

  if (shouldReduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.65, ease: APPLE_EASE, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * iOS/Apple-grade Modal & Draggable Mobile Bottom Sheet:
 * - Mobile: top drag handle, follows finger 1:1, dismisses if dragged >30% or flicked fast,
 *   backdrop dim/blur fades proportionally to drag distance.
 * - Desktop: centered Apple sheet with smooth scale + fade.
 * - Keyboard Esc and backdrop tap dismiss.
 */
export function AppleModalSheet({
  open = true,
  onClose,
  maxWidthClass = 'max-w-2xl',
  ariaLabelledBy,
  children,
}: {
  open?: boolean;
  onClose: () => void;
  maxWidthClass?: string;
  ariaLabelledBy?: string;
  children: React.ReactNode;
}) {
  const shouldReduce = useReducedMotion();
  const dragY = useMotionValue(0);
  const backdropOpacity = useTransform(dragY, [0, 320], [1, 0.15]);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const sheetHeight = sheetRef.current?.offsetHeight || 480;
    if (info.offset.y > sheetHeight * 0.3 || info.velocity.y > 620) {
      triggerHaptic(8);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby={ariaLabelledBy}
    >
      <motion.div
        style={{ opacity: shouldReduce ? 1 : backdropOpacity }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: APPLE_EASE }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 dark:bg-black/60 apple-blur-overlay"
      />

      <motion.div
        ref={sheetRef}
        style={{ y: shouldReduce ? 0 : dragY }}
        initial={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={shouldReduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.985 }}
        transition={
          shouldReduce
            ? { duration: 0.15 }
            : { type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }
        }
        drag={shouldReduce ? false : 'y'}
        dragConstraints={{ top: 0 }}
        dragElastic={{ top: 0.08, bottom: 0.45 }}
        onDragEnd={handleDragEnd}
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 w-full ${maxWidthClass} max-h-[92vh] flex flex-col overflow-hidden bg-white dark:bg-[#1d1d1f] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#d2d2d7]/70 dark:border-[#424245] rounded-t-[24px] sm:rounded-[24px] shadow-2xl touch-pan-y`}
      >
        <div
          className="sm:hidden w-full pt-2.5 pb-1 flex justify-center shrink-0 cursor-grab active:cursor-grabbing"
          aria-hidden="true"
        >
          <span className="w-9 h-1 rounded-full bg-[#d2d2d7] dark:bg-[#424245]" />
        </div>
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Swipe-left row reveal for mobile touch lists + fallback desktop controls.
 * Never locks desktop users out; swipe reveals actions cleanly on touch viewports.
 */
export function SwipeableMobileRow({
  children,
  actions,
  className = '',
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const shouldReduce = useReducedMotion();
  const [revealed, setRevealed] = useState(false);

  if (!actions || shouldReduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        className={`md:hidden absolute inset-y-0 right-0 flex items-center gap-1 px-2 bg-[#f5f5f7] dark:bg-[#2c2c2e] border-l border-[#d2d2d7] dark:border-[#424245] transition-opacity duration-200 ${
          revealed ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {actions}
      </div>
      <motion.div
        drag="x"
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.15}
        animate={{ x: revealed ? -112 : 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        onDragEnd={(_, info) => {
          if (info.offset.x < -52 || info.velocity.x < -380) {
            triggerHaptic(6);
            setRevealed(true);
          } else if (info.offset.x > 25 || info.velocity.x > 300) {
            setRevealed(false);
          }
        }}
        className="relative bg-inherit"
      >
        {children}
      </motion.div>
    </div>
  );
}

export interface ContextMenuItem {
  id: string;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}

/**
 * Long-press (400ms on touch) + Right-click context menu wrapper on desktop.
 */
export function AppleContextMenuTrigger({
  items,
  children,
  className = '',
}: {
  items: ContextMenuItem[];
  children: React.ReactNode;
  className?: string;
}) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuPos]);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  if (items.length === 0) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      className={className}
      onContextMenu={(e) => {
        e.preventDefault();
        triggerHaptic(7);
        setMenuPos({
          x: Math.min(e.clientX, window.innerWidth - 200),
          y: Math.min(e.clientY, window.innerHeight - 160),
        });
      }}
      onTouchStart={(e) => {
        clearTimer();
        const t = e.touches[0];
        if (!t) return;
        const cx = t.clientX;
        const cy = t.clientY;
        timerRef.current = window.setTimeout(() => {
          triggerHaptic(9);
          setMenuPos({
            x: Math.min(cx, window.innerWidth - 200),
            y: Math.min(cy, window.innerHeight - 160),
          });
        }, 400);
      }}
      onTouchMove={clearTimer}
      onTouchEnd={clearTimer}
      onTouchCancel={clearTimer}
    >
      {children}

      <AnimatePresence>
        {menuPos && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.16, ease: APPLE_EASE }}
            style={{ top: menuPos.y, left: menuPos.x }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-50 min-w-[180px] rounded-[14px] bg-white/90 dark:bg-[#2c2c2e]/95 apple-blur-overlay border border-[#d2d2d7] dark:border-[#424245] shadow-xl py-1 no-print"
            role="menu"
          >
            {items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuPos(null);
                  item.onSelect();
                }}
                className={`w-full text-left px-3.5 py-2 text-[13px] font-medium transition-colors ${
                  idx > 0 ? 'border-t border-[#d2d2d7]/40 dark:border-[#424245]/60' : ''
                } ${
                  item.destructive
                    ? 'text-[#dc2626] dark:text-[#ff453a] hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c]'
                    : 'text-[#1d1d1f] dark:text-[#f5f5f7] hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Pull-to-refresh mobile touch wrapper with rubber-band stretch and subtle spinner.
 */
export function PullToRefreshContainer({
  onRefresh,
  children,
}: {
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  const shouldReduce = useReducedMotion();
  const [pullPx, setPullPx] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);

  if (shouldReduce || !onRefresh) {
    return <>{children}</>;
  }

  return (
    <div
      onTouchStart={(e) => {
        if (window.scrollY <= 2 && e.touches.length === 1) {
          startYRef.current = e.touches[0].clientY;
        } else {
          startYRef.current = null;
        }
      }}
      onTouchMove={(e) => {
        if (startYRef.current === null || window.scrollY > 2) return;
        const delta = e.touches[0].clientY - startYRef.current;
        if (delta > 0) {
          // Damped rubber-band curve
          setPullPx(Math.min(72, delta * 0.42));
        }
      }}
      onTouchEnd={() => {
        if (pullPx > 50 && onRefresh) {
          triggerHaptic(8);
          setRefreshing(true);
          onRefresh();
          window.setTimeout(() => {
            setRefreshing(false);
            setPullPx(0);
          }, 550);
        } else {
          setPullPx(0);
        }
        startYRef.current = null;
      }}
    >
      {(pullPx > 4 || refreshing) && (
        <div
          style={{ height: refreshing ? 40 : Math.round(pullPx * 0.65) }}
          className="md:hidden flex items-center justify-center overflow-hidden transition-all duration-200"
        >
          <RefreshCw
            className={`w-4 h-4 text-[#6e6e73] dark:text-[#86868b] ${
              refreshing ? 'animate-spin' : ''
            }`}
          />
        </div>
      )}
      <div
        style={{
          transform: pullPx > 0 ? `translate3d(0, ${Math.round(pullPx * 0.25)}px, 0)` : undefined,
          transition: startYRef.current === null ? 'transform 260ms cubic-bezier(0.28, 0.11, 0.32, 1)' : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
