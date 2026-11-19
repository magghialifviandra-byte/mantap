import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { CertificateRecord, CLASSES, SchoolSettings } from '../types';

interface CertificateDocumentProps {
  certificate: CertificateRecord;
  settings: SchoolSettings;
  id?: string;
  className?: string;
}

export const CertificateDocument: React.FC<CertificateDocumentProps> = ({
  certificate,
  settings,
  id,
  className = '',
}) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const cls = CLASSES.find((c) => c.id === certificate.classId);

  useEffect(() => {
    let active = true;
    const baseUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/?verify=${encodeURIComponent(certificate.certificateNumber)}`
        : `/?verify=${encodeURIComponent(certificate.certificateNumber)}`;
    QRCode.toDataURL(baseUrl, {
      width: 140,
      margin: 1,
      color: { dark: '#111111', light: '#fdfcf8' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [certificate.certificateNumber]);

  const secondLang = settings.certSecondLanguage || 'none';
  const subTitle =
    secondLang === 'id'
      ? 'SERTIFIKAT KELULUSAN'
      : secondLang === 'en'
        ? 'CERTIFICATE OF COMPLETION'
        : '';

  const subBody =
    secondLang === 'id'
      ? `Dengan ini dinyatakan bahwa peserta tersebut di atas telah menyelesaikan Program Bahasa Jepang (${certificate.programMonths} Bulan) di lembaga kami.`
      : secondLang === 'en'
        ? `This is to certify that the student named above has successfully completed the ${certificate.programMonths}-Month Japanese Language Program.`
        : '';

  return (
    <article
      id={id}
      style={{
        fontFamily: '"Noto Serif JP", "Noto Sans JP", Georgia, serif',
        backgroundColor: '#fdfcf8',
        color: '#111111',
        width: '1122px',
        height: '793px',
        padding: '28px',
        boxSizing: 'border-box',
      }}
      className={`mx-auto relative flex flex-col justify-between bg-[#fdfcf8] text-[#111111] select-text ${className}`}
    >
      {/* Formal Double-Line Border */}
      <div
        style={{
          border: '2.5px solid #1d1d1f',
          padding: '6px',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            border: '1px solid #8c734b',
            height: '100%',
            padding: '34px 54px 28px 54px',
            boxSizing: 'border-box',
          }}
          className="flex flex-col justify-between relative"
        >
          {/* Revoked Watermark if revoked */}
          {certificate.status === 'revoked' && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="border-4 border-[#9b1c1c] text-[#9b1c1c] px-8 py-2 text-3xl font-bold tracking-[0.25em] opacity-25 -rotate-12">
                無効 / REVOKED
              </span>
            </div>
          )}

          {/* Top: School Logo & Name */}
          <header className="flex flex-col items-center text-center">
            <div className="flex items-center gap-3">
              {settings.showLogo && settings.logoDataUrl ? (
                <img
                  src={settings.logoDataUrl}
                  alt={settings.schoolNameJa}
                  className="h-12 w-12 object-contain"
                />
              ) : null}
              <div>
                <p className="text-[15px] font-semibold tracking-[0.12em]">
                  {settings.schoolNameJa}
                </p>
                {settings.schoolNameEn && (
                  <p
                    style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
                    className="text-[9.5px] tracking-[0.16em] text-[#555555] mt-0.5"
                  >
                    {settings.schoolNameEn}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5">
              <h1 className="text-[40px] font-bold tracking-[0.42em] pl-[0.42em] text-[#111111]">
                修了証書
              </h1>
              {subTitle && (
                <p
                  style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
                  className="text-[11px] tracking-[0.26em] text-[#6b5a3e] mt-1.5 font-semibold"
                >
                  {subTitle}
                </p>
              )}
              <div className="w-28 h-[1px] bg-[#8c734b] mx-auto mt-3" />
            </div>
          </header>

          {/* Center: Recipient & Statement */}
          <main className="text-center my-auto py-4">
            <p
              style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
              className="text-[11px] tracking-[0.14em] text-[#555555] mb-1.5"
            >
              {certificate.studentCode ? `学籍番号 ${certificate.studentCode}` : ''}
            </p>
            <h2 className="text-[32px] font-bold tracking-[0.14em] text-[#111111] inline-block border-b border-[#8c734b] pb-1.5 px-8">
              {certificate.studentName} <span className="text-[20px] font-normal ml-1">殿</span>
            </h2>

            <p className="text-[16.5px] leading-[1.9] mt-6 max-w-[780px] mx-auto font-medium">
              あなたは本校の日本語学習プログラム（{certificate.programMonths}か月）を修了したことを証します。
            </p>

            {subBody && (
              <p
                style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
                className="text-[11.5px] leading-[1.65] text-[#444444] mt-2 max-w-[760px] mx-auto"
              >
                {subBody}
              </p>
            )}

            {/* Program & Optional Score Row */}
            <div
              style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
              className="mt-5 text-[11.5px] text-[#333333] flex flex-wrap items-center justify-center gap-x-5 gap-y-1 tabular-nums"
            >
              <span>クラス：{cls?.nameJa || certificate.classId}</span>
              <span>·</span>
              <span>
                学習期間：{certificate.programStartDate} 〜 {certificate.programEndDate}
              </span>
              {settings.certShowScores && (
                <>
                  <span>·</span>
                  <span>
                    最終平均：{certificate.finalAvg !== null ? `${certificate.finalAvg}%` : '—'}（評価{' '}
                    {certificate.overallGradeLabel || '—'}）
                  </span>
                </>
              )}
            </div>
          </main>

          {/* Bottom: QR Verification + Cert Number + Head Master Stamp */}
          <footer
            style={{ fontFamily: '"Noto Sans JP", sans-serif' }}
            className="flex items-end justify-between gap-6 pt-3"
          >
            {/* Left: QR Code & Certificate Metadata */}
            <div className="flex items-end gap-3.5">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR ${certificate.certificateNumber}`}
                  className="w-[74px] h-[74px] border border-[#d6d3ca] bg-white p-0.5"
                />
              ) : (
                <div className="w-[74px] h-[74px] border border-[#d6d3ca] flex items-center justify-center text-[9px] text-[#777]">
                  QR
                </div>
              )}
              <div className="text-[10.5px] text-[#333333] leading-[1.65] tabular-nums">
                <p>
                  証書番号：<span className="font-semibold text-[#111111]">{certificate.certificateNumber}</span>
                </p>
                <p>修了日：{certificate.completionDate}</p>
                <p>発行日：{certificate.issueDate}</p>
              </div>
            </div>

            {/* Right: School & Head Master Signature / Seal */}
            <div className="flex items-end gap-4 text-right">
              <div>
                <p className="text-[12.5px] font-semibold text-[#111111]">{settings.schoolNameJa}</p>
                <p className="text-[12px] mt-1">
                  校長　<span className="font-bold text-[14px]">{settings.headMasterName || '—'}</span>
                </p>
                {settings.showSignature && settings.headSignatureDataUrl && (
                  <img
                    src={settings.headSignatureDataUrl}
                    alt="校長署名"
                    className="h-9 ml-auto mt-1 object-contain"
                  />
                )}
              </div>

              <div className="w-14 h-14 flex items-center justify-center shrink-0">
                {settings.showHanko && settings.headHankoDataUrl ? (
                  <img
                    src={settings.headHankoDataUrl}
                    alt="校長印"
                    className="w-14 h-14 object-contain"
                  />
                ) : (
                  <span className="w-12 h-12 rounded-sm border border-dashed border-[#8c734b] flex items-center justify-center text-[11px] text-[#8c734b]">
                    公印
                  </span>
                )}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </article>
  );
};
