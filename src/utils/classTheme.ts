import { ClassId } from '../types';

export interface ClassThemeStyle {
  id: ClassId;
  gradient: string;
  gradientBar: string;
  softBg: string;
  softBorder: string;
  accentText: string;
  dotColor: string;
  ring: string;
}

/**
 * Apple-style restrained class identifiers:
 * Never color tile backgrounds — use neutral surfaces with a small muted colored dot or subtle text label.
 */
export const CLASS_THEMES: Record<ClassId, ClassThemeStyle> = {
  hokkaido: {
    id: 'hokkaido',
    gradient: 'from-[#0071e3] to-[#2997ff]',
    gradientBar: 'bg-[#0071e3] dark:bg-[#2997ff]',
    softBg: 'bg-[#f5f5f7] dark:bg-[#2c2c2e]',
    softBorder: 'border-[#d2d2d7] dark:border-[#424245]',
    accentText: 'text-[#0066cc] dark:text-[#2997ff]',
    dotColor: 'bg-[#3b82f6]/85',
    ring: 'focus:ring-[#0071e3]/30 dark:focus:ring-[#2997ff]/35',
  },
  saitama: {
    id: 'saitama',
    gradient: 'from-[#d97706] to-[#f59e0b]',
    gradientBar: 'bg-[#0071e3] dark:bg-[#2997ff]',
    softBg: 'bg-[#f5f5f7] dark:bg-[#2c2c2e]',
    softBorder: 'border-[#d2d2d7] dark:border-[#424245]',
    accentText: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
    dotColor: 'bg-[#f97316]/85',
    ring: 'focus:ring-[#0071e3]/30 dark:focus:ring-[#2997ff]/35',
  },
  nara: {
    id: 'nara',
    gradient: 'from-[#16a34a] to-[#22c55e]',
    gradientBar: 'bg-[#0071e3] dark:bg-[#2997ff]',
    softBg: 'bg-[#f5f5f7] dark:bg-[#2c2c2e]',
    softBorder: 'border-[#d2d2d7] dark:border-[#424245]',
    accentText: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
    dotColor: 'bg-[#10b981]/85',
    ring: 'focus:ring-[#0071e3]/30 dark:focus:ring-[#2997ff]/35',
  },
  kaigo: {
    id: 'kaigo',
    gradient: 'from-[#6366f1] to-[#8b5cf6]',
    gradientBar: 'bg-[#0071e3] dark:bg-[#2997ff]',
    softBg: 'bg-[#f5f5f7] dark:bg-[#2c2c2e]',
    softBorder: 'border-[#d2d2d7] dark:border-[#424245]',
    accentText: 'text-[#1d1d1f] dark:text-[#f5f5f7]',
    dotColor: 'bg-[#8b5cf6]/85',
    ring: 'focus:ring-[#0071e3]/30 dark:focus:ring-[#2997ff]/35',
  },
};

export function getClassTheme(classId: ClassId | 'all'): ClassThemeStyle | null {
  if (classId === 'all') return null;
  return CLASS_THEMES[classId] || null;
}

export function detectClassIdFromText(raw?: string): ClassId | null {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('hokkaido') || s.includes('北海道')) return 'hokkaido';
  if (s.includes('saitama') || s.includes('埼玉')) return 'saitama';
  if (s.includes('nara') || s.includes('奈良')) return 'nara';
  if (s.includes('kaigo') || s.includes('介護')) return 'kaigo';
  return null;
}
