import React from 'react';

interface Props {
  text: string;
  showFurigana?: boolean;
  className?: string;
}

/**
 * Renders inline furigana written as 漢字[ふりがな] into clean <ruby> tags.
 * Plain text without bracket notation renders verbatim without altering spacing.
 * When showFurigana is false, bracketed readings are stripped cleanly.
 */
export function FuriganaText({ text, showFurigana = true, className }: Props) {
  if (!text) return null;

  if (!showFurigana) {
    return <span className={className}>{text.replace(/\[[^\]]+\]/g, '')}</span>;
  }

  const tokenRegex = /([\u4e00-\u9faf\u3005\u30f6]+)\[([^\]]+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const kanji = match[1];
    const reading = match[2];
    parts.push(
      <ruby key={`rb_${keyIdx++}`} className="ruby-align">
        {kanji}
        <rp>(</rp>
        <rt className="text-[0.62em] font-normal text-[#6e6e73] dark:text-[#a1a1a6] select-none">
          {reading}
        </rt>
        <rp>)</rp>
      </ruby>
    );
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex === 0) {
    return <span className={className}>{text}</span>;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className={className}>{parts}</span>;
}
