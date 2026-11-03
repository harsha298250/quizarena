/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import { NOTO_SANS_TAMIL_BASE64, NOTO_SANS_DEVANAGARI_BASE64 } from './unicodeFontData';

export interface CertificateData {
  studentName: string;
  quizTitle: string;
  rank: number;
  totalPlayers: number;
  score: number;
  accuracy: number;
  date: string;
  hostName?: string;
  competitionTitle?: string;
  certificateNumber?: string;
  verificationId?: string;
}

/**
 * Detects language script requirement from text content and configures jsPDF font.
 */
export function configureCertificateFont(doc: jsPDF, fullText: string): { fontName: string; isUnicode: boolean } {
  const hasTamil = /[\u0B80-\u0BFF]/.test(fullText);
  const hasDevanagari = /[\u0900-\u097F]/.test(fullText);

  if (hasTamil) {
    try {
      doc.addFileToVFS('NotoSansTamil.ttf', NOTO_SANS_TAMIL_BASE64);
      doc.addFont('NotoSansTamil.ttf', 'NotoSansTamil', 'normal');
      doc.setFont('NotoSansTamil');
      return { fontName: 'NotoSansTamil', isUnicode: true };
    } catch {
      // Fallback if already added
      doc.setFont('NotoSansTamil');
      return { fontName: 'NotoSansTamil', isUnicode: true };
    }
  }

  if (hasDevanagari) {
    try {
      doc.addFileToVFS('NotoSansDevanagari.ttf', NOTO_SANS_DEVANAGARI_BASE64);
      doc.addFont('NotoSansDevanagari.ttf', 'NotoSansDevanagari', 'normal');
      doc.setFont('NotoSansDevanagari');
      return { fontName: 'NotoSansDevanagari', isUnicode: true };
    } catch {
      doc.setFont('NotoSansDevanagari');
      return { fontName: 'NotoSansDevanagari', isUnicode: true };
    }
  }

  doc.setFont('helvetica', 'normal');
  return { fontName: 'helvetica', isUnicode: false };
}

/**
 * Builds the complete jsPDF document with guaranteed boundary constraints, auto-shrink,
 * centered text, safe seal and signature positions, and Unicode font rendering.
 */
export function buildCertificateDoc(data: CertificateData): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const width = doc.internal.pageSize.getWidth(); // 297
  const height = doc.internal.pageSize.getHeight(); // 210

  // 1. Background Paper Color #FFF6E5
  doc.setFillColor(255, 246, 229);
  doc.rect(0, 0, width, height, 'F');

  // 2. Ink outer border #16120E (within 10mm margins)
  doc.setDrawColor(22, 18, 14);
  doc.setLineWidth(2.5);
  doc.rect(10, 10, width - 20, height - 20);

  // 3. Inner decorative border #FF5A36 (tomato) (within 14mm margins)
  doc.setDrawColor(255, 90, 54);
  doc.setLineWidth(1.2);
  doc.rect(14, 14, width - 28, height - 28);

  // Corner decorative dots
  doc.setFillColor(255, 200, 61); // Sunshine
  const cornerOffset = 14;
  const dotR = 2;
  doc.circle(cornerOffset, cornerOffset, dotR, 'F');
  doc.circle(width - cornerOffset, cornerOffset, dotR, 'F');
  doc.circle(cornerOffset, height - cornerOffset, dotR, 'F');
  doc.circle(width - cornerOffset, height - cornerOffset, dotR, 'F');

  // Detect script and set font
  const allText = `${data.studentName} ${data.quizTitle} ${data.competitionTitle || ''} ${data.hostName || ''}`;
  const { fontName, isUnicode } = configureCertificateFont(doc, allText);

  // Maximum safe printable width inside borders (keeps 25mm margin on both sides)
  const maxSafeWidth = width - 50; // 247mm
  const centerX = width / 2; // 148.5mm

  // 4. Header Title
  doc.setTextColor(22, 18, 14);
  doc.setFont(fontName, isUnicode ? 'normal' : 'bold');
  doc.setFontSize(24);
  const headerText = 'QUIZARENA CERTIFICATE OF EXCELLENCE';
  doc.text(headerText, centerX, 30, { align: 'center' });

  // Small subtitle
  doc.setFont(fontName, 'normal');
  doc.setFontSize(12);
  doc.setTextColor(100, 90, 80);
  doc.text('This is proudly awarded to', centerX, 42, { align: 'center' });

  // 5. Student Name with Auto-Shrink
  let nameFontSize = 30;
  doc.setFont(fontName, isUnicode ? 'normal' : 'bold');
  doc.setFontSize(nameFontSize);
  const studentNameStr = data.studentName.trim();

  // Dynamic auto-shrink for student name
  while (doc.getTextWidth(studentNameStr) > maxSafeWidth && nameFontSize > 14) {
    nameFontSize -= 1;
    doc.setFontSize(nameFontSize);
  }

  // If still wider than safe area, split lines
  const nameLines: string[] = doc.splitTextToSize(studentNameStr, maxSafeWidth);
  const nameStartY = 58;
  doc.setTextColor(255, 90, 54); // Tomato

  nameLines.forEach((line, idx) => {
    doc.text(line, centerX, nameStartY + idx * (nameFontSize * 0.42), { align: 'center' });
  });

  const nameEndY = nameStartY + (nameLines.length - 1) * (nameFontSize * 0.42);

  // Underline
  const nameTextWidth = Math.min(doc.getTextWidth(nameLines[0] || ''), maxSafeWidth);
  const underlineW = Math.max(70, Math.min(nameTextWidth + 20, maxSafeWidth));
  doc.setDrawColor(255, 200, 61); // Sunshine
  doc.setLineWidth(2);
  doc.line(centerX - underlineW / 2, nameEndY + 4, centerX + underlineW / 2, nameEndY + 4);

  // 6. Achievement Details & Quiz Title with splitTextToSize
  doc.setFont(fontName, 'normal');
  let bodyFontSize = 13;
  doc.setFontSize(bodyFontSize);
  doc.setTextColor(45, 38, 30);

  const contextTitle = data.competitionTitle
    ? `the tournament "${data.competitionTitle}"`
    : `the live arena "${data.quizTitle}"`;

  const leadText = `For outstanding academic and competitive performance in ${contextTitle}.`;

  // Auto-shrink body text if title is extremely long
  let leadLines: string[] = doc.splitTextToSize(leadText, maxSafeWidth);
  if (leadLines.length > 3) {
    bodyFontSize = 11;
    doc.setFontSize(bodyFontSize);
    leadLines = doc.splitTextToSize(leadText, maxSafeWidth);
  }

  let currentY = nameEndY + 16;
  leadLines.forEach((line) => {
    doc.text(line, centerX, currentY, { align: 'center' });
    currentY += bodyFontSize * 0.48;
  });

  currentY += 2;

  // Stats badge / text
  const accuracyPct = Math.round(data.accuracy * 100);
  const statsText = `Rank #${data.rank.toLocaleString()} of ${data.totalPlayers.toLocaleString()} participants   |   Score: ${data.score.toLocaleString()} pts   |   Accuracy: ${accuracyPct}%`;
  
  doc.setFont(fontName, isUnicode ? 'normal' : 'bold');
  let statsFontSize = 12;
  doc.setFontSize(statsFontSize);
  while (doc.getTextWidth(statsText) > maxSafeWidth && statsFontSize > 9) {
    statsFontSize -= 0.5;
    doc.setFontSize(statsFontSize);
  }
  const statsLines: string[] = doc.splitTextToSize(statsText, maxSafeWidth);
  statsLines.forEach((sLine) => {
    doc.text(sLine, centerX, currentY, { align: 'center' });
    currentY += statsFontSize * 0.48;
  });

  // 7. Fixed Safe Positions for Date, Verification Seal, and Signature Line
  // All three components are strictly anchored in Y: 154mm - 186mm (safe zone well above bottom margin 196mm)

  // --- Left: Issue Date ---
  const dateLineY = 174;
  doc.setFont(fontName, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(22, 18, 14);
  doc.text(`Issue Date: ${data.date}`, 32, dateLineY - 3);
  doc.setDrawColor(22, 18, 14);
  doc.setLineWidth(0.6);
  doc.line(32, dateLineY, 82, dateLineY);
  doc.setFontSize(8);
  doc.setTextColor(110, 100, 90);
  doc.text('Official Arena Record', 32, dateLineY + 5);

  if (data.verificationId) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 120, 110);
    doc.text(`ID: ${data.verificationId}`, 32, dateLineY + 11);
    doc.text('Verify: quizarena.io/verify', 32, dateLineY + 15);
  }

  // --- Center: QuizArena Verification Seal ---
  const sealY = 168;
  // Outer circle
  doc.setFillColor(255, 200, 61); // Sunshine gold
  doc.circle(centerX, sealY, 14, 'F');
  doc.setDrawColor(22, 18, 14);
  doc.setLineWidth(1.4);
  doc.circle(centerX, sealY, 14, 'S');

  // Inner decorative ring
  doc.setDrawColor(255, 90, 54); // Tomato
  doc.setLineWidth(0.8);
  doc.circle(centerX, sealY, 11.5, 'S');

  // Seal text
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(22, 18, 14);
  doc.setFontSize(8);
  doc.text('★ VERIFIED ★', centerX, sealY - 4, { align: 'center' });
  doc.setFontSize(9);
  doc.text('QUIZARENA', centerX, sealY + 1, { align: 'center' });
  doc.setFontSize(7.5);
  doc.setTextColor(255, 90, 54);
  doc.text('EXCELLENCE', centerX, sealY + 6, { align: 'center' });

  // --- Right: Host Signature Line ---
  const sigLineY = 174;
  const sigRightX = width - 32;
  const sigLeftX = width - 82;
  const sigCenterX = (sigLeftX + sigRightX) / 2;

  doc.setFont(fontName, 'normal');
  let hostNameStr = data.hostName || 'Quiz Master / Judge';
  let hostFontSize = 11;
  doc.setFontSize(hostFontSize);
  while (doc.getTextWidth(hostNameStr) > 50 && hostFontSize > 8) {
    hostFontSize -= 0.5;
    doc.setFontSize(hostFontSize);
  }
  doc.setTextColor(22, 18, 14);
  doc.text(hostNameStr, sigCenterX, sigLineY - 3, { align: 'center' });

  doc.setDrawColor(22, 18, 14);
  doc.setLineWidth(0.6);
  doc.line(sigLeftX, sigLineY, sigRightX, sigLineY);

  doc.setFontSize(9);
  doc.setTextColor(110, 100, 90);
  doc.text('Authorized Signature', sigCenterX, sigLineY + 6, { align: 'center' });

  return doc;
}

export async function generateCertificatePdf(data: CertificateData): Promise<void> {
  const doc = buildCertificateDoc(data);
  const cleanName = data.studentName.replace(/[^a-zA-Z0-9_\u0B80-\u0BFF\u0900-\u097F]/g, '_').substring(0, 40) || 'student';
  doc.save(`QuizArena_Certificate_${cleanName}.pdf`);
}

export function exportLmsGradeCsv(rows: {
  studentId: string;
  studentName: string;
  email?: string;
  score: number;
  rank: number;
  correctAnswers: number;
  incorrectAnswers?: number;
  unansweredQuestions?: number;
  totalQuestions: number;
  accuracy: string;
  completionRate?: string;
  completionTime: string;
}[], quizTitle: string) {
  const headers = [
    'Student ID',
    'Student Name',
    'Email',
    'Score',
    'Rank',
    'Correct Count',
    'Incorrect Count',
    'Unanswered Count',
    'Total Questions',
    'Accuracy %',
    'Completion %',
    'Submitted At'
  ];
  const csvContent = [
    headers.join(','),
    ...rows.map(r =>
      [
        `"${r.studentId || ''}"`,
        `"${(r.studentName || '').replace(/"/g, '""')}"`,
        `"${(r.email || '').replace(/"/g, '""')}"`,
        r.score ?? 0,
        r.rank ?? 0,
        r.correctAnswers ?? 0,
        r.incorrectAnswers ?? 0,
        r.unansweredQuestions ?? 0,
        r.totalQuestions ?? 0,
        `"${r.accuracy ?? '0%'}"`,
        `"${r.completionRate ?? '100%'}"`,
        `"${r.completionTime || ''}"`,
      ].join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `${quizTitle.replace(/\s+/g, '_')}_grades.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
