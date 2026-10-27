/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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
}

export async function generateCertificatePdf(data: CertificateData): Promise<void> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  // Background Paper Color #FFF6E5
  doc.setFillColor(255, 246, 229);
  doc.rect(0, 0, width, height, 'F');

  // Hard ink outer border #16120E
  doc.setDrawColor(22, 18, 14);
  doc.setLineWidth(3);
  doc.rect(10, 10, width - 20, height - 20);

  // Inner decorative border
  doc.setDrawColor(255, 90, 54); // Tomato
  doc.setLineWidth(1.5);
  doc.rect(14, 14, width - 28, height - 28);

  // Header Title
  doc.setTextColor(22, 18, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text('QUIZARENA CERTIFICATE OF EXCELLENCE', width / 2, 38, { align: 'center' });

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(80, 70, 60);
  doc.text('This is proudly awarded to', width / 2, 52, { align: 'center' });

  // Student Name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(255, 90, 54);
  doc.text(data.studentName.toUpperCase(), width / 2, 74, { align: 'center' });

  // Underline
  doc.setDrawColor(255, 200, 61); // Sunshine
  doc.setLineWidth(2.5);
  doc.line(width / 2 - 60, 78, width / 2 + 60, 78);

  // Achievement description
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.setTextColor(22, 18, 14);
  const context = data.competitionTitle ? `in the tournament "${data.competitionTitle}"` : `in the live arena quiz "${data.quizTitle}"`;
  doc.text(`For outstanding academic and competitive performance ${context},`, width / 2, 94, { align: 'center' });
  doc.text(`finishing Rank #${data.rank} of ${data.totalPlayers} participants with an overall score of ${data.score.toLocaleString()} points (${Math.round(data.accuracy * 100)}% accuracy).`, width / 2, 104, { align: 'center' });

  // Date and Signatures
  doc.setFontSize(12);
  doc.setTextColor(22, 18, 14);

  // Left: Date
  doc.text(`Issue Date: ${data.date}`, 35, 155);
  doc.setLineWidth(0.5);
  doc.line(35, 158, 85, 158);

  // Center: QuizArena Verification Seal
  doc.setFillColor(255, 200, 61);
  doc.circle(width / 2, 150, 16, 'F');
  doc.setDrawColor(22, 18, 14);
  doc.setLineWidth(1.5);
  doc.circle(width / 2, 150, 16, 'S');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('VERIFIED', width / 2, 149, { align: 'center' });
  doc.text('ARENA', width / 2, 153, { align: 'center' });

  // Right: Host Signature line
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(data.hostName || 'Quiz Master / Judge', width - 85, 155);
  doc.line(width - 85, 158, width - 35, 158);
  doc.setFontSize(10);
  doc.setTextColor(100, 90, 80);
  doc.text('Authorized Signature', width - 85, 164);

  doc.save(`QuizArena_Certificate_${data.studentName.replace(/\s+/g, '_')}.pdf`);
}

export function exportLmsGradeCsv(rows: {
  studentId: string;
  studentName: string;
  email: string;
  score: number;
  rank: number;
  correctAnswers: number;
  totalQuestions: number;
  accuracy: string;
  completionTime: string;
}[], quizTitle: string) {
  const headers = ['Student ID', 'Student Name', 'Email', 'Score', 'Rank', 'Correct Count', 'Total Questions', 'Accuracy %', 'Submitted At'];
  const csvContent = [
    headers.join(','),
    ...rows.map(r =>
      [
        `"${r.studentId}"`,
        `"${r.studentName}"`,
        `"${r.email || ''}"`,
        r.score,
        r.rank,
        r.correctAnswers,
        r.totalQuestions,
        `"${r.accuracy}"`,
        `"${r.completionTime}"`,
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
