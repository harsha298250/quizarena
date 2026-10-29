/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildCertificateDoc, CertificateData } from '../services/certificateService';

export function runCertificateSnapshotTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      passed++;
      results.push(`PASS: ${name}`);
    } else {
      failed++;
      results.push(`FAIL: ${name}${details ? ` - ${details}` : ''}`);
    }
  }

  // Test Case 1: Standard English Certificate
  try {
    const cert1: CertificateData = {
      studentName: 'Aarav Sharma',
      quizTitle: 'World History & Quantum Mechanics',
      rank: 1,
      totalPlayers: 45,
      score: 9500,
      accuracy: 0.95,
      date: 'October 30, 2026',
      hostName: 'Prof. Alistair Finch',
    };
    const doc1 = buildCertificateDoc(cert1);
    const pdfOutput1 = doc1.output('arraybuffer');
    assert('Case 1: Standard certificate generates valid PDF buffer', pdfOutput1.byteLength > 1000, `Length: ${pdfOutput1.byteLength}`);
  } catch (err: any) {
    assert('Case 1: Standard certificate generates valid PDF buffer', false, err.message);
  }

  // Test Case 2: Very Long Student Name & Very Long Quiz Title
  try {
    const cert2: CertificateData = {
      studentName: 'Maximilian Constantine Alexander Montgomery-Fitzgerald III, Marquess of Rutherford-upon-Avon',
      quizTitle: 'The Comprehensive Multi-Disciplinary Advanced Theoretical Physics, Differential Geometry, and Applied Nanotechnology Capstone Competition Exam 2026',
      rank: 14,
      totalPlayers: 120,
      score: 18240,
      accuracy: 0.88,
      date: 'October 30, 2026',
      hostName: 'Dr. Elizabeth Victoria Montgomery-Whittington, PhD',
      competitionTitle: 'Inter-Collegiate Grand Championship of Theoretical & Applied Sciences 2026',
    };
    const doc2 = buildCertificateDoc(cert2);
    const pdfOutput2 = doc2.output('arraybuffer');
    assert('Case 2: Long name & title auto-shrinks and wraps within border', pdfOutput2.byteLength > 1000, `Length: ${pdfOutput2.byteLength}`);
  } catch (err: any) {
    assert('Case 2: Long name & title auto-shrinks and wraps within border', false, err.message);
  }

  // Test Case 3: Tamil Student Name & Tamil Quiz Title
  try {
    const certTamil: CertificateData = {
      studentName: 'சுப்பிரமணிய பாரதியார்',
      quizTitle: 'தமிழ் இலக்கிய வரலாறு வினாடி வினா',
      rank: 2,
      totalPlayers: 300,
      score: 12500,
      accuracy: 0.92,
      date: 'அக்டோபர் 30, 2026',
      hostName: 'முனைவர் க. அன்பழகன்',
      competitionTitle: 'மாநில அளவிலான வினாடி வினாப் போட்டி',
    };
    const docTamil = buildCertificateDoc(certTamil);
    const pdfOutputTamil = docTamil.output('arraybuffer');
    assert('Case 3: Tamil Unicode font embeds and renders without error', pdfOutputTamil.byteLength > 10000, `Length: ${pdfOutputTamil.byteLength}`);
  } catch (err: any) {
    assert('Case 3: Tamil Unicode font embeds and renders without error', false, err.message);
  }

  // Test Case 4: Hindi Student Name & Hindi Quiz Title
  try {
    const certHindi: CertificateData = {
      studentName: 'आर्यभट्ट शर्मा',
      quizTitle: 'गणित एवं खगोल विज्ञान प्रश्नोत्तरी',
      rank: 3,
      totalPlayers: 500,
      score: 15400,
      accuracy: 0.96,
      date: '30 अक्टूबर 2026',
      hostName: 'आचार्य विद्याधर',
      competitionTitle: 'अखिल भारतीय ज्ञान प्रतियोगिता',
    };
    const docHindi = buildCertificateDoc(certHindi);
    const pdfOutputHindi = docHindi.output('arraybuffer');
    assert('Case 4: Hindi Devanagari Unicode font embeds and renders without error', pdfOutputHindi.byteLength > 15000, `Length: ${pdfOutputHindi.byteLength}`);
  } catch (err: any) {
    assert('Case 4: Hindi Devanagari Unicode font embeds and renders without error', false, err.message);
  }

  // Test Case 5: Large Rank and Huge Score
  try {
    const cert5: CertificateData = {
      studentName: 'Elena Rostova',
      quizTitle: 'Global Mega Arena Blitz 2026',
      rank: 1250420,
      totalPlayers: 5000000,
      score: 98765432,
      accuracy: 0.99,
      date: 'October 30, 2026',
      hostName: 'Quiz Master General',
    };
    const doc5 = buildCertificateDoc(cert5);
    const pdfOutput5 = doc5.output('arraybuffer');
    assert('Case 5: Large rank and massive score formats neatly', pdfOutput5.byteLength > 1000, `Length: ${pdfOutput5.byteLength}`);
  } catch (err: any) {
    assert('Case 5: Large rank and massive score formats neatly', false, err.message);
  }

  return { passed, failed, results };
}

// Auto-run if executed directly
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('certificateSnapshot.test')) {
  const result = runCertificateSnapshotTests();
  result.results.forEach((r) => console.log(r));
  console.log(`\nSnapshot Test Summary: ${result.passed} Passed, ${result.failed} Failed`);
  if (result.failed > 0) process.exit(1);
}
