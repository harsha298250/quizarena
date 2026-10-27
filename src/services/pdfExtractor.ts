/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure pdfjs-dist worker URL locally from bundled assets (no CDN required)
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  numPages: number;
  pages: ExtractedPdfPage[];
  fullText: string;
  isScannedOrEmpty: boolean;
}

export async function extractTextFromPdf(file: File): Promise<PdfExtractionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  const pages: ExtractedPdfPage[] = [];
  let totalTextLength = 0;

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    pages.push({
      pageNumber: i,
      text: pageText,
    });
    totalTextLength += pageText.length;
  }

  const fullText = pages.map(p => `--- Page ${p.pageNumber} ---\n${p.text}`).join('\n\n');
  const isScannedOrEmpty = totalTextLength < 25; // negligible text indicates scanned PDF / image-only

  return {
    numPages,
    pages,
    fullText,
    isScannedOrEmpty,
  };
}
